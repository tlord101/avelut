/**
 * VisualIllustrationEngine.ts
 *
 * Async AI Visual Illustration Engine for Avelut Live Classroom.
 * Powered by Qwen 3.8 Flash (Text).
 *
 * Architecture:
 *   Realtime Teacher (qwen3.8-omni-flash-realtime)
 *          │
 *          ├────── Audio / speech ──────→ Student
 *          │
 *          └────── Transcript deltas ───→ Rolling Sentence Buffer
 *                                                │
 *                                                ▼
 *                                       Visual Director (qwen3.8-flash)
 *                                                │
 *                                                ▼
 *                                         IllustrationSpec (JSON)
 *                                                │
 *                                                ▼
 *                                           SvgRenderer
 *                                                │
 *                                                ▼
 *                                      Live Classroom Board
 *
 * Decoupled, non-blocking, debounced, deduplicated, and fail-safe.
 */

import type {
  IllustrationSpec,
  RollingTranscriptContext,
  VisualBoardState,
  VisualElement,
} from './types';
import { SvgRenderer } from './SvgRenderer';
import { createAvelutAI, getResponseText } from '../../../utils/inference';
import type { AppSettings, UserProfile } from '../../../types';

export interface VisualEngineCallbacks {
  onIllustrationReady?: (svgString: string, spec: IllustrationSpec) => void;
  onVisualCleared?: () => void;
  onStatusChange?: (status: 'idle' | 'analyzing' | 'generating' | 'ready') => void;
}

const VISUAL_DIRECTOR_SYSTEM_PROMPT = `
You are the AI Visual Director for Avelut's Live Classroom.
Your job is NOT to teach. The realtime voice teacher is already speaking with the student.
Your ONLY role is:
Given a small rolling context of what the teacher is saying, decide whether an educational vector illustration would materially improve student comprehension, and if so, output a structured JSON IllustrationSpec.

DECISION CRITERIA:
- Only generate an illustration when a concept genuinely benefits from visual depiction (physical systems, scientific structures, molecular arrangements, cellular anatomy, mathematical geometry, or multi-component architectures).
- If the teacher is simply greeting, asking a conversational question, giving an administrative instruction, or explaining a simple definition that needs no drawing, return:
  {"shouldIllustrate": false}

CRITICAL RULE — ELIMINATE GENERIC BOX-AND-ARROW DIAGRAMS:
Do NOT create generic [Concept A] -> [Concept B] flowchart boxes.
Use REAL SCIENTIFIC & TECHNICAL PRIMITIVES:
- Physics: "person", "car", "ball", "box", "ground", "inclined_plane", "pulley", "spring", "pendulum", "trajectory"
- Chemistry: "atom", "molecule" (H2O, CO2, etc.), "beaker", "test_tube"
- Biology: "cell", "nucleus", "dna"
- Mathematics: "coordinate_plane", "graph", "triangle", "circle"
- Computer Science: "client", "server", "database"
And connect them with labeled directional vectors (type: "vector" or "arrow", vectorType: "force" | "velocity" | "acceleration" | "gravity").

COORDINATE SPACE:
Canvas is 480 wide by 320 high (viewBox="0 0 480 320").
Keep x between 30 and 450, y between 40 and 280.

OUTPUT FORMAT:
Return PURE JSON only (no markdown code blocks, no conversational preamble).
Schema:
{
  "shouldIllustrate": true,
  "action": "create", // or "update" | "highlight" | "clear"
  "visualType": "physics_scene", // or "chemical_structure" | "biological_diagram" | "math_geometry" | "computer_system" | "process_illustration"
  "title": "Short Descriptive Title",
  "purpose": "One sentence explaining what this illustrates",
  "elements": [
    { "id": "p1", "primitive": "person", "x": 100, "y": 180, "properties": { "action": "push" }, "label": "Person" },
    { "id": "b1", "primitive": "box", "x": 220, "y": 210, "width": 80, "height": 60, "label": "Mass (m)" },
    { "id": "g1", "primitive": "ground", "x": 240, "y": 240, "width": 420, "label": "Floor" }
  ],
  "relationships": [
    { "from": "p1", "to": "b1", "type": "vector", "vectorType": "force", "label": "F_applied" }
  ],
  "labels": [
    { "text": "Action-Reaction Pair", "x": 160, "y": 50, "style": "header" }
  ],
  "equations": [
    { "latex": "$$ F = m \\cdot a $$", "x": 240, "y": 290 }
  ]
}

If no illustration is needed:
{ "shouldIllustrate": false }
`.trim();

