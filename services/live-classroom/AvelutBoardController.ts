/**
 * AvelutBoardController.ts
 *
 * Programmatic bridge between AI tool calls and the live Excalidraw canvas.
 *
 * Rules (2026-09 production classroom):
 *  - Prefer APPEND + scroll down. Do NOT erase unless the viewport is full.
 *  - Never put generic placeholders (Concept A, Aspect 1, Core Idea) on the board.
 *  - Accept multiple JSON shapes from the visualizer (nodes[], branches[], steps[]).
 */

import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';

/**
 * Converts raw LaTeX or math expressions into clean Unicode for Excalidraw canvas.
 * Canvas elements cannot render raw LaTeX or $$ delimiters, so we translate:
 * e.g. "$$ Wave Speed: v = f \lambda $$" -> "Wave Speed: v = f · λ"
 * e.g. "$$ E = mc^2 $$" -> "E = mc²"
 */
export function formatMathForCanvas(raw: string): string {
  if (!raw) return '';
  let s = String(raw).trim();

  // Strip LaTeX math delimiters
  s = s.replace(/^\$\$\s*/, '').replace(/\s*\$\$$/, '');
  s = s.replace(/^\$\s*/, '').replace(/\s*\$$/, '');
  s = s.replace(/^\\\[\s*/, '').replace(/\s*\\\]$/, '');
  s = s.replace(/^\\\(\s*/, '').replace(/\s*\\\)$/, '');

  // Strip \text{...}, \mathrm{...}, \mathbf{...}, \mathit{...}
  s = s.replace(/\\(text|mathrm|mathbf|mathit|textbf|textit)\{([^}]+)\}/g, '$2');

  // Fractions: \frac{a}{b} -> a / b
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 / $2');

  // Square roots: \sqrt{x} -> √(x), \sqrt -> √
  s = s.replace(/\\sqrt\{([^}]+)\}/g, '√($1)');
  s = s.replace(/\\sqrt/g, '√');

  // Greek letters
  const greekMap: Record<string, string> = {
    '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\Gamma': 'Γ',
    '\\delta': 'δ', '\\Delta': 'Δ', '\\epsilon': 'ε', '\\varepsilon': 'ε',
    '\\zeta': 'ζ', '\\eta': 'η', '\\theta': 'θ', '\\Theta': 'Θ',
    '\\iota': 'ι', '\\kappa': 'κ', '\\lambda': 'λ', '\\Lambda': 'Λ',
    '\\mu': 'μ', '\\nu': 'ν', '\\xi': 'ξ', '\\Xi': 'Ξ',
    '\\pi': 'π', '\\Pi': 'Π', '\\rho': 'ρ', '\\sigma': 'σ',
    '\\Sigma': 'Σ', '\\tau': 'τ', '\\upsilon': 'υ', '\\phi': 'φ',
    '\\Phi': 'Φ', '\\chi': 'χ', '\\psi': 'ψ', '\\Psi': 'Ψ',
    '\\omega': 'ω', '\\Omega': 'Ω',
  };
  for (const [tex, uni] of Object.entries(greekMap)) {
    s = s.split(tex).join(uni);
  }

  // Common math symbols & operators
  const symbolMap: Record<string, string> = {
    '\\times': '×', '\\cdot': '·', '\\pm': '±', '\\mp': '∓',
    '\\div': '÷', '\\approx': '≈', '\\neq': '≠', '\\ne': '≠',
    '\\le': '≤', '\\leq': '≤', '\\ge': '≥', '\\geq': '≥',
    '\\infty': '∞', '\\propto': '∝', '\\partial': '∂', '\\nabla': '∇',
    '\\sum': '∑', '\\prod': '∏', '\\int': '∫', '\\in': '∈',
    '\\to': '→', '\\rightarrow': '→', '\\leftarrow': '←',
    '\\Rightarrow': '⇒', '\\Leftarrow': '⇐', '\\leftrightarrow': '↔',
    '\\degree': '°', '^{\\circ}': '°', '\\circ': '°',
  };
  for (const [tex, uni] of Object.entries(symbolMap)) {
    s = s.split(tex).join(uni);
  }

  // Superscripts (common in physics & math formulas like ^2, ^3, ^n, ^-1)
  const superMap: Record<string, string> = {
    '^0': '⁰', '^1': '¹', '^2': '²', '^3': '³', '^4': '⁴',
    '^5': '⁵', '^6': '⁶', '^7': '⁷', '^8': '⁸', '^9': '⁹',
    '^+': '⁺', '^-': '⁻', '^n': 'ⁿ', '^x': 'ˣ', '^t': 'ᵗ',
  };
  for (const [tex, uni] of Object.entries(superMap)) {
    s = s.split(tex).join(uni);
  }

  // Subscripts (common in physics like _0, _1, _2, _x, _y, _i, _n)
  const subMap: Record<string, string> = {
    '_0': '₀', '_1': '₁', '_2': '₂', '_3': '₃', '_4': '₄',
    '_5': '₅', '_6': '₆', '_7': '₇', '_8': '₈', '_9': '₉',
    '_a': 'ₐ', '_e': 'ₑ', '_i': 'ᵢ', '_o': 'ₒ', '_r': 'ᵣ',
    '_u': 'ᵤ', '_v': 'ᵥ', '_x': 'ₓ',
  };
  for (const [tex, uni] of Object.entries(subMap)) {
    s = s.split(tex).join(uni);
  }

  // Clean up any double spaces or orphan braces
  s = s.replace(/[{}]/g, '').replace(/\s{2,}/g, ' ').trim();

  return s;
}

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
  id?: string;
  type: 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line';
  x: number;
  y: number;
  width?: number;
  height?: number;
  label?: string | { text: string; fontSize?: number; strokeColor?: string };
  color?: string;
  strokeColor?: string;
  backgroundColor?: string;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  fillStyle?: 'solid' | 'hachure' | 'cross-hatch';
}

const GENERIC_LABEL_RE =
  /^(concept\s*[a-z0-9]?|aspect\s*\d+|core\s*idea|stage\s*\d+|node\s*\d+|label\s*\d+|item\s*\d+|topic\s*\d+|untitled|placeholder)$/i;

function isGenericLabel(s: string | undefined | null): boolean {
  if (!s || !String(s).trim()) return true;
  return GENERIC_LABEL_RE.test(String(s).trim());
}

/** Default max characters per line for board labels (~35 for readable classroom text) */
const BOARD_LABEL_MAX_CHARS = 35;

function wordWrap(text: string, maxLineLength: number = BOARD_LABEL_MAX_CHARS): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + word).length > maxLineLength) {
      if (currentLine) {
        lines.push(currentLine.trim());
        currentLine = '';
      }
      if (word.length > maxLineLength) {
        lines.push(word.slice(0, maxLineLength - 1) + '-');
        currentLine = word.slice(maxLineLength - 1) + ' ';
      } else {
        currentLine = word + ' ';
      }
    } else {
      currentLine += word + ' ';
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }
  return lines.join('\n');
}

