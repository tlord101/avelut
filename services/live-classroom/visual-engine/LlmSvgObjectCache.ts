/**
 * LlmSvgObjectCache.ts
 *
 * Handles dynamic AI-generated object illustrations with a multi-layer cache:
 * 1. In-memory Map (instant)
 * 2. localStorage (persistent across sessions, SSR safe)
 * 3. Dynamic LLM generation with strict SVG post-processing, validation, and single repair retry.
 */

const STORAGE_KEY = 'avelut_llm_svg_cache_v2';
const MAX_SVG_SIZE_BYTES = 150 * 1024; // 150 KB

export type SvgErrorCode =
  | 'EMPTY_RESPONSE'
  | 'NO_SVG_ROOT'
  | 'TRUNCATED_SVG'
  | 'MALFORMED_XML'
  | 'PARSER_ERROR'
  | 'UNSAFE_SVG'
  | 'SVG_TOO_LARGE'
  | 'INVALID_ROOT'
  | 'REPAIR_FAILED'
  | 'GENERATION_TIMEOUT';

export interface SvgValidationResult {
  valid: boolean;
  cleanSvg: string | null;
  error: string | null;
  errorCode?: SvgErrorCode | null;
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
   * Remove a single cache entry from memory and persistent storage
   */
  public static clearCacheEntry(cacheKey: string): void {
    const key = cacheKey.trim().toLowerCase();
    if (!key) return;
    this.memoryCache.delete(key);
    const persistentData = this.getPersistentCache();
    if (persistentData[key]) {
      delete persistentData[key];
      this.savePersistentCache(persistentData);
    }
  }

