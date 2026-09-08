import { useState, useEffect, useCallback, useMemo } from 'react';
import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { AppSettings, UserProfile } from '../types';
import {
  lessonPrepService,
  buildPrepKey,
  type LessonPrepStatus,
  type StartPrepParams,
} from '../services/lessonPrepService';
import { buildTopicKey } from '../services/structurePrefetchService';

interface UseLessonPrepParams {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  userId?: string;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
}

const MODES: LessonDurationMode[] = [15, 30, 60];

export function useLessonPrep(params: UseLessonPrepParams) {
  const { topicTitle, courseName, syllabusContext, userId, userProfile, appSettings } = params;
  const resolvedUserId = userId || userProfile?.uid || 'anon';
  const topicKey = useMemo(() => buildTopicKey(topicTitle, courseName), [topicTitle, courseName]);

  const keys = useMemo(() => {
    return {
      15: buildPrepKey(resolvedUserId, topicKey, 15),
      30: buildPrepKey(resolvedUserId, topicKey, 30),
      60: buildPrepKey(resolvedUserId, topicKey, 60),
    };
  }, [resolvedUserId, topicKey]);

  const [statuses, setStatuses] = useState<Record<LessonDurationMode, LessonPrepStatus>>(() => ({
    15: lessonPrepService.getStatus(keys[15]),
    30: lessonPrepService.getStatus(keys[30]),
    60: lessonPrepService.getStatus(keys[60]),
  }));

  useEffect(() => {
    if (!topicTitle) return;

    // Immediately fetch latest persisted/current status
    setStatuses({
      15: lessonPrepService.getStatus(keys[15]),
      30: lessonPrepService.getStatus(keys[30]),
      60: lessonPrepService.getStatus(keys[60]),
    });

    const unsubs = MODES.map((mode) => {
      const key = keys[mode];
      return lessonPrepService.subscribe(key, (newStatus) => {
        setStatuses((prev) => ({
          ...prev,
          [mode]: newStatus,
        }));
      });
    });

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [keys, topicTitle]);

  const startPrep = useCallback(
    async (mode: LessonDurationMode) => {
      const prepParams: StartPrepParams = {
        userId: resolvedUserId,
        topicTitle,
        courseName,
        syllabusContext,
        durationMode: mode,
        userProfile,
        appSettings,
      };
      await lessonPrepService.startPrep(prepParams);
    },
    [resolvedUserId, topicTitle, courseName, syllabusContext, userProfile, appSettings]
  );

  const cancelPrep = useCallback(
    (mode: LessonDurationMode) => {
      lessonPrepService.cancelPrep(keys[mode]);
    },
    [keys]
  );

  const isAnyPreparing = useMemo(() => {
    return MODES.some((m) => statuses[m]?.state === 'preparing');
  }, [statuses]);

  const isModeReady = useCallback(
    (mode: LessonDurationMode) => {
      return lessonPrepService.isReady(keys[mode]);
    },
    [keys]
  );

  return {
    statuses,
    isAnyPreparing,
    startPrep,
    cancelPrep,
    isModeReady,
    topicKey,
    keys,
  };
}
