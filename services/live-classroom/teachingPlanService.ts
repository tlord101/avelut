/**
 * teachingPlanService.ts
 *
 * Pre-generates and caches structured, duration-aware pedagogical teaching plans
 * for Avelut's Realtime Live AI Teacher using the app's configured text model.
 *
 * 100% genuine AI generation — NO hardcoded or synthetic fallback plans.
 */

import { readCachedJson, writeCachedJson } from '../../utils/cache';
import { createAvelutAI, getResponseText, OPENROUTER_MODEL } from '../../utils/inference';
import { getFeatureModel } from '../../utils/usage';
import { cleanAndParseJson } from '../../utils/jsonUtils';
import type { AppSettings, UserProfile } from '../../types';

// ─── Interfaces ─────────────────────────────────────────────────────────────

export interface LessonPhase {
  phaseIndex: number;
  phaseName: string;
  timeBudgetMins: number;
  pedagogicalGoal: string;
  speechFocus: string;
  boardVisualPlan: {
    action: 'write' | 'draw' | 'mermaid' | 'illustrate';
    content: string;
    instruction: string;
  };
  transitionTrigger: string;
}

export interface TeachingPlan {
  topicTitle: string;
  courseName: string;
  durationMinutes: 15 | 30 | 60;
  totalPhases: number;
  phases: LessonPhase[];
  summaryTakeaways: string[];
  createdAt: number;
}

export interface GenerateTeachingPlanParams {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  durationMinutes?: 15 | 30 | 60;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
}

/**
 * Retrieves cached teaching plan or generates a fresh one using genuine AI inference.
 * Returns null if generation fails or API settings are unavailable (no fake fallbacks).
 */
export async function getOrGenerateTeachingPlan(
  params: GenerateTeachingPlanParams
): Promise<TeachingPlan | null> {
  const {
    topicTitle,
    courseName = 'Academic Course',
    syllabusContext = '',
    durationMinutes = 30,
    userProfile,
    appSettings,
  } = params;

  if (!topicTitle) return null;

  const uid = userProfile?.uid || 'anon';
  const cleanKey = topicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  const cacheKey = `avelut_teaching_plan_${uid}_${cleanKey}_${durationMinutes}m`;

  // 1. Check local device cache for previously generated genuine AI plan
  const cached = readCachedJson<TeachingPlan | null>(cacheKey, null);
  if (cached && Array.isArray(cached.phases) && cached.phases.length > 0) {
    return cached;
  }

  // If no API settings are available, return null (strictly no fake fallbacks)
  if (!appSettings) {
    return null;
  }

  const targetPhaseCount = durationMinutes === 15 ? 3 : durationMinutes === 60 ? 5 : 4;

  const prompt = `You are a master curriculum architect. Create a structured, time-paced teaching plan for an interactive 1-on-1 live voice tutorial.
Topic: "${topicTitle}"
Course: "${courseName}"
${syllabusContext ? `Syllabus / Context: "${syllabusContext}"` : ''}
Duration: ${durationMinutes} minutes
Target Audience: Student needs simple, intuitive explanations (like age 10) with clear board visual actions.

Output ONLY a valid JSON object matching this schema without markdown fences:
{
  "topicTitle": "${topicTitle}",
  "courseName": "${courseName}",
  "durationMinutes": ${durationMinutes},
  "totalPhases": ${targetPhaseCount},
  "phases": [
    {
      "phaseIndex": 1,
      "phaseName": "Short descriptive phase title",
      "timeBudgetMins": number,
      "pedagogicalGoal": "Specific learning goal for this phase",
      "speechFocus": "What the teacher should speak in simple plain words",
      "boardVisualPlan": {
        "action": "write" | "draw" | "mermaid" | "illustrate",
        "content": "keywords or diagram code/description",
        "instruction": "Silent board instruction for the teacher"
      },
      "transitionTrigger": "Condition to advance to the next phase"
    }
  ],
  "summaryTakeaways": ["key point 1", "key point 2", "key point 3"]
}

Rules:
- Total sum of timeBudgetMins across all phases must equal approximately ${durationMinutes}.
- Exactly ${targetPhaseCount} phases.
- Every phase MUST include actionable board visual plan.
- At least 2 phases MUST feature a visual diagram or illustration ("mermaid", "illustrate", or "draw") rather than plain text only.`;

  try {
    const textModel =
      getFeatureModel('chat_interaction', appSettings) ||
      appSettings?.alibaba_model ||
      'qwen3.8-omni-flash';

    const ai = createAvelutAI(appSettings, userProfile, { feature: 'chat_interaction' });
    const fetchPromise = ai.models.generateContent({
      model: textModel,
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 2000,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('AI generation timeout (25 s)')), 25_000)
    );

    const response = await Promise.race([fetchPromise, timeoutPromise]);
    const rawText = getResponseText(response);
    const parsed = cleanAndParseJson<TeachingPlan>(rawText);

    if (parsed && Array.isArray(parsed.phases) && parsed.phases.length > 0) {
      const validatedPlan: TeachingPlan = {
        topicTitle: parsed.topicTitle || topicTitle,
        courseName: parsed.courseName || courseName,
        durationMinutes,
        totalPhases: parsed.phases.length,
        phases: parsed.phases,
        summaryTakeaways: parsed.summaryTakeaways || [],
        createdAt: Date.now(),
      };
      writeCachedJson(cacheKey, validatedPlan, uid);
      console.log('[teachingPlanService] Genuine AI plan generated and cached:', topicTitle);
      return validatedPlan;
    }
    return null;
  } catch (err) {
    console.warn('[teachingPlanService] AI teaching plan generation failed:', err);
    return null;
  }
}
