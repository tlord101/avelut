import React, { useState, useEffect, useCallback } from 'react';
import type { PlaygroundProps, ViewState } from './playground/playgroundTypes';
import { PlaygroundHome } from './playground/PlaygroundHome';
import { PastQuestionViewer } from './playground/PastQuestionViewer';
import { FlashcardsNew, FlashcardsStudy } from './playground/FlashcardsFlow';
import { CBTNew, CBTExamTaker } from './playground/CBTFlow';

export const Playground: React.FC<PlaygroundProps> = ({
  userProfile,
  appSettings,
  onNavigate,
  setCustomHeaderConfig
}) => {
  const parsePathnameToViewState = (): ViewState => {
    if (typeof window === 'undefined') return { type: 'home' };
    const path = window.location.pathname;
    if (path.startsWith('/playground/past/')) {
      const packId = path.substring('/playground/past/'.length).split('/')[0];
      if (packId) return { type: 'past_viewer', packId };
    }
    if (path === '/playground/flashcards/new') {
      return { type: 'flashcards_new' };
    }
    if (path.startsWith('/playground/flashcards/')) {
      const deckId = path.substring('/playground/flashcards/'.length).split('/')[0];
      if (deckId && deckId !== 'new') return { type: 'flashcards_study', deckId };
    }
    if (path === '/playground/cbt/new') {
      return { type: 'cbt_new' };
    }
    if (path.startsWith('/playground/cbt/')) {
      const examId = path.substring('/playground/cbt/'.length).split('/')[0];
      if (examId && examId !== 'new') return { type: 'cbt_exam', examId };
    }
    return { type: 'home' };
  };

  const [viewState, setViewState] = useState<ViewState>(parsePathnameToViewState);

  useEffect(() => {
    const handlePopState = () => {
      setViewState(parsePathnameToViewState());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToView = useCallback((nextState: ViewState) => {
    setViewState(nextState);
    if (typeof window === 'undefined') return;
    let newPath = '/playground';
    if (nextState.type === 'past_viewer') {
      newPath = `/playground/past/${nextState.packId}`;
    } else if (nextState.type === 'flashcards_new') {
      newPath = '/playground/flashcards/new';
    } else if (nextState.type === 'flashcards_study') {
      newPath = `/playground/flashcards/${nextState.deckId}`;
    } else if (nextState.type === 'cbt_new') {
      newPath = `/playground/cbt/new`;
    } else if (nextState.type === 'cbt_exam') {
      newPath = `/playground/cbt/${nextState.examId}`;
    }
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
  }, []);

  useEffect(() => {
    if (!setCustomHeaderConfig) return;
    const backBtn = (
      <button
        onClick={() => navigateToView({ type: 'home' })}
        className="flex items-center gap-1 text-sm font-semibold text-neutral-400 hover:text-white transition"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>
    );

    if (viewState.type === 'home') {
      setCustomHeaderConfig({
        title: 'Playground',
        hideProfileAvatar: false,
      });
    } else if (viewState.type === 'past_viewer') {
      setCustomHeaderConfig({ title: 'Past Questions', leftActions: backBtn });
    } else if (viewState.type === 'flashcards_new') {
      setCustomHeaderConfig({ title: 'Generate Flashcards', leftActions: backBtn });
    } else if (viewState.type === 'flashcards_study') {
      setCustomHeaderConfig({ title: 'Study Deck', leftActions: backBtn });
    } else if (viewState.type === 'cbt_new') {
      setCustomHeaderConfig({ title: 'Generate CBT Exam', leftActions: backBtn });
    } else if (viewState.type === 'cbt_exam') {
      setCustomHeaderConfig({ title: 'CBT Exam', leftActions: backBtn });
    }
  }, [viewState, setCustomHeaderConfig, navigateToView]);

  if (viewState.type === 'past_viewer') {
    return (
      <PastQuestionViewer
        packId={viewState.packId}
        userProfile={userProfile}
        appSettings={appSettings}
        onBack={() => navigateToView({ type: 'home' })}
      />
    );
  }

  if (viewState.type === 'flashcards_new') {
    return (
      <FlashcardsNew
        userProfile={userProfile}
        appSettings={appSettings}
        onDeckCreated={(deckId) => navigateToView({ type: 'flashcards_study', deckId })}
      />
    );
  }

  if (viewState.type === 'flashcards_study') {
    return (
      <FlashcardsStudy
        deckId={viewState.deckId}
        userProfile={userProfile}
      />
    );
  }

  if (viewState.type === 'cbt_new') {
    return (
      <CBTNew
        userProfile={userProfile}
        appSettings={appSettings}
        onExamCreated={(examId) => navigateToView({ type: 'cbt_exam', examId })}
      />
    );
  }

  if (viewState.type === 'cbt_exam') {
    return (
      <CBTExamTaker
        examId={viewState.examId}
        userProfile={userProfile}
        onExit={() => navigateToView({ type: 'home' })}
      />
    );
  }

  return (
    <PlaygroundHome
      userProfile={userProfile}
      onNavigateView={navigateToView}
    />
  );
};

export default Playground;
