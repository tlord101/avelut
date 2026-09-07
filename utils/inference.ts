import type { AppSettings, UserProfile } from '../types';
import { getOpenRouterApiKey, getAlibabaApiKey } from './appSettings';

/**
 * Universal JSON Schema Type Enum (replaces @google/genai Type)
 */
export const Type = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
} as const;

/**
 * Strips mathematical LaTeX/KaTeX symbols and complex code blocks from text
 * for compaction unless the user specifically requested math or code.
 */
export const compactContext = (text: string, isRequested: boolean): string => {
  if (!text || isRequested) return text;
  let cleaned = text;

  // Strip LaTeX style blocks: $$...$$
  cleaned = cleaned.replace(/\$\$.*?\$\$/gs, '');
  // Strip LaTeX style inline: $...$
  cleaned = cleaned.replace(/\$.*?\$/g, '');
  // Strip \[ ... \] and \( ... \)
  cleaned = cleaned.replace(/\\\[.*?\\\]/gs, '');
  cleaned = cleaned.replace(/\\\(.*?\\\)/gs, '');
  // Strip complex markdown code blocks but keep text contents or omit them
  cleaned = cleaned.replace(/```[a-zA-Z]*\n[\s\S]*?\n```/g, '\n[Code block omitted for context compaction]\n');
  // Strip KaTeX math structures like \frac, \sqrt, \begin{equation}
  cleaned = cleaned.replace(/\\[a-zA-Z]+\{.*?\}/g, '');
  cleaned = cleaned.replace(/\\begin\{.*?\}.*?\\end\{.*?\}/gs, '');

  return cleaned;
};

/**
 * Checks if the user prompt requests mathematical or programmatic syntax.
 */
const isMathOrCodeRequested = (contents: any): boolean => {
  if (!contents) return false;
  const keywords = [
    'math', 'latex', 'katex', 'equation', 'formula', 'code', 'program',
    'script', 'function', 'class', 'python', 'javascript', 'typescript',
    'java', 'c++', 'c#', 'html', 'css', 'solve', 'calculate', 'prove',
    'integral', 'derivative', 'matrix', 'vector', 'theorem', 'fraction'
  ];
  let text = '';
  
  const extractText = (item: any) => {
    if (typeof item === 'string') {
      text += ' ' + item.toLowerCase();
    } else if (item && typeof item === 'object') {
      for (const key in item) {
        extractText(item[key]);
      }
    }
  };
  extractText(contents);
  
  return keywords.some(keyword => text.includes(keyword));
};

/**
 * Localized trimming routine that calculates character length (proxy for tokens)
 * and recursively compresses large text blocks to stay strictly below TPM boundary.
 */
export const compressContext = (params: any, tpmLimit: number = 250000): any => {
  // Use a conservative proxy of 3.5 characters per token.
  const maxChars = Math.floor(tpmLimit * 3.5);
  
  let totalLength = 0;
  const countChars = (item: any) => {
    if (item && typeof item === 'object') {
      if ('inlineData' in item) {
        return;
      }
      for (const key in item) {
        if (key !== 'inlineData') {
          countChars(item[key]);
        }
      }
    } else if (typeof item === 'string') {
      totalLength += item.length;
    }
  };
  countChars(params);

  if (totalLength <= maxChars) {
    return params;
  }

  // Deep clone to safely manipulate parameters
  const newParams = JSON.parse(JSON.stringify(params));
  
  // Truncate large string values dynamically until payload fits
  let threshold = 30000;
  while (totalLength > maxChars && threshold > 500) {
    totalLength = 0;
    const truncate = (obj: any): any => {
      if (obj && typeof obj === 'object') {
        if ('inlineData' in obj) {
          return obj;
        }
        if (Array.isArray(obj)) {
          return obj.map(item => truncate(item));
        }
        const res: any = {};
        for (const key in obj) {
          if (key === 'inlineData') {
            res[key] = obj[key];
          } else {
            res[key] = truncate(obj[key]);
          }
        }
        return res;
      }
      if (typeof obj === 'string') {
        if (obj.length > threshold) {
          const truncated = obj.substring(0, threshold) + '\n[... Context compressed to stay within limit ...]';
          totalLength += truncated.length;
          return truncated;
        }
        totalLength += obj.length;
        return obj;
      }
      return obj;
    };
    
    const result = truncate(newParams);
    if (totalLength <= maxChars) {
      return result;
    }
    threshold = Math.floor(threshold * 0.7);
  }

  return newParams;
};

