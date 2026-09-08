import React, { useState, useRef, useEffect } from 'react';
import { unifiedVoiceRouter, UnifiedAudioPlayer } from '../../services/voice/UnifiedVoiceRouter';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../hooks/useToast';

export interface VoiceOption {
  id: 'Aiden' | 'Jennifer' | 'Kai' | 'Andre';
  name: string;
  gender: 'Male' | 'Female';
  persona: string;
  sampleText: string;
  tag: string;
}

export const TUTORIAL_VOICES: VoiceOption[] = [
  {
    id: 'Jennifer',
    name: 'Jennifer',
    gender: 'Female',
    persona: 'Warm, expressive, and encouraging university lecturer.',
    sampleText: "Hello! I will be your live lecturer today. Let's break down this topic step-by-step on the whiteboard.",
    tag: 'Recommended',
  },
  {
    id: 'Aiden',
    name: 'Aiden',
    gender: 'Male',
    persona: 'Clear, articulate, and energetic academic instructor.',
    sampleText: "Welcome to this session! We'll explore core principles and work through practical examples together.",
    tag: 'Energetic',
  },
  {
    id: 'Kai',
    name: 'Kai',
    gender: 'Male',
    persona: 'Calm, patient, and modern conceptual tutor.',
    sampleText: "Hi there! Take your time as we visualize this concept together. Feel free to ask questions anytime.",
    tag: 'Calm & Patient',
  },
  {
    id: 'Andre',
    name: 'Andre',
    gender: 'Male',
    persona: 'Deep, authoritative, and structured professor.',
    sampleText: "Greetings. Today we examine the foundational mechanics and analytical frameworks of our subject.",
    tag: 'Authoritative',
  },
];

export interface LiveTutorialVoiceSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVoiceAndStart: (selectedVoice: string) => void;
  topicTitle?: string;
  initialVoice?: string;
}

