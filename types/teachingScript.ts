/**
 * TeachingScript Architecture Types
 * Flow: Topic -> TeachingStructure -> TeachingBoardPerformance (speech + path draws + text)
 */

export interface Point2D {
  x: number;
  y: number;
  pressure?: number;
}

export type DiagramPrimitiveType =
  | 'line'
  | 'path'
  | 'circle'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'text'
  | 'formula'
  | 'connector'
  | 'group';

export interface DiagramSubElement {
  id: string;
  type: DiagramPrimitiveType;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  from?: { x: number; y: number } | string;
  to?: { x: number; y: number } | string;
  points?: Array<{ x: number; y: number }>;
  d?: string;
  radius?: number;
  rx?: number;
  ry?: number;
  content?: string;
  latex?: string;
  label?: string;
  color?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  fontSize?: string | number;
  elements?: DiagramSubElement[];
}

export interface ComposedDiagram {
  id: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  elements: DiagramSubElement[];
}

export type VisualPrimitiveType =
  | 'custom_svg'
  | 'physics_block'
  | 'physics_force'
  | 'physics_pulley'
  | 'physics_spring'
  | 'physics_wave'
  | 'circuit'
  | 'circuit_resistor'
  | 'circuit_battery'
  | 'chemistry_molecule'
  | 'chemistry_atom'
  | 'chemistry_reaction'
  | 'biology_cell'
  | 'biology_dna'
  | 'biology_neuron'
  | 'graph'
  | 'graph_axes'
  | 'geometry_triangle'
  | 'geometry_circle'
  | 'table'
  | 'formula'
  | 'text'
  | 'custom';

export type BoardActionType =
  | 'reveal'
  | 'write'
  | 'text'
  | 'formula'
  | 'draw'
  | 'illustration'
  | 'svg'
  | 'arrow'
  | 'label'
  | 'highlight'
  | 'circle'
  | 'underline'
  | 'erase'
  | 'erase_group'
  | 'clear'
  | 'clear_board'
  | 'retain';

export type VisualActionType =
  | 'reveal'
  | 'highlight'
  | 'focus'
  | 'animate'
  | 'draw'
  | 'hide';

export type ElementPersistence = 'persistent' | 'temporary';

export interface BoardActionSync {
  phrase?: string;
  offsetMs?: number;
  triggerImmediately?: boolean;
}

export type PathDrawType = 'path' | 'line' | 'circle' | 'arrow';

export interface BoardAction {
  id: string;
  type: BoardActionType;
  groupId?: string;
  persistence?: ElementPersistence;
  target?: string;
  content?: string;
  position?: { x: number; y: number };
  from?: string | Point2D | { x: number; y: number };
  to?: string | Point2D | { x: number; y: number };
  direction?: 'right' | 'left' | 'up' | 'down' | 'custom';
  sync?: BoardActionSync;
  metadata?: {
    primitive?: VisualPrimitiveType;
    svgContent?: string;
    /** Pure LLM path drawing (preferred over named primitives) */
    drawType?: PathDrawType;
    d?: string;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    cx?: number;
    cy?: number;
    r?: number;
    label?: string;
    strokeWidth?: number;
    durationMs?: number;
    fill?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    color?: string;
    style?: string;
    fontSize?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
    subElements?: string[];
    tableData?: { headers: string[]; rows: string[][] };
    latex?: string;
    diagramProps?: Record<string, any>;
    diagram?: ComposedDiagram;
  };
}

export interface VisualAction {
  id: string;
  type: VisualActionType;
  targetId?: string;
  parameters?: Record<string, any>;
}

export type MannerismType =
  | 'attention'
  | 'emphasis'
  | 'transition'
  | 'reflection_pause'
  | 'encouragement'
  | 'check_understanding'
  | 'correction';

export interface SpeechBeat {
  id: string;
  text: string;
  purpose: string;
  mannerism?: MannerismType | null;
  pauseAfterMs?: number;
  board_actions: BoardAction[];
  visual_actions: VisualAction[];
  focus_target?: string | null;
}

