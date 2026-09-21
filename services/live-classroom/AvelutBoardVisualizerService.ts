/**
 * AvelutBoardVisualizerService.ts
 *
 * Co-Pilot AI Board Illustrator that runs alongside the Realtime Voice Teacher.
 *
 * Capabilities:
 *  1. Immediate Kickoff Illustration: As soon as the lesson begins, requests
 *     Alibaba Cloud text models (qwen3.7-flash / qwen-plus) to generate a rich,
 *     intuitive opening diagram (concept map, cycle, flow, comparison, or formula)
 *     and draws it onto the Excalidraw board immediately.
 *  2. Real-Time Speech Visual Streaming: Monitors speech transcripts from the voice
 *     teacher in real time. When new concepts, processes, or equations are explained,
 *     autonomously creates and streams matching visual diagrams, shapes, and highlights
 *     onto the board.
 *  3. On-Demand Visual Illustration: Allows the student to tap "✨ Illustrate" or
 *     request specific diagrams (concept_map, cycle, comparison, flow) on demand.
 */

import { avelutBoardController } from './AvelutBoardController';
import { getAlibabaApiKey } from '../../utils/appSettings';
import type { AppSettings } from '../../types';

export interface VisualizerConfig {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  durationMinutes?: number;
  learningPath?: string[];
  studentName?: string;
}

export type VisualizerStatus = 'idle' | 'visualizing' | 'ready' | 'error';

export interface VisualizerCallbacks {
  onStatusChange?: (status: VisualizerStatus, message?: string) => void;
  onVisualDrawn?: (summary: string) => void;
}

export class AvelutBoardVisualizerService {
  private config: VisualizerConfig | null = null;
  private appSettings: AppSettings | null = null;
  private callbacks: VisualizerCallbacks = {};
  private status: VisualizerStatus = 'idle';

  private speechBuffer = '';
  private lastEvaluatedSpeech = '';
  private minCharsForEval = 180;
  private maxContextChars = 900;
  private evalDebounceMs = 2500;
  private speechDebounceTimer: any = null;
  private isProcessing = false;
  private hasGeneratedKickoff = false;
  private drawnTopics = new Set<string>();

  constructor(callbacks?: VisualizerCallbacks) {
    if (callbacks) this.callbacks = callbacks;
  }

  public setCallbacks(cb: VisualizerCallbacks): void {
    this.callbacks = cb;
  }

  public getStatus(): VisualizerStatus {
    return this.status;
  }

  private setStatus(s: VisualizerStatus, message?: string): void {
    this.status = s;
    this.callbacks.onStatusChange?.(s, message);
  }

