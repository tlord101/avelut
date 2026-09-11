import React, { useState, useEffect } from 'react';

export interface ThinkingTypingIndicatorProps {
  label?: string;
  className?: string;
}

export const ThinkingTypingIndicator: React.FC<ThinkingTypingIndicatorProps> = ({
  label = 'thinking',
  className = '',
}) => {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const timeDisplay = seconds === 1 ? '1 second' : `${seconds} seconds`;

  return (
    <div className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-[#141414] border border-[#E3E9F1] dark:border-[#2A2A2A] shadow-2xs w-fit text-slate-600 dark:text-slate-300 text-xs font-medium select-none ${className}`}>
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
      <span className="font-medium text-slate-500 dark:text-slate-400">
        {label} for {timeDisplay}
      </span>
    </div>
  );
};

export default ThinkingTypingIndicator;
