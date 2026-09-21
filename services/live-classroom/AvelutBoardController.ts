/**
 * AvelutBoardController.ts
 *
 * Programmatic bridge between AI tool calls (qwen3.5-omni-flash-realtime)
 * and the live Excalidraw canvas.
 *
 * Translates high-level board actions into native Excalidraw elements
 * with hand-drawn styling, auto layout, and responsive auto-framing.
 */

import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

// ─── Public Types ────────────────────────────────────────────────────────────

export type FontSize = 'small' | 'medium' | 'large' | 'title' | number;

export interface WriteTextArgs {
  text?: string;
  fontSize?: FontSize;
  color?: string;
  x?: number;
  y?: number;
  isFormula?: boolean;
}

export interface DrawShapeArgs {
  type: 'rectangle' | 'ellipse' | 'arrow' | 'line';
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string;
  color?: string;
  backgroundColor?: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
}

// ─── Board Controller Class ──────────────────────────────────────────────────

class BoardActionQueue {
  private queue: Array<() => Promise<void>> = [];
  private isProcessing = false;

  public push(action: () => Promise<void> | void) {
    this.queue.push(async () => {
      await action();
    });
    this.processNext();
  }

  private async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const action = this.queue.shift();
      if (action) {
        try {
          await action();
        } catch (e) {
          console.error('[BoardActionQueue] Error executing action', e);
        }
      }
    }

    this.isProcessing = false;
  }
}

export class AvelutBoardController {
  private actionQueue = new BoardActionQueue();

  private api: ExcalidrawImperativeAPI | null = null;
  private elements: any[] = [];
  private cursorY = 90;
  private lessonTitle = '';

  // ── API registration ──────────────────────────────────────────────────────

  public setApi(api: ExcalidrawImperativeAPI | null): void {
    if (api) {
      this.api = api;
      setTimeout(() => {
        if (this.elements.length > 0) {
          this.syncScene();
        }
      }, 60);
    }
  }

  public setLessonTitle(title: string): void {
    this.lessonTitle = title;
  }

  public getElements(): any[] {
    return [...this.elements];
  }

