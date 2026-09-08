import React from 'react';

export const TypingIndicator: React.FC = () => {
  return (
    <div className="flex items-center gap-1.5 px-4 py-3 bg-white dark:bg-[#0A0A0A] border border-gray-200 dark:border-transparent rounded-2xl rounded-bl-none w-fit shadow-sm max-w-lg">
      <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-[typing_1.5s_infinite]" style={{ animationDelay: '0ms' }} />
      <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-[typing_1.5s_infinite]" style={{ animationDelay: '200ms' }} />
      <div className="w-2 h-2 bg-gray-400 dark:bg-gray-500 rounded-full animate-[typing_1.5s_infinite]" style={{ animationDelay: '400ms' }} />
    </div>
  );
};
