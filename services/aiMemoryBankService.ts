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
 * Queries server-side vector memory.
 */
export async function queryVectorMemories(userId: string, queryText: string, topK = 5): Promise<MemoryItem[]> {
  if (!userId || !queryText) return [];
  try {
    const res = await fetch('/api/ai-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'query',
        userId,
        queryText,
        topK,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.matches)) {
        return data.matches.map((m: any) => ({
          id: m.id,
          category: m.category || 'preference',
          content: m.content,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: 'auto' as const,
          enabled: m.enabled !== false,
        }));
      }
    }
  } catch (e) {
    console.warn('[AIMemoryBank] Server vector memory unavailable, using local memory fallback:', e);
  }
  return [];
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

  // Exclude sensitive information (passwords, tokens, payment details)
  if (/(password|secret|credit card|cvv|api_key|token|auth_token)/i.test(content)) {
    console.warn('[AIMemoryBank] Excluded sensitive memory content');
    return {
      id: `mem_ignored`,
      category,
      content: '',
      createdAt: now,
      updatedAt: now,
      source,
      enabled: false,
    };
  }

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
  const existingItem = bank.items.find(
    (item) => item.content.toLowerCase().trim() === normalized ||
      (normalized.length > 15 && item.content.toLowerCase().trim().includes(normalized)) ||
      (item.content.length > 15 && normalized.includes(item.content.toLowerCase().trim()))
  );

  if (existingItem) {
    return {
      ...existingItem,
      enabled: true,
    };
  }

  bank.items.unshift(newItem);
  await saveAIMemoryBank(bank);

  // Sync to server-side vector DB asynchronously (non-blocking)
  fetch('/api/ai-memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'upsert',
      userId,
      memoryItem: newItem,
    }),
  }).catch(() => {});

  // Dispatch global event so UI and open tabs can update instantly
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('avelut_memory_auto_added', {
        detail: { item: newItem },
      })
    );
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
 * Fast deterministic heuristics to extract unambiguous student details immediately.
 */
