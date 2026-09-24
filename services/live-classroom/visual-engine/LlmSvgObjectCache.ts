/**
 * LlmSvgObjectCache.ts
 *
 * Handles dynamic AI-generated object illustrations with a multi-layer cache:
 * 1. In-memory Map (instant)
 * 2. localStorage (persistent across sessions, SSR safe)
 * 3. Dynamic LLM generation with generous budget (100% genuine AI, no fake fallbacks)
 */

const STORAGE_KEY = 'avelut_llm_svg_cache';

export class LlmSvgObjectCache {
  private static memoryCache = new Map<string, string>();

  /**
   * Safe retrieval from localStorage for SSR compatibility
   */
  private static getPersistentCache(): Record<string, string> {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {};
    }
    try {
      const data = window.localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : {};
    } catch (err) {
      console.warn('[LlmSvgObjectCache] Failed to read from localStorage:', err);
      return {};
    }
  }

  /**
   * Safe save to localStorage for SSR compatibility
   */
  private static savePersistentCache(data: Record<string, string>): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('[LlmSvgObjectCache] Failed to write to localStorage:', err);
    }
  }

  /**
   * Retrieve an SVG by its cache key, or generate dynamically via AI and cache it.
   * Pure AI generation with NO synthetic fallbacks.
   * 
   * @param cacheKey A unique key describing the requested object (e.g., "vibrating guitar string")
   * @param generateFn Async function that calls the LLM to generate the SVG
   */
  public static async getOrGenerate(
    cacheKey: string,
    generateFn: () => Promise<string | null>
  ): Promise<string | null> {
    const key = cacheKey.trim().toLowerCase();
    if (!key) return null;

    // Layer 1: Memory Cache
    if (this.memoryCache.has(key)) {
      console.log(`[LlmSvgObjectCache] Hit memory cache for "${key}"`);
      return this.memoryCache.get(key)!;
    }

    // Layer 2: Persistent localStorage Cache
    const persistentData = this.getPersistentCache();
    if (persistentData[key]) {
      console.log(`[LlmSvgObjectCache] Hit persistent cache for "${key}"`);
      const svg = persistentData[key];
      this.memoryCache.set(key, svg);
      return svg;
    }

    // Layer 3: Dynamic LLM Generation (no artificial 4s timeout or fake fallbacks)
    console.log(`[LlmSvgObjectCache] Missed caches for "${key}". Generating dynamically via AI...`);
    try {
      const fetchPromise = generateFn();
      const timeoutPromise = new Promise<string | null>((resolve) =>
        setTimeout(() => resolve(null), 25000)
      );

      const raw = await Promise.race([fetchPromise, timeoutPromise]);
      if (!raw || typeof raw !== 'string') {
        console.warn(`[LlmSvgObjectCache] AI generation returned empty result for "${key}"`);
        return null;
      }

      // Extract valid <svg> block, removing any markdown codeblocks if present
      const svgMatch = raw.match(/<svg[\s\S]*?<\/svg>/i);
      const cleanSvg = svgMatch ? svgMatch[0] : (raw.includes('<svg') ? raw.trim() : null);

      if (!cleanSvg) {
        console.warn(`[LlmSvgObjectCache] Response does not contain valid SVG for "${key}"`);
        return null;
      }

      // Validate well-formedness if running in browser
      if (typeof DOMParser !== 'undefined') {
        const doc = new DOMParser().parseFromString(cleanSvg, 'image/svg+xml');
        const parserErr = doc.querySelector('parsererror');
        if (parserErr) {
          console.warn(`[LlmSvgObjectCache] SVG parser error for "${key}":`, parserErr.textContent);
          return null;
        }
      }

      this.memoryCache.set(key, cleanSvg);
      const updatedData = this.getPersistentCache();
      updatedData[key] = cleanSvg;
      this.savePersistentCache(updatedData);
      console.log(`[LlmSvgObjectCache] AI illustration successfully generated and cached for "${key}"`);
      return cleanSvg;
    } catch (err) {
      console.warn(`[LlmSvgObjectCache] Error generating dynamic SVG for "${key}":`, err);
      return null;
    }
  }
}
