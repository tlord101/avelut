import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LlmSvgObjectCache } from '../LlmSvgObjectCache';

// Mock minimal DOMParser for Node environment
if (typeof globalThis.DOMParser === 'undefined') {
  class MockDOMParser {
    parseFromString(str: string, mimeType: string) {
      const isXml = mimeType === 'image/svg+xml' || mimeType.includes('xml');

      // Check for unclosed tags or syntax errors
      const hasParserError = str.includes('<script') === false && (
        str.includes('parsererror') ||
        (str.match(/</g) || []).length !== (str.match(/>/g) || []).length
      );

      const mockDoc = {
        querySelector: (selector: string) => {
          if (selector === 'parsererror' && hasParserError) {
            return { textContent: 'XML parsing error' };
          }
          return null;
        },
        documentElement: {
          nodeName: 'svg',
          hasAttribute: (attr: string) => {
            if (attr === 'viewBox') return str.includes('viewBox');
            if (attr === 'width') return str.includes('width=');
            if (attr === 'height') return str.includes('height=');
            return false;
          },
        },
      };
      return mockDoc;
    }
  }
  (globalThis as any).DOMParser = MockDOMParser;
}

// Mock window and localStorage
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, val: string) => { mockStorage[key] = val; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => {
    for (const k of Object.keys(mockStorage)) {
      delete mockStorage[k];
    }
  },
};

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    localStorage: mockLocalStorage,
  };
} else if (!globalThis.window.localStorage) {
  (globalThis as any).window.localStorage = mockLocalStorage;
}

