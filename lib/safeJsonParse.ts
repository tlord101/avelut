import { cleanAndParseJson } from '../utils/jsonUtils';

export function safeJsonParse<T = any>(raw: any, fallback?: T): T {
  return cleanAndParseJson<T>(raw, { fallback });
}
