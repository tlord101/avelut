/**
 * MermaidBoardService.ts
 *
 * Renders Mermaid syntax into high-resolution SVG using Mermaid engine.
 * No mock / offline diagram fallbacks.
 */

export class MermaidBoardService {
  private static cache = new Map<string, string>();

  /**
   * Fetches an SVG representation of the provided Mermaid code.
   * Renders the authentic Mermaid diagram directly with theme adaptation.
   */
  public static async renderToSvg(mermaidCode: string, theme: 'light' | 'dark' = 'dark'): Promise<string> {
    const trimmed = mermaidCode.trim();
    if (!trimmed) return '';

    const cacheKey = `${theme}:${trimmed}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const isDark = theme === 'dark';
    const themeName = isDark ? 'dark' : 'base';
    const bgColorHex = isDark ? '0A0A0A' : 'F8FAFC';
    const textColorHex = isDark ? '#F8FAFC' : '#0F172A';

    try {
      let codeWithTheme = trimmed;
      if (!codeWithTheme.includes('%%{init')) {
        const themeVars = isDark
          ? `'darkMode': true, 'background': '#0A0A0A', 'primaryColor': '#1E293B', 'primaryTextColor': '#F8FAFC', 'primaryBorderColor': '#38BDF8', 'lineColor': '#38BDF8', 'fontSize': '22px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif'`
          : `'darkMode': false, 'background': '#F8FAFC', 'primaryColor': '#E0F2FE', 'primaryTextColor': '#0F172A', 'primaryBorderColor': '#0284C7', 'lineColor': '#0284C7', 'fontSize': '22px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif'`;
        codeWithTheme = `%%{init: {'theme': '${themeName}', 'themeVariables': { ${themeVars} }}}%%\n${codeWithTheme}`;
      }

      const encoded = btoa(unescape(encodeURIComponent(codeWithTheme)));
      const url = `https://mermaid.ink/svg/${encoded}?bgColor=${bgColorHex}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        let svgString = await response.text();
        if (svgString && svgString.includes('<svg')) {
          // Post-process SVG to guarantee high-contrast readability in both light & dark modes
          const contrastCss = isDark
            ? `<style>
                .mindmap-node text, .node text, text { fill: #F8FAFC !important; font-weight: 700 !important; }
                .mindmap-node rect, .mindmap-node circle, .mindmap-node polygon, .mindmap-node path { stroke: #38BDF8 !important; stroke-width: 2px !important; }
                .mindmap-edges path, .edgePath path, path.edge { stroke: #38BDF8 !important; stroke-width: 2.5px !important; }
              </style>`
            : `<style>
                .mindmap-node text, .node text, text { fill: #0F172A !important; font-weight: 700 !important; }
                .mindmap-node rect, .mindmap-node circle, .mindmap-node polygon, .mindmap-node path { stroke: #1E293B !important; stroke-width: 2px !important; }
                .mindmap-edges path, .edgePath path, path.edge { stroke: #334155 !important; stroke-width: 2.5px !important; }
              </style>`;

          svgString = svgString.replace(/(<svg[^>]*>)/i, `$1${contrastCss}`);
          if (!isDark) {
            svgString = svgString.replace(/fill\s*:\s*(#fff(fff)?|white)/gi, 'fill: #0F172A');
          }

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