export interface LiveBoardElement {
  id: string;
  groupId?: string;
  persistence: ElementPersistence;
  type: 'text' | 'formula' | 'diagram' | 'arrow' | 'label' | 'table' | 'svg';
  content?: string;
  latex?: string;
  svgContent?: string;
  position: { x: number; y: number };
  primitive?: VisualPrimitiveType;
  diagramProps?: Record<string, any>;
  diagram?: ComposedDiagram;
  color?: string;
  fontSize?: string;
  tableData?: { headers: string[]; rows: string[][] };
  highlighted?: boolean;
  circled?: boolean;
  underlined?: boolean;
  progress?: number;
  createdAt: number;
}

export interface BoardState {
  elements: Map<string, LiveBoardElement>;
  activeHighlights: Set<string>;
  activeCircles: Set<string>;
  activeUnderlines: Set<string>;
  focusedElementId?: string | null;
}

export type TeachingBoardStepType =
  | 'hook'
  | 'intuition'
  | 'concept'
  | 'definition'
  | 'mechanism'
  | 'comparison'
  | 'derivation'
  | 'worked_example'
  | 'application'
  | 'question'
  | 'misconception_check'
  | 'summary'
  | 'other';

export type TeachingQuestionCategory =
  | 'recall'
  | 'understanding'
  | 'prediction'
  | 'calculation'
  | 'application'
  | null;

export interface TeachingBoardPlan {
  board_id: string;
  board_number: number;
  title: string;
  chapter?: string;
  step_type: TeachingBoardStepType;
  teaching_objective: string;
  what_student_should_understand: string;
  why_this_board_exists: string;
  prerequisite_knowledge: string[];
  key_concepts: string[];
  visual_purpose: string;
  recommended_board_content: string[];
  interaction_required: boolean;
  question_required: boolean;
  question_type: TeachingQuestionCategory;
  estimated_duration_seconds: number;
}

export interface TeachingStructure {
  topic: string;
  teaching_strategy: string;
  learning_goal: string;
  duration_minutes?: number;
  chapters?: string[];
  boards: TeachingBoardPlan[];
}

export interface TeachingQuestion {
  id: string;
  type: Exclude<TeachingQuestionCategory, null> | 'recall' | 'understanding' | 'prediction' | 'application' | 'comparison' | 'explanation' | 'step_completion';
  question: string;
  waitForAnswer: boolean;
  expectedConcepts?: string[];
  options?: string[];
  hint?: string;
}

export interface TeachingBoardPerformance {
  board_id: string;
  board_number: number;
  title: string;
  speech: string;
  speech_beats: SpeechBeat[];
  board_actions: BoardAction[];
  svg_illustration?: string | null;
  question?: TeachingQuestion | null;
}

export interface StudentAnswerEvaluation {
  isCorrect: boolean;
  score: 'correct' | 'partially_correct' | 'misconception';
  spokenFeedback: string;
  boardActions?: BoardAction[];
  followUpObjective?: string;
}

export interface FinalTestQuestion {
  id: string;
  type: 'recall' | 'understanding' | 'application' | 'calculation';
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
}

export interface FinalTest {
  topic: string;
  questions: FinalTestQuestion[];
}

export type TeachingRuntimeState =
  | 'IDLE'
  | 'PREPARING'
  | 'RENDERING'
  | 'SPEAKING'
  | 'WAITING_FOR_ANSWER'
  | 'FEEDBACK'
  | 'COMPLETING'
  | 'CLEARING'
  | 'NEXT_BOARD'
  | 'FINAL_TEST'
  | 'COMPLETE'
  | 'ERROR';

export interface TeachingSegment {
  lesson: {
    id: string;
    topic: string;
    segmentId: string;
    title: string;
    segmentNumber: number;
    totalEstimatedSegments?: number;
  };
  teaching: {
    objective: string;
    speech: string;
    boardTransition?: 'clear_board' | 'retain_persistent' | 'none';
    actions: BoardAction[];
    svgContent?: string;
  };
  question?: TeachingQuestion | null;
  next?: {
    type: 'continue' | 'wait_for_answer' | 'completed';
    suggestedNextSegment?: string;
  };
}
