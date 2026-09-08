import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface LecturerAskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmitQuestion: (question: string, imageDataUrl?: string | null) => void;
  isProcessing: boolean;
  topicTitle: string;
}

/**
 * Voice-first ask modal:
 * - Animated wave driven by speech activity
 * - Continuous recognition until user taps Done (no auto-cut)
 * - Camera / upload on the right
 * - No suggestion chips
 */
export const LecturerAskModal: React.FC<LecturerAskModalProps> = ({
  isOpen,
  onClose,
  onSubmitQuestion,
  isProcessing,
  topicTitle,
}) => {
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [level, setLevel] = useState(0.2); // 0..1 for wave amplitude
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const animRef = useRef<number | null>(null);
  const levelTarget = useRef(0.2);

  const stopRecognition = useCallback(() => {
    try {
      recognitionRef.current?.stop?.();
    } catch (_) {}
    recognitionRef.current = null;
    setIsListening(false);
    levelTarget.current = 0.15;
  }, []);

  const startRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setTranscript((t) => t || 'Voice not supported on this browser — type below.');
      return;
    }

    try {
      const rec = new SpeechRecognition();
      // continuous + interim so we never auto-submit mid-sentence
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      let finalText = '';

      rec.onstart = () => {
        setIsListening(true);
        levelTarget.current = 0.45;
      };

      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText = `${finalText} ${piece}`.trim();
          } else {
            interim += piece;
          }
        }
        const combined = `${finalText} ${interim}`.trim();
        setTranscript(combined);
        // bump wave when we receive speech
        levelTarget.current = Math.min(1, 0.35 + Math.min(0.65, combined.length / 80));
      };

      rec.onerror = () => {
        // stay open; user can retry or type
        setIsListening(false);
        levelTarget.current = 0.15;
      };

      // Do NOT auto-submit on end — restart if user still wants continuous listen
      rec.onend = () => {
        // If modal still open and we intended to listen, restart (browser stops after silence)
        if (recognitionRef.current === rec && isOpen && !isProcessing) {
          try {
            rec.start();
            setIsListening(true);
          } catch {
            setIsListening(false);
          }
        } else {
          setIsListening(false);
        }
      };

      recognitionRef.current = rec;
      rec.start();
    } catch {
      setIsListening(false);
    }
  }, [isOpen, isProcessing]);

  // Open → pause already handled by parent; auto-start listening
  useEffect(() => {
    if (!isOpen) {
      stopRecognition();
      setTranscript('');
      setImagePreview(null);
      return;
    }
    startRecognition();
    return () => stopRecognition();
  }, [isOpen, startRecognition, stopRecognition]);

  // Smooth wave animation loop
  useEffect(() => {
    if (!isOpen) return;
    let t0 = performance.now();
    const tick = (now: number) => {
      const dt = (now - t0) / 1000;
      t0 = now;
      setLevel((prev) => {
        const target = levelTarget.current;
        const next = prev + (target - prev) * Math.min(1, dt * 6);
        // idle shimmer
        const shimmer = isListening ? 0.08 * Math.sin(now / 180) : 0;
        return Math.max(0.08, Math.min(1, next + shimmer));
      });
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [isOpen, isListening]);

  const handleDone = () => {
    stopRecognition();
    const q = transcript.trim();
    if (!q && !imagePreview) return;
    onSubmitQuestion(q || 'Please look at this image and explain.', imagePreview);
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setImagePreview(reader.result);
    };
    reader.readAsDataURL(file);
  };

  if (!isOpen) return null;

  const bars = Array.from({ length: 24 }, (_, i) => {
    const phase = Math.sin(i * 0.55 + level * 8);
    const h = 8 + level * 36 * (0.45 + 0.55 * Math.abs(phase));
    return h;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-md">
      <div className="w-full max-w-md rounded-3xl bg-[#0B1220] border border-[#222222] p-5 shadow-2xl text-white">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-bold text-white">Ask while lesson is paused</p>
            <p className="text-[11px] text-slate-400 truncate max-w-[220px]">{topicTitle}</p>
          </div>
          <button
            onClick={() => {
              stopRecognition();
              onClose();
            }}
            type="button"
            className="w-8 h-8 rounded-full bg-[#222222] flex items-center justify-center text-slate-400 hover:text-white"
          >
            <i className="bi bi-x-lg text-sm"></i>
          </button>
        </div>

        {/* Wave visualizer */}
        <div className="relative h-28 rounded-2xl bg-[#0F172A] border border-[#222222] flex items-center justify-center gap-[3px] overflow-hidden mb-3">
          {bars.map((h, i) => (
            <span
              key={i}
              className="w-1.5 rounded-full bg-gradient-to-t from-[#0066FF] to-[#38BDF8] transition-[height] duration-75"
              style={{ height: `${h}px`, opacity: isListening ? 1 : 0.45 }}
            />
          ))}
          <div className="absolute bottom-2 left-0 right-0 text-center text-[10px] font-semibold tracking-wide text-slate-400">
            {isListening ? 'Listening… tap Done when finished' : 'Tap mic to speak'}
          </div>
        </div>

        {/* Live transcript */}
        <div className="min-h-[52px] max-h-24 overflow-y-auto rounded-xl bg-[#111111] border border-[#222222] px-3 py-2 mb-3 text-xs text-slate-200">
          {transcript || <span className="text-slate-500">Your question will appear here…</span>}
        </div>

        {imagePreview && (
          <div className="relative mb-3 rounded-xl overflow-hidden border border-[#334155]">
            <img src={imagePreview} alt="Attached" className="w-full max-h-28 object-cover" />
            <button
              type="button"
              onClick={() => setImagePreview(null)}
              className="absolute top-1 right-1 w-7 h-7 rounded-full bg-black/60 text-white text-xs"
            >
              <i className="bi bi-x"></i>
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (isListening) stopRecognition();
              else startRecognition();
            }}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${
              isListening
                ? 'bg-rose-500/90 border-rose-300 text-white animate-pulse'
                : 'bg-[#222222] border-[#334155] text-[#38BDF8]'
            }`}
            title={isListening ? 'Stop listening' : 'Start listening'}
          >
            <i className={`bi ${isListening ? 'bi-mic-fill' : 'bi-mic'} text-lg`}></i>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-12 h-12 rounded-2xl bg-[#222222] border border-[#334155] flex items-center justify-center text-[#FACC15]"
            title="Snap or upload"
          >
            <i className="bi bi-camera text-lg"></i>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />

          <button
            type="button"
            onClick={handleDone}
            disabled={isProcessing || (!transcript.trim() && !imagePreview)}
            className="flex-1 h-12 rounded-2xl bg-[#0066FF] hover:bg-blue-600 disabled:opacity-40 text-white font-bold text-sm"
          >
            {isProcessing ? 'Answering…' : 'Done — ask'}
          </button>
        </div>
      </div>
    </div>
  );
};
