/**
 * LlmSvgObjectCache.ts
 *
 * Handles dynamic AI-generated object illustrations with a multi-layer cache:
 * 1. In-memory Map (instant)
 * 2. localStorage (persistent across sessions, SSR safe)
 * 3. Dynamic LLM generation with strict SVG post-processing, validation, and single repair retry.
 */

const STORAGE_KEY = 'avelut_llm_svg_cache';

export interface SvgValidationResult {
  valid: boolean;
  cleanSvg: string | null;
  error: string | null;
}

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
   * Post-process candidate SVG text:
   * 1. Extract first <svg ...></svg> block.
   * 2. Sanitize bare '&' and strip disallowed elements/attributes (script, foreignObject, event handlers, external URLs).
   */
  public static sanitizeSvgCandidate(raw: string): string | null {
    if (!raw || typeof raw !== 'string') return null;

    // 1. Extract first <svg ...></svg> block
    const svgMatch = raw.match(/<svg[\s\S]*?<\/svg>/i);
    let candidate = svgMatch ? svgMatch[0].trim() : null;

    if (!candidate && raw.includes('<svg')) {
      // Handle unclosed or trailing text fallback if <svg is present
      const startIdx = raw.indexOf('<svg');
      candidate = raw.slice(startIdx).trim();
    }

    if (!candidate) return null;

    // 2. Sanitize obvious issues:
    // Bare '&' not part of existing XML entities (&amp;, &lt;, &gt;, &quot;, &apos;, &#123;, &#x1F;) -> &amp;
    candidate = candidate.replace(/&(?!([a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;');

    // Strip disallowed elements: <script> and <foreignObject>
    candidate = candidate.replace(/<script[\s\S]*?<\/script>/gi, '');
    candidate = candidate.replace(/<script[^>]*\/?>/gi, '');
    candidate = candidate.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    candidate = candidate.replace(/<foreignObject[^>]*\/?>/gi, '');

    // Strip event handlers (on* attributes)
    candidate = candidate.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    // Strip external image URLs (http:// or https://) in href/xlink:href
    candidate = candidate.replace(/\s+(?:xlink:)?href\s*=\s*["']https?:\/\/[^"']*["']/gi, '');

    return candidate;
  }

  /**
   * Validate SVG structure and DOM well-formedness.
   */
  public static validateSvg(raw: string): SvgValidationResult {
    const candidate = this.sanitizeSvgCandidate(raw);
    if (!candidate) {
      return {
        valid: false,
        cleanSvg: null,
        error: 'Response was empty or did not contain a valid <svg> block.',
      };
    }

    // Ensure root <svg> present
    if (!/<svg[^>]*>[\s\S]*<\/svg>/i.test(candidate)) {
      return {
        valid: false,
        cleanSvg: candidate,
        error: 'Missing root <svg> or incomplete tag closure.',
      };
    }

    // Validate via DOMParser if running in browser / environment with DOMParser
    if (typeof DOMParser !== 'undefined') {
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(candidate, 'image/svg+xml');

        const parserErr = doc.querySelector('parsererror');
        if (parserErr) {
          const errMsg = parserErr.textContent || 'XML parsing error';
          return {
            valid: false,
            cleanSvg: candidate,
            error: `DOMParser error: ${errMsg}`,
          };
        }

        const rootName = doc.documentElement?.nodeName?.toLowerCase();
        if (rootName !== 'svg') {
          return {
            valid: false,
            cleanSvg: candidate,
            error: `Root element is <${rootName}> instead of <svg>.`,
          };
        }
      } catch (err) {
        return {
          valid: false,
          cleanSvg: candidate,
          error: `DOMParser exception: ${String(err)}`,
        };
      }
    }

    return {
      valid: true,
      cleanSvg: candidate,
      error: null,
    };
  }

  /**
   * Safely truncate text for structured production logging.
   */
  private static truncateLog(str: string, maxLen = 120): string {
    if (!str) return '';
    const clean = str.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? `${clean.slice(0, maxLen)}...` : clean;
  }

  /**
   * Retrieve an SVG by its cache key, or generate dynamically via AI and cache it.
   * Strict 2-pass SVG pipeline: 1st pass -> validate -> (if failed) 1 repair retry -> validate -> cache or return error.
   * NO alternate illustration strategies or visual fallbacks.
   *
   * @param cacheKey Unique key describing requested object
   * @param generateFn Async function for first-pass LLM generation
   * @param repairFn Async function for single repair retry, receiving failed output and error message
   */
  public static async getOrGenerate(
    cacheKey: string,
    generateFn: () => Promise<string | null>,
    repairFn?: (failedOutput: string, errorMsg: string) => Promise<string | null>
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

    // Layer 3: Dynamic LLM Generation (Strict 1st pass + 1 repair retry)
    console.log(`[LlmSvgObjectCache] generate-start for "${key}"`);

    const callWithTimeout = async (
      fn: () => Promise<string | null>,
      timeoutMs = 25000
    ): Promise<{ output: string | null; timedOut: boolean }> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<{ output: string | null; timedOut: boolean }>((resolve) => {
        timer = setTimeout(() => resolve({ output: null, timedOut: true }), timeoutMs);
      });

      try {
        const res = await Promise.race([
          fn().then((out) => ({ output: out, timedOut: false })),
          timeoutPromise,
        ]);
        return res;
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    let firstOutput: string | null = null;
    let firstErrorMsg = '';

    try {
      const firstResult = await callWithTimeout(generateFn, 25000);
      if (firstResult.timedOut) {
        firstErrorMsg = 'First attempt timed out after 25s.';
      } else {
        firstOutput = firstResult.output;
      }

      if (firstOutput) {
        const val = this.validateSvg(firstOutput);
        if (val.valid && val.cleanSvg) {
          console.log(`[LlmSvgObjectCache] insert-complete for "${key}"`);
          this.memoryCache.set(key, val.cleanSvg);
          const updatedData = this.getPersistentCache();
          updatedData[key] = val.cleanSvg;
          this.savePersistentCache(updatedData);
          return val.cleanSvg;
        } else {
          firstErrorMsg = val.error || 'Validation failed on first pass.';
        }
      } else if (!firstErrorMsg) {
        firstErrorMsg = 'First attempt returned empty response.';
      }
    } catch (err) {
      firstErrorMsg = `First attempt exception: ${String(err)}`;
    }

    console.warn(`[LlmSvgObjectCache] parse-fail for "${key}": ${firstErrorMsg}`);

    // If repairFn is provided, execute exactly ONE repair retry pass
    if (repairFn) {
      console.log(`[LlmSvgObjectCache] repair-start for "${key}"`);
      const failedContext = firstOutput || '';

      try {
        let repairOutput: string | null = null;
        let repairErrorMsg = '';

        const repairResult = await callWithTimeout(() => repairFn(failedContext, firstErrorMsg), 25000);
        if (repairResult.timedOut) {
          repairErrorMsg = 'Repair retry timed out after 25s.';
        } else {
          repairOutput = repairResult.output;
        }

        if (repairOutput) {
          const repairVal = this.validateSvg(repairOutput);
          if (repairVal.valid && repairVal.cleanSvg) {
            console.log(`[LlmSvgObjectCache] repair-ok for "${key}"`);
            console.log(`[LlmSvgObjectCache] insert-complete for "${key}"`);
            this.memoryCache.set(key, repairVal.cleanSvg);
            const updatedData = this.getPersistentCache();
            updatedData[key] = repairVal.cleanSvg;
            this.savePersistentCache(updatedData);
            return repairVal.cleanSvg;
          } else {
            repairErrorMsg = repairVal.error || 'Validation failed on repair pass.';
          }
        } else if (!repairErrorMsg) {
          repairErrorMsg = 'Repair retry returned empty response.';
        }

        console.warn(`[LlmSvgObjectCache] repair-fail for "${key}": ${repairErrorMsg}`);
      } catch (repairErr) {
        console.warn(`[LlmSvgObjectCache] repair-fail for "${key}": exception: ${String(repairErr)}`);
      }
    }

    return null;
  }
}
