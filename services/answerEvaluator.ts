/**
 * answerEvaluator.ts — Two-Layer Answer Evaluation System
 *
 * Layer 1: Local deterministic evaluation (no AI call).
 *   - Multiple choice → exact match
 *   - Numeric → parse and compare with 2% tolerance
 *   - Simple formula → normalized string comparison
 *
 * Layer 2: AI evaluation (only when Layer 1 can't confidently evaluate).
 *   - Open-ended reasoning
 *   - Complex explanations
 *   - Misconception classification
 *
 * Cost savings: ~5 of every 9 evaluations per concept can be handled locally.
 */

import type { QuestionType } from '../types/learningQuestion';
import type { MisconceptionType } from './masteryModel';
import { cleanAndParseJson } from '../utils/jsonUtils';

// ── Evaluation result ───────────────────────────────────────────────────────

export interface EvaluationResult {
    isCorrect: boolean;
    confidence: number;         // 0–1: how confident we are in the evaluation
    evaluatedLocally: boolean;  // true = no AI call needed
    feedback: string;
    errorType?: MisconceptionType | null;
    misconceptionDetail?: string;
    score: number;              // 0–1
}

// ── Normalization helpers ───────────────────────────────────────────────────

function normalize(s: string): string {
    return s
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s.-]/g, '')
        .trim();
}

/**
 * Parse a numeric answer from a string, handling:
 *   - Plain numbers: "10", "3.14"
 *   - With units: "10 m/s", "3.14 rad"
 *   - Scientific notation: "1.5e3", "2.5 × 10^3"
 *   - Negative: "-5.2"
 *   - Fractions: "1/2" → 0.5
 */
function parseNumericAnswer(s: string): number | null {
    if (!s || typeof s !== 'string') return null;

    // Strip common unit suffixes and whitespace
    let cleaned = s.trim()
        .replace(/\s*(m\/s|m\/s²|m\/s\^2|kg|N|Pa|J|W|Hz|rad|°|degrees|meters|seconds|joules|newtons|watts)\s*$/i, '')
        .replace(/\\text\{[^}]*\}/g, '')
        .replace(/\$/g, '')
        .trim();

    // Handle fractions like "1/2"
    const fracMatch = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (fracMatch) {
        const num = parseFloat(fracMatch[1]);
        const den = parseFloat(fracMatch[2]);
        if (den !== 0 && !isNaN(num) && !isNaN(den)) return num / den;
    }

    // Handle scientific notation "2.5 × 10^3" or "2.5e3"
    const sciMatch = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*[×x*]\s*10\^?\s*(-?\d+)$/);
    if (sciMatch) {
        return parseFloat(sciMatch[1]) * Math.pow(10, parseInt(sciMatch[2]));
    }

    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
}

// ── Layer 1: Local deterministic evaluation ─────────────────────────────────

/**
 * Attempt to evaluate the answer locally without an AI call.
 * Returns null if the answer can't be confidently evaluated locally.
 */
export function evaluateLocally(
    studentAnswer: string,
    expectedAnswer: string,
    questionType: QuestionType,
): EvaluationResult | null {
    if (!studentAnswer || !expectedAnswer) return null;

    // ── Multiple choice: exact match ──
    if (questionType === 'multiple_choice') {
        const isCorrect = normalize(studentAnswer) === normalize(expectedAnswer);
        return {
            isCorrect,
            confidence: 1.0,
            evaluatedLocally: true,
            feedback: isCorrect ? 'Correct!' : `The correct answer is: ${expectedAnswer}`,
            score: isCorrect ? 1.0 : 0.0,
        };
    }

    // ── Numeric: parse and compare with tolerance ──
    if (questionType === 'numeric') {
        const studentNum = parseNumericAnswer(studentAnswer);
        const correctNum = parseNumericAnswer(expectedAnswer);

        if (studentNum !== null && correctNum !== null) {
            const tolerance = Math.max(Math.abs(correctNum) * 0.02, 0.001); // 2% or 0.001
            const isCorrect = Math.abs(studentNum - correctNum) <= tolerance;
            return {
                isCorrect,
                confidence: 0.95,
                evaluatedLocally: true,
                feedback: isCorrect
                    ? 'Correct!'
                    : `Expected approximately ${expectedAnswer}, but you answered ${studentAnswer}.`,
                errorType: isCorrect ? null : 'formula_misuse',
                score: isCorrect ? 1.0 : 0.0,
            };
        }
    }

    // ── Formula: normalized string comparison (basic) ──
    if (questionType === 'formula') {
        const normStudent = normalize(studentAnswer);
        const normExpected = normalize(expectedAnswer);
        if (normStudent === normExpected) {
            return {
                isCorrect: true,
                confidence: 0.9,
                evaluatedLocally: true,
                feedback: 'Correct!',
                score: 1.0,
            };
        }
        // Can't confidently say it's wrong — formulas can be expressed differently
        // Fall through to Layer 2
    }

    // Can't evaluate locally → return null, triggers Layer 2
    return null;
}

// ── Layer 2: AI evaluation ──────────────────────────────────────────────────

/**
 * Evaluate an open-ended or complex answer using AI.
 * Also classifies the misconception type for repair targeting.
 */
