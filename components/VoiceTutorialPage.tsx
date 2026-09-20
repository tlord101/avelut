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
import { LessonDurationModal, type LessonDurationMode } from './tutorial/LessonDurationModal';
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

  // ── Derived topic / course info ──────────────────────────────────────────
  const topicTitle =
    initialSessionData?.topic?.topic_name ||
    initialSessionData?.customPrompt ||
    'Live Tutorial';
  const courseName = initialSessionData?.course?.course_name || 'Academic Topic';
  const syllabusContext = initialSessionData?.syllabusContext;

  // ── UI State ─────────────────────────────────────────────────────────────
  const [selectedDuration, setSelectedDuration] = useState<LessonDurationMode | null>(null);
  const [isDurationModalOpen, setIsDurationModalOpen] = useState(true);
  const [isPlayerActive, setIsPlayerActive] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [creditCheckData, setCreditCheckData] = useState<any>(null);
  const [resumeProgress, setResumeProgress] = useState<LiveTeachingProgress | null>(null);

  // ── Stable session identity: reset when topic changes ───────────────────
  const sessionId = useMemo(() => {
    const topicId = initialSessionData?.topic?.topic_id || '';
    const courseId = initialSessionData?.course?.course_id || '';
    return `${courseId}::${topicId}::${topicTitle}::${courseName}`;
  }, [
    initialSessionData?.topic?.topic_id,
    initialSessionData?.course?.course_id,
    topicTitle,
    courseName,
  ]);

  useEffect(() => {
    setSelectedDuration(null);
    setIsDurationModalOpen(true);
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

  // ── Blank-screen guard ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isDurationModalOpen && !selectedDuration && !isPlayerActive) {
      onBack ? onBack() : setIsDurationModalOpen(true);
    }
  }, [isDurationModalOpen, selectedDuration, isPlayerActive, onBack]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleStartLesson = async (mode: LessonDurationMode) => {
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

    // Instant start — no background prep job
    setSelectedDuration(mode);
    setIsDurationModalOpen(false);
    setIsPlayerActive(true);
  };

  const handleResume = () => {
    if (!resumeProgress) return;
    setSelectedDuration(resumeProgress.durationMode);
    setIsDurationModalOpen(false);
    setIsPlayerActive(true);
  };

  const handleCloseModal = () => {
    setIsDurationModalOpen(false);
    if (!selectedDuration && !isPlayerActive) onBack?.();
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0A0A0A] text-[#FAFAFA]">
      {/* Duration / entry modal */}
      <LessonDurationModal
        isOpen={isDurationModalOpen}
        topicTitle={topicTitle}
        courseName={courseName}
        syllabusContext={syllabusContext}
        onClose={handleCloseModal}
        onConfirm={handleStartLesson}
        onContinue={handleStartLesson}
        onOpen={handleStartLesson}
        initialMode={selectedDuration || 30}
        resumeAvailable={Boolean(resumeProgress)}
        resumeLabel={resumeProgress ? formatResumeLabel(resumeProgress) : undefined}
        onResume={handleResume}
        userProfile={userProfile}
        appSettings={resolvedAppSettings}
      />

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

      {/* ── LIVE CLASSROOM (Phase 3) ─────────────────────────────────── */}
      {!isDurationModalOpen && isPlayerActive && (
        <AvelutLiveClassroomView
          key={`${topicTitle}::${courseName}::${selectedDuration}`}
          topicTitle={topicTitle}
          courseName={courseName}
          syllabusContext={syllabusContext}
          userProfile={userProfile}
          appSettings={resolvedAppSettings}
          onClose={onBack}
          setCustomHeaderConfig={setCustomHeaderConfig}
        />
      )}
    </div>
  );
};

export default VoiceTutorialPage;
