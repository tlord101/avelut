import { grokVoiceEngine, type GrokAudioPlayer, type GrokTtsResponsePayload } from './GrokVoiceEngine';
import { alibabaVoiceEngine, type AlibabaAudioPlayer, type AlibabaAudioResponsePayload } from './AlibabaVoiceEngine';
import type { AppSettings } from '../../types';

export type UnifiedVoiceProvider = 'grok' | 'alibaba' | 'browser';

export interface UnifiedSpeechOptions {
  provider?: UnifiedVoiceProvider;
  context?: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  language?: string;
  withTimestamps?: boolean;
  cacheKey?: string;
  isPrivate?: boolean;
  appSettings?: AppSettings;
  onStart?: () => void;
  onReady?: () => void;
  onTimeUpdate?: (currentTime: number, charIndex: number, spokenWord: string) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export type UnifiedAudioPlayer = GrokAudioPlayer | AlibabaAudioPlayer;

/**
 * Unified Voice Router
 * Dynamic router supporting both Grok Voice Engine (Altair, Nova, Echo, Shimmer, Onyx, Fable, Alloy)
 * and Alibaba Cloud DashScope (Qwen3-TTS / CosyVoice - Jennifer, etc.).
 */
export class UnifiedVoiceRouter {
  public resolveProvider(options: UnifiedSpeechOptions = {}): UnifiedVoiceProvider {
    if (options.provider) {
      return options.provider;
    }
    const voiceLower = (options.voice || '').toLowerCase().trim();
    if (voiceLower === 'jennifer' || voiceLower.includes('alibaba') || voiceLower.includes('qwen')) {
      return 'alibaba';
    }
    const grokVoices = ['altair', 'nova', 'echo', 'shimmer', 'onyx', 'fable', 'alloy'];
    if (grokVoices.includes(voiceLower)) {
      return 'grok';
    }
    if (options.appSettings?.active_voice_provider === 'alibaba') {
      return 'alibaba';
    }
    return 'grok';
  }

  /**
   * Play speech using the resolved provider engine (Grok default with Alibaba Qwen3-TTS fallback)
   */
  public playSpeech(
    text: string,
    options: UnifiedSpeechOptions = {}
  ): UnifiedAudioPlayer {
    const provider = this.resolveProvider(options);

    if (provider === 'alibaba') {
      const voice = options.voice || options.appSettings?.alibaba_voice_name || 'Jennifer';
      return alibabaVoiceEngine.playSpeech(text, {
        appSettings: options.appSettings,
        voice,
        model: 'qwen3-tts-flash',
        language: options.language,
        cacheKey: options.cacheKey,
        isPrivate: options.isPrivate,
        onStart: options.onStart,
        onReady: options.onReady,
        onEnd: options.onEnd,
        onError: (err) => {
          console.warn('[UnifiedVoiceRouter] Alibaba TTS playback error:', err);
          options.onError?.(err);
        },
      });
    }

    const rawVoice = options.voice || options.appSettings?.grok_voice_id || 'altair';
    const grokVoice = this.normalizeGrokVoice(rawVoice);

    return grokVoiceEngine.playSpeech(text, {
      voice: grokVoice,
      language: options.language,
      withTimestamps: options.withTimestamps !== false,
      cacheKey: options.cacheKey,
      isPrivate: options.isPrivate,
      onStart: options.onStart,
      onReady: options.onReady,
      onTimeUpdate: options.onTimeUpdate,
      onEnd: options.onEnd,
      onError: (err) => {
        console.warn('[UnifiedVoiceRouter] Grok TTS playback error:', err);
        options.onError?.(err);
      },
    });
  }

  /**
   * Normalizes any voice name to standard Grok / xAI voices
   */
  public normalizeGrokVoice(voiceName?: string): string {
    if (!voiceName) return 'altair';
    const lower = voiceName.toLowerCase().trim();
    const validGrokVoices = ['altair', 'nova', 'echo', 'shimmer', 'onyx', 'fable', 'alloy'];
    if (validGrokVoices.includes(lower)) {
      return lower;
    }
    // Female mappings -> 'nova' or 'shimmer'
    if (lower.includes('jennifer') || lower.includes('female') || lower.includes('emma') || lower.includes('sarah')) {
      return 'nova';
    }
    // Default Grok voice
    return 'altair';
  }

  /**
   * Pre-fetches speech payload using appropriate voice engine
   */
  public prefetchSpeech(
    text: string,
    options: UnifiedSpeechOptions = {}
  ): void {
    const provider = this.resolveProvider(options);
    if (provider === 'alibaba') {
      void alibabaVoiceEngine.fetchAlibabaSpeech(text, {
        appSettings: options.appSettings,
        voice: options.voice || 'Jennifer',
        cacheKey: options.cacheKey,
        isPrivate: options.isPrivate,
      });
    } else {
      void grokVoiceEngine.prefetchSpeech(text, options.cacheKey, {
        isPrivate: options.isPrivate,
      });
    }
  }

  /**
   * Fetches raw audio payload via appropriate voice engine
   */
  public async fetchSpeech(
    text: string,
    options: UnifiedSpeechOptions = {}
  ): Promise<GrokTtsResponsePayload | AlibabaAudioResponsePayload | null> {
    const provider = this.resolveProvider(options);
    if (provider === 'alibaba') {
      return await alibabaVoiceEngine.fetchAlibabaSpeech(text, {
        appSettings: options.appSettings,
        voice: options.voice || 'Jennifer',
        language: options.language,
        cacheKey: options.cacheKey,
        isPrivate: options.isPrivate,
      });
    }

    const grokVoice = this.normalizeGrokVoice(options.voice || options.appSettings?.grok_voice_id || 'altair');
    return await grokVoiceEngine.fetchGrokSpeech(text, {
      voice: grokVoice,
      language: options.language,
      withTimestamps: options.withTimestamps !== false,
      cacheKey: options.cacheKey,
      isPrivate: options.isPrivate,
    });
  }

  /**
   * Pre-seed both engine memory caches from device storage (IndexedDB lesson
   * packages) so playback of a prepared lesson makes zero network calls.
   * The raw cacheKey matches the `options.cacheKey` used at playback time.
   */
  public primeSpeechCache(cacheKey: string, payload: any, options: UnifiedSpeechOptions = {}): void {
    if (!cacheKey || !payload?.audio) return;
    const provider = this.resolveProvider(options);
    try {
      if (provider === 'alibaba') {
        alibabaVoiceEngine.primeMemoryCache(`avelut_alibaba_tts_${cacheKey}`, payload);
        grokVoiceEngine.primeMemoryCache(`avelut_grok_tts_${cacheKey}`, payload);
      } else {
        grokVoiceEngine.primeMemoryCache(`avelut_grok_tts_${cacheKey}`, payload);
        alibabaVoiceEngine.primeMemoryCache(`avelut_alibaba_tts_${cacheKey}`, payload);
      }
    } catch (e) {
      console.warn('[UnifiedVoiceRouter] primeSpeechCache error:', e);
    }
  }

  /**
   * Universal audio stop across all engines
   */
  public stopAudio(): void {
    grokVoiceEngine.stopAudio();
    alibabaVoiceEngine.stopAudio();
  }

  public stopAll(): void {
    this.stopAudio();
  }
}

export const unifiedVoiceRouter = new UnifiedVoiceRouter();
export const unifiedTts = unifiedVoiceRouter;
