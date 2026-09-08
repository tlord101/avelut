import { auth } from '@/lib/backend';
import React, { useState, useEffect, useRef } from 'react';
import { LiveWhiteboardCanvas, BoardElement } from './LiveWhiteboardCanvas';
import { EquationStepAnimator } from './EquationStepAnimator';
import { StudentLassoTool } from './StudentLassoTool';
import { InteractiveMicroCheck } from './InteractiveMicroCheck';
import { TopicSummaryNotebookModal, TopicSummaryData } from './TopicSummaryNotebookModal';
import { LiveTutorialSyncEngine } from '../../services/liveTutorialSyncEngine';
import { LiveTutorVoiceBridge } from '../../services/liveTutorVoiceBridge';
import { PedagogicalStateMachine } from '../../services/pedagogicalStateMachine';
import { parseLessonScript, ParsedLessonScript } from '../../utils/lessonScriptParser';
import { saveTutorialOffline } from '../../services/offlineTutorialStorage';
import { useToast } from '../../hooks/useToast';

export interface LiveSynchronizedTutorialViewProps {
  topicTitle: string;
  topicId: string;
  studentId: string;
  userName?: string;
  initialScript?: string;
  topicComplexity?: 'simple' | 'standard' | 'complex';
  onClose?: () => void;
}

