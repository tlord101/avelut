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

    const proxyEndpoints = isNative
      ? ['https://www.avelut.xyz/api/alibaba-chat', '/api/alibaba-chat']
      : ['/api/alibaba-chat', 'https://www.avelut.xyz/api/alibaba-chat'];

    const directEndpoint = `https://${workspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions`;
    const endpoints = [...proxyEndpoints, directEndpoint];

    const payload = {
      model: 'qwen3.7-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.25,
      response_format: { type: 'json_object' },
      max_tokens: 1200,
    };

    let lastError: any = null;

    for (const ep of endpoints) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
        if (workspaceId) {
          headers['X-DashScope-WorkSpace'] = workspaceId;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 14000);

        const res = await fetch(ep, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          console.warn(`[BoardVisualizer] Endpoint ${ep} returned ${res.status}:`, errBody);
          continue;
        }

        const data = await res.json();
        const contentStr = data?.choices?.[0]?.message?.content;
        if (!contentStr) throw new Error('Empty response from Alibaba model');

        try {
          return JSON.parse(contentStr);
        } catch {
          // Handle potential markdown code fencing in JSON output
          const cleaned = contentStr.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          return JSON.parse(cleaned);
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[BoardVisualizer] Error connecting to ${ep}:`, err.message);
      }
    }

    throw lastError || new Error('Failed to reach Alibaba text model endpoints');
  }

  // ── Kickoff Illustration ──────────────────────────────────────────────────

  /**
   * Generates a high-impact opening board layout immediately upon entering the classroom.
   */
  public async generateKickoffIllustration(): Promise<void> {
    if (!this.config?.topicTitle) return;
    if (this.hasGeneratedKickoff) return;

    this.hasGeneratedKickoff = true;
    this.setStatus('visualizing', `Designing opening board for ${this.config.topicTitle}…`);

    const { topicTitle, courseName = 'Academic Course', syllabusContext, durationMinutes = 30, learningPath } = this.config;

    const systemPrompt = `You are an elite academic visualizer for an interactive blackboard.
Your job is to generate a clean, educational opening layout on the board for the lesson topic.
Choose the MOST intuitive visual diagram format:
- "concept_map": for conceptual topics with a central theme and 3-5 radiating branches (biology, medicine, social sciences, general science).
- "cycle": for processes that repeat or loop (water cycle, cell cycle, feedback loops, economic circuits).
- "flow": for sequential steps, reactions, derivations, or algorithms (step 1 -> step 2 -> step 3).
- "comparison": for contrasting two opposing concepts or mechanisms (mitosis vs meiosis, AC vs DC, RAM vs ROM).
- "coordinate_axes": for graphs, physics trajectories, or mathematical equations.
- "free_body" or "collision": for physics force and momentum problems.

Return ONLY a valid JSON object matching this schema:
{
  "boardTitle": "Title to display at top",
  "diagram": {
    "diagramType": "concept_map" | "cycle" | "flow" | "comparison" | "coordinate_axes" | "collision" | "free_body",
    "data": {
      // For concept_map: { "centralConcept": "...", "branches": [{ "label": "..." }, { "label": "..." }, { "label": "..." }] }
      // For cycle: { "title": "...", "steps": ["Step 1", "Step 2", "Step 3", "Step 4"] }
      // For flow: { "steps": ["Step 1", "Step 2", "Step 3"] }
      // For comparison: { "leftTitle": "...", "rightTitle": "...", "leftPoints": ["point 1", "point 2"], "rightPoints": ["point 1", "point 2"] }
      // For coordinate_axes: { "title": "...", "xAxisLabel": "...", "yAxisLabel": "..." }
      // For collision: { "item1Mass": "m₁", "item1Velocity": "v₁", "item2Mass": "m₂", "item2Velocity": "v₂", "equation": "m₁v₁ + m₂v₂ = ..." }
      // For free_body: { "objectLabel": "m", "forces": [{ "name": "F_N", "direction": "up" }, { "name": "F_g", "direction": "down" }] }
    }
  },
  "formula": "Primary formula / law equation or null",
  "keyTakeaways": ["Core insight 1", "Core insight 2"]
}`;

    const userPrompt = `Topic: "${topicTitle}"
Course: "${courseName}"
Syllabus / Context: "${syllabusContext || 'Standard curriculum'}"
Roadmap: ${learningPath?.length ? JSON.stringify(learningPath) : 'Core principles, visual intuition, practical application'}
Duration: ${durationMinutes} minutes

Create the opening visual blackboard presentation now!`;

    try {
      const result = await this.callAlibabaTextModel(systemPrompt, userPrompt);
      console.log('[BoardVisualizer] Kickoff layout generated:', result);

      // Execute on board
      if (result.boardTitle) {
        avelutBoardController.writeText(result.boardTitle, {
          fontSize: 'title',
          color: '#38BDF8',
          x: 60,
          y: 40,
        });
      }

      if (result.diagram?.diagramType && result.diagram?.data) {
        avelutBoardController.drawDiagram(result.diagram.diagramType, result.diagram.data);
      }

      if (result.formula) {
        avelutBoardController.writeText(result.formula, {
          fontSize: 'large',
          color: '#FDE047',
          isFormula: true,
        });
      }

      if (Array.isArray(result.keyTakeaways)) {
        for (const point of result.keyTakeaways) {
          avelutBoardController.writeText(`• ${point}`, {
            fontSize: 'small',
            color: '#E2E8F0',
          });
        }
      }

      this.setStatus('ready');
      this.callbacks.onVisualDrawn?.(`Visualized ${result.diagram?.diagramType || 'topic'} on board`);
    } catch (err: any) {
      console.error('[BoardVisualizer] generateKickoffIllustration error:', err);
      this.setStatus('error', err.message);

      // Graceful fallback: render a clean concept map directly without waiting
      this.renderFallbackKickoff(topicTitle);
    }
  }

  private renderFallbackKickoff(topic: string): void {
    avelutBoardController.writeText(`📚 ${topic}`, {
      fontSize: 'title',
      color: '#38BDF8',
      x: 60,
      y: 40,
    });
    avelutBoardController.drawDiagram('concept_map', {
      centralConcept: topic,
      branches: [
        { label: 'Key Principles' },
        { label: 'Mechanisms' },
        { label: 'Applications' },
      ],
    });
    this.setStatus('ready');
  }

  // ── Speech Transcript Monitoring (Autonomous Co-Pilot) ────────────────────

  /**
   * Called as speech transcripts arrive from QwenRealtimeTeacherService.
   */
  public processSpeechTranscript(transcript: string, isTurnFinal = false): void {
    if (!transcript) return;

    this.speechBuffer = transcript;

    if (isTurnFinal) {
      if (this.speechDebounceTimer) clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = setTimeout(() => {
        void this.evaluateSpeechForVisuals();
      }, 400);
      return;
    }

    // Debounce stream: evaluate if enough novel text accumulated
    const novelChars = transcript.length - this.lastEvaluatedSpeech.length;
    if (novelChars > 70 && !this.isProcessing) {
      if (this.speechDebounceTimer) clearTimeout(this.speechDebounceTimer);
      this.speechDebounceTimer = setTimeout(() => {
        void this.evaluateSpeechForVisuals();
      }, 2000);
    }
  }

  /**
   * Sends the recent speech explanation to the Alibaba text model to determine
   * if a specific formula, shape, highlight, or diagram should appear on the board.
   */
  private async evaluateSpeechForVisuals(): Promise<void> {
    if (this.isProcessing || !this.config?.topicTitle) return;

    const currentSpeech = this.speechBuffer.trim();
    if (currentSpeech.length < 30 || currentSpeech === this.lastEvaluatedSpeech) return;

    // Isolate what was recently said since last evaluation
    const recentChunk = currentSpeech.slice(this.lastEvaluatedSpeech.length).trim() || currentSpeech.slice(-250);
    this.lastEvaluatedSpeech = currentSpeech;

    // Skip short conversational greetings / checks
    if (recentChunk.length < 25 || /^(hello|hi|welcome|can you hear|let's begin|are you ready)/i.test(recentChunk)) {
      return;
    }

    this.isProcessing = true;
    this.setStatus('visualizing', 'Updating board illustration…');

    const systemPrompt = `You are an elite autonomous digital blackboard illustrator working alongside a live spoken lecture.
The voice teacher just explained this in speech: "${recentChunk}"
Lesson Topic: "${this.config.topicTitle}"

Decide how the blackboard should dynamically be updated, edited, illustrated, or cleared right now.
Supported actions:
- "draw_diagram": draw an intuitive visual diagram (concept_map, cycle, flow, comparison, coordinate_axes, collision, free_body)
- "write_text": write an equation, formula, law, or definition (text, fontSize: "medium"|"large", isFormula: boolean, color: "#38BDF8"|"#FDE047")
- "edit_text": modify an existing text or formula component on the board (target: "string to find", newText: "replacement text")
- "write_keywords": render a row of highlighted keyword pills (keywords: ["term1", "term2", "term3"])
- "highlight_concept": draw an attention highlight around an existing concept (targetTextOrLabel: "...", style: "box"|"circle"|"underline")
- "clear_component": erase an obsolete section or diagram (target: "...")
- "clear_board": clear the board keeping title (keepTitle: true) when moving to a brand-new subtopic milestone

Return ONLY valid JSON matching:
{
  "shouldDraw": true,
  "summary": "Brief 3-word summary of the visual action",
  "actions": [
    {
      "action": "draw_diagram" | "write_text" | "edit_text" | "write_keywords" | "highlight_concept" | "clear_component" | "clear_board",
      "params": { ... }
    }
  ]
}
OR if a single action:
{
  "shouldDraw": true,
  "summary": "...",
  "action": "...",
  "params": { ... }
}
OR if it was just conversational banter / no visual needed:
{
  "shouldDraw": false
}`;

    const userPrompt = `Topic: "${this.config.topicTitle}"
Teacher Spoke: "${recentChunk}"

Decide what visual updates to render on the blackboard right now.`;

    try {
      const decision = await this.callAlibabaTextModel(systemPrompt, userPrompt);
      console.log('[BoardVisualizer] Speech evaluation decision:', decision);

      if (decision.shouldDraw) {
        if (Array.isArray(decision.actions)) {
          for (const item of decision.actions) {
            if (item.action && item.params) {
              this.executeVisualAction(item.action, item.params);
            }
          }
        } else if (decision.action && decision.params) {
          this.executeVisualAction(decision.action, decision.params);
        }
        this.callbacks.onVisualDrawn?.(decision.summary || 'Updated blackboard');
      }
    } catch (err) {
      console.warn('[BoardVisualizer] evaluateSpeechForVisuals error:', err);
    } finally {
      this.isProcessing = false;
      this.setStatus('ready');
    }
  }

  // ── On-Demand Illustration ────────────────────────────────────────────────

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
    try {
      switch (action) {
        case 'draw_diagram': {
          const type = params.diagramType || params.type || 'concept_map';
          const data = params.data || params;
          avelutBoardController.drawDiagram(type, data);
          break;
        }
        case 'write_text': {
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
        case 'draw_shape': {
          avelutBoardController.drawShape({
            type: params.type || 'rectangle',
            x: Number(params.x) || 60,
            y: Number(params.y) || 120,
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
