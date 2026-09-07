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
MASTER SVG ILLUSTRATION INSTRUCTION FOR LIVE TUTORIAL BOARDS:
"Generate a clean, minimalist technical outline illustration in valid SVG format (<svg> wrapper, no markdown block wrappers if parsing raw). Use a 400x200 viewBox, a transparent or white background, crisp strokes with light or dashed outlines for structural paths, distinct accent fills for key focal points, and clear sans-serif text labels. Use semantic classes for styling, thin strokes (stroke-width: 1.5 to 2), and a restrained professional color palette. Position all elements with precise coordinate attributes (x, y, cx, cy) to ensure exact alignment and complete responsiveness."

SEMANTIC CLASS DEFINITIONS FOR <defs><style>:
.bg { fill: transparent; }
.grid-line { stroke: rgba(255, 255, 255, 0.08); stroke-width: 1; }
.path-structural { stroke: #cbd5e1; stroke-width: 1.5; fill: none; }
.path-dashed { stroke: #94a3b8; stroke-width: 1.5; stroke-dasharray: 4, 3; fill: none; }
.path-accent { stroke: #38bdf8; stroke-width: 2; fill: none; }
.fill-node { fill: #0f172a; stroke: #38bdf8; stroke-width: 2; }
.fill-accent { fill: rgba(56, 189, 248, 0.18); stroke: #38bdf8; stroke-width: 1.5; }
.fill-subtle { fill: rgba(255, 255, 255, 0.06); stroke: #94a3b8; stroke-width: 1.5; }
.text-label { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 10px; fill: #ffffff; font-weight: 500; }
.text-muted { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 8px; fill: #94a3b8; }
.text-title { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 11px; fill: #38bdf8; font-weight: 600; letter-spacing: 0.5px; }

CORE DESIGN RULES FOR LIVE BOARD ILLUSTRATIONS:
1) MANDATORY SVG DIAGRAM: Every live tutorial board MUST produce a valid, detailed technical outline SVG diagram in the \`svg_illustration\` field matching this exact prompt template.
2) COLOR PALETTE & CONTRAST: Use a restrained professional palette with semantic classes (.fill-accent, .fill-subtle, .path-accent, .path-structural, .path-dashed). On dark chalkboard themes, use bright contrast colors (#FFFFFF, #38BDF8, #E2E8F0, #FACC15).
3) LINE WEIGHTS: Thin, deliberate strokes (stroke-width: 1.5 to 2) with semantic CSS classes for styling.
4) TYPOGRAPHY & ALIGNMENT: Rely on system sans-serif fonts (-apple-system, sans-serif) with explicit coordinate attributes (x, y, cx, cy) to ensure exact alignment and clean layout.
5) SCALABILITY: Always include a viewBox (viewBox="0 0 400 200") and set width="100%" height="100%" so it renders responsively on all device screens.
6) TITLE & ACTION SYNC: Every board MUST begin with an explicit "write" title action at x: 50, y: 10 with "sync": { "triggerImmediately": true }.
`.trim();