export const LiveTutorialVoiceSelectorModal: React.FC<LiveTutorialVoiceSelectorModalProps> = ({
  isOpen,
  onClose,
  onSelectVoiceAndStart,
  topicTitle = 'Live Tutorial',
  initialVoice = 'Jennifer',
}) => {
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();

  const [selectedVoice, setSelectedVoice] = useState<string>(initialVoice);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const activeAudioElRef = useRef<HTMLAudioElement | null>(null);
  const activePlayerRef = useRef<UnifiedAudioPlayer | null>(null);

  useEffect(() => {
    return () => {
      if (activeAudioElRef.current) {
        try {
          activeAudioElRef.current.pause();
        } catch (_) {}
      }
      if (activePlayerRef.current) {
        try {
          activePlayerRef.current.stop();
        } catch (_) {}
      }
    };
  }, []);

  if (!isOpen) return null;

  const handlePreviewVoice = (voiceOption: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation();

    // If already playing this voice, stop it
    if (playingVoiceId === voiceOption.id) {
      if (activeAudioElRef.current) {
        try {
          activeAudioElRef.current.pause();
        } catch (_) {}
        activeAudioElRef.current = null;
      }
      if (activePlayerRef.current) {
        try {
          activePlayerRef.current.stop();
        } catch (_) {}
        activePlayerRef.current = null;
      }
      setPlayingVoiceId(null);
      return;
    }

    // Stop current audio if playing
    if (activeAudioElRef.current) {
      try {
        activeAudioElRef.current.pause();
      } catch (_) {}
      activeAudioElRef.current = null;
    }
    if (activePlayerRef.current) {
      try {
        activePlayerRef.current.stop();
      } catch (_) {}
      activePlayerRef.current = null;
    }

    setPlayingVoiceId(voiceOption.id);

    // 1. Try playing the pre-generated static audio asset from storage
    const staticAudioUrl = `/assets/voices/${voiceOption.id.toLowerCase()}.mp3`;
    const audio = new Audio(staticAudioUrl);

    audio.onended = () => {
      setPlayingVoiceId(null);
      activeAudioElRef.current = null;
    };

    audio.onerror = () => {
      // Fallback: Synthesize via UnifiedVoiceRouter if static file is unavailable
      try {
        const player = unifiedVoiceRouter.playSpeech(voiceOption.sampleText, {
          appSettings,
          provider: 'alibaba',
          voice: voiceOption.id,
          speed: 1.0,
          onEnd: () => {
            setPlayingVoiceId(null);
            activePlayerRef.current = null;
          },
          onError: (err) => {
            console.warn('[VoiceSelector] Preview error:', err);
            setPlayingVoiceId(null);
            activePlayerRef.current = null;
            addToast('Could not play preview. Please check connection.', 'info');
          },
        });
        activePlayerRef.current = player;
      } catch (err) {
        setPlayingVoiceId(null);
      }
    };

    audio.play().then(() => {
      activeAudioElRef.current = audio;
    }).catch(() => {
      // Browser autoplay policy or error -> trigger fallback
      audio.onerror?.(new Event('error') as any);
    });
  };

  const handleConfirmStart = () => {
    if (activeAudioElRef.current) {
      try {
        activeAudioElRef.current.pause();
      } catch (_) {}
    }
    if (activePlayerRef.current) {
      try {
        activePlayerRef.current.stop();
      } catch (_) {}
    }
    onSelectVoiceAndStart(selectedVoice);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#FFFFFF] border border-[#E3E9F1] rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col text-[#0F172A]"
      >
        {/* Modal Header */}
        <div className="p-6 bg-[#F6F6F3] border-b border-[#E3E9F1] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-[#0066FF] text-white flex items-center justify-center shadow-md">
              <i className="bi bi-mic-fill text-lg"></i>
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F172A]">Choose Instructor Voice</h2>
              <p className="text-xs text-[#64748B]">Powered by Qwen3-TTS-Flash engine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#FFFFFF] border border-[#E3E9F1] flex items-center justify-center text-[#64748B] hover:text-[#0F172A] hover:bg-[#F1F5F9] transition-colors"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        {/* Topic & Pricing Ribbon */}
        <div className="px-6 py-3 bg-[#FFFFFF] border-b border-[#E3E9F1] flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <span className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider block">Topic</span>
            <span className="text-xs font-bold text-[#002D62] truncate block max-w-[240px] sm:max-w-xs">
              {topicTitle}
            </span>
          </div>
          <div className="flex items-center space-x-1.5 bg-[#F1F5F9] border border-[#E3E9F1] px-3 py-1 rounded-full">
            <i className="bi bi-lightning-charge-fill text-[#0066FF] text-xs"></i>
            <span className="text-xs font-bold text-[#0F172A]">150 Credits</span>
            <span className="text-[10px] text-[#64748B]">(₦150)</span>
          </div>
        </div>

        {/* Voice List */}
        <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
          {TUTORIAL_VOICES.map((voice) => {
            const isSelected = selectedVoice === voice.id;
            const isPlaying = playingVoiceId === voice.id;

            return (
              <div
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? 'border-[#0066FF] bg-blue-50/40 shadow-sm'
                    : 'border-[#E3E9F1] bg-[#FFFFFF] hover:border-[#0066FF]/40 hover:bg-[#F6F6F3]'
                }`}
              >
                <div className="flex items-center space-x-3.5 min-w-0 flex-1 pr-3">
                  {/* Voice Avatar Icon */}
                  <div
                    className={`w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-[#0066FF] text-white'
                        : 'bg-[#F1F5F9] text-[#002D62] border border-[#E3E9F1]'
                    }`}
                  >
                    {voice.name[0]}
                  </div>

                  {/* Voice Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-bold text-[#0F172A]">{voice.name}</span>
                      <span className="text-[10px] font-semibold text-[#64748B] bg-[#F1F5F9] px-2 py-0.5 rounded-md">
                        {voice.gender}
                      </span>
                      {voice.tag === 'Recommended' && (
                        <span className="text-[10px] font-bold text-[#0066FF] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#64748B] line-clamp-1 mt-0.5">{voice.persona}</p>
                  </div>
                </div>

                {/* Right Actions: Play Preview & Radio Check */}
                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={(e) => handlePreviewVoice(voice, e)}
                    type="button"
                    title={isPlaying ? 'Pause sample' : 'Listen to preview'}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold transition-all ${
                      isPlaying
                        ? 'bg-[#0066FF] text-white animate-pulse shadow-md'
                        : 'bg-[#F1F5F9] hover:bg-[#E3E9F1] text-[#0066FF] border border-[#E3E9F1]'
                    }`}
                  >
                    <i className={`bi ${isPlaying ? 'bi-pause-fill text-lg' : 'bi-play-fill text-lg'}`}></i>
                  </button>

                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'border-[#0066FF] bg-[#0066FF] text-white'
                        : 'border-[#CBD5E1] bg-white'
                    }`}
                  >
                    {isSelected && <i className="bi bi-check text-sm font-bold"></i>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="p-6 bg-[#F6F6F3] border-t border-[#E3E9F1] flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-[#E3E9F1] bg-[#FFFFFF] hover:bg-[#F1F5F9] text-xs font-bold text-[#64748B] transition-colors"
          >
            Cancel
          </button>

          <button
            onClick={handleConfirmStart}
            className="px-6 py-2.5 rounded-xl bg-[#0066FF] hover:bg-[#0052cc] text-white text-xs font-bold flex items-center space-x-2 transition-transform active:scale-95 shadow-md"
          >
            <span>Start Live Tutorial</span>
            <i className="bi bi-arrow-right"></i>
          </button>
        </div>
      </div>
    </div>
  );
};
