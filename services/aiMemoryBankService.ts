import { readCachedJson, writeCachedJson } from '../utils/cache';
import { db, ref as dbRef, get, set } from '@/lib/backend';
import type { UserProfile, AppSettings } from '../types';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { cleanAndParseJson } from '../utils/jsonUtils';

export type MemoryCategory =
  | 'academic'
  | 'learning_style'
  | 'strengths_weaknesses'
  | 'goals'
  | 'preference';

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  content: string;
  createdAt: number;
  updatedAt: number;
  source: 'auto' | 'manual';
  enabled: boolean;
}

export interface AIMemoryBank {
  userId: string;
  isEnabled: boolean;
  items: MemoryItem[];
  lastUpdated: number;
}

const MEMORY_STORAGE_KEY_PREFIX = 'avelut_ai_memory_bank_v1';

/**
 * Returns default initial memories based on the user's profile metadata.
 */
function createInitialMemories(userProfile?: UserProfile): MemoryItem[] {
  const now = Date.now();
  const items: MemoryItem[] = [];
  const studentName = userProfile?.display_name || (userProfile as any)?.full_name || (userProfile as any)?.username;

  if (studentName) {
    items.push({
      id: `mem_name_${now}_1`,
      category: 'academic',
      content: `Student Name: ${studentName}`,
      createdAt: now,
      updatedAt: now,
      source: 'auto',
      enabled: true,
    });
  }

  const dept = userProfile?.department_id || (userProfile as any)?.department;
  const level = userProfile?.level;
  const uni = (userProfile as any)?.institution || (userProfile as any)?.university || 'University';
  if (dept || level) {
    const academicInfo = [
      level ? `${level} Level` : '',
      dept ? `${dept}` : '',
      uni ? `at ${uni}` : '',
    ].filter(Boolean).join(' ');

    if (academicInfo) {
      items.push({
        id: `mem_academic_${now}_2`,
        category: 'academic',
        content: `Academic Standing: ${academicInfo}`,
        createdAt: now,
        updatedAt: now,
        source: 'auto',
        enabled: true,
      });
    }
  }

  items.push({
    id: `mem_style_${now}_3`,
    category: 'learning_style',
    content: 'Prefers clear, intuitive explanations with everyday Nigerian practical analogies (e.g. POS charges, NEPA power, Danfo bus routes)',
    createdAt: now,
    updatedAt: now,
    source: 'auto',
    enabled: true,
  });

  items.push({
    id: `mem_goal_${now}_4`,
    category: 'goals',
    content: 'Aiming for top academic performance, deep concept understanding, and high exam scores',
    createdAt: now,
    updatedAt: now,
    source: 'auto',
    enabled: true,
  });

  return items;
}

/**
 * Loads the user's Memory Bank from local cache and cloud database.
 */
export async function getAIMemoryBank(userId: string, userProfile?: UserProfile): Promise<AIMemoryBank> {
  const uid = userId || userProfile?.uid || 'anon';
  const storageKey = `${MEMORY_STORAGE_KEY_PREFIX}_${uid}`;

  // 1. Read from ultra-fast synchronous SQLite cache
  const cached = readCachedJson<AIMemoryBank | null>(storageKey, null);
  if (cached && Array.isArray(cached.items)) {
    return cached;
  }

  // 2. Fallback to Firebase Realtime DB if available
  try {
    if (uid !== 'anon') {
      const snap = await get(dbRef(db, `ai_memory_banks/${uid}`));
      if (snap.exists()) {
        const remoteData = snap.val() as AIMemoryBank;
        if (remoteData && Array.isArray(remoteData.items)) {
          writeCachedJson(storageKey, remoteData, uid);
          return remoteData;
        }
      }
    }
  } catch (err) {
    console.warn('[AIMemoryBank] Error reading from remote DB:', err);
  }

  // 3. Initialize fresh memory bank
  const initialBank: AIMemoryBank = {
    userId: uid,
    isEnabled: true,
    items: createInitialMemories(userProfile),
    lastUpdated: Date.now(),
  };

  writeCachedJson(storageKey, initialBank, uid);
  return initialBank;
}

/**
 * Saves memory bank state locally and syncs to cloud.
 */
export async function saveAIMemoryBank(bank: AIMemoryBank): Promise<void> {
  if (!bank || !bank.userId) return;
  const storageKey = `${MEMORY_STORAGE_KEY_PREFIX}_${bank.userId}`;
  bank.lastUpdated = Date.now();

  writeCachedJson(storageKey, bank, bank.userId);

  try {
    if (bank.userId !== 'anon') {
      void set(dbRef(db, `ai_memory_banks/${bank.userId}`), bank);
    }
  } catch (err) {
    console.warn('[AIMemoryBank] Error syncing to remote DB:', err);
  }
}

/**
 * Adds a new memory item to the user's Memory Bank.
 */
export async function addMemoryItem(
  userId: string,
  content: string,
  category: MemoryCategory = 'preference',
  source: 'manual' | 'auto' = 'manual'
): Promise<MemoryItem> {
  const bank = await getAIMemoryBank(userId);
  const now = Date.now();
  const newItem: MemoryItem = {
    id: `mem_${now}_${Math.random().toString(36).substring(2, 7)}`,
    category,
    content: content.trim(),
    createdAt: now,
    updatedAt: now,
    source,
    enabled: true,
  };

  // Avoid adding near-duplicates
  const normalized = content.toLowerCase().trim();
  const exists = bank.items.some(
    (item) => item.content.toLowerCase().trim() === normalized
  );

  if (!exists) {
    bank.items.unshift(newItem);
    await saveAIMemoryBank(bank);
  }

  return newItem;
}

/**
 * Updates an existing memory item.
 */
