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
 *  - Native function / tool calling → dispatches ONLY text tools to AvelutBoardController
 *
 * Design rule (2026-09):
 *  Realtime model must always call text tools (write_text / set_formula / write_keywords).
 *  Complex illustration is optional and handled by AvelutBoardVisualizerService
 *  via phrase detection on the transcript. No draw_* tools are exposed to the model.
 */

import { avelutBoardController } from './AvelutBoardController';
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
  private pendingToolCalls = new Map<string, { name: string; call_id: string; arguments: string }>();
  private executedCallIds = new Set<string>();
  private hasGreeted = false;
  private isStarting = false;
  private stateMachine: PedagogicalStateMachine | null = null;

  private teacherSpeakingUntil = 0;

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
      console.log('[QwenRealtime] startSession: already connected or starting, returning early');
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
      console.error('[QwenRealtime] startSession failed:', err);
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

    console.log('[QwenRealtime] Connecting via proxy:', wsUrl);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        console.log('[QwenRealtime] Proxy connected ✅');
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
            console.warn('[QwenRealtime] Unknown WS data type:', typeof evt.data, evt.data);
            return;
          }
          this.handleMessage(raw);
        } catch (err) {
          console.warn('[QwenRealtime] Failed to process WS message:', err);
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
      console.warn('[QwenRealtime] resumeAudio warning:', e);
      return false;
    }
  }

  /** Triggers the initial teacher greeting manually from the UI */
  public triggerInitialGreeting(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.hasGreeted) {
      console.log('[QwenRealtime] Greeting already sent — skip');
      return;
    }
    this.hasGreeted = true;

    const topic = this.promptConfig?.topicTitle ? `"${this.promptConfig.topicTitle}"` : 'the topic';
    const duration = this.promptConfig?.durationMinutes || 30;
    console.log('[QwenRealtime] Manually triggering initial greeting for', topic, `(${duration} min)`);

    // Only ask for text tools — illustration is handled by the visualizer
    this.sendJson({
      event_id: `kickoff_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Begin teaching ${topic} for our ${duration}-minute lesson now. Greet me, announce that today we are mastering ${topic}, and immediately call write_text (or write_keywords) to put the topic title or a short real-world hook on the board. Do not ask me what topic we are going to discuss.`,
        }],
      },
    });

    this.sendJson({
      event_id: `greet_manual_${Date.now()}`,
      type: 'response.create',
    });
  }

  // ── Session initialisation ────────────────────────────────────────────────

  private sendSessionInit(): void {
    if (!this.promptConfig) return;

    const stageInstruction = this.stateMachine ? this.stateMachine.getNextInstruction() : '';
    const instructions = buildTeacherSystemPrompt(this.promptConfig, stageInstruction);
    console.log('[QwenRealtime] Sending session.update with text-only tools schema...');

    this.pendingToolCalls.clear();
    this.executedCallIds.clear();

    this.sendJson({
      event_id: `session_init_${Date.now()}`,
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: 'Jennifer',
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

  /**
   * TEXT TOOLS ONLY.
   * Complex illustration (diagrams, flowcharts) is handled by AvelutBoardVisualizerService
   * when it detects drawing-related phrases in the transcript.
   */
  private buildToolDeclarations() {
    return [
      {
        type: 'function',
        name: 'write_text',
        description: 'Write a key title, definition, core principle, or short label on the teaching board. Never write speech transcripts. Max ~12 words.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Short text or label to display' }
          },
          required: ['text'],
        },
      },
      {
        type: 'function',
        name: 'set_formula',
        description: 'Display a highlighted law or equation in the formula card slot (e.g. F = ma).',
        parameters: {
          type: 'object',
          properties: {
            formula: { type: 'string', description: 'The formula to display' }
          },
          required: ['formula'],
        },
      },
      {
        type: 'function',
        name: 'write_keywords',
        description: 'Write a row of highlighted keyword pills (2–4 technical terms).',
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
        description: 'Clears the main diagram/stage area so new content can replace old ones cleanly.',
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
        description: 'Update or edit the text of an existing element on the board.',
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
      console.warn('[QwenRealtime] Non-JSON message (first 150 chars):', String(raw).slice(0, 150));
      return;
    }

    if (!event?.type) {
      console.warn('[QwenRealtime] Event missing type. Payload:', event);
      console.warn('[QwenRealtime] Raw (first 200 chars):', String(raw).slice(0, 200));
      return;
    }

    console.log(`[QwenRealtime] Event received: ${event.type}`);

    switch (event.type) {
      case 'session.created':
        console.log('[QwenRealtime] session.created on DashScope');
        break;

      case 'session.updated':
        console.log('[QwenRealtime] session.updated on DashScope');
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

      // ── Semantic barge-in ───────────────────────────────────────────────
      case 'input_audio_buffer.speech_started':
        this.fullTranscript = '';
        this.lastTranscriptSlice = '';
        if (performance.now() < this.teacherSpeakingUntil) {
          console.log('[QwenRealtime] Ignoring barge-in during teacher speech');
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
        console.log('[QwenRealtime] conversation.item.created', event.item?.id);
        break;

      case 'response.output_item.added': {
        console.log(`[QwenRealtime] response.output_item.added:`, event.item?.type);
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

        console.log('[QwenRealtime] TOOL CALL arguments.done:', {
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
        console.log(`[QwenRealtime] response.output_item.done:`, event.item?.type);
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

        // Illustration is optional and handled by the visualizer co-pilot
        // when it detects drawing-related phrases in the transcript.
        // We only log if the model failed to call any text tool this turn.
        if (!this.hasCalledToolInTurn && this.lastTranscriptSlice.trim().length > 0) {
          console.log('[QwenRealtime] No text tool called this turn. Visualizer may still trigger on phrase detection.');
        }

        // Reset turn state
        this.hasCalledToolInTurn = false;
        this.fullTranscript = '';
        this.lastTranscriptSlice = '';

        if (this.stateMachine) {
           const timeChanged = this.stateMachine.evaluateState();
           const turnChanged = this.stateMachine.advance();
           if (timeChanged || turnChanged) {
             this.sendSessionInit(); // Update prompt with new stage instruction
           }
        }
        break;
      }

      case 'error':
        console.error('[QwenRealtime] Server error:', event.error);
        this.callbacks.onError?.(new Error(event.error?.message ?? 'Qwen Realtime server error'));
        break;

      default: break;
    }
  }

  // ── Tool execution → AvelutBoardController (text tools only) ─────────────

  private executeToolCall(callId: string, name: string, argsRaw: any): void {
    if (this.executedCallIds.has(callId)) return;
    this.executedCallIds.add(callId);
    this.hasCalledToolInTurn = true;
    this.setState('drawing');

    let args: any = {};
    try {
      args = typeof argsRaw === 'string'
        ? JSON.parse(argsRaw)
        : (argsRaw ?? {});
    } catch (e) {
      console.warn('[QwenRealtime] Bad tool args:', argsRaw);
    }

    console.log('[QwenRealtime] Executing board tool:', name, args);

    try {
      switch (name) {
        case 'write_text':
          avelutBoardController.writeText(args.text ?? args.content ?? '');
          break;
        case 'set_formula':
          avelutBoardController.setFormula(args.formula ?? args.text ?? args.content ?? '');
          break;
        case 'write_keywords':
          avelutBoardController.writeKeywords(args.keywords ?? []);
          break;
        case 'highlight_concept':
          avelutBoardController.highlightConcept(args.targetText ?? '', args.style);
          break;
        case 'clear_stage':
          avelutBoardController.clearStage();
          break;
        case 'clear_board':
          avelutBoardController.clearBoard();
          break;
        case 'update_text':
          avelutBoardController.updateText(args.targetText ?? '', args.newText ?? '');
          break;
        case 'remove_component':
          avelutBoardController.removeComponent(args.targetText ?? '');
          break;
        default:
          // Silently ignore any legacy complex tools the model might still try to call
          console.warn('[QwenRealtime] Ignoring unknown/removed tool:', name, args);
          break;
      }
    } catch (toolErr) {
      console.error('[QwenRealtime] Tool execution error:', toolErr);
    }

    // Always return tool output so model can continue speaking
    if (callId) {
      this.sendJson({
        event_id: `tool_out_${Date.now()}`,
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({ success: true, tool: name }),
        },
      });
      this.sendJson({
        event_id: `resp_after_tool_${Date.now()}`,
        type: 'response.create',
      });
    }
  }

  // ── Audio input (mic → WebSocket) ─────────────────────────────────────────

  private async startMicRecording(): Promise<void> {
    if (!this.inputAudioCtx || !this.micStream) return;

    const source = this.inputAudioCtx.createMediaStreamSource(this.micStream);

    // ScriptProcessor is deprecated but still the most reliable cross-browser path
    // for realtime PCM streaming without AudioWorklet complexity.
    const bufferSize = 4096;
    const processor = this.inputAudioCtx.createScriptProcessor(bufferSize, 1, 1);
    this.processorNode = processor;

    processor.onaudioprocess = (e) => {
      if (this.isMuted || this.ws?.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      // Convert Float32 → Int16 PCM
      const pcm = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Base64 encode and send
      const bytes = new Uint8Array(pcm.buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      this.sendJson({
        event_id: `audio_${Date.now()}`,
        type: 'input_audio_buffer.append',
        audio: base64,
      });

      // Simple RMS for UI level meter
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      this.callbacks.onAudioLevel?.(Math.min(1, rms * 4));
    };

    source.connect(processor);
    processor.connect(this.inputAudioCtx.destination);
  }

  // ── Audio output (WS → speaker) ───────────────────────────────────────────

  private async ensureOutputRunning(): Promise<void> {
    if (!this.outputAudioCtx) return;
    if (this.outputAudioCtx.state === 'suspended') {
      try {
        await this.outputAudioCtx.resume();
      } catch (err) {
        console.warn('[QwenRealtime] ensureOutputRunning failed to resume:', err);
      }
    }
  }

  private async playDelta(base64: string): Promise<void> {
    if (!this.outputAudioCtx || !base64) return;
    try {
      await this.ensureOutputRunning();

      if (this.outputAudioCtx.state === 'suspended') {
        console.warn('[QwenRealtime] AudioContext still suspended — cannot play');
        return;
      }

      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const sampleCount = Math.floor(bytes.byteLength / 2);
      if (sampleCount <= 0) {
        console.warn('[QwenRealtime] playDelta empty samples');
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
      console.warn('[QwenRealtime] playDelta error:', err);
    }
  }

  /** Instantly stop all queued teacher speech buffers */
  public stopPlayback(): void {
    this.activeAudioSources.forEach(s => { try { s.stop(); s.disconnect(); } catch (_) {} });
    this.activeAudioSources = [];
    if (this.outputAudioCtx) this.nextPlayTime = this.outputAudioCtx.currentTime;
  }
}
