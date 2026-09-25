import React from 'react';
import { useOTAUpdater } from '../hooks/useOTAUpdater';

export const AppUpdateBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
    const { updateStatus, newVersion, downloadProgress, restartToUpdate } = useOTAUpdater();

    if (updateStatus === 'idle') {
        return null;
    }

    if (updateStatus === 'downloading' || updateStatus === 'checking') {
        return (
            <div
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 dark:bg-blue-400/15 border border-[#0066FF]/30 dark:border-blue-400/40 text-[#0066FF] dark:text-blue-400 text-xs font-bold shadow-xs animate-fade-in backdrop-blur-md select-none ${className}`}
                title={`Installing OTA update from Supabase (${newVersion || ''})...`}
            >
                <div className="relative flex items-center justify-center w-3.5 h-3.5 shrink-0">
                    <span className="w-3.5 h-3.5 border-2 border-[#0066FF]/30 border-t-[#0066FF] dark:border-blue-400/30 dark:border-t-blue-400 rounded-full animate-spin" />
                </div>
                <span className="truncate max-w-[210px] sm:max-w-xs font-semibold">
                    {downloadProgress > 0 && downloadProgress < 100
                        ? `Installing Update (${downloadProgress}%)`
                        : 'Installing Update...'}
                </span>
            </div>
        );
    }

    if (updateStatus === 'ready') {
        return (
            <button
                type="button"
                onClick={restartToUpdate}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0066FF] hover:bg-[#0052cc] active:scale-95 text-white text-xs font-bold shadow-md shadow-blue-500/25 cursor-pointer animate-pulse transition-all backdrop-blur-md select-none ${className}`}
                title="Supabase OTA update ready! Tap to apply and restart."
            >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping shrink-0" />
                <span>Update Ready • Restart</span>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            </button>
        );
    }

    return null;
};

export default AppUpdateBadge;
