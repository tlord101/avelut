import React, { useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'framer-motion';
import { XIcon } from './icons/XIcon';

interface FlashcardsUIProps {
  flashcards: { front: string; back: string }[];
  onFinish: () => void;
  onClose: () => void;
}

const FlashcardItem = ({ card, stackIndex, exitDirection, isFlipped, setIsFlipped, onSwipeNext, onSwipePrev }: any) => {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-150, 150], [-25, 25]);
  const opacity = useTransform(x, [-150, -100, 0, 100, 150], [0, 1, 1, 1, 0]);
  const isFront = stackIndex === 0;

  const handleDragEnd = (event: any, info: any) => {
    if (!isFront) return;
    if (info.offset.x > 80 || info.velocity.x > 300) {
      onSwipeNext(1);
    } else if (info.offset.x < -80 || info.velocity.x < -300) {
      onSwipeNext(-1);
    }
  };

  return (
    <motion.div
      custom={exitDirection}
      style={{ x, rotate, opacity }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
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
        opacity: stackIndex > 2 ? 0 : 1,
        zIndex: stackIndex === 0 ? 30 : stackIndex === 1 ? 20 : 10
      }}
      exit={((dir: number) => ({
        x: dir * 300,
        opacity: 0,
        rotate: dir * 45,
        transition: { duration: 0.3 }
      })) as any}
      className="absolute inset-0 cursor-grab active:cursor-grabbing"
      onClick={() => {
        if (isFront) setIsFlipped(!isFlipped);
      }}
    >
      <div className={`relative w-full h-full preserve-3d transition-transform duration-500 shadow-[0_4px_20px_rgba(0,0,0,0.05)] border border-[#E2E8F0] rounded-[2rem] bg-white dark:bg-black overflow-hidden ${isFront ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <motion.div
          animate={{ rotateY: isFlipped && isFront ? 180 : 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className="w-full h-full relative preserve-3d"
        >
          {/* Front Side */}
          <div className="absolute inset-0 backface-hidden flex flex-col items-center justify-center p-8 text-center">
            <div className="absolute top-8 left-8 w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
            <h3 className="text-xl md:text-2xl font-bold text-[#1E293B] dark:text-white leading-snug">
              {card.front}
            </h3>
          </div>

          {/* Back Side */}
          <div
            className="absolute inset-0 backface-hidden flex flex-col items-center justify-center p-8 text-center bg-[#F8FAFC] dark:bg-[#0A0A0A]"
            style={{ transform: 'rotateY(180deg)' }}
          >
            <span className="absolute top-8 left-8 text-[10px] font-black uppercase tracking-widest text-[#3B82F6] px-3 py-1 bg-[#DBEAFE] dark:bg-[#1E3A8A] rounded-full">
              Answer
            </span>
            <p className="text-lg md:text-xl font-medium text-[#475569] dark:text-[#E2E8F0] leading-relaxed">
              {card.back}
            </p>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
};

export const FlashcardsUI: React.FC<FlashcardsUIProps> = ({ flashcards, onFinish, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [exitDirection, setExitDirection] = useState(1);

  const swipeNext = (direction: number = 1) => {
    setExitDirection(direction);
    setIsFlipped(false);
    if (currentIndex < flashcards.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      onFinish();
    }
  };

  const handleNextManual = () => {
    swipeNext(1);
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setExitDirection(-1);
      setIsFlipped(false);
      setCurrentIndex((prev) => prev - 1);
    }
  };

  if (!flashcards.length) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-white dark:bg-black flex flex-col overflow-hidden font-sans select-none">
      {/* Premium Header */}
      <header className="flex justify-between items-center px-4 sm:px-6 py-3 border-b border-gray-200 dark:border-gray-800 shrink-0">
        <div className="flex flex-col">
          <span className="text-[9px] font-black text-gray-400 uppercase tracking-[0.24em] mb-0.5">Card Queue</span>
          <span className="text-sm font-bold text-gray-900 dark:text-white">
            {currentIndex + 1} <span className="text-[#CBD5E1] dark:text-gray-600 mx-1">/</span> {flashcards.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:text-red-500 transition-colors"
        >
          <XIcon className="w-5 h-5" />
        </button>
      </header>

      {/* Main Flashcard Arena */}
      <main className="flex-1 relative flex items-center justify-center p-4 sm:p-6 bg-white dark:bg-black">
        <div className="relative w-full max-w-sm aspect-[3/4]">
          <AnimatePresence mode="popLayout" custom={exitDirection}>
            {flashcards.slice(currentIndex, currentIndex + 3).map((card, idx) => (
              <FlashcardItem
                key={`${currentIndex + idx}-${card.front}`}
                card={card}
                stackIndex={idx}
                exitDirection={exitDirection}
                isFlipped={isFlipped}
                setIsFlipped={setIsFlipped}
                onSwipeNext={swipeNext}
              />
            ))}
          </AnimatePresence>
        </div>
      </main>

      {/* Control Actions */}
      <footer className="px-4 sm:px-6 py-5 flex flex-col items-center gap-4 border-t border-gray-200 dark:border-gray-800 shrink-0 bg-white dark:bg-black">
        <div className="flex gap-3 w-full max-w-sm">
          <button
            onClick={handlePrev}
            disabled={currentIndex === 0}
            className="flex-1 h-11 flex items-center justify-center rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 font-bold text-[10px] uppercase tracking-widest hover:bg-gray-50 dark:hover:bg-gray-800 active:scale-95 transition-all disabled:opacity-30"
          >
            Previous
          </button>
          <button
            onClick={handleNextManual}
            className={`flex-[2] h-11 flex items-center justify-center rounded-xl text-white font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all ${
              currentIndex < flashcards.length - 1 ? 'bg-blue-600 dark:bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {currentIndex < flashcards.length - 1 ? 'Next Card' : 'Finish Session'}
          </button>
        </div>

        <p className="text-[9px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-[0.28em]">
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
