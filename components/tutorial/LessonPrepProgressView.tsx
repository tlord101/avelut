import React, { useState, useEffect } from 'react';
import type { LessonPrepStatus } from '../../services/lessonPrepService';

export interface LessonPrepProgressViewProps {
  status: LessonPrepStatus;
  topicTitle: string;
  courseName?: string;
  durationMinutes: number;
  onOpenLesson: () => void;
  onCancelJob: () => void;
  onLeaveBackground: () => void;
  onRetry: () => void;
}

const PATIENCE_PHRASES = [
  "Building your lesson board by board…",
  "Drawing mathematical diagrams & visuals…",
  "Writing clear, step-by-step explanations…",
  "Synthesizing voice narration for this board…",
  "Almost there — you can leave and we'll notify you.",
  "This usually takes 2–4 minutes. Feel free to explore other courses.",
  "We're preparing every board so playback is instant when you're ready.",
];

export const LessonPrepProgressView: React.FC<LessonPrepProgressViewProps> = ({
  status,
  topicTitle,
  courseName,
  durationMinutes,
  onOpenLesson,
  onCancelJob,
  onLeaveBackground,
  onRetry,
}) => {
  const [phraseIdx, setPhraseIdx] = useState(0);

  const isPreparingOrIdle = status.state === 'preparing' || status.state === 'idle';

  useEffect(() => {
    if (!isPreparingOrIdle) return;
    const timer = setInterval(() => {
      setPhraseIdx((prev) => (prev + 1) % PATIENCE_PHRASES.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [isPreparingOrIdle]);

  const progressPercent = typeof status.progressPercent === 'number'
    ? status.progressPercent
    : status.step === 3
      ? 85
      : status.step === 2
        ? 50
        : status.step === 1
          ? 20
          : 10;

  const currentPhrase = PATIENCE_PHRASES[phraseIdx];

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0A0A0A] text-[#FAFAFA] min-h-screen p-4 sm:p-6 select-none">
      <div className="bg-[#141414] border border-[#2A2A2A] rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6 text-center animate-fade-in">
        {/* Header Badges */}
        <div className="flex items-center justify-between text-xs font-bold text-[#A3A3A3]">
          <span className="px-3 py-1 rounded-full bg-[#1C1C1C] border border-[#2A2A2A] uppercase tracking-wider text-blue-400">
            {courseName || 'Live Tutorial'}
          </span>
          <span className="px-3 py-1 rounded-full bg-[#1C1C1C] border border-[#2A2A2A]">
            {durationMinutes} Min Lecture
          </span>
        </div>

        {/* Title & Subtitle */}
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-white leading-tight">{topicTitle}</h1>
          <p className="text-xs sm:text-sm text-[#A3A3A3] mt-2">
            {status.state === 'ready'
              ? 'Your entire lesson package is ready on device!'
              : status.state === 'failed'
                ? 'Lesson preparation encountered an issue.'
                : status.state === 'paused_offline'
                  ? 'Lesson preparation paused while offline.'
                  : 'Preparing your interactive whiteboard lecture in the background.'}
          </p>
        </div>

        {/* Progress Bar Container for preparing or idle */}
        {isPreparingOrIdle && (
          <div className="space-y-4 py-2">
            {/* Percentage & Board Counter */}
            <div className="flex items-center justify-between text-xs font-mono font-bold">
              <span className="text-blue-400 font-semibold">{Math.max(5, Math.min(100, progressPercent))}%</span>
              <span className="text-[#A3A3A3]">
                {status.boardIndex && status.totalBoards
                  ? `Board ${status.boardIndex} of ${status.totalBoards}`
                  : status.message?.includes('Board')
                    ? status.message
                    : 'Planning lesson structure…'}
              </span>
            </div>

            {/* Bar */}
            <div className="w-full bg-[#1C1C1C] h-3 rounded-full overflow-hidden border border-[#2A2A2A] p-0.5">
              <div
                className="bg-[#2563EB] h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(6, Math.min(100, progressPercent))}%` }}
              />
            </div>

            {/* Live Message & Rotating Patience Phrase */}
            <div className="bg-[#1C1C1C] border border-[#2A2A2A] rounded-2xl p-4 text-left space-y-2">
              <div className="flex items-center gap-2.5 text-xs font-bold text-white">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping shrink-0" />
                <span className="truncate">{status.message || 'Preparing boards & lecturer narration…'}</span>
              </div>
              <p className="text-xs text-[#A3A3A3] italic transition-opacity duration-300">
                "{currentPhrase}"
              </p>
            </div>

            {/* Explicit Background Notification Notice */}
            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300 font-semibold flex items-center justify-center gap-2">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span>You can leave this screen. We'll notify you when this lesson is ready.</span>
            </div>
          </div>
        )}

        {/* READY State */}
        {status.state === 'ready' && (
          <div className="py-4 space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-emerald-400 font-bold">Playback is instant — zero network delay!</p>
            <button
              onClick={onOpenLesson}
              className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-lg transition active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              </svg>
              Open Lesson Now
            </button>
          </div>
        )}

        {/* PAUSED OFFLINE State */}
        {status.state === 'paused_offline' && (
          <div className="py-4 space-y-4">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs text-left space-y-1">
              <p className="font-bold flex items-center gap-2">
                <i className="bi bi-wifi-off text-base text-amber-400"></i>
                <span>Paused Offline</span>
              </p>
              <p>Your saved boards are safely stored on device. Reconnect to the internet and tap Resume.</p>
            </div>
            <button
              onClick={onRetry}
              className="w-full py-3.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white font-bold text-sm shadow transition cursor-pointer"
            >
              Resume Preparation
            </button>
          </div>
        )}

        {/* FAILED State */}
        {status.state === 'failed' && (
          <div className="py-4 space-y-4">
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs text-left">
              <p className="font-bold mb-1">Preparation Notice:</p>
              <p>{status.error || 'Connection interrupted or server busy. Tap below to retry.'}</p>
            </div>
            <button
              onClick={onRetry}
              className="w-full py-3.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-white font-bold text-sm shadow transition cursor-pointer"
            >
              Retry Preparation
            </button>
          </div>
        )}

        {/* Actions Footer */}
        <div className="pt-4 border-t border-[#1C1C1C] flex items-center justify-between gap-3">
          {isPreparingOrIdle && (
            <>
              <button
                onClick={onCancelJob}
                className="px-4 py-2.5 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-xs font-semibold text-neutral-400 hover:text-white transition cursor-pointer"
              >
                Cancel Job
              </button>
              <button
                onClick={onLeaveBackground}
                className="px-5 py-2.5 rounded-xl bg-[#2563EB] hover:bg-blue-600 text-xs font-bold text-white shadow transition cursor-pointer"
              >
                Continue in Background
              </button>
            </>
          )}

          {(status.state === 'ready' || status.state === 'failed' || status.state === 'paused_offline') && (
            <button
              onClick={onLeaveBackground}
              className="w-full py-2.5 rounded-xl bg-[#1C1C1C] border border-[#2A2A2A] text-xs font-bold text-[#A3A3A3] hover:text-white transition cursor-pointer"
            >
              Back to App
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default LessonPrepProgressView;
