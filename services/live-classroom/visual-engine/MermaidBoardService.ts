/**
 * MermaidBoardService.ts
 *
 * Renders Mermaid syntax into SVG with local offline fallback
 * and extracts Excalidraw elements for direct whiteboard rendering.
 */

export interface ParsedMermaidNode {
  id: string;
  label: string;
  shape: 'box' | 'circle' | 'diamond';
}

export interface ParsedMermaidEdge {
  from: string;
  to: string;
  label?: string;
}

export interface ParsedMermaidDiagram {
  direction: 'LR' | 'TD';
  nodes: ParsedMermaidNode[];
  edges: ParsedMermaidEdge[];
}

export class MermaidBoardService {
  private static cache = new Map<string, string>();

  /**
   * Parses Mermaid code into nodes and edges
   */
  public static parseMermaid(mermaidCode: string): ParsedMermaidDiagram {
    const lines = mermaidCode.split('\n');
    let direction: 'LR' | 'TD' = 'LR';
    const nodeMap = new Map<string, ParsedMermaidNode>();
    const edges: ParsedMermaidEdge[] = [];

    for (const rawLine of lines) {
      let line = rawLine.trim();
      // Remove comments
      if (line.startsWith('%%') || !line) continue;

      if (/^(graph|flowchart)\s+(TD|TB|BT)/i.test(line)) {
        direction = 'TD';
        continue;
      }
      if (/^(graph|flowchart)\s+(LR|RL)/i.test(line)) {
        direction = 'LR';
        continue;
      }
      if (/^(mindmap|sequenceDiagram|classDiagram|stateDiagram)/i.test(line)) {
        direction = 'TD';
      }

      // Match node definitions or edge segments: e.g. A["Sun"] --> B["Leaf"] or A -->|label| B
      // Extract nodes first
      const nodeRegex = /([a-zA-Z0-9_\-\.]+)\s*(?:\["?(.*?)"?\]|\(\("?(.*?)"?\)\)|\("?(.*?)"?\)|\{"?(.*?)"?\}|\[\["?(.*?)"?\]\])/g;
      let match: RegExpExecArray | null;
      while ((match = nodeRegex.exec(line)) !== null) {
        const id = match[1];
        const label = match[2] || match[3] || match[4] || match[5] || match[6] || id;
        const shape = match[0].includes('((') ? 'circle' : match[0].includes('{') ? 'diamond' : 'box';
        if (!nodeMap.has(id)) {
          nodeMap.set(id, { id, label: label.replace(/\\n/g, ' ').trim(), shape });
        }
      }

      // Match edge arrows: -->, ---, ==>, -.-> with optional |label|
      const edgeRegex = /([a-zA-Z0-9_\-\.]+)\s*(?:-->|==>|--|---\.->|->)(?:\|(.*?)\|)?\s*([a-zA-Z0-9_\-\.]+)/g;
      while ((match = edgeRegex.exec(line)) !== null) {
        const from = match[1];
        const label = match[2]?.trim();
        const to = match[3];

        if (!nodeMap.has(from)) {
          nodeMap.set(from, { id: from, label: from, shape: 'box' });
        }
        if (!nodeMap.has(to)) {
          nodeMap.set(to, { id: to, label: to, shape: 'box' });
        }
        edges.push({ from, to, label });
      }
    }

    return {
      direction,
      nodes: Array.from(nodeMap.values()),
      edges,
    };
  }

  /**
   * Converts Mermaid code directly into Excalidraw board elements
   * so shapes and arrows can be drawn natively on the board canvas.
   */
  public static toExcalidrawElements(mermaidCode: string): any[] {
    const { direction, nodes, edges } = this.parseMermaid(mermaidCode);
    if (nodes.length === 0) return [];

    const elements: any[] = [];
    const isLR = direction === 'LR';

    // Grid layout positions
    const nodeWidth = 220;
    const nodeHeight = 56;
    const gapX = isLR ? 100 : 40;
    const gapY = isLR ? 30 : 70;
    const startX = 60;
    const startY = 140;

    const positions = new Map<string, { x: number; y: number }>();

    nodes.forEach((node, index) => {
      let x = startX;
      let y = startY;

      if (isLR) {
        x = startX + index * (nodeWidth + gapX);
        y = startY + (index % 2 === 1 ? 40 : 0);
      } else {
        x = startX + (index % 2 === 1 ? 60 : 0);
        y = startY + index * (nodeHeight + gapY);
      }

      positions.set(node.id, { x, y });

      elements.push({
        kind: node.shape,
        id: node.id,
        text: node.label,
        x,
        y,
      });
    });

    for (const edge of edges) {
      elements.push({
        kind: 'arrow',
        from: edge.from,
        to: edge.to,
        label: edge.label,
      });
    }

    return elements;
  }