/**
 * production-grade, asynchronous token-bucket queue for RPM limits.
 */
class RpmRateLimiter {
  private lastRequestTimes: number[] = [];
  private limitRpm: number;

  constructor(limitRpm: number = 10) {
    this.limitRpm = limitRpm;
  }

  setLimitRpm(limit: number) {
    this.limitRpm = limit;
  }

  async acquireToken(): Promise<void> {
    const intervalMs = 60000; // 1 minute window
    while (true) {
      const now = Date.now();
      this.lastRequestTimes = this.lastRequestTimes.filter(t => now - t < intervalMs);

      if (this.lastRequestTimes.length < this.limitRpm) {
        this.lastRequestTimes.push(now);
        return;
      }

      const oldestTime = this.lastRequestTimes[0];
      const waitTime = intervalMs - (now - oldestTime);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime + 100)); // Add a buffer
      }
    }
  }
}

// Global rate limiter singleton
const globalRateLimiter = new RpmRateLimiter(10);

/**
 * Safe helper to extract text from an AI model response.
 * Handles both getter and method versions of .text property.
 */
export const getResponseText = (response: any): string => {
  if (!response) return '';
  const text = response.text;
  if (typeof text === 'function') {
    return text();
  }
  if (typeof text === 'string') {
    return text;
  }
  if (response?.candidates?.[0]?.content?.parts?.[0]?.text !== undefined) {
    return response.candidates[0].content.parts[0].text;
  }
  if (response?.choices?.[0]?.delta?.content !== undefined) {
    return response.choices[0].delta.content || '';
  }
  if (response?.choices?.[0]?.message?.content !== undefined) {
    return response.choices[0].message.content || '';
  }
  return '';
};

/**
 * Convert contents/parts to standard OpenAI/Alibaba chat messages
 * Supports both text and multi-modal image content
 */
function paramsToChatMessages(params: any): { systemPrompt: string; messages: Array<{ role: string; content: any }> } {
  let systemPrompt = '';
  const messages: Array<{ role: string; content: any }> = [];

  if (params?.config?.systemInstruction) {
    const si = params.config.systemInstruction;
    if (typeof si === 'string') {
      systemPrompt = si;
    } else if (si?.parts && Array.isArray(si.parts)) {
      systemPrompt = si.parts.map((p: any) => p.text || '').join('\n');
    }
  }

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  const contents = params?.contents;
  if (Array.isArray(contents)) {
    for (const c of contents) {
      const role = c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user';
      if (typeof c === 'string') {
        messages.push({ role, content: c });
      } else if (c?.parts && Array.isArray(c?.parts)) {
        const hasImage = c.parts.some((p: any) => p.inlineData || p.imageUrl || p.image_url);
        if (hasImage) {
          const multiModalContent: any[] = [];
          for (const p of c.parts) {
            if (p.text) {
              multiModalContent.push({ type: 'text', text: p.text });
            } else if (p.inlineData) {
              const mime = p.inlineData.mimeType || 'image/jpeg';
              const base64 = p.inlineData.data;
              multiModalContent.push({
                type: 'image_url',
                image_url: { url: `data:${mime};base64,${base64}` },
              });
            } else if (p.imageUrl || p.image_url) {
              const url = p.imageUrl || p.image_url;
              multiModalContent.push({
                type: 'image_url',
                image_url: { url: typeof url === 'string' ? url : url.url },
              });
            }
          }
          messages.push({ role, content: multiModalContent });
        } else {
          const text = c.parts.map((p: any) => p.text || '').join('\n');
          if (text) messages.push({ role, content: text });
        }
      } else if (typeof c?.text === 'string') {
        messages.push({ role, content: c.text });
      }
    }
  } else if (typeof contents === 'string') {
    messages.push({ role: 'user', content: contents });
  }

  return { systemPrompt, messages };
}

