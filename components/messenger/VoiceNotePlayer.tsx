import React, { useState, useEffect, useRef } from 'react';

export interface VoiceNotePlayerProps {
  src: string;
  isMe: boolean;
  isUploading?: boolean;
}

export const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({ src, isMe, isUploading = false }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    const handleLoaded = () => {
      if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    const handleTime = () => setCurrentTime(audio.currentTime);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [src]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(console.warn);
    }
  };

  const formatTime = (secs: number) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 py-1 px-2 min-w-[200px] max-w-[280px]">
      <button
        type="button"
        onClick={togglePlay}
        disabled={isUploading}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95 cursor-pointer ${
          isMe ? 'bg-white text-blue-600' : 'bg-[#2563EB] text-white'
        }`}
      >
        {isUploading ? (
          <i className="bi bi-arrow-repeat animate-spin text-sm"></i>
        ) : isPlaying ? (
          <i className="bi bi-pause-fill text-lg"></i>
        ) : (
          <i className="bi bi-play-fill text-lg ml-0.5"></i>
        )}
      </button>

      <div className="flex-1 space-y-1">
        <div className="w-full h-1.5 bg-[#2A2A2A] rounded-full overflow-hidden relative">
          <div
            className={`h-full transition-all duration-100 ${isMe ? 'bg-white' : 'bg-[#2563EB]'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-[#A3A3A3] font-medium">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
};
