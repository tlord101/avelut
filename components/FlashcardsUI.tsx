import React, { useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { XIcon } from './icons/XIcon';

interface FlashcardsUIProps {
  flashcards: { front: string; back: string }[];
  onFinish: () => void;
  onClose: () => void;
}

export const FlashcardsUI: React.FC<FlashcardsUIProps> = ({ flashcards, onFinish, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [exitX, setExitX] = useState(0);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-150, 150], [-25, 25]);
  const opacity = useTransform(x, [-150, -100, 0, 100, 150], [0, 1, 1, 1, 0]);

  const handleDragEnd = (event: any, info: any) => {
    if (info.offset.x > 150 || info.velocity.x > 500) {
      setExitX(500);
      swipeNext();
    } else if (info.offset.x < -150 || info.velocity.x < -500) {
      setExitX(-500);
      swipeNext();
    }
  };

  const swipeNext = () => {
    setIsFlipped(false);
    if (currentIndex < flashcards.length - 1) {
      setTimeout(() => {
        setCurrentIndex((prev) => prev + 1);
        x.set(0);
        setExitX(0);
      }, 200);
    } else {
      setTimeout(onFinish, 200);
    }
  };

  const handleNextManual = () => {
    setExitX(500);
    swipeNext();
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setIsFlipped(false);
      setCurrentIndex((prev) => prev - 1);
      x.set(0);
      setExitX(0);
    }
  };

  if (!flashcards.length) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-white flex flex-col overflow-hidden font-sans select-none">
      {/* Premium Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-[#E2E8F0] shrink-0">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-[#94A3B8] uppercase tracking-[0.2em] mb-0.5">Card Queue</span>
          <span className="text-sm font-bold text-[#1E293B]">
            {currentIndex + 1} <span className="text-[#CBD5E1] mx-1">/</span> {flashcards.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-[#F8FAFC] border border-[#E2E8F0] text-[#64748B] hover:text-[#EF4444] transition-colors"
        >
          <XIcon className="w-5 h-5" />
        </button>
      </header>

      {/* Main Flashcard Arena */}
      <main className="flex-1 relative flex items-center justify-center p-6 bg-[#FFFFFF]">
        <div className="relative w-full max-w-sm aspect-[3/4]">
          <AnimatePresence mode="popLayout">
            {flashcards.slice(currentIndex, currentIndex + 3).map((card, idx) => {
              const stackIndex = idx;
              const isFront = stackIndex === 0;

              return (
                <motion.div
                  key={`${currentIndex + idx}`}
                  style={isFront ? { x, rotate, opacity } : {}}
                  drag={isFront ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.7}
                  onDragEnd={isFront ? handleDragEnd : undefined}
                  initial={{
                    scale: 0.9,
                    y: stackIndex * -8,
                    rotate: stackIndex === 1 ? 3 : stackIndex === 2 ? -3 : 0,
                    opacity: 0
                  }}
                  animate={{
                    scale: 1 - stackIndex * 0.05,
                    y: stackIndex * -8,
                    rotate: stackIndex === 1 ? 3 : stackIndex === 2 ? -3 : 0,
                    opacity: 1,
                    zIndex: stackIndex === 0 ? 30 : stackIndex === 1 ? 20 : 10
                  }}
                  exit={{
                    x: exitX > 0 ? 300 : -300,
                    opacity: 0,
                    rotate: exitX > 0 ? 45 : -45,
                    transition: { duration: 0.3 }
                  }}
                  className="absolute inset-0 cursor-grab active:cursor-grabbing"
                  onTap={() => {
                    if (isFront) setIsFlipped(!isFlipped);
                  }}
                >
                  <div className="relative w-full h-full preserve-3d transition-transform duration-500 shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-[#E2E8F0] rounded-[2rem] bg-white overflow-hidden">
                    <motion.div
                      animate={{ rotateY: isFlipped && isFront ? 180 : 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                      className="w-full h-full relative preserve-3d"
                    >
                      {/* Front Side */}
                      <div className="absolute inset-0 backface-hidden flex flex-col items-center justify-center p-8 text-center">
                        <div className="absolute top-8 left-8 w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                        <h3 className="text-xl md:text-2xl font-bold text-[#1E293B] leading-snug">
                          {card.front}
                        </h3>
                      </div>

                      {/* Back Side */}
                      <div
                        className="absolute inset-0 backface-hidden flex flex-col items-center justify-center p-8 text-center bg-[#F8FAFC]"
                        style={{ transform: 'rotateY(180deg)' }}
                      >
                        <span className="absolute top-8 left-8 text-[10px] font-black uppercase tracking-widest text-[#3B82F6] px-3 py-1 bg-[#DBEAFE] rounded-full">
                          Answer
                        </span>
                        <p className="text-lg md:text-xl font-medium text-[#475569] leading-relaxed">
                          {card.back}
                        </p>
                      </div>
                    </motion.div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </main>

      {/* Control Actions */}
      <footer className="px-6 py-10 flex flex-col items-center gap-6 border-t border-[#E2E8F0] shrink-0">
        <div className="flex gap-4 w-full max-w-sm">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="flex-1 h-14 flex items-center justify-center rounded-2xl bg-white border border-[#E2E8F0] text-[#1E293B] font-bold text-xs uppercase tracking-widest hover:bg-[#F8FAFC] active:scale-95 transition-all disabled:opacity-30"
          >
            Previous
          </button>
          <button
            onClick={handleNextManual}
            className={`flex-[2] h-14 flex items-center justify-center rounded-2xl text-white font-black text-xs uppercase tracking-widest active:scale-95 transition-all ${
              currentIndex < flashcards.length - 1 ? 'bg-[#1E293B]' : 'bg-[#10B981]'
            }`}
          >
            {currentIndex < flashcards.length - 1 ? 'Next Card' : 'Finish Session'}
          </button>
        </div>

        <p className="text-[10px] font-black text-[#94A3B8] uppercase tracking-[0.25em]">
          Swipe to navigate • Tap to reveal
        </p>
      </footer>

      <style>{`
        .preserve-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
      `}</style>
    </div>
  );
};