describe('LlmSvgObjectCache Regression Tests', () => {
  beforeEach(() => {
    LlmSvgObjectCache.clearCacheEntry('test_key');
    window.localStorage.clear();
  });

  it('Test 1 — valid SVG', () => {
    const input = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.valid).toBe(true);
    expect(res.cleanSvg).toContain('<circle cx="50" cy="50" r="40"/>');
  });

  it('Test 2 — Markdown fenced SVG', () => {
    const input = '```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n```';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.valid).toBe(true);
    expect(res.cleanSvg).toBe('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>');
  });

  it('Test 3 — surrounding text', () => {
    const input = 'Here is the illustration:\n\n<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40"/>\n</svg>\n\nDone.';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.valid).toBe(true);
    expect(res.cleanSvg).toBe('<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40"/>\n</svg>');
  });

  it('Test 4 — bare ampersand', () => {
    const input = '<svg viewBox="0 0 100 100"><text>Pressure & Temperature</text></svg>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.valid).toBe(true);
    expect(res.cleanSvg).toContain('Pressure &amp; Temperature');
  });

  it('Test 5 — script injection', () => {
    const input = '<svg viewBox="0 0 100 100"><script>alert(1)</script><circle cx="50" cy="50" r="40"/></svg>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.cleanSvg).not.toContain('<script');
  });

  it('Test 6 — foreignObject', () => {
    const input = '<svg viewBox="0 0 100 100"><foreignObject><div>HTML inside SVG</div></foreignObject><circle cx="50" cy="50" r="40"/></svg>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.cleanSvg).not.toContain('<foreignObject');
  });

  it('Test 7 — event handler', () => {
    const input = '<svg viewBox="0 0 100 100"><rect onclick="alert(1)" width="10" height="10"/></svg>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.cleanSvg).not.toContain('onclick');
  });

  it('Test 8 — external resource', () => {
    const input = '<svg viewBox="0 0 100 100"><image href="https://example.com/test.png"/></svg>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.cleanSvg).not.toContain('https://example.com/test.png');
  });

  it('Test 9 — missing closing SVG with safe recovery', () => {
    const input = '<svg viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40"/>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.valid).toBe(true);
    expect(res.cleanSvg).toContain('</svg>');
  });

  it('Test 10 — malformed nested XML', () => {
    const input = '<svg><g><path d="M0 0"/>';
    const res = LlmSvgObjectCache.validateSvg(input);
    // Malformed unclosed nested tags must fail validation
    expect(res.valid).toBe(false);
  });

  it('Test 11 — no SVG', () => {
    const input = 'I cannot generate that.';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.valid).toBe(false);
    expect(res.errorCode).toBe('NO_SVG_ROOT');
  });

  it('Test 12 — multiple SVGs', () => {
    const input = '<svg viewBox="0 0 100 100"><circle cx="10" cy="10" r="5"/></svg> Extra text <svg viewBox="0 0 200 200"><rect width="20" height="20"/></svg>';
    const res = LlmSvgObjectCache.validateSvg(input);
    expect(res.valid).toBe(true);
    expect(res.cleanSvg).toBe('<svg viewBox="0 0 100 100"><circle cx="10" cy="10" r="5"/></svg>');
  });

  it('Test 13 — invalid cached SVG in localStorage eviction', async () => {
    const key = 'test_wave_key';
    const persistentKey = 'avelut_llm_svg_cache_v2';
    window.localStorage.setItem(persistentKey, JSON.stringify({ [key]: 'invalid text no svg' }));

    const generateFn = vi.fn().mockResolvedValue('<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="10" y2="10"/></svg>');

    const result = await LlmSvgObjectCache.getOrGenerate(key, generateFn);

    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(result).toContain('<line x1="0" y1="0" x2="10" y2="10"/>');
  });

  it('Test 14 — valid cached SVG', async () => {
    const key = 'test_valid_key';
    const validSvg = '<svg viewBox="0 0 100 100"><rect width="50" height="50"/></svg>';
    const persistentKey = 'avelut_llm_svg_cache_v2';
    window.localStorage.setItem(persistentKey, JSON.stringify({ [key]: validSvg }));

    const generateFn = vi.fn();
    const result = await LlmSvgObjectCache.getOrGenerate(key, generateFn);

    expect(generateFn).not.toHaveBeenCalled();
    expect(result).toBe(validSvg);
  });

  it('Test 15 — repair success', async () => {
    const key = 'test_repair_key';
    const malformed = '```xml\n<svg viewBox="0 0 100 100"><g><path d="M0 0"';
    const repaired = '<svg viewBox="0 0 100 100"><g><path d="M0 0"/></g></svg>';

    const generateFn = vi.fn().mockResolvedValue(malformed);
    const repairFn = vi.fn().mockResolvedValue(repaired);

    const result = await LlmSvgObjectCache.getOrGenerate(key, generateFn, repairFn);

    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(repairFn).toHaveBeenCalledTimes(1);
    expect(result).toBe(repaired);
  });

  it('Test 16 — repair failure controlled failure', async () => {
    const key = 'test_repair_fail_key';
    const malformed1 = '```xml\n<svg><g><path d="M0 0"';
    const malformed2 = 'I failed to fix it';

    const generateFn = vi.fn().mockResolvedValue(malformed1);
    const repairFn = vi.fn().mockResolvedValue(malformed2);

    const result = await LlmSvgObjectCache.getOrGenerate(key, generateFn, repairFn);

    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(repairFn).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('Test 17 — exact production failure query regression', async () => {
    const key = 'side-by-side comparison of transverse and longitudinal wave propagation in a spring or rope. left side shows a transverse wave with particles moving perpendicular to the direction of wave travel, labeled crest, trough, and amplitude. right side shows a longitudinal wave with particles moving parallel to the direction of wave travel, labeled compression and rarefaction regions. include arrows indicating the direction of wave propagation for both.';

    // Mock first response as truncated/unclosed SVG
    const truncatedOutput = 'Here is the diagram:\n```xml\n<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">\n<text>Wave & Amplitude</text>\n<g><path d="M 100 100 Q 150 50 200 100';

    // Mock repair response as valid, complete SVG
    const repairedOutput = '<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg"><text>Wave &amp; Amplitude</text><g><path d="M 100 100 Q 150 50 200 100"/></g></svg>';

    const generateFn = vi.fn().mockResolvedValue(truncatedOutput);
    const repairFn = vi.fn().mockResolvedValue(repairedOutput);

    const result = await LlmSvgObjectCache.getOrGenerate(key, generateFn, repairFn);

    expect(generateFn).toHaveBeenCalledTimes(1);
    expect(repairFn).toHaveBeenCalledTimes(1);
    expect(result).toBe(repairedOutput);
  });
});