export class VisualIllustrationEngine {
  private topic: string = '';
  private appSettings: AppSettings | null = null;
  private userProfile: UserProfile | null = null;
  private callbacks: VisualEngineCallbacks = {};

  // Rolling transcript buffer
  private completedSentences: string[] = [];
  private currentSentenceBuffer: string = '';
  private upcomingContext: string[] = [];

  // State & deduplication
  private boardState: VisualBoardState = {
    currentIllustration: null,
    svgString: null,
    elementIds: [],
    currentConcept: '',
    lastGeneratedAt: 0,
  };

  private lastAnalyzedConcept: string = '';
  private lastGenerationTime = 0;
  private readonly COOLDOWN_MS = 12000; // minimum 12s between new illustration generations
  private isAnalyzing = false;
  private activeAbortController: AbortController | null = null;

  constructor(callbacks?: VisualEngineCallbacks) {
    if (callbacks) this.callbacks = callbacks;
  }

  public setCallbacks(cb: VisualEngineCallbacks): void {
    this.callbacks = cb;
  }

  public initialize(
    topic: string,
    appSettings?: AppSettings | null,
    userProfile?: UserProfile | null,
    upcoming?: string[]
  ): void {
    this.topic = topic;
    if (appSettings) this.appSettings = appSettings;
    if (userProfile) this.userProfile = userProfile;
    if (upcoming) this.upcomingContext = upcoming;

    this.completedSentences = [];
    this.currentSentenceBuffer = '';
    this.lastAnalyzedConcept = '';
    this.lastGenerationTime = 0;
    this.boardState = {
      currentIllustration: null,
      svgString: null,
      elementIds: [],
      currentConcept: '',
      lastGeneratedAt: 0,
    };
  }

  /**
   * Feed realtime transcript stream deltas from the teacher.
   * Realtime audio transcript arrives incrementally.
   */
  public ingestTranscriptDelta(delta: string): void {
    if (!delta) return;

    this.currentSentenceBuffer += delta;

    // Detect sentence boundaries (. ? ! or newline followed by space/cap)
    const sentenceBoundaryRegex = /([.?!]+[\s\n]+|\n\n+)/;
    const match = this.currentSentenceBuffer.match(sentenceBoundaryRegex);

    if (match && match.index !== undefined) {
      const sentenceEnd = match.index + match[0].length;
      const completed = this.currentSentenceBuffer.slice(0, sentenceEnd).trim();
      this.currentSentenceBuffer = this.currentSentenceBuffer.slice(sentenceEnd);

      if (completed.length >= 8) {
        this.completedSentences.push(completed);
        // Keep only the last 3 completed sentences
        if (this.completedSentences.length > 3) {
          this.completedSentences.shift();
        }

        // Trigger evaluation on complete semantic thought
        void this.evaluateVisualIntent();
      }
    }
  }

  /**
   * Evaluate whether the current rolling context calls for a visual illustration.
   * Asynchronous, debounced, and fail-safe.
   */
  public async evaluateVisualIntent(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastGenerationTime < this.COOLDOWN_MS) {
      return;
    }

    if (this.isAnalyzing) {
      return;
    }

    // Prepare context window
    const recentSentences = [...this.completedSentences];
    if (this.currentSentenceBuffer.trim()) {
      recentSentences.push(this.currentSentenceBuffer.trim());
    }

    if (recentSentences.length === 0) return;

