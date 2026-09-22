/**
 * visualPrimitives.ts
 *
 * Educational visual primitive definitions for technical & scientific illustrations.
 * Covers Physics, Chemistry, Biology, Mathematics, and Computer Science.
 * Renders deterministic, responsive SVG paths designed for Avelut's dark blackboard canvas (#0A0A0A).
 */

import type { VisualElement, VisualRelationship } from './types';

export function renderPrimitive(el: VisualElement, isHighlighted = false): string {
  const { id, primitive, x = 240, y = 160, width = 60, height = 60, label = '', properties = {} } = el;
  const highlightClass = isHighlighted ? 'filter="url(#glow-highlight)"' : '';
  const accentColor = properties.color || (isHighlighted ? '#FBBF24' : '#38BDF8');

  switch (primitive.toLowerCase()) {
    // ══════════════════════════════════════════════════════════════════════════
    // PHYSICS PRIMITIVES
    // ══════════════════════════════════════════════════════════════════════════

    case 'person':
    case 'human': {
      // Stylized educator/person figure (head, torso, legs, arms)
      const isPushing = properties.action === 'push' || properties.pose === 'pushing';
      const armPath = isPushing
        ? `M ${x + 2} ${y + 22} L ${x + 24} ${y + 16} L ${x + 36} ${y + 20}`
        : `M ${x - 12} ${y + 22} L ${x} ${y + 14} L ${x + 12} ${y + 22}`;

      return `
        <g id="${id}" class="primitive person" ${highlightClass}>
          <!-- Head -->
          <circle cx="${x}" cy="${y}" r="9" fill="#1E293B" stroke="${accentColor}" stroke-width="2" />
          <!-- Torso -->
          <line x1="${x}" y1="${y + 9}" x2="${x}" y2="${y + 36}" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round" />
          <!-- Arms -->
          <path d="${armPath}" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" />
          <!-- Legs -->
          <path d="M ${x} ${y + 36} L ${x - 10} ${y + 58} M ${x} ${y + 36} L ${x + 10} ${y + 58}" fill="none" stroke="${accentColor}" stroke-width="2.5" stroke-linecap="round" />
          ${label ? `<text x="${x}" y="${y + 72}" text-anchor="middle" fill="#E2E8F0" font-size="11" font-weight="600" font-family="system-ui, sans-serif">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'box':
    case 'block':
    case 'mass': {
      // Mass block with center-of-mass marker
      const w = width || 70;
      const h = height || 50;
      const rx = x - w / 2;
      const ry = y - h / 2;
      const massText = properties.mass ? `m = ${properties.mass}` : label;

      return `
        <g id="${id}" class="primitive box" ${highlightClass}>
          <rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="6" fill="#1E293B" stroke="${accentColor}" stroke-width="2" />
          <!-- Center of mass crosshair -->
          <circle cx="${x}" cy="${y}" r="3" fill="${accentColor}" />
          ${massText ? `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="#FFFFFF" font-size="13" font-weight="700" font-family="system-ui, sans-serif">${escapeXml(massText)}</text>` : ''}
        </g>
      `;
    }

    case 'ground':
    case 'surface': {
      // Ground plane with hatched friction lines
      const w = width || 440;
      const gx = x - w / 2;
      const gy = y;
      let hatchLines = '';
      for (let i = 0; i < w; i += 16) {
        hatchLines += `<line x1="${gx + i}" y1="${gy}" x2="${gx + i - 8}" y2="${gy + 10}" stroke="#475569" stroke-width="1.5" />`;
      }

      return `
        <g id="${id}" class="primitive ground" ${highlightClass}>
          <line x1="${gx}" y1="${gy}" x2="${gx + w}" y2="${gy}" stroke="#94A3B8" stroke-width="2" stroke-linecap="round" />
          ${hatchLines}
          ${label ? `<text x="${x}" y="${gy + 24}" text-anchor="middle" fill="#64748B" font-size="10" font-family="system-ui, sans-serif">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'inclined_plane':
    case 'ramp': {
      // Triangular wedge ramp
      const w = width || 180;
      const h = height || 90;
      const theta = properties.angle || 'θ';

      return `
        <g id="${id}" class="primitive inclined-plane" ${highlightClass}>
          <polygon points="${x - w / 2},${y + h / 2} ${x + w / 2},${y + h / 2} ${x - w / 2},${y - h / 2}" fill="#1E293B" stroke="${accentColor}" stroke-width="2" stroke-linejoin="round" />
          <!-- Right angle mark -->
          <path d="M ${x - w / 2 + 14} ${y + h / 2} L ${x - w / 2 + 14} ${y + h / 2 - 14} L ${x - w / 2} ${y + h / 2 - 14}" fill="none" stroke="#64748B" stroke-width="1.5" />
          <!-- Angle arc -->
          <path d="M ${x + w / 2 - 32} ${y + h / 2} A 32 32 0 0 0 ${x + w / 2 - 28} ${y + h / 2 - 14}" fill="none" stroke="#FBBF24" stroke-width="1.5" />
          <text x="${x + w / 2 - 42}" y="${y + h / 2 - 6}" fill="#FBBF24" font-size="12" font-weight="700">${escapeXml(theta)}</text>
          ${label ? `<text x="${x}" y="${y + h / 2 + 20}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'pulley': {
      // Pulley wheel with axle
      const r = (width || 44) / 2;
      return `
        <g id="${id}" class="primitive pulley" ${highlightClass}>
          <circle cx="${x}" cy="${y}" r="${r}" fill="#1E293B" stroke="${accentColor}" stroke-width="2.5" />
          <circle cx="${x}" cy="${y}" r="4" fill="${accentColor}" />
          <!-- Support bracket -->
          <line x1="${x}" y1="${y}" x2="${x}" y2="${y - r - 16}" stroke="#94A3B8" stroke-width="2" stroke-dasharray="2,2" />
          ${label ? `<text x="${x + r + 8}" y="${y + 4}" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'spring': {
      // Coiled spring
      const length = width || 120;
      const coils = 7;
      const step = length / (coils * 2);
      const amp = 12;
      let path = `M ${x - length / 2} ${y}`;
      for (let i = 0; i < coils * 2; i++) {
        const cx = x - length / 2 + (i + 1) * step;
        const cy = i % 2 === 0 ? y - amp : y + amp;
        path += ` L ${cx} ${cy}`;
      }
      path += ` L ${x + length / 2} ${y}`;

      return `
        <g id="${id}" class="primitive spring" ${highlightClass}>
          <path d="${path}" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          ${label ? `<text x="${x}" y="${y - amp - 8}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'pendulum': {
      // Suspended pendulum bob
      const length = height || 110;
      const r = 14;
      const angle = properties.angle || 15;
      const rad = (angle * Math.PI) / 180;
      const bobX = x + Math.sin(rad) * length;
      const bobY = y + Math.cos(rad) * length;

      return `
        <g id="${id}" class="primitive pendulum" ${highlightClass}>
          <!-- Pivot point -->
          <circle cx="${x}" cy="${y}" r="3" fill="#94A3B8" />
          <line x1="${x - 14}" y1="${y}" x2="${x + 14}" y2="${y}" stroke="#64748B" stroke-width="2" />
          <!-- String -->
          <line x1="${x}" y1="${y}" x2="${bobX}" y2="${bobY}" stroke="#94A3B8" stroke-width="1.5" stroke-dasharray="3,2" />
          <!-- Bob -->
          <circle cx="${bobX}" cy="${bobY}" r="${r}" fill="#1E293B" stroke="${accentColor}" stroke-width="2.5" />
          ${label ? `<text x="${bobX + r + 8}" y="${bobY + 4}" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'ball':
    case 'projectile': {
      // Spherical projectile with velocity glow
      const r = (width || 36) / 2;
      return `
        <g id="${id}" class="primitive ball" ${highlightClass}>
          <circle cx="${x}" cy="${y}" r="${r}" fill="#0F172A" stroke="${accentColor}" stroke-width="2.5" />
          <circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.25}" fill="${accentColor}" opacity="0.6" />
          ${label ? `<text x="${x}" y="${y + r + 16}" text-anchor="middle" fill="#E2E8F0" font-size="11" font-weight="600">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'car':
    case 'vehicle': {
      // Aerodynamic vehicle silhouette
      const w = width || 96;
      const h = height || 44;
      const rx = x - w / 2;
      const ry = y - h / 2;

      return `
        <g id="${id}" class="primitive car" ${highlightClass}>
          <path d="M ${rx} ${ry + h - 12} L ${rx + 14} ${ry + 10} L ${rx + 36} ${ry} L ${rx + w - 24} ${ry} L ${rx + w} ${ry + 16} L ${rx + w} ${ry + h - 12} Z" fill="#1E293B" stroke="${accentColor}" stroke-width="2" stroke-linejoin="round" />
          <!-- Windows -->
          <path d="M ${rx + 24} ${ry + 10} L ${rx + 38} ${ry + 4} L ${rx + w - 30} ${ry + 4} L ${rx + w - 26} ${ry + 12} Z" fill="#0C4A6E" stroke="#38BDF8" stroke-width="1" />
          <!-- Wheels -->
          <circle cx="${rx + 22}" cy="${ry + h - 6}" r="9" fill="#0F172A" stroke="#E2E8F0" stroke-width="2.5" />
          <circle cx="${rx + w - 22}" cy="${ry + h - 6}" r="9" fill="#0F172A" stroke="#E2E8F0" stroke-width="2.5" />
          ${label ? `<text x="${x}" y="${ry - 8}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'trajectory': {
      // Parabolic flight trajectory
      const w = width || 220;
      const h = height || 80;
      const p1x = x - w / 2;
      const p1y = y + h / 2;
      const p2x = x;
      const p2y = y - h / 2;
      const p3x = x + w / 2;
      const p3y = y + h / 2;

      return `
        <g id="${id}" class="primitive trajectory" ${highlightClass}>
          <path d="M ${p1x} ${p1y} Q ${p2x} ${p2y - h * 0.4} ${p3x} ${p3y}" fill="none" stroke="#FBBF24" stroke-width="2" stroke-dasharray="5,4" />
          <!-- Apex marker -->
          <circle cx="${p2x}" cy="${p2y}" r="3" fill="#FBBF24" />
          <text x="${p2x}" y="${p2y - 8}" text-anchor="middle" fill="#FBBF24" font-size="10">Apex</text>
          ${label ? `<text x="${x}" y="${y + h / 2 + 18}" text-anchor="middle" fill="#94A3B8" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // CHEMISTRY PRIMITIVES
    // ══════════════════════════════════════════════════════════════════════════

    case 'atom': {
      // Atom with nucleus and orbital ellipses
      const r = (width || 60) / 2;
      const symbol = properties.symbol || label || 'e⁻';

      return `
        <g id="${id}" class="primitive atom" ${highlightClass}>
          <!-- Orbitals -->
          <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.4}" fill="none" stroke="#38BDF8" stroke-width="1.2" transform="rotate(30 ${x} ${y})" opacity="0.75" />
          <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.4}" fill="none" stroke="#38BDF8" stroke-width="1.2" transform="rotate(-30 ${x} ${y})" opacity="0.75" />
          <ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.4}" fill="none" stroke="#38BDF8" stroke-width="1.2" transform="rotate(90 ${x} ${y})" opacity="0.75" />
          <!-- Nucleus -->
          <circle cx="${x}" cy="${y}" r="11" fill="#EF4444" stroke="#FFFFFF" stroke-width="1.5" />
          <text x="${x}" y="${y + 4}" text-anchor="middle" fill="#FFFFFF" font-size="10" font-weight="bold">${escapeXml(symbol)}</text>
          ${label && label !== symbol ? `<text x="${x}" y="${y + r + 18}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'molecule': {
      // Multi-atom molecule model (e.g. H2O or custom)
      const molName = (properties.formula || label || 'H₂O').toUpperCase();
      if (molName.includes('H2O') || molName.includes('WATER')) {
        // Bent water molecule: Oxygen center, 2 Hydrogens at 104.5 degrees
        return `
          <g id="${id}" class="primitive molecule-h2o" ${highlightClass}>
            <!-- Bonds -->
            <line x1="${x}" y1="${y}" x2="${x - 36}" y2="${y + 26}" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" />
            <line x1="${x}" y1="${y}" x2="${x + 36}" y2="${y + 26}" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" />
            <!-- Oxygen (Red) -->
            <circle cx="${x}" cy="${y}" r="16" fill="#EF4444" stroke="#FFFFFF" stroke-width="2" />
            <text x="${x}" y="${y + 5}" text-anchor="middle" fill="#FFFFFF" font-size="12" font-weight="bold">O</text>
            <!-- Hydrogen 1 -->
            <circle cx="${x - 36}" cy="${y + 26}" r="10" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1.5" />
            <text x="${x - 36}" y="${y + 30}" text-anchor="middle" fill="#FFFFFF" font-size="9" font-weight="bold">H</text>
            <!-- Hydrogen 2 -->
            <circle cx="${x + 36}" cy="${y + 26}" r="10" fill="#38BDF8" stroke="#FFFFFF" stroke-width="1.5" />
            <text x="${x + 36}" y="${y + 30}" text-anchor="middle" fill="#FFFFFF" font-size="9" font-weight="bold">H</text>
            <!-- Angle label -->
            <text x="${x}" y="${y + 28}" text-anchor="middle" fill="#FBBF24" font-size="9">104.5°</text>
            ${label ? `<text x="${x}" y="${y + 54}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
          </g>
        `;
      }

      // Generic diatomic or linear molecule
      return `
        <g id="${id}" class="primitive molecule" ${highlightClass}>
          <line x1="${x - 28}" y1="${y}" x2="${x + 28}" y2="${y}" stroke="#94A3B8" stroke-width="3" />
          <circle cx="${x - 28}" cy="${y}" r="14" fill="#38BDF8" stroke="#FFFFFF" stroke-width="2" />
          <text x="${x - 28}" y="${y + 4}" text-anchor="middle" fill="#FFFFFF" font-size="10" font-weight="bold">A</text>
          <circle cx="${x + 28}" cy="${y}" r="14" fill="#34D399" stroke="#FFFFFF" stroke-width="2" />
          <text x="${x + 28}" y="${y + 4}" text-anchor="middle" fill="#FFFFFF" font-size="10" font-weight="bold">B</text>
          ${label ? `<text x="${x}" y="${y + 28}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'beaker':
    case 'test_tube': {
      // Chemistry laboratory beaker with fluid
      const w = width || 64;
      const h = height || 80;
      const rx = x - w / 2;
      const ry = y - h / 2;
      const fillPct = properties.fillPercent ?? 65;
      const fluidH = (h * fillPct) / 100;

      return `
        <g id="${id}" class="primitive beaker" ${highlightClass}>
          <!-- Liquid -->
          <rect x="${rx + 3}" y="${ry + h - fluidH}" width="${w - 6}" height="${fluidH - 2}" rx="3" fill="#0284C7" opacity="0.65" />
          <!-- Meniscus -->
          <ellipse cx="${x}" cy="${ry + h - fluidH}" rx="${(w - 6) / 2}" ry="4" fill="#38BDF8" opacity="0.8" />
          <!-- Beaker Glass Outline -->
          <path d="M ${rx - 4} ${ry} L ${rx} ${ry} L ${rx} ${ry + h - 4} Q ${rx} ${ry + h} ${rx + 6} ${ry + h} L ${rx + w - 6} ${ry + h} Q ${rx + w} ${ry + h} ${rx + w} ${ry + h - 4} L ${rx + w} ${ry} L ${rx + w + 4} ${ry}" fill="none" stroke="#E2E8F0" stroke-width="2" stroke-linejoin="round" />
          <!-- Measurement ticks -->
          <line x1="${rx}" y1="${ry + h * 0.3}" x2="${rx + 10}" y2="${ry + h * 0.3}" stroke="#94A3B8" stroke-width="1.5" />
          <line x1="${rx}" y1="${ry + h * 0.5}" x2="${rx + 14}" y2="${ry + h * 0.5}" stroke="#94A3B8" stroke-width="1.5" />
          <line x1="${rx}" y1="${ry + h * 0.7}" x2="${rx + 10}" y2="${ry + h * 0.7}" stroke="#94A3B8" stroke-width="1.5" />
          ${label ? `<text x="${x}" y="${ry + h + 18}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // BIOLOGY PRIMITIVES
    // ══════════════════════════════════════════════════════════════════════════

    case 'cell': {
      // Animal cell with membrane, nucleus, organelles
      const rx = (width || 140) / 2;
      const ry = (height || 90) / 2;

      return `
        <g id="${id}" class="primitive cell" ${highlightClass}>
          <!-- Plasma Membrane -->
          <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#064E3B" stroke="#34D399" stroke-width="2.5" opacity="0.9" />
          <!-- Nucleus -->
          <circle cx="${x - rx * 0.2}" cy="${y}" r="${ry * 0.4}" fill="#1E1B4B" stroke="#A78BFA" stroke-width="2" />
          <circle cx="${x - rx * 0.2}" cy="${y}" r="${ry * 0.16}" fill="#C084FC" />
          <!-- Mitochondria -->
          <ellipse cx="${x + rx * 0.4}" cy="${y - ry * 0.2}" rx="14" ry="7" fill="#78350F" stroke="#F59E0B" stroke-width="1.5" transform="rotate(20 ${x + rx * 0.4} ${y - ry * 0.2})" />
          <ellipse cx="${x + rx * 0.25}" cy="${y + ry * 0.35}" rx="12" ry="6" fill="#78350F" stroke="#F59E0B" stroke-width="1.5" transform="rotate(-35 ${x + rx * 0.25} ${y + ry * 0.35})" />
          ${label ? `<text x="${x}" y="${y + ry + 18}" text-anchor="middle" fill="#34D399" font-size="11" font-weight="600">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'dna': {
      // Double helix ladder segment
      const len = width || 130;
      const steps = 6;
      const stepW = len / steps;
      let rungs = '';
      for (let i = 0; i <= steps; i++) {
        const sx = x - len / 2 + i * stepW;
        const topY = y - 14 * Math.sin((i / steps) * Math.PI * 2);
        const botY = y + 14 * Math.sin((i / steps) * Math.PI * 2);
        rungs += `<line x1="${sx}" y1="${topY}" x2="${sx}" y2="${botY}" stroke="#FBBF24" stroke-width="1.5" />`;
      }

      return `
        <g id="${id}" class="primitive dna" ${highlightClass}>
          ${rungs}
          <!-- Strand 1 -->
          <path d="M ${x - len / 2} ${y} Q ${x - len / 4} ${y - 24} ${x} ${y} T ${x + len / 2} ${y}" fill="none" stroke="#38BDF8" stroke-width="2.5" />
          <!-- Strand 2 -->
          <path d="M ${x - len / 2} ${y} Q ${x - len / 4} ${y + 24} ${x} ${y} T ${x + len / 2} ${y}" fill="none" stroke="#F472B6" stroke-width="2.5" />
          ${label ? `<text x="${x}" y="${y + 32}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MATHEMATICS PRIMITIVES
    // ══════════════════════════════════════════════════════════════════════════

    case 'coordinate_plane':
    case 'graph':
    case 'axes': {
      // 2D Cartesian Coordinate Axis with Grid & Function Curve
      const size = width || 150;
      const half = size / 2;

      return `
        <g id="${id}" class="primitive coordinate-plane" ${highlightClass}>
          <!-- Grid lines -->
          <line x1="${x - half}" y1="${y - half / 2}" x2="${x + half}" y2="${y - half / 2}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2" />
          <line x1="${x - half}" y1="${y + half / 2}" x2="${x + half}" y2="${y + half / 2}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2" />
          <line x1="${x - half / 2}" y1="${y - half}" x2="${x - half / 2}" y2="${y + half}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2" />
          <line x1="${x + half / 2}" y1="${y - half}" x2="${x + half / 2}" y2="${y + half}" stroke="#334155" stroke-width="1" stroke-dasharray="2,2" />
          <!-- X Axis -->
          <line x1="${x - half}" y1="${y}" x2="${x + half}" y2="${y}" stroke="#94A3B8" stroke-width="2" marker-end="url(#arrow-axis)" />
          <text x="${x + half + 6}" y="${y + 4}" fill="#94A3B8" font-size="11">x</text>
          <!-- Y Axis -->
          <line x1="${x}" y1="${y + half}" x2="${x}" y2="${y - half}" stroke="#94A3B8" stroke-width="2" marker-end="url(#arrow-axis)" />
          <text x="${x - 4}" y="${y - half - 6}" fill="#94A3B8" font-size="11">y</text>
          <!-- Function Curve (Sine / Parabola) -->
          <path d="M ${x - half + 10} ${y + half * 0.6} Q ${x} ${y - half * 0.8} ${x + half - 10} ${y + half * 0.6}" fill="none" stroke="#38BDF8" stroke-width="2.5" />
          ${label ? `<text x="${x}" y="${y + half + 20}" text-anchor="middle" fill="#38BDF8" font-size="11" font-weight="600">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'triangle': {
      // Right-angled or equilateral geometric triangle
      const w = width || 90;
      const h = height || 75;

      return `
        <g id="${id}" class="primitive triangle" ${highlightClass}>
          <polygon points="${x - w / 2},${y + h / 2} ${x + w / 2},${y + h / 2} ${x - w / 2},${y - h / 2}" fill="#1E293B" stroke="${accentColor}" stroke-width="2" stroke-linejoin="round" />
          <!-- Right angle mark -->
          <path d="M ${x - w / 2 + 12} ${y + h / 2} L ${x - w / 2 + 12} ${y + h / 2 - 12} L ${x - w / 2} ${y + h / 2 - 12}" fill="none" stroke="#FBBF24" stroke-width="1.5" />
          ${label ? `<text x="${x}" y="${y + h / 2 + 18}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'circle': {
      // Mathematical circle with radius and center
      const r = (width || 70) / 2;
      return `
        <g id="${id}" class="primitive circle" ${highlightClass}>
          <circle cx="${x}" cy="${y}" r="${r}" fill="#1E293B" stroke="${accentColor}" stroke-width="2" />
          <circle cx="${x}" cy="${y}" r="3" fill="#FBBF24" />
          <!-- Radius line -->
          <line x1="${x}" y1="${y}" x2="${x + r}" y2="${y}" stroke="#FBBF24" stroke-width="1.5" stroke-dasharray="2,2" />
          <text x="${x + r / 2}" y="${y - 4}" fill="#FBBF24" font-size="10">r</text>
          ${label ? `<text x="${x}" y="${y + r + 18}" text-anchor="middle" fill="#E2E8F0" font-size="11">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // COMPUTER SCIENCE PRIMITIVES
    // ══════════════════════════════════════════════════════════════════════════

    case 'client':
    case 'browser': {
      // Web browser window / client frame
      const w = width || 90;
      const h = height || 64;
      const rx = x - w / 2;
      const ry = y - h / 2;

      return `
        <g id="${id}" class="primitive client" ${highlightClass}>
          <rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="6" fill="#18181B" stroke="${accentColor}" stroke-width="2" />
          <!-- Browser titlebar with dots -->
          <rect x="${rx}" y="${ry}" width="${w}" height="14" rx="6" fill="#27272A" />
          <circle cx="${rx + 6}" cy="${ry + 7}" r="2.5" fill="#EF4444" />
          <circle cx="${rx + 13}" cy="${ry + 7}" r="2.5" fill="#FBBF24" />
          <circle cx="${rx + 20}" cy="${ry + 7}" r="2.5" fill="#22C55E" />
          ${label ? `<text x="${x}" y="${ry + h / 2 + 8}" text-anchor="middle" fill="#E2E8F0" font-size="11" font-weight="600">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'server': {
      // Server rack unit with LED status indicators
      const w = width || 84;
      const h = height || 54;
      const rx = x - w / 2;
      const ry = y - h / 2;

      return `
        <g id="${id}" class="primitive server" ${highlightClass}>
          <rect x="${rx}" y="${ry}" width="${w}" height="${h}" rx="5" fill="#18181B" stroke="${accentColor}" stroke-width="2" />
          <line x1="${rx + 6}" y1="${ry + 18}" x2="${rx + w - 6}" y2="${ry + 18}" stroke="#334155" stroke-width="1.5" />
          <line x1="${rx + 6}" y1="${ry + 36}" x2="${rx + w - 6}" y2="${ry + 36}" stroke="#334155" stroke-width="1.5" />
          <!-- Status LEDs -->
          <circle cx="${rx + 12}" cy="${ry + 9}" r="2.5" fill="#34D399" />
          <circle cx="${rx + 20}" cy="${ry + 9}" r="2.5" fill="#38BDF8" />
          <circle cx="${rx + 12}" cy="${ry + 27}" r="2.5" fill="#34D399" />
          ${label ? `<text x="${x}" y="${ry + h + 16}" text-anchor="middle" fill="#E2E8F0" font-size="11" font-weight="600">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    case 'database': {
      // Cylindrical database storage
      const w = width || 70;
      const h = height || 74;
      const rx = x - w / 2;
      const ry = y - h / 2;

      return `
        <g id="${id}" class="primitive database" ${highlightClass}>
          <!-- Main cylinder body -->
          <path d="M ${rx} ${ry + 12} L ${rx} ${ry + h - 12} A ${w / 2} 12 0 0 0 ${rx + w} ${ry + h - 12} L ${rx + w} ${ry + 12} Z" fill="#18181B" stroke="${accentColor}" stroke-width="2" />
          <!-- Intermediate rings -->
          <path d="M ${rx} ${ry + h * 0.4} A ${w / 2} 10 0 0 0 ${rx + w} ${ry + h * 0.4}" fill="none" stroke="#334155" stroke-width="1.5" />
          <path d="M ${rx} ${ry + h * 0.7} A ${w / 2} 10 0 0 0 ${rx + w} ${ry + h * 0.7}" fill="none" stroke="#334155" stroke-width="1.5" />
          <!-- Top ellipse -->
          <ellipse cx="${x}" cy="${ry + 12}" rx="${w / 2}" ry="12" fill="#27272A" stroke="${accentColor}" stroke-width="2" />
          ${label ? `<text x="${x}" y="${ry + h / 2 + 5}" text-anchor="middle" fill="#E2E8F0" font-size="11" font-weight="600">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // DEFAULT GENERIC FALLBACK
    // ══════════════════════════════════════════════════════════════════════════

    default: {
      const w = width || 80;
      const h = height || 50;
      return `
        <g id="${id}" class="primitive generic" ${highlightClass}>
          <rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="6" fill="#1E293B" stroke="${accentColor}" stroke-width="2" />
          ${label ? `<text x="${x}" y="${y + 4}" text-anchor="middle" fill="#FFFFFF" font-size="12" font-weight="600">${escapeXml(label)}</text>` : ''}
        </g>
      `;
    }
  }
}

/**
 * Renders directional vectors and physical relationships between primitives
 */
export function renderRelationship(
  rel: VisualRelationship,
  elementsById: Map<string, VisualElement>,
  isHighlighted = false
): string {
  const { from, to, type = 'arrow', label = '', vectorType, color = '#38BDF8' } = rel;
  const fromEl = elementsById.get(from);
  const toEl = elementsById.get(to);

  let x1 = fromEl?.x ?? 100;
  let y1 = fromEl?.y ?? 100;
  let x2 = toEl?.x ?? 240;
  let y2 = toEl?.y ?? 100;

  // Offset points to boundaries if elements are known
  if (fromEl && toEl) {
    const dx = toEl.x - fromEl.x;
    const dy = toEl.y - fromEl.y;
    const dist = Math.hypot(dx, dy) || 1;
    const fromR = Math.max(fromEl.width || 40, fromEl.height || 40) / 2;
    const toR = Math.max(toEl.width || 40, toEl.height || 40) / 2;
    x1 = fromEl.x + (dx / dist) * fromR;
    y1 = fromEl.y + (dy / dist) * fromR;
    x2 = toEl.x - (dx / dist) * toR;
    y2 = toEl.y - (dy / dist) * toR;
  }

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const vectorColor = vectorType === 'gravity' ? '#EF4444' :
                      vectorType === 'velocity' ? '#34D399' :
                      vectorType === 'acceleration' ? '#FBBF24' :
                      color;

  const markerId = vectorType ? `arrow-${vectorType}` : 'arrow-accent';
  const strokeWidth = isHighlighted ? 3.5 : 2.5;

  return `
    <g class="relationship ${type}" ${isHighlighted ? 'filter="url(#glow-highlight)"' : ''}>
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${vectorColor}" stroke-width="${strokeWidth}" stroke-linecap="round" marker-end="url(#${markerId})" />
      ${label ? `
        <rect x="${midX - (label.length * 4.5)}" y="${midY - 14}" width="${label.length * 9}" height="18" rx="4" fill="#0A0A0A" opacity="0.85" />
        <text x="${midX}" y="${midY - 2}" text-anchor="middle" fill="${vectorColor}" font-size="11" font-weight="700" font-family="system-ui, sans-serif">${escapeXml(label)}</text>
      ` : ''}
    </g>
  `;
}

function escapeXml(unsafe: string): string {
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
