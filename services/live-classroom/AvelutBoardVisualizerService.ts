/**
 * AvelutBoardVisualizerService.ts (Board Designer Service)
 *
 * Director in the Director/Actor split:
 *  - Realtime audio model (Actor) narrates and issues semantic intents (illustrate / annotate).
 *  - This service (Director / Board Designer) generates Excalidraw skeleton JSON diagrams.
 *  - AvelutBoardController (Stage) acts as a pure renderer.
 *
 * Dual duty:
 *  1. Primary backend for realtime `illustrate` tool calls via `generateStructuredDiagram`.
 *  2. Fallback illustrator for missed tool calls in illustratable stages.
 */

import { avelutBoardController } from './AvelutBoardController';
import { getAlibabaApiKey } from '../../utils/appSettings';
import { BOARD_DESIGNER_SYSTEM_PROMPT } from './boardDesignerPrompt';
import type { AppSettings } from '../../types';

export interface StructuredDiagramRequest {
  topic: string;
  template: 'flowchart' | 'concept_map' | 'comparison' | 'cycle' | 'equation_setup' | 'custom';
  context: string;
  constraints: { max_nodes?: number; orientation?: 'horizontal' | 'vertical'; color_palette?: string };
  canvas: { width: number; height: number; reservedTop: number };
  yOffset: number;
  existingBoardSummary: string;
}

