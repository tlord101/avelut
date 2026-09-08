import React from 'react';

/**
 * Playground — CBT / past questions (coming soon placeholder).
 */
export const Playground: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] bg-transparent dark:bg-[#000000] px-6 text-center text-slate-900 dark:text-slate-100">
      <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-slate-800/80 border border-neutral-200/80 dark:border-slate-800 flex items-center justify-center mb-5">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="w-7 h-7 text-black dark:text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342"
          />
        </svg>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Playground</h1>
      <p className="mt-2 text-sm text-neutral-500 dark:text-slate-400 max-w-sm font-medium">
        Coming soon — generate CBT tests and practice past questions.
      </p>
    </div>
  );
};

export default Playground;
