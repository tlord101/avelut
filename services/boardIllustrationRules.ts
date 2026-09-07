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
  emerald: '#34D399',
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
MASTER SVG ILLUSTRATION INSTRUCTION:
"Generate a clean, minimalist technical outline illustration in valid SVG format (<svg> wrapper, no markdown block wrappers if parsing raw). Use a 400x200 viewBox, a transparent background, crisp bright strokes (no heavy dark fills, use light or dashed outlines for structural elements), distinct bright accent fills for key focal points, and clear sans-serif text labels. Use semantic classes for styles."

CORE DESIGN RULES FOR DARK CHALKBOARD BACKGROUND (#0F172A):
1) COLOR PALETTE: ALWAYS use high-contrast bright chalk colors (bright cyan #38BDF8, crisp white #FFFFFF / #E2E8F0 for main outlines & text, amber #FACC15, emerald #34D399 for focal nodes, light slate #94A3B8 for structural lines). NEVER use dark navy (#0F172A) or dark slate (#2c3e50 / #000000) for strokes or text fills on the dark board!
2) LINE WEIGHTS: Thin, deliberate strokes (stroke-width="1.5" to "2") with semantic classes for styling.
3) TYPOGRAPHY: Rely on system sans-serif fonts (-apple-system, sans-serif) with explicit x and y coordinates and bright fills (fill="#FFFFFF" or fill="#38BDF8").
4) SCALABILITY & VIEWBOX: Always include a viewBox (viewBox="0 0 400 200") and set width="100%" height="100%" so it behaves responsively.
5) MANDATORY TITLE: Every board MUST begin with an explicit "write" action for the title at x: 50, y: 10 with "sync": { "triggerImmediately": true } and "fontSize": "3xl" and "color": "#FFFFFF".
6) SPEECH-TIMED KEYWORD REVEALS: Keyword text points reveal sequentially in sync with speech beats, while the full SVG illustration displays immediately in the bottom half zone (y: 55-88).
`.trim();
