import React from 'react';

export interface LiveTranscriptSubtitlesProps {
  speechText: string;
  isSpeaking: boolean;
  objective?: string;
}

/**
 * Subtle live transcript subtitle banner rendered near the lower portion of the board.
 * Minimalist, high readability, does not compete with the whiteboard hero.
 */
export const LiveTranscriptSubtitles: React.FC<LiveTranscriptSubtitlesProps> = ({
  speechText,
  isSpeaking,
  objective,
}) => {
  if (!speechText) return null;

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-11/12 max-w-2xl pointer-events-none z-20 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-[#000000]/85 backdrop-blur-md border border-[#222222]/90 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-3">
        <div className="w-2.5 h-2.5 rounded-full bg-[#38BDF8] shrink-0 animate-ping" />
        <div className="min-w-0 flex-1">
          {objective && (
            <span className="block text-[10px] font-bold uppercase tracking-wider text-[#38BDF8] opacity-80 mb-0.5">
              {objective}
            </span>
          )}
          <p className="text-xs sm:text-sm text-slate-100 font-medium leading-relaxed tracking-wide line-clamp-2">
            "{speechText}"
          </p>
        </div>
      </div>
    </div>
  );
};