  /**
   * Generates a sleek, dark-themed SVG locally without any external network dependency.
   */
  public static generateLocalSvg(mermaidCode: string): string {
    const { direction, nodes, edges } = this.parseMermaid(mermaidCode);
    if (nodes.length === 0) return '';

    const isLR = direction === 'LR';
    const boxW = 180;
    const boxH = 54;
    const padX = 70;
    const padY = 60;

    const totalW = Math.max(500, isLR ? nodes.length * (boxW + padX) + 60 : boxW + 200);
    const totalH = Math.max(300, isLR ? boxH + 160 : nodes.length * (boxH + padY) + 80);

    const positions = new Map<string, { cx: number; cy: number; x: number; y: number }>();
    const nodeColors = ['#0284C7', '#059669', '#D97706', '#7C3AED', '#DB2777', '#2563EB'];

    nodes.forEach((node, idx) => {
      const x = isLR ? 40 + idx * (boxW + padX) : (totalW - boxW) / 2;
      const y = isLR ? (totalH - boxH) / 2 : 40 + idx * (boxH + padY);
      positions.set(node.id, { cx: x + boxW / 2, cy: y + boxH / 2, x, y });
    });

    let edgesSvg = '';
    for (const edge of edges) {
      const p1 = positions.get(edge.from);
      const p2 = positions.get(edge.to);
      if (!p1 || !p2) continue;

      let startX = p1.cx;
      let startY = p1.cy;
      let endX = p2.cx;
      let endY = p2.cy;

      if (isLR) {
        startX = p1.x + boxW;
        endX = p2.x;
      } else {
        startY = p1.y + boxH;
        endY = p2.y;
      }

      edgesSvg += `
        <line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="#38BDF8" stroke-width="2.5" marker-end="url(#arrowhead)" />
        ${edge.label ? `<text x="${(startX + endX) / 2}" y="${(startY + endY) / 2 - 8}" fill="#94A3B8" font-size="12" text-anchor="middle" font-family="sans-serif">${edge.label}</text>` : ''}
      `;
    }

    let nodesSvg = '';
    nodes.forEach((node, idx) => {
      const pos = positions.get(node.id)!;
      const color = nodeColors[idx % nodeColors.length];

      nodesSvg += `
        <g>
          <rect x="${pos.x}" y="${pos.y}" width="${boxW}" height="${boxH}" rx="12" fill="#1E293B" stroke="${color}" stroke-width="2" />
          <text x="${pos.cx}" y="${pos.cy + 5}" fill="#F8FAFC" font-size="14" font-weight="600" text-anchor="middle" font-family="sans-serif">${node.label.slice(0, 24)}</text>
        </g>
      `;
    });

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" width="100%" height="100%" style="background-color: #0B0F17; border-radius: 16px;">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#38BDF8" />
          </marker>
        </defs>
        ${edgesSvg}
        ${nodesSvg}
      </svg>
    `.trim();
  }

  /**
   * Fetches an SVG representation of the provided Mermaid code.
   * Uses mermaid.ink with immediate fallback to local high-resolution SVG.
   */
  public static async renderToSvg(mermaidCode: string): Promise<string> {
    const trimmed = mermaidCode.trim();
    if (!trimmed) return '';

    if (this.cache.has(trimmed)) {
      return this.cache.get(trimmed)!;
    }

    try {
      let codeWithTheme = trimmed;
      if (!codeWithTheme.includes('%%{init')) {
        codeWithTheme = `%%{init: {'theme': 'dark', 'themeVariables': { 'darkMode': true, 'background': '#0A0A0A', 'fontSize': '22px', 'fontFamily': 'ui-sans-serif, system-ui, sans-serif' }}}%%\n${codeWithTheme}`;
      }

      const encoded = btoa(unescape(encodeURIComponent(codeWithTheme)));
      const url = `https://mermaid.ink/svg/${encoded}?bgColor=0A0A0A`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok) {
        const svgString = await response.text();
        if (svgString && svgString.includes('<svg')) {
          this.cache.set(trimmed, svgString);
          return svgString;
        }
      }
    } catch {
      // Fallback seamlessly to local SVG generator
    }

    const localSvg = this.generateLocalSvg(trimmed);
    if (localSvg) {
      this.cache.set(trimmed, localSvg);
      return localSvg;
    }

    return '';
  }
}

export const mermaidBoardService = new MermaidBoardService();
