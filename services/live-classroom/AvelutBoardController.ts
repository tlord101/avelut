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
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw';

// ─── Public Types ────────────────────────────────────────────────────────────

export type FontSize = 'small' | 'medium' | 'large' | 'title' | number;

export interface WriteTextArgs {
  text: string;
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

export class AvelutBoardController {
  private api: ExcalidrawImperativeAPI | null = null;
  private elements: any[] = [];
  private cursorY = 120;
  private lessonTitle = '';

  // ── API registration ──────────────────────────────────────────────────────

  public setApi(api: ExcalidrawImperativeAPI | null): void {
    if (api) {
      this.api = api;
      setTimeout(() => {
        if (this.elements.length > 0) {
          this.syncScene(true);
        }
      }, 60);
    }
  }

  public setLessonTitle(title: string): void {
    this.lessonTitle = title;
  }

  public initBoard(title: string): void {
    this.lessonTitle = title;
    this.cursorY = 120;
    try {
      const titleEls = convertToExcalidrawElements([{
        type: 'text',
        x: 60,
        y: 40,
        text: `📚 ${title}`,
        fontSize: 36,
        fontFamily: 1,
        textAlign: 'left',
        verticalAlign: 'top',
        strokeColor: '#38BDF8',
      }]);
      this.elements = [...titleEls];
      if (this.api) {
        setTimeout(() => this.syncScene(true), 60);
      }
    } catch (e) {
      console.warn('[BoardController] initBoard error:', e);
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private syncScene(scrollToContent = true): void {
    if (!this.api) return;
    try {
      this.api.updateScene({ elements: this.elements, commitToHistory: false });
      if (scrollToContent && this.elements.length > 0) {
        setTimeout(() => {
          try {
            this.api?.scrollToContent(this.elements, { fitToViewport: true, animate: true });
          } catch (_) {}
        }, 80);
      }
    } catch (e) {
      console.warn('[BoardController] syncScene error:', e);
    }
  }

  private appendElements(rawElements: any[], scroll = true): void {
    try {
      const converted = convertToExcalidrawElements(rawElements);
      this.elements = [...this.elements, ...converted];
      this.syncScene(scroll);
    } catch (err) {
      console.error('[BoardController] appendElements error:', err);
    }
  }

  private fontSizeToNumber(size?: FontSize): number {
    if (typeof size === 'number') return size;
    switch (size) {
      case 'small': return 16;
      case 'medium': return 22;
      case 'large': return 28;
      case 'title': return 36;
      default: return 22;
    }
  }

  // ── Public Board Actions ──────────────────────────────────────────────────

  /** Write text or a formula on the board */
  public writeText(text: string, args?: WriteTextArgs): void {
    if (!text?.trim()) return;

    const fontSize = this.fontSizeToNumber(args?.fontSize);
    const x = args?.x ?? 60;
    const y = args?.y ?? this.cursorY;
    const color = args?.color ?? (args?.isFormula ? '#38BDF8' : '#FAFAFA');

    this.appendElements([{
      type: 'text',
      x, y,
      text: text.trim(),
      fontSize,
      fontFamily: 1, // Virgil (hand-drawn)
      textAlign: 'left',
      verticalAlign: 'top',
      strokeColor: color,
    }]);

    if (args?.y === undefined) {
      const lines = text.split('\n').length;
      this.cursorY += Math.max(44, lines * fontSize * 1.5 + 16);
    }
  }

  /** Draw a geometric shape or arrow */
  public drawShape(args: DrawShapeArgs): void {
    const { type, x, y, width = 120, height = 70, label, color = '#38BDF8', backgroundColor = 'transparent', strokeStyle = 'solid' } = args;

    const el: any = {
      type, x, y, width, height,
      strokeColor: color,
      backgroundColor,
      fillStyle: backgroundColor !== 'transparent' ? 'solid' : 'hachure',
      strokeWidth: 2,
      strokeStyle,
      roughness: 1,
      roundness: { type: 3 },
    };

    if (label) el.label = { text: label, fontSize: 18, strokeColor: '#FAFAFA' };

    this.appendElements([el]);
    if (y + height > this.cursorY) this.cursorY = y + height + 30;
  }

  /** Highlight/circle an existing board element by label text */
  public highlightConcept(targetText: string, style: 'circle' | 'box' | 'underline' = 'box'): void {
    const target = this.elements.find(el =>
      (el.type === 'text' && el.text?.toLowerCase().includes(targetText.toLowerCase())) ||
      el.label?.text?.toLowerCase().includes(targetText.toLowerCase())
    );

    const tx = target?.x ?? 60;
    const ty = target?.y ?? (this.cursorY - 50);
    const tw = Math.max(target?.width ?? 0, 150);
    const th = Math.max(target?.height ?? 0, 40);
    const hlColor = '#FBBF24';

    if (style === 'underline') {
      this.appendElements([{
        type: 'line', x: tx - 4, y: ty + th + 4,
        width: tw + 8, height: 0,
        strokeColor: hlColor, strokeWidth: 3, roughness: 2,
      }]);
    } else if (style === 'circle') {
      this.appendElements([{
        type: 'ellipse', x: tx - 14, y: ty - 10,
        width: tw + 28, height: th + 20,
        strokeColor: hlColor, strokeWidth: 2.5,
        backgroundColor: 'transparent', roughness: 2,
      }]);
    } else {
      this.appendElements([{
        type: 'rectangle', x: tx - 8, y: ty - 6,
        width: tw + 16, height: th + 12,
        strokeColor: hlColor, strokeWidth: 2, strokeStyle: 'dashed',
        backgroundColor: 'transparent', roughness: 1.2,
      }]);
    }
  }

  /** Clear the canvas (optionally keeping the lesson title) */
  public clearBoard(keepTitle = true): void {
    if (keepTitle && this.lessonTitle) {
      const titleEl = this.elements.find(el => el.type === 'text' && el.y < 100);
      this.elements = titleEl ? [titleEl] : [];
      this.cursorY = 140;
    } else {
      this.elements = [];
      this.cursorY = 80;
    }
    this.syncScene(false);
  }

  /** Draw high-level intuitive diagrams */
  public drawDiagram(diagramType: string, data: Record<string, any>): void {
    const startY = this.cursorY;
    switch (diagramType) {
      case 'collision': this.drawCollisionDiagram(60, startY, data); break;
      case 'free_body': this.drawFreeBodyDiagram(60, startY, data); break;
      case 'coordinate_axes':
      case 'graph': this.drawCoordinateAxes(60, startY, data); break;
      case 'flow':
      case 'steps': this.drawFlowDiagram(60, startY, data); break;
      default:
        if (data?.title) this.writeText(data.title, { fontSize: 'medium' });
        break;
    }
  }

  // ── Diagram Generators ────────────────────────────────────────────────────

  private drawCollisionDiagram(sx: number, sy: number, data: any): void {
    const r = 35;
    const ball1X = sx + 30, ball2X = sx + 230;
    const ballY = sy + 60;

    this.appendElements([
      // Ball 1
      { type: 'ellipse', x: ball1X, y: ballY, width: r * 2, height: r * 2,
        strokeColor: '#38BDF8', backgroundColor: '#0284C7', fillStyle: 'solid',
        label: { text: data.item1Mass || 'm₁', fontSize: 16, strokeColor: '#FAFAFA' } },
      // Arrow 1 (velocity)
      { type: 'arrow', x: ball1X + r * 2 + 8, y: ballY + r, width: 60, height: 0,
        strokeColor: '#38BDF8', strokeWidth: 2.5,
        label: { text: data.item1Velocity || 'v₁ →', fontSize: 14, strokeColor: '#38BDF8' } },
      // Ball 2
      { type: 'ellipse', x: ball2X, y: ballY, width: r * 2, height: r * 2,
        strokeColor: '#34D399', backgroundColor: '#059669', fillStyle: 'solid',
        label: { text: data.item2Mass || 'm₂', fontSize: 16, strokeColor: '#FAFAFA' } },
      // Arrow 2
      { type: 'arrow', x: ball2X + r * 2 + 8, y: ballY + r, width: 50, height: 0,
        strokeColor: '#34D399', strokeWidth: 2,
        label: { text: data.item2Velocity || 'v₂ = 0', fontSize: 14, strokeColor: '#34D399' } },
      ...(data.equation ? [{
        type: 'text', x: sx + 40, y: sy + 160,
        text: data.equation, fontSize: 22, strokeColor: '#FDE047', fontFamily: 1,
        textAlign: 'left', verticalAlign: 'top',
      }] : []),
    ]);
    this.cursorY = sy + (data.equation ? 215 : 165);
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
}

// ── Singleton ─────────────────────────────────────────────────────────────────
export const avelutBoardController = new AvelutBoardController();

