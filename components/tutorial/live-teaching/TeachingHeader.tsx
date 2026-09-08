import React from 'react';

export interface TeachingHeaderProps {
  topicTitle: string;
  courseName?: string;
  segmentNumber: number;
  totalSegments: number;
  isSpeaking: boolean;
  currentVoice: string;
  onOpenVoiceSelector?: () => void;
  onClose?: () => void;
}

/**
 * Minimal Top Navigation Bar (approx 2.5% of screen height).
 * Strips out clutter, keeps topic, live state, and subtle progress.
 */
export const TeachingHeader: React.FC<TeachingHeaderProps> = ({
  topicTitle,
  segmentNumber,
  totalSegments,
  isSpeaking,
  currentVoice,
  onOpenVoiceSelector,
  onClose,
}) => {
  return (
    <header className="h-12 sm:h-14 px-3 sm:px-6 bg-[#000000] border-b border-[#222222] flex items-center justify-between shrink-0 z-30 select-none">
      {/* Left: Minimal Back Button */}
      <div className="flex items-center gap-2.5 min-w-0">
        <button
          onClick={onClose}
          type="button"
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#111111] hover:bg-[#1A1A1A] border border-[#222222] flex items-center justify-center text-slate-300 hover:text-white transition-all active:scale-95 cursor-pointer shrink-0"
          title="Exit Classroom"
          aria-label="Exit Classroom"
        >
          <i className="bi bi-arrow-left text-sm sm:text-base"></i>
        </button>

        {/* Topic Title */}
        <div className="min-w-0 flex items-center gap-2">
          <h1 className="text-xs sm:text-sm font-bold text-white tracking-tight truncate max-w-[150px] xs:max-w-[200px] sm:max-w-md md:max-w-xl">
            {topicTitle}
          </h1>
        </div>
      </div>

      {/* Right: Subtle Progress, Live Indicator, Voice Selector */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* Step Indicator (e.g. 02 / 05) */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] border border-[#222222] text-[10px] sm:text-xs font-mono text-slate-300">
          <span className="text-[#38BDF8] font-bold">{String(segmentNumber).padStart(2, '0')}</span>
          <span className="text-slate-500">/</span>
          <span className="text-slate-400">{String(totalSegments).padStart(2, '0')}</span>
        </div>

        {/* Voice Selector Pill */}
        {onOpenVoiceSelector && (
          <button
            onClick={onOpenVoiceSelector}
            type="button"
            className="hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] hover:bg-[#1A1A1A] border border-[#222222] text-[11px] font-bold text-[#60A5FA] transition-colors cursor-pointer"
            title={`Lecturer: ${currentVoice} (Click to change)`}
          >
            <i className="bi bi-person-voice text-xs"></i>
            <span className="hidden sm:inline">{currentVoice}</span>
            <i className="bi bi-chevron-down text-[9px] opacity-70"></i>
          </button>
        )}

        {/* Live Audio / Speaking Indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#111111] border border-[#222222]">
          <span
            className={`w-2 h-2 rounded-full transition-all ${
              isSpeaking ? 'bg-[#34D399] animate-pulse' : 'bg-slate-500'
            }`}
          />
          <span className="text-[10px] sm:text-xs font-bold text-slate-200 tracking-wider">
            {isSpeaking ? 'LIVE' : 'READY'}
          </span>
        </div>
      </div>
    </header>
  );
};
