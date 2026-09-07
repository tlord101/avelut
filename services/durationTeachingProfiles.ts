/**
 * Duration-mode teaching profiles — illustration-first on every mode.
 */
import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';

export interface DurationTeachingProfile {
  minutes: LessonDurationMode;
  boardCountHint: string;
  speechWordRange: string;
  toneRules: string;
  pacingRules: string;
  structureExtra: string;
  boardExtra: string;
}

const SHARED_ILLUSTRATION = `ILLUSTRATION-FIRST (always):
- At least one progressive figure when the idea is visual (most boards).
- 2-5 path/line/arrow/circle draws building with speech beats.
- Text: title top + at most 3 short bullets margin OR one formula — never paragraphs.
- Figure sits in center band; speech carries the depth.`;

export const DURATION_PROFILES: Record<LessonDurationMode, DurationTeachingProfile> = {
  15: {
    minutes: 15,
    boardCountHint: 'Plan 7 to 8 boards. Each board MUST last ~2 minutes of teaching speech (~200-260 words per board).',
    speechWordRange: '200 to 260 words per board (~2 minutes of spoken lecturer explanation per board)',
    toneRules: 'Efficient coach. Minimal small talk. Clear, direct, and thorough step-by-step teaching.',
    pacingRules: 'Paced teaching (~2 mins per board); short 1-2s reflection pause after key formulas or diagrams.',
    structureExtra: `STEP TYPES: prefer hook, concept, definition, worked_example, summary.
Every board needs a concrete visual_purpose (what is drawn). Each board MUST provide ~2 minutes of full teaching speech.
${SHARED_ILLUSTRATION}`,
    boardExtra: `SPEECH: rich, high-signal, ~2-minute lecture speech per board (~200-260 words).
BOARD: 1 strong progressive illustration (2-5 path strokes) + title + formula/bullets.
${SHARED_ILLUSTRATION}`,
  },
  30: {
    minutes: 30,
    boardCountHint: 'Plan 14 to 16 boards covering intuition through application. Each board MUST last ~2 minutes of teaching speech (~220-280 words per board).',
    speechWordRange: '220 to 280 words per board (~2 minutes of spoken lecturer explanation per board)',
    toneRules: 'Friendly university tutor. Occasional encouragement. Address the student by name occasionally.',
    pacingRules: 'Paced teaching (~2 mins per board); short reflection pauses after key diagrams or formulas (pauseAfterMs 1500-3500).',
    structureExtra: `Include intuition, mechanism, worked_example, misconception_check, and question boards. Each board MUST be ~2 minutes of active teaching.
visual_purpose must describe a drawable figure for almost every board.
${SHARED_ILLUSTRATION}`,
    boardExtra: `SPEECH: comprehensive 2-minute walkthrough per board; clear step-by-step depth.
BOARD: draw base -> draw relation -> optional highlight; sparse big text.
Use mannerism reflection_pause or check_understanding sparingly.
${SHARED_ILLUSTRATION}`,
  },
  60: {
    minutes: 60,
    boardCountHint:
      'Plan 28 to 32 boards organized into 4-6 chapters/sections. Each board MUST last ~2 minutes of teaching speech (~240-320 words per board). Full live lecture.',
    speechWordRange: '240 to 320 words per board (~2 minutes of spoken lecturer explanation per board)',
    toneRules: `REAL HUMAN LECTURER:
- Talk to the student by name.
- Light academic jokes and asides, then continue the syllabus.
- Rhetorical questions: "Still with me?", "Why does this matter?"
- NEVER monologue non-stop: insert natural breaks.`,
    pacingRules: `PACED LECTURE (~2 MINS PER BOARD):
- Speech per board takes ~2 minutes of clear teaching.
- After major ideas, mannerism "reflection_pause" with pauseAfterMs 2000-5000.
- Every 6-8 boards, soft check-in.`,
    structureExtra: `REQUIRED: chapters. Put chapter in titles like "[Ch 2] Net force intuition".
Sequence: hook -> intuition -> core -> worked example -> trap -> practice -> summary. Each board is a ~2-minute deep dive.
3-6 question or misconception_check boards.
${SHARED_ILLUSTRATION}`,
    boardExtra: `SPEECH BEATS (4-8): ~2 minutes of rich lecturer speech + visual drawing triggers.
BOARD: progressive path draws first; secondary title/bullets/formula only.
${SHARED_ILLUSTRATION}`,
  },
};

export function getDurationProfile(mode: LessonDurationMode): DurationTeachingProfile {
  return DURATION_PROFILES[mode] || DURATION_PROFILES[30];
}
