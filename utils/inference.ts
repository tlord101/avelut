import { GoogleGenAI } from '@google/genai';
import type { AppSettings, UserProfile } from '../types';
import { db } from '../firebase';
import { ref as dbRef, push } from 'firebase/database';

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
    if (typeof item === 'string') {
      totalLength += item.length;
    } else if (item && typeof item === 'object') {
      for (const key in item) {
        countChars(item[key]);
      }
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
      if (typeof obj === 'string') {
        if (obj.length > threshold) {
          const truncated = obj.substring(0, threshold) + '\n[... Context compressed to stay within limit ...]';
          totalLength += truncated.length;
          return truncated;
        }
        totalLength += obj.length;
        return obj;
      } else if (Array.isArray(obj)) {
        return obj.map(item => truncate(item));
      } else if (obj && typeof obj === 'object') {
        const res: any = {};
        for (const key in obj) {
          res[key] = truncate(obj[key]);
        }
        return res;
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
 * Centralized client factory that instantiates or wraps the GoogleGenAI client.
 * Injects RPM rate limiting, context compaction, and context compression when a personal key is used.
 */
export const createVanTutorAI = (
  appSettings: AppSettings,
  userProfile: UserProfile | null
): any => {
  const usePersonalToken = !!(
    userProfile?.use_personal_token &&
    userProfile?.personal_api_key?.trim()
  );

  const apiKey = usePersonalToken
    ? userProfile!.personal_api_key!.trim()
    : appSettings.gemini_api_key.trim();

  if (!apiKey) return null;

  const rawClient = new GoogleGenAI({ apiKey });
  const isFreeCustomTokenUser = usePersonalToken && userProfile?.subscription_status === 'personal_token';
  const limitRpm = isFreeCustomTokenUser ? 9 : (appSettings.custom_user_limit_rpm || 10);
  const limitTpm = appSettings.custom_user_limit_tpm || 250000;

  globalRateLimiter.setLimitRpm(limitRpm);

  const prepareParams = async (params: any) => {
    let processedParams = { ...params };

    if (usePersonalToken) {
      // 1. Context Compaction Adapter
      const mathOrCodeRequested = isMathOrCodeRequested(processedParams.contents);
      
      const compact = (obj: any): any => {
        if (typeof obj === 'string') {
          return compactContext(obj, mathOrCodeRequested);
        } else if (Array.isArray(obj)) {
          return obj.map(item => compact(item));
        } else if (obj && typeof obj === 'object') {
          const res: any = {};
          for (const key in obj) {
            res[key] = compact(obj[key]);
          }
          return res;
        }
        return obj;
      };
      
      processedParams = compact(processedParams);

      // 2. Context Compression Pass
      processedParams = compressContext(processedParams, limitTpm);

      // 3. RPM Rate-Limiting Queue
      await globalRateLimiter.acquireToken();
    }

    // Log AI request asynchronously for real-time analytics
    try {
      void push(dbRef(db, 'usage_logs/ai_requests'), {
        timestamp: Date.now(),
        user_id: userProfile?.uid || 'anonymous',
        model: appSettings.primary_gemini_model || 'gemini-2.5-flash-lite',
        use_personal_token: usePersonalToken
      });
    } catch (err) {
      console.error('Failed to log AI request:', err);
    }

    return processedParams;
  };

  // Return a wrapped client matching standard GoogleGenAI signature
  return {
    models: {
      generateContent: async (params: any) => {
        const processed = await prepareParams(params);
        return rawClient.models.generateContent(processed);
      },
      generateContentStream: async (params: any) => {
        const processed = await prepareParams(params);
        return rawClient.models.generateContentStream(processed);
      }
    }
  };
};