export interface StructuredDiagramResult {
  elements: any[];                 // Excalidraw skeletons
  meta: { title?: string; beat?: string; continuation?: boolean };
}

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
  public hasGeneratedKickoff = false;
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


  private buildDesignerUserPrompt(req: StructuredDiagramRequest): string {
    return `Design a ${req.template} for the topic: "${req.topic}".

Teaching context: ${req.context || 'general university lecture'}

Constraints:
- max_nodes: ${req.constraints.max_nodes ?? 8}
- orientation: ${req.constraints.orientation ?? 'auto'}
- color_palette: ${req.constraints.color_palette ?? 'default'}

Existing board content (avoid duplicating; position new diagram below it):
${req.existingBoardSummary || '(empty board)'}

The diagram will be placed starting at y-offset ${req.yOffset} on a 1600x900 canvas.
Return ONLY the JSON object described in the system prompt.`;
  }

  async generateStructuredDiagram(req: StructuredDiagramRequest): Promise<StructuredDiagramResult | null> {
    console.log(`[BoardDesigner] generating deterministic ${req.template} layout for: ${req.topic}`);
    const elements: any[] = [];
    const topic = req.topic.replace(/- key concept.*$/i, '').trim();
    const y0 = req.yOffset || 120;
    const norm = topic.toLowerCase();

    // 1. Check for physical / electrical components first
    if (norm.includes('resistor') || norm.includes('circuit')) {
      elements.push(
        { type: 'rectangle', id: 'src', x: 260, y: y0 + 60, width: 160, height: 90, roundness: { type: 3 }, backgroundColor: '#ffec99', label: { text: 'DC Source\n[ 9V Battery ]', fontSize: 16 } },
        { type: 'rectangle', id: 'res', x: 600, y: y0 + 60, width: 200, height: 90, roundness: { type: 3 }, backgroundColor: '#a5d8ff', label: { text: 'Resistor (R)\n[ 100 Ω ]', fontSize: 16 } },
        { type: 'ellipse', id: 'gnd', x: 980, y: y0 + 75, width: 120, height: 60, roundness: { type: 3 }, backgroundColor: '#d3f9d8', label: { text: 'Ground (0V)', fontSize: 16 } },
        { type: 'arrow', id: 'wire1', x: 420, y: y0 + 105, width: 180, height: 0, points: [[0, 0], [180, 0]], endArrowhead: 'arrow', start: { id: 'src' }, end: { id: 'res' }, label: { text: 'I (Current) →', fontSize: 14 } },
        { type: 'arrow', id: 'wire2', x: 800, y: y0 + 105, width: 180, height: 0, points: [[0, 0], [180, 0]], endArrowhead: 'arrow', start: { id: 'res' }, end: { id: 'gnd' }, label: { text: 'Return wire', fontSize: 14 } },
        { type: 'text', id: 'eq', x: 560, y: y0 + 200, text: 'V = I · R  (Ohm\'s Law)', fontSize: 32 },
        { type: 'text', id: 'role', x: 530, y: y0 + 260, text: 'Limits current flow & dissipates heat: P = I²R', fontSize: 18 },
      );
      return { elements, meta: { title: 'Resistor Circuit Schematic' } };
    }

    if (norm.includes('engine') || norm.includes('thermodynamic')) {
      elements.push(
        { type: 'ellipse', id: 'th', x: 600, y: y0, width: 200, height: 110, roundness: { type: 3 }, backgroundColor: '#ffc9c9', label: { text: 'Hot Reservoir (T_H)', fontSize: 18 } },
        { type: 'rectangle', id: 'engine', x: 620, y: y0 + 220, width: 160, height: 100, roundness: { type: 3 }, backgroundColor: '#ffec99', label: { text: 'Engine', fontSize: 18 } },
        { type: 'ellipse', id: 'tc', x: 600, y: y0 + 440, width: 200, height: 110, roundness: { type: 3 }, backgroundColor: '#a5d8ff', label: { text: 'Cold Reservoir (T_C)', fontSize: 18 } },
        { type: 'arrow', id: 'arr_qh', x: 700, y: y0 + 110, width: 0, height: 110, points: [[0, 0], [0, 110]], endArrowhead: 'arrow', start: { id: 'th' }, end: { id: 'engine' }, label: { text: 'Q_H', fontSize: 14 } },
        { type: 'arrow', id: 'arr_qc', x: 700, y: y0 + 320, width: 0, height: 120, points: [[0, 0], [0, 120]], endArrowhead: 'arrow', start: { id: 'engine' }, end: { id: 'tc' }, label: { text: 'Q_C', fontSize: 14 } },
        { type: 'arrow', id: 'arr_w', x: 780, y: y0 + 270, width: 160, height: 0, points: [[0, 0], [160, 0]], endArrowhead: 'arrow', start: { id: 'engine' }, label: { text: 'W (work)', fontSize: 14 } },
        { type: 'text', id: 'eq', x: 980, y: y0 + 250, text: 'η = 1 − T_C / T_H', fontSize: 32 },
      );
      return { elements, meta: { title: 'Heat Engine Cycle' } };
    }

    // 2. Templates: flowchart, comparison, cycle, equation_setup, concept_map
    if (req.template === 'flowchart') {
      elements.push(
        { type: 'rectangle', id: 'step1', x: 500, y: y0 + 20, width: 240, height: 80, roundness: { type: 3 }, backgroundColor: '#ffec99', label: { text: '1. Input State', fontSize: 18 } },
        { type: 'rectangle', id: 'step2', x: 500, y: y0 + 180, width: 240, height: 80, roundness: { type: 3 }, backgroundColor: '#a5d8ff', label: { text: `2. ${topic}`, fontSize: 18 } },
        { type: 'rectangle', id: 'step3', x: 500, y: y0 + 340, width: 240, height: 80, roundness: { type: 3 }, backgroundColor: '#b2f2bb', label: { text: '3. Outcome / Result', fontSize: 18 } },
        { type: 'arrow', id: 'arr1', x: 620, y: y0 + 100, width: 0, height: 80, points: [[0, 0], [0, 80]], endArrowhead: 'arrow', start: { id: 'step1' }, end: { id: 'step2' }, label: { text: 'processes' } },
        { type: 'arrow', id: 'arr2', x: 620, y: y0 + 260, width: 0, height: 80, points: [[0, 0], [0, 80]], endArrowhead: 'arrow', start: { id: 'step2' }, end: { id: 'step3' }, label: { text: 'produces' } },
      );
      return { elements, meta: { title: `${topic} Flow` } };
    }

    if (req.template === 'comparison') {
      elements.push(
        { type: 'rectangle', id: 'comp_left', x: 300, y: y0 + 40, width: 260, height: 160, roundness: { type: 3 }, backgroundColor: '#ffec99', label: { text: `Aspect A\n[ Principles of ${topic} ]`, fontSize: 18 } },
        { type: 'rectangle', id: 'comp_right', x: 680, y: y0 + 40, width: 260, height: 160, roundness: { type: 3 }, backgroundColor: '#a5d8ff', label: { text: 'Aspect B\n[ Contrasting Behavior ]', fontSize: 18 } },
        { type: 'arrow', id: 'comp_arrow', x: 560, y: y0 + 120, width: 120, height: 0, points: [[0, 0], [120, 0]], startArrowhead: 'arrow', endArrowhead: 'arrow', start: { id: 'comp_left' }, end: { id: 'comp_right' }, label: { text: 'vs' } },
      );
      return { elements, meta: { title: `${topic} Comparison` } };
    }

    if (req.template === 'cycle') {
      elements.push(
        { type: 'rectangle', id: 'c1', x: 520, y: y0 + 20, width: 180, height: 70, roundness: { type: 3 }, backgroundColor: '#ffec99', label: { text: 'State 1', fontSize: 16 } },
        { type: 'rectangle', id: 'c2', x: 760, y: y0 + 160, width: 180, height: 70, roundness: { type: 3 }, backgroundColor: '#a5d8ff', label: { text: 'State 2', fontSize: 16 } },
        { type: 'rectangle', id: 'c3', x: 520, y: y0 + 300, width: 180, height: 70, roundness: { type: 3 }, backgroundColor: '#b2f2bb', label: { text: 'State 3', fontSize: 16 } },
        { type: 'rectangle', id: 'c4', x: 280, y: y0 + 160, width: 180, height: 70, roundness: { type: 3 }, backgroundColor: '#ffc9c9', label: { text: 'State 4', fontSize: 16 } },
        { type: 'arrow', id: 'cy1', x: 700, y: y0 + 55, start: { id: 'c1' }, end: { id: 'c2' }, endArrowhead: 'arrow' },
        { type: 'arrow', id: 'cy2', x: 850, y: y0 + 230, start: { id: 'c2' }, end: { id: 'c3' }, endArrowhead: 'arrow' },
        { type: 'arrow', id: 'cy3', x: 520, y: y0 + 335, start: { id: 'c3' }, end: { id: 'c4' }, endArrowhead: 'arrow' },
        { type: 'arrow', id: 'cy4', x: 370, y: y0 + 160, start: { id: 'c4' }, end: { id: 'c1' }, endArrowhead: 'arrow' },
      );
      return { elements, meta: { title: `${topic} Cycle` } };
    }

    // Default: Concept Map
    elements.push(
      { type: 'ellipse', id: 'center', x: 480, y: y0 + 80, width: 260, height: 110, roundness: { type: 3 }, backgroundColor: '#ffec99', label: { text: topic, fontSize: 20 } },
      { type: 'rectangle', id: 'node1', x: 140, y: y0 + 30, width: 220, height: 80, roundness: { type: 3 }, backgroundColor: '#a5d8ff', label: { text: 'Core Principle', fontSize: 16 } },
      { type: 'rectangle', id: 'node2', x: 860, y: y0 + 30, width: 220, height: 80, roundness: { type: 3 }, backgroundColor: '#b2f2bb', label: { text: 'Governing Formula', fontSize: 16 } },
      { type: 'rectangle', id: 'node3', x: 500, y: y0 + 280, width: 220, height: 80, roundness: { type: 3 }, backgroundColor: '#ffc9c9', label: { text: 'Real Application', fontSize: 16 } },
      { type: 'arrow', id: 'a1', x: 480, y: y0 + 120, start: { id: 'center' }, end: { id: 'node1' }, endArrowhead: 'arrow' },
      { type: 'arrow', id: 'a2', x: 740, y: y0 + 120, start: { id: 'center' }, end: { id: 'node2' }, endArrowhead: 'arrow' },
      { type: 'arrow', id: 'a3', x: 610, y: y0 + 190, start: { id: 'center' }, end: { id: 'node3' }, endArrowhead: 'arrow' },
    );
    return { elements, meta: { title: `${topic} Concept Map` } };
  }

  private safeJsonParse(raw: string): any | null {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { /* fall through */ }

    let s = String(raw).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .replace(/,\s*([}\]])/g, '$1');       // remove trailing commas

    // Strip trailing incomplete key or unclosed string
    let inStr = false, esc = false;
    for (const ch of s) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
    }
    if (inStr) s += '"';
    s = s.replace(/,\s*$/, '');
    s = s.replace(/:\s*$/, ': null');

    // Balance braces/brackets using stack
    const stack: string[] = [];
    inStr = false;
    esc = false;
    for (const ch of s) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') {
        if (stack.length && stack[stack.length - 1] === ch) {
          stack.pop();
        }
      }
    }
    while (stack.length > 0) {
      s += stack.pop();
    }

    try {
      const parsed = JSON.parse(s);
      console.warn('[BoardDesigner] Salvaged truncated JSON');
      return parsed;
    } catch {
      // Try to extract the largest {...} block if any
      const jsonMatch = String(raw).match(/\{[\s\S]*\}/);
      if (jsonMatch && jsonMatch[0] !== s) {
        try { return JSON.parse(jsonMatch[0]); } catch { /* fall through */ }
      }
      console.error('[BoardDesigner] Unrecoverable JSON:', String(raw).slice(-300));
      return null;
    }
  }

  // ── Network Fetch to Alibaba Text Models ───────────────────────────────────

  private async callAlibabaTextModel(
    systemPromptOrOptions: string | { systemPrompt: string; userPrompt: string; maxTokens?: number; responseFormat?: any; requestId?: string },
    userPromptArg?: string,
    requestIdArg?: string,
    isComplexArg = false,
  ): Promise<any> {
    const isOptionsObj = typeof systemPromptOrOptions === 'object';
    const systemPrompt = isOptionsObj ? systemPromptOrOptions.systemPrompt : systemPromptOrOptions;
    const userPrompt = isOptionsObj ? systemPromptOrOptions.userPrompt : (userPromptArg || '');
    const requestId = isOptionsObj
      ? (systemPromptOrOptions.requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`)
      : (requestIdArg || `req_${Date.now()}`);
    const isComplex = isOptionsObj ? true : isComplexArg;
    const maxTokens = isOptionsObj ? (systemPromptOrOptions.maxTokens ?? 2048) : (isComplex ? 2048 : 1024);

    // Text model suspended: board operations are driven directly by realtime voice model tool calls and client-side determinism
    console.log('[BoardVisualizer] Text model suspended — zero network fetch needed');
    return null;
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

    try {
      const norm = (topicTitle || '').toLowerCase();
      // Fast path for pre-made engineering and physical components
      if (norm.includes('resistor') || norm.includes('circuit') || norm.includes('capacitor') || norm.includes('battery') || norm.includes('engine') || norm.includes('gate') || norm.includes('pipe')) {
        let comp = 'resistor';
        if (norm.includes('circuit')) comp = 'circuit';
        else if (norm.includes('capacitor')) comp = 'capacitor';
        else if (norm.includes('battery')) comp = 'battery';
        else if (norm.includes('engine')) comp = 'heat_engine';
        else if (norm.includes('gate')) comp = 'logic_gate';
        else if (norm.includes('pipe')) comp = 'water_pipe';

        avelutBoardController.drawComponent({ component: comp });
        this.hasGeneratedKickoff = true;
        this.setStatus('ready');
        this.callbacks.onVisualDrawn?.(`Pre-made ${comp} schematic`);
        return;
      }

      const reserve = avelutBoardController.reserveVerticalSpace(380);
      const res = await this.generateStructuredDiagram({
        topic: `${topicTitle} - key concept, visual components, circuit/structure, and formula`,
        template: 'concept_map',
        context: syllabusContext || courseName,
        constraints: { max_nodes: 6, color_palette: 'default' },
        canvas: { width: 1600, height: 900, reservedTop: 80 },
        yOffset: reserve.y,
        existingBoardSummary: avelutBoardController.getCompactSummary(),
      });

      if (res && Array.isArray(res.elements) && res.elements.length > 0) {
        const ordered = [
          ...res.elements.filter((e: any) => ['rectangle', 'ellipse', 'diamond'].includes(e.type)),
          ...res.elements.filter((e: any) => ['arrow', 'line'].includes(e.type)),
          ...res.elements.filter((e: any) => e.type === 'text'),
        ];
        avelutBoardController.drawStructured(ordered);
        this.hasGeneratedKickoff = true;
        this.setStatus('ready');
        this.callbacks.onVisualDrawn?.(res.meta?.title || 'Kickoff diagram');
      } else {
        this.setStatus('ready');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[BoardVisualizer] kickoff error:', err);
        this.setStatus('error', err.message);
      }
    }
  }

  // ── Speech Transcript Monitoring (phrase-triggered illustration) ─────────

  /**
   * Called as speech transcripts arrive from QwenRealtimeTeacherService.
   * Stores the latest transcript for context without triggering unrequested background diagrams.
   */
  public processSpeechTranscript(transcript: string, _isTurnFinal = false): void {
    if (!transcript) return;
    this.speechBuffer = transcript;
    // Autonomous phrase-triggered illustration is disabled:
    // In Director/Actor architecture, diagrams are drawn exclusively via the teacher's
    // explicit tool calls (draw_component, illustrate, annotate) or student queries.
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

    try {
      const res = await this.generateStructuredDiagram({
        topic: this.config.topicTitle,
        template: 'concept_map',
        context: recentSpeech.slice(-150),
        constraints: {},
        canvas: { width: 1600, height: 900, reservedTop: 80 },
        yOffset: avelutBoardController.reserveVerticalSpace(380).y,
      });

      if (res && res.elements && res.elements.length > 0) {
        avelutBoardController.drawStructured(res.elements);
        this.callbacks.onVisualDrawn?.(res.meta?.title || 'Concept map');
      }
    } catch (err: any) {
      console.warn('[BoardVisualizer] phrase illustration error:', err);
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

    try {
      const res = await this.generateStructuredDiagram({
        topic: params.boardText || this.config.topicTitle,
        template: 'concept_map',
        context: params.recentSpeech.slice(-150),
        constraints: {},
        canvas: { width: 1600, height: 900, reservedTop: 80 },
        yOffset: avelutBoardController.reserveVerticalSpace(380).y,
      });

      if (res && res.elements && res.elements.length > 0) {
        avelutBoardController.drawStructured(res.elements);
        this.callbacks.onVisualDrawn?.(`Illustrated: ${params.boardText}`);
      }
    } catch (err: any) {
      console.warn('[BoardVisualizer] illustrateFromBoardWrite error:', err);
    } finally {
      this.setStatus('ready');
    }
  }

  public async illustrateOnDemand(requestedDiagramType?: string): Promise<void> {
    if (!this.config?.topicTitle) return;
    this.setStatus('visualizing', `Generating ${requestedDiagramType || 'visual diagram'}…`);
    try {
      const template = (requestedDiagramType === 'flow' ? 'flowchart' : requestedDiagramType === 'cycle' ? 'cycle' : 'concept_map') as any;
      const res = await this.generateStructuredDiagram({
        topic: this.config.topicTitle,
        template,
        context: '',
        constraints: {},
        canvas: { width: 1600, height: 900, reservedTop: 80 },
        yOffset: avelutBoardController.reserveVerticalSpace(380).y,
        existingBoardSummary: avelutBoardController.getCompactSummary(),
      });
      if (res && res.elements.length > 0) {
        avelutBoardController.drawStructured(res.elements);
        this.callbacks.onVisualDrawn?.(`Drawn ${template} on board`);
      }
    } finally {
      this.setStatus('ready');
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

    this.setStatus('visualizing', `Visual note for student query…`);
    try {
      if (lower.includes('resistor') || lower.includes('circuit') || lower.includes('battery') || lower.includes('capacitor') || lower.includes('engine')) {
        let comp = 'resistor';
        if (lower.includes('circuit')) comp = 'circuit';
        else if (lower.includes('battery')) comp = 'battery';
        else if (lower.includes('capacitor')) comp = 'capacitor';
        else if (lower.includes('engine')) comp = 'heat_engine';
        avelutBoardController.drawComponent({ component: comp });
        this.callbacks.onVisualDrawn?.(`Pre-made ${comp} schematic`);
      } else {
        avelutBoardController.drawStickyNote({
          text: `Q: ${query.slice(0, 80)}`,
          backgroundColor: '#fff3bf',
        });
        this.callbacks.onVisualDrawn?.('Student Question Note');
      }
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
export const avelutBoardDesigner = avelutBoardVisualizer;
export const AvelutBoardDesignerService = AvelutBoardVisualizerService;