function sanitizeLabel(s: string, fallback = ''): string {
  const t = String(s || '').trim();
  if (!t || isGenericLabel(t)) return fallback;
  return wordWrap(t, BOARD_LABEL_MAX_CHARS);
}

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
  private boardFiles: Record<string, any> = {};
  private cursorY = 90;
  private lessonTitle = '';
  private currentTheme: 'light' | 'dark' = 'dark';
  private onFormulaChangeCallback: ((formula: string | null) => void) | null = null;
  private onSvgIllustrationChangeCallback: ((svgString: string | null) => void) | null = null;

  public getTheme(): 'light' | 'dark' {
    return this.currentTheme;
  }

  public getCanvasBg(): string {
    return this.currentTheme === 'dark' ? '#0A0A0A' : '#F8FAFC';
  }

  public getThemePalette() {
    const isDark = this.currentTheme === 'dark';
    return {
      isDark,
      bg: isDark ? '#0A0A0A' : '#F8FAFC',
      text: isDark ? '#FFFFFF' : '#0F172A',
      textMuted: isDark ? '#94A3B8' : '#475569',
      cardBg: isDark ? '#1E293B' : '#FFFFFF',
      cardBorder: isDark ? '#38BDF8' : '#0284C7',
      labelColor: isDark ? '#FFFFFF' : '#0F172A',
      arrowColor: isDark ? '#38BDF8' : '#0284C7',
      arrowLabelColor: isDark ? '#E2E8F0' : '#1E293B',
      formulaBg: isDark ? '#1E1B4B' : '#FEF3C7',
      formulaBorder: isDark ? '#FDE047' : '#D97706',
      formulaText: isDark ? '#FDE047' : '#92400E',
      palette: isDark
        ? ['#38BDF8', '#34D399', '#FBBF24', '#A78BFA', '#F472B6', '#60A5FA']
        : ['#0284C7', '#059669', '#D97706', '#7C3AED', '#DB2777', '#2563EB'],
    };
  }

  public setTheme(theme: 'light' | 'dark'): void {
    if (this.currentTheme === theme) return;
    this.currentTheme = theme;
    const p = this.getThemePalette();

    // Re-theme existing elements so they contrast against the new background
    if (this.elements.length > 0) {
      this.elements = this.elements.map(el => {
        const copy = { ...el };
        if (copy.type === 'text') {
          if (copy.strokeColor === '#F8FAFC' || copy.strokeColor === '#0F172A' || copy.strokeColor === '#FFFFFF') {
            copy.strokeColor = p.text;
          }
        } else if (copy.type === 'rectangle' || copy.type === 'ellipse' || copy.type === 'diamond') {
          if (copy.customData?.slot === 'formula') {
            copy.strokeColor = p.formulaBorder;
            copy.backgroundColor = p.formulaBg;
            if (copy.label) copy.label = { ...copy.label, strokeColor: p.formulaText };
          } else {
            if (copy.backgroundColor === '#1E293B' || copy.backgroundColor === '#FFFFFF' || copy.backgroundColor === '#0F172A') {
              copy.backgroundColor = p.cardBg;
            }
            if (copy.label) {
              copy.label = { ...copy.label, strokeColor: p.labelColor };
            }
          }
        } else if (copy.type === 'arrow') {
          if (copy.label) {
            copy.label = { ...copy.label, strokeColor: p.arrowLabelColor };
          }
        }
        return copy;
      });
    }

    if (this.api) {
      this.syncScene();
    }
  }

  public setOnFormulaChange(cb: ((formula: string | null) => void) | null): void {
    this.onFormulaChangeCallback = cb;
  }

  public setOnSvgIllustrationChange(cb: ((svgString: string | null) => void) | null): void {
    this.onSvgIllustrationChangeCallback = cb;
  }

  public setSvgIllustration(svgString: string | null): void {
    this.actionQueue.push(() => {
      this._setSvgIllustration(svgString);
    });
  }

  private _setSvgIllustration(svgString: string | null): void {
    this.onSvgIllustrationChangeCallback?.(svgString);
    if (!svgString || !svgString.trim()) {
      return;
    }

    try {
      let trimmed = svgString.trim();
      // Extract <svg ... </svg> if embedded in markdown or commentary
      const match = trimmed.match(/<svg[\s\S]*?<\/svg>/i);
      if (match) {
        trimmed = match[0];
      } else if (!trimmed.startsWith('<svg')) {
        console.warn('[BoardController] String does not appear to be valid SVG, skipping board image insert');
        return;
      }

      // Ensure XML well-formedness: escape any raw '&' that is not already an XML entity
      trimmed = trimmed.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

      // Verify DOMParser passes without XML parser errors before passing to Excalidraw
      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
        const parserErr = doc.querySelector('parsererror');
        if (parserErr) {
          console.warn('[BoardController] SVG has XML parser error, skipping board image insert:', parserErr.textContent);
          return;
        }
      }

      const fileId = `svg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const base64Svg = btoa(unescape(encodeURIComponent(trimmed)));
      const dataURL = `data:image/svg+xml;base64,${base64Svg}`;

      const fileData = {
        id: fileId,
        dataURL,
        mimeType: 'image/svg+xml',
        created: Date.now(),
        lastRetrieved: Date.now(),
      };

      this.boardFiles[fileId] = fileData;

      if (this.api && (this.api as any).addFiles) {
        try {
          (this.api as any).addFiles([fileData]);
        } catch (addErr) {
          console.warn('[BoardController] Excalidraw addFiles non-fatal warning:', addErr);
        }
      }

      // Parse viewBox or width/height to get aspect ratio
      let origW = 500;
      let origH = 300;
      const vbMatch = trimmed.match(/viewBox=["']\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*["']/i);
      if (vbMatch) {
        const w = parseFloat(vbMatch[3]);
        const h = parseFloat(vbMatch[4]);
        if (w > 0 && h > 0) {
          origW = w;
          origH = h;
        }
      } else {
        const wMatch = trimmed.match(/width=["']([\d.]+)p?t?x?["']/i);
        const hMatch = trimmed.match(/height=["']([\d.]+)p?t?x?["']/i);
        if (wMatch && hMatch) {
          const w = parseFloat(wMatch[1]);
          const h = parseFloat(hMatch[1]);
          if (w > 0 && h > 0) {
            origW = w;
            origH = h;
          }
        }
      }

      const isMobile = this.isMobileView();
      // On mobile: span the board width cleanly (340-360px) and give ample height
      // On desktop: allow rich, high-resolution rendering up to 880px wide.
      const maxW = isMobile ? 360 : 880;
      const minW = isMobile ? 330 : 640;
      const renderW = isMobile
        ? Math.min(maxW, Math.max(minW, origW > 0 ? Math.min(origW, maxW) : 340))
        : Math.min(maxW, Math.max(minW, origW));

      const aspect = (origH && origW) ? origH / origW : 0.6;
      // Ensure generous height and legible scaling on mobile portrait viewports
      const renderH = isMobile
        ? Math.max(220, Math.min(420, Math.round(renderW * aspect)))
        : Math.max(200, Math.round(renderW * aspect));

      this.clearStageIfFull();

      const x = this.clampX(isMobile ? 10 : 40, renderW);
      const y = Math.max(this.STAGE_TOP, this.cursorY + 12);

      const elementId = `svg_el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const skeleton: any = {
        id: elementId,
        type: 'image',
        fileId,
        status: 'saved',
        x,
        y,
        width: renderW,
        height: renderH,
        scale: [1, 1],
        strokeColor: 'transparent',
        backgroundColor: 'transparent',
        roundness: { type: 3 },
        customData: { zone: 'stage', kind: 'illustration' },
      };

      const converted = convertToExcalidrawElements([skeleton], { regenerateIds: false });
      this.elements = [...this.elements, ...converted];
      this.cursorY = y + renderH + 24;
      this.nextFreeY = this.cursorY;
      this.lastAnnotationY = this.cursorY;
      this.lastActivePoint = { x: x + renderW / 2, y: y + renderH / 2 };
      this.syncScene();
    } catch (err) {
      console.error('[BoardController] setSvgIllustration error:', err);
    }
  }

  public clearSvgIllustration(): void {
    this.actionQueue.push(() => {
      this.onSvgIllustrationChangeCallback?.(null);
    });
  }

  private pendingSkeletons: any[] = [];
  private flushScheduled = false;

  // Mobile-first & Responsive board geometry
  private readonly MOBILE_BOARD_WIDTH = 360;
  private readonly MOBILE_CARD_WIDTH = 300;
  private readonly MOBILE_CARD_HEIGHT = 76;
  private readonly STAGE_TOP = 80;
  private readonly STAGE_BOTTOM = 3000;
  private readonly NOTES_TOP = 410;
  private readonly NOTES_BOTTOM = 2800;

  // Track most recent active element center for auto-centering viewport
  private lastActivePoint: { x: number; y: number } | null = null;

  private isMobileView(): boolean {
    if (this.api && (this.api as any).getAppState) {
      const appState = (this.api as any).getAppState();
      const w = appState?.width;
      if (typeof w === 'number' && w > 0) return w < 768;
    }
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return true;
  }

  private clampX(x: number, w = 300) {
    if (this.isMobileView()) {
      const maxX = Math.max(10, this.MOBILE_BOARD_WIDTH - w);
      return Math.max(10, Math.min(x, maxX));
    }
    const maxDesktopX = Math.max(40, 1200 - w - 20);
    return Math.max(30, Math.min(x, maxDesktopX));
  }

  private clampY(y: number, h = 0) {
    return Math.max(this.STAGE_TOP, Math.min(y, this.STAGE_BOTTOM - h));
  }


  addSkeletonElement(skeleton: any): void {
    this.pendingSkeletons.push(skeleton);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      // Batch within 50ms to allow multiple draw calls in one turn
      setTimeout(() => {
        const skeletons = [...this.pendingSkeletons];
        this.pendingSkeletons = [];
        this.flushScheduled = false;

        const elements = convertToExcalidrawElements(skeletons, { regenerateIds: false });
        if (this.api) {
          this.api.updateScene({
            elements: [...this.api.getSceneElements(), ...elements],
          });
        } else {
          console.warn('[BoardController] Buffered skeletons before Excalidraw API bound.');
        }

        // Also add to elements array to persist state
        this.elements = [...this.elements, ...elements];
      }, 50);
    }
  }

  private nextFreeY = 100;
  private lastAnnotationY = 100;

  nextAnnotationY(): number {
    const y = this.lastAnnotationY;
    this.lastAnnotationY += 60;  // 60px line spacing for successive annotations
    return y;
  }

  reserveVerticalSpace(estimatedHeight: number): { y: number } {
    const y = Math.max(this.cursorY, this.nextFreeY);
    this.nextFreeY = y + estimatedHeight + 24;
    this.cursorY = this.nextFreeY;
    this.lastAnnotationY = this.cursorY;
    return { y };
  }

  drawStructured(elements: any[]): void {
    if (!elements || elements.length === 0) return;
    console.log(`[BoardController] drawStructured called with ${elements.length} elements`);

    // Elements already ordered shapes → arrows → text by the caller.
    // Add all at once so bindings resolve in a single conversion.
    for (const el of elements) {
      this.addSkeletonElement(el);
    }

    // After commit, expand layout cursor if the diagram was tall
    const maxY = Math.max(...elements.map(e => (e.y || 0) + (e.height || 0)));
    if (maxY > this.nextFreeY) {
      this.nextFreeY = maxY + 80;
      this.cursorY = this.nextFreeY;
    }
  }

  getCompactSummary(): string {
    const els = this.elements.slice(-60);
    const shapes = els
      .filter(e => ['rectangle', 'ellipse', 'diamond'].includes(e.type))
      .map(e => {
        const label = (e as any).label?.text;
        return label ? `${e.id}("${label.replace(/\n/g, ' ')}")` : e.id;
      });
    const arrows = els
      .filter(e => e.type === 'arrow')
      .map(e => {
        const s = (e as any).start?.id || '?';
        const t = (e as any).end?.id || '?';
        const lbl = (e as any).label?.text;
        return lbl ? `${s}→${t}("${lbl}")` : `${s}→${t}`;
      });
    const texts = els
      .filter(e => e.type === 'text')
      .map(e => `"${((e as any).text || '').slice(0, 40)}"`);

    const parts: string[] = [];
    if (shapes.length) parts.push(`Shapes: ${shapes.join(', ')}`);
    if (arrows.length) parts.push(`Arrows: ${arrows.join(', ')}`);
    if (texts.length)  parts.push(`Text: ${texts.join(' | ')}`);
    return parts.join('. ') || 'Board is empty.';
  }

  private readonly STAGE_FULL_Y = 420;
  private readonly VIEWPORT_HEIGHT = 520;

  public setApi(api: ExcalidrawImperativeAPI | null): void {
    if (api) {
      this.api = api;
      api.updateScene({
        appState: {
          theme: this.currentTheme,
          viewBackgroundColor: this.getCanvasBg(),
        }
      });
      const filesList = Object.values(this.boardFiles);
      if (filesList.length > 0 && (api as any).addFiles) {
        try {
          (api as any).addFiles(filesList);
        } catch (e) {
          console.warn('[BoardController] addFiles error in setApi:', e);
        }
      }
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

  public initBoard(title: string): void {
    this.lessonTitle = title;
    this.cursorY = 90;
    this.nextFreeY = 100;
    this.lastAnnotationY = 100;
    this.elements = [];
    this.boardFiles = {};
    if (title && title.trim()) {
      const blueColor = this.currentTheme === 'dark' ? '#38BDF8' : '#2563EB';
      this.writeText(title.trim(), {
        color: blueColor,
        fontSize: 'title',
        x: 30,
        y: 100,
      });
    }
    if (this.api) {
      this.syncScene();
    }
  }

  private syncScene(): void {
    if (!this.api) {
      console.warn('[BoardController] syncScene skipped — API null, elements=', this.elements.length);
      return;
    }
    try {
      const appState = (this.api.getAppState ? this.api.getAppState() : null) as any;
      const viewWidth = appState?.width || (typeof window !== 'undefined' ? window.innerWidth : 360);
      const viewHeight = appState?.height || (typeof window !== 'undefined' ? window.innerHeight : 700);
      const zoom = appState?.zoom?.value || 1.0;

      const isMobile = this.isMobileView();

      let targetScrollX = 0;
      let targetScrollY = 0;

      if (this.lastActivePoint) {
        // Keep the most recent element centered on the board so user sees all of it in any direction
        const targetCenterY = (viewHeight / 2) / zoom - this.lastActivePoint.y;
        // Never scroll above the top header (keep scrollY <= 0)
        targetScrollY = Math.min(0, Math.round(targetCenterY));

        if (isMobile) {
          // On mobile, center the vertical column horizontally
          const columnCenter = this.MOBILE_BOARD_WIDTH / 2; // 180
          targetScrollX = Math.round((viewWidth / 2) / zoom - columnCenter);
        } else {
          // On desktop, center horizontally on the active element
          targetScrollX = Math.round((viewWidth / 2) / zoom - this.lastActivePoint.x);
        }
      } else {
        targetScrollY = this.cursorY > 360 ? -(this.cursorY - 260) : 0;
      }

      this.api.updateScene({
        elements: [...this.elements],
        appState: {
          theme: this.currentTheme,
          viewBackgroundColor: this.getCanvasBg(),
          zoom: { value: 1.0 as any },
          scrollX: targetScrollX,
          scrollY: targetScrollY,
        },
      });
    } catch (e) {
      console.warn('[BoardController] syncScene error:', e);
    }
  }

  private appendElements(rawElements: any[], zone: 'stage' | 'notes' | 'header' = 'stage'): void {
    try {
      const tagged = rawElements.map(el => ({
        ...el,
        customData: { ...(el.customData || {}), zone },
      }));
      const converted = convertToExcalidrawElements(tagged, { regenerateIds: false });
      this.elements = [...this.elements, ...converted];
      this.syncScene();
    } catch (err) {
      console.error('[BoardController] appendElements error:', err);
    }
  }

  public hasElements(): boolean {
    return this.elements.length > 0;
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

  private isStageFull(): boolean {
    return this.cursorY >= this.STAGE_BOTTOM - 40;
  }

  private clearStageIfFull(): void {
    if (this.isStageFull()) {
      console.log('[BoardController] Stage full — clearing to make room');
      this._clearStage();
    }
  }

  public clearStage(): void {
    this.actionQueue.push(() => { this._clearStage(); });
  }
  private _clearStage(): void {
    this.elements = this.elements.filter(el => el.customData?.zone !== 'stage');
    this.cursorY = 90;
    this.nextFreeY = 100;
    this.lastAnnotationY = 100;
    this.onFormulaChangeCallback?.(null);
    this.onSvgIllustrationChangeCallback?.(null);
    this.syncScene();
  }

  public clearNotes(): void {
    this.actionQueue.push(() => { this._clearNotes(); });
  }
  private _clearNotes(): void {
    this.elements = this.elements.filter(el => el.customData?.zone !== 'notes');
    this.onFormulaChangeCallback?.(null);
    this.syncScene();
  }

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

    this.clearStageIfFull();

    const p = this.getThemePalette();
    const fontSize = this.fontSizeToNumber(args?.fontSize);
    const x = this.clampX(args?.x ?? 30, 20);
    const y = Math.max(this.STAGE_TOP, args?.y ?? this.cursorY);
    const color = args?.color ?? p.text;

    const isMobile = this.isMobileView();
    const isMathLike = args?.isFormula || /[$^·×±√\\]/.test(text) || (text.includes('=') && !text.includes('\n'));
    let displayText = isMathLike ? formatMathForCanvas(text) : text.trim();

    if (!isMathLike) {
      // Auto-wrap lines to prevent text clipping horizontally off the canvas on mobile & desktop
      const maxLineChars = isMobile
        ? (fontSize >= 24 ? 22 : fontSize >= 18 ? 30 : 43)
        : (fontSize >= 24 ? 45 : fontSize >= 18 ? 60 : 75);

      displayText = displayText
        .split('\n')
        .map(line => (line.length > maxLineChars ? wordWrap(line, maxLineChars) : line))
        .join('\n');
    }

    const lines = displayText.split('\n');
    const longestLine = Math.max(...lines.map(l => l.length));
    const approxW = Math.min(Math.max(longestLine * fontSize * 0.55, 60), isMobile ? 380 : 800);
    const approxH = Math.max(lines.length * fontSize * 1.4, 30);
    this.lastActivePoint = { x: x + approxW / 2, y: y + approxH / 2 };

    this.appendElements([{
      type: 'text',
      x, y,
      text: displayText,
      fontSize,
      fontFamily: 1,
      textAlign: 'left',
      verticalAlign: 'top',
      strokeColor: color,
    }], y >= 400 ? 'notes' : 'stage');

    if (args?.y === undefined) {
      this.cursorY = y + Math.max(36, lines.length * fontSize * 1.4 + 14);
      this.nextFreeY = Math.max(this.nextFreeY, this.cursorY);
      this.lastAnnotationY = Math.max(this.lastAnnotationY, this.cursorY);
    }
  }

  public setFormula(formulaText: string): void {
    this.actionQueue.push(() => { this._setFormula(formulaText); });
  }
  private _setFormula(formulaText: string): void {
    if (!formulaText?.trim()) return;
    this.elements = this.elements.filter(el => el.customData?.slot !== 'formula');

    // Ensure KaTeX / LaTeX clean display formatting delimiters for sticky note
    let cleanFormula = formulaText.trim();
    if (!cleanFormula.startsWith('$') && !cleanFormula.startsWith('\\[')) {
      cleanFormula = `$$ ${cleanFormula} $$`;
    }

    this.onFormulaChangeCallback?.(cleanFormula);

    const p = this.getThemePalette();
    // Canvas cannot render raw LaTeX ($$ ... $$ or \lambda), so format with Unicode symbols
    const canvasFormula = formatMathForCanvas(cleanFormula);
    const cardWidth = Math.min(Math.max(canvasFormula.length * 13 + 40, 240), this.MOBILE_CARD_WIDTH);
    this.lastActivePoint = { x: 30 + cardWidth / 2, y: this.cursorY + 34 };

    const els = convertToExcalidrawElements([{
      type: 'rectangle',
      x: 30,
      y: this.cursorY + 10,
      width: cardWidth,
      height: 48,
      strokeColor: p.formulaBorder,
      backgroundColor: p.formulaBg,
      fillStyle: 'solid',
      roundness: { type: 3 },
      label: { text: canvasFormula, fontSize: 18, strokeColor: p.formulaText },
      customData: { zone: 'notes', slot: 'formula' },
    }]);

    this.elements = [...this.elements, ...els];
    this.cursorY += 68;
    this.syncScene();
  }

  public drawShape(args: DrawShapeArgs): void {
    this.actionQueue.push(() => { this._drawShape(args); });
  }
  private _drawShape(args: DrawShapeArgs): void {
    const p = this.getThemePalette();
    const {
      id = `shape_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type,
      x = 30,
      y = this.cursorY,
      width = this.MOBILE_CARD_WIDTH,
      height = this.MOBILE_CARD_HEIGHT,
      label,
      color,
      strokeColor = color || args.strokeColor || p.cardBorder,
      backgroundColor = args.backgroundColor || p.cardBg,
      strokeStyle = 'solid',
      fillStyle = 'solid',
    } = args;

    const clampedX = this.clampX(x, width);
    const clampedY = Math.max(this.STAGE_TOP, y);
    const cardWidth = Math.min(width, this.MOBILE_CARD_WIDTH);
    let cardHeight = height || this.MOBILE_CARD_HEIGHT;

    this.lastActivePoint = { x: clampedX + cardWidth / 2, y: clampedY + cardHeight / 2 };

    const el: any = {
      type,
      id,
      x: clampedX,
      y: clampedY,
      width: cardWidth,
      height: cardHeight,
      strokeColor,
      backgroundColor,
      fillStyle,
      strokeWidth: 2,
      strokeStyle,
      roughness: 0.5,
      roundness: { type: 3 },
      customData: { zone: 'stage' },
    };

    if (label) {
      const rawText = typeof label === 'string' ? label.trim() : label.text.trim();
      const text = /[$^·×±√\\]/.test(rawText) ? formatMathForCanvas(rawText) : rawText;
      el.label = {
        text,
        fontSize: 16,
        strokeColor: p.labelColor,
      };
      
      const lineCount = text.split('\n').length;
      if (lineCount > 1) {
        cardHeight = Math.max(cardHeight, lineCount * 24 + 32);
        el.height = cardHeight;
      }
    }

    this.appendElements([el], 'stage');
    this.cursorY = Math.max(this.cursorY, clampedY + cardHeight + 24);
  }

  public drawArrow(args: {
    fromId?: string;
    toId?: string;
    startId?: string;
    endId?: string;
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    x?: number;
    y?: number;
    label?: string;
    color?: string;
    strokeColor?: string;
    strokeWidth?: number;
    strokeStyle?: 'solid' | 'dashed' | 'dotted';
  }): void {
    this.actionQueue.push(() => {
      const from = args.fromId || args.startId;
      const to = args.toId || args.endId;

      const fromEl = from ? this.elements.find(e => e.id === from) : null;
      const toEl = to ? this.elements.find(e => e.id === to) : null;

      let startX: number;
      let startY: number;
      let endX: number;
      let endY: number;

      if (fromEl && toEl) {
        // Vertical connector: from bottom center of fromEl to top center of toEl
        startX = fromEl.x + fromEl.width / 2;
        startY = fromEl.y + fromEl.height;
        endX = toEl.x + toEl.width / 2;
        endY = toEl.y;

        // Prevent piercing across intermediate cards:
        // If distance between elements is excessive (> 150px) or inverted,
        // clamp to a clean short downward connector (36px) right below fromEl
        const vDist = endY - startY;
        if (vDist > 150 || vDist < 0) {
          endY = startY + 36;
          endX = startX;
        }
      } else {
        startX = this.clampX(args.startX ?? (this.MOBILE_BOARD_WIDTH / 2), 20);
        startY = args.startY ?? Math.max(this.STAGE_TOP, this.cursorY - 24);
        endX = startX;
        endY = args.endY ?? startY + 36;
      }

      const p = this.getThemePalette();
      const strokeColor = args.color || args.strokeColor || p.arrowColor;

      const skeleton: any = {
        type: 'arrow',
        id: `arr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        x: startX,
        y: startY,
        width: Math.abs(endX - startX) || 10,
        height: Math.abs(endY - startY) || 30,
        points: [[0, 0], [endX - startX, endY - startY]],
        strokeColor,
        strokeWidth: 2,
        ...(args.strokeStyle ? { strokeStyle: args.strokeStyle } : {}),
        endArrowhead: 'arrow',
        customData: { zone: 'stage' },
      };

      if (from) skeleton.start = { id: from };
      if (to) skeleton.end = { id: to };
      if (args.label) {
        skeleton.label = {
          text: args.label.trim(),
          fontSize: 13,
          strokeColor: p.arrowLabelColor,
        };
      }

      this.lastActivePoint = { x: (startX + endX) / 2, y: (startY + endY) / 2 };
      this.appendElements([skeleton], 'stage');
    });
  }

  public drawStickyNote(args: {
    text: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
    backgroundColor?: string;
    strokeColor?: string;
  }): void {
    this.actionQueue.push(() => {
      const {
        text,
        x = 950,
        y = 120,
        width = 240,
        height = 200,
        color,
        backgroundColor = color || '#fff3bf',
        strokeColor = '#1e1e1e',
      } = args;

      if (!text?.trim()) return;

      const skeleton = {
        type: 'rectangle', fillStyle: 'solid',
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        x: this.clampX(x, width),
        y: this.clampY(y, height),
        width,
        height,
        backgroundColor,
        strokeColor,
        label: {
          text: text.trim(),
          fontSize: 20,
        },
        created: null,
        customData: { zone: 'stage' },
      };

      this.appendElements([skeleton], 'stage');
    });
  }

  public highlightConcept(targetText: string, style: 'circle' | 'box' | 'underline' = 'box'): void {
    this.actionQueue.push(() => { this._highlightConcept(targetText, style); });
  }
  private _highlightConcept(targetText: string, style: 'circle' | 'box' | 'underline' = 'box'): void {
    if (!targetText?.trim()) return;
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

  public clearBoard(keepTitle = true): void {
    this.actionQueue.push(() => { this._clearBoard(keepTitle); });
  }
  private _clearBoard(keepTitle = true): void {
    if (keepTitle && this.lessonTitle) {
      const titleEl = this.elements.find(el => el.customData?.zone === 'header' || (el.type === 'text' && el.y < 60));
      this.elements = titleEl ? [titleEl] : [];
      this.cursorY = 90;
      this.nextFreeY = 100;
      this.lastAnnotationY = 100;
    } else {
      this.elements = [];
      this.cursorY = 90;
      this.nextFreeY = 100;
      this.lastAnnotationY = 100;
    }
    this.syncScene();
  }

  public updateText(targetTextOrLabel: string, newText: string): boolean {
    this.actionQueue.push(() => { this._updateText(targetTextOrLabel, newText); });
    return true;
  }
  private _updateText(targetTextOrLabel: string, newText: string): boolean {
    if (!targetTextOrLabel || !newText) return false;
    if (isGenericLabel(newText)) return false;
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

  public eraseElement(target?: string): { success: boolean; freedY?: number; ids: string[] } {
    const trimmed = target?.trim();
    const isTargetLast = !trimmed || trimmed.toLowerCase() === 'last' || trimmed.toLowerCase() === 'recent';
    const lower = (trimmed || '').toLowerCase();

    // Candidates exclude header/title elements
    const candidates = this.elements.filter(
      el => el.customData?.zone !== 'header' && !(el.type === 'text' && el.y < 60)
    );

    if (candidates.length === 0) return { success: false, ids: [] };

    let targetEls: any[] = [];
    if (isTargetLast) {
      // Target the most recently added candidate element
      targetEls = [candidates[candidates.length - 1]];
    } else {
      targetEls = candidates.filter(el => {
        const idMatch = el.id === trimmed || el.id?.toLowerCase() === lower;
        const textMatch = el.type === 'text' && el.text?.toLowerCase().includes(lower);
        const labelMatch = el.label?.text?.toLowerCase().includes(lower);
        return idMatch || textMatch || labelMatch;
      });
    }

    if (targetEls.length === 0) {
      console.warn(`[BoardController] eraseElement: No matching elements for "${target}"`);
      return { success: false, ids: [] };
    }

    const removedIds = new Set(targetEls.map(e => e.id));

    // Also remove any arrows connected to these elements
    const arrowsToRemove = this.elements.filter(el =>
      el.type === 'arrow' &&
      ((el.start?.id && removedIds.has(el.start.id)) || (el.end?.id && removedIds.has(el.end.id)))
    );
    arrowsToRemove.forEach(a => removedIds.add(a.id));

    // Find the minimum y among removed elements
    const minY = Math.min(...targetEls.map(e => typeof e.y === 'number' ? e.y : this.cursorY));

    // Filter out removed elements
    this.elements = this.elements.filter(el => !removedIds.has(el.id));

    // If a formula element was removed, also clear the active formula banner
    if (targetEls.some(e => e.customData?.slot === 'formula')) {
      this.onFormulaChangeCallback?.(null);
    }

    // Reclaim vertical space so next draw/write directly occupies this freed space!
    const remainingBelow = this.elements.filter(el =>
      el.customData?.zone !== 'header' && typeof el.y === 'number' && el.y >= minY
    );
    if (remainingBelow.length === 0) {
      this.cursorY = Math.max(this.STAGE_TOP, minY);
      this.nextFreeY = Math.max(100, minY);
    }

    // Update lastActivePoint to the latest remaining element
    const remaining = this.elements.filter(el => el.customData?.zone !== 'header');
    if (remaining.length > 0) {
      const last = remaining[remaining.length - 1];
      this.lastActivePoint = {
        x: (last.x || 30) + (last.width || 200) / 2,
        y: (last.y || 100) + (last.height || 40) / 2,
      };
    } else {
      this.lastActivePoint = null;
    }

    this.syncScene();
    console.log(`[BoardController] Erased ${removedIds.size} elements matching "${target}". Space reclaimed at y: ${this.cursorY}`);
    return { success: true, freedY: minY, ids: Array.from(removedIds) };
  }

  public removeComponent(targetTextOrLabel?: string): boolean {
    this.actionQueue.push(() => {
      this.eraseElement(targetTextOrLabel);
    });
    return true;
  }

  public writeKeywords(keywords: string[], startX = 50, startY = 475): void {
    this.actionQueue.push(() => { this._writeKeywords(keywords, startX, startY); });
  }
  private _writeKeywords(keywords: string[], startX = 50, startY = 475): void {
    if (!keywords || !keywords.length) return;
    const clean = keywords.map(k => sanitizeLabel(k)).filter(Boolean).slice(0, 4);
    if (!clean.length) return;

    this.elements = this.elements.filter(el => el.customData?.slot !== 'keywords');
    let cx = startX;
    const rawEls: any[] = [];

    clean.forEach((kw) => {
      const w = Math.max(kw.length * 10 + 20, 75);
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
      if (cx > 650) cx = startX;
    });

    this.appendElements(rawEls, 'notes');
  }

  public drawDiagram(diagramType: string, data: Record<string, any>): void {
    this.actionQueue.push(() => { this._drawDiagram(diagramType, data); });
  }
  private _drawDiagram(diagramType: string, data: Record<string, any>): void {
    console.log('[BoardController] drawDiagram called:', diagramType, data);

    this.clearStageIfFull();

    const startX = 50;

    // Estimate heights based on diagram type to reserve space properly
    let estimatedHeight = 200;
    if (diagramType === 'cycle' || diagramType === 'coordinate_axes' || diagramType === 'concept_map' || diagramType === 'mindmap' || diagramType === 'hierarchical_tree') {
      estimatedHeight = 260;
    } else if (diagramType === 'flow' || diagramType === 'steps') {
      estimatedHeight = 120;
    } else if (diagramType === 'free_body') {
      estimatedHeight = 240;
    }

    const startY = this.reserveVerticalSpace(estimatedHeight).y;

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
      case 'mindmap':
      case 'hierarchical_tree': this.drawConceptMapDiagram(startX, startY, data); break;
      case 'resistor':
      case 'circuit':
      case 'battery':
      case 'capacitor':
      case 'water_pipe':
      case 'heat_engine':
      case 'logic_gate':
        this._drawComponent({ component: diagramType, x: startX, y: startY, label: data?.label || data?.title, caption: data?.caption || data?.equation });
        break;
      default:
        if (data?.title && !isGenericLabel(data.title)) {
          this._writeText(data.title, { fontSize: 'medium', y: startY });
        }
        break;
    }
  }

  private drawCollisionDiagram(sx: number, sy: number, data: any): void {
    const r = 30;
    const ball1X = sx + 30, ball2X = sx + 220;
    const ballY = sy + 50;

    this.appendElements([
      {
        type: 'ellipse', x: ball1X, y: ballY, width: r * 2, height: r * 2,
        strokeColor: '#38BDF8', backgroundColor: '#0284C7', fillStyle: 'solid',
        label: { text: data.item1Mass || 'm₁', fontSize: 15, strokeColor: '#FAFAFA' },
      },
      {
        type: 'arrow', x: ball1X + r * 2 + 8, y: ballY + r, width: 55, height: 0,
        strokeColor: '#38BDF8', strokeWidth: 2.5,
        label: { text: data.item1Velocity || 'v₁ →', fontSize: 13, strokeColor: '#38BDF8' },
      },
      {
        type: 'ellipse', x: ball2X, y: ballY, width: r * 2, height: r * 2,
        strokeColor: '#34D399', backgroundColor: '#059669', fillStyle: 'solid',
        label: { text: data.item2Mass || 'm₂', fontSize: 15, strokeColor: '#FAFAFA' },
      },
      {
        type: 'arrow', x: ball2X + r * 2 + 8, y: ballY + r, width: 45, height: 0,
        strokeColor: '#34D399', strokeWidth: 2,
        label: { text: data.item2Velocity || 'v₂ = 0', fontSize: 13, strokeColor: '#34D399' },
      },
      ...(data.equation ? [{
        type: 'text', x: sx + 30, y: sy + 130,
        text: data.equation, fontSize: 18, strokeColor: '#FDE047', fontFamily: 1,
        textAlign: 'left', verticalAlign: 'top',
      }] : []),
    ], 'stage');
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
      label: { text: sanitizeLabel(data.objectLabel, 'm'), fontSize: 18, strokeColor: '#FAFAFA' },
    }];

    forces.forEach(f => {
      const arrowMap: Record<string, [number, number, number, number]> = {
        up:    [cx, cy - bs / 2, 0, -65],
        down:  [cx, cy + bs / 2, 0, 65],
        right: [cx + bs / 2, cy, 75, 0],
        left:  [cx - bs / 2, cy, -75, 0],
      };
      const [ax, ay, aw, ah] = arrowMap[f.direction] || arrowMap.up;
      els.push({
        type: 'arrow', x: ax, y: ay, width: aw, height: ah,
        strokeColor: '#FBBF24', strokeWidth: 2.5,
        label: { text: f.name, fontSize: 13, strokeColor: '#FBBF24' },
      });
    });

    this.appendElements(els, 'stage');
  }

  private drawCoordinateAxes(sx: number, sy: number, data: any): void {
    const w = 280, h = 180;
    const els: any[] = [
      { type: 'line', x: sx, y: sy + h, width: w, height: 0, strokeColor: '#94A3B8', strokeWidth: 2 },
      { type: 'line', x: sx, y: sy + h, width: 0, height: -h, strokeColor: '#94A3B8', strokeWidth: 2 },
      {
        type: 'text', x: sx + w - 20, y: sy + h + 8,
        text: data.xLabel || 'x', fontSize: 14, strokeColor: '#94A3B8', fontFamily: 1,
      },
      {
        type: 'text', x: sx - 20, y: sy,
        text: data.yLabel || 'y', fontSize: 14, strokeColor: '#94A3B8', fontFamily: 1,
      },
    ];
    if (data.title && !isGenericLabel(data.title)) {
      els.push({
        type: 'text', x: sx, y: sy - 24,
        text: data.title, fontSize: 16, strokeColor: '#38BDF8', fontFamily: 1,
      });
    }
    this.appendElements(els, 'stage');
  }

  private drawFlowDiagram(sx: number, sy: number, data: any): void {
    let steps: string[] = [];
    if (Array.isArray(data.steps)) {
      steps = data.steps.map((s: any) => typeof s === 'string' ? s : s?.label || s?.text || '').filter(Boolean);
    } else if (Array.isArray(data.nodes)) {
      steps = data.nodes.map((n: any) => n?.label || n?.text || n?.id || '').filter(Boolean);
    }
    steps = steps.map(s => sanitizeLabel(s)).filter(Boolean);
    if (steps.length < 2) {
      console.warn('[BoardController] flow diagram skipped — need ≥2 real steps, got:', data);
      return;
    }

    const els: any[] = [];
    let cx = sx;
    const bw = 110, bh = 45;

    // Create shapes first
    steps.forEach((step, i) => {
      els.push({
        type: 'rectangle', x: cx, y: sy, width: bw, height: bh,
        id: `flow-step-${i}`,
        strokeColor: i === 0 ? '#38BDF8' : '#64748B',
        backgroundColor: i === 0 ? '#0369A1' : '#1E293B',
        fillStyle: 'solid', roughness: 1,
        roundness: { type: 3 },
        label: { text: step, fontSize: 14, strokeColor: '#FAFAFA' },
      });
      cx += bw + 28;
    });

    // Then create arrows with bindings
    cx = sx;
    steps.forEach((step, i) => {
      if (i < steps.length - 1) {
        els.push({
          type: 'arrow', x: cx + bw, y: sy + bh / 2, width: 28, height: 0,
          points: [[0, 0], [28, 0]],
          strokeColor: '#94A3B8', strokeWidth: 2,
          start: { id: `flow-step-${i}` },
          end: { id: `flow-step-${i + 1}` },
        });
      }
      cx += bw + 28;
    });

    this.appendElements(els, 'stage');
  }

  private drawCycleDiagram(sx: number, sy: number, data: any): void {
    let steps: string[] = [];
    if (Array.isArray(data.steps)) {
      steps = data.steps.map((s: any) => typeof s === 'string' ? s : s?.label || '').filter(Boolean);
    } else if (Array.isArray(data.nodes)) {
      steps = data.nodes.map((n: any) => n?.label || n?.text || '').filter(Boolean);
    }
    steps = steps.map(s => sanitizeLabel(s)).filter(Boolean);
    if (steps.length < 2) {
      console.warn('[BoardController] cycle diagram skipped — need real steps');
      return;
    }

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

    // Create shapes first
    steps.forEach((step, i) => {
      const pos = positions[i];
      els.push({
        type: 'rectangle',
        id: `cycle-step-${i}`,
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
    });

    // Then create arrows with bindings
    steps.forEach((step, i) => {
      const pos = positions[i];
      const nextPos = positions[(i + 1) % n];
      const startAx = pos.x + 45;
      const startAy = pos.y + 20;
      const endAx = nextPos.x + 45;
      const endAy = nextPos.y + 20;

      els.push({
        type: 'arrow',
        x: startAx,
        y: startAy,
        width: 1,
        height: 1,
        points: [[0, 0], [1, 1]],
        strokeColor: '#94A3B8',
        strokeWidth: 1.8,
        start: { id: `cycle-step-${i}` },
        end: { id: `cycle-step-${(i + 1) % n}` },
      });
    });

    this.appendElements(els, 'stage');
  }

  private drawComparisonDiagram(sx: number, sy: number, data: any): void {
    let leftTitle = sanitizeLabel(data.leftTitle || data.left || data.a);
    let rightTitle = sanitizeLabel(data.rightTitle || data.right || data.b);
    let leftPoints: string[] = (data.leftPoints || data.leftItems || []).map((p: any) =>
      sanitizeLabel(typeof p === 'string' ? p : p?.label || p?.text || '')
    ).filter(Boolean);
    let rightPoints: string[] = (data.rightPoints || data.rightItems || []).map((p: any) =>
      sanitizeLabel(typeof p === 'string' ? p : p?.label || p?.text || '')
    ).filter(Boolean);

    if ((!leftTitle || !rightTitle) && Array.isArray(data.nodes) && data.nodes.length >= 2) {
      leftTitle = sanitizeLabel(data.nodes[0]?.label || data.nodes[0]?.text);
      rightTitle = sanitizeLabel(data.nodes[1]?.label || data.nodes[1]?.text);
    }

    if (!leftTitle || !rightTitle || isGenericLabel(leftTitle) || isGenericLabel(rightTitle)) {
      console.warn('[BoardController] comparison skipped — generic or missing titles:', data);
      return;
    }

    const colW = 160;
    const els: any[] = [
      {
        type: 'rectangle',
        x: sx, y: sy, width: colW, height: 38,
        strokeColor: '#38BDF8', backgroundColor: '#0369A1', fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: leftTitle, fontSize: 14, strokeColor: '#FAFAFA' },
      },
      {
        type: 'ellipse',
        x: sx + colW + 10, y: sy + 4, width: 32, height: 32,
        strokeColor: '#F59E0B', backgroundColor: '#78350F', fillStyle: 'solid',
        label: { text: 'VS', fontSize: 11, strokeColor: '#FDE047' },
      },
      {
        type: 'rectangle',
        x: sx + colW + 52, y: sy, width: colW, height: 38,
        strokeColor: '#34D399', backgroundColor: '#065F46', fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: rightTitle, fontSize: 14, strokeColor: '#FAFAFA' },
      },
    ];

    let rowY = sy + 48;
    const maxPoints = Math.max(leftPoints.length, rightPoints.length);
    for (let i = 0; i < maxPoints; i++) {
      if (leftPoints[i]) {
        els.push({
          type: 'text', x: sx + 6, y: rowY,
          text: `• ${leftPoints[i]}`, fontSize: 14, strokeColor: '#E2E8F0', fontFamily: 1,
        });
      }
      if (rightPoints[i]) {
        els.push({
          type: 'text', x: sx + colW + 58, y: rowY,
          text: `• ${rightPoints[i]}`, fontSize: 14, strokeColor: '#E2E8F0', fontFamily: 1,
        });
      }
      rowY += 28;
    }

    this.appendElements(els, 'stage');
  }

  private drawConceptMapDiagram(sx: number, sy: number, data: any): void {
    let central = sanitizeLabel(
      data.centralConcept ||
      data.centralNode?.label ||
      data.centralNode?.text ||
      data.title
    );

    let branches: Array<{ label: string }> = [];
    if (Array.isArray(data.branches)) {
      branches = data.branches
        .map((b: any) => ({ label: sanitizeLabel(b?.label || b?.text || b) }))
        .filter((b: any) => b.label);
    } else if (Array.isArray(data.nodes)) {
      const nodes = data.nodes
        .map((n: any) => ({
          id: n?.id,
          label: sanitizeLabel(n?.label || n?.text || n?.id),
        }))
        .filter((n: any) => n.label);

      if (!central && nodes.length) {
        central = nodes[0].label;
        branches = nodes.slice(1).map((n: any) => ({ label: n.label }));
      } else {
        branches = nodes
          .filter((n: any) => n.label.toLowerCase() !== central.toLowerCase())
          .map((n: any) => ({ label: n.label }));
      }
    }

    if (!central || isGenericLabel(central)) {
      console.warn('[BoardController] concept_map skipped — no real central label:', data);
      return;
    }

    branches = branches.slice(0, 6);

    const cx = sx + 160, cy = sy + 90;
    const els: any[] = [
      {
        type: 'ellipse',
        id: 'concept-central',
        x: cx - 60, y: cy - 25, width: 120, height: 50,
        strokeColor: '#38BDF8', backgroundColor: '#0C4A6E', fillStyle: 'solid',
        label: { text: central, fontSize: 15, strokeColor: '#FAFAFA' },
      },
    ];

    const branchDist = 130;
    const n = Math.max(branches.length, 1);

    // Create shapes first
    branches.forEach((b, i) => {
      const angle = (i * 2 * Math.PI) / n - Math.PI / 2;
      const bx = cx + branchDist * Math.cos(angle) - 45;
      const by = cy + (branchDist * 0.7) * Math.sin(angle) - 18;

      els.push({
        type: 'rectangle',
        id: `concept-branch-${i}`,
        x: bx, y: by, width: 90, height: 36,
        strokeColor: '#A78BFA', backgroundColor: '#1E1B4B', fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: b.label, fontSize: 12, strokeColor: '#FAFAFA' },
      });
    });

    // Then create arrows with bindings
    branches.forEach((b, i) => {
      els.push({
        type: 'arrow',
        x: cx, y: cy,
        width: 1,
        height: 1,
        points: [[0, 0], [1, 1]],
        strokeColor: '#94A3B8',
        strokeWidth: 1.8,
        start: { id: 'concept-central' },
        end: { id: `concept-branch-${i}` },
      });
    });

    this.appendElements(els, 'stage');
  }

  // ── Pre-Made Engineering & Scientific Components ──────────────────────────

  public drawComponent(args: {
    component: string;
    label?: string;
    caption?: string;
    x?: number;
    y?: number;
  }): void {
    this.actionQueue.push(() => { this._drawComponent(args); });
  }

  private _drawComponent(args: {
    component: string;
    label?: string;
    caption?: string;
    x?: number;
    y?: number;
  }): void {
    const { component, label, caption } = args;
    const norm = (component || '').toLowerCase().replace(/[\s_-]+/g, '');
    const reserve = this.reserveVerticalSpace(280);
    const sx = this.clampX(args.x ?? 120, 200);
    const sy = this.clampY(args.y ?? reserve.y, 150);

    if (norm.includes('resistor')) {
      this.drawResistorComponent(sx, sy, label, caption);
    } else if (norm.includes('circuit')) {
      this.drawCircuitComponent(sx, sy, label, caption);
    } else if (norm.includes('battery') || norm.includes('powersource') || norm.includes('source')) {
      this.drawBatteryComponent(sx, sy, label, caption);
    } else if (norm.includes('capacitor')) {
      this.drawCapacitorComponent(sx, sy, label, caption);
    } else if (norm.includes('logic') || norm.includes('gate')) {
      this.drawLogicGateComponent(sx, sy, label, caption);
    } else if (norm.includes('heat') || norm.includes('engine')) {
      this.drawHeatEngineComponent(sx, sy, label, caption);
    } else if (norm.includes('water') || norm.includes('pipe')) {
      this.drawWaterPipeAnalogy(sx, sy, label, caption);
    } else if (norm.includes('diode') || norm.includes('led') || norm.includes('pnjunction')) {
      this.drawDiodeComponent(sx, sy, label, caption);
    } else {
      this.drawResistorComponent(sx, sy, label, caption);
    }
  }

  private drawDiodeComponent(sx: number, sy: number, label?: string, caption?: string): void {
    const els: any[] = [
      // Left terminal wire (Anode)
      {
        type: 'line',
        x: sx,
        y: sy + 40,
        width: 80,
        height: 0,
        points: [[0, 0], [80, 0]],
        strokeColor: '#94A3B8',
        strokeWidth: 3,
      },
      // Terminal dot left
      {
        type: 'ellipse',
        x: sx - 4,
        y: sy + 36,
        width: 8,
        height: 8,
        strokeColor: '#38BDF8',
        backgroundColor: '#38BDF8',
        fillStyle: 'solid',
      },
      // Anode label
      {
        type: 'text',
        x: sx + 10,
        y: sy + 15,
        text: 'Anode (+)',
        fontSize: 14,
        strokeColor: '#38BDF8',
      },
      // Diode triangle (points right)
      {
        type: 'line',
        x: sx + 80,
        y: sy + 40,
        width: 50,
        height: 50,
        points: [
          [0, -25],
          [50, 0],
          [0, 25],
          [0, -25],
        ],
        strokeColor: '#38BDF8',
        backgroundColor: '#0284C7',
        fillStyle: 'solid',
        strokeWidth: 2.5,
      },
      // Cathode vertical bar
      {
        type: 'line',
        x: sx + 130,
        y: sy + 40,
        width: 0,
        height: 54,
        points: [
          [0, -27],
          [0, 27],
        ],
        strokeColor: '#38BDF8',
        strokeWidth: 3.5,
      },
      // Right terminal wire (Cathode)
      {
        type: 'line',
        x: sx + 130,
        y: sy + 40,
        width: 80,
        height: 0,
        points: [[0, 0], [80, 0]],
        strokeColor: '#94A3B8',
        strokeWidth: 3,
      },
      // Terminal dot right
      {
        type: 'ellipse',
        x: sx + 206,
        y: sy + 36,
        width: 8,
        height: 8,
        strokeColor: '#38BDF8',
        backgroundColor: '#38BDF8',
        fillStyle: 'solid',
      },
      // Cathode label
      {
        type: 'text',
        x: sx + 140,
        y: sy + 15,
        text: 'Cathode (-)',
        fontSize: 14,
        strokeColor: '#34D399',
      },
      // Component label
      {
        type: 'text',
        x: sx + 70,
        y: sy + 75,
        text: label || 'PN Junction Diode',
        fontSize: 16,
        strokeColor: '#FAFAFA',
      },
      // Governing equation / caption
      {
        type: 'text',
        x: sx + 10,
        y: sy + 110,
        text: caption || 'Forward Bias: V_f ≈ 0.7V (Silicon) | Unidirectional Current Flow',
        fontSize: 14,
        strokeColor: '#FDE047',
      },
    ];

    this.appendElements(els, 'stage');
    this.cursorY = Math.max(this.cursorY, sy + 150);
  }

  private drawResistorComponent(sx: number, sy: number, label?: string, caption?: string): void {
    const els: any[] = [
      // Left terminal wire
      {
        type: 'line',
        x: sx,
        y: sy + 40,
        width: 70,
        height: 0,
        points: [[0, 0], [70, 0]],
        strokeColor: '#94A3B8',
        strokeWidth: 3,
      },
      // Terminal dot left
      {
        type: 'ellipse',
        x: sx - 4,
        y: sy + 36,
        width: 8,
        height: 8,
        strokeColor: '#38BDF8',
        backgroundColor: '#38BDF8',
        fillStyle: 'solid',
      },
      // Resistor Zig-zag Body
      {
        type: 'line',
        x: sx + 70,
        y: sy + 40,
        width: 140,
        height: 0,
        points: [
          [0, 0],
          [17, -24],
          [35, 24],
          [53, -24],
          [71, 24],
          [89, -24],
          [107, 24],
          [125, -24],
          [140, 0],
        ],
        strokeColor: '#38BDF8',
        strokeWidth: 3.5,
        roughness: 1,
      },
      // Right terminal wire
      {
        type: 'line',
        x: sx + 210,
        y: sy + 40,
        width: 70,
        height: 0,
        points: [[0, 0], [70, 0]],
        strokeColor: '#94A3B8',
        strokeWidth: 3,
      },
      // Terminal dot right
      {
        type: 'ellipse',
        x: sx + 276,
        y: sy + 36,
        width: 8,
        height: 8,
        strokeColor: '#38BDF8',
        backgroundColor: '#38BDF8',
        fillStyle: 'solid',
      },
      // Resistor Title/Value Pill
      {
        type: 'text',
        x: sx + 70,
        y: sy - 15,
        text: `Resistor (R) [ ${label || '100 Ω'} ]`,
        fontSize: 22,
        strokeColor: '#FDE047',
        fontFamily: 1,
      },
      // Current flow indicator
      {
        type: 'arrow',
        x: sx + 80,
        y: sy + 75,
        width: 120,
        height: 0,
        points: [[0, 0], [120, 0]],
        strokeColor: '#34D399',
        strokeWidth: 2,
        label: { text: 'Current I →', fontSize: 14, strokeColor: '#34D399' },
      },
      // Governing Equation
      {
        type: 'text',
        x: sx + 50,
        y: sy + 115,
        text: caption || "V = I · R  (Ohm's Law)",
        fontSize: 28,
        strokeColor: '#FAFAFA',
        fontFamily: 1,
      },
      // Functional explanation
      {
        type: 'text',
        x: sx + 30,
        y: sy + 165,
        text: '• Limits electrical current  • Dissipates heat: P = I² · R',
        fontSize: 16,
        strokeColor: '#94A3B8',
        fontFamily: 1,
      },
    ];

    this.appendElements(els, 'stage');
  }

  private drawCircuitComponent(sx: number, sy: number, label?: string, caption?: string): void {
    const els: any[] = [
      // DC Source Box (left)
      {
        type: 'rectangle',
        id: 'dc-source',
        x: sx,
        y: sy + 20,
        width: 150,
        height: 80,
        strokeColor: '#F59E0B',
        backgroundColor: '#78350F',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: `DC Source\n[ ${label || '9V Battery'} ]`, fontSize: 15, strokeColor: '#FAFAFA' },
      },
      // Top Wire (Source to Resistor) with current arrow
      {
        type: 'arrow',
        x: sx + 150,
        y: sy + 60,
        width: 130,
        height: 0,
        points: [[0, 0], [130, 0]],
        strokeColor: '#34D399',
        strokeWidth: 2.5,
        label: { text: 'I (Current) →', fontSize: 13, strokeColor: '#34D399' },
      },
      // Resistor Box (Center)
      {
        type: 'rectangle',
        id: 'circuit-resistor',
        x: sx + 280,
        y: sy + 20,
        width: 160,
        height: 80,
        strokeColor: '#38BDF8',
        backgroundColor: '#0C4A6E',
        fillStyle: 'solid',
        roundness: { type: 3 },
        label: { text: 'Resistor (R)\n[ 100 Ω ]', fontSize: 15, strokeColor: '#FAFAFA' },
      },
      // Right Wire to Ground
      {
        type: 'arrow',
        x: sx + 440,
        y: sy + 60,
        width: 110,
        height: 0,
        points: [[0, 0], [110, 0]],
        strokeColor: '#94A3B8',
        strokeWidth: 2,
        label: { text: 'Return', fontSize: 12, strokeColor: '#94A3B8' },
      },
      // Ground Node (Right)
      {
        type: 'ellipse',
        x: sx + 550,
        y: sy + 45,
        width: 70,
        height: 35,
        strokeColor: '#34D399',
        backgroundColor: '#064E3B',
        fillStyle: 'solid',
        label: { text: 'GND (0V)', fontSize: 12, strokeColor: '#FAFAFA' },
      },
      // Ohm's Law Formula Card
      {
        type: 'text',
        x: sx + 140,
        y: sy + 130,
        text: caption || "V = I · R    |    I = V / R    |    P = V · I = I²R",
        fontSize: 24,
        strokeColor: '#FDE047',
        fontFamily: 1,
      },
    ];

    this.appendElements(els, 'stage');
  }

  private drawBatteryComponent(sx: number, sy: number, label?: string, caption?: string): void {
    const els: any[] = [
      { type: 'line', x: sx, y: sy + 40, width: 80, height: 0, points: [[0, 0], [80, 0]], strokeColor: '#94A3B8', strokeWidth: 3 },
      { type: 'line', x: sx + 80, y: sy + 10, width: 0, height: 60, points: [[0, 0], [0, 60]], strokeColor: '#34D399', strokeWidth: 4 },
      { type: 'text', x: sx + 75, y: sy - 15, text: '+', fontSize: 24, strokeColor: '#34D399' },
      { type: 'line', x: sx + 105, y: sy + 25, width: 0, height: 30, points: [[0, 0], [0, 30]], strokeColor: '#F87171', strokeWidth: 6 },
      { type: 'text', x: sx + 100, y: sy - 15, text: '−', fontSize: 24, strokeColor: '#F87171' },
      { type: 'line', x: sx + 105, y: sy + 40, width: 80, height: 0, points: [[0, 0], [80, 0]], strokeColor: '#94A3B8', strokeWidth: 3 },
      { type: 'text', x: sx + 30, y: sy + 90, text: `DC Voltage Source: ${label || '9V'}`, fontSize: 22, strokeColor: '#FDE047' },
      { type: 'text', x: sx + 30, y: sy + 130, text: caption || 'Maintains constant potential difference ΔV', fontSize: 16, strokeColor: '#94A3B8' },
    ];
    this.appendElements(els, 'stage');
  }

  private drawCapacitorComponent(sx: number, sy: number, label?: string, caption?: string): void {
    const els: any[] = [
      { type: 'line', x: sx, y: sy + 40, width: 80, height: 0, points: [[0, 0], [80, 0]], strokeColor: '#94A3B8', strokeWidth: 3 },
      { type: 'line', x: sx + 80, y: sy + 10, width: 0, height: 60, points: [[0, 0], [0, 60]], strokeColor: '#38BDF8', strokeWidth: 5 },
      { type: 'text', x: sx + 72, y: sy - 15, text: '+Q', fontSize: 18, strokeColor: '#38BDF8' },
      { type: 'line', x: sx + 110, y: sy + 10, width: 0, height: 60, points: [[0, 0], [0, 60]], strokeColor: '#F87171', strokeWidth: 5 },
      { type: 'text', x: sx + 105, y: sy - 15, text: '−Q', fontSize: 18, strokeColor: '#F87171' },
      { type: 'line', x: sx + 110, y: sy + 40, width: 80, height: 0, points: [[0, 0], [80, 0]], strokeColor: '#94A3B8', strokeWidth: 3 },
      { type: 'text', x: sx + 30, y: sy + 90, text: caption || 'Q = C · V    |    E = ½ C V²', fontSize: 24, strokeColor: '#FAFAFA' },
      { type: 'text', x: sx + 30, y: sy + 135, text: `Capacitor (C): ${label || '10 µF'} • Stores electrostatic energy`, fontSize: 16, strokeColor: '#94A3B8' },
    ];
    this.appendElements(els, 'stage');
  }

  private drawWaterPipeAnalogy(sx: number, sy: number, label?: string, caption?: string): void {
    const els: any[] = [
      {
        type: 'rectangle', x: sx, y: sy + 20, width: 140, height: 80,
        strokeColor: '#38BDF8', backgroundColor: '#0369A1', fillStyle: 'solid',
        label: { text: 'Wide Pipe\n(Low Resistance)', fontSize: 14, strokeColor: '#FAFAFA' },
      },
      {
        type: 'arrow', x: sx + 140, y: sy + 60, width: 60, height: 0, points: [[0, 0], [60, 0]],
        strokeColor: '#34D399', strokeWidth: 2, label: { text: 'Flow →', fontSize: 12, strokeColor: '#34D399' },
      },
      {
        type: 'rectangle', x: sx + 200, y: sy + 40, width: 120, height: 40,
        strokeColor: '#F59E0B', backgroundColor: '#B45309', fillStyle: 'solid',
        label: { text: 'Narrow Pipe\n(HIGH RESISTANCE)', fontSize: 12, strokeColor: '#FAFAFA' },
      },
      {
        type: 'arrow', x: sx + 320, y: sy + 60, width: 60, height: 0, points: [[0, 0], [60, 0]],
        strokeColor: '#F87171', strokeWidth: 2, label: { text: 'Restricted →', fontSize: 12, strokeColor: '#F87171' },
      },
      {
        type: 'rectangle', x: sx + 380, y: sy + 20, width: 140, height: 80,
        strokeColor: '#38BDF8', backgroundColor: '#0369A1', fillStyle: 'solid',
        label: { text: 'Output Pipe\n(Reduced Flow)', fontSize: 14, strokeColor: '#FAFAFA' },
      },
      {
        type: 'text', x: sx + 20, y: sy + 130,
        text: 'Hydraulic Analogy:\n• Water Pressure ≡ Voltage (V)\n• Flow Rate ≡ Current (I)\n• Pipe Constriction ≡ Resistance (R)\n• Ohm\'s Law: Current = Pressure / Resistance',
        fontSize: 18, strokeColor: '#FDE047', fontFamily: 1,
      },
    ];
    this.appendElements(els, 'stage');
  }

  private drawLogicGateComponent(sx: number, sy: number, label?: string, caption?: string): void {
    const gate = (label || 'AND').toUpperCase();
    const els: any[] = [
      { type: 'line', x: sx, y: sy + 30, width: 60, height: 0, points: [[0, 0], [60, 0]], strokeColor: '#94A3B8', strokeWidth: 2.5 },
      { type: 'text', x: sx - 20, y: sy + 20, text: 'A', fontSize: 16, strokeColor: '#38BDF8' },
      { type: 'line', x: sx + 60, y: sy + 70, width: 60, height: 0, points: [[0, 0], [60, 0]], strokeColor: '#94A3B8', strokeWidth: 2.5 },
      { type: 'text', x: sx - 20, y: sy + 60, text: 'B', fontSize: 16, strokeColor: '#38BDF8' },
      {
        type: 'rectangle', x: sx + 60, y: sy + 15, width: 110, height: 70,
        strokeColor: '#8B5CF6', backgroundColor: '#4C1D95', fillStyle: 'solid', roundness: { type: 3 },
        label: { text: `${gate} Gate`, fontSize: 16, strokeColor: '#FAFAFA' },
      },
      { type: 'arrow', x: sx + 170, y: sy + 50, width: 80, height: 0, points: [[0, 0], [80, 0]], strokeColor: '#34D399', strokeWidth: 2.5 },
      { type: 'text', x: sx + 260, y: sy + 40, text: 'Y (Output)', fontSize: 16, strokeColor: '#34D399' },
      {
        type: 'text', x: sx + 30, y: sy + 115,
        text: caption || (gate === 'OR' ? 'Y = A + B' : gate === 'NOT' ? 'Y = ¬A' : 'Y = A · B (Logic AND)'),
        fontSize: 24, strokeColor: '#FDE047', fontFamily: 1,
      },
    ];
    this.appendElements(els, 'stage');
  }

  private drawHeatEngineComponent(sx: number, sy: number, label?: string, caption?: string): void {
    const els: any[] = [
      {
        type: 'ellipse', x: sx + 140, y: sy, width: 180, height: 60,
        strokeColor: '#F87171', backgroundColor: '#7F1D1D', fillStyle: 'solid',
        label: { text: 'Hot Reservoir (T_H)', fontSize: 15, strokeColor: '#FAFAFA' },
      },
      {
        type: 'arrow', x: sx + 230, y: sy + 60, width: 0, height: 60, points: [[0, 0], [0, 60]],
        strokeColor: '#F87171', strokeWidth: 3, label: { text: 'Q_H', fontSize: 14, strokeColor: '#F87171' },
      },
      {
        type: 'rectangle', x: sx + 160, y: sy + 120, width: 140, height: 70,
        strokeColor: '#F59E0B', backgroundColor: '#78350F', fillStyle: 'solid', roundness: { type: 3 },
        label: { text: 'Heat Engine', fontSize: 15, strokeColor: '#FAFAFA' },
      },
      {
        type: 'arrow', x: sx + 300, y: sy + 155, width: 90, height: 0, points: [[0, 0], [90, 0]],
        strokeColor: '#34D399', strokeWidth: 3, label: { text: 'Work (W) →', fontSize: 14, strokeColor: '#34D399' },
      },
      {
        type: 'arrow', x: sx + 230, y: sy + 190, width: 0, height: 60, points: [[0, 0], [0, 60]],
        strokeColor: '#60A5FA', strokeWidth: 3, label: { text: 'Q_C', fontSize: 14, strokeColor: '#60A5FA' },
      },
      {
        type: 'ellipse', x: sx + 140, y: sy + 250, width: 180, height: 60,
        strokeColor: '#38BDF8', backgroundColor: '#0C4A6E', fillStyle: 'solid',
        label: { text: 'Cold Reservoir (T_C)', fontSize: 15, strokeColor: '#FAFAFA' },
      },
      {
        type: 'text', x: sx + 30, y: sy + 330,
        text: caption || 'Efficiency: η = W / Q_H = 1 − (T_C / T_H)',
        fontSize: 24, strokeColor: '#FDE047', fontFamily: 1,
      },
    ];
    this.appendElements(els, 'stage');
  }
  // ── Public AI Interface ──────────────────────────────────────────────────
  // This is the ONLY method the realtime model calls. Everything else is internal.

  /**
   * Execute a board_action from the realtime teacher model.
   * Returns a small result object — never a full board dump.
   */
  public executeBoardAction(args: {
    action: 'draw' | 'write' | 'clear' | 'highlight' | 'erase';
    elements?: Array<{
      kind: 'box' | 'circle' | 'diamond' | 'arrow' | 'text';
      id?: string;
      text?: string;
      x?: number;
      y?: number;
      from?: string;
      to?: string;
      label?: string;
    }>;
    text?: string;
    target?: string;
    concept?: string;
    details?: string;
  }): { status: 'ok' | 'error'; action: string; ids?: string[]; message?: string } {
    try {
      const ids: string[] = [];

      switch (args.action) {
        case 'draw': {
          if (!args.elements || args.elements.length === 0) {
            return { status: 'error', action: 'draw', message: 'No elements provided.' };
          }

          const p = this.getThemePalette();
          const PALETTE = p.palette;
          let colorIdx = 0;
          const isMobile = this.isMobileView();

          // Pass 1: shapes (must exist before arrows reference them)
          for (const el of args.elements) {
            if (el.kind === 'arrow') continue;
            const id = el.id || `el_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            ids.push(id);

            if (el.kind === 'text') {
              this.writeText(el.text || '', {
                x: isMobile ? 30 : el.x,
                y: el.y,
                fontSize: 'medium',
                color: p.text,
              });
            } else {
              const shapeType: 'rectangle' | 'ellipse' | 'diamond' =
                el.kind === 'circle' ? 'ellipse' :
                el.kind === 'diamond' ? 'diamond' :
                'rectangle';

              const strokeColor = PALETTE[colorIdx % PALETTE.length];
              colorIdx++;

              this.drawShape({
                type: shapeType,
                id,
                label: el.text || '',
                x: el.x !== undefined ? el.x : (isMobile ? 30 : 30),
                y: el.y !== undefined ? el.y : (isMobile ? undefined : el.y),
                width: el.x !== undefined ? (isMobile ? Math.min(240, this.MOBILE_CARD_WIDTH) : 240) : this.MOBILE_CARD_WIDTH,
                height: this.MOBILE_CARD_HEIGHT,
                backgroundColor: p.cardBg,
                strokeColor,
              });
            }
          }

          // Pass 2: arrows
          for (const el of args.elements) {
            if (el.kind !== 'arrow') continue;
            const id = el.id || `arr_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            ids.push(id);
            this.drawArrow({
              fromId: el.from,
              toId: el.to,
              label: el.label,
              color: p.arrowColor,
            });
          }

          return { status: 'ok', action: 'draw', ids };
        }

        case 'write': {
          const text = (
            args.text ||
            args.concept ||
            args.details ||
            (args as any).keyword ||
            (args as any).content ||
            (args as any).message ||
            ''
          ).trim();
          if (!text) return { status: 'error', action: 'write', message: 'No text provided.' };

          // Explicit LaTeX or complex math formula
          const isFormula =
            (text.startsWith('$') || text.startsWith('\\[') || text.includes('\\frac') || text.includes('\\sqrt')) &&
            text.length < 100;
          if (isFormula) {
            this.setFormula(text);
          } else {
            this.writeText(text, { fontSize: 'medium' });
          }

          return { status: 'ok', action: 'write', ids: [] };
        }

        case 'clear': {
          const target = args.target?.toLowerCase();
          if (!target || target === 'stage' || target === 'board') {
            this.clearStage();
          } else {
            this.clearBoard(true);
          }
          return { status: 'ok', action: 'clear', ids: [] };
        }

        case 'highlight': {
          const target = args.target?.trim();
          if (!target) return { status: 'error', action: 'highlight', message: 'No target provided.' };
          this.highlightConcept(target, 'box');
          return { status: 'ok', action: 'highlight', ids: [] };
        }

        case 'erase': {
          const target = args.target?.trim() || 'last';
          const res = this.eraseElement(target);
          return {
            status: res.success ? 'ok' : 'error',
            action: 'erase',
            ids: res.ids,
            message: res.success ? undefined : `No element found matching "${target}"`,
          };
        }

        default:
          return { status: 'error', action: String((args as any).action), message: 'Unknown action.' };
      }
    } catch (err) {
      console.error('[BoardController] executeBoardAction error:', err);
      return { status: 'error', action: args.action, message: String(err) };
    }
  }
}

export const avelutBoardController = new AvelutBoardController();
