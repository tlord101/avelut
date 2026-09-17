import { formatLatexMath } from './latexFormatter';

// Protect fenced/indented code, code spans, link destinations and existing math.
// An unfinished fence stays literal while a response is streaming.
const literalPattern = /(^[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*(?:`{3,}|~{3,})[ \t]*(?=\n|$)|$(?![\s\S])))|^(?: {4}|\t)[^\n]*(?:\n|$)|(`+)[\s\S]*?\2(?!`)|!?\[[^\]\n]*\]\([^\n)]*\)|\$\$[\s\S]*?\$\$|(?<!\\)\$[^$\n]+\$/gm;

function transformProse(content: string, transform: (text: string) => string, preserveMath: boolean): string {
  let result = '';
  let offset = 0;
  for (const match of content.matchAll(literalPattern)) {
    result += transform(content.slice(offset, match.index));
    result += !preserveMath && match[0].startsWith('$') ? transform(match[0]) : match[0];
    offset = match.index + match[0].length;
  }
  return result + transform(content.slice(offset));
}

/** Only prose highlights are expanded; code, URLs and equations remain literal. */
export function preprocessMarkdown(content: string): string {
  return transformProse(content, (text) => text.replace(
    /<mark>[\s\S]*?<\/mark>|(?<![=\\])==([^=\s](?:[^=\n]*?[^=\s])?)==(?![=])/g,
    (match, highlighted: string | undefined) => highlighted ? `<mark>${highlighted}</mark>` : match,
  ), true);
}

export function prepareMarkdown(content: string): string {
  // Keep the existing math repair helper, but never rewrite source code or URLs.
  const formatted = transformProse(preprocessMarkdown(content), formatLatexMath, false);
  // Inline sentinels avoid CommonMark treating a leading <mark> as an HTML
  // block. Markdown emphasis and math inside the highlight still get parsed.
  return transformProse(formatted, (text) => text.replace(/<mark>/g, '\uE000').replace(/<\/mark>/g, '\uE001'), true);
}

interface MarkdownNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownNode[];
}

/** Allow only bare mark tags, not arbitrary HTML or model-supplied attributes. */
export function rehypeMarkdownPresentation() {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (!node.children) return;
      if (node.tagName === 'pre') {
        for (const child of node.children) {
          if (child.tagName === 'code') {
            child.properties = { ...child.properties, 'data-block': true };
          }
        }
      }
      const children: MarkdownNode[] = [];
      const stack: MarkdownNode[][] = [children];
      for (const child of node.children) {
        if (child.type === 'raw' || child.type === 'text') {
          for (const part of (child.value || '').split(/(\uE000|\uE001)/g)) {
            if (!part) continue;
            if (part === '\uE000') {
              const mark: MarkdownNode = { type: 'element', tagName: 'mark', properties: {}, children: [] };
              stack[stack.length - 1].push(mark);
              stack.push(mark.children!);
            } else if (part === '\uE001' && stack.length > 1) {
              stack.pop();
            } else {
              stack[stack.length - 1].push({ type: 'text', value: part });
            }
          }
        } else {
          visit(child);
          stack[stack.length - 1].push(child);
        }
      }
      node.children = children;
    };
    visit(tree);
  };
}
