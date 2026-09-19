import React, { useState, useEffect, useRef } from 'react';

export interface ThinkingTypingIndicatorProps {
  label?: string;
  className?: string;
  reasoningText?: string;
  defaultExpanded?: boolean;
  isStreaming?: boolean;
}

export const ThinkingTypingIndicator: React.FC<ThinkingTypingIndicatorProps> = ({
  label = 'thinking',
  className = '',
  reasoningText = '',
  defaultExpanded = true,
  isStreaming = true,
}) => {
  const [seconds, setSeconds] = useState(0);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    if (!isStreaming && seconds > 0) return;
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isStreaming, seconds]);

  // Auto-scroll the reasoning container to bottom as thoughts stream in
  useEffect(() => {
    if (isExpanded && scrollRef.current && !userScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reasoningText, isExpanded]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If the user scrolled more than 40px away from bottom, pause auto-scroll
    userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 40;
  };

  const timeDisplay = seconds === 1 ? '1 second' : `${seconds} seconds`;

  return (
    <div className={`flex flex-col text-slate-600 dark:text-slate-300 text-xs select-none max-w-full ${className}`}>
      {/* Header clickable row */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="inline-flex items-center gap-2 font-medium cursor-pointer hover:opacity-80 transition-opacity w-fit text-left focus:outline-hidden py-1"
        aria-expanded={isExpanded}
        title={isExpanded ? 'Collapse thought process' : 'Expand thought process'}
      >
        <div className="shrink-0 w-6 h-6 flex items-center justify-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <style>{`
              .thinking-dot {
                fill: #71717a;
                animation: thinking-shine 1.8s infinite linear;
              }
              .thinking-c0 { animation-delay: 0s; }
              .thinking-c1 { animation-delay: 0.2s; }
              .thinking-c2 { animation-delay: 0.4s; }

              @keyframes thinking-shine {
                0%, 100% {
                  fill: #71717a;
                  opacity: 0.35;
                }
                30%, 50% {
                  fill: #2563eb;
                  opacity: 1;
                }
              }
              .dark .thinking-dot {
                fill: #555555;
              }
              @keyframes thinking-shine-dark {
                0%, 100% {
                  fill: #555555;
                  opacity: 0.3;
                }
                30%, 50% {
                  fill: #ffffff;
                  opacity: 1;
                }
              }
              :is(.dark) .thinking-dot {
                animation-name: thinking-shine-dark;
              }
            `}</style>

            {/* Column 1 (Left) */}
            <circle className="thinking-dot thinking-c0" cx="6" cy="6" r="1.5" />
            <circle className="thinking-dot thinking-c0" cx="6" cy="12" r="1.5" />
            <circle className="thinking-dot thinking-c0" cx="6" cy="18" r="1.5" />

            {/* Column 2 (Middle) */}
            <circle className="thinking-dot thinking-c1" cx="12" cy="6" r="1.5" />
            <circle className="thinking-dot thinking-c1" cx="12" cy="12" r="1.5" />
            <circle className="thinking-dot thinking-c1" cx="12" cy="18" r="1.5" />

            {/* Column 3 (Right) */}
            <circle className="thinking-dot thinking-c2" cx="18" cy="6" r="1.5" />
            <circle className="thinking-dot thinking-c2" cx="18" cy="12" r="1.5" />
            <circle className="thinking-dot thinking-c2" cx="18" cy="18" r="1.5" />
          </svg>
        </div>

        <span className="font-medium text-slate-500 dark:text-slate-400 capitalize">
          {label}
        </span>

        {/* Chevron icon `>` that faces down when expanded */}
        <svg
          className={`w-3 h-3 text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0 ${
            isExpanded ? 'rotate-90' : 'rotate-0'
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        <span className="text-slate-400 dark:text-slate-500 text-[11px] font-normal ml-0.5">
          for {timeDisplay}
        </span>
      </button>

      {/* Collapsible Thoughts Container */}
      {isExpanded && (
        <div className="mt-1.5 mb-2 w-full max-w-full">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="text-xs leading-relaxed font-sans bg-[#F8FAFC] dark:bg-[#18181B] text-slate-600 dark:text-slate-300 p-3 sm:p-3.5 rounded-xl border border-slate-200/80 dark:border-zinc-800 max-h-52 overflow-y-auto whitespace-pre-wrap break-words select-text shadow-2xs"
          >
            {reasoningText ? (
              reasoningText
            ) : (
              <span className="italic text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                Reading context and formulating thoughts...
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ThinkingTypingIndicator;
