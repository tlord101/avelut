/**
 * Teaching Director Prompts — illustration-first live board
 */

import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import { getDurationProfile } from './durationTeachingProfiles';
import { ILLUSTRATION_FIRST_PROMPT_BLOCK } from './boardIllustrationRules';

export const TEACHING_DIRECTOR_SYSTEM_PROMPT = `You are Avelut's AI Teaching Director performing as a world-class university lecturer at a live digital chalkboard.

CORE PHILOSOPHY:
- You are an EDUCATIONAL SCIENTIFIC ILLUSTRATOR and LECTURER, NOT a text generator or icon picker.
- You talk directly to the student in natural spoken language.
- BOARD PRIORITY: illustrations first (path/line/arrow/circle). Text is secondary.
- NEVER put giant walls of text on the board. Speech carries verbal depth.
- Do NOT use predefined diagram primitives. Compose from path commands or optional full SVG.
- Synchronize speech beats with progressive board drawing.

${ILLUSTRATION_FIRST_PROMPT_BLOCK}

HARD OUTPUT REQUIREMENT:
Return ONLY clean, valid JSON matching the exact schema requested without markdown wrappers or trailing comments.`;

export function buildTeachingStructurePrompt(params: {
  topic: string;
  courseName?: string;
  syllabusContext?: string;
  studentName?: string;
  durationMode?: LessonDurationMode;
}): string {
  const { topic, courseName, syllabusContext, studentName, durationMode = 30 } = params;
  const resolvedName = studentName || 'Student';
  const profile = getDurationProfile(durationMode);

  return `Prepare a pedagogical Teaching Structure for the topic: "${topic}"
${courseName ? `Course: ${courseName}\n` : ''}${syllabusContext ? `Syllabus/Context: ${syllabusContext}\n` : ''}Student Name: ${resolvedName}
TARGET DURATION MODE: ${durationMode} minutes

You are an expert university professor planning a live lesson for ~${durationMode} minutes of content.

BOARD COUNT: ${profile.boardCountHint}

Every board MUST have a concrete visual_purpose describing what will be DRAWN (not written).
Prefer illustration-heavy boards. Text-only boards only for pure definitions when no figure helps.

${profile.structureExtra}

${durationMode === 60 ? `For 60-minute mode: organize boards into chapters. Include natural break-friendly boards. Student may pause and resume.` : ''}

${ILLUSTRATION_FIRST_PROMPT_BLOCK}

JSON OUTPUT SCHEMA:
{
  "topic": "${topic}",
  "teaching_strategy": "Brief description including duration mode ${durationMode}m",
  "learning_goal": "Clear statement of what the student will master by the end",
  "duration_minutes": ${durationMode},
  "chapters": ["optional chapter titles for 30/60 mode"],
  "boards": [
    {
      "board_id": "board_1",
      "board_number": 1,
      "title": "Clear concise board title",
      "chapter": "optional chapter name",
      "step_type": "hook" | "intuition" | "concept" | "definition" | "mechanism" | "comparison" | "derivation" | "worked_example" | "application" | "question" | "misconception_check" | "summary" | "other",
      "teaching_objective": "Specific goal of this single board",
      "what_student_should_understand": "Key takeaway for the student",
      "why_this_board_exists": "Pedagogical rationale",
      "prerequisite_knowledge": ["item 1"],
      "key_concepts": ["concept 1", "concept 2"],
      "visual_purpose": "What must be DRAWN with paths/arrows (required, concrete)",
      "recommended_board_content": ["Short title or formula only — not paragraphs"],
      "interaction_required": boolean,
      "question_required": boolean,
      "question_type": "recall" | "understanding" | "prediction" | "calculation" | "application" | null,
      "estimated_duration_seconds": 120
    }
  ]
}`;
}

