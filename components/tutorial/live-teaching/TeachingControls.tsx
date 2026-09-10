import React from 'react';

export interface TeachingControlsProps {
  isSpeaking: boolean;
  isLoadingSegment: boolean;
  isAskingActive: boolean;
  onReplayAudio: () => void;
  onOpenAskModal: () => void;
  onNextSegment: () => void;
  isLastSegment: boolean;
}

/**
 * Minimal Bottom Floating Control Bar (approx 2.5% of screen height).
 * Leaves 95% of vertical space open for the active teaching board.
 */
export const TeachingControls: React.FC<TeachingControlsProps> = ({
  isSpeaking,
  isLoadingSegment,
  isAskingActive,
  onReplayAudio,
  onOpenAskModal,
  onNextSegment,
  isLastSegment,
}) => {
  return (
    <footer className="h-14 sm:h-16 px-4 sm:px-8 bg-[#000000] border-t border-[#222222] flex items-center justify-between shrink-0 z-30 select-none">
      {/* Left: Quick Audio Replay */}
      <button
        onClick={onReplayAudio}
        type="button"
        disabled={isLoadingSegment}
        className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-full bg-[#111111] hover:bg-[#1A1A1A] border border-[#222222] text-slate-300 hover:text-white text-xs font-semibold transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
        title="Replay Lecturer Explanation"
      >
        <i className="bi bi-arrow-counterclockwise text-sm text-[#38BDF8]"></i>
        <span className="hidden xs:inline">Replay</span>
      </button>

      {/* Center: "Ask the Lecturer" Interruption Button + Waveform */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenAskModal}
          type="button"
          className="flex items-center gap-2 px-4 sm:px-5 py-2 rounded-full bg-gradient-to-r from-[#0066FF] to-[#002D62] hover:brightness-110 text-white text-xs sm:text-sm font-bold shadow-lg border border-brand-400/30 transition-all active:scale-95 cursor-pointer"
          title="Interrupt to ask the lecturer a question"
        >
          <i className="bi bi-mic-fill text-yellow-300 text-xs sm:text-sm animate-pulse"></i>
          <span>Ask Tutor</span>
        </button>

        {/* Live Audio Waveform Animation Bars */}
        {isSpeaking && (
          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#111111] border border-[#222222]">
            <span className="w-1 h-3 bg-[#38BDF8] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
            <span className="w-1 h-5 bg-[#60A5FA] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
            <span className="w-1 h-4 bg-[#34D399] rounded-full animate-bounce [animation-delay:-0.45s]"></span>
            <span className="w-1 h-2 bg-[#FACC15] rounded-full animate-bounce [animation-delay:-0.2s]"></span>
          </div>
        )}
      </div>

      {/* Right: Continue / Next Concept Button */}
      <button
        onClick={onNextSegment}
        disabled={isLoadingSegment}
        type="button"
        className="flex items-center gap-2 px-4 sm:px-6 py-2 rounded-full bg-[#34D399] hover:bg-[#10B981] text-[#0A0F1D] text-xs sm:text-sm font-black shadow-md transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
      >
        <span>{isLastSegment ? 'Complete' : 'Continue'}</span>
        <i className="bi bi-arrow-right font-bold text-sm"></i>
      </button>
    </footer>
  );
};
