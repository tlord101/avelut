/**
 * MermaidBoardService.ts
 *
 * Renders Mermaid syntax into high-resolution SVG using Mermaid engine.
 * Applies robust educational SVG normalization for high-contrast visibility.
 * Ensures all diagram text, nodes, branches, and connecting lines are sharp,
 * bold, and clearly readable on both light and dark educational boards.
 */

/** High-contrast palette for white/light educational whiteboard */
const WHITEBOARD_PALETTE = {
  bg: '#FFFFFF',
  text: '#0F172A',
  primaryStroke: '#2563EB',
  secondaryStroke: '#059669',
  highlightStroke: '#D97706',
  pinkStroke: '#DB2777',
  purpleStroke: '#7C3AED',
  lightFill: '#EFF6FF',
  nodeFill: '#F0F9FF',
  edge: '#1E40AF',
};

/** High-contrast palette for dark educational board */
const DARK_PALETTE = {
  bg: '#0A0A0A',
  text: '#FFFFFF',
  primaryStroke: '#38BDF8',
  secondaryStroke: '#34D399',
  highlightStroke: '#FBBF24',
  pinkStroke: '#F472B6',
  purpleStroke: '#A78BFA',
  lightFill: '#1E293B',
  nodeFill: '#1E293B',
  edge: '#38BDF8',
};

/**
 * Normalize educational SVG for high contrast on the Excalidraw board.
 * Inspects fill/stroke attributes and style, replaces low-contrast colors.
 */
