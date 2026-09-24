/**
 * teachingPlanService.ts
 *
 * Pre-generates and caches structured, duration-aware pedagogical teaching plans
 * for Avelut's Realtime Live AI Teacher.
 *
 * Provides the voice model with clear time pacing, visual roadmap, and
 * phase transition triggers without exposing visual clutter in the student UI.
 */

import { readCachedJson, writeCachedJson } from '../../utils/cache';
import { createAvelutAI, getResponseText } from '../../utils/inference';
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

// ─── Instant High-Quality Fallbacks ───────────────────────────────────────────

function getFallbackTeachingPlan(
  topicTitle: string,
  courseName: string = 'Academic Course',
  durationMinutes: 15 | 30 | 60 = 30
): TeachingPlan {
  if (durationMinutes === 15) {
    return {
      topicTitle,
      courseName,
      durationMinutes: 15,
      totalPhases: 3,
      createdAt: Date.now(),
      summaryTakeaways: [
        `Core intuition of ${topicTitle}`,
        `Main working rule or mechanism`,
        `Real-world application check`,
      ],
      phases: [
        {
          phaseIndex: 1,
          phaseName: 'Real-World Intuition & Analogy',
          timeBudgetMins: 3,
          pedagogicalGoal: `Understand why ${topicTitle} exists using a 10-year-old friendly analogy.`,
          speechFocus: `Warm greeting, introduce the big idea in everyday terms without jargon.`,
          boardVisualPlan: {
            action: 'write',
            content: `${topicTitle} • Real World Analogy`,
            instruction: `Silently write "${topicTitle}" and 1–2 keywords of the analogy on the board.`,
          },
          transitionTrigger: `Once the student understands the intuition and confirms it makes sense.`,
        },
        {
          phaseIndex: 2,
          phaseName: 'Core Rule, Mechanics & Board Visual',
          timeBudgetMins: 8,
          pedagogicalGoal: `Grasp the main principle, equation, or process steps of ${topicTitle}.`,
          speechFocus: `Walk through the primary mechanism step by step. Keep sentences concise.`,
          boardVisualPlan: {
            action: 'mermaid',
            content: `flowchart LR\nA[Cause/Input] --> B[Mechanism/Action] --> C[Output/Result]`,
            instruction: `Silently render a concise diagram or write the central formula with key labels.`,
          },
          transitionTrigger: `When the main mechanism is explained and visible on the board.`,
        },
        {
          phaseIndex: 3,
          phaseName: 'Quick Check-in & Key Takeaways',
          timeBudgetMins: 4,
          pedagogicalGoal: `Check student grasp with an easy challenge question and summarize key points.`,
          speechFocus: `Ask one fun question to test understanding, gently explain the answer, and summarize.`,
          boardVisualPlan: {
            action: 'write',
            content: `Key Takeaway: Remember the core principle of ${topicTitle}`,
            instruction: `Silently write a 3-bullet summary list on the board.`,
          },
          transitionTrigger: `End of lesson wrap-up and congratulatory praise.`,
        },
      ],
    };
  }

  if (durationMinutes === 60) {
    return {
      topicTitle,
      courseName,
      durationMinutes: 60,
      totalPhases: 5,
      createdAt: Date.now(),
      summaryTakeaways: [
        `Deep conceptual understanding of ${topicTitle}`,
        `Fundamental laws, variables, and formulas`,
        `Step-by-step problem solving mastery`,
        `Avoiding classic mistakes and misconceptions`,
      ],
      phases: [
        {
          phaseIndex: 1,
          phaseName: 'Foundation & Real-World Framing',
          timeBudgetMins: 8,
          pedagogicalGoal: `Build deep intuitive curiosity about ${topicTitle} with vivid real-life examples.`,
          speechFocus: `Connect ${topicTitle} to everyday wonders (space, technology, nature, sports).`,
          boardVisualPlan: {
            action: 'write',
            content: `${topicTitle}: Foundations & Real-World Impact`,
            instruction: `Silently write the lesson title and the 3 big questions we will answer today.`,
          },
          transitionTrigger: `Student is engaged and understands why this topic matters.`,
        },
        {
          phaseIndex: 2,
          phaseName: 'Deep Conceptual Breakdown & Anatomy',
          timeBudgetMins: 16,
          pedagogicalGoal: `Unpack every component, law, or phase of ${topicTitle} with visual diagrams.`,
          speechFocus: `Deconstruct the concept part by part. Use Mermaid diagram or illustration.`,
          boardVisualPlan: {
            action: 'mermaid',
            content: `graph TD\nA[Component 1] --> B[Core Engine] --> C[Result]`,
            instruction: `Silently call draw_mermaid or illustrate_object to display the system structure.`,
          },
          transitionTrigger: `When all components have been systematically explained.`,
        },
        {
          phaseIndex: 3,
          phaseName: 'Formulas, Derivations & Quantitative Rules',
          timeBudgetMins: 14,
          pedagogicalGoal: `Introduce formulas, units, and mathematical or logical relationships.`,
          speechFocus: `Explain what each variable represents like parts of a recipe.`,
          boardVisualPlan: {
            action: 'write',
            content: `Key Formula: Definition of variables and units`,
            instruction: `Silently write the formula in $$ ... $$ and label each variable clearly.`,
          },
          transitionTrigger: `Student understands what each symbol means in the formula.`,
        },
        {
          phaseIndex: 4,
          phaseName: 'Guided Worked Examples & Interactive Practice',
          timeBudgetMins: 14,
          pedagogicalGoal: `Solve a realistic exam-style or practical problem together step by step.`,
          speechFocus: `Pose a problem, write given values on board, ask student for the next move.`,
          boardVisualPlan: {
            action: 'draw',
            content: `Step 1 -> Step 2 -> Final Answer`,
            instruction: `Silently draw step boxes showing the calculation path on the board.`,
          },
          transitionTrigger: `Problem is completely solved and verified.`,
        },
        {
          phaseIndex: 5,
          phaseName: 'Misconception Trap & Masterclass Summary',
          timeBudgetMins: 8,
          pedagogicalGoal: `Clarify common exam pitfalls and synthesize key rules into memory.`,
          speechFocus: `Highlight the #1 mistake students make. Review key takeaways warmly.`,
          boardVisualPlan: {
            action: 'write',
            content: `Remember: 1. Core Rule | 2. Common Trap to Avoid`,
            instruction: `Silently write the final summary checklist on the board.`,
          },
          transitionTrigger: `Final lesson sign-off with encouraging praise.`,
        },
      ],
    };
  }

  // Default: 30 minutes (4 phases)
  return {
    topicTitle,
    courseName,
    durationMinutes: 30,
    totalPhases: 4,
    createdAt: Date.now(),
    summaryTakeaways: [
      `Intuition behind ${topicTitle}`,
      `Key mechanics and visual model`,
      `Practical worked example`,
      `Key rules and summary`,
    ],
    phases: [
      {
        phaseIndex: 1,
        phaseName: 'Warm Hook & Intuition',
        timeBudgetMins: 4,
        pedagogicalGoal: `Establish an effortless, intuitive foundation for ${topicTitle}.`,
        speechFocus: `Greet warmly and explain the concept with a simple everyday scenario (like a 10-year-old).`,
        boardVisualPlan: {
          action: 'write',
          content: `${topicTitle} • Big Idea: Simple Everyday Intuition`,
          instruction: `Silently write "${topicTitle}" and the big idea keyword on the board.`,
        },
        transitionTrigger: `Student feels comfortable and understands the core analogy.`,
      },
      {
        phaseIndex: 2,
        phaseName: 'Core Mechanics & Visual Diagram',
        timeBudgetMins: 9,
        pedagogicalGoal: `Teach the main rule, mechanism, or cycle using visual board representations.`,
        speechFocus: `Break down how it actually works. Explain parts clearly as board updates.`,
        boardVisualPlan: {
          action: 'mermaid',
          content: `flowchart LR\nInput --> Process --> Output`,
          instruction: `Silently render a Mermaid diagram or clear diagram boxes for the process.`,
        },
        transitionTrigger: `All major parts and interactions have been explained.`,
      },
      {
        phaseIndex: 3,
        phaseName: 'Step-by-Step Worked Example & Practice',
        timeBudgetMins: 11,
        pedagogicalGoal: `Apply the concept to a real example or calculation.`,
        speechFocus: `Walk through a concrete problem step by step. Ask student for thoughts.`,
        boardVisualPlan: {
          action: 'write',
          content: `Example: Step 1 -> Step 2 -> Solution`,
          instruction: `Silently write each step of the calculation or application on the board.`,
        },
        transitionTrigger: `Solution is complete and student confirms understanding.`,
      },
      {
        phaseIndex: 4,
        phaseName: 'Common Pitfalls & Key Summary',
        timeBudgetMins: 6,
        pedagogicalGoal: `Prevent common mix-ups and anchor the 3 biggest takeaways.`,
        speechFocus: `Point out a classic misconception, give the fix, and review main points.`,
        boardVisualPlan: {
          action: 'write',
          content: `Key Takeaways: 1. Main Rule | 2. How it works | 3. Trap to avoid`,
          instruction: `Silently write the 3 bullet recap list on the board.`,
        },
        transitionTrigger: `Lesson wrap-up and encouraging sign-off.`,
      },
    ],
  };
}

