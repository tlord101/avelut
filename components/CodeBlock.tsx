import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  language?: string;
  value: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language = 'code', value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const displayLanguage = (language || 'code').toLowerCase().trim();

  return (
    <div className="not-prose my-4 w-full rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-[#0d1117] text-neutral-100 shadow-sm">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-neutral-800 text-xs text-neutral-400 font-mono select-none">
        <span className="font-medium tracking-wide uppercase">{displayLanguage}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>

      {/* Code Body */}
      <div className="p-4 overflow-x-auto text-[13.5px] leading-relaxed font-mono font-normal whitespace-pre text-neutral-100">
        <code>{value}</code>
      </div>
    </div>
  );
};
