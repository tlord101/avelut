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