  /**
   * Initialize blackboard on entrance with single, clean header title.
   * Viewport is locked to 1.0 zoom and (0,0) offset — no infinite canvas drift.
   */
  public initBoard(title: string): void {
    this.lessonTitle = title;
    this.cursorY = 90;
    try {
      const titleEls = convertToExcalidrawElements([
        {
          type: 'text',
          x: 48,
          y: 28,
          text: `📚 ${title}`,
          fontSize: 26,
          fontFamily: 1,
          textAlign: 'left',
          verticalAlign: 'top',
          strokeColor: '#38BDF8',
          customData: { zone: 'header' },
        },
      ]);
      this.elements = [...titleEls];
      if (this.api) {
        this.syncScene();
      }
    } catch (e) {
      console.warn('[BoardController] initBoard error:', e);
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Syncs elements to Excalidraw while locking zoom at 1.0 and scroll at (0, 0).
   * Strictly prevents zooming in/out or camera panning across elements.
   */
  private syncScene(_unused?: boolean): void {
    if (!this.api) {
      console.warn('[BoardController] syncScene skipped — API null, elements=', this.elements.length);
      return;
    }
    try {
      this.api.updateScene({
        elements: [...this.elements],
        appState: {
          zoom: { value: 1.0 as any },
          scrollX: 0,
          scrollY: 0,
        },
      });
    } catch (e) {
      console.warn('[BoardController] syncScene error:', e);
    }
  }

  /**
   * Append elements with assigned zone tag and sync immediately without zooming.
   */
  private appendElements(rawElements: any[], zone: 'stage' | 'notes' | 'header' = 'stage'): void {
    try {
      const tagged = rawElements.map(el => ({
        ...el,
        customData: { ...(el.customData || {}), zone },
      }));
      const converted = convertToExcalidrawElements(tagged);
      this.elements = [...this.elements, ...converted];
      this.syncScene();
    } catch (err) {
      console.error('[BoardController] appendElements error:', err);
    }
  }

  public hasElements(): boolean {
    return this.elements.length > 1; // More than just title
  }

  public getElementCount(): number {
    return this.elements.length;
  }

  private fontSizeToNumber(size?: FontSize): number {
    if (typeof size === 'number') return size;
    switch (size) {
      case 'small': return 14;
      case 'medium': return 18;
      case 'large': return 24;
      case 'title': return 28;
      default: return 18;
    }
  }

  // ── Zone Management (Guarantees No Overlap) ───────────────────────────────

  /** Clears the main diagram stage so new diagrams replace old ones cleanly */
  public clearStage(): void {
    this.actionQueue.push(() => { this._clearStage(); });
  }
  private _clearStage(): void {
    this.elements = this.elements.filter(el => el.customData?.zone !== 'stage');
    this.cursorY = 90;
    this.syncScene();
  }

  /** Clears formula or note cards */
  public clearNotes(): void {
    this.actionQueue.push(() => { this._clearNotes(); });
  }
  private _clearNotes(): void {
    this.elements = this.elements.filter(el => el.customData?.zone !== 'notes');
    this.syncScene();
  }

  // ── Public Board Actions ──────────────────────────────────────────────────

  /** Write text or formula on the board in a designated safe area */
  public writeText(text: string, args?: WriteTextArgs): void {
    this.actionQueue.push(() => { this._writeText(text, args); });
  }
  private _writeText(text: string, args?: WriteTextArgs): void {
    if (!text?.trim()) return;

    console.log('[BoardController] writeText called:', text, args);

    if (args?.isFormula) {
      this._setFormula(text.trim());
      return;
    }

    const fontSize = this.fontSizeToNumber(args?.fontSize);
    const x = args?.x ?? 50;
    // Constrain Y to safe stage/notes area, never below y: 510
    const y = Math.min(args?.y ?? this.cursorY, 480);
    const color = args?.color ?? '#FAFAFA';

    this.appendElements([{
      type: 'text',
      x, y,
      text: text.trim(),
      fontSize,
      fontFamily: 1, // Virgil (hand-drawn)
      textAlign: 'left',
      verticalAlign: 'top',
      strokeColor: color,
    }], y >= 400 ? 'notes' : 'stage');

    if (args?.y === undefined) {
      const lines = text.split('\n').length;
      this.cursorY = Math.min(y + Math.max(36, lines * fontSize * 1.4 + 12), 480);
    }
  }

  /** Display a highlighted law or equation in the formula card slot */
  public setFormula(formulaText: string): void {
    this.actionQueue.push(() => { this._setFormula(formulaText); });
  }
  private _setFormula(formulaText: string): void {
    if (!formulaText?.trim()) return;
    // Erase existing formula slot
    this.elements = this.elements.filter(el => el.customData?.slot !== 'formula');

    const els = convertToExcalidrawElements([{
      type: 'rectangle',
      x: 50,
      y: 410,
      width: Math.min(Math.max(formulaText.length * 14 + 40, 240), 550),
      height: 48,
      strokeColor: '#FDE047',
      backgroundColor: '#1E1B4B',
      fillStyle: 'solid',
      roundness: { type: 3 },
      label: { text: formulaText.trim(), fontSize: 18, strokeColor: '#FDE047' },
      customData: { zone: 'notes', slot: 'formula' },
    }]);

    this.elements = [...this.elements, ...els];
    this.syncScene();
  }

  /** Draw a geometric shape or arrow in the stage zone */
  public drawShape(args: DrawShapeArgs): void {
    this.actionQueue.push(() => { this._drawShape(args); });
  }
  private _drawShape(args: DrawShapeArgs): void {
    const { type, x, y, width = 120, height = 70, label, color = '#38BDF8', backgroundColor = 'transparent', strokeStyle = 'solid' } = args;
    const safeY = Math.min(y, 380);

    const el: any = {
      type,
      x: Math.min(x, 650),
      y: safeY,
      width: Math.min(width, 600),
      height: Math.min(height, 260),
      strokeColor: color,
      backgroundColor,
      fillStyle: backgroundColor !== 'transparent' ? 'solid' : 'hachure',
      strokeWidth: 2,
      strokeStyle,
      roughness: 1,
      roundness: { type: 3 },
    };

    if (label) el.label = { text: label, fontSize: 16, strokeColor: '#FAFAFA' };

    this.appendElements([el], safeY >= 400 ? 'notes' : 'stage');
  }

  /** Highlight/circle an existing board element by label text */
  public highlightConcept(targetText: string, style: 'circle' | 'box' | 'underline' = 'box'): void {
    this.actionQueue.push(() => { this._highlightConcept(targetText, style); });
  }
  private _highlightConcept(targetText: string, style: 'circle' | 'box' | 'underline' = 'box'): void {
    const target = this.elements.find(el =>
      (el.type === 'text' && el.text?.toLowerCase().includes(targetText.toLowerCase())) ||
      el.label?.text?.toLowerCase().includes(targetText.toLowerCase())
    );

    const tx = target?.x ?? 60;
    const ty = target?.y ?? (this.cursorY - 40);
    const tw = Math.max(target?.width ?? 0, 140);
    const th = Math.max(target?.height ?? 0, 36);
    const hlColor = '#FBBF24';

    if (style === 'underline') {
      this.appendElements([{
        type: 'line', x: tx - 4, y: ty + th + 4,
        width: tw + 8, height: 0,
        strokeColor: hlColor, strokeWidth: 3, roughness: 2,
      }], 'stage');
    } else if (style === 'circle') {
      this.appendElements([{
        type: 'ellipse', x: tx - 12, y: ty - 8,
        width: tw + 24, height: th + 16,
        strokeColor: hlColor, strokeWidth: 2.5,
        backgroundColor: 'transparent', roughness: 2,
      }], 'stage');
    } else {
      this.appendElements([{
        type: 'rectangle', x: tx - 8, y: ty - 6,
        width: tw + 16, height: th + 12,
        strokeColor: hlColor, strokeWidth: 2, strokeStyle: 'dashed',
        backgroundColor: 'transparent', roughness: 1.2,
      }], 'stage');
    }
  }

  /** Clear the canvas (optionally keeping the lesson title) */
  public clearBoard(keepTitle = true): void {
    this.actionQueue.push(() => { this._clearBoard(keepTitle); });
  }
  private _clearBoard(keepTitle = true): void {
    if (keepTitle && this.lessonTitle) {
      const titleEl = this.elements.find(el => el.customData?.zone === 'header' || (el.type === 'text' && el.y < 60));
      this.elements = titleEl ? [titleEl] : [];
      this.cursorY = 90;
    } else {
      this.elements = [];
      this.cursorY = 90;
    }
    this.syncScene();
  }

  /** Update or edit the text of an existing element on the board */
  public updateText(targetTextOrLabel: string, newText: string): boolean {
    this.actionQueue.push(() => { this._updateText(targetTextOrLabel, newText); });
    return true;
  }
  private _updateText(targetTextOrLabel: string, newText: string): boolean {
    if (!targetTextOrLabel || !newText) return false;
    let found = false;
    const lower = targetTextOrLabel.toLowerCase();

    this.elements = this.elements.map(el => {
      if (el.type === 'text' && el.text?.toLowerCase().includes(lower)) {
        found = true;
        return {
          ...el,
          text: newText,
          originalText: newText,
          version: (el.version || 1) + 1,
          versionNonce: Math.floor(Math.random() * 1000000),
        };
      }
      if (el.label?.text?.toLowerCase().includes(lower)) {
        found = true;
        return {
          ...el,
          label: { ...el.label, text: newText },
          version: (el.version || 1) + 1,
          versionNonce: Math.floor(Math.random() * 1000000),
        };
      }
      return el;
    });

    if (found) {
      this.syncScene();
      console.log(`[BoardController] Updated text matching "${targetTextOrLabel}" -> "${newText}"`);
    }
    return found;
  }

  /** Remove a component or text matching targetTextOrLabel from the board */
  public removeComponent(targetTextOrLabel: string): boolean {
    this.actionQueue.push(() => { this._removeComponent(targetTextOrLabel); });
    return true;
  }
  private _removeComponent(targetTextOrLabel: string): boolean {
    if (!targetTextOrLabel) return false;
    const initialLen = this.elements.length;
    const lower = targetTextOrLabel.toLowerCase();

    this.elements = this.elements.filter(el => {
      const match =
        (el.type === 'text' && el.text?.toLowerCase().includes(lower)) ||
        (el.label?.text?.toLowerCase().includes(lower));
      return !match;
    });

    if (this.elements.length !== initialLen) {
      this.syncScene();
      console.log(`[BoardController] Removed component matching "${targetTextOrLabel}"`);
      return true;
    }
    return false;
  }

  /** Write a row of highlighted keyword pills in the designated notes slot */
  public writeKeywords(keywords: string[], startX = 50, startY = 475): void {
    this.actionQueue.push(() => { this._writeKeywords(keywords, startX, startY); });
  }
  private _writeKeywords(keywords: string[], startX = 50, startY = 475): void {
    if (!keywords || !keywords.length) return;
    // Clear previous keywords to avoid overlap
    this.elements = this.elements.filter(el => el.customData?.slot !== 'keywords');
    let cx = startX;
    const rawEls: any[] = [];

    keywords.slice(0, 4).forEach((kw) => {
      const kwLen = kw.length;
      const w = Math.max(kwLen * 10 + 20, 75);
      const h = 32;

      rawEls.push({
        type: 'rectangle',
        x: cx,
        y: startY,
        width: w,
        height: h,
        strokeColor: '#38BDF8',
        backgroundColor: '#0F172A',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: kw, fontSize: 13, strokeColor: '#38BDF8' },
        customData: { zone: 'notes', slot: 'keywords' },
      });

      cx += w + 12;
      if (cx > 650) {
        cx = startX;
      }
    });

    this.appendElements(rawEls, 'notes');
  }

  /** Draw high-level intuitive diagrams (automatically clears previous stage visual) */
  public drawDiagram(diagramType: string, data: Record<string, any>): void {
    this.actionQueue.push(() => { this._drawDiagram(diagramType, data); });
  }
  private _drawDiagram(diagramType: string, data: Record<string, any>): void {
    console.log('[BoardController] drawDiagram called:', diagramType, data);
    // Automatically clear previous stage diagram so diagrams never overlap
    this._clearStage();

    const startX = 50;
    const startY = 85;

    switch (diagramType) {
      case 'collision': this.drawCollisionDiagram(startX, startY, data); break;
      case 'free_body': this.drawFreeBodyDiagram(startX, startY, data); break;
      case 'coordinate_axes':
      case 'graph': this.drawCoordinateAxes(startX, startY, data); break;
      case 'flow':
      case 'steps': this.drawFlowDiagram(startX, startY, data); break;
      case 'cycle': this.drawCycleDiagram(startX, startY, data); break;
      case 'comparison': this.drawComparisonDiagram(startX, startY, data); break;
      case 'concept_map':
      case 'mindmap': this.drawConceptMapDiagram(startX, startY, data); break;
      default:
        if (data?.title) this._writeText(data.title, { fontSize: 'medium', y: startY });
        break;
    }
  }

  // ── Diagram Generators ────────────────────────────────────────────────────

  private drawCollisionDiagram(sx: number, sy: number, data: any): void {
    const r = 30;
    const ball1X = sx + 30, ball2X = sx + 220;
    const ballY = sy + 50;

    this.appendElements([
      // Ball 1
      { type: 'ellipse', x: ball1X, y: ballY, width: r * 2, height: r * 2,
        strokeColor: '#38BDF8', backgroundColor: '#0284C7', fillStyle: 'solid',
        label: { text: data.item1Mass || 'm₁', fontSize: 15, strokeColor: '#FAFAFA' } },
      // Arrow 1 (velocity)
      { type: 'arrow', x: ball1X + r * 2 + 8, y: ballY + r, width: 55, height: 0,
        strokeColor: '#38BDF8', strokeWidth: 2.5,
        label: { text: data.item1Velocity || 'v₁ →', fontSize: 13, strokeColor: '#38BDF8' } },
      // Ball 2
      { type: 'ellipse', x: ball2X, y: ballY, width: r * 2, height: r * 2,
        strokeColor: '#34D399', backgroundColor: '#059669', fillStyle: 'solid',
        label: { text: data.item2Mass || 'm₂', fontSize: 15, strokeColor: '#FAFAFA' } },
      // Arrow 2
      { type: 'arrow', x: ball2X + r * 2 + 8, y: ballY + r, width: 45, height: 0,
        strokeColor: '#34D399', strokeWidth: 2,
        label: { text: data.item2Velocity || 'v₂ = 0', fontSize: 13, strokeColor: '#34D399' } },
      ...(data.equation ? [{
        type: 'text', x: sx + 30, y: sy + 130,
        text: data.equation, fontSize: 18, strokeColor: '#FDE047', fontFamily: 1,
        textAlign: 'left', verticalAlign: 'top',
      }] : []),
    ], 'stage');
    this.cursorY = sy + 180;
  }

  private drawFreeBodyDiagram(sx: number, sy: number, data: any): void {
    const cx = sx + 120, cy = sy + 100, bs = 60;
    const forces: Array<{ name: string; direction: string }> = data.forces || [
      { name: 'F_N', direction: 'up' },
      { name: 'F_g', direction: 'down' },
      { name: 'F_applied', direction: 'right' },
      { name: 'F_friction', direction: 'left' },
    ];

    const els: any[] = [{
      type: 'rectangle', x: cx - bs / 2, y: cy - bs / 2, width: bs, height: bs,
      strokeColor: '#38BDF8', backgroundColor: '#0F172A', fillStyle: 'solid',
      label: { text: data.objectLabel || 'm', fontSize: 18, strokeColor: '#FAFAFA' },
    }];

    forces.forEach(f => {
      const arrowMap: Record<string, [number, number, number, number]> = {
        up:    [cx, cy - bs / 2, 0, -65],
        down:  [cx, cy + bs / 2, 0, 65],
        right: [cx + bs / 2, cy, 75, 0],
        left:  [cx - bs / 2, cy, -75, 0],
      };
      const [ax, ay, aw, ah] = arrowMap[f.direction] || [cx, cy, 0, -60];
      els.push({
        type: 'arrow', x: ax, y: ay, width: aw, height: ah,
        strokeColor: '#F87171', strokeWidth: 2.5,
        label: { text: f.name, fontSize: 14, strokeColor: '#FAFAFA' },
      });
    });

    this.appendElements(els);
    this.cursorY = sy + 210;
  }

  private drawCoordinateAxes(sx: number, sy: number, data: any): void {
    const ox = sx + 50, oy = sy + 170, len = 180;

    this.appendElements([
      { type: 'arrow', x: ox, y: oy, width: 0, height: -len,
        strokeColor: '#94A3B8', strokeWidth: 2,
        label: { text: data.yAxisLabel || 'y', fontSize: 16, strokeColor: '#38BDF8' } },
      { type: 'arrow', x: ox, y: oy, width: len + 40, height: 0,
        strokeColor: '#94A3B8', strokeWidth: 2,
        label: { text: data.xAxisLabel || 'x', fontSize: 16, strokeColor: '#38BDF8' } },
      { type: 'line', x: ox, y: oy, width: len, height: -(len * 0.75),
        strokeColor: '#FBBF24', strokeWidth: 3, roughness: 1.5 },
      ...(data.title ? [{
        type: 'text', x: ox + 20, y: sy,
        text: data.title, fontSize: 18, strokeColor: '#FAFAFA',
        fontFamily: 1, textAlign: 'left', verticalAlign: 'top',
      }] : []),
    ]);
    this.cursorY = oy + 50;
  }

  private drawFlowDiagram(sx: number, sy: number, data: any): void {
    const steps: string[] = data.steps || ['Intuition', 'Visual', 'Formula', 'Practice'];
    const els: any[] = [];
    let cx = sx;
    const bw = 110, bh = 45;

    steps.forEach((step, i) => {
      els.push({
        type: 'rectangle', x: cx, y: sy, width: bw, height: bh,
        strokeColor: i === 0 ? '#38BDF8' : '#64748B',
        backgroundColor: i === 0 ? '#0369A1' : '#1E293B',
        fillStyle: 'solid', roughness: 1,
        roundness: { type: 3 },
        label: { text: step, fontSize: 14, strokeColor: '#FAFAFA' },
      });
      if (i < steps.length - 1) {
        els.push({
          type: 'arrow', x: cx + bw, y: sy + bh / 2, width: 28, height: 0,
          strokeColor: '#94A3B8', strokeWidth: 2,
        });
      }
      cx += bw + 28;
    });

    this.appendElements(els);
    this.cursorY = sy + 90;
  }

  private drawCycleDiagram(sx: number, sy: number, data: any): void {
    const steps: string[] = data.steps || ['Stage 1', 'Stage 2', 'Stage 3', 'Stage 4'];
    const n = steps.length;
    const cx = sx + 160, cy = sy + 130;
    const rx = 120, ry = 80;
    const els: any[] = [];

    const positions = steps.map((_, i) => {
      const angle = (i * 2 * Math.PI) / n - Math.PI / 2;
      return {
        x: cx + rx * Math.cos(angle) - 45,
        y: cy + ry * Math.sin(angle) - 20,
      };
    });

    steps.forEach((step, i) => {
      const pos = positions[i];
      els.push({
        type: 'rectangle',
        x: pos.x,
        y: pos.y,
        width: 90,
        height: 40,
        strokeColor: '#38BDF8',
        backgroundColor: '#0F172A',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: step, fontSize: 13, strokeColor: '#FAFAFA' },
      });

      const nextPos = positions[(i + 1) % n];
      const startAx = pos.x + 45;
      const startAy = pos.y + 20;
      const endAx = nextPos.x + 45;
      const endAy = nextPos.y + 20;
      els.push({
        type: 'arrow',
        x: startAx,
        y: startAy,
        width: (endAx - startAx) * 0.7,
        height: (endAy - startAy) * 0.7,
        strokeColor: '#F59E0B',
        strokeWidth: 2,
      });
    });

    if (data.title) {
      els.push({
        type: 'text',
        x: sx + 20,
        y: sy,
        text: `🔄 ${data.title}`,
        fontSize: 18,
        strokeColor: '#FAFAFA',
        fontFamily: 1,
        textAlign: 'left',
        verticalAlign: 'top',
      });
    }

    this.appendElements(els);
    this.cursorY = sy + 250;
  }

