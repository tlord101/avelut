/**
 * Teaching Engine Service — Live Lecturer Single-Board Teaching Runtime
 *
 * Orchestrates:
 * 1) Teaching Structure Generation (Request 1)
 * 2) Sequential Board Performance Generation (Request 2) with 1-Board Prefetching
 * 3) Speech + Board Writing + SVG Component Reveal Synchronization
 * 4) Inter-board Clearing & Timing Pauses
 * 5) Final Mini Test Generation (Request 3)
 */

import {
  TeachingStructure,
  TeachingBoardPlan,
  TeachingBoardPerformance,
  BoardAction,
  SpeechBeat,
  StudentAnswerEvaluation,
  FinalTest,
  TeachingRuntimeState,
  TeachingSegment,
} from '../types/teachingScript';
import {
  TEACHING_DIRECTOR_SYSTEM_PROMPT,
  buildTeachingStructurePrompt,
  buildUnifiedTeachingStructuresPrompt,
  buildSingleBoardPrompt,
  buildFinalTestPrompt,
  buildStudentAnswerEvaluationPrompt,
} from './teachingEnginePrompt';
import { createAvelutAI, getResponseText } from '../utils/inference';
import { cleanAndParseJson } from '../utils/jsonUtils';
import { saveTeachingStructureOnly, topicKeyFromTitle } from './liveTeachingProgressService';
import { supabaseDataService } from './supabaseDataService';
import { unifiedVoiceRouter } from './voice/UnifiedVoiceRouter';
import { sanitizeSvg } from '../utils/svgSanitizer';
import { normalizeBoardActions } from './boardActionNormalize';
import { AppSettings, UserProfile } from '../types';

function getLocalCacheKey(prefix: string, topic: string, keySuffix: string | number): string {
  const cleanTopic = (topic || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  return `avelut_board_cache_${prefix}_${cleanTopic}_${keySuffix}`;
}

function getCachedBoardItem<T>(key: string): T | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch (e) {
    console.warn('[BoardCache] Read error:', e);
  }
  return null;
}

function setCachedBoardItem<T>(key: string, data: T): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('[BoardCache] Write error:', e);
  }
}

export interface TeachingEngineListener {
  onStructureLoaded?: (structure: TeachingStructure) => void;
  onBoardLoaded?: (performance: TeachingBoardPerformance) => void;
  onSegmentLoaded?: (segment: TeachingSegment) => void;
  onSpokenWord?: (word: string, phraseIndex: number) => void;
  onBoardActionTriggered?: (action: BoardAction) => void;
  onBeatTriggered?: (beat: SpeechBeat) => void;
  onQuestionAsked?: (question: NonNullable<TeachingBoardPerformance['question']>) => void;
  onAnswerEvaluated?: (evaluation: StudentAnswerEvaluation) => void;
  onAudioPlaybackStateChanged?: (isPlaying: boolean) => void;
  onStateChanged?: (state: TeachingRuntimeState) => void;
  onFinalTestGenerated?: (finalTest: FinalTest) => void;
  onError?: (error: Error) => void;
}

function wordsPerSecond(speed: number): number {
  return Math.max(2.2, 2.55 * speed);
}

function phraseWordOffset(speech: string, phrase: string | undefined): number {
  if (!phrase) return -1;
  const speechLower = speech.toLowerCase();
  const phraseLower = phrase.toLowerCase().trim();
  if (!phraseLower) return -1;

  // 1. Exact phrase substring match
  const charIdx = speechLower.indexOf(phraseLower);
  if (charIdx !== -1) {
    return speechLower.slice(0, charIdx).trim().split(/\s+/).filter(Boolean).length;
  }

  // 2. Significant keyword match (find first significant word from phrase in speech)
  const cleanPhrase = phraseLower.replace(/[^a-z0-9\s]/g, ' ');
  const keywords = cleanPhrase.split(/\s+/).filter((w) => w.length >= 4);

  for (const kw of keywords) {
    const idx = speechLower.indexOf(kw);
    if (idx !== -1) {
      return speechLower.slice(0, idx).trim().split(/\s+/).filter(Boolean).length;
    }
  }

  return -1;
}

export class TeachingEngineService {
  private appSettings: AppSettings;
  private userProfile: UserProfile | null;
  private voice: string = 'Altair';
  private listeners: Set<TeachingEngineListener> = new Set();
  private isDestroyed = false;
  private activeAudioPlayer: any = null;
  private activeTimers: ReturnType<typeof setTimeout>[] = [];
  private isPaused = false;

  private currentStructure: TeachingStructure | null = null;
  private currentBoardPerformance: TeachingBoardPerformance | null = null;
  private currentBoardIndex: number = 0;
  private runtimeState: TeachingRuntimeState = 'IDLE';

  // 1-Board-Ahead Prefetch Cache State
  private prefetchedBoardPerformance: TeachingBoardPerformance | null = null;
  private prefetchedBoardIndex: number | null = null;
  private currentSessionId: string = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  constructor(appSettings: AppSettings, userProfile: UserProfile | null = null, voice: string = 'Altair') {
    this.appSettings = appSettings;
    this.userProfile = userProfile;
    this.voice = voice || 'Altair';
  }

  public setVoice(voice: string) {
    this.voice = voice;
  }

  public getVoice(): string {
    return this.voice;
  }

  public updateSettings(newSettings: AppSettings, newProfile?: UserProfile | null) {
    this.appSettings = newSettings;
    if (newProfile !== undefined) this.userProfile = newProfile;
  }