// ─── Main Service Function ──────────────────────────────────────────────────

/**
 * Retrieves cached teaching plan or generates a fresh one using fast LLM inference.
 * Always resolves swiftly with a rock-solid plan.
 */
export async function getOrGenerateTeachingPlan(
  params: GenerateTeachingPlanParams
): Promise<TeachingPlan> {
  const {
    topicTitle,
    courseName = 'Academic Course',
    syllabusContext = '',
    durationMinutes = 30,
    userProfile,
    appSettings,
  } = params;

  const uid = userProfile?.uid || 'anon';
  const cleanKey = topicTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
  const cacheKey = `avelut_teaching_plan_${uid}_${cleanKey}_${durationMinutes}m`;

  // 1. Check local device cache
  const cached = readCachedJson<TeachingPlan | null>(cacheKey, null);
  if (cached && Array.isArray(cached.phases) && cached.phases.length > 0) {
    return cached;
  }

  // 2. Prepare high-quality fallback immediately
  const fallbackPlan = getFallbackTeachingPlan(topicTitle, courseName, durationMinutes);

  // If no API settings are available, return the structured fallback immediately
  if (!appSettings) {
    writeCachedJson(cacheKey, fallbackPlan, uid);
    return fallbackPlan;
  }

  // 3. Return fallback instantly so the lesson never waits, then generate AI
  //    plan in the background and cache it for the next session.
  //    Alibaba Qwen models (qwen3.7-flash, qwen-plus, etc.) can take 5–30 s
  //    when routed through the proxy; we give them up to 60 s in background.
  const targetPhaseCount = durationMinutes === 15 ? 3 : durationMinutes === 60 ? 5 : 4;

  const buildPrompt = () => `You are a master curriculum architect. Create a structured, time-paced teaching plan for an interactive 1-on-1 live voice tutorial.
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
- Every phase MUST include actionable board visual plan.`;

  // Fire-and-forget background AI generation (60 s budget for thinking models)
  const generateInBackground = async () => {
    try {
      const ai = createAvelutAI(appSettings!);
      const fetchPromise = ai.models.generateContent({ contents: buildPrompt() });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI generation timeout (60 s)')), 60_000)
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
          summaryTakeaways: parsed.summaryTakeaways || fallbackPlan.summaryTakeaways,
          createdAt: Date.now(),
        };
        writeCachedJson(cacheKey, validatedPlan, uid);
        console.log('[teachingPlanService] Background AI plan cached for next session:', topicTitle);
      }
    } catch (err) {
      console.warn('[teachingPlanService] Background AI generation failed (will retry next session):', err);
    }
  };

  // Kick off background generation without awaiting it
  generateInBackground();

  // 4. Return structured fallback immediately so the lesson starts right away
  writeCachedJson(cacheKey, fallbackPlan, uid);
  return fallbackPlan;
}
