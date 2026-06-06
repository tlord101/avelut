import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePortalRoot } from '../utils/portal';

export interface TourStep {
  target?: string;
  title: string;
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

interface GuidedTourProps {
  steps: TourStep[];
  isOpen: boolean;
  onClose: (completed: boolean) => void;
  onBeforeStep?: (stepIndex: number) => Promise<void> | void;
}

const Tooltip: React.FC<{
  step: TourStep;
  currentStepIndex: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}> = ({ step, currentStepIndex, totalSteps, targetRect, onNext, onBack, onSkip }) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useLayoutEffect(() => {
    if (!tooltipRef.current) return;

    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const placement = step.placement || 'bottom';
    let top = 0, left = 0;

    if (!targetRect || placement === 'center') {
      top = window.innerHeight / 2 - tooltipRect.height / 2;
      left = window.innerWidth / 2 - tooltipRect.width / 2;
    } else {
      const { top: targetTop, left: targetLeft, width: targetWidth, height: targetHeight } = targetRect;
      const margin = 10;
      
      switch (placement) {
        case 'top':
          top = targetTop - tooltipRect.height - margin;
          left = targetLeft + targetWidth / 2 - tooltipRect.width / 2;
          break;
        case 'bottom':
          top = targetTop + targetHeight + margin;
          left = targetLeft + targetWidth / 2 - tooltipRect.width / 2;
          break;
        case 'left':
          top = targetTop + targetHeight / 2 - tooltipRect.height / 2;
          left = targetLeft - tooltipRect.width - margin;
          break;
        case 'right':
          top = targetTop + targetHeight / 2 - tooltipRect.height / 2;
          left = targetLeft + targetWidth + margin;
          break;
      }
    }
    
    // Adjust to keep within viewport
    if (left < 10) left = 10;
    if (top < 10) top = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) left = window.innerWidth - tooltipRect.width - 10;
    if (top + tooltipRect.height > window.innerHeight - 10) top = window.innerHeight - tooltipRect.height - 10;


    setStyle({ top: `${top}px`, left: `${left}px`, position: 'fixed' });
  }, [step, targetRect]);

  const isLastStep = currentStepIndex === totalSteps - 1;

  return (
    <div ref={tooltipRef} style={style} className="bg-white rounded-lg shadow-2xl p-4 w-72 max-w-[calc(100vw-2rem)] z-[9999] animate-fade-in-up">
      <h3 className="font-bold text-lg text-gray-800">{step.title}</h3>
      <p className="text-sm text-gray-600 mt-2">{step.content}</p>
      <div className="flex justify-between items-center mt-4">
        <span className="text-xs text-gray-500">{currentStepIndex + 1} / {totalSteps}</span>
        <div className="flex gap-2">
          {currentStepIndex > 0 && (
            <button onClick={onBack} className="text-sm font-semibold text-gray-600 hover:text-gray-900">Back</button>
          )}
          <button onClick={onNext} className="text-sm font-semibold px-3 py-1 rounded-md bg-lime-600 text-white hover:bg-lime-700">
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
      <button onClick={onSkip} className="absolute top-2 right-2 text-sm text-gray-400 hover:text-gray-700">Skip Tour</button>
    </div>
  );
};

const GuidedTour: React.FC<GuidedTourProps> = ({ steps, isOpen, onClose, onBeforeStep }) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const portalRoot = usePortalRoot('avelut-guided-tour-root');

  const updateTargetRect = useCallback(() => {
    const step = steps[currentStepIndex];
    if (!step.target) {
      setTargetRect(null);
      return;
    }
    try {
      const element = document.querySelector(step.target);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      } else {
        console.warn(`Tour target not found: ${step.target}`);
        setTargetRect(null); // Fallback to center
      }
    } catch(e) {
      console.error(`Invalid selector: ${step.target}`, e);
      setTargetRect(null);
    }
  }, [currentStepIndex, steps]);

  useEffect(() => {
    if (isOpen) {
      updateTargetRect();
      window.addEventListener('resize', updateTargetRect);
      window.addEventListener('scroll', updateTargetRect, true);
    }
    return () => {
      window.removeEventListener('resize', updateTargetRect);
      window.removeEventListener('scroll', updateTargetRect, true);
    };
  }, [isOpen, updateTargetRect]);
  
  const handleStepChange = async (nextStepIndex: number) => {
    setIsTransitioning(true);

    if (onBeforeStep) {
        await onBeforeStep(nextStepIndex);
    }
    
    setCurrentStepIndex(nextStepIndex);
    // Let's use a timeout to allow for DOM changes from onBeforeStep
    setTimeout(() => {
        setIsTransitioning(false);
    }, 100);
  };

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      handleStepChange(currentStepIndex + 1);
    } else {
      onClose(true);
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      handleStepChange(currentStepIndex - 1);
    }
  };

  if (!isOpen) return null;
  if (!portalRoot) return null;

  const currentStep = steps[currentStepIndex];
  const highlightStyle: React.CSSProperties = targetRect
    ? {
        width: `${targetRect.width + 8}px`,
        height: `${targetRect.height + 8}px`,
        top: `${targetRect.top - 4}px`,
        left: `${targetRect.left - 4}px`,
        boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)',
      }
    : {};
  
  return createPortal(
    <div className="fixed inset-0 z-[9998]">
      <div
        style={highlightStyle}
        className="fixed rounded-lg pointer-events-none transition-all duration-300 ease-in-out"
      />
      {!isTransitioning && (
        <Tooltip
          step={currentStep}
          currentStepIndex={currentStepIndex}
          totalSteps={steps.length}
          targetRect={targetRect}
          onNext={handleNext}
          onBack={handleBack}
          onSkip={() => onClose(false)}
        />
      )}
    </div>,
    portalRoot
  );
};

export default GuidedTour;