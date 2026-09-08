/**
 * Normalize board actions from the AI / fallback so BoardStateManager always understands them.
 */
import type { BoardAction } from '../types/teachingScript';

export function normalizeBoardActions(actions: BoardAction[] | undefined | null): BoardAction[] {
  if (!actions || !Array.isArray(actions)) return [];

  let keyPointIndex = 0;

  return actions.map((raw, idx) => {
    const a = { ...raw } as BoardAction & { style?: Record<string, string>; latex?: string };
    const t = String(a.type || '').toLowerCase();

    if (t === 'text' || t === 'title' || t === 'heading') {
      a.type = 'write';
      if (a.style) {
        a.metadata = {
          ...(a.metadata || {}),
          color: a.metadata?.color || a.style.color,
          fontSize: a.metadata?.fontSize || (a.style.fontSize as any),
        };
      }
    } else if (t === 'formula' || t === 'latex' || t === 'math') {
      a.type = 'write';
      a.metadata = {
        ...(a.metadata || {}),
        latex: a.metadata?.latex || a.latex || a.content,
      };
    } else if (t === 'illustration' || t === 'svg' || t === 'image') {
      a.type = 'draw';
      const svg =
        a.metadata?.svgContent ||
        (typeof a.content === 'string' && a.content.includes('<svg') ? a.content : undefined);
      a.metadata = {
        ...(a.metadata || {}),
        primitive: a.metadata?.primitive || 'custom_svg',
        svgContent: svg,
      };
    } else if (t === 'diagram') {
      a.type = 'draw';
    }

    if (!a.id) a.id = `act_norm_${idx}_${Date.now().toString(36)}`;

    // Normalize vertical spacing for bullet points / key text elements to standard ~5.5% line height step
    const isTitle = a.position?.y <= 16 || a.id?.includes('title') || a.content?.length < 30 && idx === 0;
    const isSvgDraw = a.type === 'draw' || Boolean(a.metadata?.svgContent);

    if (a.type === 'write' && !isTitle && !isSvgDraw) {
      // If AI assigned excessively large vertical gaps (>8% step), collapse to compact 5.5% line spacing
      const currentY = a.position?.y ?? 20;
      if (currentY > 20 || keyPointIndex > 0) {
        const compactY = Math.min(58, 20 + keyPointIndex * 5.5);
        a.position = {
          x: a.position?.x ?? 5,
          y: compactY,
        };
      }
      keyPointIndex++;
    }

    return a as BoardAction;
  });
}
