/**
 * AlibabaVoiceEngine.ts — Alibaba Cloud DashScope (CosyVoice / Qwen-TTS) Engine for Avelut
 *
 * Provides high-speed cloud speech synthesis using Alibaba Cloud DashScope API
 * with multi-tier local caching and Web Audio playback.
 */

import { readCachedJson, writeCachedJson } from '../../utils/cache';
import { getAlibabaApiKey } from '../../utils/appSettings';
import type { AppSettings } from '../../types';

export interface AlibabaAudioResponsePayload {
  audio: string; // base64-encoded audio
  content_type: string;
  duration?: number;
}

export interface AlibabaSpeechOptions {
  appSettings?: AppSettings | null;
  voice?: string;
  model?: string;
  language?: string;
  speed?: number;
  apiKey?: string;
  cacheKey?: string;
  isPrivate?: boolean;
  onStart?: () => void;
  onReady?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export interface AlibabaAudioPlayer {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  isPlaying: () => boolean;
  seek: (time: number) => void;
}

class AlibabaVoiceEngine {
  private audioCtx: AudioContext | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private activeSessionId = 0;
  private memoryCache = new Map<string, AlibabaAudioResponsePayload>();
  private inFlightCache = new Map<string, Promise<AlibabaAudioResponsePayload | null>>();

  private getAudioContext(): AudioContext {
    if (!this.audioCtx || this.audioCtx.state === 'closed') {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Fetch audio from Alibaba DashScope with multi-tier caching
   */
  public async fetchAlibabaSpeech(
    text: string,
    options: AlibabaSpeechOptions = {}
  ): Promise<AlibabaAudioResponsePayload | null> {
    if (!text || !text.trim()) return null;

    const cacheKey = options.cacheKey ? `avelut_alibaba_tts_${options.cacheKey}` : null;

    // 1. In-memory cache
    if (cacheKey && this.memoryCache.has(cacheKey)) {
      return this.memoryCache.get(cacheKey)!;
    }

    // 2. Persistent local storage
    if (cacheKey) {
      const cached = readCachedJson<AlibabaAudioResponsePayload | null>(cacheKey, null);
      if (cached?.audio) {
        this.memoryCache.set(cacheKey, cached);
        return cached;
      }
    }

    // 3. Single-flight in-progress deduplication
    if (cacheKey) {
      const existing = this.inFlightCache.get(cacheKey);
      if (existing) return existing;
      const p = this.fetchAlibabaSpeechImpl(text, options, cacheKey);
      this.inFlightCache.set(cacheKey, p);
      void p.finally(() => this.inFlightCache.delete(cacheKey));
      return p;
    }

    return this.fetchAlibabaSpeechImpl(text, options, null);
  }

  private async fetchAlibabaSpeechImpl(
    text: string,
    options: AlibabaSpeechOptions,
    cacheKey: string | null
  ): Promise<AlibabaAudioResponsePayload | null> {
    const isNative = typeof window !== 'undefined' && (
      (window as any).Capacitor?.isNativePlatform?.() ||
      window.location.protocol === 'file:'
    );

    const proxyEndpoint = isNative ? 'https://www.avelut.xyz/api/alibaba-speech' : '/api/alibaba-speech';
    const directEndpoint = 'https://ws-o3v6mh0i8y9tqdfx.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

    let apiKey = '';
    try {
      apiKey = options.apiKey?.trim() || getAlibabaApiKey(options.appSettings);
    } catch (_) {
      apiKey = options.apiKey?.trim() || '';
    }

    const model = options.model || options.appSettings?.alibaba_voice_model || 'qwen3-tts-flash';
    const voice = options.voice || options.appSettings?.alibaba_voice_name || 'Jennifer';

    let lastErr: Error | null = null;

    // 1. Try server proxy endpoint first
    try {
      const response = await fetch(proxyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          text: text.trim(),
          voice,
          model,
        }),
      });

      if (response.ok) {
        const payload = await response.json();
        if (payload?.audio) {
          const result: AlibabaAudioResponsePayload = {
            audio: payload.audio,
            content_type: payload.content_type || 'audio/wav',
          };
          if (cacheKey) {
            this.memoryCache.set(cacheKey, result);
            try { writeCachedJson(cacheKey, result); } catch {}
          }
          return result;
        }
      } else {
        const errText = await response.text();
        lastErr = new Error(`Proxy TTS HTTP ${response.status}: ${errText}`);
      }
    } catch (e: any) {
      lastErr = e;
    }

