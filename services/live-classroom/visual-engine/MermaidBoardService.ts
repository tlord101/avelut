/**
 * MermaidBoardService.ts
 *
 * Renders Mermaid syntax into SVG using the mermaid.ink API.
 * Includes dark theme support and in-memory caching.
 */

export class MermaidBoardService {
  private static cache = new Map<string, string>();

  /**
   * Fetches an SVG representation of the provided Mermaid code.
   * Returns a clean, dark-themed SVG string.
   */
  public static async renderToSvg(mermaidCode: string): Promise<string> {
    const trimmed = mermaidCode.trim();
    if (!trimmed) return '';

    if (this.cache.has(trimmed)) {
      return this.cache.get(trimmed)!;
    }

    try {
      // Force dark theme with clear, readable typography
      let codeWithTheme = trimmed;
      if (!codeWithTheme.includes('%%{init')) {
        codeWithTheme = `%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true, 'background': '#0A0A0A', 'fontSize': '22px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif' }}}%%\n${codeWithTheme}`;
      }

      // Convert to base64 for mermaid.ink
      const encoded = btoa(unescape(encodeURIComponent(codeWithTheme)));

      const url = `https://mermaid.ink/svg/${encoded}?bgColor=0A0A0A`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Mermaid rendering failed with status: ${response.status}`);
      }

      const svgString = await response.text();
      
      // Basic validation to ensure we got an SVG back
      if (svgString && svgString.includes('<svg')) {
        this.cache.set(trimmed, svgString);
        return svgString;
      }
      
      throw new Error('Received invalid SVG content from Mermaid API');
    } catch (err) {
      console.error('[MermaidBoardService] Error rendering Mermaid SVG:', err);
      return '';
    }
  }
}

export const mermaidBoardService = new MermaidBoardService();
