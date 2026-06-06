import React from 'react';
import type { UserProfile } from '../types';
import { isStreakActiveToday } from '../utils/streaks';

interface StreakBadgeProps {
  userProfile: UserProfile;
  /** 'sm' = inline badge (next to name), 'md' = slightly larger (chat header), 'lg' = dashboard */
  size?: 'sm' | 'md' | 'lg';
  /** When true, always show even if streak is 0 */
  showAlways?: boolean;
}

/**
 * Fire streak badge.
 * - Active today (last_streak_date === today): bright fire gradient + count
 * - Not active today: gray fire (streak not yet earned today)
 * - If current_streak is 0 and not showing always: render nothing
 */
export const StreakBadge: React.FC<StreakBadgeProps> = ({
  userProfile,
  size = 'sm',
  showAlways = false,
}) => {
  const streak = userProfile.current_streak ?? 0;
  const active = isStreakActiveToday(userProfile);

  // Don't render if streak is 0 and showAlways is false
  if (streak === 0 && !showAlways) return null;

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5';
  const textSize = size === 'sm' ? 'text-[10px]' : size === 'md' ? 'text-[11px]' : 'text-xs';
  const gapClass = size === 'sm' ? 'gap-0.5' : 'gap-1';

  return (
    <span
      className={`inline-flex items-center ${gapClass} shrink-0`}
      title={active ? `🔥 ${streak}-day streak — active today!` : `${streak}-day streak — not yet active today`}
      aria-label={`Streak: ${streak} day${streak !== 1 ? 's' : ''}`}
    >
      {active ? (
        // Active fire: vibrant gradient fire SVG
        <svg
          viewBox="0 0 24 24"
          className={iconSize}
          fill="none"
          style={{ filter: 'drop-shadow(0 1px 2px rgba(251,146,60,0.5))' }}
        >
          <defs>
            <linearGradient id="fire-active" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
              <stop stopColor="#f97316" />
              <stop offset="1" stopColor="#ef4444" />
            </linearGradient>
          </defs>
          <path
            fill="url(#fire-active)"
            d="M12 2C10 5.5 8 6.5 8 10c0 2.21 1.79 4 4 4s4-1.79 4-4c0-1.5-.5-3-1-4 0 0 0 2-1.5 2.5C13.97 7 14 5 12 2zm0 14c-3.31 0-6-2.69-6-6 0-1.57.62-3 1.64-4.05C7.24 7.24 7 9 7 10c0 2.76 2.24 5 5 5s5-2.24 5-5c0-1-.26-1.95-.7-2.77C17.38 8.37 18 10.1 18 12c0 3.31-2.69 4-6 4z"
          />
        </svg>
      ) : (
        // Inactive fire: gray
        <svg
          viewBox="0 0 24 24"
          className={`${iconSize} text-gray-400`}
          fill="none"
        >
          <path
            fill="currentColor"
            d="M12 2C10 5.5 8 6.5 8 10c0 2.21 1.79 4 4 4s4-1.79 4-4c0-1.5-.5-3-1-4 0 0 0 2-1.5 2.5C13.97 7 14 5 12 2zm0 14c-3.31 0-6-2.69-6-6 0-1.57.62-3 1.64-4.05C7.24 7.24 7 9 7 10c0 2.76 2.24 5 5 5s5-2.24 5-5c0-1-.26-1.95-.7-2.77C17.38 8.37 18 10.1 18 12c0 3.31-2.69 4-6 4z"
          />
        </svg>
      )}
      {streak > 0 && (
        <span
          className={`font-black tabular-nums leading-none ${textSize} ${
            active
              ? 'bg-gradient-to-r from-orange-500 to-red-500 bg-clip-text text-transparent'
              : 'text-gray-400'
          }`}
        >
          {streak}
        </span>
      )}
    </span>
  );
};