  /**
   * Check if container tags inside SVG markup are unclosed
   */
  private static hasUnclosedContainerTags(str: string): boolean {
    const containerTags = ['g', 'defs', 'symbol', 'style', 'text', 'marker', 'pattern', 'clipPath', 'mask', 'linearGradient', 'radialGradient'];
    for (const tag of containerTags) {
      const openCount = (str.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
      const closeCount = (str.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
      if (openCount > closeCount) return true;
    }
    return false;
  }

  /**
   * Post-process candidate SVG text:
   * 1. Remove Markdown code fences and surrounding text outside root <svg>...</svg>.
   * 2. Unescape JSON string wrapping if present.
   * 3. Handle unclosed root <svg> tags with deterministic recovery if safe.
   * 4. Sanitize bare '&' and strip disallowed elements/attributes (script, foreignObject, event handlers, external URLs).
   */
  public static sanitizeSvgCandidate(raw: string): string | null {
    if (!raw || typeof raw !== 'string') return null;

    let text = raw.trim();
    if (!text) return null;

    // Unescape JSON wrapped string or escaped quotes if raw was passed stringified
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      try {
        const unquoted = JSON.parse(text);
        if (typeof unquoted === 'string') text = unquoted;
      } catch {
        text = text.slice(1, -1);
      }
    }

    // Strip markdown code fences (```xml, ```svg, ```)
    text = text.replace(/```(?:xml|svg)?/gi, '').replace(/```/g, '').trim();

    // Locate first <svg
    const svgStartIdx = text.search(/<svg[\s>]/i);
    if (svgStartIdx === -1) return null;

    let candidate = text.slice(svgStartIdx).trim();

    // Find closing </svg>
    const svgEndIdx = candidate.search(/<\/svg>/i);
    if (svgEndIdx !== -1) {
      // Extract from <svg to </svg>
      candidate = candidate.slice(0, svgEndIdx + 6).trim();
    } else {
      // Missing closing </svg>. Safe recovery: append </svg> so parser can process
      candidate = `${candidate}\n</svg>`;
    }

    // Sanitize bare '&' not part of existing XML entities (&amp;, &lt;, &gt;, &quot;, &apos;, &#123;, &#x1F;) -> &amp;
    candidate = candidate.replace(/&(?!([a-zA-Z0-9]+|#[0-9]+|#x[0-9a-fA-F]+);)/g, '&amp;');

    // Strip disallowed elements: <script> and <foreignObject>
    candidate = candidate.replace(/<script[\s\S]*?<\/script>/gi, '');
    candidate = candidate.replace(/<script[^>]*\/?>/gi, '');
    candidate = candidate.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    candidate = candidate.replace(/<foreignObject[^>]*\/?>/gi, '');

    // Strip event handlers (on* attributes)
    candidate = candidate.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

    // Strip external image/resource URLs (http:// or https://) in href/xlink:href/src/url(...)
    candidate = candidate.replace(/\s+(?:xlink:)?href\s*=\s*["']https?:\/\/[^"']*["']/gi, '');
    candidate = candidate.replace(/\s+src\s*=\s*["']https?:\/\/[^"']*["']/gi, '');
    candidate = candidate.replace(/url\(['"]?https?:\/\/[^'"]*['"]?\)/gi, 'none');

    return candidate;
  }

  /**
   * Validate SVG structure and DOM well-formedness.
   */
  public static validateSvg(raw: string): SvgValidationResult {
    if (!raw || typeof raw !== 'string' || !raw.trim()) {
      return {
        valid: false,
        cleanSvg: null,
        error: 'Response was empty.',
        errorCode: 'EMPTY_RESPONSE',
      };
    }

    if (raw.length > MAX_SVG_SIZE_BYTES) {
      return {
        valid: false,
        cleanSvg: null,
        error: `SVG payload exceeds maximum size limit (${Math.round(MAX_SVG_SIZE_BYTES / 1024)} KB).`,
        errorCode: 'SVG_TOO_LARGE',
      };
    }

    const candidate = this.sanitizeSvgCandidate(raw);
    if (!candidate) {
      return {
        valid: false,
        cleanSvg: null,
        error: 'Response did not contain a valid <svg> root tag.',
        errorCode: 'NO_SVG_ROOT',
      };
    }

    // Check size of normalized candidate
    if (candidate.length > MAX_SVG_SIZE_BYTES) {
      return {
        valid: false,
        cleanSvg: candidate,
        error: `Normalized SVG candidate exceeds maximum size limit (${Math.round(MAX_SVG_SIZE_BYTES / 1024)} KB).`,
        errorCode: 'SVG_TOO_LARGE',
      };
    }

    // Ensure root <svg> tag is present
    if (!/<svg[^>]*>[\s\S]*<\/svg>/i.test(candidate)) {
      const isTruncated = raw.toLowerCase().includes('<svg') && !raw.toLowerCase().includes('</svg>');
      return {
        valid: false,
        cleanSvg: candidate,
        error: isTruncated ? 'SVG response was truncated before closing </svg>.' : 'Missing root <svg> or incomplete tag closure.',
        errorCode: isTruncated ? 'TRUNCATED_SVG' : 'NO_SVG_ROOT',
      };
    }

    // Reject if nested container tags are unclosed
    if (this.hasUnclosedContainerTags(candidate)) {
      return {
        valid: false,
        cleanSvg: candidate,
        error: 'SVG contains unclosed container tags (e.g. <g> or <text>).',
        errorCode: 'TRUNCATED_SVG',
      };
    }

    // Check for remaining forbidden script/foreignObject tags
    if (/<script[\s>]/i.test(candidate) || /<foreignObject[\s>]/i.test(candidate) || /\son[a-z]+\s*=/i.test(candidate)) {
      return {
        valid: false,
        cleanSvg: candidate,
        error: 'SVG contains forbidden elements or event handlers.',
        errorCode: 'UNSAFE_SVG',
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
          const isTruncated = !raw.toLowerCase().includes('</svg>') || errMsg.toLowerCase().includes('unclosed') || errMsg.toLowerCase().includes('unexpected end');
          return {
            valid: false,
            cleanSvg: candidate,
            error: `DOMParser error: ${errMsg}`,
            errorCode: isTruncated ? 'TRUNCATED_SVG' : 'PARSER_ERROR',
          };
        }

        const rootName = doc.documentElement?.nodeName?.toLowerCase();
        if (rootName !== 'svg') {
          return {
            valid: false,
            cleanSvg: candidate,
            error: `Root element is <${rootName}> instead of <svg>.`,
            errorCode: 'INVALID_ROOT',
          };
        }

        // Ensure root element has usable dimensions or viewBox
        const rootEl = doc.documentElement;
        const hasViewBox = rootEl.hasAttribute('viewBox');
        const hasWidth = rootEl.hasAttribute('width');
        const hasHeight = rootEl.hasAttribute('height');

        if (!hasViewBox && (!hasWidth || !hasHeight)) {
          // Add default viewBox="0 0 800 500" if missing
          const viewBoxCandidate = candidate.replace(/<svg\b/i, '<svg viewBox="0 0 800 500" ');
          return {
            valid: true,
            cleanSvg: viewBoxCandidate,
            error: null,
          };
        }
      } catch (err) {
        return {
          valid: false,
          cleanSvg: candidate,
          error: `DOMParser exception: ${String(err)}`,
          errorCode: 'PARSER_ERROR',
        };
      }
    } else {
      // Fallback structural check when DOMParser is unavailable (e.g. Node SSR)
      const unclosedBrackets = (candidate.match(/</g) || []).length !== (candidate.match(/>/g) || []).length;
      if (unclosedBrackets) {
        return {
          valid: false,
          cleanSvg: candidate,
          error: 'XML brackets are unbalanced.',
          errorCode: 'MALFORMED_XML',
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

    // Layer 1: Memory Cache with validation guard
    if (this.memoryCache.has(key)) {
      const cachedSvg = this.memoryCache.get(key)!;
      const val = this.validateSvg(cachedSvg);
      if (val.valid && val.cleanSvg) {
        console.log(`[LlmSvgObjectCache] cache-hit memory key="${key}"`);
        return val.cleanSvg;
      }
      console.warn(`[LlmSvgObjectCache] cache-invalidated memory key="${key}" reason=${val.errorCode || 'INVALID'}`);
      this.memoryCache.delete(key);
    }

    // Layer 2: Persistent localStorage Cache with validation guard
    const persistentData = this.getPersistentCache();
    if (persistentData[key]) {
      const cachedSvg = persistentData[key];
      const val = this.validateSvg(cachedSvg);
      if (val.valid && val.cleanSvg) {
        console.log(`[LlmSvgObjectCache] cache-hit persistent key="${key}"`);
        this.memoryCache.set(key, val.cleanSvg);
        return val.cleanSvg;
      }
      console.warn(`[LlmSvgObjectCache] cache-invalidated persistent key="${key}" reason=${val.errorCode || 'INVALID'}`);
      delete persistentData[key];
      this.savePersistentCache(persistentData);
    }

    // Layer 3: Dynamic LLM Generation (Strict 1st pass + 1 repair retry)
    console.log(`[LlmSvgObjectCache] generate-start key="${key}"`);

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
    let firstErrorCode: SvgErrorCode = 'EMPTY_RESPONSE';

    try {
      const firstResult = await callWithTimeout(generateFn, 25000);
      if (firstResult.timedOut) {
        firstErrorMsg = 'First attempt timed out after 25s.';
        firstErrorCode = 'GENERATION_TIMEOUT';
      } else {
        firstOutput = firstResult.output;
      }

      if (firstOutput) {
        const val = this.validateSvg(firstOutput);
        if (val.valid && val.cleanSvg) {
          console.log(`[LlmSvgObjectCache] insert-complete key="${key}" length=${val.cleanSvg.length}`);
          this.memoryCache.set(key, val.cleanSvg);
          const updatedData = this.getPersistentCache();
          updatedData[key] = val.cleanSvg;
          this.savePersistentCache(updatedData);
          return val.cleanSvg;
        } else {
          firstErrorMsg = val.error || 'Validation failed on first pass.';
          firstErrorCode = val.errorCode || 'PARSER_ERROR';
        }
      } else if (!firstErrorMsg) {
        firstErrorMsg = 'First attempt returned empty response.';
        firstErrorCode = 'EMPTY_RESPONSE';
      }
    } catch (err) {
      firstErrorMsg = `First attempt exception: ${String(err)}`;
      firstErrorCode = 'PARSER_ERROR';
    }

    console.warn(`[LlmSvgObjectCache] validation-failed key="${key}" attempt=1 reason=${firstErrorCode} len=${firstOutput?.length || 0}`);

    // If repairFn is provided, execute exactly ONE repair retry pass
    if (repairFn) {
      console.log(`[LlmSvgObjectCache] repair-start key="${key}"`);
      const failedContext = firstOutput || '';

      try {
        let repairOutput: string | null = null;
        let repairErrorMsg = '';
        let repairErrorCode: SvgErrorCode = 'REPAIR_FAILED';

        const repairResult = await callWithTimeout(() => repairFn(failedContext, `${firstErrorCode}: ${firstErrorMsg}`), 25000);
        if (repairResult.timedOut) {
          repairErrorMsg = 'Repair retry timed out after 25s.';
          repairErrorCode = 'GENERATION_TIMEOUT';
        } else {
          repairOutput = repairResult.output;
        }

        if (repairOutput) {
          const repairVal = this.validateSvg(repairOutput);
          if (repairVal.valid && repairVal.cleanSvg) {
            console.log(`[LlmSvgObjectCache] repair-ok key="${key}" length=${repairVal.cleanSvg.length}`);
            console.log(`[LlmSvgObjectCache] insert-complete key="${key}"`);
            this.memoryCache.set(key, repairVal.cleanSvg);
            const updatedData = this.getPersistentCache();
            updatedData[key] = repairVal.cleanSvg;
            this.savePersistentCache(updatedData);
            return repairVal.cleanSvg;
          } else {
            repairErrorMsg = repairVal.error || 'Validation failed on repair pass.';
            repairErrorCode = repairVal.errorCode || 'REPAIR_FAILED';
          }
        } else if (!repairErrorMsg) {
          repairErrorMsg = 'Repair retry returned empty response.';
          repairErrorCode = 'EMPTY_RESPONSE';
        }

        console.warn(`[LlmSvgObjectCache] repair-fail key="${key}" reason=${repairErrorCode} len=${repairOutput?.length || 0}`);
      } catch (repairErr) {
        console.warn(`[LlmSvgObjectCache] repair-fail key="${key}" exception: ${String(repairErr)}`);
      }
    }

    return null;
  }
}