  public subscribe(listener: TeachingEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getRuntimeState(): TeachingRuntimeState {
    return this.runtimeState;
  }

  private setRuntimeState(newState: TeachingRuntimeState) {
    this.runtimeState = newState;
    this.listeners.forEach((l) => l.onStateChanged?.(newState));
  }

  public getCurrentStructure(): TeachingStructure | null {
    return this.currentStructure;
  }

  public setStructure(structure: TeachingStructure) {
    this.currentStructure = structure;
    this.currentBoardIndex = 0;
  }

  public getCurrentBoardPerformance(): TeachingBoardPerformance | null {
    return this.currentBoardPerformance;
  }

  public getCurrentBoardIndex(): number {
    return this.currentBoardIndex;
  }

  public pauseLesson() {
    this.isPaused = true;
    this.activeTimers.forEach((t) => clearTimeout(t));
    this.activeTimers = [];
    if (this.activeAudioPlayer) {
      try {
        if (typeof this.activeAudioPlayer.pause === 'function') this.activeAudioPlayer.pause();
        else if (typeof this.activeAudioPlayer.stop === 'function') this.activeAudioPlayer.stop();
      } catch (_) {}
    }
    unifiedVoiceRouter.stopAudio();
    this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(false));
  }

  public resumeLesson() {
    this.isPaused = false;
    if (this.currentBoardPerformance) {
      this.playBoardSpeech(this.currentBoardPerformance);
    }
  }

  /**
   * ONE SINGLE AI API CALL to generate teaching structures for ALL THREE duration modes (15m, 30m, 60m).
   */
  public async generateUnifiedAllTeachingStructures(params: {
    topic: string;
    courseName?: string;
    syllabusContext?: string;
    studentName?: string;
  }): Promise<{ 15: TeachingStructure | null; 30: TeachingStructure | null; 60: TeachingStructure | null }> {
    const defaultResult = { 15: null, 30: null, 60: null };
    try {
      const ai = createAvelutAI(this.appSettings, this.userProfile);
      if (!ai) return defaultResult;

      const prompt = buildUnifiedTeachingStructuresPrompt(params);
      const rawResponse = await ai.chat(prompt, TEACHING_DIRECTOR_SYSTEM_PROMPT);
      const parsed = cleanAndParseJson<any>(rawResponse);

      if (!parsed) return defaultResult;

      const s15: TeachingStructure | null =
        parsed.mode_15?.boards && Array.isArray(parsed.mode_15.boards) && parsed.mode_15.boards.length > 0
          ? parsed.mode_15
          : null;

      const s30: TeachingStructure | null =
        parsed.mode_30?.boards && Array.isArray(parsed.mode_30.boards) && parsed.mode_30.boards.length > 0
          ? parsed.mode_30
          : null;

      const s60: TeachingStructure | null =
        parsed.mode_60?.boards && Array.isArray(parsed.mode_60.boards) && parsed.mode_60.boards.length > 0
          ? parsed.mode_60
          : null;

      return { 15: s15, 30: s30, 60: s60 };
    } catch (err) {
      console.warn('[TeachingEngineService] Unified 1-call prefetch failed:', err);
      return defaultResult;
    }
  }

  /**
   * Background prefetch topic teaching structures for all 3 duration modes (15m, 30m, 60m).
   * Saves each generated structure in localStorage so selecting any duration mode returns instantly.
   */
  public async prefetchAllDurationStructures(params: {
    topic: string;
    courseName?: string;
    syllabusContext?: string;
    studentName?: string;
  }): Promise<void> {
    const modes: (15 | 30 | 60)[] = [15, 30, 60];
    const prefetchPromises = modes.map(async (mode) => {
      const structCacheKey = getLocalCacheKey('struct', params.topic, mode);
      const cached = getCachedBoardItem<TeachingStructure>(structCacheKey);
      if (cached && Array.isArray(cached.boards) && cached.boards.length > 0) {
        return; // Already cached in localStorage
      }
      try {
        await this.generateTeachingStructure({
          ...params,
          durationMode: mode,
          isPrefetch: true,
        });
      } catch (err) {
        console.warn(`[TeachingEngine] Background prefetch failed for duration mode ${mode}:`, err);
      }
    });
    await Promise.allSettled(prefetchPromises);
  }

