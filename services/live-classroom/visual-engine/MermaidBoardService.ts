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
    const themeName = isDark ? 'dark' : 'default';
    const bgColorHex = isDark ? '0A0A0A' : 'F8FAFC';
    const textColorHex = isDark ? '#F8FAFC' : '#0F172A';

    try {
      let codeWithTheme = trimmed;
      if (!codeWithTheme.includes('%%{init')) {
        codeWithTheme = `%%{init: {'theme': '${themeName}', 'themeVariables': { 'darkMode': ${isDark}, 'background': '#${bgColorHex}', 'primaryTextColor': '${textColorHex}', 'fontSize': '20px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif' }}}%%\n${codeWithTheme}`;
      }

      const encoded = btoa(unescape(encodeURIComponent(codeWithTheme)));
      const url = `https://mermaid.ink/svg/${encoded}?bgColor=${bgColorHex}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const svgString = await response.text();
        if (svgString && svgString.includes('<svg')) {
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
