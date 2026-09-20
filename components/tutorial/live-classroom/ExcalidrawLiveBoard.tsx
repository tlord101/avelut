/**
 * ExcalidrawLiveBoard.tsx
 *
 * Full-screen, dark-theme Excalidraw canvas for the Avelut Live Classroom.
 * Configures presentation mode (hides toolbars / menus) and registers
 * the ExcalidrawImperativeAPI with AvelutBoardController on mount.
 */

import React, { useEffect, useRef } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw';
import { avelutBoardController } from '../../../services/live-classroom/AvelutBoardController';

export interface ExcalidrawLiveBoardProps {
  topicTitle: string;
  className?: string;
  onBoardReady?: (api: ExcalidrawImperativeAPI) => void;
}

export const ExcalidrawLiveBoard: React.FC<ExcalidrawLiveBoardProps> = ({
  topicTitle,
  className = '',
  onBoardReady,
}) => {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const didInitRef = useRef(false);

  const handleApiSet = (api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    avelutBoardController.setApi(api);
    avelutBoardController.setLessonTitle(topicTitle);

    // Write the topic title header on first mount only
    if (!didInitRef.current) {
      didInitRef.current = true;
      avelutBoardController.writeText(`📚 ${topicTitle}`, {
        fontSize: 'title',
        color: '#38BDF8',
        x: 60,
        y: 40,
      });
    }

    onBoardReady?.(api);
  };

  // Clean up board controller API ref on unmount
  useEffect(() => {
    return () => {
      avelutBoardController.setApi(null);
    };
  }, []);

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-[#0A0A0A] ${className}`}
      // Prevent the Excalidraw canvas capturing back-gesture on mobile
      style={{ touchAction: 'none' }}
    >
      <Excalidraw
        excalidrawAPI={handleApiSet}
        theme="dark"
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: false,
            export: false,
            loadScene: false,
            saveAsImage: false,
            theme: false,
          },
        }}
        initialData={{
          appState: {
            viewBackgroundColor: '#0A0A0A',
            currentItemStrokeColor: '#38BDF8',
            currentItemBackgroundColor: 'transparent',
            currentItemFontFamily: 1,
            gridSize: null,
          },
        }}
      />
    </div>
  );
};

export default ExcalidrawLiveBoard;