  /**
   * REQUEST 1: Generate Teaching Structure for Topic
   */
  public async generateTeachingStructure(params: {
    topic: string;
    courseName?: string;
    syllabusContext?: string;
    studentName?: string;
    durationMode?: any;
    isPrefetch?: boolean;
  }): Promise<TeachingStructure | null> {
    if (!params.isPrefetch) {
      this.setRuntimeState('PREPARING');
      this.currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      this.prefetchedBoardPerformance = null;
      this.prefetchedBoardIndex = null;
    }

    let structure: TeachingStructure | null = null;
    const durationMode = params.durationMode || 30;
    const structCacheKey = getLocalCacheKey('struct', params.topic, durationMode);

    // 1. Instant local storage cache lookup (0ms loading)
    const cachedStruct = getCachedBoardItem<TeachingStructure>(structCacheKey);
    if (cachedStruct && Array.isArray(cachedStruct.boards) && cachedStruct.boards.length > 0) {
      if (!params.isPrefetch) {
        this.currentStructure = cachedStruct;
        this.currentBoardIndex = 0;
        this.listeners.forEach((l) => l.onStructureLoaded?.(cachedStruct));
      }
      return cachedStruct;
    }

    // 2. Check Supabase database for pre-generated topic structure (shared across users)
    const dbStruct = await supabaseDataService.getTopicTeachingStructureSupabase(params.topic, params.courseName, durationMode);
    if (dbStruct && Array.isArray(dbStruct.boards) && dbStruct.boards.length > 0) {
      setCachedBoardItem(structCacheKey, dbStruct);
      if (!params.isPrefetch) {
        this.currentStructure = dbStruct;
        this.currentBoardIndex = 0;
        this.listeners.forEach((l) => l.onStructureLoaded?.(dbStruct));
      }
      return dbStruct;
    }

    try {
      const ai = createAvelutAI(this.appSettings, this.userProfile);
      if (!ai) throw new Error('AI client could not be initialized');

      const resolvedStudentName = params.studentName || this.userProfile?.display_name || 'Student';
      const prompt = buildTeachingStructurePrompt({
        ...params,
        studentName: resolvedStudentName,
      });

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const responseStream = await ai.models.generateContentStream({
            model: this.appSettings.alibaba_model || 'qwen3.7-flash',
            contents: [{ role: 'user', parts: [{ text: `${TEACHING_DIRECTOR_SYSTEM_PROMPT}\n\n${prompt}` }] }],
            config: {
              responseMimeType: 'application/json',
              temperature: attempt === 1 ? 0.3 : 0.2,
            },
          });

          let rawText = '';
          for await (const chunk of responseStream) {
            const chunkText = getResponseText(chunk);
            rawText += chunkText;
          }

          if (rawText && rawText.trim().length > 0) {
            structure = cleanAndParseJson<TeachingStructure>(rawText);
            if (structure && Array.isArray(structure.boards) && structure.boards.length > 0) {
              break;
            }
          }
        } catch (attemptErr) {
          console.warn(`[TeachingEngine] Structure generation attempt ${attempt} failed:`, attemptErr);
        }
        if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 400));
      }

      if (!structure || !structure.boards || !Array.isArray(structure.boards) || structure.boards.length === 0) {
        console.warn('[TeachingEngine] AI structure generation failed after 3 attempts, creating fallback structure');
        structure = this.buildFallbackTeachingStructure(params.topic, durationMode);
      }

      const userId = this.userProfile?.uid || 'anon';
      const topicKey = topicKeyFromTitle(params.topic, params.courseName);
      void saveTeachingStructureOnly(userId, topicKey, structure, durationMode || 30, params.courseName);
      setCachedBoardItem(structCacheKey, structure);

      if (!params.isPrefetch) {
        this.currentStructure = structure;
        this.currentBoardIndex = 0;
        this.listeners.forEach((l) => l.onStructureLoaded?.(structure!));
      }
      return structure;
    } catch (err: any) {
      console.error('[TeachingEngine] Error generating structure:', err);
      const fallback = this.buildFallbackTeachingStructure(params.topic, durationMode);
      if (!params.isPrefetch) {
        this.currentStructure = fallback;
        this.currentBoardIndex = 0;
        this.listeners.forEach((l) => l.onStructureLoaded?.(fallback));
      }
      return fallback;
    }
  }

  private buildFallbackTeachingStructure(topic: string, mode?: any): TeachingStructure {
    const durationMinutes = typeof mode === 'number' ? mode : (parseInt(String(mode), 10) || 30);
    // 15m mode -> 8 boards, 30m mode -> 15 boards, 60m mode -> 30 boards (~2 mins per board)
    const boardCount = durationMinutes === 15 ? 8 : durationMinutes === 60 ? 30 : 15;
    const boards: TeachingBoardPlan[] = [];

    for (let i = 1; i <= boardCount; i++) {
      boards.push({
        board_id: `board_${i}`,
        board_number: i,
        title: i === 1 ? `Introduction to ${topic}` : i === boardCount ? `Summary & Key Takeaways` : `${topic} - Core Concept ${i - 1}`,
        teaching_objective: `Master key concept ${i} for ${topic}`,
        what_student_should_understand: `Understanding aspect ${i} of ${topic}`,
        why_this_board_exists: `Build foundational mastery of ${topic}`,
        visual_purpose: `Diagram and key formula for ${topic}`,
        recommended_board_content: [`${topic} Core Point ${i}`],
        interaction_required: false,
        question_required: false,
        question_type: null,
        estimated_duration_seconds: 120,
      });
    }

    return {
      topic,
      teaching_strategy: `Paced ~2-minute per board live lecture for ${durationMinutes}m mode`,
      learning_goal: `Master core principles and applications of ${topic}`,
      duration_minutes: durationMinutes,
      boards,
    };
  }

  private buildFallbackBoardPerformance(boardPlan: TeachingBoardPlan): TeachingBoardPerformance {
    const boardNum = boardPlan.board_number || this.currentBoardIndex + 1;
    const boardTitle = boardPlan.title || `Board ${boardNum}`;
    const takeaways = boardPlan.recommended_board_content || boardPlan.key_concepts || [boardPlan.teaching_objective || boardTitle];
    const safeTopic = this.currentStructure?.topic || 'Academic Concept';

    const actions: BoardAction[] = [
      {
        id: `act_title_${boardNum}`,
        type: 'write',
        content: boardTitle,
        position: { x: 50, y: 10 },
        metadata: { fontSize: '3xl', color: '#FFFFFF' },
        sync: { triggerImmediately: true },
      },
      ...takeaways.slice(0, 4).map((kt, idx) => ({
        id: `act_kt_${boardNum}_${idx}`,
        type: 'write' as const,
        content: `• ${kt}`,
        position: { x: 18, y: 22 + idx * 5.5 },
        metadata: { fontSize: '2xl' as const, color: '#E2E8F0' },
        sync: { phrase: kt },
      })),
    ];

    return {
      board_id: `board_fb_${boardNum}`,
      board_number: boardNum,
      title: boardTitle,
      speech: `Welcome to this board on ${boardTitle}. Let's explore the core principles of ${safeTopic} step-by-step.`,
      speech_beats: [
        {
          id: `beat_fb_1`,
          text: `Welcome to this board on ${boardTitle}.`,
          purpose: 'introduce title',
          board_actions: [actions[0]],
        },
      ],
      board_actions: normalizeBoardActions(actions),
    };
  }

  /**
   * REQUEST 2: Generate Detailed Teaching Performance for ONE Board
   * Uses 1-board-ahead prefetch cache when available.
   */
  public async loadBoardPerformance(params: {
    boardIndex: number;
    studentName?: string;
    completedBoardsSummary?: string[];
  }): Promise<TeachingBoardPerformance | null> {
    if (!this.currentStructure || !this.currentStructure.boards[params.boardIndex]) {
      console.error('[TeachingEngine] Invalid board index or structure missing');
      return null;
    }

    const requestedIndex = params.boardIndex;
    const sessionTag = this.currentSessionId;

    // Deduct 2 minutes for this board from user's live tutorial balance in Supabase
    const userId = this.userProfile?.uid;
    if (userId && userId !== 'anon') {
      void supabaseDataService.deductLiveMinutes(userId, 2);
    }

    // Check if Board N was pre-fetched in background
    if (this.prefetchedBoardIndex === requestedIndex && this.prefetchedBoardPerformance) {
      const cached = this.prefetchedBoardPerformance;
      this.prefetchedBoardPerformance = null;
      this.prefetchedBoardIndex = null;
      this.currentBoardIndex = requestedIndex;
      this.currentBoardPerformance = cached;

      this.listeners.forEach((l) => l.onBoardLoaded?.(cached));
      this.emitLegacySegment(cached);

      // Trigger prefetch for Board N+1
      this.prefetchNextBoard(requestedIndex + 1, params.studentName, params.completedBoardsSummary, sessionTag);
      return cached;
    }

    this.setRuntimeState('PREPARING');
    this.currentBoardIndex = requestedIndex;
    const boardPlan: TeachingBoardPlan = this.currentStructure.boards[requestedIndex];

    const boardNum = requestedIndex + 1;
    const perfCacheKey = getLocalCacheKey('perf', this.currentStructure.topic, boardNum);

    // Instant local storage cache lookup (0ms board loading)
    const cachedPerf = getCachedBoardItem<TeachingBoardPerformance>(perfCacheKey);
    if (cachedPerf && (cachedPerf.title || cachedPerf.speech || cachedPerf.board_actions)) {
      this.currentBoardPerformance = cachedPerf;
      this.listeners.forEach((l) => l.onBoardLoaded?.(cachedPerf));
      this.emitLegacySegment(cachedPerf);
      this.prefetchNextBoard(requestedIndex + 1, params.studentName, params.completedBoardsSummary, sessionTag);
      return cachedPerf;
    }

    try {
      const performance = await this.fetchSingleBoardFromAI(
        boardPlan,
        params.studentName,
        params.completedBoardsSummary
      );

      if (this.currentSessionId !== sessionTag || this.isDestroyed) {
        return null;
      }

      this.currentBoardPerformance = performance;
      this.listeners.forEach((l) => l.onBoardLoaded?.(performance));
      this.emitLegacySegment(performance);

      // Trigger background prefetch for Board N+1
      this.prefetchNextBoard(requestedIndex + 1, params.studentName, params.completedBoardsSummary, sessionTag);

      return performance;
    } catch (err: any) {
      console.error('[TeachingEngine] Error loading board performance:', err);
      const fallback = this.buildFallbackBoardPerformance(boardPlan);
      this.currentBoardPerformance = fallback;
      this.listeners.forEach((l) => l.onBoardLoaded?.(fallback));
      this.emitLegacySegment(fallback);
      return fallback;
    }
  }

  /**
   * Prefetch Board N+1 in the background without blocking active board playback
   */
  private async prefetchNextBoard(
    nextIndex: number,
    studentName?: string,
    completedSummary?: string[],
    sessionTag?: string
  ) {
    if (!this.currentStructure || !this.currentStructure.boards[nextIndex]) return;
    if (this.currentSessionId !== sessionTag) return;

    const boardPlan = this.currentStructure.boards[nextIndex];
    try {
      const perf = await this.fetchSingleBoardFromAI(boardPlan, studentName, completedSummary);
      if (this.currentSessionId === sessionTag && !this.isDestroyed) {
        this.prefetchedBoardPerformance = perf;
        this.prefetchedBoardIndex = nextIndex;
      }
    } catch (err) {
      console.warn('[TeachingEngine] Background prefetch failed for board', nextIndex, err);
    }
  }

  private async fetchSingleBoardFromAI(
    boardPlan: TeachingBoardPlan,
    studentName?: string,
    completedBoardsSummary?: string[]
  ): Promise<TeachingBoardPerformance> {
    const ai = createAvelutAI(this.appSettings, this.userProfile);
    if (!ai) throw new Error('AI client could not be initialized');

    const resolvedStudentName = studentName || this.userProfile?.display_name || 'Student';
    const prompt = buildSingleBoardPrompt({
      topic: this.currentStructure!.topic,
      fullStructure: this.currentStructure!,
      currentBoardPlan: boardPlan,
      studentName: resolvedStudentName,
      completedBoardsSummary,
    });

    let performance: TeachingBoardPerformance | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const responseStream = await ai.models.generateContentStream({
          model: this.appSettings.alibaba_model || 'qwen3.7-flash',
          contents: [{ role: 'user', parts: [{ text: `${TEACHING_DIRECTOR_SYSTEM_PROMPT}\n\n${prompt}` }] }],
          config: {
            responseMimeType: 'application/json',
            temperature: attempt === 1 ? 0.35 : 0.2,
          },
        });

        let rawText = '';
        for await (const chunk of responseStream) {
          const chunkText = getResponseText(chunk);
          rawText += chunkText;
        }

        if (rawText && rawText.trim().length > 0) {
          performance = cleanAndParseJson<TeachingBoardPerformance>(rawText);
          if (performance && (performance.title || performance.speech || performance.board_actions)) {
            break;
          }
        }
      } catch (attemptErr) {
        console.warn(`[TeachingEngine] Streaming board performance attempt ${attempt} failed:`, attemptErr);
      }
      if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 300));
    }

    if (!performance) {
      console.warn('[TeachingEngine] AI board performance failed after 3 attempts, creating fallback performance');
      performance = this.buildFallbackBoardPerformance(boardPlan);
    }

    if (performance.svg_illustration && typeof performance.svg_illustration === 'string') {
      let raw = performance.svg_illustration.trim();
      raw = raw.replace(/^```(?:xml|svg|html)?\s*/i, '').replace(/```$/i, '').trim();
      const match = raw.match(/<svg[\s\S]*?<\/svg>/i);
      performance.svg_illustration = match ? match[0] : raw;
    }

    // Collect and merge all board_actions from speech_beats into performance.board_actions
    const combinedActions: BoardAction[] = [...(performance.board_actions || [])];
    const existingIds = new Set(combinedActions.map((a) => a.id).filter(Boolean));

    if (Array.isArray(performance.speech_beats)) {
      for (const beat of performance.speech_beats) {
        if (Array.isArray(beat.board_actions)) {
          for (const act of beat.board_actions) {
            if (act && act.type) {
              const actId = act.id || `act_beat_${Math.random().toString(36).substring(2, 6)}`;
              act.id = actId;
              if (!existingIds.has(actId)) {
                existingIds.add(actId);
                combinedActions.push(act);
              }
            }
          }
        }
      }
    }

    performance.board_actions = normalizeBoardActions(combinedActions);
    if (performance.speech_beats?.length) {
      performance.speech_beats = performance.speech_beats.map((b) => ({
        ...b,
        board_actions: normalizeBoardActions(b.board_actions),
      }));
    }

    if (performance.svg_illustration) {
      const hasSvgAction = (performance.board_actions || []).some(
        (a) => a.type === 'draw' && a.metadata?.svgContent
      );
      if (!hasSvgAction) {
        const svgAction: BoardAction = {
          id: `svg_ill_${performance.board_number}`,
          type: 'draw',
          position: { x: 50, y: 65 },
          metadata: {
            primitive: 'custom_svg',
            svgContent: performance.svg_illustration,
          },
        };
        performance.board_actions = [...(performance.board_actions || []), svgAction];
      }
    }

    // Guarantee explicit Title Action on every board performance
    const resolvedTitle = performance.title || boardPlan.title || `Board ${performance.board_number}`;
    const hasTitleAction = (performance.board_actions || []).some(
      (a) =>
        (a.type === 'write' || a.type === 'text') &&
        ((a.position?.y ?? 50) <= 16 || a.id?.includes('title') || a.content === resolvedTitle)
    );

    if (!hasTitleAction) {
      const titleAction: BoardAction = {
        id: `act_title_${performance.board_number}`,
        type: 'write',
        content: resolvedTitle,
        position: { x: 50, y: 10 },
        metadata: { fontSize: '3xl', color: '#FFFFFF' },
        sync: { triggerImmediately: true },
      };
      performance.board_actions = [titleAction, ...(performance.board_actions || [])];
    } else {
      performance.board_actions = (performance.board_actions || []).map((a) => {
        if (
          (a.type === 'write' || a.type === 'text') &&
          ((a.position?.y ?? 50) <= 16 || a.id?.includes('title') || a.content === resolvedTitle)
        ) {
          return {
            ...a,
            position: { x: 50, y: 10 },
            sync: { ...(a.sync || {}), triggerImmediately: true },
          };
        }
        return a;
      });
    }
    // Guarantee explicit Key Takeaway / Bullet Point Actions on every board
    const hasKeyPointText = (performance.board_actions || []).some(
      (a) =>
        (a.type === 'write' || a.type === 'text') &&
        (a.position?.y ?? 50) > 16 &&
        !a.id?.includes('title') &&
        a.content !== resolvedTitle
    );

    if (!hasKeyPointText) {
      const takeaways =
        boardPlan.recommended_board_content ||
        boardPlan.key_concepts ||
        [boardPlan.teaching_objective || resolvedTitle];

      const keyPointActions: BoardAction[] = takeaways.slice(0, 3).map((kt, idx) => ({
        id: `act_kt_guarantee_${performance.board_number}_${idx}`,
        type: 'write' as const,
        content: kt.trim().startsWith('•') || kt.trim().startsWith('-') ? kt : `• ${kt}`,
        position: { x: 20, y: 30 + idx * 14 },
        metadata: { fontSize: '2xl' as const, color: '#E2E8F0' },
        sync: { phrase: kt },
      }));

      performance.board_actions = [...(performance.board_actions || []), ...keyPointActions];
    }

    const boardNum = boardPlan.board_number || 1;
    const perfCacheKey = getLocalCacheKey('perf', this.currentStructure!.topic, boardNum);
    setCachedBoardItem(perfCacheKey, performance);

    return performance;
  }

  private emitLegacySegment(performance: TeachingBoardPerformance) {
    const legacySegment: TeachingSegment = {
      lesson: {
        id: (this.currentStructure?.topic || 'topic').toLowerCase().replace(/[^a-z0-9]/g, '-'),
        topic: this.currentStructure?.topic || 'Topic',
        segmentId: performance.board_id,
        title: performance.title,
        segmentNumber: performance.board_number,
        totalEstimatedSegments: this.currentStructure?.boards.length || 5,
      },
      teaching: {
        objective: performance.title,
        speech: performance.speech,
        boardTransition: 'clear_board',
        actions: performance.board_actions || [],
        svgContent: performance.svg_illustration || undefined,
      },
      question: performance.question || null,
      next: {
        type: performance.question?.waitForAnswer ? 'wait_for_answer' : 'continue',
      },
    };
    this.listeners.forEach((l) => l.onSegmentLoaded?.(legacySegment));
  }

  /**
   * SPEECH + BOARD + SVG SYNCHRONIZATION PLAYBACK
   */
  public async playBoardSpeech(performance: TeachingBoardPerformance): Promise<void> {
    if (this.isDestroyed || !performance.speech) return;

    this.stopCurrentPlayback();
    this.isPaused = false;
    this.setRuntimeState('SPEAKING');

    try {
      const speechText = performance.speech.trim();
      const actions = performance.board_actions || [];
      const beats = performance.speech_beats || [];
      const triggeredActionIds = new Set<string>();
      let audioStarted = false;
      const speed = 1.08;
      const wps = wordsPerSecond(speed);

      const fireAction = (act: BoardAction) => {
        if (triggeredActionIds.has(act.id)) return;
        triggeredActionIds.add(act.id);
        this.listeners.forEach((l) => l.onBoardActionTriggered?.(act));
      };

      this.activeAudioPlayer = unifiedVoiceRouter.playSpeech(speechText, {
        appSettings: this.appSettings,
        voice: this.voice,
        speed,
        onStart: () => {
          if (this.isDestroyed || this.isPaused) return;
          audioStarted = true;
          this.setRuntimeState('SPEAKING');
          this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(true));
          this.scheduleTimeline(speechText, actions, beats, triggeredActionIds, wps);
        },
        onEnd: () => {
          if (this.isPaused) return;
          actions.forEach((act) => fireAction(act));
          this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(false));

          if (performance.question && performance.question.waitForAnswer) {
            this.setRuntimeState('WAITING_FOR_ANSWER');
            this.listeners.forEach((l) => l.onQuestionAsked?.(performance.question!));
          } else {
            this.setRuntimeState('COMPLETING');
          }
        },
        onError: (err) => {
          console.warn('[TeachingEngine] Audio player error:', err);
          this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(true));
          this.scheduleTimeline(speechText, actions, beats, triggeredActionIds, wps);
          setTimeout(() => {
            this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(false));
            if (performance.question && performance.question.waitForAnswer) {
              this.setRuntimeState('WAITING_FOR_ANSWER');
              this.listeners.forEach((l) => l.onQuestionAsked?.(performance.question!));
            } else {
              this.setRuntimeState('COMPLETING');
            }
          }, 3500);
        },
      });

      const safety = setTimeout(() => {
        if (!audioStarted && !this.isDestroyed && !this.isPaused) {
          audioStarted = true;
          this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(true));
          this.scheduleTimeline(speechText, actions, beats, triggeredActionIds, wps);
        }
      }, 1800);
      this.activeTimers.push(safety);
    } catch (err: any) {
      console.warn('[TeachingEngine] Speech playback fallback:', err);
      this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(true));
      performance.board_actions.forEach((act, idx) => {
        const timer = setTimeout(() => {
          this.listeners.forEach((l) => l.onBoardActionTriggered?.(act));
        }, 600 + idx * 3000);
        this.activeTimers.push(timer);
      });
      setTimeout(() => {
        this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(false));
      }, 600 + performance.board_actions.length * 3000);
    }
  }

  // Alias for backward compatibility
  public async playSegmentSpeech(segment: TeachingSegment | TeachingBoardPerformance): Promise<void> {
    if ('speech_beats' in segment) {
      return this.playBoardSpeech(segment);
    }
    const perf: TeachingBoardPerformance = {
      board_id: segment.lesson.segmentId,
      board_number: segment.lesson.segmentNumber,
      title: segment.lesson.title,
      speech: segment.teaching.speech,
      speech_beats: [],
      board_actions: segment.teaching.actions,
      svg_illustration: segment.teaching.svgContent,
      question: segment.question,
    };
    return this.playBoardSpeech(perf);
  }

  private scheduleTimeline(
    speech: string,
    actions: BoardAction[],
    beats: SpeechBeat[],
    triggeredIds: Set<string>,
    wps: number
  ) {
    const words = speech.split(/\s+/).filter(Boolean);
    const totalWords = Math.max(1, words.length);
    // Estimated total duration of this board's lecture audio in milliseconds
    const estTotalMs = Math.max(25000, Math.floor((totalWords / wps) * 1000));

    // 1) Title Action & Full SVG Illustration Action MUST trigger immediately at lecture start (t = 50ms)
    const immediateCandidates = actions.filter(
      (a) =>
        a.sync?.triggerImmediately ||
        a.id?.includes('title') ||
        a.type === 'draw' ||
        a.type === 'illustration' ||
        a.type === 'svg' ||
        Boolean(a.metadata?.svgContent) ||
        ((a.position?.y ?? 50) <= 16 && (a.type === 'write' || a.type === 'text'))
    );
    immediateCandidates.forEach((act, idx) => {
      if (act && !triggeredIds.has(act.id)) {
        const timer = setTimeout(() => {
          if (this.isDestroyed || this.isPaused) return;
          if (triggeredIds.has(act.id)) return;
          triggeredIds.add(act.id);
          this.listeners.forEach((l) => l.onBoardActionTriggered?.(act));
        }, 50 + idx * 50);
        this.activeTimers.push(timer);
      }
    });

    // 2) Schedule speech_beats tied to spoken phrase timestamp across overall voice duration
    beats.forEach((beat, bIdx) => {
      const beatOffset = phraseWordOffset(speech, beat.text);
      const delayMs =
        beatOffset >= 0
          ? Math.floor((beatOffset / totalWords) * estTotalMs)
          : Math.floor(((bIdx + 1) / (beats.length + 1)) * estTotalMs);

      const timer = setTimeout(() => {
        if (this.isDestroyed || this.isPaused) return;
        this.listeners.forEach((l) => l.onBeatTriggered?.(beat));
        if (Array.isArray(beat.board_actions)) {
          beat.board_actions.forEach((act) => {
            if (act && !triggeredIds.has(act.id)) {
              triggeredIds.add(act.id);
              this.listeners.forEach((l) => l.onBoardActionTriggered?.(act));
            }
          });
        }
      }, Math.max(150, delayMs));
      this.activeTimers.push(timer);
    });

    // 3) Dynamically calculated timestamps for keywords based on spoken voice script
    const remainingTextActions = actions.filter(
      (a) =>
        !triggeredIds.has(a.id) &&
        !a.sync?.triggerImmediately &&
        !a.id?.includes('title') &&
        ((a.position?.y ?? 50) > 16 || a.type === 'write' || a.type === 'text')
    );

    remainingTextActions.forEach((action, aIdx) => {
      let delayMs = 0;
      const targetPhrase = action.sync?.phrase || action.content || '';
      const offset = phraseWordOffset(speech, targetPhrase);

      if (offset >= 0) {
        // Exact or keyword match: calculate exact timestamp in the voice script
        delayMs = Math.floor((offset / totalWords) * estTotalMs);
      } else {
        // Proportional placement across 15% to 85% of the overall speech duration
        const stepFraction = (aIdx + 1) / (remainingTextActions.length + 1);
        delayMs = Math.floor(estTotalMs * 0.15 + stepFraction * estTotalMs * 0.70);
      }

      const timer = setTimeout(() => {
        if (this.isDestroyed || this.isPaused) return;
        if (triggeredIds.has(action.id)) return;
        triggeredIds.add(action.id);
        this.listeners.forEach((l) => l.onBoardActionTriggered?.(action));
      }, Math.max(200, delayMs));
      this.activeTimers.push(timer);
    });
  }

  /**
   * Evaluate student answer for mid-board question
   */
  public async evaluateStudentAnswer(params: {
    topic: string;
    studentAnswer: string;
  }): Promise<StudentAnswerEvaluation | null> {
    if (!this.currentBoardPerformance || !this.currentBoardPerformance.question) return null;

    try {
      const ai = createAvelutAI(this.appSettings, this.userProfile);
      if (!ai) throw new Error('AI client could not be initialized');

      const prompt = buildStudentAnswerEvaluationPrompt({
        topic: params.topic,
        boardTitle: this.currentBoardPerformance.title,
        question: this.currentBoardPerformance.question.question,
        expectedConcepts: this.currentBoardPerformance.question.expectedConcepts,
        studentAnswer: params.studentAnswer,
      });

      const response = await ai.models.generateContent({
        model: this.appSettings.alibaba_model || 'qwen3.7-flash',
        contents: [{ role: 'user', parts: [{ text: `${TEACHING_DIRECTOR_SYSTEM_PROMPT}\n\n${prompt}` }] }],
        config: { responseMimeType: 'application/json', temperature: 0.3 },
      });

      const rawText = getResponseText(response);
      const cleaned = (rawText || '').replace(/```(?:json)?\s*/gi, '').replace(/\s*```$/gi, '').trim();
      const evaluation: StudentAnswerEvaluation = JSON.parse(cleaned);

      this.setRuntimeState('FEEDBACK');
      this.listeners.forEach((l) => l.onAnswerEvaluated?.(evaluation));

      if (evaluation.spokenFeedback) {
        unifiedVoiceRouter.playSpeech(evaluation.spokenFeedback, {
          appSettings: this.appSettings,
          voice: this.voice,
          speed: 1.05,
        });
      }

      return evaluation;
    } catch (err: any) {
      console.error('[TeachingEngine] Answer evaluation error:', err);
      const fallback: StudentAnswerEvaluation = {
        isCorrect: true,
        score: 'correct',
        spokenFeedback: "Excellent thinking! Let's keep moving forward.",
      };
      this.setRuntimeState('FEEDBACK');
      this.listeners.forEach((l) => l.onAnswerEvaluated?.(fallback));
      return fallback;
    }
  }

  /**
   * REQUEST 3: Generate Final Mini Test after all boards complete
   */
  public async generateFinalTest(): Promise<FinalTest | null> {
    if (!this.currentStructure) return null;
    this.setRuntimeState('FINAL_TEST');

    try {
      const ai = createAvelutAI(this.appSettings, this.userProfile);
      if (!ai) throw new Error('AI client could not be initialized');

      const prompt = buildFinalTestPrompt({
        topic: this.currentStructure.topic,
        teachingStructure: this.currentStructure,
      });

      const response = await ai.models.generateContent({
        model: this.appSettings.alibaba_model || 'qwen3.7-flash',
        contents: [{ role: 'user', parts: [{ text: `${TEACHING_DIRECTOR_SYSTEM_PROMPT}\n\n${prompt}` }] }],
        config: { responseMimeType: 'application/json', temperature: 0.25 },
      });

      const rawText = getResponseText(response);
      const cleaned = (rawText || '').replace(/```(?:json)?\s*/gi, '').replace(/\s*```$/gi, '').trim();
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      const jsonStr = firstBrace !== -1 && lastBrace !== -1 ? cleaned.substring(firstBrace, lastBrace + 1) : cleaned;

      const finalTest: FinalTest = JSON.parse(jsonStr);
      this.listeners.forEach((l) => l.onFinalTestGenerated?.(finalTest));
      return finalTest;
    } catch (err) {
      console.error('[TeachingEngine] Error generating final test:', err);
      const fallback: FinalTest = {
        topic: this.currentStructure?.topic || 'Lesson Complete',
        questions: [
          {
            id: 'ft_fallback_1',
            type: 'understanding',
            question: `What is the primary core concept taught in ${this.currentStructure?.topic || 'this topic'}?`,
            options: ['Option A', 'Option B', 'Option C'],
            correctAnswer: 'Option A',
            explanation: 'This was highlighted throughout the lesson boards.',
          },
        ],
      };
      this.listeners.forEach((l) => l.onFinalTestGenerated?.(fallback));
      return fallback;
    }
  }

  public async askLecturerQuestion(params: {
    topic: string;
    studentQuestion: string;
  }): Promise<{ spokenAnswer: string; boardActions?: BoardAction[] }> {
    this.stopCurrentPlayback();

    try {
      const ai = createAvelutAI(this.appSettings, this.userProfile);
      if (!ai) throw new Error('AI client could not be initialized');

      const { buildStudentInterruptionPrompt } = await import('./teachingEnginePrompt');
      const prompt = buildStudentInterruptionPrompt({
        topic: params.topic,
        currentBoardTitle: this.currentBoardPerformance?.title || params.topic,
        studentQuestion: params.studentQuestion,
      });

      const response = await ai.models.generateContent({
        model: this.appSettings.alibaba_model || 'qwen3.7-flash',
        contents: [{ role: 'user', parts: [{ text: `${TEACHING_DIRECTOR_SYSTEM_PROMPT}\n\n${prompt}` }] }],
        config: { responseMimeType: 'application/json', temperature: 0.3 },
      });

      const rawText = getResponseText(response);
      const cleaned = (rawText || '').replace(/```(?:json)?\s*/gi, '').replace(/\s*```$/gi, '').trim();
      const result = JSON.parse(cleaned);

      if (result.spokenAnswer) {
        const actions: BoardAction[] = Array.isArray(result.boardActions) ? normalizeBoardActions(result.boardActions) : [];
        const triggered = new Set<string>();

        this.activeAudioPlayer = unifiedVoiceRouter.playSpeech(result.spokenAnswer, {
          appSettings: this.appSettings,
          voice: this.voice,
          speed: 1.05,
          onStart: () => {
            this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(true));
          },
          onEnd: () => {
            actions.forEach((a) => {
              if (!triggered.has(a.id)) {
                triggered.add(a.id);
                this.listeners.forEach((l) => l.onBoardActionTriggered?.(a));
              }
            });
            this.listeners.forEach((l) => l.onAudioPlaybackStateChanged?.(false));
          },
        });
      }

      return result;
    } catch (err) {
      console.warn('[TeachingEngine] Interruption question error:', err);
      const fallbackAnswer = `Great question about ${params.topic}. Let me write that clearly for you on the board.`;
      unifiedVoiceRouter.playSpeech(fallbackAnswer, {
        appSettings: this.appSettings,
        voice: this.voice,
      });
      return { spokenAnswer: fallbackAnswer };
    }
  }

  // Backward compatibility alias for loadSegment
  public async loadSegment(params: {
    topic: string;
    courseName?: string;
    syllabusContext?: string;
    segmentNumber: number;
    studentName?: string;
    previousSegmentsSummary?: string;
  }): Promise<TeachingSegment | null> {
    if (!this.currentStructure) {
      await this.generateTeachingStructure(params);
    }
    const idx = (params.segmentNumber || 1) - 1;
    const boardPerf = await this.loadBoardPerformance({
      boardIndex: idx,
      studentName: params.studentName,
    });
    if (!boardPerf || !this.currentStructure) return null;

    return {
      lesson: {
        id: this.currentStructure.topic.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        topic: this.currentStructure.topic,
        segmentId: boardPerf.board_id,
        title: boardPerf.title,
        segmentNumber: boardPerf.board_number,
        totalEstimatedSegments: this.currentStructure.boards.length,
      },
      teaching: {
        objective: boardPerf.title,
        speech: boardPerf.speech,
        boardTransition: 'clear_board',
        actions: boardPerf.board_actions || [],
        svgContent: boardPerf.svg_illustration || undefined,
      },
      question: boardPerf.question || null,
      next: {
        type: boardPerf.question?.waitForAnswer ? 'wait_for_answer' : 'continue',
      },
    };
  }

  public stopCurrentPlayback() {
    this.activeTimers.forEach((t) => clearTimeout(t));
    this.activeTimers = [];
    if (this.activeAudioPlayer) {
      try {
        if (typeof this.activeAudioPlayer.stop === 'function') this.activeAudioPlayer.stop();
        else if (typeof this.activeAudioPlayer.pause === 'function') this.activeAudioPlayer.pause();
      } catch (_) {}
    }
    unifiedVoiceRouter.stopAudio();
  }

  public destroy() {
    this.isDestroyed = true;
    this.stopCurrentPlayback();
    unifiedVoiceRouter.stopAll();
    this.listeners.clear();
  }
}
