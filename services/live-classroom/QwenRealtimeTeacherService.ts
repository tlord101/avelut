import { liveLogger } from "./logger";
/**
 * QwenRealtimeTeacherService.ts
 *
 * Full-duplex WebSocket client for Alibaba Cloud Model Studio:
 * Model: qwen3.5-omni-flash-realtime  (Singapore / ap-southeast-1)
 *
 * Capabilities:
 *  - 16kHz PCM16 mic input streaming
 *  - 24kHz PCM16 gapless Web Audio playback
 *  - Semantic barge-in / interruption (input_audio_buffer.speech_started)
 *  - Native function / tool calling → dispatches to AvelutBoardController
 */

import { avelutBoardController } from './AvelutBoardController';
import { avelutBoardVisualizer } from './AvelutBoardVisualizerService';
import { buildTeacherSystemPrompt, type TeacherPromptConfig } from './teacherPrompt';
import { PedagogicalStateMachine } from './PedagogicalStateMachine';
import type { AppSettings } from '../../types';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TeacherState =
  | 'connecting'
  | 'connected'
  | 'speaking'
  | 'listening'
  | 'drawing'
  | 'error'
  | 'closed';

export interface QwenTeacherCallbacks {
  onStateChange?: (state: TeacherState) => void;
  /** Rolling transcript of teacher speech */
  onTranscript?: (text: string, isFinal?: boolean) => void;
  /** Mic input RMS level 0–1 for UI visualisation */
  onAudioLevel?: (level: number) => void;
  onError?: (error: Error) => void;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class QwenRealtimeTeacherService {
  // ── Network ────────────────────────────────────────────────────────────────
  private ws: WebSocket | null = null;
  private state: TeacherState = 'connecting';
  private callbacks: QwenTeacherCallbacks = {};

  // ── Audio — input (mic → WS) ────────────────────────────────────────────
  private inputAudioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processorNode: AudioNode | null = null;
  private isMuted = false;

  // ── Audio — output (WS → speaker) ──────────────────────────────────────
  private outputAudioCtx: AudioContext | null = null;
  private activeAudioSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;

  // ── Session ────────────────────────────────────────────────────────────────
  private promptConfig: TeacherPromptConfig | null = null;
  private appSettings: AppSettings | null = null;
  private fullTranscript = '';
  private lastTranscriptSlice = '';
  private hasCalledToolInTurn = false;
  private hasDrawnDiagramInTurn = false;
  private pendingToolCalls = new Map<string, { name: string; call_id: string; arguments: string }>();
  private executedCallIds = new Set<string>();
  private hasGreeted = false;
  private isStarting = false;
  private isSessionUpdated = false;
  private retriedWithDefaultVoice = false;
  private stateMachine: PedagogicalStateMachine | null = null;

  private teacherSpeakingUntil = 0;
  private avelutBoardController = avelutBoardController;
  private boardVisualizerService = avelutBoardVisualizer;

  // ── State helpers ─────────────────────────────────────────────────────────

  public setCallbacks(cb: QwenTeacherCallbacks): void { this.callbacks = cb; }
  public getState(): TeacherState { return this.state; }
  public getIsMuted(): boolean { return this.isMuted; }

  private setState(s: TeacherState): void {
    if (this.state === s) return;
    this.state = s;
    this.callbacks.onStateChange?.(s);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Initialise mic, create audio contexts, and open the WebSocket session */
  public async startSession(
    config: TeacherPromptConfig,
    appSettings?: AppSettings | null,
  ): Promise<void> {
    // Guard against double start
    if (this.isStarting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      liveLogger.log('[QwenRealtime] startSession: already connected or starting, returning early');
      return;
    }

    this.endSession();
    this.hasGreeted = false;
    this.isStarting = true;

    this.promptConfig = config;

    this.stateMachine = new PedagogicalStateMachine({
      topicTitle: config.topicTitle,
      durationMinutes: config.durationMinutes || 30,
      learningPath: config.learningPath,
      syllabusContext: config.syllabusContext
    });
    if (appSettings) this.appSettings = appSettings;
    this.setState('connecting');

    try {
      const AudioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.inputAudioCtx  = new AudioCtxClass({ sampleRate: 16000 });
      this.outputAudioCtx = new AudioCtxClass({ sampleRate: 24000 });

      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      await this.connectWebSocket();
      await this.startMicRecording();
      this.isStarting = false;
    } catch (err: any) {
      this.isStarting = false;
      liveLogger.error('[QwenRealtime] startSession failed:', err);
      this.setState('error');
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  /** Mute / unmute student mic. Returns new muted state. */
  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  /** Send a typed message into the realtime conversation */
  public sendTextMessage(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !text.trim()) return;
    this.sendJson({
      event_id: `user_txt_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: text.trim() }],
      },
    });
    this.sendJson({ event_id: `resp_${Date.now()}`, type: 'response.create' });
  }

  /** Stop all audio and close the WebSocket cleanly */
  public endSession(): void {
    this.stopPlayback();

    this.processorNode?.disconnect();
    this.processorNode = null;

    this.micStream?.getTracks().forEach(t => t.stop());
    this.micStream = null;

    void this.inputAudioCtx?.close();
    this.inputAudioCtx = null;

    void this.outputAudioCtx?.close();
    this.outputAudioCtx = null;

    if (this.ws) { this.ws.close(); }
    this.ws = null;

    this.pendingToolCalls.clear();
    this.executedCallIds.clear();
    this.hasGreeted = false;
    this.isStarting = false;
    this.isSessionUpdated = false;
    this.retriedWithDefaultVoice = false;

    this.stateMachine = null;

    this.setState('closed');
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private async connectWebSocket(): Promise<void> {
    let wsUrl: string;

    if (import.meta.env.VITE_QWEN_PROXY_URL) {
      wsUrl = import.meta.env.VITE_QWEN_PROXY_URL;
    } else {
      const isCapacitorNative =
        typeof window !== 'undefined' &&
        (window.location.protocol === 'capacitor:' ||
          window.location.protocol === 'ionic:' ||
          (window.location.hostname === 'localhost' && window.location.port === ''));

      if (isCapacitorNative) {
        const productionHost = import.meta.env.VITE_APP_HOST || 'www.avelut.xyz';
        wsUrl = `wss://${productionHost}/api/qwen-realtime`;
      } else {
        const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
        wsUrl = `${proto}://${window.location.host}/api/qwen-realtime`;
      }
    }

    liveLogger.log('[QwenRealtime] Connecting via proxy:', wsUrl);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        liveLogger.log('[QwenRealtime] Proxy connected ✅');
        this.setState('connected');
        this.sendSessionInit();
        resolve();
      };

      ws.onmessage = async (evt) => {
        try {
          let raw: string;
          if (typeof evt.data === 'string') {
            raw = evt.data;
          } else if (evt.data instanceof Blob) {
            raw = await evt.data.text();
          } else if (evt.data instanceof ArrayBuffer) {
            raw = new TextDecoder().decode(evt.data);
          } else {
            liveLogger.warn('[QwenRealtime] Unknown WS data type:', typeof evt.data, evt.data);
            return;
          }
          this.handleMessage(raw);
        } catch (err) {
          liveLogger.warn('[QwenRealtime] Failed to process WS message:', err);
        }
      };

      ws.onerror = () => {
        this.setState('error');
        reject(new Error(
          'Live Teacher connection failed. ' +
          'Ensure ALIBABA_API_KEY is set in your Vercel environment variables.',
        ));
      };

      ws.onclose = () => {
        if (this.state !== 'error') this.setState('closed');
      };
    });
  }

