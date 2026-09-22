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
        return `[CURRENT STAGE: GREETING & INTRO]
Greet the student warmly and enthusiastically in 1-2 short sentences. Announce that today we are mastering "${this.config.topicTitle}".
Call draw_component (for circuits/physics), draw_shape, or draw_sticky_note to place the introductory anchor on the board!
Then immediately begin introducing the foundational idea. Do not pause silently after greeting.`;

      case 'STAGE_1_INTUITION':
        return `[CURRENT STAGE: STAGE 1 - INTUITION & REAL WORLD]
Introduce a vivid, relatable everyday scenario. Explain the concept intuitively before introducing heavy math.
Call draw_sticky_note({ text: "..." }) or annotate({ text: "..." }) to highlight the core intuition.
Then ask a simple intuitive check question.`;

      case 'STAGE_2_VISUAL':
        return `[CURRENT STAGE: STAGE 2 - VISUAL MODEL]
Build the conceptual diagram on the board. Call draw_shape({ type: 'rectangle', id: '...', label: '...' }) and connect with draw_arrow, or call illustrate({ topic: "${this.config.topicTitle}", template: "concept_map" }).
Refer directly to what is on the board as you teach.`;

      case 'STAGE_3_EXPLANATION':
        return `[CURRENT STAGE: STAGE 3 - CORE MECHANISM]
Explain the underlying laws and mechanisms. Call annotate or draw_shape to highlight the working principles. Keep sentences punchy and engaging.`;

      case 'STAGE_4_FORMULA':
        return `[CURRENT STAGE: STAGE 4 - MATHEMATICS & FORMULAS]
Introduce the governing formula. Call set_formula({ formula: "..." }) and annotate key variable definitions on the board. Connect the math back to the intuition.`;

      case 'STAGE_5_SOCRATIC':
        return `[CURRENT STAGE: STAGE 5 - SOCRATIC PRACTICE]
Present a quick step-by-step problem or scenario. Ask the student what they would do first. If they answer, praise or correct gently and write the answer on the board.`;

      case 'MASTERY_CHECK':
        return `[CURRENT STAGE: MASTERY CHECK]
Say: "Let's do a quick mastery check to test your understanding!" Present a concise challenge question.`;

      case 'SUMMARY':
        return `[CURRENT STAGE: SUMMARY & WRAP-UP]
Summarize the key takeaways and celebrate progress. Place a final sticky note with the core lesson formula or rule.`;

      case 'COMPLETE':
        return `[CURRENT STAGE: COMPLETE]
The lesson is over. Say goodbye warmly.`;

      default:
        return '';
    }
  }
}
