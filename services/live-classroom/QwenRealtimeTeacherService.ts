/**
 * QwenRealtimeTeacherService.ts
 *
 * Full-duplex WebSocket client for Alibaba Cloud Model Studio.
 *
 * Architecture:
 *   Student mic → Qwen Omni Realtime → audio + visual tool → classroom board
 *
 * One realtime model with multiple visual tools. The model chooses the
 * visual language that matches the teaching task.
 */

import { liveLogger } from './logger';
import { avelutBoardController } from './AvelutBoardController';
import { buildTeacherSystemPrompt, type TeacherPromptConfig } from './teacherPrompt';
import type { AppSettings } from '../../types';
import { MermaidBoardService } from './visual-engine/MermaidBoardService';
import { LlmSvgObjectCache } from './visual-engine/LlmSvgObjectCache';
import { createAvelutAI, getResponseText } from '../../utils/inference';

export const QWEN_REALTIME_MODEL = 'qwen3.8-omni-flash-realtime';
export const QWEN_FALLBACK_MODEL = 'qwen-omni-turbo-realtime';

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
  /** Realtime transcript stream delta */
  onTranscriptDelta?: (delta: string) => void;
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
  private isExplicitlyClosed = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;

  // ── Audio — input (mic → WS) ────────────────────────────────────────────
  private inputAudioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private processorNode: AudioNode | null = null;
  private isMuted = false;

  // ── Audio — output (WS → speaker) ──────────────────────────────────────
  private outputAudioCtx: AudioContext | null = null;
  private outputGainNode: GainNode | null = null;
  private activeAudioSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;
  private pcmRemainder: Uint8Array = new Uint8Array(0);

  // ── Session ────────────────────────────────────────────────────────────────
  private promptConfig: TeacherPromptConfig | null = null;
  private appSettings: AppSettings | null = null;
  private fullTranscript = '';
  private pendingToolCalls = new Map<string, { name: string; call_id: string; arguments: string }>();
  private executedCallIds = new Set<string>();
  private hasGreeted = false;
  private isStarting = false;
  private isSessionUpdated = false;
  private retriedWithDefaultVoice = false;
  private currentModel = QWEN_REALTIME_MODEL;
  private boardController = avelutBoardController;
  private hasReceivedAudioInCurrentResponse = false;
  private isAwaitingContinuation = false;
  private studentWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly STUDENT_WAIT_MAX_MS = 3000;
  private consecutiveSilenceNudges = 0;
  private readonly MAX_CONSECUTIVE_SILENCE_NUDGES = 2;
  private isStudentSpeaking = false;
  /** True only when the last teacher response ended with a question to the student */
  private lastResponseAskedQuestion = false;

  // ── State helpers ─────────────────────────────────────────────────────────

  public setCallbacks(cb: QwenTeacherCallbacks): void { this.callbacks = cb; }
  public getState(): TeacherState { return this.state; }
  public getIsMuted(): boolean { return this.isMuted; }

  private setState(s: TeacherState): void {
    if (this.state === s) return;
    this.state = s;
    this.callbacks.onStateChange?.(s);

    if (s === 'listening') {
      // Only start the silence watchdog when teacher asked the student a question.
      // Pure teaching monologue turns, board draws, and tool calls never block for response.
      if (this.lastResponseAskedQuestion) {
        this.startStudentWaitTimer();
      }
    } else {
      this.clearStudentWaitTimer();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Initialise mic, create audio contexts, and open the WebSocket session */
  public async startSession(
    config: TeacherPromptConfig,
    appSettings?: AppSettings | null,
  ): Promise<void> {
    if (this.isStarting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      liveLogger.log('[QwenRealtime] startSession: already connected or starting, returning early');
      return;
    }

    this.endSession();
    this.isExplicitlyClosed = false;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.hasGreeted = false;
    this.consecutiveSilenceNudges = 0;
    this.isStarting = true;

    this.promptConfig = config;
    if (appSettings) this.appSettings = appSettings;
    this.setState('connecting');

    try {
      const AudioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      this.inputAudioCtx  = new AudioCtxClass({ sampleRate: 16000 });
      // Use native device hardware sample rate for output to prevent Android audio driver cracking
      this.outputAudioCtx = new AudioCtxClass();
      this.outputGainNode = this.outputAudioCtx.createGain();
      this.outputGainNode.gain.value = 1.0;
      this.outputGainNode.connect(this.outputAudioCtx.destination);

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
    this.consecutiveSilenceNudges = 0;
    this.clearStudentWaitTimer();
    this.sendJson({
      event_id: `user_txt_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: text.trim() }],
      },
    });
    this.sendJson({
      event_id: `resp_${Date.now()}`,
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        tools: this.getTools(),
        tool_choice: 'auto',
      },
    });
  }

  /** Stop all audio and close the WebSocket cleanly */
  public endSession(): void {
    this.isExplicitlyClosed = true;
    this.clearHeartbeat();
    this.clearStudentWaitTimer();
    this.consecutiveSilenceNudges = 0;
    this.isStudentSpeaking = false;
    this.isReconnecting = false;
    this.stopPlayback();

    this.processorNode?.disconnect();
    this.processorNode = null;

    this.micStream?.getTracks().forEach(t => t.stop());
    this.micStream = null;

    void this.inputAudioCtx?.close();
    this.inputAudioCtx = null;

    this.outputGainNode?.disconnect();
    this.outputGainNode = null;
    this.pcmRemainder = new Uint8Array(0);

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

    this.setState('closed');
  }

  // ── WebSocket & Keepalive ──────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch (e) {
          liveLogger.warn('[QwenRealtime] Heartbeat send error:', e);
        }
      }
    }, 15000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isReconnecting || this.isExplicitlyClosed) return;
    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.setState('connecting');

    const delayMs = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 5000);
    liveLogger.log(`[QwenRealtime] Reconnection attempt #${this.reconnectAttempts} in ${delayMs}ms...`);

    await new Promise(r => setTimeout(r, delayMs));
    if (this.isExplicitlyClosed) return;

    try {
      await this.connectWebSocket();
      liveLogger.log('[QwenRealtime] Auto-reconnected successfully! 🔄');
      if (this.inputAudioCtx && this.inputAudioCtx.state === 'suspended') {
        void this.inputAudioCtx.resume();
      }
    } catch (err) {
      liveLogger.error('[QwenRealtime] Reconnection attempt failed:', err);
      this.isReconnecting = false;
      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS && !this.isExplicitlyClosed) {
        void this.attemptReconnect();
      } else if (!this.isExplicitlyClosed) {
        this.setState('error');
        this.callbacks.onError?.(new Error('Live connection lost. Tap retry to reconnect.'));
      }
    }
  }

  private async connectWebSocket(modelToUse: string = this.currentModel): Promise<void> {
    this.currentModel = modelToUse;
    let wsUrl: string;
    const modelParam = `model=${encodeURIComponent(modelToUse)}`;

    // Strict default: use persistent Render-hosted WebSocket proxy to bypass 5-min serverless limits
    const DEFAULT_RENDER_PROXY = 'wss://avelut-realtime-proxy.onrender.com/qwen-realtime';
    const proxyBase = ((import.meta as any).env?.VITE_QWEN_PROXY_URL || DEFAULT_RENDER_PROXY).trim();
    wsUrl = proxyBase.includes('?') ? `${proxyBase}&${modelParam}` : `${proxyBase}?${modelParam}`;

    liveLogger.log('[QwenRealtime] Connecting strictly via Render proxy:', wsUrl, `(model: ${modelToUse})`);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        liveLogger.log('[QwenRealtime] Proxy connected ✅');
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.setState('connected');
        this.startHeartbeat();
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

      ws.onclose = (evt) => {
        liveLogger.warn('[QwenRealtime] WebSocket onclose. Code:', evt.code, 'Reason:', evt.reason, 'Explicit:', this.isExplicitlyClosed);
        this.clearHeartbeat();

        if (!this.isExplicitlyClosed && this.hasGreeted && this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
          liveLogger.log('[QwenRealtime] Connection dropped unexpectedly — attempting auto-reconnect...');
          void this.attemptReconnect();
        } else if (!this.isExplicitlyClosed && this.state !== 'error') {
          this.setState('closed');
        }
      };
    });
  }

  private sendJson(payload: Record<string, any>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Returns true if both audio contexts are currently running */
  public isAudioUnlocked(): boolean {
    const outOk = !this.outputAudioCtx || this.outputAudioCtx.state === 'running';
    const inOk = !this.inputAudioCtx || this.inputAudioCtx.state === 'running';
    return outOk && inOk;
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
      liveLogger.log(
        '[QwenRealtime] resumeAudio completed: input =',
        this.inputAudioCtx?.state,
        'output =',
        this.outputAudioCtx?.state
      );
      return this.isAudioUnlocked();
    } catch (e) {
      liveLogger.warn('[QwenRealtime] resumeAudio warning:', e);
      return false;
    }
  }

  /**
   * Triggers the initial teacher greeting.
   * The session is already configured — just ask the model to begin.
   */
  public triggerInitialGreeting(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      liveLogger.warn('[QwenRealtime] triggerInitialGreeting called but WebSocket is not open');
      return;
    }
    if (this.state === 'error' || this.state === 'closed') {
      liveLogger.warn('[QwenRealtime] triggerInitialGreeting skipped because state is:', this.state);
      return;
    }
    if (this.hasGreeted) {
      liveLogger.log('[QwenRealtime] Greeting already sent — skip');
      return;
    }
    this.hasGreeted = true;

    // Ensure audio contexts are resumed on this user gesture
    void this.resumeAudio();

    const topic = this.promptConfig?.topicTitle || 'the topic';
    const duration = this.promptConfig?.durationMinutes || 30;
    const plan = this.promptConfig?.teachingPlan;
    const phase1Name = plan?.phases?.[0]?.phaseName || 'Stage 1';
    liveLogger.log('[QwenRealtime] Triggering initial greeting for', topic, `(${duration} min) [Phase 1: ${phase1Name}]`);

    // Give the model its starting instruction as a user message
    this.sendJson({
      event_id: `kickoff_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Start the lesson on "${topic}". We have ${duration} minutes. Greet the student warmly, introduce the topic in simple words (Phase 1: ${phase1Name}), and begin with an intuitive everyday example.`,
        }],
      },
    });

    this.sendJson({
      event_id: `greet_${Date.now()}`,
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        tools: this.getTools(),
        tool_choice: 'auto',
      },
    });
  }

  // ── 5-Second Student Silence Watchdog ─────────────────────────────────────

  private startStudentWaitTimer(): void {
    this.clearStudentWaitTimer();
    if (
      this.isStudentSpeaking ||
      !this.hasGreeted ||
      this.isAwaitingContinuation ||
      this.state !== 'listening' ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    this.studentWaitTimer = setTimeout(() => {
      this.studentWaitTimer = null;
      if (
        this.isStudentSpeaking ||
        this.state !== 'listening' ||
        this.isAwaitingContinuation ||
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      if (this.consecutiveSilenceNudges >= this.MAX_CONSECUTIVE_SILENCE_NUDGES) {
        liveLogger.log('[QwenRealtime] Max consecutive silence nudges reached — pausing auto-nudge until student speaks or types');
        return;
      }

      this.consecutiveSilenceNudges++;
      liveLogger.log(`[QwenRealtime] ⏱️ 3s student silence elapsed (nudge #${this.consecutiveSilenceNudges}) — prompting teacher to continue with board action`);

      // Force a mermaid board action so the board is always updated during silence
      this._triggerSilenceBoardAction();

      this.sendJson({
        event_id: `silence_nudge_${Date.now()}`,
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: '[The student is listening attentively. Continue teaching the next concept naturally in simple, encouraging words. Use draw_mermaid_diagram or write_on_board to reinforce the key idea visually — silently, without narrating it.]',
          }],
        },
      });

      this.sendJson({
        event_id: `resp_silence_${Date.now()}`,
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          tools: this.getTools(),
          tool_choice: 'required',
        },
      });
    }, this.STUDENT_WAIT_MAX_MS);
  }

  private clearStudentWaitTimer(): void {
    if (this.studentWaitTimer) {
      clearTimeout(this.studentWaitTimer);
      this.studentWaitTimer = null;
    }
  }

  /**
   * Directly renders a Mermaid concept-map onto the board during student silence.
   * Bypasses the LLM entirely — always fires instantly and is guaranteed to draw.
   */
  private _triggerSilenceBoardAction(): void {
    try {
      const topic = this.promptConfig?.topicTitle || 'the topic';
      const phase = this.promptConfig?.teachingPlan?.phases?.[this.consecutiveSilenceNudges % 3];
      const phaseLabel = phase?.phaseName || 'Key Concepts';
      const keyword1 = phase?.boardVisualPlan?.content?.split(/[\s,|]+/)?.[0] || topic;
      const keyword2 = phase?.boardVisualPlan?.content?.split(/[\s,|]+/)?.[1] || 'Definition';

      // Build a minimal concept-map Mermaid diagram for the current topic/phase
      const mermaidCode = [
        'graph LR',
        `  A["${topic}"] --> B["${phaseLabel}"]`,
        `  B --> C["${keyword1}"]`,
        `  B --> D["${keyword2}"]`,
      ].join('\n');

      liveLogger.log('[QwenRealtime] _triggerSilenceBoardAction: rendering mermaid for', topic);
      MermaidBoardService.renderToSvg(mermaidCode).then(svg => {
        if (svg) this.boardController.setSvgIllustration(svg);
      }).catch(err => {
        liveLogger.warn('[QwenRealtime] Silence board action mermaid render failed:', err);
      });
    } catch (err) {
      liveLogger.warn('[QwenRealtime] _triggerSilenceBoardAction error (non-fatal):', err);
    }
  }



  private sendSessionInit(overrideVoice?: string): void {
    if (!this.promptConfig) return;

    const instructions = buildTeacherSystemPrompt(this.promptConfig);
    liveLogger.log('[QwenRealtime] Sending session.update...');

    // Voice selection
    let selectedVoice = overrideVoice || this.appSettings?.alibaba_voice_name || 'Katerina';
    if (selectedVoice === 'Cherry' || selectedVoice === 'Catherine' || !selectedVoice) {
      selectedVoice = 'Katerina';
    }
    liveLogger.log('[QwenRealtime] Session voice:', selectedVoice);

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
          type: 'server_vad',
          threshold: 0.5,
          silence_duration_ms: 800,
        },
        tools: this.getTools(),
        tool_choice: 'auto',
      },
    });
  }

  /**
   * The single board tool exposed to the model.
   * Uses Alibaba's documented function calling schema.
   */
  private buildBoardActionTool() {
    const parameters = {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['draw', 'write', 'clear', 'highlight', 'erase'],
          description:
            'draw=create step-by-step boxes with arrows, write=add text/formula/keyword, ' +
            'clear=clear current area, highlight=emphasize existing concept, erase=remove element to draw in that space',
        },
        elements: {
          type: 'array',
          description:
            'Elements for "draw" action. Each element: ' +
            '{kind:"box"|"circle"|"diamond"|"arrow"|"text", id?, text?, x?, y?, from?, to?, label?}',
          items: { type: 'object' },
        },
        text: {
          type: 'string',
          description: 'Text, formula ($$ ... $$), or key takeaway keyword to write on the board (for "write" action)',
        },
        target: {
          type: 'string',
          description: 'Target element label, ID, or "last" (for "highlight" or "erase" actions)',
        },
      },
      required: ['action'],
    };

    const description =
      'Control the educational Excalidraw board. On EVERY turn you MUST call board_action ' +
      'with action "write" to put 1–5 short keywords or a tiny takeaway on the board while teaching. ' +
      'Also use write/draw for formulas, calculations, derivations, and sequential steps. ' +
      'Do NOT use draw boxes for ordinary concept maps — use draw_mermaid for those. ' +
      'For comparisons, a compact table-like grid is OK.';

    return {
      type: 'function',
      name: 'board_action',
      description,
      parameters,
    };
  }

  private getTools() {
    return [
      this.buildBoardActionTool(),
      this.buildDrawMermaidTool(),
      this.buildIllustrateObjectTool(),
    ];
  }

  private buildDrawMermaidTool() {
    return {
      type: 'function',
      name: 'draw_mermaid',
      description:
        'Render a Mermaid.js diagram inboard directly onto the visual whiteboard canvas. Prefer this for concept ' +
        'relationships, concept maps, mind maps, flowcharts, branching processes, ' +
        'cause/effect, hierarchies, classifications, system architecture, cycles, ' +
        'state transitions, and component interactions. Choose LR/TB or another ' +
        'supported Mermaid layout according to the relationship. Keep labels concise and educational.',
      parameters: {
        type: 'object',
        properties: {
          mermaid_code: {
            type: 'string',
            description:
              'Raw valid Mermaid source code. Do not include markdown fences. ' +
              'Keep labels concise and educational.',
          },
        },
        required: ['mermaid_code'],
      },
    };
  }

  private buildIllustrateObjectTool() {
    return {
      type: 'function',
      name: 'illustrate_object',
      description: 'Generate and render a detailed SVG illustration of a complex object, entity, or process inboard directly onto the visual whiteboard canvas.',
      parameters: {
        type: 'object',
        properties: {
          object_description: {
            type: 'string',
            description: 'A clear, short description of the object to illustrate (e.g. "a eukaryotic cell", "a red sports car", "DNA double helix").',
          },
        },
        required: ['object_description'],
      },
    };
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
      if (event?.code || event?.message) {
        const errMsg = event.message || event.code;
        liveLogger.error('[QwenRealtime] DashScope error response:', event);

        // If the model does not exist or is restricted on this key/workspace, auto-fallback to QWEN_FALLBACK_MODEL
        const isModelRejected =
          typeof errMsg === 'string' &&
          (errMsg.includes('Model not exist') || errMsg.includes('API-Key restrictions') || errMsg.includes('Access denied')) &&
          this.currentModel !== QWEN_FALLBACK_MODEL;

        if (isModelRejected) {
          liveLogger.warn(`[QwenRealtime] Model "${this.currentModel}" rejected (${errMsg}). Retrying automatically with fallback model "${QWEN_FALLBACK_MODEL}"...`);
          this.currentModel = QWEN_FALLBACK_MODEL;
          this.isSessionUpdated = false;
          if (this.ws) {
            try { this.ws.close(); } catch {}
            this.ws = null;
          }
          this.connectWebSocket(QWEN_FALLBACK_MODEL).catch((err) => {
            liveLogger.error('[QwenRealtime] Fallback connection failed:', err);
            this.setState('error');
            this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
          });
          return;
        }

        this.setState('error');
        this.callbacks.onError?.(new Error(`DashScope error [${event.code || 'UNKNOWN'}]: ${errMsg}`));
      } else {
        liveLogger.warn('[QwenRealtime] Event missing type. Payload:', event);
      }
      return;
    }

    liveLogger.log(`[QwenRealtime] ← ${event.type}`);

    switch (event.type) {
      case 'session.created':
        liveLogger.log('[QwenRealtime] session.created');
        if (!this.isSessionUpdated) {
          this.sendSessionInit();
        }
        break;

      case 'session.updated':
        this.isSessionUpdated = true;
        liveLogger.log('[QwenRealtime] session.updated ✅');
        break;

      case 'response.audio.delta':
        if (event.delta) {
          if (!this.hasReceivedAudioInCurrentResponse) {
            this.hasReceivedAudioInCurrentResponse = true;
            this.isAwaitingContinuation = false;
            liveLogger.log('[QwenRealtime] Audio response receiving / playing');
          }
          this.setState('speaking');
          void this.playDelta(event.delta);
        }
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.fullTranscript += event.delta;
          this.callbacks.onTranscriptDelta?.(event.delta);
          this.callbacks.onTranscript?.(this.fullTranscript, false);
        }
        break;

      case 'response.audio_transcript.done': {
        this.callbacks.onTranscript?.(this.fullTranscript, true);
        // Detect if the teacher just asked the student a question.
        // Only then should we start the silence watchdog after audio finishes.
        const t = this.fullTranscript.trimEnd();
        this.lastResponseAskedQuestion = (
          t.endsWith('?') ||
          /\b(what do you think|does that make sense|can you tell me|do you understand|try it|your turn|what is|what's|how about|right\?|yes\?|ok\?|okay\?|got it\?|make sense\?)$/i.test(t)
        );
        liveLogger.log(`[QwenRealtime] Transcript done — askedQuestion: ${this.lastResponseAskedQuestion}`);
        break;
      }

      case 'response.created':
        // New response turn — reset transcript accumulator and question flag
        this.fullTranscript = '';
        this.lastResponseAskedQuestion = false;
        this.hasReceivedAudioInCurrentResponse = false;
        this.clearStudentWaitTimer();
        liveLogger.log('[QwenRealtime] response.created');
        break;

      // ── Student interruption / speech events ─────────────────────────────
      case 'input_audio_buffer.speech_started':
        // Qwen's VAD says the student is speaking — stop teacher audio cleanly.
        liveLogger.log('[QwenRealtime] 🎙️ Student speech started — stopping teacher audio');
        this.isStudentSpeaking = true;
        this.consecutiveSilenceNudges = 0;
        this.clearStudentWaitTimer();
        this.stopPlayback();
        this.setState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        liveLogger.log('[QwenRealtime] 🎙️ Student speech stopped — awaiting model response');
        this.isStudentSpeaking = false;
        this.clearStudentWaitTimer();
        break;

      case 'input_audio_buffer.committed':
        liveLogger.log('[QwenRealtime] input_audio_buffer.committed');
        break;

      // ── Tool / function call ────────────────────────────────────────────
      case 'response.output_item.added': {
        liveLogger.log(`[QwenRealtime] output_item.added:`, event.item?.type);
        if (event.item?.type === 'function_call' || event.item?.type === 'custom_tool_call') {
          const item = event.item;
          const key = item.call_id || item.id;
          if (key) {
            const entry = {
              name: item.name || item.function?.name,
              call_id: item.call_id || item.id,
              arguments: item.arguments || item.function?.arguments || '',
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
        const toolName = event.name || event.function?.name || pending?.name;
        const callId = event.call_id || pending?.call_id || key;
        
        let argsStr = event.arguments || event.function?.arguments || '';
        if (pending && pending.arguments && pending.arguments.length > argsStr.length) {
          argsStr = pending.arguments;
        }
        if (!argsStr) argsStr = '{}';

        liveLogger.log(
          `[QwenRealtime] TOOL CALL RECEIVED\n` +
          `name: ${toolName}\n` +
          `call_id: ${callId}\n` +
          `arguments: ${argsStr}`
        );

        if (toolName && callId) {
          void this.executeToolCall(callId, toolName, argsStr);
        }
        break;
      }

      case 'response.output_item.done': {
        liveLogger.log(`[QwenRealtime] output_item.done:`, event.item?.type);
        if (event.item?.type === 'function_call' || event.item?.type === 'custom_tool_call') {
          const item = event.item;
          const callId = item.call_id || item.id;
          const toolName = item.name || item.function?.name;
          const pending = callId ? this.pendingToolCalls.get(callId) : null;
          
          let argsStr = item.arguments || item.function?.arguments || '';
          if (pending && pending.arguments && pending.arguments.length > argsStr.length) {
            argsStr = pending.arguments;
          }
          if (!argsStr) argsStr = '{}';
          
          if (toolName && callId && !this.executedCallIds.has(callId)) {
            liveLogger.log(
              `[QwenRealtime] TOOL CALL RECEIVED\n` +
              `name: ${toolName}\n` +
              `call_id: ${callId}\n` +
              `arguments: ${argsStr}`
            );
            void this.executeToolCall(callId, toolName, argsStr);
          }
        }
        break;
      }

      case 'response.done': {
        liveLogger.log('[QwenRealtime] response.done');

        // Fallback: If opening turn completes and no tool call was executed, guarantee topic keyword is on board
        if (this.executedCallIds.size === 0 && this.promptConfig?.topicTitle) {
          liveLogger.log('[QwenRealtime] Initial turn completed without tool call — writing topic title as fallback');
          this.boardController.writeText(this.promptConfig.topicTitle, { fontSize: 'medium' });
        }

        // If we are currently awaiting tool continuation, do NOT reset to listening
        if (this.isAwaitingContinuation) {
          liveLogger.log('[QwenRealtime] Tool response done — awaiting continuation audio');
          break;
        }
        if (this.state === 'speaking') {
          // Audio may still be playing — playback completion sets state to listening
          // If no audio was playing, transition now
          if (this.activeAudioSources.length === 0) {
            this.setState('listening');
          }
        } else if (this.state === 'drawing') {
          this.setState('listening');
        }
        break;
      }

      case 'error':
        liveLogger.error('[QwenRealtime] Server error:', event.error);
        if (event.error?.message?.includes('Voice') && !this.retriedWithDefaultVoice) {
          this.retriedWithDefaultVoice = true;
          liveLogger.warn('[QwenRealtime] Voice error — auto-recovering with "Katerina"');
          this.sendSessionInit('Katerina');
          return;
        }
        const isModelRejectedInEvent =
          typeof event.error?.message === 'string' &&
          (event.error.message.includes('Model not exist') || event.error.message.includes('API-Key restrictions') || event.error.message.includes('Access denied')) &&
          this.currentModel !== QWEN_FALLBACK_MODEL;

        if (isModelRejectedInEvent) {
          liveLogger.warn(`[QwenRealtime] Model "${this.currentModel}" rejected (${event.error.message}). Retrying automatically with "${QWEN_FALLBACK_MODEL}"...`);
          this.currentModel = QWEN_FALLBACK_MODEL;
          this.isSessionUpdated = false;
          if (this.ws) {
            try { this.ws.close(); } catch {}
            this.ws = null;
          }
          this.connectWebSocket(QWEN_FALLBACK_MODEL).catch((err) => {
            liveLogger.error('[QwenRealtime] Fallback connection failed:', err);
            this.setState('error');
            this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)));
          });
          return;
        }
        this.setState('error');
        this.callbacks.onError?.(new Error(event.error?.message ?? 'Qwen Realtime server error'));
        break;

      case 'conversation.item.created':
        liveLogger.log('[QwenRealtime] conversation.item.created', event.item?.id, event.item?.role);
        break;

      default: break;
    }
  }

  // ── Tool execution → AvelutBoardController ────────────────────────────────

  private async executeToolCall(callId: string, name: string, argsRaw: any): Promise<void> {
    // Idempotency — execute each call_id exactly once
    if (this.executedCallIds.has(callId)) return;
    this.executedCallIds.add(callId);

    this.setState('drawing');
    this.isAwaitingContinuation = true;

    let args: any = {};
    try {
      args = typeof argsRaw === 'string'
        ? JSON.parse(argsRaw)
        : (argsRaw ?? {});
    } catch (e) {
      liveLogger.warn('[QwenRealtime] Bad tool args:', argsRaw);
    }

    let toolResult: any;

    if (name === 'board_action') {
      toolResult = this.boardController.executeBoardAction(args);
    } else if (name === 'draw_mermaid') {
      const code = args.mermaid_code || '';
      MermaidBoardService.renderToSvg(code).then(svg => {
        if (svg) this.boardController.setSvgIllustration(svg);
      }).catch(err => {
        liveLogger.error('[QwenRealtime] draw_mermaid background error:', err);
      });
      toolResult = { status: 'ok', action: 'draw_mermaid', message: 'Generating in background' };
    } else if (name === 'illustrate_object') {
      const desc = args.object_description || '';
      LlmSvgObjectCache.getOrGenerate(desc, async () => {
        if (!this.appSettings) return null;
        const ai = createAvelutAI(this.appSettings);
        const res = await ai.models.generateContent({
          contents: "You are an expert SVG illustrator. Generate ONLY raw valid dark-themed SVG code (no markdown, no explanations) for: " + desc
        });
        return getResponseText(res);
      }).then(svg => {
        if (svg) this.boardController.setSvgIllustration(svg);
      }).catch(err => {
        liveLogger.error('[QwenRealtime] illustrate_object background error:', err);
      });
      toolResult = { status: 'ok', action: 'illustrate_object', message: 'Generating in background' };
    } else {
      liveLogger.warn('[QwenRealtime] Unknown tool:', name);
      toolResult = { status: 'error', message: `Unknown tool: ${name}` };
    }

    liveLogger.log('[QwenRealtime] TOOL EXECUTED');

    liveLogger.log('[QwenRealtime] SENDING TOOL RESULT');
    // Return function result to close the tool call
    this.sendJson({
      event_id: `tool_out_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(toolResult),
      },
    });

    liveLogger.log('[QwenRealtime] REQUESTING TEACHER CONTINUATION');
    // Ask the model to continue teaching
    this.sendJson({
      event_id: `resp_after_tool_${Date.now()}`,
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        tools: this.getTools(),
        tool_choice: 'auto',
      },
    });

    // Safety timeout: if continuation audio does not arrive within 10s, revert state to listening
    setTimeout(() => {
      if (this.isAwaitingContinuation && this.state === 'drawing') {
        liveLogger.warn('[QwenRealtime] Continuation timeout — reverting to listening');
        this.isAwaitingContinuation = false;
        this.setState('listening');
      }
    }, 10000);
  }

  // ── Audio input (mic → WebSocket) ─────────────────────────────────────────

  private async startMicRecording(): Promise<void> {
    if (!this.inputAudioCtx || !this.micStream) return;

    if (this.inputAudioCtx.state === 'suspended') {
      try {
        await this.inputAudioCtx.resume();
        liveLogger.log('[QwenRealtime] inputAudioCtx resumed successfully (state:', this.inputAudioCtx.state, ')');
      } catch (err) {
        liveLogger.warn('[QwenRealtime] Failed to resume inputAudioCtx in startMicRecording:', err);
      }
    }

    const source = this.inputAudioCtx.createMediaStreamSource(this.micStream);

    let bufferChunk: number[] = [];
    let packetCount = 0;
    let lastLogTime = 0;

    const flushChunk = (samples: Float32Array | number[]) => {
      if (this.isMuted || this.ws?.readyState !== WebSocket.OPEN) return;
      if (!samples || samples.length === 0) return;

      // Compute RMS for UI visualisation
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      this.callbacks.onAudioLevel?.(Math.min(1, rms * 4));

      // If student is speaking (rms > 0.04) while in listening state, defer/reset the silence watchdog
      if (rms > 0.04 && this.state === 'listening' && this.studentWaitTimer) {
        this.consecutiveSilenceNudges = 0;
        this.startStudentWaitTimer();
      }

      // Float32 → Int16 → Base64
      const pcm16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
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

      packetCount++;
      const now = Date.now();
      // Diagnostic log on first packet, or when voice detected (rms > 0.04) throttled to 3s
      if (packetCount === 1 || (rms > 0.04 && now - lastLogTime > 3000)) {
        lastLogTime = now;
        liveLogger.log(`[QwenRealtime] 🎙️ Mic streaming audio to server (chunk #${packetCount}, rms: ${rms.toFixed(3)})`);
      }
    };

    const handleAudioData = (data: Float32Array) => {
      // Accumulate samples into ~100ms (1600 samples @ 16kHz) chunks
      for (let i = 0; i < data.length; i++) {
        bufferChunk.push(data[i]);
      }
      if (bufferChunk.length >= 1600) {
        const toSend = bufferChunk;
        bufferChunk = [];
        flushChunk(toSend);
      }
    };

    // 1. Try AudioWorkletNode first (avoids ScriptProcessorNode deprecation warning)
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
          if (e.data && (ArrayBuffer.isView(e.data) || e.data instanceof Float32Array || e.data.constructor?.name === 'Float32Array')) {
            handleAudioData(e.data as Float32Array);
          }
        };

        const muteNode = this.inputAudioCtx.createGain();
        muteNode.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(muteNode);
        muteNode.connect(this.inputAudioCtx.destination);
        this.processorNode = workletNode;
        liveLogger.log('[QwenRealtime] AudioWorklet input processor initialized ✅');
        return;
      } catch (workletErr) {
        liveLogger.warn('[QwenRealtime] AudioWorklet init failed, falling back to ScriptProcessor:', workletErr);
      }
    }

    // 2. Fallback: ScriptProcessorNode for legacy browser/webview compatibility
    const scriptProcessor = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);
    scriptProcessor.onaudioprocess = (e) => {
      flushChunk(e.inputBuffer.getChannelData(0));
    };
    const muteNode = this.inputAudioCtx.createGain();
    muteNode.gain.value = 0;
    source.connect(scriptProcessor);
    scriptProcessor.connect(muteNode);
    muteNode.connect(this.inputAudioCtx.destination);
    this.processorNode = scriptProcessor;
    liveLogger.log('[QwenRealtime] ScriptProcessor fallback input initialized ✅');
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
      await this.ensureOutputRunning();

      if (this.outputAudioCtx.state === 'suspended') {
        liveLogger.warn('[QwenRealtime] AudioContext still suspended — cannot play');
        return;
      }

      const binary = atob(base64);
      const incomingBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        incomingBytes[i] = binary.charCodeAt(i);
      }

      // Prepend any leftover odd byte from previous chunk to maintain strict 16-bit PCM alignment
      let combinedBytes: Uint8Array;
      if (this.pcmRemainder.length > 0) {
        combinedBytes = new Uint8Array(this.pcmRemainder.length + incomingBytes.length);
        combinedBytes.set(this.pcmRemainder, 0);
        combinedBytes.set(incomingBytes, this.pcmRemainder.length);
        this.pcmRemainder = new Uint8Array(0);
      } else {
        combinedBytes = incomingBytes;
      }

      // If odd number of bytes, stash the last byte for the next packet
      if (combinedBytes.length % 2 !== 0) {
        this.pcmRemainder = combinedBytes.slice(combinedBytes.length - 1);
        combinedBytes = combinedBytes.slice(0, combinedBytes.length - 1);
      }

      const sampleCount = combinedBytes.length / 2;
      if (sampleCount <= 0) return;

      const int16 = new Int16Array(combinedBytes.buffer, combinedBytes.byteOffset, sampleCount);
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        float32[i] = int16[i] / 32768;
      }

      // DashScope/Qwen Realtime PCM audio is 24,000 Hz
      const buf = this.outputAudioCtx.createBuffer(1, sampleCount, 24000);
      buf.copyToChannel(float32, 0);

      const src = this.outputAudioCtx.createBufferSource();
      src.buffer = buf;

      if (!this.outputGainNode) {
        this.outputGainNode = this.outputAudioCtx.createGain();
        this.outputGainNode.gain.value = 1.0;
        this.outputGainNode.connect(this.outputAudioCtx.destination);
      }
      src.connect(this.outputGainNode);

      const now = this.outputAudioCtx.currentTime;
      const LEAD_TIME = 0.05; // 50ms smooth jitter buffer prevents buffer underrun clicks on Android
      if (this.nextPlayTime < now) {
        this.nextPlayTime = now + LEAD_TIME;
      }
      src.start(this.nextPlayTime);
      this.nextPlayTime += buf.duration;

      this.activeAudioSources.push(src);
      src.onended = () => {
        const i = this.activeAudioSources.indexOf(src);
        if (i !== -1) this.activeAudioSources.splice(i, 1);
        if (this.activeAudioSources.length === 0) {
          setTimeout(() => {
            if (this.state === 'speaking' || this.state === 'drawing') {
              this.setState('listening');
            }
          }, 300);
        }
      };
    } catch (err) {
      liveLogger.warn('[QwenRealtime] playDelta error:', err);
    }
  }

  /** Instantly stop all queued teacher speech buffers */
  public stopPlayback(): void {
    this.activeAudioSources.forEach(s => { try { s.stop(); s.disconnect(); } catch (_) {} });
    this.activeAudioSources = [];
    this.pcmRemainder = new Uint8Array(0);
    if (this.outputAudioCtx) this.nextPlayTime = this.outputAudioCtx.currentTime;
  }
}
