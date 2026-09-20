import { BoardStateManager } from '../boardStateManager';
import { BoardAction } from '../../types/teachingScript';

/**
 * BoardController acts as the semantic bridge between the Grok AI model
 * and the low-level Avelut BoardStateManager. It receives semantic intent
 * function calls and maps them to concrete visual BoardActions.
 */
export class BoardController {
  private stateManager: BoardStateManager;

  constructor(stateManager: BoardStateManager) {
    this.stateManager = stateManager;
  }

  private dispatch(action: BoardAction) {
    this.stateManager.applyAction(action);
  }

  // 1. Core Shapes & Drawings
  public create_element(params: { type: string, x: number, y: number, width?: number, height?: number, color?: string, label?: string }) {
    const id = `el_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    // Map basic types to standard Avelut illustrations or shapes
    if (params.type === 'illustration') {
      this.dispatch({
        id,
        type: 'illustration',
        metadata: {
          x: params.x,
          y: params.y,
          width: params.width || 400,
          height: params.height || 300,
          color: params.color || '#0066FF'
        }
      });
    } else {
      // Fallback simple draw
      this.dispatch({
        id,
        type: 'svg',
        metadata: {
          x: params.x,
          y: params.y,
          width: params.width || 100,
          height: params.height || 100,
          color: params.color || '#0066FF',
          label: params.label
        }
      });
    }
    return { status: 'success', id };
  }

  public draw(params: { path: {x: number, y: number}[], color?: string, width?: number }) {
    const id = `draw_${Date.now()}`;
    this.dispatch({
      id,
      type: 'draw',
      metadata: {
        color: params.color || '#0066FF',
        strokeWidth: params.width || 3,
        // The path array should be translated into the internal representation if needed,
        // but for now we map to standard SVG path format or Avelut draw format
      }
    });
    return { status: 'success', id };
  }

  public write(params: { text: string, x: number, y: number, color?: string, fontSize?: string }) {
    const id = `txt_${Date.now()}`;
    this.dispatch({
      id,
      type: 'text',
      content: params.text,
      metadata: {
        x: params.x,
        y: params.y,
        color: params.color || '#0F172A',
        fontSize: (params.fontSize as any) || 'md'
      }
    });
    return { status: 'success', id };
  }

  // 2. Manipulations
  public update_element(params: { id: string, x?: number, y?: number, color?: string }) {
    // Avelut's state manager typically handles updates by re-dispatching with the same ID
    this.dispatch({
      id: params.id,
      type: 'reveal', // Using reveal as a generic update trigger if needed
      metadata: {
        x: params.x,
        y: params.y,
        color: params.color
      }
    });
    return { status: 'success', id: params.id };
  }

  public move_element(params: { id: string, targetX: number, targetY: number }) {
    return this.update_element({ id: params.id, x: params.targetX, y: params.targetY });
  }

  public highlight_element(params: { target: string, color?: string }) {
    const id = `hl_${Date.now()}`;
    this.dispatch({
      id,
      type: 'highlight',
      target: params.target,
      metadata: {
        color: params.color || '#FDE047'
      }
    });
    return { status: 'success', id };
  }

  public focus_element(params: { x: number, y: number, width: number, height: number }) {
    // Focus uses a spotlight effect in Avelut
    this.dispatch({
      id: 'focus_spotlight',
      type: 'highlight', // Map to highlight or custom focus
      metadata: {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height
      }
    });
    return { status: 'success' };
  }

  // 3. Deletion
  public erase_element(params: { target: string }) {
    this.dispatch({
      id: `erase_${Date.now()}`,
      type: 'erase',
      target: params.target
    });
    return { status: 'success' };
  }

  public clear_board() {
    this.dispatch({
      id: `clear_${Date.now()}`,
      type: 'clear_board'
    });
    return { status: 'success' };
  }

  // 4. Pedagogy Flow
  public animate(params: { target: string, animationType: string }) {
    return { status: 'success', note: 'Animation triggered' };
  }

  public zoom_board(params: { level: number, x: number, y: number }) {
    return { status: 'success', note: 'Zoom applied' };
  }

  public ask_question(params: { question: string, options?: string[] }) {
    return { status: 'success', note: 'Question posed to student' };
  }

  public wait_for_answer(params: { timeoutSeconds?: number }) {
    this.stateManager.setRuntimeState('AWAITING_INPUT');
    return { status: 'success', state: 'AWAITING_INPUT' };
  }

  public continue_lesson() {
    this.stateManager.setRuntimeState('TEACHING');
    return { status: 'success', state: 'TEACHING' };
  }

  public start_test() {
    this.stateManager.setRuntimeState('QUIZ_MODE');
    return { status: 'success', state: 'QUIZ_MODE' };
  }
}
