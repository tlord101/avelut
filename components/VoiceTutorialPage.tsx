/**
 * VoiceTutorialPage.tsx
 *
 * Phase 5: Wire-up entry point for the Avelut Live Tutorial.
 *
 * Flow:
 *  1. LessonDurationModal → student picks 15 / 30 / 60 min
 *  2. Credit check (evaluateLiveTutorialStart)
 *  3. AvelutLiveClassroomView starts instantly — no background prep job
 *
 * Legacy TeachingEngineSessionView, LessonPrepProgressView, and
 * useLessonPrepJob are fully replaced by the new real-time pipeline.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useAppSettings } from '../hooks/useAppSettings';
import type { UserProfile, Course, Topic } from '../types';
import { InsufficientCreditsModal } from './tutorial/InsufficientCreditsModal';
import { AvelutLiveClassroomView } from './tutorial/live-classroom/AvelutLiveClassroomView';
import {
  evaluateLiveTutorialStart,
  type LiveDurationMinutes,
} from '../utils/liveTutorialQuota';
import {
  getLiveTeachingProgress,
  topicKeyFromTitle,
  formatResumeLabel,
  type LiveTeachingProgress,
} from '../services/liveTeachingProgressService';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { getOrGenerateTopicStructure } from '../services/topicStructureService';

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface VoiceTutorialSessionData {
  course: Course;
  topic?: Topic | null;
  syllabusContext?: string;
  image?: string | null;
  customPrompt?: string | null;
  source?: string;
}

export interface VoiceTutorialPageProps {
  userProfile?: UserProfile | null;
  appSettings?: any;
  onNavigate?: (tab: string) => void;
  initialSessionData?: VoiceTutorialSessionData | null;
  onBack?: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const VoiceTutorialPage: React.FC<VoiceTutorialPageProps> = ({
  userProfile,
  appSettings: propAppSettings,
  onNavigate,
  initialSessionData,
  onBack,
  setCustomHeaderConfig,
}) => {
  const { settings: hookAppSettings } = useAppSettings();
  const resolvedAppSettings = propAppSettings || hookAppSettings;

  // ── Derived topic / course info with cached session & recent topic fallback ──
  const effectiveSessionData = useMemo<VoiceTutorialSessionData | null>(() => {
    if (initialSessionData && (initialSessionData.topic?.topic_name || initialSessionData.customPrompt)) {
      return initialSessionData;
    }
    const cached = readCachedJson<VoiceTutorialSessionData | null>('avelut_active_voice_tutorial', null);
    if (cached && (cached.topic?.topic_name || cached.customPrompt)) {
      return cached;
    }
    // Fallback: see if user has a recent course / topic in local courses
    const uid = userProfile?.uid || 'anon';
    const courses = readCachedJson<Course[]>(`avelut_courses_${uid}`, []);
    if (courses.length > 0) {
      const topicVisits = readCachedJson<Record<string, number>>(`avelut_topic_visits_${uid}`, {});
      let bestCourse = courses[0];
      let bestTopic = courses[0].topics?.[0];
      let bestTime = 0;

      for (const c of courses) {
        if (Array.isArray(c.topics)) {
          for (const t of c.topics) {
            const time = topicVisits[`${c.course_id}::${t.topic_id}`] || topicVisits[t.topic_id] || 0;
            if (time > bestTime) {
              bestTime = time;
              bestCourse = c;
              bestTopic = t;
            }
          }
        }
      }

      if (bestTopic) {
        return {
          course: bestCourse,
          topic: bestTopic,
          syllabusContext: bestTopic.topic_context || `Course: ${bestCourse.course_name}`,
        };
      }
    }
    return initialSessionData || null;
  }, [initialSessionData, userProfile?.uid]);

  const topicTitle =
    effectiveSessionData?.topic?.topic_name ||
    effectiveSessionData?.customPrompt ||
    'Live Tutorial';
  const courseName = effectiveSessionData?.course?.course_name || 'Academic Topic';
  const syllabusContext =
    effectiveSessionData?.syllabusContext ||
    effectiveSessionData?.topic?.topic_context;

  // ── UI State ─────────────────────────────────────────────────────────────
  const [isPlayerActive, setIsPlayerActive] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [creditCheckData, setCreditCheckData] = useState<any>(null);
  const [resumeProgress, setResumeProgress] = useState<LiveTeachingProgress | null>(null);
  const [learningPath, setLearningPath] = useState<string[]>([]);

  // ── Load or generate topic learning path structure ───────────────────────
  useEffect(() => {
    const topicKey = effectiveSessionData?.topic?.topic_id || effectiveSessionData?.topic?.topic_name;
    if (!topicKey || !effectiveSessionData?.topic?.topic_name) return;

    let isCancelled = false;
    getOrGenerateTopicStructure({
      topicKey,
      topicTitle,
      courseTitle: courseName,
      context: syllabusContext || effectiveSessionData?.topic?.topic_context,
      userProfile: userProfile || ({} as any),
      appSettings: resolvedAppSettings,
    }).then((struct) => {
      if (!isCancelled && struct?.steps && struct.steps.length > 0) {
        const formatted = struct.steps.map((s, idx) => `Step ${idx + 1}: ${s.title} — ${s.objective}`);
        setLearningPath(formatted);
      }
    }).catch(() => {});

    return () => { isCancelled = true; };
  }, [effectiveSessionData, topicTitle, courseName, syllabusContext, userProfile, resolvedAppSettings]);

  // ── Stable session identity: reset when topic changes ───────────────────
  const sessionId = useMemo(() => {
    const topicId = effectiveSessionData?.topic?.topic_id || '';
    const courseId = effectiveSessionData?.course?.course_id || '';
    return `${courseId}::${topicId}::${topicTitle}::${courseName}`;
  }, [
    effectiveSessionData?.topic?.topic_id,
    effectiveSessionData?.course?.course_id,
    topicTitle,
    courseName,
  ]);

  useEffect(() => {
    setIsPlayerActive(false);
    setResumeProgress(null);
  }, [sessionId]);

  // ── Check for saved progress (resume banner) ─────────────────────────────
  useEffect(() => {
    const uid = userProfile?.uid || 'anon';
    const key = topicKeyFromTitle(topicTitle, courseName);
    const progress = getLiveTeachingProgress(uid, key);
    if (progress && !progress.isCompleted && progress.boardIndex > 0) {
      setResumeProgress(progress);
    } else {
      setResumeProgress(null);
    }
  }, [userProfile?.uid, topicTitle, courseName]);

  // ── Auto-start check ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlayerActive && !showCreditsModal && effectiveSessionData) {
      void handleStartLesson(30);
    }
  }, [isPlayerActive, showCreditsModal, effectiveSessionData]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleStartLesson = async (mode: 15 | 30 | 60) => {
    const decision = evaluateLiveTutorialStart(
      userProfile,
      mode as LiveDurationMinutes,
      resolvedAppSettings,
    );

    if (!decision.allowed) {
      setCreditCheckData({
        currentBalance: userProfile?.ai_credits_balance ?? 0,
        requiredCost: decision.creditCost,
        durationMinutes: mode,
        poolRemaining: decision.poolRemaining,
      });
      setShowCreditsModal(true);
      return;
    }

    // Instant start
    setIsPlayerActive(true);
  };

  const handleClose = () => {
    setIsPlayerActive(false);
    if (onBack) {
      onBack();
    } else {
      onNavigate?.('study_guide');
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0A0A0A] text-[#FAFAFA]">

      {/* Insufficient credits */}
      <InsufficientCreditsModal
        isOpen={showCreditsModal}
        onClose={() => setShowCreditsModal(false)}
        currentBalance={creditCheckData?.currentBalance ?? 0}
        requiredCost={creditCheckData?.requiredCost ?? 0}
        durationMinutes={creditCheckData?.durationMinutes ?? 30}
        poolRemaining={creditCheckData?.poolRemaining ?? 0}
        onBuyCredits={() => {
          setShowCreditsModal(false);
          onNavigate?.('billing');
        }}
        onTryShorter={(shorterMode) => {
          setShowCreditsModal(false);
          void handleStartLesson(shorterMode);
        }}
        affordableModes={([15, 30, 60] as const).filter(
          (m) =>
            evaluateLiveTutorialStart(userProfile, m as LiveDurationMinutes, resolvedAppSettings)
              .allowed,
        )}
      />

      {/* ── LIVE CLASSROOM ─────────────────────────────────────────────── */}
      {isPlayerActive && (
        <AvelutLiveClassroomView
          key={`${topicTitle}::${courseName}::30`}
          topicTitle={topicTitle}
          courseName={courseName}
          syllabusContext={syllabusContext}
          durationMinutes={30}
          learningPath={learningPath}
          userProfile={userProfile}
          appSettings={resolvedAppSettings}
          onClose={handleClose}
          setCustomHeaderConfig={setCustomHeaderConfig}
        />
      )}
    </div>
  );
};

export default VoiceTutorialPage;
