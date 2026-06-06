import { ref as dbRef, get, update, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import type { UserProfile } from '../types';

/**
 * Returns today's date as a 'YYYY-MM-DD' string in local time.
 */
export const getTodayDateString = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Returns true if the user has already earned a streak today.
 */
export const isStreakAlreadyAwardedToday = (userProfile: UserProfile): boolean => {
  return userProfile.last_streak_date === getTodayDateString();
};

/**
 * Checks whether the user's streak is "active" (last award was today).
 */
export const isStreakActiveToday = (userProfile: UserProfile): boolean => {
  return userProfile.last_streak_date === getTodayDateString();
};

/**
 * Awards one streak day to the user (once per day, enforced by last_streak_date).
 * Returns true if the streak was incremented, false if it was already done today.
 */
export const awardDailyStreak = async (uid: string): Promise<boolean> => {
  const today = getTodayDateString();

  try {
    const userRef = dbRef(db, `users/${uid}`);

    let awarded = false;
    await runTransaction(userRef, (currentData) => {
      if (!currentData) return currentData; // Abort if no data

      // Guard: only award once per day
      if (currentData.last_streak_date === today) {
        return; // Return undefined to abort transaction without changes
      }

      const lastStreakDate: string | undefined = currentData.last_streak_date;
      const currentStreak: number = typeof currentData.current_streak === 'number' ? currentData.current_streak : 0;

      // Determine if it's a consecutive day (yesterday)
      let newStreak = currentStreak;
      if (lastStreakDate) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        if (lastStreakDate === yesterdayStr) {
          newStreak = currentStreak + 1; // Consecutive day
        } else {
          newStreak = 1; // Streak broken — reset to 1
        }
      } else {
        newStreak = 1; // First ever streak
      }

      awarded = true;
      return {
        ...currentData,
        current_streak: newStreak,
        last_streak_date: today,
        last_activity_date: Date.now(),
      };
    });

    return awarded;
  } catch (error) {
    console.error('[streaks] Failed to award daily streak:', error);
    return false;
  }
};
