import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  Point2D,
  renderStrokeToContext,
  drawCoordinateAxes,
  drawAnimatedCurve,
  drawAnnotatedArrow,
  drawLaserPointerGlow,
  drawPulsingFocusRing,
  drawHandDrawnLine,
  drawAcademicTable,
  drawKeyTakeawayCard,
  drawConceptFlowchart,
  drawRichIllustration,
  drawEraseWipeEffect,
  drawOrganicCallout,
  drawFormulaBreakdown,
  resolveTargetAnchorBounds,
  drawTargetToTargetArrow,
  drawTargetLeaderLabel,
  drawWorkedEquationSteps,
} from '../../utils/canvasVectorPrimitives';

export type BoardElement =
  | { id: string; type: 'stroke'; points: Point2D[]; color: string; size: number }
  | { id: string; type: 'axes'; originX: number; originY: number; width: number; height: number; xLabel: string; yLabel: string; progress: number; color?: string }
  | { id: string; type: 'curve'; points: Point2D[]; progress: number; color: string; width: number }
  | { id: string; type: 'arrow'; from: Point2D; to: Point2D; label: string; color: string }
  | { id: string; type: 'target_arrow'; fromTarget: string | Point2D; toTarget: string | Point2D; label?: string; color?: string }
  | { id: string; type: 'target_circle'; target: string | Point2D; color?: string }
  | { id: string; type: 'target_label'; target: string | Point2D; text: string; color?: string }
  | { id: string; type: 'target_underline'; target: string | Point2D; color?: string }
  | { id: string; type: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
  | { id: string; type: 'table'; x: number; y: number; width: number; headers: string[]; rows: string[][]; progress?: number; activeRowIndex?: number; color?: string }
  | { id: string; type: 'takeaway'; x: number; y: number; width: number; title: string; keywords: string[]; summary: string; color?: string }
  | { id: string; type: 'flowchart'; x: number; y: number; nodes: Array<{ title: string; subtitle?: string }>; activeNodeIndex?: number; color?: string }
  | { id: string; type: 'illustration'; illustrationType: 'market_equilibrium' | 'cell_anatomy' | 'circuit_schematic' | 'optics_lens' | 'hierarchy_tree' | 'photosynthesis_plant'; x: number; y: number; width: number; height: number; progress?: number; color?: string }
  | { id: string; type: 'worked_step'; x: number; y: number; width: number; steps: Array<{ stepNumber: number; latex: string; explanation?: string; highlightTokens?: string[]; isCalculated?: boolean }>; activeStepIndex?: number }
  | { id: string; type: 'erase'; progress: number }
  | { id: string; type: 'focus'; x: number; y: number; w: number; h: number; color: string }
  | { id: string; type: 'latex'; x: number; y: number; text: string; opacity: number; color: string; highlightTokens?: string[] };

export interface LiveWhiteboardCanvasProps {
  elements: BoardElement[];
  tutorPointer?: { x: number; y: number; active: boolean; color?: string } | null;
  activeFocusArea?: { x: number; y: number; w: number; h: number; color?: string } | null;
  isStudentDrawingEnabled?: boolean;
  onStudentStrokeComplete?: (stroke: { points: Point2D[]; color: string; size: number }) => void;
  className?: string;
  gridStyle?: 'dots' | 'grid' | 'clean';
}

const svgImageCacheMap = new Map<string, HTMLImageElement>();

function getSvgImage(id: string, svgContent: string): HTMLImageElement | null {
  let img = svgImageCacheMap.get(id);
  if (!img) {
    img = new Image();
    try {
      const encoded = encodeURIComponent(svgContent);
      img.src = `data:image/svg+xml;charset=utf-8,${encoded}`;
      svgImageCacheMap.set(id, img);
    } catch (_) {
      return null;
    }
  }
  return img;
}

export const LiveWhiteboardCanvas: React.FC<LiveWhiteboardCanvasProps> = ({
  elements,
  tutorPointer,
  activeFocusArea,
  isStudentDrawingEnabled = false,
  studentMode = 'none',
  onStudentLassoSelect,
  onStudentStrokeComplete,
  className = '',
  gridStyle = 'dots',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [studentStrokes, setStudentStrokes] = useState<Array<{ id: string; points: Point2D[]; color: string; size: number }>>([]);
  const [currentStudentStroke, setCurrentStudentStroke] = useState<Point2D[] | null>(null);
  const [lassoedElementIds, setLassoedElementIds] = useState<string[]>([]);
  const isDrawingRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  // High-DPI Canvas Resizing
  const updateCanvasSize = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
  }, []);

  useEffect(() => {
    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);
    return () => window.removeEventListener('resize', updateCanvasSize);
  }, [updateCanvasSize]);

  // Main 60 FPS Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let startTime = performance.now();

    const render = (time: number) => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const elapsedSec = (time - startTime) / 1000;

      // Clear Canvas
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // 1. Render Background Grid Pattern
      if (gridStyle === 'dots') {
        ctx.save();
        ctx.fillStyle = '#E3E9F1';
        const dotSpacing = 28;
        for (let x = 14; x < rect.width; x += dotSpacing) {
          for (let y = 14; y < rect.height; y += dotSpacing) {
            ctx.beginPath();
            ctx.arc(x, y, 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      } else if (gridStyle === 'grid') {
        ctx.save();
        ctx.strokeStyle = '#F1F5F9';
        ctx.lineWidth = 1;
        const gridSpacing = 32;
        ctx.beginPath();
        for (let x = 0; x < rect.width; x += gridSpacing) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, rect.height);
        }
        for (let y = 0; y < rect.height; y += gridSpacing) {
          ctx.moveTo(0, y);
          ctx.lineTo(rect.width, y);
        }
        ctx.stroke();
        ctx.restore();
      }

      // 2. Render Whiteboard Elements (Tutor Layer)
      for (const el of elements) {
        if (el.type === 'stroke') {
          renderStrokeToContext(ctx, el.points, el.color, el.size);
        } else if (el.type === 'axes') {
          drawCoordinateAxes(ctx, {
            originX: el.originX,
            originY: el.originY,
            width: el.width,
            height: el.height,
            xLabel: el.xLabel,
            yLabel: el.yLabel,
            progress: el.progress,
            color: el.color,
          });
        } else if (el.type === 'curve') {
          drawAnimatedCurve(ctx, el.points, el.progress, { color: el.color, width: el.width });
        } else if (el.type === 'arrow') {
          drawAnnotatedArrow(ctx, el.from, el.to, el.label, el.color);
        } else if (el.type === 'line') {
          drawHandDrawnLine(ctx, el.x1, el.y1, el.x2, el.y2, { color: el.color, width: el.width });
        } else if (el.type === 'table') {
          drawAcademicTable(ctx, {
            x: el.x,
            y: el.y,
            width: el.width,
            headers: el.headers,
            rows: el.rows,
            progress: el.progress,
            activeRowIndex: el.activeRowIndex,
            color: el.color,
          });
        } else if (el.type === 'takeaway') {
          drawKeyTakeawayCard(ctx, {
            x: el.x,
            y: el.y,
            width: el.width,
            title: el.title,
            keywords: el.keywords,
            summary: el.summary,
            color: el.color,
          });
        } else if (el.type === 'flowchart') {
          drawConceptFlowchart(ctx, {
            x: el.x,
            y: el.y,
            nodes: el.nodes,
            activeNodeIndex: el.activeNodeIndex,
            color: el.color,
          });
        } else if (el.type === 'illustration') {
          drawRichIllustration(ctx, {
            type: el.illustrationType,
            x: el.x,
            y: el.y,
            width: el.width,
            height: el.height,
            progress: el.progress,
            color: el.color,
          });
        } else if (el.type === 'target_arrow') {
          const fromBounds = resolveTargetAnchorBounds(el.fromTarget, elements, rect.width, rect.height);
          const toBounds = resolveTargetAnchorBounds(el.toTarget, elements, rect.width, rect.height);
          drawTargetToTargetArrow(ctx, fromBounds, toBounds, el.label, el.color || '#0066FF');
        } else if (el.type === 'target_circle') {
          const tb = resolveTargetAnchorBounds(el.target, elements, rect.width, rect.height);
          drawOrganicCallout(ctx, tb.x, tb.y, tb.w, tb.h, el.color || '#0066FF');
        } else if (el.type === 'target_label') {
          const tb = resolveTargetAnchorBounds(el.target, elements, rect.width, rect.height);
          drawTargetLeaderLabel(ctx, tb, el.text, el.color || '#0066FF');
        } else if (el.type === 'target_underline') {
          const tb = resolveTargetAnchorBounds(el.target, elements, rect.width, rect.height);
          drawHandDrawnLine(ctx, tb.leftAnchor.x, tb.bottomAnchor.y + 4, tb.rightAnchor.x, tb.bottomAnchor.y + 4, {
            color: el.color || '#0066FF',
            width: 2.5,
          });
        } else if (el.type === 'worked_step') {
          drawWorkedEquationSteps(ctx, {
            x: el.x,
            y: el.y,
            width: el.width,
            steps: el.steps,
            activeStepIndex: el.activeStepIndex,
          });
        } else if (el.type === 'latex') {
          ctx.save();
          ctx.font = 'bold 20px "KaTeX_Main", "Times New Roman", serif';
          ctx.fillStyle = el.color || '#0F172A';
          ctx.fillText(el.text, el.x, el.y);
          ctx.restore();
        } else if (el.type === 'erase') {
          drawEraseWipeEffect(ctx, rect.width, rect.height, el.progress);
        } else if (el.type === 'focus') {
          drawPulsingFocusRing(ctx, el.x, el.y, el.w, el.h, elapsedSec, el.color);
        } else if ((el as any).type === 'text' || (el as any).type === 'label') {
          const liveEl = el as any;
          ctx.save();
          const rawX = liveEl.position?.x ?? 50;
          const rawY = liveEl.position?.y ?? 50;
          const pxX = (rawX / 100) * rect.width;
          const pxY = (rawY / 100) * rect.height;

          let fontSizePx = 18;
          if (liveEl.fontSize === '3xl' || liveEl.fontSize === '2xl') fontSizePx = 24;
          else if (liveEl.fontSize === 'xl') fontSizePx = 20;
          else if (liveEl.fontSize === 'sm') fontSizePx = 14;

          ctx.font = `600 ${fontSizePx}px "Inter", "Plus Jakarta Sans", system-ui, sans-serif`;
          ctx.fillStyle = liveEl.color || '#0F172A';
          ctx.textBaseline = 'top';

          const textContent = liveEl.content || '';
          const lines = textContent.split('\n');

          lines.forEach((line, idx) => {
            ctx.fillText(line, pxX, pxY + idx * (fontSizePx * 1.35));
          });

          if (liveEl.highlighted) {
            ctx.save();
            ctx.fillStyle = 'rgba(253, 224, 71, 0.35)';
            const textWidth = ctx.measureText(lines[0] || '').width || 100;
            ctx.fillRect(pxX - 4, pxY - 2, textWidth + 8, fontSizePx * 1.35);
            ctx.restore();
          }
          if (liveEl.circled) {
            const textWidth = ctx.measureText(lines[0] || '').width || 100;
            drawOrganicCallout(ctx, pxX - 8, pxY - 4, textWidth + 16, fontSizePx * 1.4, liveEl.color || '#38BDF8');
          }
          if (liveEl.underlined) {
            const textWidth = ctx.measureText(lines[0] || '').width || 100;
            drawHandDrawnLine(ctx, pxX, pxY + fontSizePx + 2, pxX + textWidth, pxY + fontSizePx + 2, {
              color: liveEl.color || '#38BDF8',
              width: 2,
            });
          }
          ctx.restore();
        } else if ((el as any).type === 'formula') {
          const liveEl = el as any;
          ctx.save();
          const rawX = liveEl.position?.x ?? 50;
          const rawY = liveEl.position?.y ?? 50;
          const pxX = (rawX / 100) * rect.width;
          const pxY = (rawY / 100) * rect.height;

          const formulaText = liveEl.latex || liveEl.content || '';

          ctx.font = 'bold 22px "KaTeX_Main", "Times New Roman", serif';
          ctx.fillStyle = liveEl.color || '#0066FF';
          ctx.textBaseline = 'top';
          ctx.fillText(formulaText, pxX, pxY);

          if (liveEl.highlighted) {
            ctx.save();
            ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
            const textWidth = ctx.measureText(formulaText).width || 120;
            ctx.fillRect(pxX - 6, pxY - 4, textWidth + 12, 32);
            ctx.restore();
          }
          ctx.restore();
        } else if ((el as any).type === 'svg') {
          const liveEl = el as any;
          if (liveEl.svgContent) {
            const rawX = liveEl.position?.x ?? 50;
            const rawY = liveEl.position?.y ?? 60;
            const pxX = (rawX / 100) * rect.width;
            const pxY = (rawY / 100) * rect.height;

            const img = getSvgImage(liveEl.id, liveEl.svgContent);
            if (img && img.complete && img.naturalWidth !== 0) {
              const targetW = Math.min(rect.width * 0.65, 420);
              const targetH = Math.min(rect.height * 0.55, 280);
              ctx.drawImage(img, pxX - targetW / 2, pxY - targetH / 2, targetW, targetH);
            }
          }
        } else if ((el as any).type === 'diagram') {
          const liveEl = el as any;
          const rawX = liveEl.position?.x ?? 50;
          const rawY = liveEl.position?.y ?? 55;
          const pxX = (rawX / 100) * rect.width;
          const pxY = (rawY / 100) * rect.height;

          const props = liveEl.diagramProps || {};
          if (props.drawType === 'axes') {
            drawCoordinateAxes(ctx, {
              originX: pxX,
              originY: pxY,
              width: 180,
              height: 140,
              xLabel: props.xLabel || 'x',
              yLabel: props.yLabel || 'y',
              progress: liveEl.progress ?? 1.0,
              color: liveEl.color,
            });
          } else if (props.drawType === 'arrow') {
            drawAnnotatedArrow(
              ctx,
              { x: props.x1 ?? (pxX - 50), y: props.y1 ?? pxY },
              { x: props.x2 ?? (pxX + 50), y: props.y2 ?? pxY },
              props.label || liveEl.content || '',
              liveEl.color || '#0066FF'
            );
          } else if (liveEl.content) {
            ctx.save();
            ctx.font = '600 18px "Inter", sans-serif';
            ctx.fillStyle = liveEl.color || '#0066FF';
            ctx.fillText(liveEl.content, pxX, pxY);
            ctx.restore();
          }
        }
      }

      // 3. Render Active Focus Pulse Highlight (when tutor mentions an area)
      if (activeFocusArea) {
        drawPulsingFocusRing(
          ctx,
          activeFocusArea.x,
          activeFocusArea.y,
          activeFocusArea.w,
          activeFocusArea.h,
          elapsedSec,
          activeFocusArea.color || '#0066FF'
        );
      }

      // 4. Render Student Strokes & Lasso
      for (const s of studentStrokes) {
        renderStrokeToContext(ctx, s.points, s.color, s.size);
      }

      if (currentStudentStroke && currentStudentStroke.length > 1) {
        if (studentMode === 'lasso') {
          ctx.save();
          ctx.strokeStyle = '#0066FF';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 6]);
          ctx.fillStyle = 'rgba(0, 102, 255, 0.08)';
          ctx.beginPath();
          ctx.moveTo(currentStudentStroke[0].x, currentStudentStroke[0].y);
          for (let i = 1; i < currentStudentStroke.length; i++) {
            ctx.lineTo(currentStudentStroke[i].x, currentStudentStroke[i].y);
          }
          ctx.stroke();
          ctx.fill();
          ctx.restore();
        } else {
          renderStrokeToContext(ctx, currentStudentStroke, '#002D62', 4);
        }
      }

      // 5. Render Tutor Stylus Laser Glow Pointer
      if (tutorPointer && tutorPointer.active) {
        drawLaserPointerGlow(ctx, tutorPointer.x, tutorPointer.y, tutorPointer.color || '#0066FF');
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    animationFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [elements, tutorPointer, activeFocusArea, studentStrokes, currentStudentStroke, studentMode, gridStyle]);

  // Pointer & Touch Events for Student Drawing / Lasso Selection
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isStudentDrawingEnabled && studentMode === 'none') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;

    isDrawingRef.current = true;
    setCurrentStudentStroke([{ x, y, pressure }]);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;

    setCurrentStudentStroke(prev => (prev ? [...prev, { x, y, pressure }] : [{ x, y, pressure }]));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !currentStudentStroke) return;
    isDrawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) {
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }

    if (studentMode === 'lasso' && currentStudentStroke.length > 3) {
      // Compute bounding box of lasso polygon
      const xs = currentStudentStroke.map(p => p.x);
      const ys = currentStudentStroke.map(p => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

      // Identify elements inside lasso
      const matchedIds = elements
        .filter(el => {
          if ('x' in el && 'y' in el) {
            return el.x >= minX - 20 && el.x <= maxX + 20 && el.y >= minY - 20 && el.y <= maxY + 20;
          }
          if ('originX' in el && 'originY' in el) {
            return el.originX >= minX && el.originX <= maxX && el.originY >= minY && el.originY <= maxY;
          }
          return false;
        })
        .map(el => el.id);

      setLassoedElementIds(matchedIds);
      onStudentLassoSelect?.(matchedIds, bounds);
      setTimeout(() => setCurrentStudentStroke(null), 300);
    } else {
      const completed = {
        id: `stroke_${Date.now()}`,
        points: currentStudentStroke,
        color: '#002D62',
        size: 4,
      };
      setStudentStrokes(prev => [...prev, completed]);
      onStudentStrokeComplete?.(completed);
      setCurrentStudentStroke(null);
    }
  };

  const clearStudentDrawing = () => {
    setStudentStrokes([]);
    setCurrentStudentStroke(null);
    setLassoedElementIds([]);
  };

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[380px] bg-[#FFFFFF] dark:bg-[#0A0A0A] rounded-[24px] border border-[#E3E9F1] dark:border-slate-800 shadow-sm overflow-hidden select-none touch-none ${className}`}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="w-full h-full block cursor-crosshair"
      />

      {/* Floating Mini Controls for Student */}
      {isStudentDrawingEnabled && (
        <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-[#E3E9F1] dark:border-slate-800 shadow-md z-20">
          <button
            type="button"
            onClick={clearStudentDrawing}
            className="text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-500 transition px-2 py-1 rounded-md"
            title="Clear my drawings"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
};
