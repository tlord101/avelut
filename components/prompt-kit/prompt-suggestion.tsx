"use client"

import React from 'react';
import { cn } from '@/lib/utils';

export type PromptSuggestionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  highlight?: string;
};

const renderHighlightedText = (text: string, highlight?: string) => {
  if (!highlight) return text;

  const lowerText = text.toLowerCase();
  const lowerHighlight = highlight.toLowerCase();
  const index = lowerText.indexOf(lowerHighlight);

  if (index === -1) return text;

  const before = text.slice(0, index);
  const match = text.slice(index, index + highlight.length);
  const after = text.slice(index + highlight.length);

  return (
    <>
      {before}
      <span className="font-semibold text-slate-900">{match}</span>
      {after}
    </>
  );
};

export function PromptSuggestion({
  className,
  highlight,
  children,
  type = 'button',
  ...props
}: PromptSuggestionProps) {
  const text = typeof children === 'string' ? children : '';

  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700 hover:shadow-md',
        className
      )}
      {...props}
    >
      {text ? renderHighlightedText(text, highlight) : children}
    </button>
  );
}
