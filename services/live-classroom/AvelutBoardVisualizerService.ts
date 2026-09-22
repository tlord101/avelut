/**
 * AvelutBoardVisualizerService.ts
 *
 * Co-Pilot AI Board Illustrator that runs alongside the Realtime Voice Teacher.
 *
 * Design:
 *  - Realtime model only writes TEXT (write_text / set_formula / write_keywords).
 *  - This service generates DIAGRAMS when the teacher speech contains illustration phrases
 *    ("imagine", "let me draw", "on the board", "picture this", etc.).
 *  - Kickoff illustration runs once at lesson start with a COMPACT JSON schema
 *    so responses are not truncated by max_tokens.
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

/** Phrases that trigger the text-model illustrator from teacher speech */
const ILLUSTRATION_PHRASE_RE =
  /\b(let me draw|i(?:'| a)?m going to draw|on the board|let me show you|show you on the board|picture this|imagine|visuali[sz]e|let me sketch|sketch this|draw a|draw the|diagram|flowchart|flow chart|concept map|mind map|let me map|illustrate|let me illustrate|here(?:'| i)s a diagram|look at this diagram)\b/i;

export class AvelutBoardVisualizerService {
  private config: VisualizerConfig | null = null;
  private appSettings: AppSettings | null = null;
  private callbacks: VisualizerCallbacks = {};
  private status: VisualizerStatus = 'idle';

  private speechBuffer = '';
  private lastEvaluatedSpeech = '';
  private lastPhraseTriggerAt = 0;
  private phraseDebounceMs = 8000; // do not fire more than once every 8s
  private speechDebounceTimer: any = null;
  private isProcessing = false;
  private hasGeneratedKickoff = false;
  private drawnTopics = new Set<string>();
  private pendingRequests = new Map<string, AbortController>();

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
    this.lastPhraseTriggerAt = 0;
    this.hasGeneratedKickoff = false;
    this.drawnTopics.clear();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────


  private salvageTruncatedJson(raw: string): any | null {
    let s = raw.trim();
    // Strip trailing incomplete token
    s = s.replace(/,\s*$/, '');
    s = s.replace(/:\s*$/, ': null');
    // Balance braces/brackets
    let openBraces = 0, openBrackets = 0;
    for (const ch of s) {
      if (ch === '{') openBraces++;
      else if (ch === '}') openBraces--;
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets--;
    }
    while (openBrackets-- > 0) s += ']';
    while (openBraces-- > 0) s += '}';
    try { return JSON.parse(s); } catch { return null; }
  }

