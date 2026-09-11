import { readCachedJson, writeCachedJson } from '../utils/cache';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { cleanAndParseJson } from '../utils/jsonUtils';
import type { UserProfile, AppSettings } from '../types';

export interface TopicStep {
  stepIndex: number;
  title: string;
  objective: string;
  keyConcepts: string[];
}

export interface TopicStructureData {
  topicKey: string;
  topicTitle: string;
  courseTitle?: string;
  steps: TopicStep[];
  currentStepIndex: number;
  completed: boolean;
  createdAt: number;
}

/**
 * Gets cached structure from local device storage or generates it using fast AI.
 */
export async function getOrGenerateTopicStructure(params: {
  topicKey: string;
  topicTitle: string;
  courseTitle?: string;
  context?: string;
  userProfile: UserProfile;
  appSettings: AppSettings;
}): Promise<TopicStructureData> {
  const { topicKey, topicTitle, courseTitle, context, userProfile, appSettings } = params;
  const storageKey = `avelut_topic_structure_v1_${userProfile?.uid || 'anon'}_${topicKey}`;

  // 1. Read from device cache first
  const cached = readCachedJson<TopicStructureData | null>(storageKey, null);
  if (cached && cached.steps && cached.steps.length > 0) {
    return cached;
  }

  // 2. Generate lightweight topic structure JSON
  const defaultFallbackSteps: TopicStep[] = [
    {
      stepIndex: 0,
      title: 'Core Fundamentals & Intuition',
      objective: `Master basic intuition and definition of ${topicTitle}`,
      keyConcepts: ['Definition', 'Real-world application', 'Intuition'],
    },
    {
      stepIndex: 1,
      title: 'Key Mechanism & Formula',
      objective: `Understand the mechanics, equations, and rules governing ${topicTitle}`,
      keyConcepts: ['Formula', 'Variables', 'Core principles'],
    },
    {
      stepIndex: 2,
      title: 'Step-by-Step Worked Example',
      objective: 'Apply the concepts to solve a practical problem or calculation',
      keyConcepts: ['Problem solving', 'Calculation steps', 'Verification'],
    },
    {
      stepIndex: 3,
      title: 'Common Misconceptions & Review',
      objective: 'Avoid common pitfalls and summarize key takeaways',
      keyConcepts: ['Pitfalls', 'Summary', 'Self-check'],
    },
  ];

  const defaultStructure: TopicStructureData = {
    topicKey,
    topicTitle,
    courseTitle,
    steps: defaultFallbackSteps,
    currentStepIndex: 0,
    completed: false,
    createdAt: Date.now(),
  };

  try {
    const ai = createAvelutAI(appSettings, userProfile, {
      endpointPreference: 'openai_compatible_first',
      feature: 'study_guide_chat',
    });

    if (!ai) {
      writeCachedJson(storageKey, defaultStructure, userProfile?.uid);
      return defaultStructure;
    }

    const prompt = `Create a fast, concise 4-step learning structure JSON for the topic "${topicTitle}" ${courseTitle ? `in course "${courseTitle}"` : ''}.
${context ? `Context: ${context}` : ''}

Respond ONLY with valid raw JSON adhering strictly to this format:
{
  "steps": [
    {
      "stepIndex": 0,
      "title": "Short Step Title",
      "objective": "Concise objective of this micro-step",
      "keyConcepts": ["Concept 1", "Concept 2"]
    }
  ]
}

Ensure exactly 4 logical micro-steps ordered from introduction to practical problem solving. Do NOT wrap in markdown code blocks or add conversation text.`;

    const res = await ai.models.generateContent({
      model: 'qwen/qwen3.7-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
        maxOutputTokens: 350,
      },
    });

    const text = getResponseText(res);
    const parsed = cleanAndParseJson<{ steps: TopicStep[] }>(text, { fallback: { steps: [] } });

    if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      const formattedSteps: TopicStep[] = parsed.steps.map((s, idx) => ({
        stepIndex: idx,
        title: s.title || `Step ${idx + 1}`,
        objective: s.objective || `Learn step ${idx + 1} of ${topicTitle}`,
        keyConcepts: Array.isArray(s.keyConcepts) ? s.keyConcepts : [],
      }));

      const newStructure: TopicStructureData = {
        topicKey,
        topicTitle,
        courseTitle,
        steps: formattedSteps,
        currentStepIndex: 0,
        completed: false,
        createdAt: Date.now(),
      };

      writeCachedJson(storageKey, newStructure, userProfile?.uid);
      return newStructure;
    }
  } catch (err) {
    console.warn('[topicStructureService] Fast structure generation fallback:', err);
  }

  writeCachedJson(storageKey, defaultStructure, userProfile?.uid);
  return defaultStructure;
}

/**
 * Saves updated topic structure progress to local device storage.
 */
export function saveTopicStructureProgress(
  structure: TopicStructureData,
  userId: string = 'anon'
): void {
  const storageKey = `avelut_topic_structure_v1_${userId}_${structure.topicKey}`;
  writeCachedJson(storageKey, structure, userId);
}