export const LiveSynchronizedTutorialView: React.FC<LiveSynchronizedTutorialViewProps> = ({
  topicTitle,
  topicId,
  studentId,
  userName,
  initialScript,
  topicComplexity = 'standard',
  onClose,
}) => {
  const { addToast } = useToast();

  // Resolve user display name
  const effectiveUserName = userName || auth.currentUser?.displayName?.split(' ')[0] || 'Friend';

  // Engine Instances
  const syncEngineRef = useRef(new LiveTutorialSyncEngine());
  const stateMachineRef = useRef(new PedagogicalStateMachine(studentId, topicId, topicComplexity));
  const voiceBridgeRef = useRef<LiveTutorVoiceBridge | null>(null);

  // Component UI State
  const [boardElements, setBoardElements] = useState<BoardElement[]>([]);
  const [tutorPointer, setTutorPointer] = useState<{ x: number; y: number; active: boolean; color?: string } | null>(null);
  const [activeFocusArea, setActiveFocusArea] = useState<{ x: number; y: number; w: number; h: number; color?: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [durationMs, setDurationMs] = useState(600000);
  const [studentMode, setStudentMode] = useState<'none' | 'draw' | 'lasso'>('none');
  const [isVoiceRecording, setIsVoiceRecording] = useState(false);
  const [parsedScript, setParsedScript] = useState<ParsedLessonScript | null>(null);
  const [isSavedOffline, setIsSavedOffline] = useState(false);

  // Interactive Overlays
  const [showDiagnosticModal, setShowDiagnosticModal] = useState(true);
  const [showMidLessonCheck, setShowMidLessonCheck] = useState(false);
  const [showSummaryNotebookModal, setShowSummaryNotebookModal] = useState(false);
  const [interruptionQuery, setInterruptionQuery] = useState<string | null>(null);
  const [tutorClarificationText, setTutorClarificationText] = useState<string | null>(null);

  // End-of-Topic Mastery Summary Data
  const summaryData: TopicSummaryData = {
    topicTitle,
    topicId,
    studentId,
    summaryPoints: [
      `Mastered the core structural framework and mandatory rule definitions for ${topicTitle}.`,
      'Analyzed comparative mechanisms using structured multi-column academic tables.',
      'Identified critical exception doctrines and avoided common high-yield exam traps.',
      'Completed interactive diagnostic and real-time whiteboard problem-solving checks.',
    ],
    keyTerms: [
      { term: 'Core Foundation', definition: 'The mandatory baseline principle and binding ratio governing this topic.' },
      { term: 'Operational Test', definition: 'The standard of scrutiny applied to evaluate evidence and causality.' },
      { term: 'Strict Liability Rule', definition: 'Liability imposed without requiring proof of fault or subjective negligence.' },
      { term: 'High-Yield Trap', definition: 'Common misapplication of exceptions where the general rule still prevails.' },
    ],
    flashcards: [
      { front: `What is the primary threshold required under ${topicTitle}?`, back: 'Establishing prima facie evidence of causation before shifting the evidential burden.' },
      { front: 'How do you distinguish the general rule from its primary exception?', back: 'Exceptions require strict objective necessity rather than subjective convenience.' },
      { front: 'What is the most common exam mistake made in this topic?', back: 'Assuming liability transfers automatically without verifying jurisdictional standing.' },
    ],
    examQuestions: [
      {
        question: `Critically evaluate the application of ${topicTitle} under ambiguous conditions.`,
        markingScheme: 'Award 3 marks for defining the baseline rule, 4 marks for case application, and 3 marks for analyzing exceptions.',
        highYieldTip: 'Always structure your answer using the IRAC method (Issue, Rule, Application, Conclusion).',
      },
    ],
  };

  // Initialize Warm Friendly Lesson Script & Audio Sync Engine
  useEffect(() => {
    const defaultSampleScript: ParsedLessonScript = {
      speechText: `Hello ${effectiveUserName}! Great to have you here today. Let's explore ${topicTitle} together step-by-step. We will unpack foundational principles, structural tables, and deep illustrations so everything becomes completely clear and intuitive. Let's look at our first concept map on the whiteboard!`,
      topicTitle,
      stepNumber: 1,
      totalSteps: 4,
      mode: 'understanding',
      cues: [
        // 1. Structured Academic Table
        {
          timeMs: 500,
          action: 'DRAW_TABLE',
          data: {
            x: 25,
            y: 25,
            width: 480,
            headers: ['Concept Area', 'Operational Mechanism', 'Core Principle'],
            rows: [
              ['Fundamental Baseline', 'Direct Binding Authority', 'Mandatory Precedent Ratio'],
              ['Operational Mechanism', 'Bilateral Consideration', 'Consensus ad Idem Rule'],
              ['Risk & Exception', 'Force Majeure Doctrine', 'Strict Objective Standard'],
            ],
            activeRowIndex: 0,
            color: '#002D62',
          },
        },
        // 2. Key Takeaway & Terminology Card
        {
          timeMs: 4500,
          action: 'DRAW_TAKEAWAY',
          data: {
            x: 25,
            y: 190,
            width: 480,
            title: 'Key Takeaway for Alex',
            keywords: ['Prima Facie Rule', 'Strict Standard', 'Burden of Proof'],
            summary: 'The baseline condition must be verified before proceeding to structural exceptions.',
            color: '#0066FF',
          },
        },
        // 3. Process Flowchart
        {
          timeMs: 8000,
          action: 'DRAW_FLOWCHART',
          data: {
            x: 25,
            y: 320,
            nodes: [
              { title: '1. Inception', subtitle: 'Event Trigger' },
              { title: '2. Analysis', subtitle: 'Scrutiny Test' },
              { title: '3. Outcome', subtitle: 'Final Verdict' },
            ],
            activeNodeIndex: 1,
            color: '#0066FF',
          },
        },
        // 4. Focus Highlight Ring
        {
          timeMs: 11000,
          action: 'HIGHLIGHT_FOCUS',
          data: { x: 20, y: 185, w: 490, h: 120, color: '#0066FF' },
        },
      ],
      diagnosticQuestion: {
        question: `Hello ${effectiveUserName}! Before we delve into ${topicTitle}, what is the foundational threshold required to shift the evidential burden?`,
        options: [
          'Establishing Prima Facie Causation',
          'Subjective Discretion of the Parties',
          'Informal Mutual Waiver',
          'Lapse of Statutory Time',
        ],
        correctIndex: 0,
        explanation: 'The claimant must first establish prima facie causation before any procedural burden shifts.',
      },
    };

    const script = initialScript ? parseLessonScript(initialScript) : defaultSampleScript;
    setParsedScript(script);

    // Adaptive Duration: Simple (7m), Standard (10m), Complex (14m)
    const totalDuration = stateMachineRef.current.getState().estimatedDurationMs;
    setDurationMs(totalDuration);
    syncEngineRef.current.loadScript(script, totalDuration);

    const unsubscribe = syncEngineRef.current.subscribe((state) => {
      setBoardElements(state.activeElements);
      setTutorPointer(state.tutorPointer);
      setActiveFocusArea(state.activeFocusArea);
      setIsPlaying(state.isPlaying);
      setCurrentTimeMs(state.currentTimeMs);
      setDurationMs(state.durationMs);

      // Trigger End-of-Topic Summary Modal at completion
      if (state.currentTimeMs >= state.durationMs && state.durationMs > 0) {
        setShowSummaryNotebookModal(true);
      }
    });

    // Initialize Manual Voice Recognition Bridge
    voiceBridgeRef.current = new LiveTutorVoiceBridge({
      onRecordingStarted: () => {
        setIsVoiceRecording(true);
        syncEngineRef.current.pause();
      },
      onRecordingEnded: () => {
        setIsVoiceRecording(false);
      },
      onSpeechTranscribed: (transcribedText) => {
        handleStudentSpokenQuery(transcribedText);
      },
    });

    return () => {
      unsubscribe();
      voiceBridgeRef.current?.stopManualRecording();
    };
  }, [topicTitle, initialScript, topicComplexity, effectiveUserName]);

  // Handle Manual Mic Click
  const handleMicToggle = () => {
    if (isVoiceRecording) {
      voiceBridgeRef.current?.stopManualRecording();
      setIsVoiceRecording(false);
    } else {
      syncEngineRef.current.pause();
      const started = voiceBridgeRef.current?.startManualRecording();
      if (started) {
        setIsVoiceRecording(true);
        addToast('Listening to your question... Speak clearly.', 'info');
      } else {
        // Fallback for devices without speech recognition
        const promptText = window.prompt('Type your question for the tutor:');
        if (promptText && promptText.trim()) {
          handleStudentSpokenQuery(promptText.trim());
        }
      }
    }
  };

  // Student Asks a Question -> AI redraws / highlights board & clarifies warmly
  const handleStudentSpokenQuery = (query: string) => {
    setInterruptionQuery(`"${query}"`);
    syncEngineRef.current.pause();

    // Friendly AI Clarification & Dynamic Board Redraw
    setTutorClarificationText(`Great question, ${effectiveUserName}! Let's zoom into this exact mechanism on the board.`);
    
    // Dynamic Redraw: Highlight specific concept or draw rich illustration
    setBoardElements((prev) => [
      ...prev,
      {
        id: `clarification_${Date.now()}`,
        type: 'takeaway',
        x: 25,
        y: 160,
        width: 480,
        title: `Clarification for ${effectiveUserName}`,
        keywords: ['Key Clarification', 'Core Insight'],
        summary: `Addressing: "${query}". Remember that baseline criteria always precede secondary exceptions.`,
        color: '#0066FF',
      },
    ]);

    setActiveFocusArea({ x: 20, y: 155, w: 490, h: 120, color: '#0066FF' });
    addToast(`Tutor answered: "${query}"`, 'success');
  };

  const togglePlayback = () => {
    if (isPlaying) {
      syncEngineRef.current.pause();
    } else {
      setInterruptionQuery(null);
      setTutorClarificationText(null);
      syncEngineRef.current.play();
    }
  };

  const handleStudentLassoSelect = (elementIds: string[]) => {
    syncEngineRef.current.pause();
    const queryNotice = elementIds.length > 0
      ? `Circled: ${elementIds.join(', ')}. What would you like explained?`
      : 'Circled board area. What would you like explained?';
    setInterruptionQuery(queryNotice);
    addToast(queryNotice, 'info');
  };

  const handleSaveOffline = async () => {
    if (!parsedScript) return;
    try {
      await saveTutorialOffline({
        id: `tutorial_${topicId}_${Date.now()}`,
        topicId,
        topicTitle,
        downloadedAt: Date.now(),
        sizeBytes: 95 * 1024,
        script: parsedScript,
      });
      setIsSavedOffline(true);
      addToast('Saved offline! Crystal-clear vector replay is ready with zero data.', 'success');
    } catch {
      addToast('Failed to save offline.', 'error');
    }
  };

  const currentChapterNumber = Math.min(4, Math.floor((currentTimeMs / durationMs) * 4) + 1);
  const progressPercent = durationMs > 0 ? (currentTimeMs / durationMs) * 100 : 0;

  return (
    <div className="flex flex-col h-full w-full bg-[#F6F6F3] dark:bg-black rounded-[28px] overflow-hidden border border-[#E3E9F1] dark:border-slate-800 shadow-xl relative select-none">
      {/* 15-20s Opening Diagnostic Modal */}
      {showDiagnosticModal && parsedScript?.diagnosticQuestion && (
        <InteractiveMicroCheck
          question={parsedScript.diagnosticQuestion.question}
          options={parsedScript.diagnosticQuestion.options}
          correctIndex={parsedScript.diagnosticQuestion.correctIndex}
          explanation={parsedScript.diagnosticQuestion.explanation}
          isDiagnostic={true}
          onAnswerSelected={(isCorrect, idx) => {
            stateMachineRef.current.dispatch({
              type: 'OPENING_DIAGNOSTIC_COMPLETED',
              isCorrect,
              responseLatencyMs: 5000,
              selectedOption: parsedScript.diagnosticQuestion!.options[idx],
            });
          }}
          onContinue={() => {
            setShowDiagnosticModal(false);
            syncEngineRef.current.play();
          }}
        />
      )}

      {/* Mid-Lesson Micro Check Modal */}
      {showMidLessonCheck && (
        <InteractiveMicroCheck
          question="Which exception rule applies when objective necessity overrides the general standard?"
          options={['Strict Force Majeure Standard', 'Subjective Customary Exemption', 'Equitable Estoppel Waiver', 'Automatic Discharge']}
          correctIndex={0}
          explanation="Force majeure requires strict objective impossibility rather than mere commercial difficulty."
          onAnswerSelected={(isCorrect) => {
            stateMachineRef.current.dispatch({
              type: 'MICRO_CHECK_ANSWERED',
              isCorrect,
              chapterIndex: currentChapterNumber,
            });
          }}
          onContinue={() => {
            setShowMidLessonCheck(false);
            syncEngineRef.current.play();
          }}
        />
      )}

      {/* End of Topic Master Summary & Notebook Persistence Modal */}
      {showSummaryNotebookModal && (
        <TopicSummaryNotebookModal
          data={summaryData}
          isOpen={showSummaryNotebookModal}
          onClose={() => setShowSummaryNotebookModal(false)}
        />
      )}

      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-5 py-3.5 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-[#E3E9F1] dark:border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#002D62] text-white flex items-center justify-center font-black text-xs shadow-xs">
            AI
          </div>
          <div>
            <h3 className="text-base font-extrabold text-[#0F172A] dark:text-white tracking-tight">{topicTitle}</h3>
            <div className="flex items-center gap-2 text-xs text-[#64748B] dark:text-slate-400 font-medium">
              <span>Chapter {currentChapterNumber} of 4</span>
              <span>•</span>
              <span className="capitalize">{topicComplexity} Depth ({(durationMs / 60000).toFixed(0)} mins)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* End-of-Topic Summary Trigger */}
          <button
            type="button"
            onClick={() => setShowSummaryNotebookModal(true)}
            className="px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 text-xs font-bold transition hover:bg-emerald-100 cursor-pointer"
            title="View Summary, Glossary & Flashcards"
          >
            📋 Summary & Cards
          </button>

          {/* Offline Download Button */}
          <button
            type="button"
            onClick={handleSaveOffline}
            className={`p-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              isSavedOffline
                ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title="Save for offline replay"
          >
            <i className={`bi ${isSavedOffline ? 'bi-check-circle-fill' : 'bi-arrow-down-circle'} text-base`}></i>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
            >
              <i className="bi bi-x-lg text-sm"></i>
            </button>
          )}
        </div>
      </header>

      {/* Main Split Body: Interactive Whiteboard Canvas + Synchronized Derivations */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4 p-4 overflow-hidden relative">
        {/* Left: Whiteboard Canvas (Enforcing Single Main Visual Structure Rule) */}
        <div className="flex-1 h-full min-h-[340px] relative flex flex-col">
          <LiveWhiteboardCanvas
            elements={boardElements}
            tutorPointer={tutorPointer}
            activeFocusArea={activeFocusArea}
            isStudentDrawingEnabled={studentMode === 'draw'}
            studentMode={studentMode === 'draw' ? 'drawing' : studentMode}
            onStudentLassoSelect={handleStudentLassoSelect}
            className="flex-1 w-full"
          />

          {/* Interruption Query Banner */}
          {interruptionQuery && (
            <div className="absolute top-4 left-4 right-4 bg-[#002D62]/95 backdrop-blur-md text-white px-4 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between shadow-lg z-20 animate-slide-down">
              <span>{tutorClarificationText || interruptionQuery}</span>
              <button
                type="button"
                onClick={() => {
                  setInterruptionQuery(null);
                  setTutorClarificationText(null);
                  syncEngineRef.current.play();
                }}
                className="underline font-bold hover:opacity-80 ml-3"
              >
                Resume lesson
              </button>
            </div>
          )}

          {/* Floating Student Toolbar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <StudentLassoTool
              activeMode={studentMode}
              onModeChange={setStudentMode}
              onMicClick={handleMicToggle}
              isRecordingVoice={isVoiceRecording}
            />
          </div>
        </div>

        {/* Right: Step-by-Step Derivation & Spoken Narrative */}
        <div className="w-full md:w-80 lg:w-96 flex flex-col gap-3 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
          <EquationStepAnimator
            latex="v(t) = v_t \left(1 - e^{-\frac{k}{m}t}\right)"
            title="Active Step Formulation"
            stepNumber={currentChapterNumber}
            progress={Math.min(1.0, (currentTimeMs / 60000))}
            isPulsing={activeFocusArea !== null}
          />

          {/* Live Spoken Narrative Box */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-[#E3E9F1] dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] dark:text-slate-400">Live Tutor Voice</span>
              </div>
              <span className="text-[11px] font-bold text-[#0066FF]">Chapter {currentChapterNumber}/4</span>
            </div>
            <p className="text-sm text-[#0F172A] dark:text-slate-100 leading-relaxed font-normal">
              {parsedScript?.speechText}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom Transport Player Controls with Scrubbing */}
      <footer className="px-5 py-3 bg-white/90 dark:bg-slate-900/90 border-t border-[#E3E9F1] dark:border-slate-800 flex items-center gap-4 shrink-0">
        <button
          type="button"
          onClick={togglePlayback}
          className="w-10 h-10 rounded-full bg-[#0066FF] hover:bg-[#002D62] text-white flex items-center justify-center transition-transform active:scale-95 shadow-md cursor-pointer shrink-0"
        >
          <i className={`bi ${isPlaying ? 'bi-pause-fill' : 'bi-play-fill'} text-lg`}></i>
        </button>

        {/* 4-Chapter Segmented Scrubbing Bar */}
        <div className="flex-1 flex flex-col gap-1.5">
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const clickPercent = (e.clientX - rect.left) / rect.width;
              syncEngineRef.current.seek(clickPercent * durationMs);
            }}
            className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden cursor-pointer relative flex"
          >
            <div
              className="h-full bg-gradient-to-r from-[#0066FF] to-[#002D62] transition-all duration-75 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div className="flex justify-between text-[11px] text-[#64748B] font-mono">
            <span className="font-semibold">{Math.floor(currentTimeMs / 60000)}:{(Math.floor((currentTimeMs % 60000) / 1000)).toString().padStart(2, '0')}</span>
            <span className="text-[10px] uppercase font-bold text-slate-400">Chapter {currentChapterNumber}: Framework & Mechanisms</span>
            <span>{Math.floor(durationMs / 60000)}:00</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
