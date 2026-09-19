import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import type { UserProfile, Course, Topic } from '../types';
import { LessonDurationModal, type LessonDurationMode } from './tutorial/LessonDurationModal';
import { InsufficientCreditsModal } from './tutorial/InsufficientCreditsModal';
import { LessonPrepProgressView } from './tutorial/LessonPrepProgressView';
import { TeachingEngineSessionView } from './tutorial/TeachingEngineSessionView';
import { useLessonPrepJob } from './tutorial/hooks/useLessonPrepJob';
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
import { lessonPrepService } from '../services/lessonPrepService';

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
  const { addToast } = useToast();

  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [creditCheckData, setCreditCheckData] = useState<any>(null);

  const topicTitle = initialSessionData?.topic?.topic_name || initialSessionData?.customPrompt || 'Live Tutorial';
  const courseName = initialSessionData?.course?.course_name || 'Academic Topic';
  const syllabusContext = initialSessionData?.syllabusContext;

  const [selectedDurationMode, setSelectedDurationMode] = useState<LessonDurationMode | null>(null);
  const [isDurationModalOpen, setIsDurationModalOpen] = useState<boolean>(true);
  const [resumeProgress, setResumeProgress] = useState<LiveTeachingProgress | null>(null);
  const [startBoardIndex, setStartBoardIndex] = useState<number>(0);
  const [isPlayerActive, setIsPlayerActive] = useState(false);
  const [isOpeningLesson, setIsOpeningLesson] = useState(false);

  const sessionIdentity = useMemo(() => {
    const topicId = initialSessionData?.topic?.topic_id || '';
    const courseId = initialSessionData?.course?.course_id || '';
    return `${courseId}::${topicId}::${topicTitle}::${courseName}`;
  }, [
    initialSessionData?.topic?.topic_id,
    initialSessionData?.course?.course_id,
    topicTitle,
    courseName,
  ]);

  const {
    status: prepStatus,
    startPrepJob,
    cancelJob,
  } = useLessonPrepJob({
    topicTitle,
    courseName,
    syllabusContext,
    userId: userProfile?.uid,
    userProfile,
    appSettings: resolvedAppSettings,
    durationMode: selectedDurationMode,
  });

  // Reset duration mode & progress only when the topic changes
  useEffect(() => {
    setSelectedDurationMode(null);
    setStartBoardIndex(0);
    setResumeProgress(null);
    setIsDurationModalOpen(true);
    setIsPlayerActive(false);
    setIsOpeningLesson(false);
  }, [sessionIdentity]);

  // Prevent blank screen: if duration modal was dismissed without selection, return or reopen
  useEffect(() => {
    if (!isDurationModalOpen && !selectedDurationMode && !isPlayerActive && !isOpeningLesson) {
      if (onBack) {
        onBack();
      } else {
        setIsDurationModalOpen(true);
      }
    }
  }, [isDurationModalOpen, selectedDurationMode, isPlayerActive, isOpeningLesson, onBack]);

  // Check for existing progress
  useEffect(() => {
    const userId = userProfile?.uid || 'anon';
    const topicKey = topicKeyFromTitle(topicTitle, courseName);
    const progress = getLiveTeachingProgress(userId, topicKey);
    if (progress && !progress.isCompleted && progress.boardIndex > 0) {
      setResumeProgress(progress);
    } else {
      setResumeProgress(null);
    }
  }, [userProfile?.uid, topicTitle, courseName]);

  const handleContinueLesson = async (mode: LessonDurationMode) => {
    const decision = evaluateLiveTutorialStart(userProfile, mode as LiveDurationMinutes, resolvedAppSettings);

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

    setSelectedDurationMode(mode);
    setStartBoardIndex(0);
    setIsDurationModalOpen(false);
    setIsPlayerActive(true);

    // Warm up package cache in background if already prepared
    try {
      const resolvedUserId = userProfile?.uid || 'anon';
      const topicKey = topicKeyFromTitle(topicTitle, courseName);
      const key = `${resolvedUserId}::${topicKey}::${mode}`;
      const pkg = await lessonPrepService.loadReadyPackage(key);
      if (pkg) {
        lessonPrepService.hydrateLessonPackageCaches(pkg);
      }
    } catch (_) {}
  };

  const handleResumeSession = () => {
    if (resumeProgress) {
      setSelectedDurationMode(resumeProgress.durationMode);
      setStartBoardIndex(resumeProgress.boardIndex);
      setIsDurationModalOpen(false);
      setIsPlayerActive(true);
    }
  };

  const handleCloseModal = () => {
    setIsDurationModalOpen(false);
    if (!selectedDurationMode && !isPlayerActive) {
      if (onBack) onBack();
    }
  };

  return (
    <div className="relative w-full h-full min-h-screen bg-[#0A0A0A] text-[#FAFAFA]">
      <LessonDurationModal
        isOpen={isDurationModalOpen}
        topicTitle={topicTitle}
        courseName={courseName}
        syllabusContext={syllabusContext}
        onClose={handleCloseModal}
        onConfirm={handleContinueLesson}
        onContinue={handleContinueLesson}
        onOpen={handleContinueLesson}
        initialMode={selectedDurationMode || 30}
        resumeAvailable={Boolean(resumeProgress)}
        resumeLabel={resumeProgress ? formatResumeLabel(resumeProgress) : undefined}
        onResume={handleResumeSession}
        userProfile={userProfile}
        appSettings={resolvedAppSettings}
      />

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
          void handleContinueLesson(shorterMode);
        }}
        affordableModes={([15, 30, 60] as const).filter(
          (m) => evaluateLiveTutorialStart(userProfile, m as LiveDurationMinutes, resolvedAppSettings).allowed
        )}
      />

      {/* 1. READY OPEN / PLAYER SESSION VIEW */}
      {!isDurationModalOpen && isPlayerActive && selectedDurationMode && (
        <TeachingEngineSessionView
          key={`${topicTitle}_${courseName || ''}_${selectedDurationMode}_${startBoardIndex}`}
          topicTitle={topicTitle}
          courseName={courseName}
          syllabusContext={syllabusContext}
          userId={userProfile?.uid}
          userProfile={userProfile}
          appSettings={resolvedAppSettings}
          durationMode={selectedDurationMode}
          startBoardIndex={startBoardIndex}
          onClose={onBack}
          setCustomHeaderConfig={setCustomHeaderConfig}
        />
      )}

      {/* 2. BACKGROUND PREP PROGRESS / LOADING / READY / FAILED VIEW */}
      {!isDurationModalOpen && !isPlayerActive && selectedDurationMode && (
        <LessonPrepProgressView
          status={
            isOpeningLesson
              ? {
                  state: 'preparing',
                  step: 3,
                  progressPercent: 95,
                  message: 'Loading lesson boards & audio package…',
                }
              : prepStatus
          }
          topicTitle={topicTitle}
          courseName={courseName}
          durationMinutes={selectedDurationMode}
          onOpenLesson={() => handleContinueLesson(selectedDurationMode)}
          onCancelJob={cancelJob}
          onLeaveBackground={() => {
            if (onBack) onBack();
            else if (onNavigate) onNavigate('chat');
          }}
          onRetry={() => handleContinueLesson(selectedDurationMode)}
        />
      )}
    </div>
  );
};

export default VoiceTutorialPage;