export const OPENROUTER_MODEL =
  (typeof import.meta !== 'undefined' && ((import.meta as any)?.env?.OPENROUTER_MODEL || (import.meta as any)?.env?.VITE_OPENROUTER_MODEL)) ||
  (typeof process !== 'undefined' && (process?.env?.OPENROUTER_MODEL || process?.env?.VITE_OPENROUTER_MODEL)) ||
  'qwen/qwen3.7-flash';

/**
 * Normalizes model names to OpenRouter Qwen 3.7 Flash
 */
export function normalizeQwenModelName(model?: string, _hasImage: boolean = false): string {
  return model?.trim() || OPENROUTER_MODEL;
}

const FALLBACK_MODELS = [
  'qwen/qwen3.7-flash',
  'google/gemini-2.5-flash',
  'qwen/qwen-2.5-72b-instruct',
  'deepseek/deepseek-r1:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-7b-instruct:free',
];

/**
 * Call OpenRouter endpoint with model candidate fallbacks on 429 Rate Limits
 */
async function callOpenRouterQwen(params: any, appSettings: AppSettings): Promise<any> {
  const apiKey = getOpenRouterApiKey(appSettings);
  const { messages } = paramsToChatMessages(params);
  const primaryModel = appSettings?.openrouter_model?.trim() || OPENROUTER_MODEL;
  const candidateModels = Array.from(new Set([primaryModel, ...FALLBACK_MODELS]));

  const isNative = typeof window !== 'undefined' && (
    (window as any).Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'file:'
  );

  const endpoints = apiKey
    ? (isNative
        ? ['https://openrouter.ai/api/v1/chat/completions', 'https://www.avelut.xyz/api/openrouter-chat', '/api/openrouter-chat']
        : ['https://openrouter.ai/api/v1/chat/completions', '/api/openrouter-chat', 'https://www.avelut.xyz/api/openrouter-chat'])
    : (isNative
        ? ['https://www.avelut.xyz/api/openrouter-chat', '/api/openrouter-chat', 'https://openrouter.ai/api/v1/chat/completions']
        : ['/api/openrouter-chat', 'https://www.avelut.xyz/api/openrouter-chat', 'https://openrouter.ai/api/v1/chat/completions']);

  let lastError: Error | null = null;

  for (const model of candidateModels) {
    const bodyPayload: any = {
      model,
      messages,
      temperature: params?.config?.temperature ?? 0.7,
      max_tokens: params?.config?.maxOutputTokens ?? 4096,
    };

    if (params?.config?.responseMimeType === 'application/json' || params?.config?.response_format?.type === 'json_object') {
      bodyPayload.response_format = { type: 'json_object' };
    }

    for (const endpoint of endpoints) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://avelut.xyz',
          'X-Title': 'Avelut AI',
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyPayload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const isRateLimit = response.status === 429 || errorText.includes('429') || errorText.toLowerCase().includes('rate limit') || errorText.toLowerCase().includes('too many requests');
          if (isRateLimit) {
            console.warn(`[OpenRouter] Rate limited on model ${model} (HTTP ${response.status}). Trying next fallback model...`);
            throw new Error(`429_RATE_LIMIT: ${errorText}`);
          }
          throw new Error(`OpenRouter HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const rawText = data?.choices?.[0]?.message?.content || '';

        return {
          text: () => rawText,
          candidates: [
            {
              content: {
                parts: [{ text: rawText }],
                role: 'model',
              },
              finishReason: data?.choices?.[0]?.finish_reason || 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: data?.usage?.prompt_tokens || 0,
            candidatesTokenCount: data?.usage?.completion_tokens || 0,
            totalTokenCount: data?.usage?.total_tokens || 0,
          },
        };
      } catch (err: any) {
        lastError = err;
        if (err?.message?.startsWith('429_RATE_LIMIT')) {
          break; // Switch to next candidate model on 429
        }
      }
    }
  }

  throw lastError || new Error('All OpenRouter model candidates failed or rate limited');
}

/**
 * Call OpenRouter endpoint with Server-Sent Events (SSE) Streaming
 */
async function* callOpenRouterQwenStream(params: any, appSettings: AppSettings): AsyncGenerator<any, void, unknown> {
  const apiKey = getOpenRouterApiKey(appSettings);
  const { messages } = paramsToChatMessages(params);
  const model = appSettings?.openrouter_model?.trim() || OPENROUTER_MODEL;

  const isNative = typeof window !== 'undefined' && (
    (window as any).Capacitor?.isNativePlatform?.() ||
    window.location.protocol === 'file:'
  );

  const endpoints = apiKey
    ? (isNative
        ? ['https://openrouter.ai/api/v1/chat/completions', 'https://www.avelut.xyz/api/openrouter-chat', '/api/openrouter-chat']
        : ['https://openrouter.ai/api/v1/chat/completions', '/api/openrouter-chat', 'https://www.avelut.xyz/api/openrouter-chat'])
    : (isNative
        ? ['https://www.avelut.xyz/api/openrouter-chat', '/api/openrouter-chat', 'https://openrouter.ai/api/v1/chat/completions']
        : ['/api/openrouter-chat', 'https://www.avelut.xyz/api/openrouter-chat', 'https://openrouter.ai/api/v1/chat/completions']);

  const bodyPayload: any = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: params?.config?.temperature ?? 0.7,
    max_tokens: params?.config?.maxOutputTokens ?? 4096,
  };

  if (params?.config?.responseMimeType === 'application/json' || params?.config?.response_format?.type === 'json_object') {
    bodyPayload.response_format = { type: 'json_object' };
  }

  let response: Response | null = null;
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://avelut.xyz',
        'X-Title': 'Avelut AI',
      };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
      });

      if (response.ok && response.body) {
        break;
      } else {
        const errText = await response.text();
        throw new Error(`OpenRouter SSE HTTP ${response.status}: ${errText}`);
      }
    } catch (err: any) {
      lastError = err;
      response = null;
    }
  }

  if (!response || !response.body) {
    const fallbackResult = await callOpenRouterQwen(params, appSettings);
    yield fallbackResult;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          return;
        }

        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(jsonStr);

            const delta = parsed?.choices?.[0]?.delta;
            let deltaText = delta?.content || '';
            let reasoningText = delta?.reasoning || delta?.reasoning_content || '';
            if (!reasoningText && parsed?.choices?.[0]?.message?.reasoning) {
              reasoningText = parsed.choices[0].message.reasoning;
            }
            let finishReason = parsed?.choices?.[0]?.finish_reason || null;

            const usage = parsed?.usage || parsed?.response?.usage;

            if (deltaText || reasoningText || finishReason || usage) {
              yield {
                text: () => deltaText,
                reasoningText: () => reasoningText,
                candidates: [
                  {
                    content: {
                      parts: [{ text: deltaText, reasoning: reasoningText }],
                      role: 'model',
                    },
                    finishReason,
                  },
                ],
                usageMetadata: usage ? {
                  promptTokenCount: usage.prompt_tokens || usage.input_tokens || 0,
                  candidatesTokenCount: usage.completion_tokens || usage.output_tokens || 0,
                  totalTokenCount: usage.total_tokens || 0,
                } : undefined,
              };
            }
          } catch {
            // Ignore partial SSE chunk parse failures
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Centralized client factory that instantiates the OpenRouter Qwen 3.7 Flash AI client.
 * Provides high-speed flagship reasoning with qwen/qwen3.7-flash and SSE streaming across all features.
 */
export const createAvelutAI = (
  appSettings: AppSettings,
  userProfile?: UserProfile | null
): any => {
  return {
    models: {
      generateContent: async (params: any) => {
        return await callOpenRouterQwen(params, appSettings);
      },
      generateContentStream: async (params: any) => {
        const streamGen = callOpenRouterQwenStream(params, appSettings);
        const asyncIterable = {
          [Symbol.asyncIterator]: () => streamGen,
          stream: streamGen,
          response: Promise.resolve(null),
        };
        return asyncIterable;
      },
      generateImages: async () => {
        throw new Error('Image generation is not supported on this model endpoint.');
      },
    },
    interactions: {
      create: async (params: any) => {
        return await callOpenRouterQwen(params, appSettings);
      },
    },
  };
};