export function buildSingleBoardPrompt(params: {
  topic: string;
  fullStructure: any;
  currentBoardPlan: any;
  studentName?: string;
  completedBoardsSummary?: string[];
  durationMode?: LessonDurationMode;
}): string {
  const {
    topic,
    fullStructure,
    currentBoardPlan,
    studentName,
    completedBoardsSummary,
    durationMode = 30,
  } = params;
  const name = studentName || 'Student';
  const profile = getDurationProfile(durationMode);

  return `Perform as a live university lecturer for Board ${currentBoardPlan.board_number} of ${fullStructure.boards?.length || 5}: "${currentBoardPlan.title}" on the topic "${topic}".

DURATION MODE: ${durationMode} minutes
TONE: ${profile.toneRules}
PACING: ${profile.pacingRules}
TARGET SPEECH LENGTH: ${profile.speechWordRange} (~2 minutes of active speech)

LESSON CONTEXT:
Learning Goal: ${fullStructure.learning_goal}
Completed Boards So Far: ${completedBoardsSummary?.length ? completedBoardsSummary.join(' -> ') : 'None (This is Board 1)'}

CURRENT BOARD PLAN TO PERFORM:
Title: ${currentBoardPlan.title}
Chapter: ${currentBoardPlan.chapter || 'n/a'}
Step Type: ${currentBoardPlan.step_type}
Objective: ${currentBoardPlan.teaching_objective}
Visual Purpose (MUST DRAW THIS): ${currentBoardPlan.visual_purpose}
Recommended Board Content: ${JSON.stringify(currentBoardPlan.recommended_board_content || [])}
Question Required: ${currentBoardPlan.question_required} (${currentBoardPlan.question_type || 'none'})

${ILLUSTRATION_FIRST_PROMPT_BLOCK}

MANDATORY PERFORMANCE REQUIREMENTS:

1. LECTURER SPEECH (~2 MINUTES OF TEACHING SPEECH PER BOARD):
- Natural, rich teaching speech (${profile.speechWordRange}).
- MUST last about 2 minutes of spoken teaching instruction (~200 to 280 words). Do NOT generate short 30-second speech snippets!
- Address ${name} when appropriate.
- Explain step-by-step with deep pedagogical clarity; do NOT just read board text verbatim.
${profile.boardExtra}

2. MASTER SVG TECHNICAL OUTLINE ILLUSTRATION (required):
"Generate a clean, minimalist technical outline illustration in valid SVG format (<svg> wrapper, no markdown block wrappers if parsing raw). Use a 400x200 viewBox, a transparent or white background, crisp strokes with light or dashed outlines for structural paths, distinct accent fills for key focal points, and clear sans-serif text labels. Use semantic classes for styling, thin strokes (stroke-width: 1.5 to 2), and a restrained professional color palette. Position all elements with precise coordinate attributes (x, y, cx, cy) to ensure exact alignment and complete responsiveness."

CORE DESIGN RULES:
- Semantic Classes: Define <defs><style> with .bg, .grid-line, .path-structural, .path-dashed, .path-accent, .fill-node, .fill-accent, .fill-subtle, .text-label, .text-muted, .text-title.
- Color Palette & Line Weights: Restrained palette with thin, deliberate strokes (stroke-width: 1.5 to 2).
- Typography & Coordinates: System sans-serif fonts (-apple-system, sans-serif) with explicit x, y, cx, cy coordinate attributes.
- Scalability: Always include viewBox="0 0 400 200" and set width="100%" height="100%" so it renders responsively.

4. SPEECH BEATS (3-6 typical):
- Attach draws to beats so the figure builds while you talk.
- mannerism: attention | emphasis | transition | reflection_pause | encouragement | check_understanding | null
- pauseAfterMs for reflection (especially ${durationMode === 60 ? '8000-25000 on 60m mode' : '1000-4000'})

JSON OUTPUT SCHEMA:
{
  "board_id": "${currentBoardPlan.board_id}",
  "board_number": ${currentBoardPlan.board_number},
  "title": "${currentBoardPlan.title}",
  "speech": "Full natural speech...",
  "speech_beats": [
    {
      "id": "beat_1",
      "text": "First spoken chunk introducing the visual...",
      "purpose": "introduce figure",
      "mannerism": "attention",
      "pauseAfterMs": 1200,
  "board_actions": [
    {
      "id": "title_${currentBoardPlan.board_number}",
      "type": "write",
      "content": "${currentBoardPlan.title}",
      "position": { "x": 50, "y": 10 },
      "metadata": { "fontSize": "3xl", "color": "#FFFFFF" },
      "sync": { "triggerImmediately": true }
    },
    {
      "id": "kt_1",
      "type": "write",
      "content": "• First key concept takeaway",
      "position": { "x": 20, "y": 30 },
      "metadata": { "fontSize": "2xl", "color": "#E2E8F0" },
      "sync": { "phrase": "First key concept takeaway" }
    },
    {
      "id": "kt_2",
      "type": "write",
      "content": "• Second key concept takeaway",
      "position": { "x": 20, "y": 44 },
      "metadata": { "fontSize": "2xl", "color": "#E2E8F0" },
      "sync": { "phrase": "Second key concept takeaway" }
    }
  ],
  "svg_illustration": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 200\" width=\"100%\" height=\"100%\"><defs><style>.bg{fill:transparent;}.grid-line{stroke:rgba(255,255,255,0.08);stroke-width:1;}.path-structural{stroke:#cbd5e1;stroke-width:1.5;fill:none;}.path-accent{stroke:#38bdf8;stroke-width:2;fill:none;}.fill-node{fill:#0f172a;stroke:#38bdf8;stroke-width:2;}.fill-accent{fill:rgba(56,189,248,0.18);stroke:#38bdf8;stroke-width:1.5;}.text-label{font-family:sans-serif;font-size:10px;fill:#ffffff;}.text-muted{font-family:sans-serif;font-size:8px;fill:#94a3b8;}.text-title{font-family:sans-serif;font-size:11px;fill:#38bdf8;font-weight:bold;}</style></defs><!-- Precise coordinate nodes, lines, and text labels --></svg>",
  "question": ${currentBoardPlan.question_required
    ? `{
    "id": "q_board_${currentBoardPlan.board_number}",
    "type": "${currentBoardPlan.question_type || 'understanding'}",
    "question": "Clear spoken question",
    "waitForAnswer": true,
    "expectedConcepts": ["concept1"],
    "options": ["Option A", "Option B", "Option C"]
  }`
    : 'null'}
}`;
}

