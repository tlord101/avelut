/**
 * Live Board State Manager — illustration-first layout enforcement
 */

import { BoardAction, LiveBoardElement, BoardState, TeachingRuntimeState } from '../types/teachingScript';
import { sanitizeSvg } from '../utils/svgSanitizer';
import {
  clampTitlePosition,
  clampTextPosition,
  clampFormulaPosition,
  clampIllustrationPosition,
  truncateBoardText,
  MAX_TEXT_ELEMENTS,
  ILLUSTRATION_COLORS,
} from './boardIllustrationRules';

export class BoardStateManager {
  private elements: Map<string, LiveBoardElement> = new Map();
  private activeHighlights: Set<string> = new Set();
  private activeCircles: Set<string> = new Set();
  private activeUnderlines: Set<string> = new Set();
  private focusedElementId: string | null = null;
  private runtimeState: TeachingRuntimeState = 'IDLE';
  private listeners: Set<(state: BoardState & { runtimeState: TeachingRuntimeState }) => void> = new Set();

  constructor(initialElements: LiveBoardElement[] = []) {
    initialElements.forEach((el) => this.elements.set(el.id, el));
  }

  public subscribe(listener: (state: BoardState & { runtimeState: TeachingRuntimeState }) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  public getState(): BoardState & { runtimeState: TeachingRuntimeState } {
    return {
      elements: new Map(this.elements),
      activeHighlights: new Set(this.activeHighlights),
      activeCircles: new Set(this.activeCircles),
      activeUnderlines: new Set(this.activeUnderlines),
      focusedElementId: this.focusedElementId,
      runtimeState: this.runtimeState,
    };
  }

  public setRuntimeState(newState: TeachingRuntimeState) {
    if (this.runtimeState !== newState) {
      this.runtimeState = newState;
      this.notify();
    }
  }

  public getRuntimeState(): TeachingRuntimeState {
    return this.runtimeState;
  }

  private notify() {
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  public clearOverlays() {
    this.activeHighlights.clear();
    this.activeCircles.clear();
    this.activeUnderlines.clear();
    this.focusedElementId = null;
  }

  public clearBoard() {
    this.elements.clear();
    this.clearOverlays();
    this.notify();
  }

  private countTextElements(): number {
    let n = 0;
    for (const el of this.elements.values()) {
      if (el.type === 'text' || el.type === 'label') n += 1;
    }
    return n;
  }

  public applyAction(action: BoardAction): void {
    const actionId = action.id || `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    switch (action.type) {
      case 'clear':
      case 'clear_board': {
        this.clearBoard();
        break;
      }

      case 'retain': {
        for (const [id, el] of this.elements.entries()) {
          if (
            el.persistence !== 'persistent' ||
            el.type === 'diagram' ||
            el.type === 'svg' ||
            el.type === 'arrow' ||
            el.type === 'label'
          ) {
            this.elements.delete(id);
          }
        }
        this.clearOverlays();
        break;
      }

      case 'erase': {
        if (action.target) {
          this.elements.delete(action.target);
          this.activeHighlights.delete(action.target);
          this.activeCircles.delete(action.target);
          this.activeUnderlines.delete(action.target);
        } else if (action.id) {
          this.elements.delete(action.id);
        }
        break;
      }

      case 'erase_group': {
        const targetGroup = action.groupId || action.target;
        if (targetGroup) {
          for (const [id, el] of this.elements.entries()) {
            if (el.groupId === targetGroup) {
              this.elements.delete(id);
              this.activeHighlights.delete(id);
              this.activeCircles.delete(id);
              this.activeUnderlines.delete(id);
            }
          }
        }
        break;
      }

      case 'reveal':
      case 'write':
      case 'text':
      case 'formula': {
        const styleObj = (action as any).style as Record<string, string> | undefined;
        const rawX = action.position?.x ?? action.metadata?.x ?? 50;
        const rawY = action.position?.y ?? action.metadata?.y ?? 28;
        const isLatex =
          action.type === 'formula' ||
          Boolean(action.metadata?.latex) ||
          Boolean((action as any).latex);
        const isTitle =
          !isLatex &&
          rawY <= 16 &&
          !action.content?.includes('\n') &&
          (action.content?.length || 0) < 60;

        // Cap secondary text so the figure stays primary
        if (!isLatex && !isTitle && this.countTextElements() >= MAX_TEXT_ELEMENTS) {
          break;
        }

        if (isTitle) {
          for (const [existingId, existingEl] of this.elements.entries()) {
            if (existingEl.position && existingEl.position.y <= 16 && existingEl.type === 'text') {
              this.elements.delete(existingId);
            }
          }
        }

        const pos = isLatex
          ? clampFormulaPosition(rawX, rawY)
          : isTitle
            ? clampTitlePosition(rawX, rawY)
            : clampTextPosition(rawX, rawY);

        // Map CSS-like fontSize from style (e.g. "24px") to token sizes
        let fontSize =
          action.metadata?.fontSize ||
          (isLatex ? '3xl' : isTitle ? '2xl' : 'xl');
        const styleFont = styleObj?.fontSize;
        if (styleFont) {
          const n = parseInt(String(styleFont), 10);
          if (!Number.isNaN(n)) {
            if (n >= 28) fontSize = '3xl';
            else if (n >= 22) fontSize = '2xl';
            else if (n >= 18) fontSize = 'xl';
            else if (n >= 14) fontSize = 'lg';
            else fontSize = 'md';
          } else if (['sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'].includes(styleFont)) {
            fontSize = styleFont as any;
          }
        }

        const newEl: LiveBoardElement = {
          id: action.id || actionId,
          groupId: action.groupId,
          persistence: isTitle ? 'persistent' : action.persistence || 'temporary',
          type: isLatex ? 'formula' : 'text',
          content: truncateBoardText(action.content || action.metadata?.latex || ''),
          latex: action.metadata?.latex || (action as any).latex,
          position: pos,
          fontSize,
          color:
            action.metadata?.color ||
            styleObj?.color ||
            (isLatex ? ILLUSTRATION_COLORS.accent : ILLUSTRATION_COLORS.white),
          progress: 1.0,
          createdAt: Date.now(),
        };
        this.elements.set(newEl.id, newEl);
        break;
      }

      case 'draw':
      case 'illustration':
      case 'svg': {
        const rawX = action.position?.x ?? action.metadata?.x ?? 50;
        const rawY = action.position?.y ?? action.metadata?.y ?? 55;
        const pos = clampIllustrationPosition(rawX, rawY);

        const rawSvg =
          action.metadata?.svgContent ||
          (typeof action.content === 'string' && action.content.includes('<svg') ? action.content : null);

        if (rawSvg) {
          const svgEl: LiveBoardElement = {
            id: action.id || actionId,
            groupId: action.groupId,
            persistence: 'temporary',
            type: 'svg',
            svgContent: rawSvg,
            primitive: 'custom_svg',
            position: pos,
            progress: 1.0,
            createdAt: Date.now(),
          };
          this.elements.set(svgEl.id, svgEl);
        } else if (action.metadata?.drawType) {
          const meta = action.metadata;
          const pathEl: LiveBoardElement = {
            id: action.id || actionId,
            groupId: action.groupId,
            persistence: 'temporary',
            type: 'diagram',
            primitive: 'custom',
            diagramProps: {
              drawType: meta.drawType,
              d: meta.d,
              x1: meta.x1,
              y1: meta.y1,
              x2: meta.x2,
              y2: meta.y2,
              cx: meta.cx,
              cy: meta.cy,
              r: meta.r,
              label: meta.label || action.content,
              strokeWidth: meta.strokeWidth || 2.8,
              durationMs: meta.durationMs || 900,
              fill: meta.fill,
            },
            position: pos,
            color: meta.color || ILLUSTRATION_COLORS.accent,
            progress: 0,
            createdAt: Date.now(),
          };
          this.elements.set(pathEl.id, pathEl);
          const elId = pathEl.id;
          const dur = meta.durationMs || 900;
          const start = Date.now();
          const tick = () => {
            const el = this.elements.get(elId);
            if (!el) return;
            const t = Math.min(1, (Date.now() - start) / dur);
            el.progress = t;
            this.elements.set(elId, { ...el });
            this.notify();
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        } else {
          const composed = action.metadata?.diagram;
          const diagramEl: LiveBoardElement = {
            id: action.id || actionId,
            groupId: action.groupId,
            persistence: 'temporary',
            type: 'diagram',
            primitive: action.metadata?.primitive || 'custom_svg',
            diagramProps: {
              ...(action.metadata?.diagramProps || {}),
              diagram: composed,
            },
            diagram: composed,
            position: pos,
            color: action.metadata?.color || ILLUSTRATION_COLORS.accent,
            progress: 1.0,
            createdAt: Date.now(),
          };
          this.elements.set(diagramEl.id, diagramEl);
        }
        break;
      }

      case 'arrow': {
        const pos = clampIllustrationPosition(
          action.position?.x ?? action.metadata?.x,
          action.position?.y ?? action.metadata?.y
        );
        const newEl: LiveBoardElement = {
          id: action.id || actionId,
          groupId: action.groupId,
          persistence: 'temporary',
          type: 'arrow',
          content: truncateBoardText(action.content || '', 40),
          position: pos,
          color: action.metadata?.color || ILLUSTRATION_COLORS.warn,
          progress: 1.0,
          createdAt: Date.now(),
        };
        this.elements.set(newEl.id, newEl);
        break;
      }

      case 'label': {
        const pos = clampTextPosition(
          action.position?.x ?? action.metadata?.x ?? 55,
          action.position?.y ?? action.metadata?.y ?? 86
        );
        if (this.countTextElements() >= MAX_TEXT_ELEMENTS) break;
        const newEl: LiveBoardElement = {
          id: action.id || actionId,
          groupId: action.groupId,
          persistence: 'temporary',
          type: 'label',
          content: truncateBoardText(action.content || '', 40),
          position: pos,
          color: action.metadata?.color || ILLUSTRATION_COLORS.warn,
          fontSize: 'lg',
          progress: 1.0,
          createdAt: Date.now(),
        };
        this.elements.set(newEl.id, newEl);
        break;
      }

      case 'highlight': {
        if (action.target) this.activeHighlights.add(action.target);
        break;
      }

      case 'circle': {
        if (action.target) this.activeCircles.add(action.target);
        break;
      }

      case 'underline': {
        if (action.target) this.activeUnderlines.add(action.target);
        break;
      }

      default:
        break;
    }

    this.notify();
  }

  public setFocusedElement(elementId: string | null) {
    this.focusedElementId = elementId;
    this.notify();
  }

  public reset() {
    this.elements.clear();
    this.clearOverlays();
    this.runtimeState = 'IDLE';
    this.notify();
  }
}