  private safeJsonParse(text: string): any {
    try {
      let s = text.trim();
      // Strip markdown fences if present
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(s);
    } catch {
      const salvaged = this.salvageTruncatedJson(text);
      if (salvaged) {
        console.warn('[BoardVisualizer] Recovered from truncated JSON');
        return salvaged;
      }
      // Try to extract the largest {...} block
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          const salvagedPartial = this.salvageTruncatedJson(jsonMatch[0]);
          if (salvagedPartial) {
            console.warn('[BoardVisualizer] Recovered from truncated partial JSON');
            return salvagedPartial;
          }
          console.error('[BoardVisualizer] JSON payload truncated. Unrecoverable.', text.slice(0, 400));
          return null;
        }
      }
      console.warn('[BoardVisualizer] Failed to parse JSON from response:', text.slice(0, 200));
      return null;
    }
  }

  // ── Network Fetch to Alibaba Text Models ───────────────────────────────────

  private async callAlibabaTextModel(
    systemPrompt: string,
    userPrompt: string,
    requestId: string,
    isComplex = false,
  ): Promise<any> {
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

    const primaryEndpoint = isNative
      ? 'https://www.avelut.xyz/api/alibaba-chat'
      : '/api/alibaba-chat';

    const endpoints = [
      primaryEndpoint,
      isNative ? 'https://www.avelut.xyz/api/openrouter-chat' : '/api/openrouter-chat',
    ];

    // Compact responses for diagrams — higher max_tokens only when needed
    const payload = {
      model: 'qwen3.7-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: isComplex ? 2048 : 1024,
      stream: false,
    };

    let lastError: any = null;

    const controller = new AbortController();
    this.pendingRequests.set(requestId, controller);

    try {
      for (const ep of endpoints) {
        if (controller.signal.aborted) {
          throw new DOMException('The user aborted a request.', 'AbortError');
        }

        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Title': 'Avelut AI Classroom',
          };
          if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
          if (workspaceId) headers['X-DashScope-WorkSpace'] = workspaceId;

          const timeoutMs = isComplex ? 28000 : 14000;
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          const res = await fetch(ep, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.warn(`[BoardVisualizer] Endpoint ${ep} returned ${res.status}:`, errBody.slice(0, 200));

            if (res.status === 429) throw new Error('RATE_LIMIT');

            lastError = new Error(`Endpoint ${ep} returned ${res.status}`);
            if (res.status >= 500) continue;
            throw lastError;
          }

          const contentStr = await res.text();
          if (!contentStr) {
            lastError = new Error(`Empty response from ${ep}`);
            continue;
          }

          // Some proxies wrap the model output in { choices: [{ message: { content } }] }
          let rawForParse = contentStr;
          try {
            const outer = JSON.parse(contentStr);
            if (outer?.choices?.[0]?.message?.content) {
              rawForParse = outer.choices[0].message.content;
            } else if (typeof outer?.content === 'string') {
              rawForParse = outer.content;
            } else if (outer?.title || outer?.diagramType || outer?.action || outer?.shouldDraw) {
              // Already the diagram/action JSON
              return outer;
            }
          } catch {
            // contentStr is already the model JSON string
          }

          const parsedJson = this.safeJsonParse(rawForParse);
          if (parsedJson) return parsedJson;

          console.error('[BoardVisualizer] Unrecoverable JSON:', rawForParse.slice(-200));
          return null; // cleanly abort instead of noisy fetch fail
        } catch (err: any) {
          if (err.name === 'AbortError') throw err;
          if (err.message === 'RATE_LIMIT') throw err;
          lastError = err;
          console.warn(`[BoardVisualizer] Fetch failed for endpoint ${ep}:`, err);
        }
      }

      console.warn('[BoardVisualizer] All endpoints failed. Last error:', lastError);
      throw lastError || new Error('Failed to reach AI visualizer model endpoints');
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  public cancelPendingRequests(): void {
    for (const [, controller] of this.pendingRequests.entries()) {
      controller.abort();
    }
    this.pendingRequests.clear();
  }

  // ── Kickoff Management ────────────────────────────────────────────────────

  /**
   * Compact kickoff diagram — short labels only so JSON never truncates.
   */
  public async generateKickoffIllustration(): Promise<void> {
    if (!this.config?.topicTitle) return;
    if (this.hasGeneratedKickoff) return;

    this.setStatus('visualizing', 'Generating topic kickoff diagram…');
    const { topicTitle, courseName = 'Academic Course', syllabusContext } = this.config;

    const systemPrompt = `You are a live blackboard illustrator.
Return ONLY compact valid JSON for a simple opening diagram.
Rules:
- Use diagramType: "concept_map" | "flow" | "cycle" | "comparison"
- Labels max 4 words each. NO long descriptions.
- Max 5 nodes for concept_map. Max 4 steps for flow/cycle.
Schema:
{
  "title": "Short Title",
  "diagramType": "concept_map",
  "data": {
    "nodes": [{"id": "a", "label": "Real Term"}],
    "connections": [{"from": "a", "to": "b"}],
    "steps": ["Topic-Specific Step", "Next Step"]
  }
}
CRITICAL: Every label MUST be a real topic word from the lesson (e.g. Resistor, Ohm's Law, Color Code, Current).
NEVER use Concept A, Concept B, Aspect 1, Aspect 2, Core Idea, Stage 1, Node 1, Label, or any placeholder.
If you cannot name real concepts, return {"action":"write_text","params":{"text":"<topic word>"}} instead of a diagram.`;

    const userPrompt = `Topic: "${topicTitle}"
Course: "${courseName}"
Context: "${(syllabusContext || '').slice(0, 200)}"
Generate a compact kickoff diagram. Short labels only.`;

    try {
      // Do NOT cancel other requests aggressively on kickoff — only cancel older kickoffs
      const requestId = `kickoff_${Date.now()}`;
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt, requestId, true);

      if (res.title) {
        avelutBoardController.writeText(res.title, { fontSize: 'medium', color: '#38BDF8' });
      }
      if (res.diagramType && res.data) {
        avelutBoardController.drawDiagram(res.diagramType, res.data);
      } else if (res.action && res.params) {
        this.executeVisualAction(res.action, res.params);
      }
      this.setStatus('ready');
      this.hasGeneratedKickoff = true;
      this.callbacks.onVisualDrawn?.(res.title || 'Kickoff diagram');
    } catch (err: any) {
      console.error('[BoardVisualizer] kickoff error:', err);
      if (err.name !== 'AbortError') this.setStatus('error', err.message);
    }
  }

  // ── Speech Transcript Monitoring (phrase-triggered illustration) ─────────

  /**
   * Called as speech transcripts arrive from QwenRealtimeTeacherService.
   * When illustration phrases are detected (imagine, draw, on the board, …),
   * triggers the text model to generate a diagram.
   */
  public processSpeechTranscript(transcript: string, isTurnFinal = false): void {
    if (!transcript) return;
    this.speechBuffer = transcript;

    const slice = transcript.slice(-400);
    if (!ILLUSTRATION_PHRASE_RE.test(slice)) return;

    const now = Date.now();
    if (now - this.lastPhraseTriggerAt < this.phraseDebounceMs) return;
    if (this.isProcessing) return;

    // Debounce slightly so we get a fuller sentence after the trigger phrase
    if (this.speechDebounceTimer) clearTimeout(this.speechDebounceTimer);
    this.speechDebounceTimer = setTimeout(() => {
      this.lastPhraseTriggerAt = Date.now();
      void this.triggerIllustrationFromSpeech(slice);
    }, isTurnFinal ? 400 : 900);
  }

  private async triggerIllustrationFromSpeech(recentSpeech: string): Promise<void> {
    if (!this.config?.topicTitle || this.isProcessing) return;

    this.isProcessing = true;
    this.setStatus('visualizing', 'Illustrating from speech…');

    const systemPrompt = `You are a live blackboard illustrator.
The teacher just used a phrase that suggests a visual (draw / imagine / on the board / picture / diagram).
Return ONLY compact valid JSON.
Prefer:
{
  "action": "draw_diagram",
  "params": {
    "diagramType": "concept_map" | "flow" | "cycle" | "comparison" | "free_body" | "coordinate_axes",
    "data": { "nodes": [{"id":"a","label":"Real Term"}], "connections": [], "steps": [] }
  }
}
Or for a formula: { "action": "set_formula", "params": { "formula": "V = IR" } }
Or keywords: { "action": "write_keywords", "params": { "keywords": ["term1", "term2"] } }
Labels max 4 words. No long descriptions.
CRITICAL: Every label MUST be a real topic word from the lesson (e.g. Resistor, Ohm's Law, Color Code, Current).
NEVER use Concept A, Concept B, Aspect 1, Aspect 2, Core Idea, Stage 1, Node 1, Label, or any placeholder.
If you cannot name real concepts, return {"action":"write_text","params":{"text":"<topic word>"}} instead of a diagram.`;

    const userPrompt = `Topic: "${this.config.topicTitle}"
Recent teacher speech: "${recentSpeech.slice(-350)}"
Generate one compact visual for what they are explaining.`;

    try {
      const requestId = `phrase_${Date.now()}`;
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt, requestId, true);

      if (res.action && res.params) {
        this.executeVisualAction(res.action, res.params);
        this.callbacks.onVisualDrawn?.(res.summary || 'Illustrated from speech');
      } else if (res.diagramType && res.data) {
        avelutBoardController.drawDiagram(res.diagramType, res.data);
        if (res.title) avelutBoardController.writeText(res.title, { fontSize: 'medium', color: '#38BDF8' });
        this.callbacks.onVisualDrawn?.(res.title || 'Diagram');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.warn('[BoardVisualizer] phrase illustration error:', err);
      }
    } finally {
      this.isProcessing = false;
      this.setStatus('ready');
    }
  }

  // ── On-Demand Illustration ────────────────────────────────────────────────

  public async illustrateFromBoardWrite(params: {
    boardText: string;
    recentSpeech: string;
    forceDiagram?: boolean;
  }): Promise<void> {
    if (!this.config?.topicTitle) return;
    this.setStatus('visualizing', `Drawing: "${params.boardText}"…`);

    const systemPrompt = `You are a live blackboard illustrator.
Return ONLY compact JSON.
{
  "action": "draw_diagram" | "write_text" | "set_formula" | "write_keywords",
  "params": { ... }
}
For draw_diagram use short labels only (max 4 words per node).`;

    const userPrompt = `Topic: "${this.config.topicTitle}"
Recent Speech: "${params.recentSpeech.slice(-250)}"
Requested: "${params.boardText}"
Force Diagram: ${params.forceDiagram ? 'true' : 'false'}`;

    try {
      const requestId = `board_${Date.now()}`;
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt, requestId, true);
      if (res.action && res.params) {
        this.executeVisualAction(res.action, res.params);
        this.callbacks.onVisualDrawn?.(`Illustrated: ${params.boardText}`);
      } else if (res.diagramType && res.data) {
        avelutBoardController.drawDiagram(res.diagramType, res.data);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.warn('[BoardVisualizer] illustrateFromBoardWrite error:', err);
    } finally {
      this.setStatus('ready');
    }
  }

  public async illustrateOnDemand(requestedDiagramType?: string): Promise<void> {
    if (!this.config?.topicTitle) return;

    this.setStatus('visualizing', `Generating ${requestedDiagramType || 'visual diagram'}…`);

    const { topicTitle, courseName = 'Academic Course', syllabusContext } = this.config;

    const systemPrompt = `You are a live blackboard illustrator.
Return ONLY compact valid JSON:
{
  "title": "Short Title",
  "diagramType": "concept_map" | "cycle" | "flow" | "comparison" | "coordinate_axes" | "free_body" | "collision",
  "data": { "nodes": [{"id":"a","label":"L"}], "connections": [], "steps": [] }
}
Labels max 4 words. Max 5 nodes.`;

    const userPrompt = `Topic: "${topicTitle}"
Course: "${courseName}"
Context: "${(syllabusContext || '').slice(0, 150)}"
Requested: ${requestedDiagramType || 'best visual'}`;

    try {
      const requestId = `demand_${Date.now()}`;
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt, requestId, true);
      if (res.title) {
        avelutBoardController.writeText(res.title, { fontSize: 'medium', color: '#38BDF8' });
      }
      if (res.diagramType && res.data) {
        avelutBoardController.drawDiagram(res.diagramType, res.data);
      }
      this.setStatus('ready');
      this.callbacks.onVisualDrawn?.(`Drawn ${res.diagramType || 'diagram'} on board`);
    } catch (err: any) {
      console.error('[BoardVisualizer] illustrateOnDemand error:', err);
      if (err.name !== 'AbortError') this.setStatus('error', err.message);
    }
  }

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
      lower.includes('imagine') ||
      lower.includes('picture') ||
      lower.includes('visualize') ||
      lower.includes('compare');

    if (!isVisualRequest) return;

    this.setStatus('visualizing', `Illustrating: "${query}"…`);

    const systemPrompt = `You are a live blackboard visual assistant.
Return ONLY compact JSON:
{
  "action": "draw_diagram" | "write_text" | "set_formula" | "write_keywords",
  "params": { ... }
}
Short labels only.`;

    const userPrompt = `Topic: "${this.config.topicTitle}"
Student Query: "${query}"
Generate the visual.`;

    try {
      const requestId = `query_${Date.now()}`;
      const res = await this.callAlibabaTextModel(systemPrompt, userPrompt, requestId, true);
      if (res.action && res.params) {
        this.executeVisualAction(res.action, res.params);
        this.callbacks.onVisualDrawn?.('Illustrated answer for student');
      } else if (res.diagramType && res.data) {
        avelutBoardController.drawDiagram(res.diagramType, res.data);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') console.warn('[BoardVisualizer] handleStudentQuery error:', err);
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
          if (target && newText) avelutBoardController.updateText(target, newText);
          break;
        }
        case 'write_keywords': {
          const keywords = params.keywords || (Array.isArray(params.data) ? params.data : []);
          avelutBoardController.writeKeywords(keywords, params.x, params.y);
          break;
        }
        case 'clear_component': {
          const target = params.target || params.targetTextOrLabel || '';
          if (target) avelutBoardController.removeComponent(target);
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
            params.targetTextOrLabel || params.text || params.targetText || '',
            params.style || 'box',
          );
          break;
        }
        case 'set_formula':
        case 'formula': {
          const formula = params.formula || params.text || params.content || '';
          if (formula) avelutBoardController.setFormula(formula);
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
    this.cancelPendingRequests();
    if (this.speechDebounceTimer) {
      clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = null;
    }
    this.speechBuffer = '';
    this.lastEvaluatedSpeech = '';
    this.lastPhraseTriggerAt = 0;
    this.isProcessing = false;
    this.hasGeneratedKickoff = false;
    this.setStatus('idle');
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────
export const avelutBoardVisualizer = new AvelutBoardVisualizerService();
