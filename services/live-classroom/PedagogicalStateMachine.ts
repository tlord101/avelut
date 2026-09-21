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

  constructor(config: StateMachineConfig) {
    this.config = config;
    this.startTime = Date.now();
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

  public recordStudentAnswer(answer: string, isCorrect: boolean): void {
    // For now, simple heuristics can be tracked here, or just progress the state.
    // In a full implementation, we'd branch based on isCorrect.
    this.advance();
  }

  public evaluateState(): boolean {
    const elapsedMinutes = (Date.now() - this.startTime) / 60000;
    const timeRatio = elapsedMinutes / this.config.durationMinutes;

    let changed = false;

    // Force progression if running out of time
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

    // Normal progression rules
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
      return true; // state changed
    }
    return false;
  }

  public getNextInstruction(): string {
    switch (this.currentState) {
      case 'GREETING':
        return `[CURRENT STAGE: GREETING]
You are starting the lesson. Greet the student warmly, announce the topic "${this.config.topicTitle}", and IMMEDATELY call a board tool (like draw_diagram or write_text) to illustrate an initial real-world hook. Do NOT ask what topic to teach.`;

      case 'STAGE_1_INTUITION':
        return `[CURRENT STAGE: STAGE 1 - REAL-WORLD INTUITION]
Start with a vivid, relatable, everyday situation. Make the student feel the concept before they name it. Do NOT use formulas yet.`;

      case 'STAGE_2_VISUAL':
        return `[CURRENT STAGE: STAGE 2 - VISUAL DEMONSTRATION]
You MUST call your board tools (write_text, request_diagram, or draw_diagram) in this turn to sketch what you just described. The student must SEE it on the board as you speak. ALWAYS call a tool before speaking.`;

      case 'STAGE_3_EXPLANATION':
        return `[CURRENT STAGE: STAGE 3 - CORE EXPLANATION]
Explain the physical or conceptual mechanism behind what they just saw. Use short, punchy sentences. No long lectures.`;

      case 'STAGE_4_FORMULA':
        return `[CURRENT STAGE: STAGE 4 - MATHEMATICS & FORMULAS]
Introduce the formula (if applicable). Show it as a shorthand for the intuition they already have. You MUST write it on the board using the set_formula or write_text tool in this turn!`;

      case 'STAGE_5_SOCRATIC':
        return `[CURRENT STAGE: STAGE 5 - SOCRATIC PARTICIPATION]
Ask the student ONE short verbal intuition-check question. STOP TALKING. Wait for their response. When they answer, evaluate it verbally.`;

      case 'MASTERY_CHECK':
        return `[CURRENT STAGE: MASTERY CHECK]
You are nearing the end of the lesson. Say: "Let's do a quick mastery check!" Ask a conceptual or formula-application question. Wait for the answer. Evaluate it.`;

      case 'SUMMARY':
        return `[CURRENT STAGE: SUMMARY]
The lesson is wrapping up. Give a brief diagnostic summary of what they understood well and what to review. Keep it encouraging and short.`;

      case 'COMPLETE':
        return `[CURRENT STAGE: COMPLETE]
The lesson is over. Say goodbye warmly.`;

      default:
        return '';
    }
  }
}