  /** Initialize with topic and lesson metadata */
  public initialize(config: VisualizerConfig, appSettings?: AppSettings | null): void {
    this.config = config;
    if (appSettings) this.appSettings = appSettings;
    this.speechBuffer = '';
    this.lastEvaluatedSpeech = '';
    this.hasGeneratedKickoff = false;
    this.drawnTopics.clear();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private safeJsonParse(text: string): any {
    try {
      const sanitizedStr = text.replace(/^```json/i, '').replace(/```$/i, '').trim();
      return JSON.parse(sanitizedStr);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          console.error('[BoardVisualizer] JSON payload truncated. Check max_tokens or stream accumulation.', text);
          return null;
        }
      }
      console.warn('[BoardVisualizer] Failed to parse JSON from response:', text);
      return null;
    }
  }

  // ── Network Fetch to Alibaba Text Models ───────────────────────────────────

  private async callAlibabaTextModel(systemPrompt: string, userPrompt: string): Promise<any> {
    const apiKey = getAlibabaApiKey(this.appSettings);
    const workspaceId =
      (this.appSettings as any)?.alibaba_workspace_id ||
      (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_ALIBABA_WORKSPACE_ID) ||
      'ws-o3v6mh0i8y9tqdfx';

    const isNative =
      typeof window !== 'undefined' &&
      ((window as any).Capacitor?.isNativePlatform?.() ||
        window.location.protocol === 'file:' ||
        window.location.protocol === 'capacitor:' ||
        window.location.protocol === 'ionic:');

    // Prioritize backend proxy endpoints (CORS-safe and authenticated server-side)
    const endpoints = isNative
      ? [
          'https://www.avelut.xyz/api/alibaba-chat',
          'https://www.avelut.xyz/api/openrouter-chat',
          '/api/alibaba-chat',
          '/api/openrouter-chat',
        ]
      : [
          '/api/alibaba-chat',
          '/api/openrouter-chat',
          'https://www.avelut.xyz/api/alibaba-chat',
          'https://www.avelut.xyz/api/openrouter-chat',
        ];

    const payload = {
      model: 'qwen3.7-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: 2500,
    };

    let lastError: any = null;

    for (const ep of endpoints) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Title': 'Avelut AI Classroom',
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        if (workspaceId) {
          headers['X-DashScope-WorkSpace'] = workspaceId;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 22000);

        const res = await fetch(ep, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.warn(`[BoardVisualizer] Endpoint ${ep} returned ${res.status} ${res.statusText}:`, errBody);

          if (res.status === 429) {
            console.warn('[BoardVisualizer] Rate limited by upstream. Gracefully failing this turn.');
            throw new Error('RATE_LIMIT');
          }

          let parsedError;
          try {
            parsedError = JSON.parse(errBody).error;
          } catch {
            parsedError = errBody;
          }

          lastError = new Error(`Endpoint ${ep} returned ${res.status} ${res.statusText}: ${parsedError || 'Unknown error'}`);
          continue; // Try the next fallback endpoint
        }

        const contentStr = await res.text();
        if (!contentStr) {
          lastError = new Error(`Empty response from AI visualizer model at ${ep}.`);
          console.warn(`[BoardVisualizer] ${lastError.message}`);
          continue; // Try the next fallback endpoint
        }

        const parsedJson = this.safeJsonParse(contentStr);
        if (parsedJson) {
          return parsedJson;
        } else {
          throw new Error('Unable to parse JSON from AI response: ' + contentStr.slice(0, 100));
        }
      } catch (err: any) {
        if (err.message === 'RATE_LIMIT') {
          throw err; // bubble up without fallback if it's a hard rate limit
        }
        lastError = err;
        console.warn(`[BoardVisualizer] Fetch failed for endpoint ${ep}:`, err);
      }
    }

    console.warn('[BoardVisualizer] All endpoints failed. Last error:', lastError);
    throw lastError || new Error('Failed to reach AI visualizer model endpoints');
  }

  // ── Kickoff Management ────────────────────────────────────────────────────

  /**
   * Classroom entrance: The blackboard starts clean with only the topic title in the header.
   * Visual diagrams and formulas are drawn dynamically as the lecturer speaks.
   */
  public async generateKickoffIllustration(): Promise<void> {
    if (!this.config?.topicTitle) return;

    this.setStatus('visualizing', 'Generating topic kickoff diagram…');
    const { topicTitle, courseName = 'Academic Course', syllabusContext } = this.config;

    const systemPrompt = `You are a live blackboard illustrator setting up the opening visualization for a new lesson.
Generate a structured topic overview diagram for the student in JSON.
Valid diagram types: "concept_map", "cycle", "flow", "comparison".
Return ONLY valid JSON:
{
  "title": "Diagram Title",
  "diagramType": "concept_map" | "cycle" | "flow" | "comparison",
  "data": { ... }
}`;
    const userPrompt = `Topic: "${topicTitle}"\nCourse: "${courseName}"\nContext: "${syllabusContext || ''}"\nGenerate the best kickoff diagram to introduce this topic.`;

    try {
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt);
      if (res.title) {
        avelutBoardController.writeText(res.title, { fontSize: 'medium', color: '#38BDF8' });
      }
      if (res.diagramType && res.data) {
        avelutBoardController.drawDiagram(res.diagramType, res.data);
      }
      this.setStatus('ready');
      this.hasGeneratedKickoff = true;
    } catch (err: any) {
      console.error('[BoardVisualizer] kickoff error:', err);
      this.setStatus('error', err.message);
    }
  }

  // ── Speech Transcript Monitoring (Autonomous Co-Pilot) ────────────────────

  /**
   * Called as speech transcripts arrive from QwenRealtimeTeacherService.
   */
  public processSpeechTranscript(transcript: string, isTurnFinal = false): void {
    if (!transcript) return;
    this.speechBuffer = transcript;

    // Autonomous evaluation has been explicitly disabled to prevent dual-writer chaos.
    // The Qwen realtime model now handles all direct tool calls.
  }

  /**
   * Sends the recent speech explanation to the Alibaba text model to determine
   * if a specific formula, shape, highlight, or diagram should appear on the board.
   */
  private async evaluateSpeechForVisuals(isTurnFinal = false): Promise<void> {
    if (this.isProcessing || !this.config?.topicTitle) return;

    const currentSpeech = this.speechBuffer.trim();
    if (currentSpeech.length < 30 || currentSpeech === this.lastEvaluatedSpeech) return;

    const full = currentSpeech;
    const novel = full.slice(this.lastEvaluatedSpeech.length).trim();

    // Prefer a wide window of recent context
    const contextWindow = full.slice(-this.maxContextChars);
    const recentFocus = novel.length >= 80 ? novel.slice(-this.maxContextChars) : contextWindow;

    // Skip short conversational greetings / checks
    if (recentFocus.length < 25 || /^(hello|hi|welcome|can you hear|let's begin|are you ready)/i.test(recentFocus)) {
      return;
    }

    this.isProcessing = true;
    this.setStatus('visualizing', 'Updating board illustration…');

    const systemPrompt = `You are an elite autonomous digital blackboard illustrator for a live university lecture.
The lecturer is teaching and explaining concepts. You must decide what visual updates to render on the blackboard right now.

CRITICAL RULES:
1. Prefer shouldDraw true when the teacher explains a concept, law, process, comparison, or equation.
2. Allowed actions (can return MULTIPLE in one response):
   - "write_text": short title or 1-line definition (max ~12 words). Never paste full spoken paragraphs!
   - "set_formula": equations like F = ma, v = u + at
   - "draw_diagram": concept_map | flow | cycle | comparison | coordinate_axes | free_body | collision
   - "draw_shape": supporting arrows/boxes
   - "write_keywords": 2–4 technical terms
   - "highlight_concept" / "clear_stage" when switching topics
3. Always include at least one visual action when shouldDraw is true (diagram OR formula OR keywords + text).
4. If the speech is purely conversational greeting, transitioning, or asking a question to the student without introducing a visual concept, return {"shouldDraw": false}. Do NOT draw anything!

Return strict JSON only matching:
{
  "shouldDraw": true | false,
  "summary": "Brief 3-word summary of the visual action",
  "actions": [
    {
      "action": "draw_diagram" | "write_text" | "set_formula" | "draw_shape" | "write_keywords" | "highlight_concept" | "clear_stage",
      "params": { ... }
    }
  ]
}`;

    const userPrompt = `Topic: "${this.config.topicTitle}"
Course / Syllabus Context: "${this.config.syllabusContext || ''}"
Teacher Speech Context Window: "${contextWindow}"
Recent Focus: "${recentFocus}"

Instruction: Illustrate what is being taught now with a diagram and/or formula and short labels.`;

    try {
      const decision = await this.callAlibabaTextModel(systemPrompt, userPrompt);
      console.log('[BoardVisualizer] Speech evaluation decision:', decision);

      if (decision.shouldDraw) {
        if (Array.isArray(decision.actions)) {
          for (const item of decision.actions) {
            const act = item.action || item.type;
            const params = item.params || item;
            if (act) {
              this.executeVisualAction(act, params);
            }
          }
        } else if (decision.action || decision.type) {
          const act = decision.action || decision.type;
          const params = decision.params || decision;
          this.executeVisualAction(act, params);
        }
        this.callbacks.onVisualDrawn?.(decision.summary || 'Updated blackboard');
        this.lastEvaluatedSpeech = currentSpeech; // Only update on successful draw

        // Anti-spam: wait a bit before evaluating again unless it's the end of a turn
        if (!isTurnFinal) {
           await new Promise((r) => setTimeout(r, 4000));
        }
      } else {
        this.lastEvaluatedSpeech = currentSpeech; // Update if model decided not to draw
      }
    } catch (err) {
      console.warn('[BoardVisualizer] evaluateSpeechForVisuals error:', err);
      // Don't update lastEvaluatedSpeech on error so we can retry with more context
    } finally {
      this.isProcessing = false;
      this.setStatus('ready');
    }
  }

  // ── On-Demand Illustration ────────────────────────────────────────────────

  public async illustrateFromBoardWrite(params: { boardText: string, recentSpeech: string, forceDiagram?: boolean }): Promise<void> {
    if (!this.config?.topicTitle) return;
    this.setStatus('visualizing', `Drawing: "${params.boardText}"…`);

    const systemPrompt = `You are an elite autonomous digital blackboard illustrator.
A lecturer has requested a specific diagram or visual on the board.
Return ONLY valid JSON.
Allowed actions: "draw_diagram", "write_text", "set_formula", "draw_shape", "write_keywords".
{
  "action": "draw_diagram" | "write_text" | "set_formula" | "draw_shape" | "write_keywords",
  "params": { ... }
}`;

    const userPrompt = `Topic: "${this.config.topicTitle}"
Context: "${this.config.syllabusContext || ''}"
Recent Speech: "${params.recentSpeech}"
Requested Diagram/Text: "${params.boardText}"
Force Diagram: ${params.forceDiagram ? 'true' : 'false'}

Generate the visual board action.`;

    try {
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt);
      if (res.action && res.params) {
        this.executeVisualAction(res.action, res.params);
        this.callbacks.onVisualDrawn?.(`Illustrated: ${params.boardText}`);
      }
    } catch (err) {
      console.warn('[BoardVisualizer] illustrateFromBoardWrite error:', err);
    } finally {
      this.setStatus('ready');
    }
  }

  /**
   * Triggered when the student or UI requests a visual illustration on demand.
   */
  public async illustrateOnDemand(requestedDiagramType?: string): Promise<void> {
    if (!this.config?.topicTitle) return;

    this.setStatus('visualizing', `Generating ${requestedDiagramType || 'visual diagram'}…`);

    const { topicTitle, courseName = 'Academic Course', syllabusContext } = this.config;

    const systemPrompt = `You are a live blackboard illustrator.
Generate a structured diagram for the student in JSON.
Valid diagram types: "concept_map", "cycle", "flow", "comparison", "coordinate_axes", "free_body", "collision".
Return ONLY valid JSON:
{
  "title": "Diagram Title",
  "diagramType": "concept_map" | "cycle" | "flow" | "comparison" | "coordinate_axes" | "free_body" | "collision",
  "data": { ... }
}`;

    const userPrompt = `Topic: "${topicTitle}"
Course: "${courseName}"
Context: "${syllabusContext || ''}"
Requested Diagram Type: ${requestedDiagramType || 'best visual for this concept'}

Generate the diagram data now.`;

    try {
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt);
      if (res.title) {
        avelutBoardController.writeText(res.title, { fontSize: 'medium', color: '#38BDF8' });
      }
      if (res.diagramType && res.data) {
        avelutBoardController.drawDiagram(res.diagramType, res.data);
      }
      this.setStatus('ready');
      this.callbacks.onVisualDrawn?.(`Drawn ${res.diagramType} on board`);
    } catch (err: any) {
      console.error('[BoardVisualizer] illustrateOnDemand error:', err);
      this.setStatus('error', err.message);
    }
  }

  /**
   * Handle text question from student that may ask for a visual aid.
   */
  public async handleStudentQuery(query: string): Promise<void> {
    if (!query.trim() || !this.config?.topicTitle) return;

    const lower = query.toLowerCase();
    const isVisualRequest =
      lower.includes('draw') ||
      lower.includes('show') ||
      lower.includes('diagram') ||
      lower.includes('illustrate') ||
      lower.includes('formula') ||
      lower.includes('map') ||
      lower.includes('graph') ||
      lower.includes('compare');

    if (!isVisualRequest) return;

    this.setStatus('visualizing', `Illustrating: "${query}"…`);

    const systemPrompt = `You are a live blackboard visual assistant.
A student typed a question during a live lesson.
Generate a direct visual response (diagram, formula, or flow) on the blackboard.
Return ONLY valid JSON:
{
  "action": "draw_diagram" | "write_text" | "draw_shape",
  "params": { ... }
}`;

    const userPrompt = `Topic: "${this.config.topicTitle}"
Student Query: "${query}"

Generate the visual board action.`;

    try {
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt);
      if (res.action && res.params) {
        this.executeVisualAction(res.action, res.params);
        this.callbacks.onVisualDrawn?.(`Illustrated answer for student`);
      }
    } catch (err) {
      console.warn('[BoardVisualizer] handleStudentQuery error:', err);
    } finally {
      this.setStatus('ready');
    }
  }

  // ── Action Dispatcher ─────────────────────────────────────────────────────

  private executeVisualAction(action: string, params: Record<string, any>): void {
    console.log('[BoardVisualizer] execute', action, params);
    try {
      switch (action) {
        case 'draw_diagram': {
          const type = params.diagramType || params.type || 'concept_map';
          const data = params.data || params;
          avelutBoardController.drawDiagram(type, data);
          break;
        }
        case 'write_text':
        case 'text': {
          avelutBoardController.writeText(params.text || params.content || '', {
            fontSize: params.fontSize,
            color: params.color,
            x: params.x,
            y: params.y,
            isFormula: params.isFormula,
          });
          break;
        }
        case 'edit_text': {
          const target = params.target || params.targetTextOrLabel || '';
          const newText = params.newText || params.text || '';
          if (target && newText) {
            avelutBoardController.updateText(target, newText);
          }
          break;
        }
        case 'write_keywords': {
          const keywords = params.keywords || (Array.isArray(params.data) ? params.data : []);
          avelutBoardController.writeKeywords(keywords, params.x, params.y);
          break;
        }
        case 'clear_component': {
          const target = params.target || params.targetTextOrLabel || '';
          if (target) {
            avelutBoardController.removeComponent(target);
          }
          break;
        }
        case 'draw_shape':
        case 'draw': {
          avelutBoardController.drawShape({
            type: params.shape || params.type || 'rectangle',
            x: Number(params.x ?? params.position?.x) || 60,
            y: Number(params.y ?? params.position?.y) || 120,
            width: params.width,
            height: params.height,
            label: params.label,
            color: params.color,
            backgroundColor: params.backgroundColor,
          });
          break;
        }
        case 'highlight_concept': {
          avelutBoardController.highlightConcept(
            params.targetTextOrLabel || params.text || '',
            params.style || 'box',
          );
          break;
        }
        case 'set_formula':
        case 'formula': {
          const formula = params.formula || params.text || params.content || '';
          if (formula) {
            avelutBoardController.setFormula(formula);
          }
          break;
        }
        case 'clear_stage': {
          avelutBoardController.clearStage();
          break;
        }
        case 'clear_board': {
          avelutBoardController.clearBoard(params.keepTitle ?? true);
          break;
        }
        default:
          console.warn('[BoardVisualizer] Unknown visual action:', action);
          break;
      }
    } catch (err) {
      console.error('[BoardVisualizer] executeVisualAction failed:', err);
    }
  }

  /** Clean up timers and reset */
  public endSession(): void {
    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = null;
    }
    this.speechBuffer = '';
    this.lastEvaluatedSpeech = '';
    this.isProcessing = false;
    this.hasGeneratedKickoff = false;
    this.setStatus('idle');
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────
export const avelutBoardVisualizer = new AvelutBoardVisualizerService();
