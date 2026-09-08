/**
 * useStructurePrefetch — React hook wrapping the structurePrefetchService.
 *
 * Provides a SWR-style API for consuming prefetch state in React components.
 * The modal and SessionView share the same singleton service / query cache.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { LessonDurationMode } from '../components/tutorial/LessonDurationModal';
import type { AppSettings, UserProfile } from '../types';
import {
  startPrefetch,
  cancelPrefetch,
  retryPrefetch as retryPrefetchService,
  subscribeToStatus,
  isReadyToStart as checkReadyToStart,
  getAllPrefetchStatuses,
  buildTopicKey,
  buildContentHash,
  getCachedStructure,
} from '../services/structurePrefetchService';
import type { PrefetchStatus, PrefetchParams } from '../services/structurePrefetchService';
import type { TeachingStructure } from '../types/teachingScript';

export interface UseStructurePrefetchParams {
  topicTitle: string;
  courseName?: string;
  syllabusContext?: string;
  userId?: string;
  userProfile?: UserProfile | null;
  appSettings?: AppSettings | null;
  /** If false, prefetch is not started automatically (default: true) */
  autoStart?: boolean;
}

export interface UseStructurePrefetchResult {
  /** Prefetch statuses for each duration mode */
  statuses: Record<LessonDurationMode, PrefetchStatus>;
  /** Check if a specific mode is ready to start */
  isReadyToStart: (mode: LessonDurationMode) => boolean;
  /** Whether any mode is currently prefetching */
  isAnyPrefetching: boolean;
  /** Whether any mode has failed */
  isAnyFailed: boolean;
  /** Whether all modes are ready */
  isAllReady: boolean;
  /** Retry prefetch (optionally for a specific mode) */
  retry: (mode?: LessonDurationMode) => void;
  /** Cancel in-flight prefetch */
  cancel: () => void;
  /** Manually trigger prefetch */
  start: () => void;
  /** Get cached structure for a specific mode */
  getStructure: (mode: LessonDurationMode) => TeachingStructure | null;
  /** Topic key for external use */
  topicKey: string;
  /** Content hash for cache lookups */
  contentHash: string;
}

export function useStructurePrefetch(params: UseStructurePrefetchParams): UseStructurePrefetchResult {
  const {
    topicTitle,
    courseName,
    syllabusContext,
    userId,
    userProfile,
    appSettings,
    autoStart = true,
  } = params;

  const topicKey = useMemo(
    () => buildTopicKey(topicTitle, courseName),
    [topicTitle, courseName],
  );

  const contentHash = useMemo(
    () => buildContentHash(topicTitle, courseName, syllabusContext),
    [topicTitle, courseName, syllabusContext],
  );

  const resolvedUserId = userId || userProfile?.uid || 'anon';

  const [statuses, setStatuses] = useState<Record<LessonDurationMode, PrefetchStatus>>(() =>
    getAllPrefetchStatuses(topicKey),
  );

  // Subscribe to status changes from the service
  useEffect(() => {
    if (!topicTitle) return;
    const unsub = subscribeToStatus(topicKey, (newStatuses) => {
      setStatuses(newStatuses);
    });
    return unsub;
  }, [topicKey, topicTitle]);

  // Build prefetch params
  const prefetchParams = useMemo<PrefetchParams>(
    () => ({
      topicTitle,
      courseName,
      syllabusContext,
      userId: resolvedUserId,
      userProfile,
      appSettings,
    }),
    [topicTitle, courseName, syllabusContext, resolvedUserId, userProfile, appSettings],
  );

  // Auto-start prefetch on mount
  useEffect(() => {
    if (!topicTitle || !autoStart) return;
    void startPrefetch(prefetchParams);
  }, [topicTitle, courseName, syllabusContext, autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const isReadyToStartFn = useCallback(
    (mode: LessonDurationMode) => checkReadyToStart(topicKey, mode, resolvedUserId, contentHash),
    [topicKey, resolvedUserId, contentHash],
  );

  const retry = useCallback(
    (mode?: LessonDurationMode) => retryPrefetchService(prefetchParams, mode),
    [prefetchParams],
  );

  const cancel = useCallback(() => cancelPrefetch(topicKey), [topicKey]);

  const start = useCallback(() => void startPrefetch(prefetchParams), [prefetchParams]);

  const getStructure = useCallback(
    (mode: LessonDurationMode) => getCachedStructure(topicKey, mode, resolvedUserId, contentHash),
    [topicKey, resolvedUserId, contentHash],
  );

  const isAnyPrefetching = useMemo(
    () => Object.values(statuses).some((s) => s.state === 'prefetching'),
    [statuses],
  );

  const isAnyFailed = useMemo(
    () => Object.values(statuses).some((s) => s.state === 'failed'),
    [statuses],
  );

  const isAllReady = useMemo(
    () => Object.values(statuses).every((s) => s.state === 'ready'),
    [statuses],
  );

  return {
    statuses,
    isReadyToStart: isReadyToStartFn,
    isAnyPrefetching,
    isAnyFailed,
    isAllReady,
    retry,
    cancel,
    start,
    getStructure,
    topicKey,
    contentHash,
  };
}
