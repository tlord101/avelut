import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { prepareMarkdown, rehypeMarkdownPresentation } from '../utils/markdownPreprocess';
import { CodeBlock } from './CodeBlock';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-xl sm:text-2xl font-bold tracking-tight mt-7 mb-3.5 leading-snug text-neutral-900 dark:text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg sm:text-xl font-bold tracking-tight mt-6 mb-3 leading-snug text-neutral-900 dark:text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base sm:text-lg font-semibold tracking-tight mt-5 mb-2.5 leading-snug text-neutral-900 dark:text-white">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm sm:text-base font-semibold tracking-tight mt-4 mb-2 leading-snug text-neutral-900 dark:text-white">{children}</h4>,
  p: ({ children }) => <p className="my-4 leading-[1.8]">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-neutral-900 dark:text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-neutral-800 dark:text-neutral-200">{children}</em>,
  mark: ({ children }) => <mark className="bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100 px-1 py-0.5 rounded-sm font-medium">{children}</mark>,
  ul: ({ children }) => <ul className="list-disc pl-6 my-4 space-y-2">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="list-decimal pl-6 my-4 space-y-2">{children}</ol>,
  li: ({ children }) => <li className="leading-[1.75]">{children}</li>,
  blockquote: ({ children }) => <blockquote className="border-l-4 border-blue-400 dark:border-blue-500 pl-4 py-1.5 my-4 italic bg-blue-50/50 dark:bg-blue-950/30 rounded-r-lg text-neutral-700 dark:text-neutral-300">{children}</blockquote>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-5 rounded-xl border border-neutral-200 dark:border-neutral-800">
      <table className="w-full text-left text-sm border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-neutral-100 dark:bg-neutral-800/80 font-semibold text-neutral-900 dark:text-white">{children}</thead>,
  th: ({ children, style }) => <th style={style} className="p-3 border-b border-neutral-200 dark:border-neutral-700 font-semibold">{children}</th>,
  td: ({ children, style }) => <td style={style} className="p-3 border-b border-neutral-100 dark:border-neutral-800/60 text-neutral-800 dark:text-neutral-200">{children}</td>,
  code: ({ node, className, children }) => {
    if (node?.properties?.['data-block']) {
      const language = /language-([^\s]+)/.exec(className || '')?.[1] || 'code';
      return <CodeBlock language={language} value={String(children ?? '').replace(/\n$/, '')} />;
    }
    return <code className="bg-neutral-100 dark:bg-neutral-800 text-[#2563EB] dark:text-[#60A5FA] font-mono px-1.5 py-0.5 rounded text-[13px] font-medium">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
  a: ({ children, href, title }) => <a href={href} title={title} className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300" target="_blank" rel="noopener noreferrer">{children}</a>,
  hr: () => <hr className="my-6 border-neutral-200 dark:border-neutral-800" />,
};

/** Pure presentation shared by live, restored and shared AI responses. */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className = '' }) => (
  <div className={`font-reading text-[15.5px] sm:text-[16.5px] leading-[1.8] tracking-[-0.011em] text-neutral-900 dark:text-neutral-100 prose prose-neutral dark:prose-invert max-w-none min-w-0 break-words font-normal select-text [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden ${className}`}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={[rehypeMarkdownPresentation, rehypeKatex]}
      components={components}
    >
      {prepareMarkdown(content)}
    </ReactMarkdown>
  </div>
);

export default MarkdownContent;