  private drawComparisonDiagram(sx: number, sy: number, data: any): void {
    const leftTitle = data.leftTitle || 'Concept A';
    const rightTitle = data.rightTitle || 'Concept B';
    const leftPoints: string[] = data.leftPoints || [];
    const rightPoints: string[] = data.rightPoints || [];

    const colW = 160;
    const els: any[] = [
      // Left header
      {
        type: 'rectangle',
        x: sx,
        y: sy,
        width: colW,
        height: 38,
        strokeColor: '#38BDF8',
        backgroundColor: '#0369A1',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: leftTitle, fontSize: 14, strokeColor: '#FAFAFA' },
      },
      // VS badge
      {
        type: 'ellipse',
        x: sx + colW + 10,
        y: sy + 4,
        width: 32,
        height: 32,
        strokeColor: '#F59E0B',
        backgroundColor: '#78350F',
        fillStyle: 'solid',
        label: { text: 'VS', fontSize: 11, strokeColor: '#FDE047' },
      },
      // Right header
      {
        type: 'rectangle',
        x: sx + colW + 52,
        y: sy,
        width: colW,
        height: 38,
        strokeColor: '#34D399',
        backgroundColor: '#065F46',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: rightTitle, fontSize: 14, strokeColor: '#FAFAFA' },
      },
    ];

    let rowY = sy + 48;
    const maxPoints = Math.max(leftPoints.length, rightPoints.length, 1);
    for (let i = 0; i < maxPoints; i++) {
      if (leftPoints[i]) {
        els.push({
          type: 'text',
          x: sx + 6,
          y: rowY,
          text: `• ${leftPoints[i]}`,
          fontSize: 14,
          strokeColor: '#E2E8F0',
          fontFamily: 1,
        });
      }
      if (rightPoints[i]) {
        els.push({
          type: 'text',
          x: sx + colW + 58,
          y: rowY,
          text: `• ${rightPoints[i]}`,
          fontSize: 14,
          strokeColor: '#E2E8F0',
          fontFamily: 1,
        });
      }
      rowY += 26;
    }

    this.appendElements(els);
    this.cursorY = rowY + 30;
  }

  private drawConceptMapDiagram(sx: number, sy: number, data: any): void {
    const central = data.centralConcept || data.title || 'Core Idea';
    const branches: Array<{ label: string; details?: string }> = data.branches || [
      { label: 'Aspect 1' },
      { label: 'Aspect 2' },
      { label: 'Aspect 3' },
    ];

    const cx = sx + 160, cy = sy + 90;
    const els: any[] = [
      // Central Node
      {
        type: 'ellipse',
        x: cx - 60,
        y: cy - 25,
        width: 120,
        height: 50,
        strokeColor: '#38BDF8',
        backgroundColor: '#0C4A6E',
        fillStyle: 'solid',
        label: { text: central, fontSize: 15, strokeColor: '#FAFAFA' },
      },
    ];

    const branchDist = 130;
    const n = branches.length;
    branches.forEach((b, i) => {
      const angle = (i * 2 * Math.PI) / n;
      const bx = cx + branchDist * Math.cos(angle) - 45;
      const by = cy + (branchDist * 0.7) * Math.sin(angle) - 18;

      // Connecting arrow
      els.push({
        type: 'arrow',
        x: cx,
        y: cy,
        width: (bx + 45 - cx) * 0.8,
        height: (by + 18 - cy) * 0.8,
        strokeColor: '#94A3B8',
        strokeWidth: 1.8,
      });

      // Branch node
      els.push({
        type: 'rectangle',
        x: bx,
        y: by,
        width: 90,
        height: 36,
        strokeColor: '#A78BFA',
        backgroundColor: '#1E1B4B',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: b.label, fontSize: 12, strokeColor: '#FAFAFA' },
      });
    });

    this.appendElements(els);
    this.cursorY = sy + 210;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const avelutBoardController = new AvelutBoardController();

