import React, { useRef, useEffect, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { LiveBoardElement } from '../../../types/teachingScript';
import { BoardDiagramPrimitives } from './BoardDiagramPrimitives';
import { sanitizeSvg } from '../../../utils/svgSanitizer';

export interface TeachingBoardProps {
  elements: LiveBoardElement[];
  activeHighlights?: Set<string>;
  activeCircles?: Set<string>;
  activeUnderlines?: Set<string>;
  tutorPointer?: { x: number; y: number; active: boolean; color?: string } | null;
  isAudioReady?: boolean;
  className?: string;
}

const TypedText: React.FC<{
  text: string;
  className?: string;
  style?: React.CSSProperties;
  enabled?: boolean;
  speedMs?: number;
}> = ({ text, className, style, enabled = true, speedMs = 26 }) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      return;
    }
    if (!enabled) {
      setDisplayedText(text);
      setIsTyping(false);
      return;
    }

    setDisplayedText('');
    setIsTyping(true);
    let index = 0;

    const timer = setInterval(() => {
      index++;
      if (index <= text.length) {
        setDisplayedText(text.slice(0, index));
      } else {
        setIsTyping(false);
        clearInterval(timer);
      }
    }, speedMs);

    return () => clearInterval(timer);
  }, [text, enabled, speedMs]);

  return (
    <p className={className} style={style}>
      {displayedText}
      {isTyping && (
        <span className="inline-block w-2 h-5 ml-1 bg-[#38BDF8] shadow-[0_0_8px_#38BDF8] animate-pulse align-middle" />
      )}
    </p>
  );
};

/** Progressive stroke animation for pure LLM path commands (coords 0–100 → viewBox 0 0 600 400 for crisp 2px lines) */
const ProgressivePathDraw: React.FC<{
  drawType: string;
  d?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  r?: number;
  label?: string;
  color: string;
  strokeWidth: number;
  fill?: string;
  progress: number;
}> = ({
  drawType,
  d,
  x1 = 20,
  y1 = 50,
  x2 = 80,
  y2 = 50,
  cx = 50,
  cy = 50,
  r = 12,
  label,
  color,
  strokeWidth,
  fill,
  progress,
}) => {
  const p = Math.max(0.02, Math.min(1, progress ?? 1));
  const scaleX = 6;
  const scaleY = 4;

  const sx1 = (x1 ?? 20) * scaleX;
  const sy1 = (y1 ?? 50) * scaleY;
  const sx2 = (x2 ?? 80) * scaleX;
  const sy2 = (y2 ?? 50) * scaleY;
  const scx = (cx ?? 50) * scaleX;
  const scy = (cy ?? 50) * scaleY;
  const sr = (r ?? 12) * scaleY;

  // Thin crisp stroke width (2px in 600x400 space)
  const thinStrokeWidth = Math.min(strokeWidth || 2.2, 3);

  const common = {
    stroke: color,
    strokeWidth: thinStrokeWidth,
    fill: fill || 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    pathLength: 1 as number,
    strokeDasharray: 1 as number,
    strokeDashoffset: 1 - p,
  };

  const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
  const ah = 10;
  const ax = sx2 - ah * Math.cos(angle - 0.4);
  const ay = sy2 - ah * Math.sin(angle - 0.4);
  const bx = sx2 - ah * Math.cos(angle + 0.4);
  const by = sy2 - ah * Math.sin(angle + 0.4);

  return (
    <svg
      viewBox="0 0 600 400"
      className="w-full max-w-[560px] h-auto max-h-[300px] sm:max-h-[380px] overflow-visible drop-shadow-md"
      preserveAspectRatio="xMidYMid meet"
    >
      {drawType === 'path' && d && <path d={d} {...common} />}
      {drawType === 'line' && <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} {...common} />}
      {drawType === 'circle' && <circle cx={scx} cy={scy} r={sr} {...common} />}
      {drawType === 'arrow' && (
        <>
          <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} {...common} />
          <polygon points={`${sx2},${sy2} ${ax},${ay} ${bx},${by}`} fill={color} opacity={p} />
        </>
      )}
      {label && (
        <text
          x={drawType === 'circle' ? scx : (sx1 + sx2) / 2}
          y={(drawType === 'circle' ? scy : (sy1 + sy2) / 2) - 14}
          textAnchor="middle"
          fill={color}
          fontSize="15"
          fontWeight={700}
          opacity={p}
          style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
        >
          {label}
        </text>
      )}
    </svg>
  );
};

