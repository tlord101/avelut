/**
 * LlmSvgObjectCache.ts
 *
 * Handles dynamic LLM-generated object illustrations with a two-layer cache:
 * 1. In-memory Map (fastest)
 * 2. localStorage (persistent across sessions, SSR safe)
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
   * Retrieve an SVG by its cache key, or generate and cache it.
   * 
   * @param cacheKey A unique key describing the requested object (e.g., "red sports car")
   * @param generateFn Async function that calls the LLM to generate the SVG
   */
  public static async getOrGenerate(
    cacheKey: string,
    generateFn: () => Promise<string | null>
  ): Promise<string | null> {
    const key = cacheKey.trim().toLowerCase();

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
      // Backfill memory cache
      this.memoryCache.set(key, svg);
      return svg;
    }

    // Layer 3: Generate
    console.log(`[LlmSvgObjectCache] Missed caches for "${key}". Generating...`);
    const generatedSvg = await generateFn();

    if (generatedSvg && generatedSvg.includes('<svg')) {
      // Store in memory
      this.memoryCache.set(key, generatedSvg);

      // Store persistently
      const updatedData = this.getPersistentCache();
      updatedData[key] = generatedSvg;
      
      // Prevent unbounded growth (limit to 100 items)
      const keys = Object.keys(updatedData);
      if (keys.length > 100) {
        // Remove oldest 10 (assuming object key order roughly corresponds to insertion)
        const keysToRemove = keys.slice(0, 10);
        keysToRemove.forEach(k => delete updatedData[k]);
      }

      this.savePersistentCache(updatedData);
      
      return generatedSvg;
    }

    return null;
  }
}