  private sendJson(payload: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Returns true if the output audio context is currently running */
  public isAudioUnlocked(): boolean {
    return this.outputAudioCtx?.state === 'running';
  }

  /** Public method to ensure AudioContext is active on user gesture */
  public async resumeAudio(): Promise<boolean> {
    try {
      const promises = [];
      if (this.inputAudioCtx && this.inputAudioCtx.state === 'suspended') {
        promises.push(this.inputAudioCtx.resume());
      }
      if (this.outputAudioCtx && this.outputAudioCtx.state === 'suspended') {
        promises.push(this.outputAudioCtx.resume());
      }
      await Promise.all(promises);
      return this.isAudioUnlocked();
    } catch (e) {
      liveLogger.warn('[QwenRealtime] resumeAudio warning:', e);
      return false;
    }
  }

  /** Triggers the initial teacher greeting manually from the UI */
  public triggerInitialGreeting(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.hasGreeted) {
      liveLogger.log('[QwenRealtime] Greeting already sent — skip');
      return;
    }
    this.hasGreeted = true;

    const topicStr = this.promptConfig?.topicTitle || 'the topic';
    const topic = `"${topicStr}"`;
    const duration = this.promptConfig?.durationMinutes || 30;
    liveLogger.log('[QwenRealtime] Manually triggering initial greeting and board illustration for', topic, `(${duration} min)`);

    // Give the model a direct instruction to greet warmly AND immediately draw on the board
    const compHint = topicStr.toLowerCase().includes('resistor') ? 'draw_component({ component: "resistor", label: "100 Ω", caption: "V = I · R" })' : `illustrate({ topic: ${JSON.stringify(topicStr)}, template: "concept_map" })`;
    this.sendJson({
      event_id: `kickoff_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Begin teaching ${topic} for our ${duration}-minute lesson now. Greet me warmly in 1-2 short sentences, announce that today we are mastering ${topic}, and immediately call your board tool ${compHint} or annotate({ text: ${JSON.stringify(topicStr)} }) to place the introductory visual anchor on the board as you speak! Do not ask me what topic we are going to discuss.`,
        }],
      },
    });

    this.sendJson({
      event_id: `greet_manual_${Date.now()}`,
      type: 'response.create',
    });
  }

  // ── Session initialisation ────────────────────────────────────────────────

  private sendSessionInit(overrideVoice?: string): void {
    if (!this.promptConfig) return;

    const stageInstruction = this.stateMachine ? this.stateMachine.getNextInstruction() : '';
    const instructions = buildTeacherSystemPrompt(this.promptConfig, stageInstruction);
    liveLogger.log('[QwenRealtime] Sending session.update with DashScope tools schema...');

    this.pendingToolCalls.clear();
    this.executedCallIds.clear();

    // DashScope Realtime (qwen3.5-omni-flash-realtime) supports 'Tina' as the primary English female voice.
    // 'Cherry' is a TTS-only voice and is rejected by the Realtime WebSocket endpoint with a 400 error.
    let selectedVoice = overrideVoice || this.appSettings?.alibaba_voice_name || 'Tina';
    if (selectedVoice === 'Cherry' || selectedVoice === 'Catherine' || !selectedVoice) {
      selectedVoice = 'Tina';
    }
    liveLogger.log('[QwenRealtime] Configuring session with voice:', selectedVoice);

    this.sendJson({
      event_id: `session_init_${Date.now()}`,
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: selectedVoice,
        instructions,
        input_audio_format: 'pcm',
        output_audio_format: 'pcm',
        turn_detection: {
          type: 'semantic_vad',
          threshold: 0.5,
          silence_duration_ms: 800,
        },
        tools: this.buildToolDeclarations(),
        tool_choice: 'auto',
        parallel_tool_calls: true,
      },
    });


  }

  private buildToolDeclarations() {
    return [
      {
        type: "function",
        name: "illustrate",
        description: `Request a detailed diagram from the board designer. Use this for ANY diagram with more than 3 shapes, concept maps, flowcharts, energy-flow diagrams, cycles, or equation setups.

CRITICAL BEHAVIORAL RULE: Before calling this tool, you MUST verbally announce it AND continue speaking for at least 5 seconds. Then call the tool while still narrating. After it returns, keep teaching by referring to what was drawn.

Examples of the required preamble:
- "So let me show you an example on the board. One minute please..."
- "Let me sketch this out for you so it's clearer..."
- "Watch the board — I'm putting this together now..."

You must NEVER call this tool silently. Never go silent while it runs.`,
        parameters: {
          type: "object",
          properties: {
            topic: { type: "string", description: "What the diagram should teach, e.g. 'heat engine energy flow with efficiency equation'" },
            template: {
              type: "string",
              enum: ["flowchart", "concept_map", "comparison", "cycle", "equation_setup", "custom"],
              description: "Layout template. Prefer a named template. Use 'custom' only for illustrative scenes that don't fit any template (e.g. 'stacked balls vs scattered balls')."
            },
            context: { type: "string", description: "Teaching context to inform tone and complexity, e.g. 'first-year university, pre-Kelvin discussion'" },
            constraints: {
              type: "object",
              properties: {
                max_nodes: { type: "number" },
                orientation: { type: "string", enum: ["horizontal", "vertical"] },
                color_palette: { type: "string", enum: ["default", "thermal", "cool", "warn"] }
              }
            }
          },
          required: ["topic", "template"]
        }
      },
      {
        type: "function",
        name: "annotate",
        description: "Write a short phrase directly on the board at a specific position. Use for quick callouts while talking: formulas you're deriving, step labels, terminology, quick definitions. This is FAST (no design step). Use it liberally between illustrate calls.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string" },
            x: { type: "number", description: "0-1600. Default 300." },
            y: { type: "number", description: "0-900. Default auto-place below last annotation." },
            fontSize: { type: "number", description: "Default 24. Use 48+ for headings." },
            color: { type: "string", description: "Hex. Default #1e1e1e." }
          },
          required: ["text"]
        }
      },
      {
        type: 'function',
        name: 'draw_component',
        description: 'Render a pre-made, high-quality engineering or physical illustration component directly on the board. Available components: "resistor", "circuit", "battery", "capacitor", "water_pipe", "heat_engine", "logic_gate". Always prefer this whenever introducing physical components!',
        parameters: {
          type: 'object',
          properties: {
            component: {
              type: 'string',
              enum: ['resistor', 'circuit', 'battery', 'capacitor', 'water_pipe', 'heat_engine', 'logic_gate'],
              description: 'The pre-made component to render'
            },
            label: { type: 'string', description: 'Component label or value (e.g. "100 Ω", "9V", "AND Gate")' },
            caption: { type: 'string', description: 'Governing equation or short note (e.g. "V = I · R")' }
          },
          required: ['component']
        }
      },
      {
        type: 'function',
        name: 'write_text',
        description: 'Write a key title, definition, core principle, or mathematical formula on the teaching board. Never write speech transcripts.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text or formula to display (formulas, key definitions, or concise points only)' }
          },
          required: ['text'],
        },
      },
      {
        type: 'function',
        name: 'set_formula',
        description: 'Display a highlighted law or equation in the formula card slot.',
        parameters: {
          type: 'object',
          properties: {
            formula: { type: 'string', description: 'The formula to display (e.g. F = ma)' }
          },
          required: ['formula'],
        },
      },
      {
        type: 'function',
        name: 'write_keywords',
        description: 'Write a row of highlighted keyword pills.',
        parameters: {
          type: 'object',
          properties: {
            keywords: { type: 'array', items: { type: 'string' }, description: 'Array of 2-4 technical terms' }
          },
          required: ['keywords'],
        },
      },
      {
        type: 'function',
        name: 'highlight_concept',
        description: 'Highlight or circle an existing board element by label text.',
        parameters: {
          type: 'object',
          properties: {
            targetText: { type: 'string' },
            style: { type: 'string', enum: ['circle', 'box', 'underline'] }
          },
          required: ['targetText'],
        },
      },
      {
        type: 'function',
        name: 'clear_stage',
        description: 'Clears the main diagram stage so new diagrams replace old ones cleanly.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        type: 'function',
        name: 'clear_board',
        description: 'Clear the entire canvas (keeps lesson title).',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
      {
        type: 'function',
        name: 'update_text',
        description: 'Update or edit the text of an existing element.',
        parameters: {
          type: 'object',
          properties: {
            targetText: { type: 'string' },
            newText: { type: 'string' }
          },
          required: ['targetText', 'newText'],
        },
      },
      {
        type: 'function',
        name: 'remove_component',
        description: 'Remove a component or text matching target text from the board.',
        parameters: {
          type: 'object',
          properties: {
            targetText: { type: 'string' }
          },
          required: ['targetText'],
        },
      },
    ];
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      liveLogger.warn('[QwenRealtime] Non-JSON message (first 150 chars):', String(raw).slice(0, 150));
      return;
    }

    if (!event?.type) {
      liveLogger.warn('[QwenRealtime] Event missing type. Payload:', event);
      liveLogger.warn('[QwenRealtime] Raw (first 200 chars):', String(raw).slice(0, 200));
      return;
    }

    // Log incoming event types clearly
    liveLogger.log(`[QwenRealtime] Event received: ${event.type}`);

    switch (event.type) {
      case 'session.created':
        liveLogger.log('[QwenRealtime] session.created on DashScope');
        if (!this.isSessionUpdated) {
          liveLogger.log('[QwenRealtime] Ensuring session.update is delivered after session.created');
          this.sendSessionInit();
        }
        break;

      case 'session.updated':
        this.isSessionUpdated = true;
        liveLogger.log('[QwenRealtime] session.updated on DashScope ✅');
        break;

      case 'response.audio.delta':
        if (event.delta) {
          this.teacherSpeakingUntil = performance.now() + 400;
          this.setState('speaking');
          void this.playDelta(event.delta);
        }
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.fullTranscript += event.delta;
          this.lastTranscriptSlice += event.delta;
          this.callbacks.onTranscript?.(this.fullTranscript, false);
        }
        break;

      case 'response.audio_transcript.done':
        this.callbacks.onTranscript?.(this.fullTranscript, true);
        break;
      case 'response.created':
        this.hasCalledToolInTurn = false;
        this.hasDrawnDiagramInTurn = false;
        break;


      // ── Semantic barge-in ───────────────────────────────────────────────
      case 'input_audio_buffer.speech_started':
        this.fullTranscript = '';
        this.lastTranscriptSlice = '';
        if (performance.now() < this.teacherSpeakingUntil) {
          liveLogger.log('[QwenRealtime] Ignoring barge-in during teacher speech');
          return;
        }
        this.stopPlayback();
        this.setState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        this.setState('listening');
        break;

      // ── Tool / function call ────────────────────────────────────────────
      case 'conversation.item.created':
        liveLogger.log('[QwenRealtime] conversation.item.created', event.item?.id);
        break;

      case 'response.output_item.added': {
        liveLogger.log(`[QwenRealtime] response.output_item.added:`, event.item?.type);
        if (event.item?.type === 'function_call') {
          const item = event.item;
          const key = item.call_id || item.id;
          if (key) {
            const entry = {
              name: item.name,
              call_id: item.call_id || item.id,
              arguments: item.arguments || '',
            };
            this.pendingToolCalls.set(key, entry);
            if (item.id) this.pendingToolCalls.set(item.id, entry);
          }
        }
        break;
      }

      case 'response.function_call_arguments.delta': {
        const key = event.call_id || event.item_id;
        if (key && this.pendingToolCalls.has(key)) {
          const pending = this.pendingToolCalls.get(key)!;
          pending.arguments += (event.delta || '');
        }
        break;
      }

      case 'response.function_call_arguments.done': {
        const key = event.call_id || event.item_id;
        const pending = key ? this.pendingToolCalls.get(key) : null;
        const toolName = event.name || pending?.name;
        const callId = event.call_id || pending?.call_id || key;
        const argsStr = event.arguments || pending?.arguments || '{}';

        liveLogger.log('[QwenRealtime] TOOL CALL arguments.done:', {
          name: toolName,
          call_id: callId,
          arguments: argsStr,
        });

        if (toolName && callId) {
          this.executeToolCall(callId, toolName, argsStr);
        }
        break;
      }

      case 'response.output_item.done': {
        liveLogger.log(`[QwenRealtime] response.output_item.done:`, event.item?.type);
        if (event.item?.type === 'function_call') {
          const item = event.item;
          const callId = item.call_id || item.id;
          const toolName = item.name;
          const argsStr = item.arguments || '{}';
          if (toolName && callId) {
            this.executeToolCall(callId, toolName, argsStr);
          }
        }
        break;
      }

      case 'response.done': {
        if (this.state === 'speaking' || this.state === 'drawing') {
          setTimeout(() => { if (this.state !== 'listening') this.setState('listening'); }, 400);
        }

        // NOTE: Verbatim speech transcripts are deliberately NOT dumped to the board!
        // We demote the phrase-trigger backup so it only triggers as a last resort, avoiding dual-writer chaos.
        // Also removed autonomous visualizer processing.
        const stage = this.stateMachine?.getCurrentStage?.() ?? 'GREETING';
        const ILLUSTRATABLE_STAGES = new Set(['EXPLANATION', 'DEMONSTRATION', 'EXAMPLE']);

        if (!this.hasCalledToolInTurn && ILLUSTRATABLE_STAGES.has(stage) && this.lastTranscriptSlice.trim().length >= 25) {
          const triggered = /(let me draw|on the board|let me show you)/i.test(this.lastTranscriptSlice);
          if (triggered) {
            liveLogger.log('[QwenRealtime] Fallback: Model spoke drawing phrases but missed tool call. Asking visualizer.');
            import('./AvelutBoardVisualizerService').then(({ avelutBoardVisualizer }) => {
              avelutBoardVisualizer.illustrateFromBoardWrite({
                boardText: 'Fallback Diagram Request',
                recentSpeech: this.lastTranscriptSlice.slice(-250),
                forceDiagram: true,
              });
            });
          } else {
            liveLogger.log('[QwenRealtime] No tool called this turn, but no drawing phrase detected. Doing nothing.');
          }
        }

        // Reset turn state
        this.hasCalledToolInTurn = false;
        this.fullTranscript = '';
        this.lastTranscriptSlice = '';

        if (this.stateMachine) {
           const prevStage = this.stateMachine.getCurrentStage();
           const timeChanged = this.stateMachine.evaluateState();
           const minuteAdvanceChanged = this.stateMachine.evaluateMinuteBasedAdvance();
           liveLogger.setStage(this.stateMachine.getCurrentStage());
           const turnChanged = this.stateMachine.advance();
           if (timeChanged || minuteAdvanceChanged || turnChanged) {
             if (this.stateMachine.getCurrentStage() !== prevStage) {
               avelutBoardController.clearStage();
             }
             this.sendSessionInit(); // Send session update to update prompt with new state
           }
        }
        break;
      }

      case 'error':
        liveLogger.error('[QwenRealtime] Server error:', event.error);
        if (event.error?.message?.includes('Voice') && !this.retriedWithDefaultVoice) {
          this.retriedWithDefaultVoice = true;
          liveLogger.warn('[QwenRealtime] Voice error encountered. Auto-recovering session with voice "Tina"...');
          this.sendSessionInit('Tina');
          return;
        }
        this.callbacks.onError?.(new Error(event.error?.message ?? 'Qwen Realtime server error'));
        break;

      default: break;
    }
  }

  // ── Tool execution → AvelutBoardController ────────────────────────────────

  private async executeToolCall(callId: string, name: string, argsRaw: any): Promise<void> {
    if (this.executedCallIds.has(callId)) return;
    this.executedCallIds.add(callId);

    // Prevent double-draw of diagram
    if (name === 'illustrate' || name === 'draw_diagram') {
      if (this.hasDrawnDiagramInTurn) {
        liveLogger.warn('[QwenRealtime] Skipping duplicate illustrate/diagram in same turn:', argsRaw);
        return;
      }
    }

    this.hasCalledToolInTurn = true;
    this.setState('drawing');

    let args: any = {};
    try {
      args = typeof argsRaw === 'string'
        ? JSON.parse(argsRaw)
        : (argsRaw ?? {});
    } catch (e) {
      liveLogger.warn('[QwenRealtime] Bad tool args:', argsRaw);
    }

    liveLogger.log('[QwenRealtime] Executing board tool:', name, args);

    let toolResult: any = { success: true, tool: name };

    try {
      switch (name) {
        case 'annotate': {
          this.hasCalledToolInTurn = true;
          const x = args.x ?? 300;
          const y = args.y ?? this.avelutBoardController.nextAnnotationY();
          const fontSize = args.fontSize ?? 24;
          const color = args.color ?? '#1e1e1e';
          this.avelutBoardController.addSkeletonElement({
            type: 'text',
            id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            x,
            y,
            text: args.text,
            fontSize,
            strokeColor: color,
          });
          toolResult = { status: 'ok' };
          break;
        }

        case 'illustrate': {
          this.hasCalledToolInTurn = true;

          // Deduplicate: refuse a second illustrate in the same turn
          if (this.hasDrawnDiagramInTurn) {
            liveLogger.warn('[QwenRealtime] illustrate called twice in one turn — ignoring second');
            toolResult = { status: 'skipped', reason: 'already_drew_this_turn' };
            break;
          }
          this.hasDrawnDiagramInTurn = true;
          this.boardVisualizerService.hasGeneratedKickoff = true;

          const boardSummary = this.avelutBoardController.getCompactSummary();
          const reserve = this.avelutBoardController.reserveVerticalSpace(600);

          try {
            const result = await this.boardVisualizerService.generateStructuredDiagram({
              topic: args.topic,
              template: args.template,
              context: args.context || '',
              constraints: args.constraints || {},
              canvas: { width: 1600, height: 900, reservedTop: 80 },
              yOffset: reserve.y,
              existingBoardSummary: boardSummary,
            });

            if (!result || !Array.isArray(result.elements) || result.elements.length === 0) {
              liveLogger.error('[QwenRealtime] illustrate returned empty result');
              toolResult = { status: 'failed', reason: 'designer_empty' };
              break;
            }

            // Enforce skeleton ordering: shapes → arrows → text
            const ordered = [
              ...result.elements.filter((e: any) => ['rectangle', 'ellipse', 'diamond'].includes(e.type)),
              ...result.elements.filter((e: any) => ['arrow', 'line'].includes(e.type)),
              ...result.elements.filter((e: any) => e.type === 'text'),
            ];

            this.avelutBoardController.drawStructured(ordered);

            // Inject board summary back into realtime context (NON-BLOCKING)
            const newSummary = this.avelutBoardController.getCompactSummary();
            this.injectBoardStateMessage(newSummary);

            toolResult = {
              status: 'rendered',
              title: result.meta?.title,
              board_summary: newSummary,
            };
          } catch (err) {
            liveLogger.error('[QwenRealtime] illustrate failed:', err);
            toolResult = { status: 'failed', reason: String(err) };
          }
          break;
        }

        case 'draw_component': {
          this.hasCalledToolInTurn = true;
          this.boardVisualizerService.hasGeneratedKickoff = true;
          this.avelutBoardController.drawComponent({
            component: args.component,
            label: args.label,
            caption: args.caption,
          });
          const summary = this.avelutBoardController.getCompactSummary();
          this.injectBoardStateMessage(summary);
          toolResult = {
            status: 'rendered',
            component: args.component,
            board_summary: summary,
          };
          break;
        }

        case 'write_text':
          this.avelutBoardController.writeText(args.text ?? args.content ?? '');
          break;
        case 'set_formula':
          this.avelutBoardController.setFormula(args.formula ?? args.text ?? args.content ?? '');
          break;
        case 'write_keywords':
          this.avelutBoardController.writeKeywords(args.keywords ?? []);
          break;
        case 'highlight_concept':
          this.avelutBoardController.highlightConcept(args.targetText ?? '', args.style);
          break;
        case 'clear_stage':
          this.avelutBoardController.clearStage();
          break;
        case 'clear_board':
          this.avelutBoardController.clearBoard();
          break;
        case 'update_text':
          this.avelutBoardController.updateText(args.targetText ?? '', args.newText ?? '');
          break;
        case 'remove_component':
          this.avelutBoardController.removeComponent(args.targetText ?? '');
          break;

        default:
          liveLogger.warn('[QwenRealtime] Unknown tool:', name, args);
          break;
      }
    } catch (toolErr) {
      liveLogger.error('[QwenRealtime] Tool execution error:', toolErr);
    }

    // Always return tool output so model can continue speaking
    if (callId) {
      this.sendJson({
        event_id: `tool_out_${Date.now()}`,
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(toolResult),
        },
      });
      this.sendJson({
        event_id: `resp_after_tool_${Date.now()}`,
        type: 'response.create',
      });
    }
  }

  private injectBoardStateMessage(summary: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    liveLogger.log('[QwenRealtime] injected board state summary:', summary);
    this.ws.send(JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text: `[BOARD STATE] ${summary}` }]
      }
    }));
  }

  // ── Audio input (mic → WebSocket) ─────────────────────────────────────────

  private async startMicRecording(): Promise<void> {
    if (!this.inputAudioCtx || !this.micStream) return;

    const source = this.inputAudioCtx.createMediaStreamSource(this.micStream);

    const handleAudioData = (data: Float32Array) => {
      if (this.isMuted || this.ws?.readyState !== WebSocket.OPEN) return;
      if (this.state === 'speaking' || performance.now() < this.teacherSpeakingUntil) return;

      // Compute RMS for UI visualisation
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      this.callbacks.onAudioLevel?.(Math.min(1, Math.sqrt(sum / data.length) * 4));

      // Float32 → Int16 → Base64
      const pcm16 = new Int16Array(data.length);
      for (let i = 0; i < data.length; i++) {
        const s = Math.max(-1, Math.min(1, data[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      const bytes = new Uint8Array(pcm16.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) {
        bin += String.fromCharCode(bytes[i]);
      }

      this.sendJson({
        event_id: `aud_in_${Date.now()}`,
        type: 'input_audio_buffer.append',
        audio: btoa(bin),
      });
    };

    // 1. Try modern AudioWorkletNode first (prevents ScriptProcessorNode deprecation warning)
    if (this.inputAudioCtx.audioWorklet) {
      try {
        const workletCode = `
          class PCM16RecorderProcessor extends AudioWorkletProcessor {
            process(inputs) {
              const input = inputs[0];
              if (input && input[0]) {
                this.port.postMessage(input[0]);
              }
              return true;
            }
          }
          registerProcessor('pcm16-recorder-processor', PCM16RecorderProcessor);
        `;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const workletUrl = URL.createObjectURL(blob);
        await this.inputAudioCtx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);

        const workletNode = new AudioWorkletNode(this.inputAudioCtx, 'pcm16-recorder-processor');
        workletNode.port.onmessage = (e) => {
          if (e.data && e.data instanceof Float32Array) {
            handleAudioData(e.data);
          }
        };

        source.connect(workletNode);
        workletNode.connect(this.inputAudioCtx.destination);
        this.processorNode = workletNode;
        return;
      } catch (workletErr) {
        liveLogger.warn('[QwenRealtime] AudioWorklet init failed, falling back to ScriptProcessor:', workletErr);
      }
    }

    // 2. Fallback: ScriptProcessorNode for legacy browser/webview compatibility
    const scriptProcessor = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
      handleAudioData(e.inputBuffer.getChannelData(0));
    };
    source.connect(scriptProcessor);
    scriptProcessor.connect(this.inputAudioCtx.destination);
    this.processorNode = scriptProcessor;
  }

  // ── Audio output (WebSocket → speaker) ───────────────────────────────────

  private async ensureOutputRunning(): Promise<void> {
    if (!this.outputAudioCtx) return;
    if (this.outputAudioCtx.state === 'suspended') {
      try {
        await this.outputAudioCtx.resume();
      } catch (err) {
        liveLogger.warn('[QwenRealtime] ensureOutputRunning failed to resume:', err);
      }
    }
  }

  private async playDelta(base64: string): Promise<void> {
    if (!this.outputAudioCtx || !base64) return;
    try {
      // Ensure audio context is running when we receive audio
      await this.ensureOutputRunning();

      if (this.outputAudioCtx.state === 'suspended') {
        liveLogger.warn('[QwenRealtime] AudioContext still suspended — cannot play');
        return;
      }

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const sampleCount = Math.floor(bytes.byteLength / 2);
      if (sampleCount <= 0) {
        liveLogger.warn('[QwenRealtime] playDelta empty samples');
        return;
      }

      const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount);
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        float32[i] = int16[i] / 32768;
      }

      const buf = this.outputAudioCtx.createBuffer(1, sampleCount, 24000);
      buf.copyToChannel(float32, 0);

      const src = this.outputAudioCtx.createBufferSource();
      src.buffer = buf;

      const gain = this.outputAudioCtx.createGain();
      gain.gain.value = 1.0;
      src.connect(gain);
      gain.connect(this.outputAudioCtx.destination);

      const now = this.outputAudioCtx.currentTime;
      if (this.activeAudioSources.length === 0) {
        this.nextPlayTime = now + 0.08;
      } else if (this.nextPlayTime < now - 0.25) {
        this.nextPlayTime = now;
      }
      src.start(this.nextPlayTime);
      this.nextPlayTime += buf.duration;

      this.activeAudioSources.push(src);
      src.onended = () => {
        const i = this.activeAudioSources.indexOf(src);
        if (i !== -1) this.activeAudioSources.splice(i, 1);
      };
    } catch (err) {
      liveLogger.warn('[QwenRealtime] playDelta error:', err);
    }
  }

  /** Instantly stop all queued teacher speech buffers */
  public stopPlayback(): void {
    this.activeAudioSources.forEach(s => { try { s.stop(); s.disconnect(); } catch (_) {} });
    this.activeAudioSources = [];
    if (this.outputAudioCtx) this.nextPlayTime = this.outputAudioCtx.currentTime;
  }
}
