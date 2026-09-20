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
import { buildTeacherSystemPrompt, type TeacherPromptConfig } from './teacherPrompt';
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
  private processorNode: ScriptProcessorNode | null = null;
  private isMuted = false;

  // ── Audio — output (WS → speaker) ──────────────────────────────────────
  private outputAudioCtx: AudioContext | null = null;
  private activeAudioSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;

  // ── Session ────────────────────────────────────────────────────────────────
  private promptConfig: TeacherPromptConfig | null = null;
  private appSettings: AppSettings | null = null;
  private fullTranscript = '';

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
      this.startMicRecording();
    } catch (err: any) {
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

    this.ws?.close();
    this.ws = null;

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

      ws.onmessage = (evt) => this.handleMessage(evt.data as string);

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

  // ── Session initialisation ────────────────────────────────────────────────

  private sendSessionInit(): void {
    if (!this.promptConfig) return;

    const instructions = buildTeacherSystemPrompt(this.promptConfig);

    this.sendJson({
      event_id: `session_init_${Date.now()}`,
      type: 'session.update',
      session: {
        modalities: ['audio', 'text'],
        voice: 'Jennifer',
        instructions,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        turn_detection: { type: 'server_vad', semantic_vad: true },
        tools: this.buildToolDeclarations(),
      },
    });

    // Trigger the initial greeting immediately
    setTimeout(() => {
      this.sendJson({ event_id: `greet_${Date.now()}`, type: 'response.create' });
    }, 200);
  }

  private buildToolDeclarations() {
    return [
      {
        type: 'function',
        name: 'write_text',
        description:
          'Write a title, definition, explanation sentence, or formula on the Excalidraw teaching board.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text or formula to display' },
            fontSize: {
              type: 'string',
              enum: ['small', 'medium', 'large', 'title'],
              description: 'Text size',
            },
            color: {
              type: 'string',
              description:
                'Hex color, e.g. "#38BDF8" for accent/formula, "#FAFAFA" for standard, "#FBBF24" for highlight',
            },
            x: { type: 'number', description: 'Optional X canvas position (0–800)' },
            y: { type: 'number', description: 'Optional Y canvas position (0–600)' },
          },
          required: ['text'],
        },
      },
      {
        type: 'function',
        name: 'draw_shape',
        description: 'Draw a rectangle, ellipse, arrow, or line on the board.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['rectangle', 'ellipse', 'arrow', 'line'] },
            x: { type: 'number' },
            y: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
            label: { type: 'string' },
            color: { type: 'string' },
            backgroundColor: { type: 'string' },
          },
          required: ['type', 'x', 'y'],
        },
      },
      {
        type: 'function',
        name: 'draw_diagram',
        description:
          'Draw an intuitive physical or conceptual diagram: collision (two objects colliding with velocity arrows), free_body (central mass with directional force arrows), coordinate_axes (x/y graph), flow (sequential step boxes).',
        parameters: {
          type: 'object',
          properties: {
            diagramType: {
              type: 'string',
              enum: ['collision', 'free_body', 'coordinate_axes', 'flow'],
            },
            data: {
              type: 'object',
              description: 'Diagram-specific properties (labels, masses, forces, steps, etc.)',
            },
          },
          required: ['diagramType', 'data'],
        },
      },
      {
        type: 'function',
        name: 'highlight_concept',
        description:
          'Draw a circle, dashed box, or underline around an existing concept on the board to direct student attention.',
        parameters: {
          type: 'object',
          properties: {
            targetTextOrLabel: {
              type: 'string',
              description: 'Text of the element to highlight',
            },
            style: { type: 'string', enum: ['circle', 'box', 'underline'] },
          },
          required: ['targetTextOrLabel'],
        },
      },
      {
        type: 'function',
        name: 'clear_board',
        description:
          'Clear the teaching board to start fresh. Set keepTitle=true to preserve the lesson heading.',
        parameters: {
          type: 'object',
          properties: {
            keepTitle: { type: 'boolean' },
          },
        },
      },
    ];
  }

  // ── Message handler ───────────────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let event: any;
    try { event = JSON.parse(raw); } catch { return; }

    switch (event.type) {
      case 'response.audio.delta':
        if (event.delta) { this.setState('speaking'); this.playDelta(event.delta); }
        break;

      case 'response.audio_transcript.delta':
        if (event.delta) {
          this.fullTranscript += event.delta;
          this.callbacks.onTranscript?.(this.fullTranscript, false);
        }
        break;

      case 'response.audio_transcript.done':
        this.callbacks.onTranscript?.(this.fullTranscript, true);
        this.fullTranscript = '';
        break;

      // ── Semantic barge-in ───────────────────────────────────────────────
      case 'input_audio_buffer.speech_started':
        this.stopPlayback();
        this.setState('listening');
        break;

      case 'input_audio_buffer.speech_stopped':
        this.setState('listening');
        break;

      // ── Tool / function call ────────────────────────────────────────────
      case 'response.function_call_arguments.done':
        this.executeTool(event);
        break;

      case 'response.done':
        if (this.state === 'speaking' || this.state === 'drawing') {
          setTimeout(() => { if (this.state !== 'listening') this.setState('listening'); }, 400);
        }
        break;

      case 'error':
        console.error('[QwenRealtime] Server error:', event.error);
        this.callbacks.onError?.(new Error(event.error?.message ?? 'Qwen Realtime server error'));
        break;

      default: break;
    }
  }

  // ── Tool execution → AvelutBoardController ────────────────────────────────

  private executeTool(event: any): void {
    const { name, call_id } = event;
    let args: any = {};
    try { args = typeof event.arguments === 'string' ? JSON.parse(event.arguments) : event.arguments ?? {}; }
    catch (e) { console.warn('[QwenRealtime] Bad tool args:', event.arguments); }

    this.setState('drawing');

    try {
      switch (name) {
        case 'write_text':
          avelutBoardController.writeText(args.text, {
            fontSize: args.fontSize,
            color: args.color,
            x: args.x,
            y: args.y,
          });
          break;

        case 'draw_shape':
          avelutBoardController.drawShape({
            type: args.type,
            x: args.x,
            y: args.y,
            width: args.width,
            height: args.height,
            label: args.label,
            color: args.color,
            backgroundColor: args.backgroundColor,
          });
          break;

        case 'draw_diagram':
          avelutBoardController.drawDiagram(args.diagramType, args.data ?? {});
          break;

        case 'highlight_concept':
          avelutBoardController.highlightConcept(args.targetTextOrLabel, args.style);
          break;

        case 'clear_board':
          avelutBoardController.clearBoard(args.keepTitle ?? true);
          break;

        default:
          console.warn('[QwenRealtime] Unknown tool:', name);
          break;
      }
    } catch (toolErr) {
      console.error('[QwenRealtime] Tool execution error:', toolErr);
    }

    // Return function call output so the model can continue its turn
    if (call_id) {
      this.sendJson({
        event_id: `tool_out_${Date.now()}`,
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id,
          output: JSON.stringify({ success: true }),
        },
      });
    }
  }

  // ── Audio input (mic → WebSocket) ─────────────────────────────────────────

  private startMicRecording(): void {
    if (!this.inputAudioCtx || !this.micStream) return;

    const source = this.inputAudioCtx.createMediaStreamSource(this.micStream);
    this.processorNode = this.inputAudioCtx.createScriptProcessor(2048, 1, 1);

    this.processorNode.onaudioprocess = (e) => {
      if (this.isMuted || this.ws?.readyState !== WebSocket.OPEN) return;

      const data = e.inputBuffer.getChannelData(0);

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
      bytes.forEach(b => (bin += String.fromCharCode(b)));

      this.sendJson({
        event_id: `aud_in_${Date.now()}`,
        type: 'input_audio_buffer.append',
        audio: btoa(bin),
      });
    };

    source.connect(this.processorNode);
    this.processorNode.connect(this.inputAudioCtx.destination);
  }

  // ── Audio output (WebSocket → speaker) ───────────────────────────────────

  private playDelta(base64: string): void {
    if (!this.outputAudioCtx) return;
    try {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const int16 = new Int16Array(bytes.buffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

      const buf = this.outputAudioCtx.createBuffer(1, float32.length, 24000);
      buf.getChannelData(0).set(float32);

      const src = this.outputAudioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(this.outputAudioCtx.destination);

      const now = this.outputAudioCtx.currentTime;
      if (this.nextPlayTime < now) this.nextPlayTime = now;
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

