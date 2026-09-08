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
    x: 50,
    y: Math.max(6, Math.min(12, y ?? 8)),
  };
}

export function clampTextPosition(x?: number, y?: number): LayoutClamp {
  return {
    x: 5,
    y: Math.max(18, Math.min(64, y ?? 24)),
  };
}

export function clampFormulaPosition(x?: number, y?: number): LayoutClamp {
  return {
    x: 50,
    y: Math.max(16, Math.min(36, y ?? 24)),
  };
}

/** Main illustration positioned at lower side / bottom of the board */
export function clampIllustrationPosition(x?: number, y?: number): LayoutClamp {
  return {
    x: 50,
    y: Math.max(68, Math.min(85, y ?? 72)),
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

CORE PEDAGOGICAL & VISUAL ALIGNMENT RULES:
1) ILLUSTRATION DERIVED FROM SPEECH & BOARD TEXTS: The technical SVG diagram MUST be specifically created to illustrate the exact concepts, entity relationships, physical/abstract mechanisms, and key points spoken in the speech narrative of THIS board. Do NOT generate generic diagrams!
2) MANDATORY SVG DIAGRAM: Every live tutorial board MUST produce a valid, detailed technical outline SVG diagram in the 'svg_illustration' field matching this exact prompt template.
3) BOARD LAYOUT & VERTICAL ORDERING:
   - Title: Centered at Top (x: 50, y: 8).
   - Bullets / Key Points: Placed on the left side, descending vertically downwards with compact standard line spacing (x: 18, y: 20, y: 25.5, y: 31, y: 36.5).
   - SVG Technical Diagram: Placed on the middle-right or lower zone (x: 65, y: 55 or x: 50, y: 68) so that text bullets and the SVG diagram NEVER overlap or crowd each other.
4) COLOR PALETTE & CONTRAST: Use a restrained professional palette with semantic classes (.fill-accent, .fill-subtle, .path-accent, .path-structural, .path-dashed). On dark chalkboard themes, use bright high-contrast colors (#FFFFFF, #38BDF8, #E2E8F0, #FACC15).
5) LINE WEIGHTS & RESPONSIVENESS: Thin, deliberate strokes (stroke-width: 1.5 to 2) with viewBox="0 0 400 200" and width="100%" height="100%" for crisp responsiveness.
`.trim();

