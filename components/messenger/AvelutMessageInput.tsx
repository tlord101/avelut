import React, { useState, useRef } from 'react';

export interface AvelutInputProps {
  onSend: (text: string) => void;
  startRecording: (e: any) => Promise<void>;
  handleMove: (e: any) => void;
  stopRecording: (shouldSave: boolean) => void;
  isRecording: boolean;
  isLocked: boolean;
  setIsLocked: (locked: boolean) => void;
  recordDuration: number;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImageSendWithCaption?: (source: any, caption: string, mimeType?: string) => void;
  disabled?: boolean;
  onTyping?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export const AvelutMessageInput: React.FC<AvelutInputProps> = ({
  onSend,
  startRecording,
  handleMove,
  stopRecording,
  isRecording,
  isLocked,
  setIsLocked,
  recordDuration,
  onFileSelect,
  onImageSendWithCaption,
  disabled = false,
  onTyping,
  inputRef,
}) => {
  const [attachedImages, setAttachedImages] = useState<
    Array<{ source: any; previewUrl: string; mimeType: string }>
  >([]);

  const [message, setMessage] = useState('');
  const [showTrashAnimation, setShowTrashAnimation] = useState(false);
  const [showStickerPopup, setShowStickerPopup] = useState(false);

  const handleStickerClick = () => {
    setShowStickerPopup(true);
    setTimeout(() => setShowStickerPopup(false), 3000);
  };

  const [startY, setStartY] = useState(0);
  const [startX, setStartX] = useState(0);
  const [currentY, setCurrentY] = useState(0);
  const [currentX, setCurrentX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleVoicePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isLocked || disabled) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setStartX(e.clientX);
    setStartY(e.clientY);
    setCurrentX(e.clientX);
    setCurrentY(e.clientY);
    setIsSwiping(true);
    void startRecording(e);
  };

