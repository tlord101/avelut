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
  durationMode?: LessonDurationMode | null;
}

export function useLessonPrepJob({
  topicTitle,
  courseName,
  syllabusContext,
  userId,
  userProfile,
  appSettings,
  durationMode,
}: UseLessonPrepJobParams) {
  const resolvedUserId = userId || userProfile?.uid || 'anon';
  const topicKey = buildTopicKey(topicTitle, courseName);
  const contentHash = buildContentHash(topicTitle, courseName, syllabusContext);

  const [activeDuration, setActiveDuration] = useState<LessonDurationMode>(durationMode || 30);

  useEffect(() => {
    if (durationMode) {
      setActiveDuration(durationMode);
    }
  }, [durationMode]);

  const effectiveDuration = durationMode || activeDuration || 30;
  const activePrepKey = buildPrepKey(resolvedUserId, topicKey, effectiveDuration);

  const [status, setStatus] = useState<LessonPrepStatus>(() =>
    lessonPrepService.getStatus(activePrepKey)
  );

  useEffect(() => {
    setStatus(lessonPrepService.getStatus(activePrepKey));
    const unsub = lessonPrepService.subscribe(activePrepKey, (s) => setStatus(s));
    return unsub;
  }, [activePrepKey]);

  /**
   * Start live tutorial background prep job via in-app worker
   */
  const startPrepJob = useCallback(
    async (targetDuration: LessonDurationMode, voice?: string) => {
      setActiveDuration(targetDuration);
      const key = buildPrepKey(resolvedUserId, topicKey, targetDuration);

      // Optimistically update status immediately so UI displays progress instantly
      setStatus({
        state: 'preparing',
        step: 1,
        progressPercent: 10,
        message: 'Planning lesson structure…',
      });

      // Check if already ready locally
      const pkg = await lessonPrepService.loadReadyPackage(key, voice);
      if (pkg) {
        setStatus({
          state: 'ready',
          step: 3,
          progressPercent: 100,
          message: 'Lesson is ready on device!',
        });
        return;
      }

      // Enqueue background worker job
      await lessonPrepService.startPrep({
        userId: resolvedUserId,
        topicTitle,
        courseName,
        syllabusContext,
        durationMode: targetDuration,
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
    activeDuration: effectiveDuration,
    setActiveDuration,
    startPrepJob,
    cancelJob,
  };
}
