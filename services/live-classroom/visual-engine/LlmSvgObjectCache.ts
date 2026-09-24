/**
 * LlmSvgObjectCache.ts
 *
 * Handles dynamic LLM-generated object illustrations with a multi-layer cache:
 * 1. In-memory Map (instant)
 * 2. localStorage (persistent across sessions, SSR safe)
 * 3. Race against fast AI inference with a 4-second budget
 * 4. Guaranteed instant scientific fallback SVG so the board NEVER hangs!
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
   * Generates a sleek, dark-themed scientific illustration SVG locally
   * if the LLM generation is slow, times out, or fails.
   */
  public static generateFallbackSvg(description: string): string {
    const desc = description.trim();
    const lower = desc.toLowerCase();
    const isWave = lower.includes('wave') || lower.includes('vibrat') || lower.includes('string') || lower.includes('sound') || lower.includes('node') || lower.includes('frequenc');
    const isCell = lower.includes('cell') || lower.includes('bio') || lower.includes('dna') || lower.includes('organ') || lower.includes('heart');
    const isAtom = lower.includes('atom') || lower.includes('molecul') || lower.includes('chem') || lower.includes('electron');

    const totalW = 520;
    const totalH = 300;

    let centerIllustration = '';

    if (isWave) {
      // Standing wave diagram with nodes and antinodes
      centerIllustration = `
        <defs>
          <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#38BDF8" />
            <stop offset="50%" stop-color="#818CF8" />
            <stop offset="100%" stop-color="#34D399" />
          </linearGradient>
        </defs>
        <!-- Boundary posts / string anchors -->
        <rect x="40" y="80" width="12" height="140" rx="4" fill="#334155" />
        <rect x="468" y="80" width="12" height="140" rx="4" fill="#334155" />
        <line x1="46" y1="150" x2="474" y2="150" stroke="#475569" stroke-width="1.5" stroke-dasharray="4 4" />
        
        <!-- Standing wave upper curve -->
        <path d="M 46 150 Q 153 60, 260 150 T 474 150" fill="none" stroke="url(#waveGrad)" stroke-width="3.5" />
        <!-- Standing wave lower curve (dashed oscillation phase) -->
        <path d="M 46 150 Q 153 240, 260 150 T 474 150" fill="none" stroke="#38BDF8" stroke-width="2" stroke-dasharray="6 4" opacity="0.6" />

        <!-- Nodes (N) -->
        <circle cx="46" cy="150" r="5" fill="#EF4444" />
        <text x="46" y="172" fill="#F87171" font-size="11" font-weight="700" text-anchor="middle" font-family="sans-serif">Node</text>
        <circle cx="260" cy="150" r="5" fill="#EF4444" />
        <text x="260" y="172" fill="#F87171" font-size="11" font-weight="700" text-anchor="middle" font-family="sans-serif">Node</text>
        <circle cx="474" cy="150" r="5" fill="#EF4444" />
        <text x="474" y="172" fill="#F87171" font-size="11" font-weight="700" text-anchor="middle" font-family="sans-serif">Node</text>

        <!-- Antinodes (A) -->
        <circle cx="153" cy="105" r="4" fill="#FBBF24" />
        <text x="153" y="92" fill="#FCD34D" font-size="11" font-weight="700" text-anchor="middle" font-family="sans-serif">Antinode</text>
        <circle cx="367" cy="195" r="4" fill="#FBBF24" />
        <text x="367" y="218" fill="#FCD34D" font-size="11" font-weight="700" text-anchor="middle" font-family="sans-serif">Antinode</text>

        <!-- Wavelength indicator -->
        <line x1="46" y1="245" x2="474" y2="245" stroke="#94A3B8" stroke-width="1.5" />
        <polygon points="46,245 54,241 54,249" fill="#94A3B8" />
        <polygon points="474,245 466,241 466,249" fill="#94A3B8" />
        <text x="260" y="262" fill="#E2E8F0" font-size="12" font-weight="600" text-anchor="middle" font-family="sans-serif">Wavelength λ (L = λ)</text>
      `;
    } else if (isCell) {
      centerIllustration = `
        <ellipse cx="260" cy="150" rx="170" ry="95" fill="#1E293B" stroke="#34D399" stroke-width="3" />
        <ellipse cx="260" cy="150" rx="60" ry="45" fill="#0F766E" stroke="#2DD4BF" stroke-width="2.5" />
        <text x="260" y="154" fill="#FFFFFF" font-size="13" font-weight="700" text-anchor="middle" font-family="sans-serif">Nucleus</text>
        <circle cx="160" cy="130" r="14" fill="#0284C7" />
        <text x="160" y="155" fill="#93C5FD" font-size="10" text-anchor="middle" font-family="sans-serif">Organelle</text>
        <circle cx="355" cy="165" r="12" fill="#D97706" />
        <text x="355" y="190" fill="#FDE68A" font-size="10" text-anchor="middle" font-family="sans-serif">Mitochondria</text>
      `;
    } else if (isAtom) {
      centerIllustration = `
        <circle cx="260" cy="150" r="28" fill="#DC2626" stroke="#EF4444" stroke-width="2" />
        <text x="260" y="155" fill="#FFFFFF" font-size="12" font-weight="700" text-anchor="middle" font-family="sans-serif">Nucleus</text>
        <ellipse cx="260" cy="150" rx="140" ry="50" fill="none" stroke="#38BDF8" stroke-width="2" stroke-dasharray="4 4" transform="rotate(-25 260 150)" />
        <ellipse cx="260" cy="150" rx="140" ry="50" fill="none" stroke="#818CF8" stroke-width="2" stroke-dasharray="4 4" transform="rotate(25 260 150)" />
        <circle cx="140" cy="110" r="6" fill="#38BDF8" />
        <circle cx="380" cy="190" r="6" fill="#818CF8" />
      `;
    } else {
      centerIllustration = `
        <rect x="70" y="100" width="160" height="90" rx="12" fill="#1E293B" stroke="#38BDF8" stroke-width="2" />
        <text x="150" y="145" fill="#F8FAFC" font-size="14" font-weight="600" text-anchor="middle" font-family="sans-serif">Source / Input</text>
        <line x1="230" y1="145" x2="290" y2="145" stroke="#FBBF24" stroke-width="3" marker-end="url(#arrowhead)" />
        <rect x="290" y="100" width="160" height="90" rx="12" fill="#1E293B" stroke="#34D399" stroke-width="2" />
        <text x="370" y="145" fill="#F8FAFC" font-size="14" font-weight="600" text-anchor="middle" font-family="sans-serif">Core Mechanism</text>
      `;
    }

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" height="100%" style="background-color: #090D16; border-radius: 16px;">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#FBBF24" />
          </marker>
        </defs>
        <!-- Header title -->
        <rect x="20" y="16" width="${Math.min(totalW - 40, desc.length * 9 + 28)}" height="28" rx="6" fill="#1E293B" stroke="#38BDF8" stroke-width="1.2" />
        <text x="32" y="35" fill="#38BDF8" font-size="12" font-weight="700" font-family="sans-serif">🔬 ${desc.slice(0, 50)}</text>
        ${centerIllustration}
      </svg>
    `.trim();
  }

  /**
   * Retrieve an SVG by its cache key, or generate and cache it.
   * Runs AI inference with a 4s budget and falls back to an instant scientific SVG.
   * 
   * @param cacheKey A unique key describing the requested object (e.g., "vibrating guitar string")
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
      this.memoryCache.set(key, svg);
      return svg;
    }

    // Layer 3: Generate with 4s timeout & instant fallback
    console.log(`[LlmSvgObjectCache] Missed caches for "${key}". Generating...`);
    try {
      const fetchPromise = generateFn();
      const timeoutPromise = new Promise<string | null>((resolve) =>
        setTimeout(() => resolve(null), 4000)
      );

      const generatedSvg = await Promise.race([fetchPromise, timeoutPromise]);
      if (generatedSvg && generatedSvg.includes('<svg')) {
        this.memoryCache.set(key, generatedSvg);
        const updatedData = this.getPersistentCache();
        updatedData[key] = generatedSvg;
        this.savePersistentCache(updatedData);
        return generatedSvg;
      }
    } catch (err) {
      console.warn('[LlmSvgObjectCache] Error or timeout generating SVG:', err);
    }

    // Layer 4: Guaranteed instant scientific fallback SVG
    console.log(`[LlmSvgObjectCache] Rendering instant scientific illustration for "${key}"`);
    const fallbackSvg = this.generateFallbackSvg(cacheKey);
    this.memoryCache.set(key, fallbackSvg);
    return fallbackSvg;
  }
}