  const handleVoicePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isRecording || isLocked || disabled || !isSwiping) return;
    handleMove(e);

    setCurrentX(e.clientX);
    setCurrentY(e.clientY);

    const deltaY = e.clientY - startY;
    const deltaX = e.clientX - startX;
    if (deltaY < -80) {
      setIsLocked(true);
      setIsSwiping(false);
    } else if (deltaX < -110) {
      discardVoice();
    }
  };

  const handleVoicePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {}
    if (!isSwiping) return;
    setIsSwiping(false);
    if (!isLocked) stopRecording(true);
  };

  const executeTextSend = () => {
    if ((message.trim() || attachedImages.length > 0) && !disabled) {
      if (attachedImages.length > 0 && onImageSendWithCaption) {
        attachedImages.forEach((img, idx) => {
          const caption = idx === 0 ? message.trim() : '';
          onImageSendWithCaption(img.source, caption, img.mimeType);
        });
        setAttachedImages([]);
      } else if (message.trim()) {
        onSend(message);
      }
      setMessage('');
    }
  };

  const discardVoice = () => {
    setShowTrashAnimation(true);
    setIsSwiping(false);
    stopRecording(false);
    setTimeout(() => setShowTrashAnimation(false), 1000);
  };

  const hasText = message.trim().length > 0;
  const swipeDeltaY = isSwiping ? Math.min(0, Math.max(-100, currentY - startY)) : 0;
  const swipeDeltaX = isSwiping ? Math.min(0, Math.max(-110, currentX - startX)) : 0;

  const handleInternalImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length > 0) {
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            setAttachedImages((prev) => [
              ...prev,
              {
                source: file,
                previewUrl: event.target!.result as string,
                mimeType:
                  file.type ||
                  `image/${(file.name || '').split('.').pop() === 'png' ? 'png' : 'jpeg'}`,
              },
            ]);
          }
        };
        reader.readAsDataURL(file);
      });
    }
    e.target.value = '';
  };

  return (
    <div
      className={`w-full relative select-none z-40 bg-transparent pb-2 pt-2 md:w-full md:mx-auto ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
    >
      <input type="file" ref={fileInputRef} onChange={onFileSelect} className="hidden" multiple accept="*/*" />
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleInternalImageSelect}
        className="hidden"
        accept="image/*"
        multiple
      />

      {isRecording && !isLocked && (
        <div
          className="absolute right-[19px] bottom-[70px] w-[46px] h-[130px] bg-white dark:bg-black rounded-full flex flex-col items-center justify-start py-4 gap-3 shadow-md z-20"
          style={{ transform: `translateY(${Math.max(-40, swipeDeltaY * 0.15)}px)` }}
        >
          <div
            className="flex items-center justify-center text-slate-500 dark:text-[#A3A3A3]"
            style={{ transform: `translateY(${Math.max(-40, swipeDeltaY * 0.5)}px)` }}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
              <path d="M18 10v-3.5a6.5 6.5 0 0 0-13 0V10H4v11h16V10h-2zm-10-3.5a4.5 4.5 0 0 1 9 0V10H8V6.5z" />
            </svg>
          </div>
          <div className="text-slate-400 mt-2 animate-bounce">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="18 15 12 9 6 15"></polyline>
            </svg>
          </div>
        </div>
      )}

      <div className="w-full flex flex-col gap-2 relative">
        {attachedImages.length > 0 && (
          <div className="mx-2 mb-1 bg-white dark:bg-[#111111] rounded-2xl p-2 flex items-center gap-2 overflow-x-auto shadow-sm border border-slate-100 dark:border-white/5 relative [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-black/5 relative shrink-0">
                <img src={img.previewUrl} alt={`Attachment ${idx + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                  className="absolute top-1 right-1 w-6 h-6 bg-black/60 hover:bg-black/80 text-white rounded-full flex items-center justify-center shadow-md z-10 transition cursor-pointer"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="w-full flex items-end gap-2 relative">
          {!isRecording && !isLocked && (
            <div className="flex-1 min-h-[50px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2A2A2A] rounded-3xl flex items-center px-1 shadow-sm transition-all focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500/50">
              <div className="relative flex items-center h-full">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleStickerClick}
                  className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-11 h-full text-slate-400"
                >
                  <i className="bi bi-emoji-smile text-xl"></i>
                </button>
                {showStickerPopup && (
                  <div className="absolute -top-10 left-2 bg-[#0A0A0A] text-white text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap animate-fade-in z-50">
                    Coming soon
                    <div className="absolute -bottom-1 left-4 w-2 h-2 bg-[#0A0A0A] rotate-45"></div>
                  </div>
                )}
              </div>
              <div className="flex-1 h-full flex items-center min-w-0">
                <input
                  ref={inputRef}
                  type="text"
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    onTyping?.();
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && executeTextSend()}
                  placeholder="Message"
                  className="w-full h-full bg-transparent text-[17px] text-[#0A0A0A] dark:text-[#FAFAFA] placeholder-slate-400 outline-none border-none focus:ring-0 pl-1 pr-2"
                />
              </div>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-10 h-full text-slate-400"
              >
                <i className="bi bi-paperclip text-xl"></i>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => imageInputRef.current?.click()}
                className="hover:opacity-85 transition active:scale-90 flex items-center justify-center w-11 h-full pr-1 text-slate-400"
              >
                <i className="bi bi-image text-xl"></i>
              </button>
            </div>
          )}

          {isRecording && !isLocked && (
            <div className="flex-1 h-[50px] bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2A2A2A] rounded-3xl flex items-center shadow-sm relative overflow-hidden">
              <div className="flex items-center h-full w-full">
                <div className="pl-5 w-20 text-[18px] text-[#0A0A0A] dark:text-[#FAFAFA] tabular-nums font-normal">
                  {formatTime(recordDuration)}
                </div>
                <div
                  className="flex-1 flex items-center justify-end pr-14 z-10 transition-transform duration-75"
                  style={{ transform: `translateX(${swipeDeltaX * 0.8}px)` }}
                >
                  <span className="text-[15px] font-normal text-slate-400 flex items-center gap-1.5">
                    <span className="inline-block font-bold text-lg text-slate-400">&lt;</span> Slide to cancel
                  </span>
                </div>
              </div>
              <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#0A0A0A]/40 to-transparent w-24 pointer-events-none" />
            </div>
          )}

          {isLocked && (
            <div className="flex-1 bg-white dark:bg-[#141414] border border-slate-200 dark:border-[#2A2A2A] rounded-3xl overflow-hidden flex flex-col justify-center py-2 px-2 h-[86px] shadow-sm relative">
              <div className="flex items-center justify-between mb-4 px-3 w-full">
                <span className="text-[17px] text-[#0A0A0A] dark:text-[#FAFAFA] tabular-nums font-normal">
                  {formatTime(recordDuration)}
                </span>
                <div className="flex-1 mx-3 flex items-center gap-[3px]">
                  {[...Array(24)].map((_, i) => (
                    <div
                      key={i}
                      className="w-[3px] rounded-full bg-amber-500 animate-pulse"
                      style={{ height: `${Math.max(4, Math.random() * 16)}px`, animationDelay: `${i * 0.05}s` }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between px-3 w-full">
                <button
                  onClick={discardVoice}
                  className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-rose-500 active:scale-90 transition-transform cursor-pointer"
                >
                  <i className="bi bi-trash text-lg"></i>
                </button>
                <button
                  onClick={() => stopRecording(true)}
                  className="w-8 h-8 rounded-full bg-[#0A0A0A] dark:bg-[#1C1C1C] text-white dark:text-[#FAFAFA] flex items-center justify-center hover:scale-105 transition-transform cursor-pointer"
                >
                  <i className="bi bi-send-fill text-xs"></i>
                </button>
              </div>
            </div>
          )}

          <div
            className={`shrink-0 ${isLocked ? 'hidden' : ''}`}
            style={{
              transform: isSwiping ? `translate(${swipeDeltaX * 0.2}px, ${swipeDeltaY * 0.5}px)` : 'none',
              transition: isSwiping ? 'none' : 'transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            }}
          >
            {hasText || attachedImages.length > 0 ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  executeTextSend();
                }}
                className="w-[50px] h-[50px] text-white dark:text-[#FAFAFA] rounded-full flex items-center justify-center shadow-md transition-all hover:brightness-95 active:scale-95 duration-100 bg-[#2563EB] dark:bg-[#3B82F6] cursor-pointer"
              >
                <i className="bi bi-send-fill text-lg"></i>
              </button>
            ) : (
              <button
                type="button"
                onPointerDown={handleVoicePointerDown}
                onPointerMove={handleVoicePointerMove}
                onPointerUp={handleVoicePointerUp}
                onPointerCancel={handleVoicePointerUp}
                style={{ touchAction: 'none' }}
                className="w-[50px] h-[50px] text-white dark:text-[#FAFAFA] rounded-full flex items-center justify-center shadow-md transition-all hover:brightness-95 active:scale-95 duration-100 bg-[#2563EB] dark:bg-[#3B82F6] cursor-pointer"
              >
                <i className="bi bi-mic-fill text-lg"></i>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
