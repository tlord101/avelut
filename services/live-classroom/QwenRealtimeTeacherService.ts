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
import type { AppSettings, UserProfile } from '../../types';
import { MermaidBoardService } from './visual-engine/MermaidBoardService';
import { LlmSvgObjectCache } from './visual-engine/LlmSvgObjectCache';
import { createAvelutAI, getResponseText, OPENROUTER_MODEL } from '../../utils/inference';
import { getFeatureModel } from '../../utils/usage';

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

  // ── Audio — output (WS → speaker) & Jitter Smoothing ──────────────────
  private outputAudioCtx: AudioContext | null = null;
  private outputGainNode: GainNode | null = null;
  private activeAudioSources: AudioBufferSourceNode[] = [];
  private nextPlayTime = 0;
  private pcmRemainder: Uint8Array = new Uint8Array(0);
  private pendingOutputDeltas: string[] = [];
  private isFlushingDeltas = false;
  private lastMicRms = 0;
  private pcmSampleQueue: Float32Array[] = [];
  private totalQueuedSamples = 0;
  private isStreamPlaying = false;
  private readonly TARGET_CHUNK_SAMPLES = 2400; // ~100ms contiguous chunks @ 24kHz
  private readonly PREROLL_MIN_SAMPLES = 2880; // ~120ms initial cushion before audio playback starts
  private isBurstStart = true;

  // ── Session ────────────────────────────────────────────────────────────────
  private promptConfig: TeacherPromptConfig | null = null;
  private appSettings: AppSettings | null = null;
  private userProfile: UserProfile | null = null;
  private fullTranscript = '';
  private pendingToolCalls = new Map<string, { name: string; call_id: string; arguments: string }>();
  private toolItemIdToCallId = new Map<string, string>();
  private isTurnResponseDone = false;
  private hasPendingToolContinuation = false;
  private toolContinuationWatchdog: ReturnType<typeof setTimeout> | null = null;
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
  private consecutiveSilenceNudges = 0;
  private isStudentSpeaking = false;
  /** True only when the last teacher response ended with a question to the student */
  private lastResponseAskedQuestion = false;
  /** Unique id for the current teaching turn (response + tools + continuation) */
  private currentTeachingTurnId = 0;
  /** Prevents duplicate continuation for the same turn */
  private continuationRequestedForTurn = -1;
  /** True while a response.create is in flight or audio is still expected */
  private isResponseActive = false;
  /** True while the model is actively transmitting audio chunks over WebSocket */
  private isAudioStreamingFromModel = false;

  // ── Turn detection (pure manual push-to-talk only) ──────────────────────────
  /**
   * Turn detection strategy:
   *  - 'manual'       (strictly default): server VAD is disabled (`turn_detection: null`).
   *                   The student opens the mic with a tap and closes it with a
   *                   second tap; we then commit the captured audio and ask the
   *                   teacher for a response ourselves.
   *  - 'server_vad'   : fallback only if server explicitly rejects `null`.
   */
  private turnDetectionMode: 'manual' | 'semantic_vad' | 'server_vad' = 'manual';
  /** Ensures we only fall back to the tuned server_vad config once per session */
  private hasTurnDetectionFallback = false;
  /** Explicit response.create fallback when server does not create one after commit */
  private responseCreateFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Push-to-talk (manual VAD state machine) ────────────────────────────────
  private pttState: 'idle' | 'ptt_active' | 'committing' = 'idle';
  /** True while the student's mic is open (tap-to-talk active) */
  private isPushToTalkActive = false;
  /** True when mic audio was uploaded but not yet committed to the server */
  private hasUncommittedStudentAudio = false;

  // ── Echo gate: rolling peak mic RMS ────────────────────────────────────────
  private micRmsWindow: { rms: number; t: number }[] = [];
  private readonly MIC_RMS_WINDOW_MS = 300;
  /** Ignore as speaker echo only when peak mic RMS is near the noise floor */
  private readonly ECHO_IGNORE_PEAK_RMS = 0.08;
  /** Peak mic RMS at/above this is always accepted as real student speech */
  private readonly REAL_SPEECH_PEAK_RMS = 0.12;

  // ── Auto-continue cancellation while student speaks ────────────────────────
  private autoContinueTimer: ReturnType<typeof setTimeout> | null = null;
  /** Timestamp of last input_audio_buffer.speech_stopped */
  private lastSpeechStoppedAt = 0;
  /** Do not auto-continue within this window after student stopped speaking */
  private readonly AUTO_CONTINUE_POST_SPEECH_GUARD_MS = 800;

  // ── Stuck-listening watchdog ───────────────────────────────────────────────
  private stuckWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private stuckListeningSince: number | null = null;
  private forcedContinuationCount = 0;
  private readonly MAX_FORCED_CONTINUATIONS = 5;
  private readonly STUCK_LISTENING_THRESHOLD_MS = 9000;

  // ── Reconnect resume ───────────────────────────────────────────────────────
  private pendingResumeAfterReconnect = false;

  // ── State helpers ─────────────────────────────────────────────────────────

  public setCallbacks(cb: QwenTeacherCallbacks): void { this.callbacks = cb; }
  public getState(): TeacherState { return this.state; }

  private setState(s: TeacherState): void {
    if (this.state === s) return;
    this.state = s;
    this.callbacks.onStateChange?.(s);

    if (s === 'listening') {
      // Whenever entering listening state, auto-continue if student is quiet
      this.startStudentWaitTimer();
    } else {
      this.clearStudentWaitTimer();
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Initialise mic, create audio contexts, and open the WebSocket session */
  public async startSession(
    config: TeacherPromptConfig,
    appSettings?: AppSettings | null,
    userProfile?: UserProfile | null,
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
    this.hasTurnDetectionFallback = false;
    this.turnDetectionMode = 'manual';
    this.forcedContinuationCount = 0;
    this.stuckListeningSince = null;
    this.pendingResumeAfterReconnect = false;

    this.promptConfig = config;
    if (appSettings) this.appSettings = appSettings;
    if (userProfile) this.userProfile = userProfile;
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
      this.startStuckListeningWatchdog();
    } catch (err: any) {
      this.isStarting = false;
      liveLogger.error('[QwenRealtime] startSession failed:', err);
      this.setState('error');
      this.callbacks.onError?.(
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  // ── Push-to-talk (manual VAD) ──────────────────────────────────────────────

  /** True while the student's mic is open (tap-to-talk active). */
  public getIsPushToTalkActive(): boolean {
    return this.isPushToTalkActive;
  }

  /** Returns true if the teacher's last spoken turn was a question to the student */
  public getLastResponseAskedQuestion(): boolean {
    return this.lastResponseAskedQuestion;
  }

  /**
   * Opens the student mic for a manually controlled turn (tap-to-talk).
   *
   * The teacher is interrupted immediately — any in-flight response is cancelled
   * and queued speech is dropped — so the student can barge in at any moment.
   * Returns true when capture is active.
   */
  public beginPushToTalk(): boolean {
    if (this.isExplicitlyClosed) return false;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (this.pttState !== 'idle') {
      liveLogger.log(`[QwenRealtime] beginPushToTalk ignored: pttState is '${this.pttState}'`);
      return this.isPushToTalkActive;
    }

    this.pttState = 'ptt_active';
    this.isPushToTalkActive = true;
    this.isStudentSpeaking = true;
    this.consecutiveSilenceNudges = 0;
    this.clearStudentWaitTimer();
    this.clearAutoContinueTimer();
    this.clearResponseCreateFallbackTimer();
    this.stuckListeningSince = null;

    // Barge-in: stop the teacher talking immediately
    if (this.isResponseActive || this.isAudioStreamingFromModel || this.activeAudioSources.length > 0) {
      if (this.isResponseActive) {
        this.isResponseActive = false;
        this.sendJson({
          event_id: `resp_cancel_${Date.now()}`,
          type: 'response.cancel',
        });
      }
      this.stopPlayback();
    }

    // Drop anything captured before this press so the turn only contains what the
    // student says now.
    if (this.hasUncommittedStudentAudio) {
      this.sendJson({
        event_id: `buf_clear_${Date.now()}`,
        type: 'input_audio_buffer.clear',
      });
      this.hasUncommittedStudentAudio = false;
    }

    this.setState('listening');
    liveLogger.log('[QwenRealtime] 🎙️ Push-to-talk started (manual VAD) — mic open, teacher interrupted');
    return true;
  }

  /**
   * Closes the student mic: commits the captured audio and asks the teacher to
   * answer it. The teacher answers, then keeps teaching the lesson (the normal
   * auto-continue flow takes over), so the lesson never stops.
   */
  public endPushToTalk(): void {
    if (this.pttState !== 'ptt_active') {
      liveLogger.log(`[QwenRealtime] endPushToTalk ignored: pttState is '${this.pttState}'`);
      return;
    }

    this.pttState = 'committing';
    this.lastSpeechStoppedAt = Date.now();
    liveLogger.log('[QwenRealtime] 🎙️ Push-to-talk released — committing student audio');

    let shouldTriggerDeferredTool = false;

    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        liveLogger.log('[QwenRealtime] endPushToTalk: WebSocket not open, clearing PTT state');
        return;
      }

      if (!this.hasUncommittedStudentAudio) {
        // Nothing was captured (instant tap) — stay quiet instead of committing an
        // empty buffer.
        liveLogger.log('[QwenRealtime] Push-to-talk released with no captured audio — skipping commit');
        this.setState('listening');
        if (this.hasPendingToolContinuation) {
          shouldTriggerDeferredTool = true;
        }
        return;
      }

      this.hasUncommittedStudentAudio = false;
      this.consecutiveSilenceNudges = 0;
      this.clearStudentWaitTimer();

      // Manual VAD: the server never creates a response on its own, so commit the
      // student turn and ask the teacher for a reply explicitly.
      this.sendJson({
        event_id: `buf_commit_${Date.now()}`,
        type: 'input_audio_buffer.commit',
      });

      this.requestTeacherContinuation('push_to_talk_release', {
        force: true,
        instructions:
          'The student just spoke or asked something. First answer the student directly and, if they asked a question, ' +
          'address it fully in a couple of clear sentences. Then continue teaching the lesson smoothly from where you left off ' +
          'without waiting for another prompt. Speak about the diagram or key terms on the board; then advance to the next subtopic with a new diagram first. ' +
          'When you pronounce maths or formulas, say them naturally in conversational English (never say "dollar" or read LaTeX aloud).',
      });
    } finally {
      this.isPushToTalkActive = false;
      this.isStudentSpeaking = false;
      this.pttState = 'idle';
      liveLogger.log('[QwenRealtime] 🎙️ Push-to-talk state reset to idle');
      if (shouldTriggerDeferredTool) {
        liveLogger.log('[QwenRealtime] Triggering deferred tool continuation after resetting PTT state to idle');
        this.triggerToolContinuation();
      }
    }
  }

  /**
   * Control-plane errors that are expected while driving manual turns
   * (cancelling with nothing to cancel, committing/clearing an empty buffer, …).
   * They must never be surfaced as lesson errors.
   */
  private isBenignControlError(message?: string): boolean {
    if (!message) return false;
    return /no active response|already has an active response|active response|already (been )?cancel|buffer (is )?(too small|empty)|insufficient audio|empty buffer|input_audio_buffer\.(commit|clear)/i.test(
      message,
    );
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
    this.clearResponseCreateFallbackTimer();
    this.clearAutoContinueTimer();
    this.stopStuckListeningWatchdog();
    this.consecutiveSilenceNudges = 0;
    this.isStudentSpeaking = false;
    this.isReconnecting = false;
    this.pendingResumeAfterReconnect = false;
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
    this.toolItemIdToCallId.clear();
    this.executedCallIds.clear();
    this.clearToolContinuationWatchdog();
    this.hasPendingToolContinuation = false;
    this.hasGreeted = false;
    this.isStarting = false;
    this.isSessionUpdated = false;
    this.retriedWithDefaultVoice = false;
    this.isResponseActive = false;
    this.isAwaitingContinuation = false;
    this.isTurnResponseDone = false;
    this.stuckListeningSince = null;
    this.continuationRequestedForTurn = -1;
    this.micRmsWindow = [];
    this.pttState = 'idle';
    this.isPushToTalkActive = false;
    this.hasUncommittedStudentAudio = false;

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
    // If a lesson was already in progress, resume teaching after reconnect
    this.pendingResumeAfterReconnect = this.hasGreeted;
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
        if (this.pendingResumeAfterReconnect) {
          this.pendingResumeAfterReconnect = false;
          liveLogger.log('[QwenRealtime] Reconnected mid-lesson — resuming teaching');
          this.sendJson({
            event_id: `resume_${Date.now()}`,
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_text',
                text: 'Continuing the lesson — the connection was briefly interrupted. Keep teaching from where you left off: write the next key points on the board first, then speak. Do not wait for the student.',
              }],
            },
          });
          this.sendJson({
            event_id: `resume_resp_${Date.now()}`,
            type: 'response.create',
            response: {
              modalities: ['text', 'audio'],
              tools: this.getTools(),
              tool_choice: 'auto',
            },
          });
        }
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
      if (this.outputAudioCtx?.state === 'running' && this.pendingOutputDeltas.length > 0) {
        void this.flushPendingDeltas();
      }
      return this.isAudioUnlocked();
    } catch (e) {
      liveLogger.warn('[QwenRealtime] resumeAudio warning:', e);
      return false;
    }
  }

  /**
   * Triggers the initial teacher greeting.
   * Immediately writes the lesson topic in blue on the board as text.
   * Greet warmly and introduce the topic in this first turn.
   * Diagrams initiate on the second response when teaching the first concept.
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

    const topic = this.promptConfig?.topicTitle || 'Core Concept';
    const duration = this.promptConfig?.durationMinutes || 30;
    const plan = this.promptConfig?.teachingPlan;
    const phase1Name = plan?.phases?.[0]?.phaseName || 'Stage 1';
    liveLogger.log('[QwenRealtime] Triggering initial greeting for', topic, `(${duration} min) [Phase 1: ${phase1Name}]`);

    // Immediately write the topic in blue on the board as text (only if not already seeded)
    if (!this.boardController.hasElements()) {
      const blueColor = this.boardController.getTheme() === 'dark' ? '#38BDF8' : '#2563EB';
      this.boardController.writeText(topic, {
        color: blueColor,
        fontSize: 'title',
        x: 30,
        y: 50,
      });
    }

    // Give the model its starting instruction as a user message:
    // First turn is strictly warm greeting and introduction. Diagrams initiate on the second response.
    this.sendJson({
      event_id: `kickoff_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `The lesson topic "${topic}" is written in blue on the board. Greet the student warmly in 1 or 2 engaging sentences and introduce what we are exploring today. Do not draw a diagram yet (greetings and introductions first). You will begin teaching and visualizing concepts on the next turn.`,
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

  /**
   * Single owner of teacher continuation. All paths (silence, tool complete,
   * stuck-listening watchdog) must go through this so we never fire duplicate
   * response.create for one turn.
   *
   * Turn ID hygiene: this method does NOT increment currentTeachingTurnId.
   * The turn id is owned exclusively by the server `response.created` event,
   * so tool stale checks stay reliable.
   */
  private requestTeacherContinuation(
    reason: string,
    options?: { injectUserHint?: string; force?: boolean; instructions?: string },
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.isStudentSpeaking) {
      liveLogger.log(`[QwenRealtime] continuation skipped (${reason}): student speaking`);
      return;
    }
    if (this.isAudioStreamingFromModel) {
      liveLogger.log(`[QwenRealtime] continuation skipped (${reason}): audio still streaming from model`);
      return;
    }
    if (!options?.force && this.continuationRequestedForTurn === this.currentTeachingTurnId) {
      liveLogger.log(`[QwenRealtime] continuation skipped (${reason}): already requested for turn ${this.currentTeachingTurnId}`);
      return;
    }
    if (
      !options?.force &&
      this.lastSpeechStoppedAt > 0 &&
      Date.now() - this.lastSpeechStoppedAt < this.AUTO_CONTINUE_POST_SPEECH_GUARD_MS
    ) {
      liveLogger.log(`[QwenRealtime] continuation skipped (${reason}): within ${this.AUTO_CONTINUE_POST_SPEECH_GUARD_MS}ms of student speech_stopped`);
      return;
    }

    this.continuationRequestedForTurn = this.currentTeachingTurnId;
    this.isAwaitingContinuation = false;
    this.isResponseActive = true;
    this.clearAutoContinueTimer();
    liveLogger.log(`[QwenRealtime] requestTeacherContinuation reason=${reason} turn=${this.currentTeachingTurnId}`);

    if (options?.injectUserHint) {
      this.sendJson({
        event_id: `cont_hint_${Date.now()}`,
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: options.injectUserHint }],
        },
      });
    }

    this.sendJson({
      event_id: `resp_cont_${Date.now()}_${reason}`,
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        ...(options?.instructions ? { instructions: options.instructions } : {}),
        tools: this.getTools(),
        tool_choice: 'auto',
      },
    });
  }

  private startToolContinuationWatchdog(toolName?: string): void {
    this.clearToolContinuationWatchdog();
    // Slow tools (remote Mermaid render / LLM SVG generation) legitimately take 15–20s.
    // A short watchdog previously forced a continuation mid-tool, which bumped the turn
    // id and caused "[MermaidSync] stale turn — discarding SVG".
    const hasSlowTool =
      toolName === 'draw_mermaid' ||
      toolName === 'illustrate_object' ||
      [...this.pendingToolCalls.values()].some(
        (t) => t.name === 'draw_mermaid' || t.name === 'illustrate_object',
      );
    const delayMs = hasSlowTool ? 20000 : 8000;
    this.toolContinuationWatchdog = setTimeout(() => {
      this.toolContinuationWatchdog = null;
      if (this.isAwaitingContinuation || this.hasPendingToolContinuation) {
        liveLogger.warn(`[QwenRealtime] ⚠️ Tool continuation watchdog expired after ${delayMs}ms! Forcing continuation for turn ${this.currentTeachingTurnId}`);
        this.triggerToolContinuation();
      }
    }, delayMs);
  }

  private clearToolContinuationWatchdog(): void {
    if (this.toolContinuationWatchdog) {
      clearTimeout(this.toolContinuationWatchdog);
      this.toolContinuationWatchdog = null;
    }
  }

  private triggerToolContinuation(): void {
    this.clearToolContinuationWatchdog();
    if (this.isStudentSpeaking || this.isPushToTalkActive) {
      this.hasPendingToolContinuation = true;
      liveLogger.log('[QwenRealtime] triggerToolContinuation deferred: student speaking or PTT active');
      return;
    }

    this.hasPendingToolContinuation = false;
    this.isAwaitingContinuation = false;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (this.state === 'drawing') {
      this.setState(this.activeAudioSources.length > 0 ? 'speaking' : 'listening');
    }

    liveLogger.log(`[QwenRealtime] Auto-continuing teaching after tool execution (turn ${this.currentTeachingTurnId})`);

    // requestTeacherContinuation owns the once-per-turn guard and does NOT bump the turn id.
    this.requestTeacherContinuation('tool_done', {
      force: true,
      instructions:
        'Immediately speak aloud to the student. Explain what was just written or drawn on the whiteboard in clear, engaging spoken language, connecting it to the lesson concepts. When pronouncing formulas or math, speak them naturally in conversational English (e.g. say "a equals negative omega squared x" or "velocity equals frequency times lambda"). NEVER say "dollar", "dollar dollar", or LaTeX syntax aloud in your spoken voice. Continue teaching smoothly without stopping.',
    });
  }

  private startStudentWaitTimer(): void {
    this.clearStudentWaitTimer();
    if (
      this.isStudentSpeaking ||
      !this.hasGreeted ||
      this.isAwaitingContinuation ||
      this.isResponseActive ||
      this.isAudioStreamingFromModel ||
      this.activeAudioSources.length > 0 ||
      this.state !== 'listening' ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    // Natural classroom pacing:
    // - Explanation (no question): brief pause then continue speaking (~1.5s) without waiting for student
    // - Explicit question: give student ample time (~7s) before answering/hinting and resuming lesson
    const waitMs = this.lastResponseAskedQuestion ? 7000 : 1500;

    this.studentWaitTimer = setTimeout(() => {
      this.studentWaitTimer = null;
      if (
        this.isStudentSpeaking ||
        this.state !== 'listening' ||
        this.isAwaitingContinuation ||
        this.isResponseActive ||
        this.isAudioStreamingFromModel ||
        this.activeAudioSources.length > 0 ||
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      this.consecutiveSilenceNudges++;
      liveLogger.log(`[QwenRealtime] ⏱️ Silence timer fired (nudge #${this.consecutiveSilenceNudges}, askedQuestion=${this.lastResponseAskedQuestion})`);

      if (this.lastResponseAskedQuestion) {
        // Student didn't answer question — answer/hint and continue lesson without getting stuck
        this.lastResponseAskedQuestion = false;
        this.requestTeacherContinuation('silence_after_question', {
          injectUserHint:
            'The student has not responded yet. Provide a brief encouraging hint or briefly answer the question yourself. Write key terms or draw a clarifying diagram on the board first, then continue explaining the next concept smoothly. Pronounce formulas naturally — never say "dollar" aloud. Do not wait for the student.',
        });
      } else {
        // Continuous teaching: move to the next concept or example automatically
        this.requestTeacherContinuation('silence_continue', {
          injectUserHint:
            'Continue teaching smoothly without waiting. For non-math subtopics, your FIRST action MUST be a visual diagram (draw_mermaid, illustrate_object, or board_action draw) — NEVER a definition glossary write-only dump. Speak about the diagram you just drew; then advance to the next subtopic with a new diagram first. Pronounce formulas naturally in conversational English — STRICTLY NEVER say "dollar" or LaTeX code aloud in your spoken voice. Keep teaching actively.',
        });
      }
    }, waitMs);
  }

  private clearStudentWaitTimer(): void {
    if (this.studentWaitTimer) {
      clearTimeout(this.studentWaitTimer);
      this.studentWaitTimer = null;
    }
  }

  // ── Hard "stuck listening / silent teacher" watchdog (B4) ──────────────────

  /**
   * If the session sits in `listening` with no student speech, no response, and
   * no teacher audio while the socket is OPEN for > STUCK_LISTENING_THRESHOLD_MS,
   * force a continuation. Capped at MAX_FORCED_CONTINUATIONS consecutive fires;
   * after that a recoverable UI error is surfaced instead of looping silently.
   */
  private startStuckListeningWatchdog(): void {
    if (this.stuckWatchdogTimer) return;
    this.stuckWatchdogTimer = setInterval(() => {
      const conditionsHold =
        this.hasGreeted &&
        this.state === 'listening' &&
        !this.isStudentSpeaking &&
        !this.isResponseActive &&
        !this.isAudioStreamingFromModel &&
        this.activeAudioSources.length === 0 &&
        this.pendingToolCalls.size === 0 &&
        this.ws?.readyState === WebSocket.OPEN;

      if (!conditionsHold) {
        this.stuckListeningSince = null;
        return;
      }

      if (this.stuckListeningSince === null) {
        this.stuckListeningSince = Date.now();
        return;
      }
      if (Date.now() - this.stuckListeningSince < this.STUCK_LISTENING_THRESHOLD_MS) return;
      this.stuckListeningSince = null;

      if (this.forcedContinuationCount >= this.MAX_FORCED_CONTINUATIONS) {
        liveLogger.error(`[QwenRealtime] stuck_listening_watchdog: ${this.forcedContinuationCount} forced continuations already attempted — surfacing recoverable error instead of looping`);
        this.setState('error');
        this.callbacks.onError?.(new Error('The teacher stopped responding. Tap retry to continue the lesson.'));
        return;
      }

      this.forcedContinuationCount++;
      liveLogger.warn(`[QwenRealtime] stuck_listening_watchdog fired (forced #${this.forcedContinuationCount}/${this.MAX_FORCED_CONTINUATIONS})`);
      this.requestTeacherContinuation('stuck_listening_watchdog', {
        injectUserHint: 'Continue teaching the next concept. Write key points on the board, then speak. Do not wait for the student.',
        force: true,
      });
    }, 2000);
  }

  private stopStuckListeningWatchdog(): void {
    if (this.stuckWatchdogTimer) {
      clearInterval(this.stuckWatchdogTimer);
      this.stuckWatchdogTimer = null;
    }
    this.stuckListeningSince = null;
  }

  /**
   * Called strictly when all audio sources have finished playing out of the speaker
   * and the model has finished sending all audio deltas.
   */
  private onTeacherAudioFinished(): void {
    if (this.isAudioStreamingFromModel || this.activeAudioSources.length > 0) return;
    if (!this.isResponseActive && this.state !== 'speaking') return;

    liveLogger.log(`[VoiceSync] turn=${this.currentTeachingTurnId} audio-complete`);
    this.isResponseActive = false;

    if (this.pendingToolCalls.size > 0) {
      liveLogger.log(`[VoiceSync] turn=${this.currentTeachingTurnId} audio-complete, awaiting ${this.pendingToolCalls.size} pending tool calls`);
      return;
    }

    if (this.hasPendingToolContinuation) {
      liveLogger.log(`[VoiceSync] turn=${this.currentTeachingTurnId} audio-complete with deferred pending tool continuation — triggering continuation now`);
      this.triggerToolContinuation();
      return;
    }

    if (this.lastResponseAskedQuestion) {
      // ONLY STOP AND WAIT WHEN TEACHER ASKED A QUESTION
      liveLogger.log(`[VoiceSync] turn=${this.currentTeachingTurnId} waiting for student answer (question asked)`);
      this.setState('listening');
      this.startStudentWaitTimer();
    } else {
      // CONTINUOUS TEACHING: Move to the next concept without waiting for student.
      // Timer is stored so an accepted student speech_started can cancel it (B2).
      this.setState('listening');
      this.clearAutoContinueTimer();
      this.autoContinueTimer = setTimeout(() => {
        this.autoContinueTimer = null;
        if (
          !this.lastResponseAskedQuestion &&
          !this.isStudentSpeaking &&
          !this.isResponseActive &&
          !this.isAudioStreamingFromModel &&
          this.activeAudioSources.length === 0 &&
          this.ws?.readyState === WebSocket.OPEN
        ) {
          liveLogger.log(`[QwenRealtime] Continuous teaching auto-continue turn=${this.currentTeachingTurnId}`);
          this.requestTeacherContinuation('auto_continue_no_question', {
            injectUserHint:
              'Continue teaching smoothly without waiting. Move directly to introducing and explaining the next subtopic or concept. For non-math topics, call a visual tool FIRST (draw_mermaid, illustrate_object, or board_action draw) before speaking — do NOT do definition list dumps via board_action write. Speak about the diagram you just drew; then advance to the next subtopic with a new diagram first. Pronounce formulas naturally in conversational English — STRICTLY NEVER say "dollar" aloud. Keep teaching actively.',
          });
        }
      }, 500);
    }
  }



  private clearAutoContinueTimer(): void {
    if (this.autoContinueTimer) {
      clearTimeout(this.autoContinueTimer);
      this.autoContinueTimer = null;
    }
  }

  // ── Rolling peak mic RMS (echo gate) ───────────────────────────────────────

  /** Record a mic chunk RMS into the rolling window and return its peak. */
  private recordMicRms(rms: number): number {
    const now = Date.now();
    this.micRmsWindow.push({ rms, t: now });
    const cutoff = now - this.MIC_RMS_WINDOW_MS;
    while (this.micRmsWindow.length > 0 && this.micRmsWindow[0].t < cutoff) {
      this.micRmsWindow.shift();
    }
    let peak = 0;
    for (const s of this.micRmsWindow) {
      if (s.rms > peak) peak = s.rms;
    }
    return peak;
  }

  /** Peak mic RMS over the last MIC_RMS_WINDOW_MS (defaults to last known window). */
  private getMicPeakRms(): number {
    const cutoff = Date.now() - this.MIC_RMS_WINDOW_MS;
    let peak = 0;
    for (const s of this.micRmsWindow) {
      if (s.t >= cutoff && s.rms > peak) peak = s.rms;
    }
    return peak;
  }

  // ── response.create fallback after student commit ──────────────────────────

  /**
   * After the student's speech is committed, wait ~1.2s for the server's
   * response.created. If none arrives (e.g. semantic_vad create_response not
   * honored), send an explicit response.create with tools attached.
   */
  private startResponseCreateFallbackTimer(): void {
    this.clearResponseCreateFallbackTimer();
    this.responseCreateFallbackTimer = setTimeout(() => {
      this.responseCreateFallbackTimer = null;
      if (
        this.ws?.readyState !== WebSocket.OPEN ||
        this.isResponseActive ||
        this.isAudioStreamingFromModel ||
        this.isStudentSpeaking ||
        this.activeAudioSources.length > 0
      ) {
        return;
      }
      liveLogger.log('[QwenRealtime] No response.created within 1200ms of commit — sending explicit response.create');
      this.isResponseActive = true;
      this.continuationRequestedForTurn = this.currentTeachingTurnId;
      this.sendJson({
        event_id: `resp_fallback_${Date.now()}`,
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          tools: this.getTools(),
          tool_choice: 'auto',
        },
      });
    }, 1200);
  }

  private clearResponseCreateFallbackTimer(): void {
    if (this.responseCreateFallbackTimer) {
      clearTimeout(this.responseCreateFallbackTimer);
      this.responseCreateFallbackTimer = null;
    }
  }

  private sendSessionInit(overrideVoice?: string): void {
    if (!this.promptConfig) return;

    const instructions = buildTeacherSystemPrompt(this.promptConfig);
    liveLogger.log('[QwenRealtime] Sending session.update...');
    liveLogger.log(`[QwenRealtime] turn_detection mode: ${this.turnDetectionMode}`);

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
        turn_detection: this.buildTurnDetection(),
        tools: this.getTools(),
      },
    });
  }

  /**
   * Builds the `turn_detection` payload for the active mode.
   *
   * Manual mode sends `null`, which disables server-side VAD completely: the
   * student owns the turns through the mic button (see `beginPushToTalk()` /
   * `endPushToTalk()`), so the teacher never hears idle room noise and never
   * cuts the student off mid-sentence.
   */
  private buildTurnDetection(): Record<string, any> | null {
    if (this.turnDetectionMode === 'manual') {
      return null;
    }
    if (this.turnDetectionMode === 'semantic_vad') {
      // Semantic turn detection — recommended by Alibaba for the omni realtime series.
      return {
        type: 'semantic_vad',
        eagerness: 'medium',
        create_response: true,
      };
    }
    // Tuned server VAD — also the one-shot fallback when the manual/semantic
    // configuration is rejected by the server.
    return {
      type: 'server_vad',
      threshold: 0.4,
      silence_duration_ms: 900,
      prefix_padding_ms: 300,
    };
  }

  /**
   * If the server rejects session.update because of turn_detection
   * (e.g. `null` / manual mode or semantic_vad unsupported for this model),
   * log clearly and fall back to a tuned server_vad exactly once — never loop.
   * Returns true when the fallback was applied (caller must not surface an error).
   */
  private maybeFallbackTurnDetection(errorMessage: string): boolean {
    if (!errorMessage || this.hasTurnDetectionFallback) return false;
    if (this.turnDetectionMode === 'server_vad') return false;
    const isTurnDetectionRejection =
      /turn_detection|semantic_vad|unknown.*(type|value)|invalid.*turn/i.test(errorMessage);
    if (!isTurnDetectionRejection) return false;

    const rejectedMode = this.turnDetectionMode;
    this.hasTurnDetectionFallback = true;
    this.turnDetectionMode = 'server_vad';
    this.isSessionUpdated = false;
    liveLogger.warn(
      `[QwenRealtime] ${rejectedMode} turn detection rejected by server — falling back to tuned server_vad once. Server said: ${errorMessage}`,
    );
    this.sendSessionInit();
    return true;
  }

  /**
   * The single board tool exposed to the model.
   * Uses Alibaba's documented function calling schema (nested function object).
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
          description: 'Keyword, key term, definition, summary note, or formula to write on the board. Structure as "Key Term: definition or formula" (e.g. "Wave Equation: v = f \\lambda").',
        },
        target: {
          type: 'string',
          description: 'Target element label, ID, or "last" (for "highlight" or "erase" actions)',
        },
      },
      required: ['action'],
    };

    const description =
      'Control the educational whiteboard. Writing on the board (action: "write") is PRIMARY — write key terms, core definitions, formulas, and step summaries. Call this FIRST when introducing a concept so the student sees the key terms on the board before you speak. Use "draw" to create step-by-step boxes with connecting arrows, or use draw_mermaid for flowcharts/pipelines in rows and columns. Prioritize visualizing ideas and concepts on the board.';

    return {
      type: 'function',
      function: {
        name: 'board_action',
        description,
        parameters,
      },
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
      function: {
        name: 'draw_mermaid',
        description:
          'Render a Mermaid.js diagram directly onto the visual whiteboard canvas to illustrate concepts and ideas. ' +
          'Use for: flowcharts, sequential pipelines, row/column processes with branches, cause/effect, cycles, and component interactions. ' +
          'Use "graph LR" (horizontal flow in rows/columns with branches) or "graph TD". STRICTLY NEVER generate 360-degree radial trees or mindmaps. ' +
          'Draw diagrams to visualize concepts when explaining ideas.',
        parameters: {
          type: 'object',
          properties: {
            mermaid_code: {
              type: 'string',
              description:
                'Raw valid Mermaid source code. Do not include markdown fences. ' +
                'Keep labels concise, clear, and educational.',
            },
          },
          required: ['mermaid_code'],
        },
      },
    };
  }

  private buildIllustrateObjectTool() {
    return {
      type: 'function',
      function: {
        name: 'illustrate_object',
        description:
          'PROACTIVELY generate and render a detailed SVG illustration of a complex object, entity, or structure directly onto the whiteboard canvas. ' +
          'Call this proactively whenever teaching physical, biological, anatomical, astronomical, chemical, or mechanical entities without waiting to be asked.',
        parameters: {
          type: 'object',
          properties: {
            object_description: {
              type: 'string',
              description: 'A clear, descriptive label of the object to illustrate (e.g. "plant cell with chloroplasts", "DNA double helix", "water molecule with covalent bonds").',
            },
          },
          required: ['object_description'],
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

        // semantic_vad / manual rejected → one-shot fallback to tuned server_vad (no loop)
        if (typeof errMsg === 'string' && this.maybeFallbackTurnDetection(errMsg)) {
          return;
        }

        // Control-plane noise that manual turns legitimately produce (e.g. clearing
        // an empty buffer, cancelling a response that already finished) must never
        // be surfaced as a lesson error.
        if (typeof errMsg === 'string' && this.isBenignControlError(errMsg)) {
          liveLogger.warn(`[QwenRealtime] Ignoring benign control-plane error: ${errMsg}`);
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
          this.isAudioStreamingFromModel = true;
          this.isResponseActive = true;
          // Teacher is speaking again — reset the forced-continuation cap (B4)
          this.forcedContinuationCount = 0;
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
        // New teaching turn — reset transcript, flags, and ownership.
        // NOTE: currentTeachingTurnId is owned exclusively by this event (B6).
        this.currentTeachingTurnId += 1;
        this.fullTranscript = '';
        this.lastResponseAskedQuestion = false;
        this.hasReceivedAudioInCurrentResponse = false;
        this.isResponseActive = true;
        this.isAudioStreamingFromModel = true;
        this.isAwaitingContinuation = false;
        this.isTurnResponseDone = false;
        this.hasPendingToolContinuation = false;
        this.clearToolContinuationWatchdog();
        this.continuationRequestedForTurn = -1;
        this.clearStudentWaitTimer();
        this.clearResponseCreateFallbackTimer();
        this.clearAutoContinueTimer();
        this.isBurstStart = true;
        this.isStreamPlaying = false;
        liveLogger.log(`[QwenRealtime] response.created turn=${this.currentTeachingTurnId}`);
        break;

      // ── Student interruption / speech events ─────────────────────────────
      case 'input_audio_buffer.speech_started': {
        // Rolling-peak echo gate: only treat as speaker echo when the mic peak over
        // the last ~300ms is near the noise floor WHILE the teacher is outputting.
        // Real student speech (peak ≥ 0.12) is always accepted, even mid-playback.
        const teacherActive =
          this.isResponseActive || this.activeAudioSources.length > 0 || this.state === 'speaking';
        const peakRms = this.getMicPeakRms();
        // Ignore ONLY when near the noise floor while teacher outputs (echo leakage).
        // Peak ≥ 0.12 is always real speech; the 0.08–0.12 band is accepted too
        // (erring toward not ignoring quiet students).
        const isDefinitelyRealSpeech = peakRms >= this.REAL_SPEECH_PEAK_RMS;
        const isNearFloor = peakRms < this.ECHO_IGNORE_PEAK_RMS;
        if (teacherActive && !isDefinitelyRealSpeech && isNearFloor) {
          liveLogger.log('[QwenRealtime] Ignored false speech_started from speaker acoustic echo (peak rms:', peakRms.toFixed(3), ')');
          break;
        }
        liveLogger.log(`[QwenRealtime] 🎙️ Student speech started (peak rms: ${peakRms.toFixed(3)}) — stopping teacher audio`);
        this.isStudentSpeaking = true;
        this.consecutiveSilenceNudges = 0;
        this.clearStudentWaitTimer();
        // Cancel any pending auto-continue so it cannot race the student (B2)
        this.clearAutoContinueTimer();
        this.stopPlayback();
        this.setState('listening');
        break;
      }

      case 'input_audio_buffer.speech_stopped':
        liveLogger.log('[QwenRealtime] 🎙️ Student speech stopped — awaiting model response');
        this.isStudentSpeaking = false;
        this.lastSpeechStoppedAt = Date.now();
        this.clearStudentWaitTimer();
        // If the server does not create a response within ~1.2s, send response.create ourselves
        this.startResponseCreateFallbackTimer();
        break;

      case 'input_audio_buffer.committed':
        liveLogger.log('[QwenRealtime] input_audio_buffer.committed');
        this.lastSpeechStoppedAt = Date.now();
        this.startResponseCreateFallbackTimer();
        break;

      // ── Tool / function call ────────────────────────────────────────────
      case 'response.output_item.added': {
        liveLogger.log(`[QwenRealtime] output_item.added:`, event.item?.type);
        if (event.item?.type === 'function_call' || event.item?.type === 'custom_tool_call') {
          const item = event.item;
          const callId = item.call_id || item.id;
          if (callId) {
            if (item.id && item.call_id) {
              this.toolItemIdToCallId.set(item.id, item.call_id);
            }
            const entry = {
              name: item.name || item.function?.name || '',
              call_id: callId,
              arguments: item.arguments || item.function?.arguments || '',
            };
            this.pendingToolCalls.set(callId, entry);
          }
        }
        break;
      }

      case 'response.function_call_arguments.delta': {
        const callId = event.call_id || (event.item_id ? this.toolItemIdToCallId.get(event.item_id) : null) || event.item_id;
        if (callId && this.pendingToolCalls.has(callId)) {
          const pending = this.pendingToolCalls.get(callId)!;
          pending.arguments += (event.delta || '');
        }
        break;
      }

      case 'response.function_call_arguments.done': {
        const callId = event.call_id || (event.item_id ? this.toolItemIdToCallId.get(event.item_id) : null) || event.item_id;
        const pending = callId ? this.pendingToolCalls.get(callId) : null;
        const toolName = event.name || event.function?.name || pending?.name;
        const effectiveCallId = pending?.call_id || callId;
        
        let argsStr = event.arguments || event.function?.arguments || '';
        if (pending && pending.arguments && pending.arguments.length > argsStr.length) {
          argsStr = pending.arguments;
        }
        if (!argsStr) argsStr = '{}';

        liveLogger.log(
          `[QwenRealtime] TOOL CALL RECEIVED\n` +
          `name: ${toolName}\n` +
          `call_id: ${effectiveCallId}\n` +
          `arguments: ${argsStr}`
        );

        if (toolName && effectiveCallId) {
          void this.executeToolCall(effectiveCallId, toolName, argsStr);
        }
        break;
      }

      case 'response.output_item.done': {
        liveLogger.log(`[QwenRealtime] output_item.done:`, event.item?.type);
        if (event.item?.type === 'function_call' || event.item?.type === 'custom_tool_call') {
          const item = event.item;
          const callId = item.call_id || (item.id ? this.toolItemIdToCallId.get(item.id) : null) || item.id;
          const toolName = item.name || item.function?.name;
          const pending = callId ? this.pendingToolCalls.get(callId) : null;
          const effectiveCallId = pending?.call_id || callId;
          
          let argsStr = item.arguments || item.function?.arguments || '';
          if (pending && pending.arguments && pending.arguments.length > argsStr.length) {
            argsStr = pending.arguments;
          }
          if (!argsStr) argsStr = '{}';
          
          if (toolName && effectiveCallId && !this.executedCallIds.has(effectiveCallId)) {
            liveLogger.log(
              `[QwenRealtime] TOOL CALL RECEIVED (from output_item.done)\n` +
              `name: ${toolName}\n` +
              `call_id: ${effectiveCallId}\n` +
              `arguments: ${argsStr}`
            );
            void this.executeToolCall(effectiveCallId, toolName, argsStr);
          }
        }
        break;
      }

      case 'response.audio.done':
        liveLogger.log(`[QwenRealtime] response.audio.done turn=${this.currentTeachingTurnId}`);
        this.isAudioStreamingFromModel = false;
        this.drainAudioQueue(true);
        if (this.totalQueuedSamples === 0 && this.activeAudioSources.length === 0) {
          this.onTeacherAudioFinished();
        }
        break;

      case 'response.done': {
        liveLogger.log(`[QwenRealtime] response.done turn=${this.currentTeachingTurnId}`);
        this.isAudioStreamingFromModel = false;
        this.isTurnResponseDone = true;
        this.drainAudioQueue(true);

        // If a tool output was submitted and is waiting for response.done to finish turn
        if (this.hasPendingToolContinuation) {
          liveLogger.log('[QwenRealtime] response.done arrived with pending tool continuation — triggering now');
          this.triggerToolContinuation();
          break;
        }

        // If tools are still executing (e.g. SVG generation in progress)
        if (this.isAwaitingContinuation || this.pendingToolCalls.size > 0) {
          liveLogger.log('[QwenRealtime] response.done while tool is executing — awaiting tool completion');
          break;
        }

        // If all scheduled audio has finished playing, declare audio finished
        if (this.totalQueuedSamples === 0 && this.activeAudioSources.length === 0) {
          this.onTeacherAudioFinished();
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
        // semantic_vad / manual rejected → one-shot fallback to tuned server_vad (no loop)
        if (typeof event.error?.message === 'string' && this.maybeFallbackTurnDetection(event.error.message)) {
          return;
        }
        if (typeof event.error?.message === 'string' && this.isBenignControlError(event.error.message)) {
          liveLogger.warn(`[QwenRealtime] Ignoring benign control-plane error: ${event.error.message}`);
          break;
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

    const turnAtStart = this.currentTeachingTurnId;
    this.setState('drawing');
    this.isAwaitingContinuation = true;
    this.startToolContinuationWatchdog(name);

    let args: any = {};
    try {
      args = typeof argsRaw === 'string'
        ? JSON.parse(argsRaw)
        : (argsRaw ?? {});
    } catch (e) {
      liveLogger.warn('[QwenRealtime] Bad tool args:', argsRaw);
    }

    let toolResult: any;
    const t0 = Date.now();

    if (name === 'board_action') {
      toolResult = this.boardController.executeBoardAction(args);
      liveLogger.log(`[BoardSync] turn=${turnAtStart} action=board_action call=${callId} latency=${Date.now() - t0}ms`);
    } else if (name === 'draw_mermaid') {
      const code = args.mermaid_code || args.code || '';
      const theme = (this.boardController as any).getTheme?.() || 'light';
      liveLogger.log(`[MermaidSync] turn=${turnAtStart} render-start call=${callId}`);
      try {
        const svg = await MermaidBoardService.renderToSvg(code, theme);
        if (turnAtStart !== this.currentTeachingTurnId) {
          // Turn advanced while rendering (e.g. watchdog forced a continuation).
          // Apply the visual anyway — never discard the only visual for a turn.
          liveLogger.warn(`[MermaidSync] turn advanced (${turnAtStart} → ${this.currentTeachingTurnId}) — applying SVG anyway`);
        }
        if (svg) {
          this.boardController.setSvgIllustration(svg);
          liveLogger.log(`[MermaidSync] turn=${turnAtStart} insert-complete total=${Date.now() - t0}ms`);
          toolResult = { status: 'ok', action: 'draw_mermaid', message: 'Diagram rendered and inserted' };
        } else {
          toolResult = { status: 'error', action: 'draw_mermaid', message: 'Mermaid render returned empty SVG' };
        }
      } catch (err) {
        liveLogger.error('[QwenRealtime] draw_mermaid error:', err);
        toolResult = { status: 'error', action: 'draw_mermaid', message: String(err) };
      }
    } else if (name === 'illustrate_object') {
      const desc = args.object_description || args.description || '';
      liveLogger.log(`[SvgSync] turn=${turnAtStart} generate-start call=${callId}`);
      try {
        const svg = await LlmSvgObjectCache.getOrGenerate(desc, async () => {
          if (!this.appSettings) return null;
          const textModel =
            getFeatureModel('chat_interaction', this.appSettings) ||
            this.appSettings?.alibaba_model ||
            'qwen3.8-omni-flash';

          const ai = createAvelutAI(this.appSettings, this.userProfile, { feature: 'chat_interaction' });
          const res = await ai.models.generateContent({
            model: textModel,
            contents:
              'Generate ONLY raw valid SVG for a white educational whiteboard. ' +
              'Transparent background. High-contrast dark strokes and readable fills. ' +
              'No white-on-white, no white text, no invisible shapes. No markdown, no explanations. Object: ' +
              desc,
            config: {
              temperature: 0.2,
              maxOutputTokens: 1500,
            },
          });
          return getResponseText(res);
        });
        if (turnAtStart !== this.currentTeachingTurnId) {
          // Turn advanced while generating — apply anyway, never discard the visual.
          liveLogger.warn(`[SvgSync] turn advanced (${turnAtStart} → ${this.currentTeachingTurnId}) — applying SVG anyway`);
        }
        if (svg) {
          // Optional: run through same normalizer if available
          this.boardController.setSvgIllustration(svg);
          liveLogger.log(`[SvgSync] turn=${turnAtStart} insert-complete total=${Date.now() - t0}ms`);
          toolResult = { status: 'ok', action: 'illustrate_object', message: 'Illustration generated and inserted' };
        } else {
          toolResult = { status: 'error', action: 'illustrate_object', message: 'SVG generation returned empty' };
        }
      } catch (err) {
        liveLogger.error('[QwenRealtime] illustrate_object error:', err);
        toolResult = { status: 'error', action: 'illustrate_object', message: String(err) };
      }
    } else {
      liveLogger.warn('[QwenRealtime] Unknown tool:', name);
      toolResult = { status: 'error', message: `Unknown tool: ${name}` };
    }

    // Always surface the tool result — even if the turn advanced while the tool
    // ran, the server conversation must stay consistent (B3). Never drop it silently.
    if (turnAtStart !== this.currentTeachingTurnId) {
      liveLogger.log(`[QwenRealtime] Tool ${name} finished for advanced turn ${turnAtStart} (now ${this.currentTeachingTurnId}) — still submitting result`);
    }

    liveLogger.log('[QwenRealtime] TOOL EXECUTED', name, toolResult?.status);

    this.sendJson({
      event_id: `tool_out_${Date.now()}`,
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(toolResult),
      },
    });

    // Clear pending entry
    this.pendingToolCalls.delete(callId);
    for (const [itId, cId] of this.toolItemIdToCallId.entries()) {
      if (cId === callId) {
        this.toolItemIdToCallId.delete(itId);
      }
    }

    // Tool has finished execution — reset state
    if (this.state === 'drawing') {
      this.setState(this.activeAudioSources.length > 0 ? 'speaking' : 'listening');
    }

    // AUTO-CONTINUE TEACHING:
    if (this.pendingToolCalls.size === 0) {
      liveLogger.log(`[QwenRealtime] All pending tools finished (isTurnResponseDone=${this.isTurnResponseDone})`);
      if (turnAtStart !== this.currentTeachingTurnId) {
        // A newer response already owns the lesson. Request at most one extra
        // continuation, and only when nothing is currently active for it.
        if (
          !this.isResponseActive &&
          !this.isAudioStreamingFromModel &&
          this.activeAudioSources.length === 0
        ) {
          this.requestTeacherContinuation('tool_done_after_turn_advance', { force: true });
        } else {
          liveLogger.log('[QwenRealtime] Tool finished for advanced turn — active response continues (no extra continuation)');
        }
      } else if (this.isTurnResponseDone) {
        // Server already sent response.done for this turn! Safe to dispatch continuation immediately.
        this.triggerToolContinuation();
      } else {
        // Server has not yet sent response.done. Await response.done before requesting continuation.
        this.hasPendingToolContinuation = true;
        liveLogger.log('[QwenRealtime] Awaiting server response.done before requesting continuation');
      }
    }
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
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      if (!samples || samples.length === 0) return;

      // Compute RMS for UI visualisation and echo tracking
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      this.lastMicRms = rms;
      const peakRms = this.recordMicRms(rms);
      this.callbacks.onAudioLevel?.(Math.min(1, rms * 4));

      // ── Manual (push-to-talk) turn detection ──────────────────────────────
      // The mic is only uploaded while the student holds the mic button, so idle
      // room noise and speaker echo can never reach the server, and a turn can
      // never be committed before the student pressed "stop".
      if (this.turnDetectionMode === 'manual' && !this.isPushToTalkActive) {
        return;
      }

      // Suppress mic upload ONLY while the teacher is outputting and the rolling
      // peak is near the noise floor (speaker echo leakage). Loud audio — real
      // student barge-in — always uploads so server VAD can hear the student.
      const isTeacherSpeaking = this.isResponseActive || this.activeAudioSources.length > 0 || this.state === 'speaking';
      if (isTeacherSpeaking && peakRms < this.ECHO_IGNORE_PEAK_RMS) {
        return;
      }

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

      // Remember that this student turn still has to be committed on release.
      this.hasUncommittedStudentAudio = true;

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

  // ── Audio output (WebSocket → speaker) & Jitter Smoothing ──────────────────

  private async ensureOutputRunning(): Promise<boolean> {
    if (!this.outputAudioCtx) return false;
    if (this.outputAudioCtx.state === 'suspended') {
      try {
        await this.outputAudioCtx.resume();
      } catch (err) {
        liveLogger.warn('[QwenRealtime] ensureOutputRunning failed to resume:', err);
      }
    }
    return this.outputAudioCtx.state === 'running';
  }

  private async flushPendingDeltas(): Promise<void> {
    if (this.isFlushingDeltas || !this.outputAudioCtx || this.outputAudioCtx.state !== 'running') return;
    this.isFlushingDeltas = true;
    try {
      while (this.pendingOutputDeltas.length > 0 && this.outputAudioCtx.state === 'running') {
        const delta = this.pendingOutputDeltas.shift();
        if (delta) {
          this.processIncomingPcmDelta(delta);
        }
      }
    } finally {
      this.isFlushingDeltas = false;
    }
  }

  private async playDelta(base64: string): Promise<void> {
    if (!this.outputAudioCtx || !base64) return;
    try {
      const isRunning = await this.ensureOutputRunning();

      if (!isRunning || this.outputAudioCtx.state === 'suspended') {
        // Queue delta instead of discarding so no words are dropped when opening on web
        this.pendingOutputDeltas.push(base64);
        return;
      }

      // If deltas are queued, flush first to preserve chronological order
      if (this.pendingOutputDeltas.length > 0) {
        this.pendingOutputDeltas.push(base64);
        await this.flushPendingDeltas();
        return;
      }

      this.processIncomingPcmDelta(base64);
    } catch (err) {
      liveLogger.warn('[QwenRealtime] playDelta error:', err);
    }
  }

  private processIncomingPcmDelta(base64: string): void {
    try {
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

      // Safe Little-Endian 16-bit PCM decoding via DataView (avoids unaligned byteOffset RangeErrors)
      const view = new DataView(combinedBytes.buffer, combinedBytes.byteOffset, combinedBytes.byteLength);
      const float32 = new Float32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        float32[i] = view.getInt16(i * 2, true) / 32768.0;
      }

      this.pcmSampleQueue.push(float32);
      this.totalQueuedSamples += sampleCount;

      this.drainAudioQueue(false);
    } catch (err) {
      liveLogger.warn('[QwenRealtime] processIncomingPcmDelta error:', err);
    }
  }

  private drainAudioQueue(forceFlush: boolean): void {
    if (!this.outputAudioCtx || this.totalQueuedSamples === 0) return;

    // Preroll cushion: when starting speech, accumulate ~120ms before scheduling the first chunk.
    // This absorbs initial WebSocket packet jitter completely.
    if (!this.isStreamPlaying && !forceFlush) {
      if (this.totalQueuedSamples < this.PREROLL_MIN_SAMPLES) {
        return;
      }
      this.isStreamPlaying = true;
      this.isBurstStart = true;
    }

    // While we have enough samples for standard ~100ms contiguous playback chunks:
    while (
      (this.totalQueuedSamples >= this.TARGET_CHUNK_SAMPLES) ||
      (forceFlush && this.totalQueuedSamples > 0)
    ) {
      const neededSamples = forceFlush
        ? this.totalQueuedSamples
        : Math.min(this.TARGET_CHUNK_SAMPLES, this.totalQueuedSamples);

      if (neededSamples <= 0) break;

      const chunk = new Float32Array(neededSamples);
      let copied = 0;

      while (copied < neededSamples && this.pcmSampleQueue.length > 0) {
        const head = this.pcmSampleQueue[0];
        const remainingToCopy = neededSamples - copied;

        if (head.length <= remainingToCopy) {
          chunk.set(head, copied);
          copied += head.length;
          this.pcmSampleQueue.shift();
        } else {
          chunk.set(head.subarray(0, remainingToCopy), copied);
          this.pcmSampleQueue[0] = head.subarray(remainingToCopy);
          copied += remainingToCopy;
        }
      }

      this.totalQueuedSamples -= copied;

      // Micro-fade at burst boundaries to prevent clicks / pops
      if (this.isBurstStart && chunk.length >= 48) {
        for (let i = 0; i < 48; i++) {
          chunk[i] *= (i / 48);
        }
        this.isBurstStart = false;
      }

      if (forceFlush && this.totalQueuedSamples === 0 && chunk.length >= 48) {
        for (let i = 0; i < 48; i++) {
          chunk[chunk.length - 1 - i] *= (i / 48);
        }
      }

      this.scheduleAudioBuffer(chunk);
    }

    if (forceFlush) {
      this.isStreamPlaying = false;
      this.isBurstStart = true;
    }
  }

  private scheduleAudioBuffer(samples: Float32Array): void {
    if (!this.outputAudioCtx || samples.length === 0) return;

    // DashScope/Qwen Realtime PCM audio is 24,000 Hz
    const sampleRate = 24000;
    const duration = samples.length / sampleRate;

    const buf = this.outputAudioCtx.createBuffer(1, samples.length, sampleRate);
    buf.copyToChannel(samples, 0);

    const src = this.outputAudioCtx.createBufferSource();
    src.buffer = buf;

    if (!this.outputGainNode) {
      this.outputGainNode = this.outputAudioCtx.createGain();
      this.outputGainNode.gain.value = 1.0;
      this.outputGainNode.connect(this.outputAudioCtx.destination);
    }
    src.connect(this.outputGainNode);

    const now = this.outputAudioCtx.currentTime;

    // Smooth gapless scheduling:
    // If nextPlayTime has fallen slightly behind 'now':
    // If the gap is small (< 50ms), schedule AT 'now' seamlessly WITHOUT inserting a 45ms silence hole!
    // If the gap is larger (cold start or long gap), prime with a tiny 25ms lead-in to give the audio driver headroom.
    if (this.nextPlayTime < now) {
      const gap = now - this.nextPlayTime;
      if (gap < 0.05) {
        this.nextPlayTime = now;
      } else {
        this.nextPlayTime = now + 0.025;
      }
    }

    src.start(this.nextPlayTime);
    this.nextPlayTime += duration;

    this.activeAudioSources.push(src);
    src.onended = () => {
      const i = this.activeAudioSources.indexOf(src);
      if (i !== -1) this.activeAudioSources.splice(i, 1);
      if (!this.isAudioStreamingFromModel && this.totalQueuedSamples === 0 && this.activeAudioSources.length === 0) {
        this.onTeacherAudioFinished();
      }
    };
  }

  /** Instantly stop all queued teacher speech buffers and drain buffers */
  public stopPlayback(): void {
    this.isAudioStreamingFromModel = false;
    this.activeAudioSources.forEach(s => { try { s.stop(); s.disconnect(); } catch (_) {} });
    this.activeAudioSources = [];
    this.pendingOutputDeltas = [];
    this.pcmSampleQueue = [];
    this.totalQueuedSamples = 0;
    this.isStreamPlaying = false;
    this.isBurstStart = true;
    this.pcmRemainder = new Uint8Array(0);
    if (this.outputAudioCtx) this.nextPlayTime = this.outputAudioCtx.currentTime;
  }
}
