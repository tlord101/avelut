/**
 * MermaidBoardService.ts
 *
 * Renders Mermaid syntax into high-resolution SVG using Mermaid engine.
 * Applies robust educational SVG normalization for white/light boards.
 * No mock / offline diagram fallbacks.
 */

/** High-contrast palette for white educational whiteboard */
const WHITEBOARD_PALETTE = {
  bg: '#FFFFFF',
  text: '#111827',
  primaryStroke: '#2563EB',
  secondary: '#059669',
  highlight: '#F59E0B',
  warning: '#DC2626',
  lightFill: '#EFF6FF',
  nodeFill: '#F0F9FF',
  edge: '#1E40AF',
};

/**
 * Normalize educational SVG for high contrast on white Excalidraw board.
 * Inspects fill/stroke attributes and style, replaces low-contrast colors.
 */
export function normalizeEducationalSvg(svg: string, options?: { theme?: 'light' | 'dark' }): string {
  if (!svg || !svg.includes('<svg')) return svg;

  const theme = options?.theme ?? 'light';
  const isLight = theme === 'light' || theme === 'base';

  // Target colors for light (white) board
  const textColor = isLight ? WHITEBOARD_PALETTE.text : '#F8FAFC';
  const strokeColor = isLight ? WHITEBOARD_PALETTE.primaryStroke : '#38BDF8';
  const edgeColor = isLight ? WHITEBOARD_PALETTE.edge : '#38BDF8';
  const fillLight = isLight ? WHITEBOARD_PALETTE.lightFill : '#1E293B';
  const nodeFill = isLight ? WHITEBOARD_PALETTE.nodeFill : '#1E293B';

  let out = svg;

  // Inject strong contrast CSS (works with class-based Mermaid output)
  const contrastCss = isLight
    ? `<style type="text/css">
        text, .node text, .mindmap-node text, .label text, tspan {
          fill: ${textColor} !important;
          font-weight: 600 !important;
          stroke: none !important;
        }
        .node rect, .node circle, .node polygon, .node path,
        .mindmap-node rect, .mindmap-node circle, .mindmap-node polygon,
        rect.basic, .cluster rect {
          stroke: ${strokeColor} !important;
          stroke-width: 2px !important;
          fill: ${nodeFill} !important;
        }
        .edgePath path, path.edge, .mindmap-edges path, .flowchart-link,
        line, polyline {
          stroke: ${edgeColor} !important;
          stroke-width: 2.5px !important;
          fill: none !important;
        }
        .arrowheadPath, marker path {
          fill: ${edgeColor} !important;
          stroke: ${edgeColor} !important;
        }
        .label foreignObject div, .label foreignObject span {
          color: ${textColor} !important;
        }
      </style>`
    : `<style type="text/css">
        text, .node text, .mindmap-node text, .label text, tspan {
          fill: #F8FAFC !important;
          font-weight: 600 !important;
        }
        .node rect, .node circle, .node polygon, .node path,
        .mindmap-node rect, .mindmap-node circle, .mindmap-node polygon {
          stroke: #38BDF8 !important;
          stroke-width: 2px !important;
        }
        .edgePath path, path.edge, .mindmap-edges path {
          stroke: #38BDF8 !important;
          stroke-width: 2.5px !important;
        }
      </style>`;

  out = out.replace(/(<svg[^>]*>)/i, `$1${contrastCss}`);

  // Direct attribute normalization for elements that carry inline colors
  // Replace pure white / near-white fills that would disappear on white board
  if (isLight) {
    // fill="white" / fill="#fff" / fill="#ffffff" / fill="#FFF" etc.
    out = out.replace(
      /fill\s*=\s*["'](#fff(?:fff)?|white|#f{3,6}|#e{3,6}|#fafafa|#f8fafc|#ffffff)["']/gi,
      `fill="${nodeFill}"`
    );
    // stroke white on light board → use primary stroke
    out = out.replace(
      /stroke\s*=\s*["'](#fff(?:fff)?|white|#f{3,6}|#ffffff)["']/gi,
      `stroke="${strokeColor}"`
    );
    // style="...fill:white..." etc.
    out = out.replace(/fill\s*:\s*(#fff(?:fff)?|white|#f{3,6}|#ffffff)\b/gi, `fill: ${nodeFill}`);
    out = out.replace(/stroke\s*:\s*(#fff(?:fff)?|white|#f{3,6}|#ffffff)\b/gi, `stroke: ${strokeColor}`);
    // Very light grays that lack contrast
    out = out.replace(
      /fill\s*=\s*["'](#f[0-9a-f]{5}|#e[0-9a-f]{5}|#d[0-9a-f]{5})["']/gi,
      (m) => {
        // Keep intentional light fills but ensure they are not pure white
        if (/#fff|#ffffff|#fafafa|#f8fafc/i.test(m)) return `fill="${nodeFill}"`;
        return m;
      }
    );
  }

  // Ensure stroke-width is visible
  out = out.replace(/stroke-width\s*=\s*["']0(\.0+)?["']/gi, 'stroke-width="2"');
  out = out.replace(/stroke-width\s*:\s*0(\.0+)?\b/gi, 'stroke-width: 2');

  // Remove any remaining transparent or none that might hide structure (conservative)
  // Do not force fill on every path (arrows often use fill=none intentionally)

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
    // Prefer white/light board defaults for classroom visibility
    const bgColorHex = isDark ? '0A0A0A' : 'FFFFFF';
    const textColorHex = isDark ? '#F8FAFC' : '#111827';

    try {
      let codeWithTheme = trimmed;
      if (!codeWithTheme.includes('%%{init')) {
        const themeVars = isDark
          ? `'darkMode': true, 'background': '#0A0A0A', 'primaryColor': '#1E293B', 'primaryTextColor': '#F8FAFC', 'primaryBorderColor': '#38BDF8', 'lineColor': '#38BDF8', 'fontSize': '20px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif'`
          : `'darkMode': false, 'background': '#FFFFFF', 'primaryColor': '#EFF6FF', 'primaryTextColor': '#111827', 'primaryBorderColor': '#2563EB', 'lineColor': '#1E40AF', 'secondaryColor': '#ECFDF5', 'tertiaryColor': '#FEF3C7', 'fontSize': '20px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif'`;
        codeWithTheme = `%%{init: {'theme': '${themeName}', 'themeVariables': { ${themeVars} }}}%%\n${codeWithTheme}`;
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
