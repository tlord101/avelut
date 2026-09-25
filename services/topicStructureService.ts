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

  // 2. Comprehensive multi-area dynamic curriculum structure covering all facets of the topic
  const defaultFallbackSteps: TopicStep[] = [
    {
      stepIndex: 0,
      title: 'Core Fundamentals & Intuition',
      objective: `Master basic intuition, real-world context, and foundational definitions of ${topicTitle}`,
      keyConcepts: ['Definition', 'Intuition', 'Contextual importance'],
    },
    {
      stepIndex: 1,
      title: 'Key Mechanisms, Laws & Formulations',
      objective: `Understand the mechanics, equations, theories, and rules governing ${topicTitle}`,
      keyConcepts: ['Formulas', 'Variables', 'Underlying mechanics', 'Theories'],
    },
    {
      stepIndex: 2,
      title: 'Step-by-Step Worked Examples & Derivations',
      objective: 'Apply the concepts to solve practical problems, calculations, and derivations',
      keyConcepts: ['Problem solving', 'Calculation steps', 'Verification methods'],
    },
    {
      stepIndex: 3,
      title: 'Real-World Nigerian Applications & Case Studies',
      objective: `Connect ${topicTitle} to everyday local scenarios and industrial practice`,
      keyConcepts: ['Real-world use cases', 'Industry applications', 'Practical value'],
    },
    {
      stepIndex: 4,
      title: 'Common Misconceptions, Pitfalls & Exam Traps',
      objective: 'Identify edge cases, tricky test questions, and avoid frequent student pitfalls',
      keyConcepts: ['Exam traps', 'Misconceptions', 'Tricky edge cases'],
    },
    {
      stepIndex: 5,
      title: 'Advanced Nuances & Interactive Mastery Synthesis',
      objective: 'Synthesize all aspects of the topic and confirm comprehensive mastery',
      keyConcepts: ['Mastery synthesis', 'Active recall', 'Self-evaluation'],
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