export function buildFinalTestPrompt(params: {
  topic: string;
  teachingStructure: any;
}): string {
  const { topic, teachingStructure } = params;

  return `Generate a final mini assessment for the topic "${topic}" based strictly on the material taught:
Learning Goal: ${teachingStructure.learning_goal}
Boards Taught: ${JSON.stringify(teachingStructure.boards?.map((b: any) => b.title) || [])}

RULES:
- Generate 3 to 5 clear, high-quality questions.
- Mix types: recall, understanding, application, calculation.
- Multiple-choice with correct answers and brief explanations.

JSON OUTPUT SCHEMA:
{
  "topic": "${topic}",
  "questions": [
    {
      "id": "test_q1",
      "type": "understanding" | "recall" | "application" | "calculation",
      "question": "Question text...",
      "options": ["A) Choice 1", "B) Choice 2", "C) Choice 3", "D) Choice 4"],
      "correctAnswer": "A) Choice 1",
      "explanation": "Why this answer is correct."
    }
  ]
}`;
}

export function buildStudentAnswerEvaluationPrompt(params: {
  topic: string;
  boardTitle: string;
  question: string;
  expectedConcepts?: string[];
  studentAnswer: string;
}): string {
  return `Student answered during live lesson on "${params.topic}" (Board: "${params.boardTitle}").
Question: "${params.question}"
Expected Concepts: ${JSON.stringify(params.expectedConcepts || [])}
Student's Answer: "${params.studentAnswer}"

Provide encouraging, concise lecturer feedback.

JSON OUTPUT SCHEMA:
{
  "isCorrect": boolean,
  "score": "correct" | "partially_correct" | "misconception",
  "spokenFeedback": "1 to 3 warm lecturer sentences",
  "boardActions": [],
  "followUpObjective": "brief next step"
}`;
}

export function buildStudentInterruptionPrompt(params: {
  topic: string;
  currentBoardTitle: string;
  studentQuestion: string;
}): string {
  return `Student asked while pausing live lesson on "${params.topic}" (Board: "${params.currentBoardTitle}"):
"${params.studentQuestion}"

Answer clearly. Prefer a simple path draw + short title if a figure helps; otherwise short text only.

${ILLUSTRATION_FIRST_PROMPT_BLOCK}

JSON OUTPUT SCHEMA:
{
  "spokenAnswer": "80 to 120 words of clear lecturer speech.",
  "boardActions": [
    {
      "id": "ask_draw",
      "type": "draw",
      "position": { "x": 50, "y": 55 },
      "metadata": {
        "drawType": "path",
        "d": "M35 45 L65 45 L65 70 L35 70 Z",
        "color": "#38BDF8",
        "durationMs": 800
      }
    },
    {
      "id": "ask_title",
      "type": "write",
      "content": "Short answer title",
      "position": { "x": 50, "y": 10 },
      "metadata": { "fontSize": "2xl", "color": "#FFFFFF" }
    }
  ]
}`;
}
