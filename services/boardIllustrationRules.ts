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
BOARD PRIORITY (STRICT - illustration-first):
1) ILLUSTRATION is the main content. Compose with path/line/circle/arrow draws (2-5 progressive strokes).
2) TEXT is secondary only: one short title (top), at most 3 short bullets (left or bottom margin), OR one formula near the figure.
3) NEVER paragraph walls of text. If muted, the figure alone must still show the idea.
4) ONE main visual idea per board. Build it beat-by-beat with speech.
5) Layout zones (0-100 coords):
   - Title: y 6-12, x ~50
   - Figure: x 28-72, y 38-72 (CENTER - largest visual)
   - Formula: near figure, y 18-40
   - Bullets: left x 12-35 OR bottom y 78-90
6) Progressive timing: Beat1 speak -> DRAW base; Beat2 speak -> DRAW arrow; Beat3 -> HIGHLIGHT or label.
7) Colors on dark board: #E2E8F0 chalk, #38BDF8 accent, #FACC15 labels.
8) No predefined primitives. Optional svg_illustration only if paths cannot express the scene.
9) fontSize: titles 2xl or 3xl, bullets xl or 2xl, formulas 3xl.
`.trim();
