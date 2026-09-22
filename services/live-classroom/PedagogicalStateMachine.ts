export type PedagogicalState =
  | 'GREETING'
  | 'STAGE_1_INTUITION'
  | 'STAGE_2_VISUAL'
  | 'STAGE_3_EXPLANATION'
  | 'STAGE_4_FORMULA'
  | 'STAGE_5_SOCRATIC'
  | 'MASTERY_CHECK'
  | 'SUMMARY'
  | 'COMPLETE';

export interface StateMachineConfig {
  topicTitle: string;
  durationMinutes: number;
  learningPath?: string[];
  syllabusContext?: string;
}

export class PedagogicalStateMachine {
  private config: StateMachineConfig;
  private currentState: PedagogicalState = 'GREETING';
  private startTime: number = Date.now();
  private turnCountInStage: number = 0;
  private minutesPerStage: number = 0;

  private stages: PedagogicalState[] = [
    'GREETING',
    'STAGE_1_INTUITION',
    'STAGE_2_VISUAL',
    'STAGE_3_EXPLANATION',
    'STAGE_4_FORMULA',
    'STAGE_5_SOCRATIC',
    'MASTERY_CHECK',
    'SUMMARY',
    'COMPLETE'
  ];

  constructor(config: StateMachineConfig) {
    this.config = config;
    this.initialize(config.durationMinutes);
  }

  public initialize(durationMinutes: number, totalStages: number = 8): void {
    this.startTime = Date.now();
    this.minutesPerStage = durationMinutes / totalStages;
  }

  public evaluateMinuteBasedAdvance(): boolean {
    if (this.minutesPerStage <= 0) return false;
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    const expectedStageIndex = Math.floor(elapsedMinutes / this.minutesPerStage);
    const currentStageIndex = this.stages.indexOf(this.currentState);

    if (expectedStageIndex > currentStageIndex && expectedStageIndex < this.stages.length) {
      this.currentState = this.stages[expectedStageIndex];
      this.turnCountInStage = 0;
      return true; // stage changed
    }
    return false;
  }

  public reset(): void {
    this.currentState = 'GREETING';
    this.startTime = Date.now();
    this.turnCountInStage = 0;
  }

  public getCurrentStage(): PedagogicalState {
    return this.currentState;
  }

  public forceAdvance(state: PedagogicalState): void {
    if (this.currentState !== state) {
      this.currentState = state;
      this.turnCountInStage = 0;
    }
  }

  public recordStudentAnswer(_answer: string, _isCorrect: boolean): void {
    this.advance();
  }

  public evaluateState(): boolean {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    const timeRatio = elapsedMinutes / this.config.durationMinutes;

    let changed = false;

    if (timeRatio > 0.85 && this.currentState !== 'SUMMARY' && this.currentState !== 'COMPLETE') {
      if (this.currentState !== 'MASTERY_CHECK') {
        this.forceAdvance('MASTERY_CHECK');
        changed = true;
      }
    } else if (timeRatio > 0.95 && this.currentState !== 'SUMMARY' && this.currentState !== 'COMPLETE') {
      this.forceAdvance('SUMMARY');
      changed = true;
    } else if (timeRatio >= 1.0 && this.currentState !== 'COMPLETE') {
      this.forceAdvance('COMPLETE');
      changed = true;
    }

    return changed;
  }

  public advance(): boolean {
    const prevState = this.currentState;
    this.turnCountInStage++;

    switch (this.currentState) {
      case 'GREETING':
        this.currentState = 'STAGE_1_INTUITION';
        break;
      case 'STAGE_1_INTUITION':
        if (this.turnCountInStage >= 1) this.currentState = 'STAGE_2_VISUAL';
        break;
      case 'STAGE_2_VISUAL':
        if (this.turnCountInStage >= 1) this.currentState = 'STAGE_3_EXPLANATION';
        break;
      case 'STAGE_3_EXPLANATION':
        if (this.turnCountInStage >= 2) this.currentState = 'STAGE_4_FORMULA';
        break;
      case 'STAGE_4_FORMULA':
        if (this.turnCountInStage >= 1) this.currentState = 'STAGE_5_SOCRATIC';
        break;
      case 'STAGE_5_SOCRATIC':
        if (this.turnCountInStage >= 2) this.currentState = 'MASTERY_CHECK';
        break;
      case 'MASTERY_CHECK':
        if (this.turnCountInStage >= 3) this.currentState = 'SUMMARY';
        break;
      case 'SUMMARY':
        if (this.turnCountInStage >= 1) this.currentState = 'COMPLETE';
        break;
      case 'COMPLETE':
        break;
    }

    if (this.currentState !== prevState) {
      this.turnCountInStage = 0;
      return true;
    }
    return false;
  }

  public getNextInstruction(): string {
    switch (this.currentState) {
      case 'GREETING':
        return `[CURRENT STAGE: GREETING]
Greet the student warmly, announce the topic "${this.config.topicTitle}", and IMMEDIATELY call write_text (or write_keywords) to put the topic title or a short real-world hook on the board. Do NOT ask what topic to teach.`;

      case 'STAGE_1_INTUITION':
        return `[CURRENT STAGE: STAGE 1 - REAL-WORLD INTUITION]
Start with a vivid, relatable, everyday situation. Make the student feel the concept before they name it. Call write_text with a short label for the intuition (e.g. "Pushing a heavy box"). Do NOT use formulas yet.`;

      case 'STAGE_2_VISUAL':
        return `[CURRENT STAGE: STAGE 2 - KEY POINTS ON BOARD]
Write the core idea on the board using write_text or write_keywords. Keep it short. Then explain it in 1–2 sentences. Illustration will appear automatically if needed — you do not draw.`;

      case 'STAGE_3_EXPLANATION':
        return `[CURRENT STAGE: STAGE 3 - CORE EXPLANATION]
Explain the mechanism behind the idea. Use short, punchy sentences. Call write_text with the key definition or principle. No long lectures.`;

      case 'STAGE_4_FORMULA':
        return `[CURRENT STAGE: STAGE 4 - MATHEMATICS & FORMULAS]
Introduce the formula (if applicable). You MUST call set_formula or write_text to put it on the board in this turn. Show it as shorthand for the intuition they already have.`;

      case 'STAGE_5_SOCRATIC':
        return `[CURRENT STAGE: STAGE 5 - SOCRATIC PARTICIPATION]
Ask the student ONE short verbal intuition-check question. STOP TALKING and wait. When they answer, evaluate it verbally.`;

      case 'MASTERY_CHECK':
        return `[CURRENT STAGE: MASTERY CHECK]
Say: "Let's do a quick mastery check!" Ask a conceptual or formula-application question. Wait for the answer. Evaluate it.`;

      case 'SUMMARY':
        return `[CURRENT STAGE: SUMMARY]
Give a brief diagnostic summary of what they understood well and what to review. Keep it encouraging and short.`;

      case 'COMPLETE':
        return `[CURRENT STAGE: COMPLETE]
The lesson is over. Say goodbye warmly.`;

      default:
        return '';
    }
  }
}
