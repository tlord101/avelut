/**
 * Skeleton.tsx — Reusable skeleton loading primitives for the entire AVELUT app.
 *
 * Usage:
 *   <Skeleton className="w-32 h-4" />          — single shimmer bar
 *   <SkeletonAvatar size={40} />               — circular avatar skeleton
 *   <DashboardSkeleton />                      — full Dashboard page skeleton
 *   <LeaderboardSkeleton />                    — full Leaderboard skeleton
 *   … etc.
 */
import React from 'react';

// ---------------------------------------------------------------------------
// Base primitive — a single shimmer rectangle
// ---------------------------------------------------------------------------
interface SkeletonProps {
    className?: string;
    rounded?: string;
    style?: React.CSSProperties;
}

export const Skeleton: React.FC<SkeletonProps> = ({
    className = '',
    rounded = 'rounded-xl',
    style,
}) => (
    <div
        className={`bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:400%_100%] animate-[shimmer_1.4s_ease-in-out_infinite] ${rounded} ${className}`}
        style={style}
    />
);

// Inject the shimmer keyframe once (idempotent)
if (typeof document !== 'undefined' && !document.getElementById('sk-keyframe')) {
    const style = document.createElement('style');
    style.id = 'sk-keyframe';
    style.textContent = `
        @keyframes shimmer {
            0%   { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Circular avatar skeleton
// ---------------------------------------------------------------------------
export const SkeletonAvatar: React.FC<{ size?: number; className?: string }> = ({
    size = 40,
    className = '',
}) => (
    <Skeleton
        rounded="rounded-full"
        className={className}
        style={{ width: size, height: size, flexShrink: 0 }}
    />
);

// ---------------------------------------------------------------------------
// SkeletonText — one or more lines of text
// ---------------------------------------------------------------------------
export const SkeletonText: React.FC<{
    lines?: number;
    className?: string;
    lastLineWidth?: string;
}> = ({ lines = 1, className = '', lastLineWidth = 'w-3/4' }) => (
    <div className={`space-y-2 ${className}`}>
        {Array.from({ length: lines }).map((_, i) => (
            <Skeleton
                key={i}
                className={`h-3.5 ${i === lines - 1 && lines > 1 ? lastLineWidth : 'w-full'}`}
            />
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// DASHBOARD skeleton
// ---------------------------------------------------------------------------
export const DashboardSkeleton: React.FC = () => (
    <div className="mx-auto max-w-7xl space-y-8 p-4 sm:p-6 md:p-10 animate-pulse">
        {/* Header greeting */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-4 w-44" />
            </div>
            <Skeleton className="h-9 w-32 rounded-full" />
        </div>

        {/* Stat cards row */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Skeleton className="h-32 rounded-3xl" />
            <Skeleton className="h-32 rounded-3xl" />
        </div>

        {/* Wide cards */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Skeleton className="h-44 rounded-[2rem]" />
            <Skeleton className="h-44 rounded-[2rem]" />
        </div>

        {/* Chart / long card */}
        <Skeleton className="h-80 rounded-3xl" />
    </div>
);

// ---------------------------------------------------------------------------
// LEADERBOARD skeleton
// ---------------------------------------------------------------------------
const LeaderboardRowSkeleton: React.FC = () => (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-gray-50 dark:bg-black border border-gray-100">
        <Skeleton className="w-7 h-5" />
        <SkeletonAvatar size={40} />
        <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-36" />
        </div>
        <Skeleton className="h-4 w-16 rounded-full" />
    </div>
);

export const LeaderboardSkeleton: React.FC = () => (
    <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
            <LeaderboardRowSkeleton key={i} />
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// NOTIFICATIONS skeleton
// ---------------------------------------------------------------------------
const NotificationRowSkeleton: React.FC = () => (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-gray-100 bg-white dark:bg-black">
        <Skeleton className="w-12 h-12 rounded-xl flex-shrink-0" />
        <div className="flex-1 space-y-2">
            <div className="flex justify-between">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3.5 w-14" />
            </div>
            <SkeletonText lines={2} lastLineWidth="w-4/5" />
        </div>
    </div>
);

export const NotificationsSkeleton: React.FC = () => (
    <div className="space-y-3 p-4 md:p-6">
        {Array.from({ length: 6 }).map((_, i) => (
            <NotificationRowSkeleton key={i} />
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// STUDY PARTNERS skeleton
// ---------------------------------------------------------------------------
const PartnerCardSkeleton: React.FC = () => (
    <div className="flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-black border border-gray-100 shadow-sm">
        <SkeletonAvatar size={52} />
        <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-24" />
        </div>
        <Skeleton className="h-9 w-20 rounded-full" />
    </div>
);

export const StudyPartnersSkeleton: React.FC = () => (
    <div className="space-y-3 p-4">
        {/* Search bar */}
        <Skeleton className="h-12 w-full rounded-2xl mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
            <PartnerCardSkeleton key={i} />
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// PUBLIC PROFILE skeleton
// ---------------------------------------------------------------------------
export const PublicProfileSkeleton: React.FC = () => (
    <div className="flex flex-col h-full w-full bg-[#F8F9FA] dark:bg-black overflow-y-auto">
        {/* Cover photo */}
        <div className="relative">
            <Skeleton className="w-full h-40 rounded-none" rounded="rounded-none" />
            <div className="absolute -bottom-8 left-5">
                <SkeletonAvatar size={80} className="ring-4 ring-white" />
            </div>
        </div>

        {/* Profile info */}
        <div className="mt-12 px-5 space-y-3">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-56" />
        </div>

        {/* Stats row */}
        <div className="mt-6 px-5 grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
        </div>

        {/* Bio card */}
        <div className="mt-4 px-5">
            <Skeleton className="h-24 rounded-2xl" />
        </div>

        {/* Action button */}
        <div className="mt-4 px-5">
            <Skeleton className="h-12 rounded-2xl" />
        </div>
    </div>
);

// ---------------------------------------------------------------------------
// USER PROFILE (settings profile page) skeleton
// ---------------------------------------------------------------------------
export const UserProfileSkeleton: React.FC = () => (
    <div className="flex flex-col bg-white dark:bg-black min-h-full">
        {/* Cover */}
        <Skeleton className="w-full h-36" rounded="rounded-none" />

        {/* Avatar + Name */}
        <div className="px-5 -mt-10 space-y-3">
            <SkeletonAvatar size={80} className="ring-4 ring-white" />
            <Skeleton className="h-6 w-40 mt-2" />
            <Skeleton className="h-4 w-28" />
        </div>

        {/* Form fields */}
        <div className="px-5 mt-6 space-y-4">
            {[1, 2, 3, 4].map(i => (
                <div key={i} className="space-y-2">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-11 w-full rounded-xl" />
                </div>
            ))}
            <Skeleton className="h-12 w-full rounded-2xl mt-2" />
        </div>
    </div>
);

// ---------------------------------------------------------------------------
// HISTORY skeleton
// ---------------------------------------------------------------------------
const HistoryCardSkeleton: React.FC = () => (
    <div className="bg-white dark:bg-black border border-gray-200 rounded-3xl p-6 space-y-4">
        <div className="flex justify-between items-start">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-11 w-full rounded-xl" />
    </div>
);

export const HistorySkeleton: React.FC = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
            <HistoryCardSkeleton key={i} />
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// MESSENGER skeleton (chat list)
// ---------------------------------------------------------------------------
const ChatRowSkeleton: React.FC = () => (
    <div className="flex items-center gap-3 px-4 py-3">
        <SkeletonAvatar size={48} />
        <div className="flex-1 space-y-2">
            <div className="flex justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3.5 w-10" />
            </div>
            <Skeleton className="h-3.5 w-48" />
        </div>
    </div>
);

export const MessengerSkeleton: React.FC = () => (
    <div className="space-y-1 py-2">
        {Array.from({ length: 8 }).map((_, i) => (
            <ChatRowSkeleton key={i} />
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// SETTINGS skeleton
// ---------------------------------------------------------------------------
export const SettingsSkeleton: React.FC = () => (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Profile card */}
        <div className="bg-white dark:bg-black rounded-3xl p-5 flex items-center gap-4 border border-gray-100">
            <SkeletonAvatar size={60} />
            <div className="space-y-2 flex-1">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-48" />
            </div>
        </div>

        {/* Section headers + rows */}
        {[1, 2, 3].map(section => (
            <div key={section} className="bg-white dark:bg-black rounded-3xl border border-gray-100 overflow-hidden">
                <div className="px-5 pt-4 pb-2">
                    <Skeleton className="h-4 w-24" />
                </div>
                {[1, 2, 3].map(row => (
                    <div key={row} className="flex items-center justify-between px-5 py-4 border-t border-gray-50">
                        <div className="flex items-center gap-3">
                            <Skeleton className="w-9 h-9 rounded-xl" />
                            <Skeleton className="h-4 w-28" />
                        </div>
                        <Skeleton className="w-6 h-6 rounded-md" />
                    </div>
                ))}
            </div>
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// Generic full-page fallback skeleton (used by Suspense in MainContent)
// ---------------------------------------------------------------------------
export const PageSkeleton: React.FC = () => (
    <div className="flex-1 p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full">
        <Skeleton className="h-8 w-56 mb-6" />
        {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className={`h-16 w-full rounded-2xl`} style={{ opacity: 1 - i * 0.15 }} />
        ))}
    </div>
);

// ---------------------------------------------------------------------------
// Progress Summary skeleton — per-section loading for the Academic Progress card
// ---------------------------------------------------------------------------
export const ProgressSummarySkeleton: React.FC = () => (
    <div className="rounded-3xl border border-gray-200 dark:border-transparent bg-white dark:bg-[#0A0A0A] p-6 md:p-8 space-y-5">
        <div className="flex items-center justify-between">
            <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-6 w-52" />
            </div>
            <Skeleton className="h-7 w-12 rounded-lg" />
        </div>
        <Skeleton className="h-3.5 w-full rounded-full" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
                <div key={i} className="p-4 rounded-2xl border border-gray-100 bg-gray-50 dark:bg-slate-900/50 space-y-2">
                    <Skeleton className="h-2.5 w-20" />
                    <Skeleton className="h-5 w-14" />
                </div>
            ))}
        </div>
    </div>
);

export default Skeleton;