/**
 * Fixed Viewport Digital Chalkboard — production teaching board
 * Illustration-first progressive paths, large readable type, KaTeX, custom SVG
 */
export const TeachingBoard: React.FC<TeachingBoardProps> = ({
  elements,
  activeHighlights = new Set(),
  activeCircles = new Set(),
  activeUnderlines = new Set(),
  tutorPointer,
  isAudioReady = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const updateSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(dpr, dpr);
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const render = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      const spacing = 36;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      for (let x = 18; x < rect.width; x += spacing) {
        for (let y = 18; y < rect.height; y += spacing) {
          ctx.beginPath();
          ctx.arc(x, y, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      animId = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full bg-[#0F172A] rounded-2xl sm:rounded-3xl border border-[#1E293B] shadow-2xl overflow-hidden select-none font-sans text-slate-100 ${className}`}
      style={{
        background: 'radial-gradient(ellipse at 50% 18%, #131E35 0%, #0B1120 55%, #070B14 100%)',
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0" />

      <div className="relative z-10 w-full h-full overflow-hidden">
        {elements.map((el) => {
            const posX = Math.max(8, Math.min(92, el.position?.x ?? 50));
            const posY = Math.max(6, Math.min(94, el.position?.y ?? 50));
            const isHighlighted = activeHighlights.has(el.id);
            const isCircled = activeCircles.has(el.id);
            const isUnderlined = activeUnderlines.has(el.id);
            const isTitle =
              (el.type === 'text' || el.type === 'write') &&
              (posY <= 16 || el.id?.includes('title'));
            const isKeyPoint =
              (el.type === 'text' || el.type === 'write') &&
              !isTitle &&
              ((el.content || '').trim().startsWith('•') ||
                (el.content || '').trim().startsWith('-') ||
                posX < 38);

            const diagramWidth = typeof window !== 'undefined' && window.innerWidth < 640 ? 320 : 480;
            const diagramHeight = typeof window !== 'undefined' && window.innerWidth < 640 ? 220 : 320;

            const safeSvg =
              el.type === 'svg' || el.type === 'draw' || el.svgContent || (el as any).metadata?.svgContent
                ? sanitizeSvg(el.svgContent || (el as any).metadata?.svgContent)
                : null;
            const drawType = el.diagramProps?.drawType as string | undefined;

            return (
              <div
                key={el.id}
                className="absolute pointer-events-none transition-all duration-300"
                style={{
                  left: `${posX}%`,
                  top: `${posY}%`,
                  transform: isKeyPoint ? 'translate(0, -50%)' : 'translate(-50%, -50%)',
                  maxWidth: isTitle
                    ? '92%'
                    : isKeyPoint
                      ? '50%'
                      : el.type === 'diagram' || el.type === 'svg'
                        ? '88%'
                        : '80%',
                }}
              >
                {(el.type === 'svg' || el.type === 'draw' || safeSvg) && safeSvg && (
                  <div className="relative flex flex-col items-center justify-center w-full max-h-[280px] sm:max-h-[380px] md:max-h-[440px]">
                    <div
                      className="w-full h-full flex items-center justify-center text-slate-100 [&_svg]:max-w-full [&_svg]:max-h-[280px] sm:[&_svg]:max-h-[380px] md:[&_svg]:max-h-[440px] [&_svg]:w-auto [&_svg]:h-auto drop-shadow-md"
                      dangerouslySetInnerHTML={{ __html: safeSvg }}
                    />
                    {isCircled && (
                      <div className="absolute inset-0 rounded-2xl ring-4 ring-[#38BDF8]/70 pointer-events-none animate-pulse" />
                    )}
                  </div>
                )}

                {(el.type === 'formula' || el.latex) && (
                  <div className="relative flex flex-col items-center justify-center px-2 py-1">
                    <div
                      className={`text-3xl sm:text-5xl md:text-6xl font-black tracking-wide break-words text-center ${
                        isHighlighted ? 'text-[#38BDF8] scale-105' : 'text-white'
                      } transition-transform`}
                      style={{ color: el.color || '#38BDF8' }}
                      dangerouslySetInnerHTML={{
                        __html: katex.renderToString(el.latex || el.content || '', {
                          displayMode: true,
                          throwOnError: false,
                        }),
                      }}
                    />
                    {isUnderlined && (
                      <svg className="w-full h-3 mt-1" viewBox="0 0 100 8" preserveAspectRatio="none">
                        <path d="M 0 4 Q 50 8 100 3" fill="none" stroke="#38BDF8" strokeWidth="3" />
                      </svg>
                    )}
                  </div>
                )}

                {el.type === 'diagram' && drawType && !safeSvg && (
                  <div className="relative flex flex-col items-center justify-center w-full">
                    <ProgressivePathDraw
                      drawType={drawType}
                      d={el.diagramProps?.d}
                      x1={el.diagramProps?.x1}
                      y1={el.diagramProps?.y1}
                      x2={el.diagramProps?.x2}
                      y2={el.diagramProps?.y2}
                      cx={el.diagramProps?.cx}
                      cy={el.diagramProps?.cy}
                      r={el.diagramProps?.r}
                      label={el.diagramProps?.label}
                      color={el.color || '#38BDF8'}
                      strokeWidth={el.diagramProps?.strokeWidth || 2.5}
                      fill={el.diagramProps?.fill}
                      progress={el.progress ?? 1}
                    />
                    {isCircled && (
                      <div className="absolute inset-0 rounded-xl ring-2 ring-[#38BDF8]/60 pointer-events-none" />
                    )}
                  </div>
                )}

                {el.type === 'diagram' && !drawType && !safeSvg && (
                  <div className="relative flex flex-col items-center justify-center w-full">
                    <BoardDiagramPrimitives
                      type={el.primitive || 'concept_map'}
                      diagram={el.diagram}
                      width={diagramWidth}
                      height={diagramHeight}
                      progress={el.progress ?? 1.0}
                      color={el.color || '#38BDF8'}
                      activeHighlights={activeHighlights}
                      activeCircles={activeCircles}
                      activeUnderlines={activeUnderlines}
                      metadata={el.diagramProps}
                    />
                    {isCircled && (
                      <div className="absolute inset-0 rounded-xl ring-2 ring-[#38BDF8]/60 pointer-events-none" />
                    )}
                  </div>
                )}

                {el.type === 'arrow' && (
                  <div className="flex items-center gap-2 justify-center">
                    <svg width="56" height="28" viewBox="0 0 40 20">
                      <line x1="0" y1="10" x2="30" y2="10" stroke={el.color || '#38BDF8'} strokeWidth="4" strokeLinecap="round" />
                      <polygon points="28,3 40,10 28,17" fill={el.color || '#38BDF8'} />
                    </svg>
                    {el.content && (
                      <span className="text-base sm:text-lg font-bold text-[#38BDF8]">{el.content}</span>
                    )}
                  </div>
                )}

                {el.type === 'label' && (
                  <span className="text-base sm:text-lg md:text-2xl font-bold text-[#FACC15] block text-center px-1">
                    {el.content}
                  </span>
                )}

                {(el.type === 'text' || el.type === 'write') && !el.latex && (
                  <div className={`relative px-1 ${isKeyPoint ? 'text-left' : 'text-center'} max-w-full`}>
                    <TypedText
                      text={el.content || ''}
                      enabled={isAudioReady}
                      className={`tracking-wide break-words leading-snug ${
                        isTitle
                          ? 'text-2xl sm:text-3xl md:text-4xl font-black uppercase text-white border-b-2 border-[#38BDF8] pb-1'
                          : isKeyPoint
                            ? 'text-xl sm:text-2xl md:text-3xl font-bold text-slate-100'
                            : 'text-lg sm:text-2xl md:text-3xl font-semibold text-slate-200'
                      } ${isHighlighted ? 'text-[#38BDF8] scale-105' : ''}`}
                      style={{ color: el.color || undefined }}
                    />
                    {isUnderlined && (
                      <svg className="w-full h-2 mt-1" viewBox="0 0 100 8" preserveAspectRatio="none">
                        <path d="M 0 4 Q 50 8 100 3" fill="none" stroke="#38BDF8" strokeWidth="3" />
                      </svg>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {tutorPointer && tutorPointer.active && (
          <div
            className="absolute z-30 w-4 h-4 rounded-full bg-[#38BDF8] shadow-[0_0_16px_#38BDF8] pointer-events-none -translate-x-1/2 -translate-y-1/2 animate-ping"
            style={{ left: `${tutorPointer.x}%`, top: `${tutorPointer.y}%` }}
          />
        )}
      </div>
    </div>
  );
};

export default TeachingBoard;
