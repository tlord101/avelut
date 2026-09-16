import React, { useState, useEffect } from 'react';
import { resolveImageDisplayUrl, extractImageCaption } from './messengerUtils';

export interface ProgressiveImageBubbleProps {
  msg: any;
  isMe: boolean;
  onImageClick?: (url: string) => void;
}

export const ProgressiveImageBubble: React.FC<ProgressiveImageBubbleProps> = ({ msg, isMe, onImageClick }) => {
  const displayUrl = resolveImageDisplayUrl(msg);
  const caption = extractImageCaption(msg.text || '');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setError(false);
  }, [displayUrl]);

  if (!displayUrl) return null;

  return (
    <div className="relative group overflow-hidden rounded-2xl my-1 max-w-[280px] sm:max-w-[320px]">
      {!loaded && !error && (
        <div className="w-64 h-48 bg-[#1C1C1C] animate-pulse flex items-center justify-center rounded-2xl">
          {msg.microThumbUrl ? (
            <img src={msg.microThumbUrl} alt="" className="w-full h-full object-cover blur-md opacity-60" />
          ) : (
            <span className="text-xs text-[#A3A3A3]">Loading image…</span>
          )}
        </div>
      )}

      {error ? (
        <div className="w-64 h-32 bg-[#1C1C1C] border border-[#2A2A2A] rounded-2xl flex flex-col items-center justify-center p-4 text-center">
          <i className="bi bi-exclamation-triangle text-rose-500 text-xl mb-1"></i>
          <span className="text-xs text-[#A3A3A3]">Image failed to load</span>
        </div>
      ) : (
        <img
          src={displayUrl}
          alt={caption || 'Attached Image'}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onClick={() => onImageClick?.(displayUrl)}
          className={`w-full max-h-[320px] object-cover rounded-2xl cursor-pointer transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
          }`}
        />
      )}

      {caption && (
        <p className={`text-xs mt-1.5 px-1 font-medium ${isMe ? 'text-slate-100' : 'text-[#FAFAFA]'}`}>
          {caption}
        </p>
      )}
    </div>
  );
};