export async function updateMemoryItem(
  userId: string,
  itemId: string,
  updates: Partial<Omit<MemoryItem, 'id' | 'createdAt'>>
): Promise<void> {
  const bank = await getAIMemoryBank(userId);
  const index = bank.items.findIndex((m) => m.id === itemId);
  if (index !== -1) {
    bank.items[index] = {
      ...bank.items[index],
      ...updates,
      updatedAt: Date.now(),
    };
    await saveAIMemoryBank(bank);
  }
}

/**
 * Deletes a memory item.
 */
export async function deleteMemoryItem(userId: string, itemId: string): Promise<void> {
  const bank = await getAIMemoryBank(userId);
  bank.items = bank.items.filter((m) => m.id !== itemId);
  await saveAIMemoryBank(bank);
}

/**
 * Clears all memories.
 */
export async function clearAllMemories(userId: string): Promise<void> {
  const bank = await getAIMemoryBank(userId);
  bank.items = [];
  await saveAIMemoryBank(bank);
}

/**
 * Toggles the entire Memory Bank system on or off.
 */
export async function toggleMemoryBank(userId: string, isEnabled: boolean): Promise<void> {
  const bank = await getAIMemoryBank(userId);
  bank.isEnabled = isEnabled;
  await saveAIMemoryBank(bank);
}

/**
 * Formats active memories into a compact, natural context block for AI prompts.
 */
export function buildMemoryPromptContext(bank?: AIMemoryBank | null, userProfile?: UserProfile): string {
  if (!bank || !bank.isEnabled) return '';

  const activeItems = bank.items.filter((item) => item.enabled && item.content.trim());
  if (activeItems.length === 0) return '';

  const categoryLabels: Record<MemoryCategory, string> = {
    academic: 'Academic Background',
    learning_style: 'Learning Preferences',
    strengths_weaknesses: 'Strengths & Weaknesses',
    goals: 'Academic Goals',
    preference: 'Preferences',
  };

  const lines = activeItems.map((item) => {
    const label = categoryLabels[item.category] || 'Note';
    return `- [${label}] ${item.content}`;
  });

  return [
    '',
    '=== AVELUT AI MEMORY BANK (PERSISTENT ADAPTIVE PROFILE) ===',
    'What you remember and know about this student from their ongoing Memory Bank:',
    ...lines,
    'ADAPTATION DIRECTIVE: Personalize your explanations, tone, analogies, and pacing according to these memories seamlessly and naturally. Do not explicitly say "According to your memory bank".',
    '==========================================================',
  ].join('\n');
}

/**
 * Asynchronously detects and extracts salient learning facts or preferences from a user exchange.
 */
export async function extractAndSaveMemoriesFromExchange(params: {
  userId: string;
  userMessage: string;
  aiResponse: string;
  appSettings?: AppSettings;
  userProfile?: UserProfile;
}): Promise<MemoryItem[]> {
  const { userId, userMessage, appSettings, userProfile } = params;
  if (!userId || !userMessage || userMessage.trim().length < 15) return [];

  const bank = await getAIMemoryBank(userId, userProfile);
  if (!bank.isEnabled) return [];

  const text = userMessage.toLowerCase();

  // Fast heuristic checks for explicit memory triggers
  const mentionsPreference = /i (prefer|like|love|hate|struggle with|don't understand|want to learn|am studying|attend|go to|am in|my major is|my name is)/i.test(userMessage);
  const mentionsStyle = /(explain like|in simple terms|use nigerian|use analogies|step by step|give me formulas|don't use emojis)/i.test(userMessage);
  const mentionsGoal = /(my goal|preparing for|my exam is|i need to pass|targeting|first class|gpa)/i.test(userMessage);

  if (!mentionsPreference && !mentionsStyle && !mentionsGoal) {
    return [];
  }

  // Use fast lightweight AI inference to extract candidate memory if available
  try {
    const ai = createAvelutAI(appSettings, userProfile, {
      feature: 'chat_interaction',
      endpointPreference: 'openai_compatible_first',
    });

    if (!ai) return [];

    const existingMemoriesSummary = bank.items.map((m) => m.content).slice(0, 10).join('; ');

    const extractionPrompt = [
      'You are Avelut Memory Bank extractor. Analyze the student message below.',
      'Identify any NEW, durable personal facts, learning style preferences, academic goals, or topic difficulties worth remembering.',
      'Do NOT extract temporary questions or trivial chatter.',
      'Do NOT extract facts already present in existing memories.',
      '',
      `Existing Memories: "${existingMemoriesSummary}"`,
      `Student Message: "${userMessage}"`,
      '',
      'Return a valid JSON array of new memory items or an empty array [] if none:',
      '[{"content": "Concise fact written in 3rd person (e.g. Student prefers Nigerian market analogies)", "category": "learning_style" | "academic" | "strengths_weaknesses" | "goals" | "preference"}]',
    ].join('\n');

    const result = await ai.models.generateContent({
      model: 'qwen3.8-omni-flash',
      contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
      config: { temperature: 0.1, maxOutputTokens: 250 },
    });

    const responseText = getResponseText(result).trim();
    const parsed = cleanAndParseJson<Array<{ content: string; category: MemoryCategory }>>(responseText);

    if (Array.isArray(parsed) && parsed.length > 0) {
      const addedItems: MemoryItem[] = [];
      for (const item of parsed) {
        if (item.content && item.content.trim().length > 5) {
          const added = await addMemoryItem(userId, item.content, item.category || 'preference', 'auto');
          addedItems.push(added);
        }
      }
      return addedItems;
    }
  } catch (err) {
    // Non-blocking background extraction
    console.debug('[AIMemoryBank] Extraction skipped or failed:', err);
  }

  return [];
}
