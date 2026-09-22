/**
 * SvgRenderer.ts
 *
 * Deterministic SVG Renderer for the Avelut Visual Illustration Engine.
 * Converts structured IllustrationSpec JSON into high-contrast, sanitized, responsive educational SVG.
 */

import type { IllustrationSpec, VisualElement } from './types';
import { renderPrimitive, renderRelationship } from './visualPrimitives';

export class SvgRenderer {
  private static readonly VIEW_WIDTH = 480;
  private static readonly VIEW_HEIGHT = 320;

  /**
   * Render an IllustrationSpec into a complete standalone SVG string.
   */
  public static render(spec: IllustrationSpec, previousElements?: VisualElement[]): string {
    if (!spec || !spec.shouldIllustrate) {
      return '';
    }

    try {
      // 1. Resolve elements based on action
      let elements: VisualElement[] = [...(spec.elements || [])];

      if (spec.action === 'update' && spec.targetId && spec.changes) {
        // Merge updates into previous elements if available
        if (previousElements && previousElements.length > 0) {
          elements = previousElements.map((el) => {
            if (el.id === spec.targetId) {
              return {
                ...el,
                ...spec.changes,
                properties: { ...(el.properties || {}), ...(spec.changes?.properties || {}) },
              };
            }
            return el;
          });
        }
      }

      const elementsById = new Map<string, VisualElement>();
      elements.forEach(el => elementsById.set(el.id, el));

      // 2. Identify highlighted IDs
      const highlightedIds = new Set<string>();
      if (spec.action === 'highlight' && spec.targetId) {
        highlightedIds.add(spec.targetId);
      }
      if (spec.highlights && Array.isArray(spec.highlights)) {
        spec.highlights.forEach(id => highlightedIds.add(id));
      }

      // 3. Render Primitives
      const renderedElements = elements
        .map(el => renderPrimitive(el, highlightedIds.has(el.id)))
        .join('\n');

      // 4. Render Relationships / Vectors
      const renderedRelationships = (spec.relationships || [])
        .map(rel => {
          const isHighlighted = (rel.id && highlightedIds.has(rel.id)) ||
                                highlightedIds.has(rel.from) ||
                                highlightedIds.has(rel.to);
          return renderRelationship(rel, elementsById, isHighlighted);
        })
        .join('\n');

      // 5. Render Labels
      const renderedLabels = (spec.labels || [])
        .map(label => {
          const style = label.style || 'callout';
          const fill = label.color || (style === 'header' ? '#38BDF8' : '#F8FAFC');
          const isHeader = style === 'header';

          return `
            <g class="label-callout" transform="translate(${label.x}, ${label.y})">
              ${style === 'badge' ? `
                <rect x="-6" y="-14" width="${label.text.length * 8 + 12}" height="20" rx="4" fill="#0F172A" stroke="#38BDF8" stroke-width="1.2" />
              ` : ''}
              <text x="0" y="0" fill="${fill}" font-size="${isHeader ? '14' : '11'}" font-weight="${isHeader ? '700' : '500'}" font-family="system-ui, -apple-system, sans-serif">
                ${escapeXml(label.text)}
              </text>
            </g>
          `;
        })
        .join('\n');

      // 6. Render Equations (Formatted with scientific/KaTeX LaTeX notation)
      const renderedEquations = (spec.equations || [])
        .map((eq, i) => {
          const x = eq.x ?? (240);
          const y = eq.y ?? (290 - i * 32);
          const rawLatex = eq.latex.replace(/^\$\$|\$\$$/g, '').trim();

          return `
            <g class="visual-equation" transform="translate(${x}, ${y})">
              <rect x="-140" y="-18" width="280" height="36" rx="8" fill="#1E1B4B" stroke="#FDE047" stroke-width="1.5" />
              <text x="0" y="5" text-anchor="middle" fill="#FDE047" font-size="14" font-weight="700" font-family="'KaTeX_Main', 'Times New Roman', serif">
                ${escapeXml(rawLatex)}
              </text>
              ${eq.label ? `<text x="0" y="-22" text-anchor="middle" fill="#94A3B8" font-size="9" font-family="system-ui, sans-serif">${escapeXml(eq.label)}</text>` : ''}
            </g>
          `;
        })
        .join('\n');

      // 7. Compose SVG
      return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.VIEW_WIDTH} ${this.VIEW_HEIGHT}" width="100%" height="100%" class="avelut-visual-illustration" style="background: #0A0A0A; border-radius: 12px; overflow: hidden;">
  <defs>
    <!-- Arrowhead Markers -->
    <marker id="arrow-accent" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#38BDF8" />
    </marker>
    <marker id="arrow-force" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#38BDF8" />
    </marker>
    <marker id="arrow-velocity" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#34D399" />
    </marker>
    <marker id="arrow-acceleration" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#FBBF24" />
    </marker>
    <marker id="arrow-gravity" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#EF4444" />
    </marker>
    <marker id="arrow-axis" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 2 L 7 5 L 0 8 z" fill="#94A3B8" />
    </marker>

    <!-- Glow Highlight Filter -->
    <filter id="glow-highlight" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="3.5" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>

    <!-- Subtle Background Grid Pattern -->
    <pattern id="tech-grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="rgba(255, 255, 255, 0.04)" stroke-width="1" />
    </pattern>
  </defs>

  <!-- Technical Canvas Grid -->
  <rect width="100%" height="100%" fill="url(#tech-grid)" />

  <!-- Title & Purpose Header -->
  ${spec.title ? `
    <g class="illustration-header">
      <rect x="12" y="10" width="${Math.min(spec.title.length * 9 + 28, 420)}" height="26" rx="6" fill="#18181B" stroke="#27272A" stroke-width="1" />
      <circle cx="24" cy="23" r="3.5" fill="#38BDF8" />
      <text x="34" y="27" fill="#F8FAFC" font-size="12" font-weight="700" font-family="system-ui, sans-serif">
        ${escapeXml(spec.title)}
      </text>
    </g>
  ` : ''}

  <!-- Rendered Content Layers -->
  <g class="visual-layer-relationships">
    ${renderedRelationships}
  </g>
  <g class="visual-layer-elements">
    ${renderedElements}
  </g>
  <g class="visual-layer-labels">
    ${renderedLabels}
  </g>
  <g class="visual-layer-equations">
    ${renderedEquations}
  </g>
</svg>
      `.trim();
    } catch (err) {
      console.error('[SvgRenderer] Failed to render illustration spec:', err);
      return '';
    }
  }
}

function escapeXml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