function extractHeuristicMemories(userMessage: string): Array<{ content: string; category: MemoryCategory }> {
  const items: Array<{ content: string; category: MemoryCategory }> = [];

  const text = userMessage.trim();

  // 1. Preferred Name: "call me David", "my name is Tobi"
  const nameMatch = text.match(/(?:my name is|call me|i am called|you can call me)\s+([A-Z][a-zA-Z]{1,20})(?:[.,\s]|$)/i);
  if (nameMatch && !/^(sorry|fine|here|doing|studying|happy|ready|tired|hungry|confused)$/i.test(nameMatch[1])) {
    items.push({
      content: `Student's name is ${nameMatch[1].trim()}`,
      category: 'academic',
    });
  }

  // 2. Department / Course / Major: "i study Biochemistry", "my department is Mechanical Engineering"
  const courseMatch = text.match(/(?:i(?:'m| am)?\s*(?:studying|reading|a student of)|my (?:major|course|department) is)\s+([A-Za-z0-9&/,\s]{3,40})(?:[.,\n]|$)/i);
  if (courseMatch) {
    const rawCourse = courseMatch[1].trim().replace(/\b(?:at|in)\s+.*$/i, '').trim();
    if (rawCourse.length > 2 && !/^(it|that|something|now|here|a lot)$/i.test(rawCourse)) {
      items.push({
        content: `Studying: ${rawCourse}`,
        category: 'academic',
      });
    }
  }

  // 3. Level: "100 level", "200l", "300 level", "400 lvl", "500 level"
  const lvlMatch = text.match(/(?:i(?:'m| am)?\s*(?:in|a)\s*)?([1-5]00)\s*(?:level|lvl|\bL\b)/i);
  if (lvlMatch) {
    items.push({
      content: `Academic Level: ${lvlMatch[1]} Level`,
      category: 'academic',
    });
  }

  // 4. University / School: "i attend UNILAG", "study at University of Ibadan"
  const uniMatch = text.match(/(?:i (?:attend|go to|study at)|my (?:school|university|institution|polytechnic|college) is)\s+([A-Za-z0-9&/,\s]{2,40})(?:[.,\n]|$)/i);
  if (uniMatch) {
    const uni = uniMatch[1].trim();
    if (uni.length > 1 && !/^(it|class|school|church|home)$/i.test(uni)) {
      items.push({
        content: `Institution: ${uni}`,
        category: 'academic',
      });
    }
  }

  // 5. Explicit "remember that..." or "don't forget that..."
  const rememberMatch = text.match(/(?:please\s*)?(?:remember that|don't forget that|keep in mind that|note that)\s+([^.!?\n]{5,120})/i);
  if (rememberMatch) {
    items.push({
      content: rememberMatch[1].trim(),
      category: 'preference',
    });
  }

  // 6. Struggles / Difficulties
  const struggleMatch = text.match(/(?:i (?:struggle with|find|have difficulty with|am weak (?:at|in)|have issues with|hate)|hard for me to understand)\s+([A-Za-z0-9\s]{3,45})(?:[.,\n]|$)/i);
  if (struggleMatch) {
    items.push({
      content: `Struggles with: ${struggleMatch[1].trim()}`,
      category: 'strengths_weaknesses',
    });
  }

  // 7. Goals & Exam Targets
  const goalMatch = text.match(/(?:my goal is|i want to (?:graduate with|score|get an? a in)|preparing for|targeting)\s+([A-Za-z0-9\s]{3,45})(?:[.,\n]|$)/i);
  if (goalMatch) {
    items.push({
      content: `Academic Goal: ${goalMatch[1].trim()}`,
      category: 'goals',
    });
  }

  // 8. Learning Style
  const styleMatch = text.match(/(?:explain (?:like|in)|use|prefer)\s+((?:nigerian|simple terms|step by step|bullet points|practical examples|danfo|pos|market analogies)[^.,\n]{0,35})/i);
  if (styleMatch) {
    items.push({
      content: `Prefers explanations with ${styleMatch[1].trim()}`,
      category: 'learning_style',
    });
  }

  return items;
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
  if (!userId || !userMessage || userMessage.trim().length < 5) return [];

  const bank = await getAIMemoryBank(userId, userProfile);
  if (!bank.isEnabled) return [];

  const addedItems: MemoryItem[] = [];
  const existingSet = new Set(bank.items.map((m) => m.content.toLowerCase().trim()));

  // 1. Run deterministic heuristic extraction (instant & reliable)
  const heuristicCandidates = extractHeuristicMemories(userMessage);
  for (const cand of heuristicCandidates) {
    const norm = cand.content.toLowerCase().trim();
    if (!existingSet.has(norm)) {
      const added = await addMemoryItem(userId, cand.content, cand.category, 'auto');
      existingSet.add(norm);
      addedItems.push(added);
    }
  }

  // 2. Fast heuristic checks for whether LLM extraction is warranted
  const mentionsPersonalContext = /(i |my |me |prefer|like|love|hate|struggle|weak|difficult|exam|pass|goal|target|major|degree|level|study|school|remember|analog)/i.test(userMessage);
  if (!mentionsPersonalContext && userMessage.trim().length < 20) {
    return addedItems;
  }

  // 3. Run fast lightweight AI inference to extract any nuanced memories
  try {
    const ai = createAvelutAI(appSettings, userProfile, {
      feature: 'chat_interaction',
      endpointPreference: 'openai_compatible_first',
    });

    if (ai) {
      const existingMemoriesSummary = bank.items.map((m) => m.content).slice(0, 15).join('; ');

      const extractionPrompt = [
        'You are the Avelut Adaptive Memory Engine. Analyze the student\'s conversation input.',
        'Extract any durable, personal academic facts, learning preferences, goals, or subject struggles worth remembering across sessions.',
        'RULES:',
        '1. Only extract long-term relevant information (e.g. major, university, degree goals, weakness topics, preferred explanation style).',
        '2. Do NOT extract ephemeral questions, greetings, or trivial banter.',
        '3. Do NOT extract facts already present in existing memories.',
        '4. Format each memory concisely in 3rd person (e.g. "Student struggles with organic synthesis mechanisms").',
        '',
        `Existing Memories: "${existingMemoriesSummary}"`,
        `Student Input: "${userMessage}"`,
        '',
        'Output a valid JSON array or empty array if none:',
        '[{"content": "...", "category": "academic" | "learning_style" | "strengths_weaknesses" | "goals" | "preference"}]',
      ].join('\n');

      const result = await ai.models.generateContent({
        model: 'qwen3.8-omni-flash',
        contents: [{ role: 'user', parts: [{ text: extractionPrompt }] }],
        config: { temperature: 0.1, maxOutputTokens: 300 },
      });

      const responseText = getResponseText(result).trim();
      const parsed = cleanAndParseJson<Array<{ content: string; category: MemoryCategory }>>(responseText, {
        expectArray: true,
        fallback: [],
      });

      if (Array.isArray(parsed) && parsed.length > 0) {
        for (const item of parsed) {
          if (item && item.content && item.content.trim().length > 4) {
            const norm = item.content.toLowerCase().trim();
            if (!existingSet.has(norm)) {
              const added = await addMemoryItem(userId, item.content, item.category || 'preference', 'auto');
              existingSet.add(norm);
              addedItems.push(added);
            }
          }
        }
      }
    }
  } catch (err) {
    // Non-blocking background extraction
    console.debug('[AIMemoryBank] Background AI extraction notice:', err);
  }

  return addedItems;
}