export async function evaluateWithAI(
    studentAnswer: string,
    expectedAnswer: string,
    conceptContext: string,
    aiClient: any,
    model: string,
): Promise<EvaluationResult> {
    const prompt = `You are evaluating a student's answer in a STEM tutoring session.

CONCEPT CONTEXT: ${conceptContext}
EXPECTED ANSWER: "${expectedAnswer}"
STUDENT'S ANSWER: "${studentAnswer}"

Evaluate the student's answer and respond with VALID JSON ONLY:
{
    "isCorrect": true/false,
    "score": 0.0 to 1.0 (partial credit allowed),
    "feedback": "Brief, encouraging feedback explaining what was right or wrong",
    "errorType": "relationship_error" | "definition_confusion" | "formula_misuse" | "sign_direction_error" | "unit_confusion" | "prerequisite_gap" | "overgeneralization" | null,
    "misconceptionDetail": "Specific description of what the student got wrong, or null if correct"
}

SCORING GUIDE:
- 1.0: Fully correct
- 0.7-0.9: Mostly correct with minor issues
- 0.4-0.6: Partially correct, shows some understanding
- 0.1-0.3: Mostly wrong but shows some effort
- 0.0: Completely wrong or no attempt

IMPORTANT: Be encouraging but honest. If the student is wrong, classify the error type precisely.`;

    try {
        const result = await aiClient.models.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { responseMimeType: 'application/json', temperature: 0.2 },
        });

        const raw = typeof result?.text === 'string'
            ? result.text
            : result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const parsed = cleanAndParseJson<any>(raw, { fallback: {} });

        return {
            isCorrect: parsed.isCorrect ?? false,
            confidence: 0.85,
            evaluatedLocally: false,
            feedback: parsed.feedback || 'Unable to evaluate.',
            errorType: parsed.errorType || null,
            misconceptionDetail: parsed.misconceptionDetail || undefined,
            score: typeof parsed.score === 'number' ? parsed.score : (parsed.isCorrect ? 1.0 : 0.0),
        };
    } catch (err) {
        console.warn('[AnswerEvaluator] AI evaluation fallback activated:', err);
        // Smart fallback on network failure: fuzzy match student tokens against expected answer
        const sClean = studentAnswer.toLowerCase().replace(/[^\w\s]/g, '');
        const eClean = expectedAnswer.toLowerCase().replace(/[^\w\s]/g, '');
        const eWords = eClean.split(/\s+/).filter(w => w.length > 3);
        const matchCount = eWords.filter(w => sClean.includes(w)).length;
        const isFuzzyCorrect = eWords.length > 0 && (matchCount / eWords.length >= 0.5);

        return {
            isCorrect: isFuzzyCorrect,
            confidence: 0.6,
            evaluatedLocally: true,
            feedback: isFuzzyCorrect
                ? 'Great thinking! Your explanation touches on the core concept.'
                : 'Good effort. Let us take a closer look at the key relationship here.',
            score: isFuzzyCorrect ? 1.0 : 0.5,
        };
    }
}

// ── Hint request detection ──────────────────────────────────────────────────

/**
 * Detects if the student's response is asking for a hint rather than answering.
 */
export function isHintRequest(studentAnswer: string): boolean {
    const hintPatterns = /\b(hint|help|clue|stuck|don'?t know|idk|not sure|no idea|confused|i give up|show me)\b/i;
    return hintPatterns.test(studentAnswer.trim());
}

import type { LearningQuestion } from '../types/learningQuestion';

/**
 * Main 2-layer evaluation orchestrator:
 * 1. Checks Layer 1 deterministic evaluation (exact, numeric tolerance, normalized formula).
 * 2. Falls back to Layer 2 Alibaba Qwen AI model for conceptual and open-ended student answers.
 */
export async function evaluateStudentAnswer(
    question: LearningQuestion,
    studentAnswer: string,
    dialogueContext: string,
    aiClient: any,
    model: string = 'qwen/qwen3.7-flash'
): Promise<{
    isCorrect: boolean;
    misconceptionType?: MisconceptionType;
    feedback: string;
    score: number;
    evaluatedLocally: boolean;
}> {
    if (!question) {
        return {
            isCorrect: true,
            feedback: 'Good response. Let us continue.',
            score: 1.0,
            evaluatedLocally: true,
        };
    }

    // 1. Try Layer 1 Local Deterministic Evaluation
    const localRes = evaluateLocally(studentAnswer, question.expectedAnswer, question.type);
    if (localRes !== null) {
        return {
            isCorrect: localRes.isCorrect,
            misconceptionType: (localRes.errorType as MisconceptionType) || undefined,
            feedback: localRes.feedback,
            score: localRes.score,
            evaluatedLocally: true,
        };
    }

    if (!aiClient) {
        return {
            isCorrect: true,
            feedback: 'Proceeding to next step.',
            score: 1.0,
            evaluatedLocally: true,
        };
    }

    // 2. Fall back to Layer 2 AI Evaluation
    const aiRes = await evaluateWithAI(
        studentAnswer,
        question.expectedAnswer,
        `Question: ${question.question}\nContext: ${dialogueContext}`,
        aiClient,
        model
    );

    return {
        isCorrect: aiRes.isCorrect,
        misconceptionType: (aiRes.errorType as MisconceptionType) || undefined,
        feedback: aiRes.feedback,
        score: aiRes.score,
        evaluatedLocally: false,
    };
}
