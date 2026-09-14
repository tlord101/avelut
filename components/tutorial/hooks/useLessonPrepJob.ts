import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import {
  lessonPrepService,
  type LessonPrepStatus,
  buildPrepKey,
} from '../../../services/lessonPrepService';
import { buildTopicKey, buildContentHash } from '../../../services/structurePrefetchService';
import type { LessonDurationMode } from '../LessonDurationModal';
import type { AppSettings, UserProfile } from '../../../types';

export interface UseLessonPrepJobParams {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  userId?: string;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
}

export function useLessonPrepJob({
  topicTitle,
  courseName,
  syllabusContext,
  userId,
  userProfile,
  appSettings,
}: UseLessonPrepJobParams) {
  const resolvedUserId = userId || userProfile?.uid || 'anon';
  const topicKey = buildTopicKey(topicTitle, courseName);
  const contentHash = buildContentHash(topicTitle, courseName, syllabusContext);

  const [activeDuration, setActiveDuration] = useState<LessonDurationMode>(30);
  const activePrepKey = buildPrepKey(resolvedUserId, topicKey, activeDuration);

  const [status, setStatus] = useState<LessonPrepStatus>(() =>
    lessonPrepService.getStatus(activePrepKey)
  );

  useEffect(() => {
    const unsub = lessonPrepService.subscribe(activePrepKey, (s) => setStatus(s));
    return unsub;
  }, [activePrepKey]);

  /**
   * Step 1 of live tutorial start: Ensure structure only (short call)
   */
  const ensureStructure = useCallback(
    async (durationMode: LessonDurationMode) => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
        const res = await fetch(`${supabaseUrl}/functions/v1/live-tutorial-ensure-structure`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            topicTitle,
            courseName,
            syllabusContext,
            durationMinutes: durationMode,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to generate topic structure (${res.status})`);
        }

        const data = await res.json();
        return data.structure;
      } catch (err) {
        console.warn('[useLessonPrepJob] ensureStructure warning, proceeding:', err);
        return null;
      }
    },
    [topicTitle, courseName, syllabusContext]
  );

  /**
   * Step 2 of live tutorial start: Start server background prep job
   */
  const startPrepJob = useCallback(
    async (durationMode: LessonDurationMode, voice?: string) => {
      setActiveDuration(durationMode);
      const key = buildPrepKey(resolvedUserId, topicKey, durationMode);

      // Check if already ready locally
      const pkg = await lessonPrepService.loadReadyPackage(key, voice);
      if (pkg) {
        return;
      }

      // Step 1: ensure structure
      await ensureStructure(durationMode);

      // Step 2: enqueue background worker job
      await lessonPrepService.startPrep({
        userId: resolvedUserId,
        topicTitle,
        courseName,
        syllabusContext,
        durationMode,
        userProfile,
        appSettings,
        voice,
      });
    },
    [resolvedUserId, topicKey, topicTitle, courseName, syllabusContext, userProfile, appSettings, ensureStructure]
  );

  const cancelJob = useCallback(() => {
    lessonPrepService.cancelPrep(activePrepKey);
  }, [activePrepKey]);

  return {
    status,
    activeDuration,
    setActiveDuration,
    ensureStructure,
    startPrepJob,
    cancelJob,
  };
}
