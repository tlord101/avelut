/**
 * Illustration-first board layout rules (production).
 * Hierarchy: figure center -> formula near figure -> title top -> bullets margin.
 */

export const ILLUSTRATION_COLORS = {
  chalk: '#E2E8F0',
  accent: '#38BDF8',
  warn: '#FACC15',
  soft: '#94A3B8',
  white: '#FFFFFF',
} as const;

export const MAX_BOARD_TEXT_CHARS = 240;
export const MAX_TEXT_ELEMENTS = 12;

export interface LayoutClamp {
  x: number;
  y: number;
}

export function clampTitlePosition(x?: number, y?: number): LayoutClamp {
  return {
    x: Math.max(15, Math.min(85, x ?? 50)),
    y: Math.max(6, Math.min(14, y ?? 10)),
  };
}

export function clampTextPosition(x?: number, y?: number): LayoutClamp {
  return {
    x: Math.max(8, Math.min(92, x ?? 20)),
    y: Math.max(15, Math.min(92, y ?? 35)),
  };
}

export function clampFormulaPosition(x?: number, y?: number): LayoutClamp {
  return {
    x: Math.max(20, Math.min(80, x ?? 50)),
    y: Math.max(18, Math.min(42, y ?? 28)),
  };
}

/** Main illustration owns the center of the board */
export function clampIllustrationPosition(x?: number, y?: number): LayoutClamp {
  return {
    x: Math.max(28, Math.min(72, x ?? 50)),
    y: Math.max(38, Math.min(72, y ?? 55)),
  };
}

export function truncateBoardText(content: string, max = MAX_BOARD_TEXT_CHARS): string {
  const t = (content || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '...';
}

/** Shared strict block for structure + single-board prompts */
export const ILLUSTRATION_FIRST_PROMPT_BLOCK = `
BOARD PRIORITY & ILLUSTRATION STYLE (STRICT):
1) MANDATORY STYLE: LINE DRAWINGS, OUTLINE DRAWINGS & SVGs WITH LABELS:
   - All illustrations MUST be vector line drawings / outline drawings consisting of stroke paths (<path>, <line>, <circle>, <polyline>) with stroke outlines (stroke="#38BDF8", stroke-width="2.5") and transparent or minimal fills (fill="none").
   - EVERY line drawing / outline drawing MUST have explicit text labels (<text>) and callout lines/arrows (<marker>) clearly labeling every component, axis, node, force vector, or structural part.
   - DO NOT create solid filled blocks or unannotated shapes. Use clean, elegant line art / outline drawings with clear academic labels.
2) MANDATORY TITLE: Every board MUST begin with an explicit "write" action for the title at x: 50, y: 10 with "sync": { "triggerImmediately": true } and "fontSize": "3xl".
3) SPEECH-TIMED BOARD ACTION MAPPING:
   - Elements MUST be revealed in sync with speech via "speech_beats" or "sync": { "phrase": "spoken phrase" }.
   - As the lecturer mentions a phrase in speech, that specific line drawing stroke or label is revealed on the board.
4) Layout zones (0-100 coords):
   - Title: y 6-12, x ~50 (top center - persistent)
   - Line Drawing Figure: x 28-72, y 35-70 (center band - main line drawing)
   - Formulas / Bullets: x 12-35 (left margin) or y 75-88 (bottom margin)
5) Colors on dark chalkboard: #E2E8F0 chalk line, #38BDF8 accent line, #FACC15 label text, #34D399 highlight line.
`.trim();
