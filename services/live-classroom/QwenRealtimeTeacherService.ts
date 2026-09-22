/**
 * QwenRealtimeTeacherService.ts
 *
 * Full-duplex WebSocket client for Alibaba Cloud Model Studio.
 *
 * Architecture:
 *   Student mic → Qwen Omni Realtime → audio + board_action → AvelutBoardController → Excalidraw
 *
 * One model. One board tool. No secondary AI. No state machine.
 */

import { liveLogger } from './logger';
import { avelutBoardController } from './AvelutBoardController';
import { buildTeacherSystemPrompt, type TeacherPromptConfig } from './teacherPrompt';
import type { AppSettings } from '../../types';

// ─── Centralized model identifier ────────────────────────────────────────────
// Update this single constant when Alibaba releases a newer realtime model.
export const QWEN_REALTIME_MODEL = 'qwen-omni-turbo-realtime';

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
  private pendingToolCalls = new Map<string, { name: string; call_id: string; arguments: string }>();
  private executedCallIds = new Set<string>();
  private hasGreeted = false;
  private isStarting = false;
  private isSessionUpdated = false;
  private retriedWithDefaultVoice = false;

  private boardController = avelutBoardController;

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
    if (this.isStarting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      liveLogger.log('[QwenRealtime] startSession: already connected or starting, returning early');
      return;
    }

    this.endSession();
    this.hasGreeted = false;
    this.isStarting = true;

    this.promptConfig = config;
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
    this.sendJson({
      event_id: `resp_${Date.now()}`,
      type: 'response.create',
      response: { modalities: ['text', 'audio'] },
    });
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

  /**
   * Triggers the initial teacher greeting.
   * The session is already configured — just ask the model to begin.
   */
  public triggerInitialGreeting(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.hasGreeted) {
      liveLogger.log('[QwenRealtime] Greeting already sent — skip');
      return;
    }
    this.hasGreeted = true;

    const topic = this.promptConfig?.topicTitle || 'the topic';
    const duration = this.promptConfig?.durationMinutes || 30;
    liveLogger.log('[QwenRealtime] Triggering initial greeting for', topic, `(${duration} min)`);

    // Give the model its starting instruction as a user message
    this.sendJson({
      event_id: `kickoff_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `Start the lesson on "${topic}". We have ${duration} minutes. Begin naturally.`,
        }],
      },
    });

    this.sendJson({
      event_id: `greet_${Date.now()}`,
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
      },
    });
  }

  // ── Session initialisation ────────────────────────────────────────────────

  private sendSessionInit(overrideVoice?: string): void {
    if (!this.promptConfig) return;

    const instructions = buildTeacherSystemPrompt(this.promptConfig);
    liveLogger.log('[QwenRealtime] Sending session.update...');

    // Voice selection — Tina is the primary supported English voice
    let selectedVoice = overrideVoice || this.appSettings?.alibaba_voice_name || 'Tina';
    if (selectedVoice === 'Cherry' || selectedVoice === 'Catherine' || !selectedVoice) {
      selectedVoice = 'Tina';
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
          type: 'semantic_vad',
        },
        tools: [this.buildBoardActionTool()],
        tool_choice: 'auto',
      },
    });
  }

  /**
   * The single board tool exposed to the model.
   * Uses Alibaba's documented function calling schema.
   */
  private buildBoardActionTool() {
    return {
      type: 'function',
      function: {
        name: 'board_action',
        description:
          'Control the educational whiteboard while teaching. Use this whenever a visual, ' +
          'keyword, equation, diagram, relationship, or written concept will improve understanding. ' +
          'Call it naturally as part of teaching — do not narrate that you are calling it.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['draw', 'write', 'clear', 'highlight', 'erase'],
              description:
                'draw=create shapes/diagrams, write=add text/formula, ' +
                'clear=clear current area, highlight=emphasize existing concept, erase=remove element',
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
              description: 'Text or formula to write on the board (for "write" action)',
            },
            target: {
              type: 'string',
              description: 'Target element label or ID (for "highlight" or "erase" actions)',
            },
          },
          required: ['action'],
        },
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
      liveLogger.warn('[QwenRealtime] Event missing type. Payload:', event);
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
          this.setState('speaking');
          void this.playDelta(event.delta);
        }
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.fullTranscript += event.delta;
          this.callbacks.onTranscript?.(this.fullTranscript, false);
        }
        break;

      case 'response.audio_transcript.done':
        this.callbacks.onTranscript?.(this.fullTranscript, true);
        break;

      case 'response.created':
        // New response turn — reset transcript accumulator
        this.fullTranscript = '';
        break;

      // ── Student interruption ────────────────────────────────────────────
      case 'input_audio_buffer.speech_started':
        // Qwen's VAD says the student is speaking — stop teacher audio cleanly.
        liveLogger.log('[QwenRealtime] Student speech started — stopping teacher audio');
        this.stopPlayback();
        this.setState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        if (this.state === 'listening') {
          // Will transition to speaking when response audio arrives
        }
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
        const argsStr = event.arguments || event.function?.arguments || pending?.arguments || '{}';

        liveLogger.log('[QwenRealtime] function_call_arguments.done:', { name: toolName, call_id: callId });

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
          const argsStr = item.arguments || item.function?.arguments || '{}';
          if (toolName && callId) {
            void this.executeToolCall(callId, toolName, argsStr);
          }
        }
        break;
      }

      case 'response.done': {
        if (this.state === 'speaking' || this.state === 'drawing') {
          // Audio may still be playing — playback completion sets state to listening
          // If no audio was playing, transition now
          if (this.activeAudioSources.length === 0) {
            this.setState('listening');
          }
        }
        break;
      }

      case 'error':
        liveLogger.error('[QwenRealtime] Server error:', event.error);
        if (event.error?.message?.includes('Voice') && !this.retriedWithDefaultVoice) {
          this.retriedWithDefaultVoice = true;
          liveLogger.warn('[QwenRealtime] Voice error — auto-recovering with "Tina"');
          this.sendSessionInit('Tina');
          return;
        }
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

    let args: any = {};
    try {
      args = typeof argsRaw === 'string'
        ? JSON.parse(argsRaw)
        : (argsRaw ?? {});
    } catch (e) {
      liveLogger.warn('[QwenRealtime] Bad tool args:', argsRaw);
    }

    liveLogger.log('[QwenRealtime] Executing board_action:', name, args);

    let toolResult: any;

    if (name === 'board_action') {
      toolResult = this.boardController.executeBoardAction(args);
    } else {
      liveLogger.warn('[QwenRealtime] Unknown tool:', name);
      toolResult = { status: 'error', message: `Unknown tool: ${name}` };
    }

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

    // Ask the model to continue teaching
    this.sendJson({
      event_id: `resp_after_tool_${Date.now()}`,
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
      },
    });
  }

  // ── Audio input (mic → WebSocket) ─────────────────────────────────────────

  private async startMicRecording(): Promise<void> {
    if (!this.inputAudioCtx || !this.micStream) return;

    const source = this.inputAudioCtx.createMediaStreamSource(this.micStream);

    const handleAudioData = (data: Float32Array) => {
      if (this.isMuted || this.ws?.readyState !== WebSocket.OPEN) return;

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
          if (e.data && e.data instanceof Float32Array) {
            handleAudioData(e.data);
          }
        };

        const muteNode = this.inputAudioCtx.createGain();
        muteNode.gain.value = 0;
        source.connect(workletNode);
        workletNode.connect(muteNode);
        muteNode.connect(this.inputAudioCtx.destination);
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
    const muteNode = this.inputAudioCtx.createGain();
    muteNode.gain.value = 0;
    source.connect(scriptProcessor);
    scriptProcessor.connect(muteNode);
    muteNode.connect(this.inputAudioCtx.destination);
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
      if (sampleCount <= 0) return;

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
    if (this.outputAudioCtx) this.nextPlayTime = this.outputAudioCtx.currentTime;
  }
}
