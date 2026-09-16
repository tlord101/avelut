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
   * Start live tutorial background prep job via in-app worker
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

      // Enqueue background worker job
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
    [resolvedUserId, topicKey, topicTitle, courseName, syllabusContext, userProfile, appSettings]
  );

  const cancelJob = useCallback(() => {
    lessonPrepService.cancelPrep(activePrepKey);
  }, [activePrepKey]);

  return {
    status,
    activeDuration,
    setActiveDuration,
    startPrepJob,
    cancelJob,
  };
}
