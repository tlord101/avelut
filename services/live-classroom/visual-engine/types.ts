/**
 * types.ts
 *
 * Type definitions for the Avelut Async AI Visual Illustration Engine.
 * Structured illustration specifications, visual primitives, and rolling transcript context.
 */

export type VisualType =
  | 'physics_scene'
  | 'chemical_structure'
  | 'biological_diagram'
  | 'math_geometry'
  | 'computer_system'
  | 'scientific_schematic'
  | 'process_illustration';

export type VisualAction = 'create' | 'update' | 'highlight' | 'clear';

export interface VisualElement {
  id: string;
  primitive: string; // e.g. 'person', 'box', 'ground', 'atom', 'molecule', 'cell', 'triangle', 'server'
  label?: string;
  x: number; // 0-480 coordinate space
  y: number; // 0-320 coordinate space
  width?: number;
  height?: number;
  properties?: Record<string, any>; // custom styling, orientation, angle, charge, value
}

export interface VisualRelationship {
  id?: string;
  from: string;
  to: string;
  type: 'vector' | 'arrow' | 'bond' | 'flow' | 'reaction' | 'connection';
  label?: string;
  vectorType?: 'force' | 'velocity' | 'acceleration' | 'gravity' | 'normal' | 'friction';
  direction?: 'right' | 'left' | 'up' | 'down' | 'angled';
  color?: string;
}

export interface VisualLabel {
  id?: string;
  text: string;
  x: number;
  y: number;
  targetElementId?: string;
  style?: 'header' | 'badge' | 'callout' | 'measurement' | 'value';
  color?: string;
}

export interface VisualEquation {
  id?: string;
  latex: string;
  x?: number;
  y?: number;
  label?: string;
}

export interface IllustrationSpec {
  shouldIllustrate: boolean;
  action: VisualAction;
  visualType?: VisualType;
  title?: string;
  purpose?: string;
  targetId?: string; // for 'update' or 'highlight'
  changes?: Record<string, any>; // for 'update'
  elements?: VisualElement[];
  relationships?: VisualRelationship[];
  labels?: VisualLabel[];
  equations?: VisualEquation[];
  highlights?: string[]; // IDs of elements to highlight
}

export interface RollingTranscriptContext {
  topic: string;
  previous: string[];
  current: string;
  upcoming?: string[];
  boardContext?: string;
}

export interface VisualBoardState {
  currentIllustration: IllustrationSpec | null;
  svgString: string | null;
  elementIds: string[];
  currentConcept: string;
  currentVisualType?: VisualType;
  lastGeneratedAt: number;
}
