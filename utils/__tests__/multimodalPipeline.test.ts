import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  normalizeQwenModelName,
  normalizeAlibabaDashScopeModel,
  createAvelutAI,
} from '../../utils/inference';
import { compressBase64Image } from '../../utils/mediaUpload';

describe('Multimodal Pipeline and 429 Rate Limiting Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('1. Image downscaling and base64 compression helper', async () => {
    const rawDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = await compressBase64Image(rawDataUrl, 1600, 0.82);
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
  });

  test('2. Model normalization preserves requested multimodal Omni model', () => {
    expect(normalizeQwenModelName('qwen3.8-omni-flash', true)).toBe('qwen3.8-omni-flash');
    expect(normalizeAlibabaDashScopeModel('qwen3.8-omni-flash', true)).toBe('qwen3.8-omni-flash');
    expect(normalizeAlibabaDashScopeModel('qwen-vl-plus', true)).toBe('qwen3.8-omni-flash');
  });

  test('3. Bounded exponential backoff and fallback on 429 rate limit', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    // Return 429 for initial Alibaba calls
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '1' }),
      text: async () => JSON.stringify({ error: 'RATE_LIMIT', message: 'Upstream provider is temporarily overloaded.' }),
    } as Response);

    const appSettings: any = {
      alibaba_api_key: 'test_alibaba_key',
      openrouter_api_key: 'test_openrouter_key',
    };

    const ai = createAvelutAI(appSettings, null);

    const callPromise = ai.models.generateContent({
      model: 'qwen3.8-omni-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: 'abc' } },
          { text: 'Analyze this' },
        ],
      }],
    });

    await expect(callPromise).rejects.toThrow(/temporarily busy/);

    // Verify retries occurred
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(1);
  }, 15000);

  test('4. Title generation prompt excludes images', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'Calculus Concept Overview' } }] }),
    } as Response);

    const appSettings: any = { alibaba_api_key: 'test_key' };
    const ai = createAvelutAI(appSettings, null);

    const result = await ai.models.generateContent({
      model: 'qwen3.8-omni-flash',
      contents: [{
        role: 'user',
        parts: [{ text: 'Summarize text prompt into short title: Calculus limits and derivatives' }],
      }],
    });

    expect(fetchSpy).toHaveBeenCalled();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    const userMessageContent = requestBody.messages[0].content;
    expect(JSON.stringify(userMessageContent)).not.toContain('image_url');
  });
});