    const fullContextStr = recentSentences.join(' ');
    // Deduplicate: If concept text is practically identical to last analyzed, skip
    const conceptHash = fullContextStr.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!force && conceptHash === this.lastAnalyzedConcept) {
      return;
    }

    const contextPayload: RollingTranscriptContext = {
      topic: this.topic,
      previous: this.completedSentences.slice(0, 3),
      current: this.currentSentenceBuffer.trim() || this.completedSentences[this.completedSentences.length - 1] || '',
      upcoming: this.upcomingContext.slice(0, 2),
      boardContext: this.boardState.currentIllustration?.title
        ? `Currently displayed: "${this.boardState.currentIllustration.title}" (${this.boardState.currentIllustration.visualType || 'scene'})`
        : 'Board is currently empty.',
    };

    console.log('[VisualEngine] Candidate visual detected. Context prepared for topic:', this.topic);

    this.isAnalyzing = true;
    this.callbacks.onStatusChange?.('analyzing');

    try {
      if (this.activeAbortController) {
        this.activeAbortController.abort();
      }
      this.activeAbortController = new AbortController();

      console.log('[VisualEngine] Requesting illustration decision from qwen3.8-flash...');
      this.callbacks.onStatusChange?.('generating');

      const ai = createAvelutAI(this.appSettings || ({} as any), this.userProfile, {
        feature: 'live_classroom_visual',
      });

      const response = await ai.models.generateContent({
        model: 'qwen3.8-flash',
        contents: [
          {
            role: 'system',
            parts: [{ text: VISUAL_DIRECTOR_SYSTEM_PROMPT }],
          },
          {
            role: 'user',
            parts: [
              {
                text: `LESSON TOPIC: "${contextPayload.topic}"\n\nBOARD STATE: ${contextPayload.boardContext}\n\nROLLING TEACHER TRANSCRIPT:\nPrevious 3 sentences:\n${contextPayload.previous.map((s, i) => `${i + 1}. "${s}"`).join('\n') || '(none)'}\n\nCurrent sentence:\n"${contextPayload.current}"\n\nUpcoming syllabus context:\n${contextPayload.upcoming?.map((s, i) => `${i + 1}. "${s}"`).join('\n') || '(none)'}\n\nDECISION: Should this be illustrated? Return JSON only.`,
              },
            ],
          },
        ],
        config: {
          temperature: 0.2,
          maxOutputTokens: 1200,
          responseMimeType: 'application/json',
        },
      });

      const rawText = getResponseText(response) || (typeof response?.text === 'function' ? response.text() : response?.text || (typeof response === 'string' ? response : ''));
      const parsedSpec = this.safeParseJson(rawText);

      if (!parsedSpec || typeof parsedSpec !== 'object') {
        console.warn('[VisualEngine] Failed to parse JSON or received invalid output:', rawText?.slice(0, 100));
        this.isAnalyzing = false;
        this.callbacks.onStatusChange?.('idle');
        return;
      }

      console.log(`[VisualEngine] Illustration decision: ${Boolean(parsedSpec.shouldIllustrate)}`);

      if (!parsedSpec.shouldIllustrate) {
        console.log('[VisualEngine] Illustration skipped (no visual needed for this segment)');
        this.lastAnalyzedConcept = conceptHash;
        this.isAnalyzing = false;
        this.callbacks.onStatusChange?.('idle');
        return;
      }

      console.log(`[VisualEngine] Visual type: ${parsedSpec.visualType || 'custom'}, title: "${parsedSpec.title || 'Illustration'}"`);
      console.log('[VisualEngine] Rendering SVG...');

      const svgString = SvgRenderer.render(parsedSpec, this.boardState.currentIllustration?.elements);

      if (!svgString) {
        console.warn('[VisualEngine] SvgRenderer produced empty markup — discarding visual');
        this.isAnalyzing = false;
        this.callbacks.onStatusChange?.('idle');
        return;
      }

      console.log('[VisualEngine] SVG rendered successfully (size:', svgString.length, 'bytes)');

      // Update board state
      this.boardState = {
        currentIllustration: parsedSpec,
        svgString,
        elementIds: (parsedSpec.elements || []).map(e => e.id),
        currentConcept: parsedSpec.title || this.topic,
        currentVisualType: parsedSpec.visualType,
        lastGeneratedAt: Date.now(),
      };

      this.lastGenerationTime = Date.now();
      this.lastAnalyzedConcept = conceptHash;

      // Notify classroom UI
      this.callbacks.onIllustrationReady?.(svgString, parsedSpec);
      this.callbacks.onStatusChange?.('ready');
      console.log('[VisualEngine] Board updated ✅');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.log('[VisualEngine] Previous illustration request aborted for newer context');
      } else {
        console.error('[VisualEngine] Non-fatal error during visual generation:', err);
      }
    } finally {
      this.isAnalyzing = false;
      this.activeAbortController = null;
    }
  }

  /**
   * Reset or clear visual engine state
   */
  public clear(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
    this.boardState = {
      currentIllustration: null,
      svgString: null,
      elementIds: [],
      currentConcept: '',
      lastGeneratedAt: 0,
    };
    this.completedSentences = [];
    this.currentSentenceBuffer = '';
    this.callbacks.onVisualCleared?.();
    this.callbacks.onStatusChange?.('idle');
  }

  public getBoardState(): VisualBoardState {
    return this.boardState;
  }

  private safeParseJson(text: string): IllustrationSpec | null {
    if (!text) return null;
    try {
      // Strip markdown code block wrappers if present
      let clean = text.trim();
      if (clean.startsWith('```json')) {
        clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (clean.startsWith('```')) {
        clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      return JSON.parse(clean);
    } catch {
      return null;
    }
  }
}

export const visualIllustrationEngine = new VisualIllustrationEngine();