    // 2. Direct client call fallback only for native apps (Capacitor/Node) where CORS does not apply
    if (!isNative || !apiKey) {
      console.warn('[AlibabaVoiceEngine] TTS fetch error:', lastErr);
      throw lastErr || new Error('Alibaba TTS proxy failed or API key is not configured');
    }

    try {
      const response = await fetch(directEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: {
            text: text.trim(),
            voice,
            language_type: 'English',
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Direct Alibaba TTS HTTP ${response.status}: ${errText}`);
      }

      const json = await response.json();
      const audioUrl = json?.output?.audio?.url || json?.output?.audio || '';

      if (!audioUrl) {
        throw new Error(`Alibaba TTS returned no audio URL. Response: ${JSON.stringify(json)}`);
      }

      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) {
        throw new Error(`Failed to fetch synthesized WAV from audio URL: ${audioUrl}`);
      }

      const arrayBuffer = await audioRes.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(arrayBuffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Audio = window.btoa(binary);

      const result: AlibabaAudioResponsePayload = {
        audio: base64Audio,
        content_type: 'audio/wav',
      };

      if (cacheKey) {
        this.memoryCache.set(cacheKey, result);
        try { writeCachedJson(cacheKey, result); } catch {}
      }

      return result;
    } catch (err: any) {
      console.warn('[AlibabaVoiceEngine] Direct TTS fetch error:', err);
      throw err;
    }
  }

  /**
   * Synthesize and stream or play audio
   */
  public playSpeech(
    text: string,
    options: AlibabaSpeechOptions = {}
  ): AlibabaAudioPlayer {
    const sessionId = ++this.activeSessionId;
    this.stopAudio();

    let isPlayingState = false;
    let audioEl: HTMLAudioElement | null = null;

    const player: AlibabaAudioPlayer = {
      pause: () => {
        if (audioEl) audioEl.pause();
      },
      resume: () => {
        if (audioEl) audioEl.play().catch(() => {});
      },
      stop: () => {
        if (sessionId === this.activeSessionId) {
          this.stopAudio();
        }
      },
      isPlaying: () => isPlayingState,
      seek: (time: number) => {
        if (audioEl && Number.isFinite(time)) {
          audioEl.currentTime = Math.max(0, time);
        }
      },
    };

    void (async () => {
      try {
        const payload = await this.fetchAlibabaSpeech(text, options);
        if (sessionId !== this.activeSessionId) return;

        if (!payload?.audio) {
          options.onError?.(new Error('Failed to generate Alibaba TTS audio'));
          return;
        }

        options.onReady?.();

        const audioSrc = payload.audio.startsWith('data:')
          ? payload.audio
          : `data:${payload.content_type || 'audio/mp3'};base64,${payload.audio}`;

        audioEl = new Audio(audioSrc);
        this.currentAudioElement = audioEl;

        audioEl.onplay = () => {
          isPlayingState = true;
          options.onStart?.();
        };

        audioEl.onended = () => {
          isPlayingState = false;
          options.onEnd?.();
        };

        audioEl.onerror = (e) => {
          isPlayingState = false;
          options.onError?.(new Error(`Alibaba Audio playback error: ${e}`));
        };

        try {
          await audioEl.play();
        } catch (playErr: any) {
          if (playErr?.name === 'AbortError' || playErr?.message?.includes('interrupted by a call to pause')) {
            return;
          }
          if (sessionId === this.activeSessionId) {
            options.onError?.(playErr);
          }
        }
      } catch (err: any) {
        if (sessionId === this.activeSessionId) {
          options.onError?.(err);
        }
      }
    })();

    return player;
  }

  public stopAudio(): void {
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.src = '';
      } catch {}
      this.currentAudioElement = null;
    }
  }
}

export const alibabaVoiceEngine = new AlibabaVoiceEngine();
export const alibabaTts = alibabaVoiceEngine;
