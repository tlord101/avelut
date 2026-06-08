import React, { useState } from 'react';
import { useSwipeable } from 'react-swipeable';
import { XIcon } from './icons/XIcon';

interface FlashcardsUIProps {
  flashcards: { front: string; back: string }[];
  onFinish: () => void;
  onClose: () => void;
}

export const FlashcardsUI: React.FC<FlashcardsUIProps> = ({ flashcards, onFinish, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  const handleNext = () => {
    if (currentIndex < flashcards.length - 1) {
      setIsFlipped(false);
      setCurrentIndex((prev) => prev + 1);
    } else {
      onFinish();
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setCurrentIndex((prev) => prev - 1);
    }
  };

  const swipeHandlers = useSwipeable({
    onSwipedLeft: handleNext,
    onSwipedRight: handlePrev,
    preventScrollOnSwipe: true,
    trackMouse: true,
  });

  if (!flashcards.length) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500 py-10 w-full px-4 overflow-hidden" {...swipeHandlers}>
      <div className="flex justify-between items-center bg-gray-50/50 p-4 rounded-[2rem] border border-gray-100 z-10 relative">
        <div className="px-4">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Card</p>
          <p className="text-lg font-black text-gray-900">
            {currentIndex + 1} <span className="text-gray-300 mx-1">/</span> {flashcards.length}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-3 rounded-xl bg-white text-gray-400 hover:text-red-500 shadow-sm transition-all"
        >
          <XIcon className="w-5 h-5" />
        </button>
      </div>

      <div className="relative w-full aspect-[4/3] max-w-md mx-auto perspective-1000">
        {flashcards.map((card, index) => {
          const diff = index - currentIndex;
          const isCurrent = diff === 0;
          const isPrev = diff < 0;
          const isNext = diff > 0;

          // Compute styles based on position relative to currentIndex
          let translateX = '0%';
          let translateY = '0%';
          let scale = 1;
          let zIndex = 10;
          let opacity = 1;
          let rotateZ = '0deg';

          if (isPrev) {
            translateX = '-30%';
            translateY = '10%';
            scale = 0.9;
            zIndex = 5;
            opacity = 0.6;
            rotateZ = '-5deg';
          } else if (isNext) {
            translateX = '30%';
            translateY = '10%';
            scale = 0.9;
            zIndex = 5;
            opacity = 0.6;
            rotateZ = '5deg';
          }

          if (Math.abs(diff) > 1) {
            opacity = 0; // Hide cards further away
          }

          return (
            <div
              key={index}
              className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] will-change-transform origin-bottom cursor-pointer ${
                isCurrent ? 'z-10' : 'pointer-events-none'
              }`}
              style={{
                transform: `translateX(${translateX}) translateY(${translateY}) scale(${scale}) rotateZ(${rotateZ})`,
                zIndex,
                opacity,
              }}
              onClick={() => {
                if (isCurrent) setIsFlipped(!isFlipped);
              }}
            >
              <div
                className="relative w-full h-full transition-transform duration-700 preserve-3d shadow-2xl rounded-3xl"
                style={{
                  transform: isCurrent && isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
              >
                {/* Front side */}
                <div
                  className="absolute inset-0 bg-white rounded-3xl border border-gray-100 flex flex-col items-center justify-center p-8 text-center backface-hidden shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)]"
                >
                  <h3 className="text-2xl md:text-3xl font-black text-gray-800 tracking-tight leading-tight">
                    {card.front}
                  </h3>
                </div>

                {/* Back side */}
                <div
                  className="absolute inset-0 bg-white rounded-3xl border border-gray-100 flex flex-col items-center justify-center p-8 text-center backface-hidden shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)]"
                  style={{ transform: 'rotateY(180deg)' }}
                >
                  <div className="absolute top-6 left-6 text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 px-3 py-1.5 rounded-full">
                    Answer
                  </div>
                  <p className="text-xl md:text-2xl font-bold leading-relaxed text-gray-700">
                    {card.back}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 justify-center mt-8 px-4 z-10 relative">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="w-16 h-16 flex items-center justify-center bg-white border border-gray-200 text-gray-700 font-black rounded-full hover:bg-gray-50 hover:scale-105 transition-all disabled:opacity-30 disabled:hover:scale-100 shadow-sm"
          aria-label="Previous card"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <button
          onClick={handleNext}
          className={`px-8 h-16 flex items-center justify-center text-white font-black rounded-full hover:scale-105 transition-all shadow-md shadow-indigo-600/20 text-sm uppercase tracking-widest ${
             currentIndex < flashcards.length - 1 ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-lime-500 hover:bg-lime-600'
          }`}
        >
          {currentIndex < flashcards.length - 1 ? 'Next' : 'Finish'}
        </button>
      </div>

      <p className="text-center text-gray-400 text-xs font-bold uppercase tracking-widest mt-6">
        Tap to flip • Swipe to navigate
      </p>
    </div>
  );
};
