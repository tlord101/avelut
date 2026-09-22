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

/**
 * Stage progression is intentionally conservative.
 * Auto-advance only on explicit student answers or long time gaps —
 * never after every AI turn (that caused the model to "talk to itself"
 * and skip lesson steps).
 */
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

  /** Minimum turns the AI should stay in each stage before a soft advance is allowed */
  private minTurnsBeforeAdvance: Record<string, number> = {
    GREETING: 1,
    STAGE_1_INTUITION: 1,
    STAGE_2_VISUAL: 1,
    STAGE_3_EXPLANATION: 2,
    STAGE_4_FORMULA: 1,
    STAGE_5_SOCRATIC: 1,
    MASTERY_CHECK: 1,
    SUMMARY: 1,
    COMPLETE: 999,
  };

  constructor(config: StateMachineConfig) {
    this.config = config;
    this.initialize(config.durationMinutes);
  }

  public initialize(durationMinutes: number, totalStages: number = 8): void {
    this.startTime = Date.now();
    this.minutesPerStage = durationMinutes / totalStages;
  }

  /**
   * Time-based advance is disabled for normal teaching.
   * Only the very end of the lesson (via evaluateState) may force wrap-up.
   * Returning false always prevents mid-lesson stage racing.
   */
  public evaluateMinuteBasedAdvance(): boolean {
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

  /** Student answered — this is the primary way stages progress. */
  public recordStudentAnswer(_answer: string, _isCorrect: boolean): void {
    this.advance();
  }

  /**
   * Only force MASTERY / SUMMARY / COMPLETE near the end of the booked duration.
   * Does not skip intermediate stages early in the lesson.
   */
  public evaluateState(): boolean {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    const timeRatio = elapsedMinutes / Math.max(1, this.config.durationMinutes);

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

  /**
   * Soft advance: requires enough turns in the current stage.
   * GREETING advances after the first completed turn (greeting is short).
   * Other stages need several turns so the AI does not race through the lesson.
   */
  public advance(): boolean {
    const prevState = this.currentState;
    this.turnCountInStage++;

    const needed = this.minTurnsBeforeAdvance[this.currentState] ?? 3;
    if (this.turnCountInStage < needed) {
      return false;
    }

    const idx = this.stages.indexOf(this.currentState);
    if (idx >= 0 && idx < this.stages.length - 1) {
      this.currentState = this.stages[idx + 1];
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
Then STOP and wait for the student. Do not continue into the next teaching stage until they respond or you are asked to continue.`;

      case 'STAGE_1_INTUITION':
        return `[CURRENT STAGE: STAGE 1 - INTUITION & REAL WORLD]
Introduce a vivid, relatable everyday scenario. Explain the concept intuitively before introducing heavy math.
Call draw_sticky_note({ text: "..." }) or annotate({ text: "..." }) to highlight the core intuition.
Then ask a simple intuitive check question and WAIT for the student's answer. Do not advance stages on your own.`;

      case 'STAGE_2_VISUAL':
        return `[CURRENT STAGE: STAGE 2 - VISUAL MODEL]
Build the conceptual diagram on the board. Call draw_shape({ type: 'rectangle', id: '...', label: '...' }) and connect with draw_arrow, or call illustrate({ topic: "${this.config.topicTitle}", template: "concept_map" }).
Refer directly to what is on the board as you teach. After the diagram, ask a short check question and wait.`;

      case 'STAGE_3_EXPLANATION':
        return `[CURRENT STAGE: STAGE 3 - CORE MECHANISM]
Explain the underlying laws and mechanisms. Call annotate or draw_shape to highlight the working principles. Keep sentences punchy and engaging.
Pause for questions; do not skip ahead.`;

      case 'STAGE_4_FORMULA':
        return `[CURRENT STAGE: STAGE 4 - MATHEMATICS & FORMULAS]
Introduce the governing formula. Call set_formula({ formula: "..." }) and annotate key variable definitions on the board. Connect the math back to the intuition.
Ask the student to restate one variable in their own words, then wait.`;

      case 'STAGE_5_SOCRATIC':
        return `[CURRENT STAGE: STAGE 5 - SOCRATIC PRACTICE]
Present a quick step-by-step problem or scenario. Ask the student what they would do first. If they answer, praise or correct gently and write the answer on the board.
Never answer your own Socratic questions.`;

      case 'MASTERY_CHECK':
        return `[CURRENT STAGE: MASTERY CHECK]
Say: "Let's do a quick mastery check to test your understanding!" Present a concise challenge question and wait for the student.`;

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