export function normalizeEducationalSvg(svg: string, options?: { theme?: 'light' | 'dark' }): string {
  if (!svg || !svg.includes('<svg')) return svg;

  const theme = options?.theme ?? 'light';
  const isDark = theme === 'dark';
  const isLight = !isDark;

  const pal = isDark ? DARK_PALETTE : WHITEBOARD_PALETTE;
  const textColor = pal.text;
  const strokeColor = pal.primaryStroke;
  const edgeColor = pal.edge;
  const nodeFill = pal.nodeFill;

  let out = svg;

  // Powerful contrast CSS targeting all text elements, shapes, branches, and connecting lines
  const contrastCss = `
    <style type="text/css">
      /* 1. All text elements must be crisp, high-contrast, bold, and fully opaque */
      text, tspan, foreignObject, foreignObject div, foreignObject span, foreignObject p,
      .mindmap-node text, .mindmap-node foreignObject, .mindmap-node span, .mindmap-node div,
      .mindmap-node-label, .node text, .node-label, .node-label span,
      .label, .label text, .label span, .label div, .label foreignObject,
      .cluster text, .edgeLabel text, .edgeLabel span {
        fill: ${textColor} !important;
        color: ${textColor} !important;
        -webkit-text-fill-color: ${textColor} !important;
        font-weight: 700 !important;
        font-size: 15px !important;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
        stroke: none !important;
        text-shadow: none !important;
        opacity: 1 !important;
      }

      /* 2. Mindmap nodes & shapes: strong visible borders and clean solid fills */
      .node rect, .node circle, .node polygon, .node path,
      .mindmap-node rect, .mindmap-node circle, .mindmap-node polygon,
      .node-bkg, .mindmap-node path, rect.basic, .cluster rect, .mindmap-node .node-bkg {
        stroke-width: 2.5px !important;
        opacity: 1 !important;
      }

      /* 3. Connecting branches & edges: thick and high-contrast */
      .edgePath path, path.edge, .mindmap-edges path, .flowchart-link,
      .edge, path.flowchart-link, line, polyline {
        stroke: ${edgeColor} !important;
        stroke-width: 2.5px !important;
        opacity: 1 !important;
        fill: none !important;
      }

      /* 4. Arrow markers */
      .arrowheadPath, marker path {
        fill: ${edgeColor} !important;
        stroke: ${edgeColor} !important;
      }
    </style>
  `;

  // Inject CSS right before </svg> closing tag for maximum cascade specificity, and after <svg> opening
  out = out.replace(/(<svg[^>]*>)/i, `$1${contrastCss}`);
  if (out.includes('</svg>')) {
    out = out.replace('</svg>', `${contrastCss}</svg>`);
  }

  // Direct attribute normalization for elements carrying inline low-contrast colors
  if (isLight) {
    // On a light board: replace white / near-white text fills with bold dark slate
    out = out.replace(
      /(<text[^>]*\bfill\s*=\s*["'])(#fff(?:fff)?|white|#f{3,6}|#e{3,6}|#fafafa|#f8fafc|#ffffff)(["'][^>]*>)/gi,
      `$1${textColor}$3`
    );
    out = out.replace(
      /(<tspan[^>]*\bfill\s*=\s*["'])(#fff(?:fff)?|white|#f{3,6}|#e{3,6}|#fafafa|#f8fafc|#ffffff)(["'][^>]*>)/gi,
      `$1${textColor}$3`
    );
    // Replace inline styles on text/spans
    out = out.replace(/color\s*:\s*(#fff(?:fff)?|white|#f{3,6}|#ffffff)\b/gi, `color: ${textColor}`);
    out = out.replace(/fill\s*:\s*(#fff(?:fff)?|white|#f{3,6}|#ffffff)\b/gi, `fill: ${textColor}`);

    // If a node background has near-white fill, ensure it has a visible border
    out = out.replace(
      /(<path[^>]*class=["'][^"']*node-bkg[^"']*["'][^>]*\bfill\s*=\s*["'])(#fff(?:fff)?|white|#f{3,6}|#ffffff)(["'])/gi,
      `$1${nodeFill}$3 stroke="${strokeColor}" stroke-width="2.5"`
    );
    out = out.replace(
      /(<rect[^>]*class=["'][^"']*node-bkg[^"']*["'][^>]*\bfill\s*=\s*["'])(#fff(?:fff)?|white|#f{3,6}|#ffffff)(["'])/gi,
      `$1${nodeFill}$3 stroke="${strokeColor}" stroke-width="2.5"`
    );
  } else {
    // On a dark board: replace dark / black text fills with bright white
    out = out.replace(
      /(<text[^>]*\bfill\s*=\s*["'])(#000(?:000)?|black|#111827|#0f172a|#1e1e1e)(["'][^>]*>)/gi,
      `$1${textColor}$3`
    );
    out = out.replace(
      /(<tspan[^>]*\bfill\s*=\s*["'])(#000(?:000)?|black|#111827|#0f172a|#1e1e1e)(["'][^>]*>)/gi,
      `$1${textColor}$3`
    );
    out = out.replace(/color\s*:\s*(#000(?:000)?|black|#111827|#0f172a|#1e1e1e)\b/gi, `color: ${textColor}`);
    out = out.replace(/fill\s*:\s*(#000(?:000)?|black|#111827|#0f172a|#1e1e1e)\b/gi, `fill: ${textColor}`);
  }

  // Ensure stroke-width is visible across all paths
  out = out.replace(/stroke-width\s*=\s*["']0(\.0+)?["']/gi, 'stroke-width="2.5"');
  out = out.replace(/stroke-width\s*:\s*0(\.0+)?\b/gi, 'stroke-width: 2.5');

  return out;
}

export class MermaidBoardService {
  private static cache = new Map<string, string>();

  /**
   * Fetches an SVG representation of the provided Mermaid code.
   * Renders the authentic Mermaid diagram and normalizes contrast for the board.
   * Awaits full render before returning — never reports success early.
   */
  public static async renderToSvg(mermaidCode: string, theme: 'light' | 'dark' = 'light'): Promise<string> {
    const trimmed = mermaidCode.trim();
    if (!trimmed) return '';

    const cacheKey = `${theme}:${trimmed}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const isDark = theme === 'dark';
    const themeName = isDark ? 'dark' : 'base';
    const bgColorHex = isDark ? '0A0A0A' : 'FFFFFF';

    try {
      let codeWithTheme = trimmed;
      if (!codeWithTheme.includes('%%{init')) {
        // High-contrast theme variables tailored for either dark or light board
        const baseThemeVars = isDark
          ? `'darkMode': true, 'background': '#0A0A0A', 'primaryColor': '#1E293B', 'primaryTextColor': '#FFFFFF', 'primaryBorderColor': '#38BDF8', 'lineColor': '#38BDF8', 'secondaryColor': '#064E3B', 'tertiaryColor': '#78350F', 'fontSize': '18px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif'`
          : `'darkMode': false, 'background': '#FFFFFF', 'primaryColor': '#EFF6FF', 'primaryTextColor': '#0F172A', 'primaryBorderColor': '#2563EB', 'lineColor': '#1E40AF', 'secondaryColor': '#ECFDF5', 'tertiaryColor': '#FEF3C7', 'fontSize': '18px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif'`;

        // Explicit section colors for mindmap branches to guarantee contrast and distinct visibility
        const mindmapThemeVars = isDark
          ? `'mindmapTextColor': '#FFFFFF', 'nodeTextColor': '#FFFFFF', 'sectionTextColor-0': '#FFFFFF', 'sectionTextColor-1': '#FFFFFF', 'sectionTextColor-2': '#FFFFFF', 'sectionTextColor-3': '#FFFFFF', 'sectionTextColor-4': '#FFFFFF', 'sectionColor-0': '#1E293B', 'sectionColor-1': '#064E3B', 'sectionColor-2': '#78350F', 'sectionColor-3': '#831843', 'sectionColor-4': '#4C1D95', 'sectionBorderColor-0': '#38BDF8', 'sectionBorderColor-1': '#34D399', 'sectionBorderColor-2': '#FBBF24', 'sectionBorderColor-3': '#F472B6', 'sectionBorderColor-4': '#A78BFA'`
          : `'mindmapTextColor': '#0F172A', 'nodeTextColor': '#0F172A', 'sectionTextColor-0': '#0F172A', 'sectionTextColor-1': '#0F172A', 'sectionTextColor-2': '#0F172A', 'sectionTextColor-3': '#0F172A', 'sectionTextColor-4': '#0F172A', 'sectionColor-0': '#EFF6FF', 'sectionColor-1': '#ECFDF5', 'sectionColor-2': '#FEF3C7', 'sectionColor-3': '#FDF2F8', 'sectionColor-4': '#F5F3FF', 'sectionBorderColor-0': '#2563EB', 'sectionBorderColor-1': '#059669', 'sectionBorderColor-2': '#D97706', 'sectionBorderColor-3': '#DB2777', 'sectionBorderColor-4': '#7C3AED'`;

        // Crucial: htmlLabels: false forces Mermaid to generate native SVG <text> instead of <foreignObject><div>
        codeWithTheme = `%%{init: {'theme': '${themeName}', 'themeVariables': { ${baseThemeVars}, ${mindmapThemeVars} }, 'mindmap': { 'htmlLabels': false }, 'flowchart': { 'htmlLabels': false }}}%%\n${codeWithTheme}`;
      }

      const encoded = btoa(unescape(encodeURIComponent(codeWithTheme)));
      const url = `https://mermaid.ink/svg/${encoded}?bgColor=${bgColorHex}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        let svgString = await response.text();
        if (svgString && svgString.includes('<svg')) {
          // Centralized high-contrast normalization
          svgString = normalizeEducationalSvg(svgString, { theme: isDark ? 'dark' : 'light' });
          this.cache.set(cacheKey, svgString);
          return svgString;
        }
      } else {
        console.warn(`[MermaidBoardService] Mermaid API returned HTTP ${response.status}`);
      }
    } catch (err) {
      console.warn('[MermaidBoardService] Failed to render Mermaid SVG:', err);
    }

    return '';
  }
}

export const mermaidBoardService = new MermaidBoardService();
