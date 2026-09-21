/**
 * ExcalidrawLiveBoard.tsx
 *
 * Full-screen, dark-theme Excalidraw canvas for the Avelut Live Classroom.
 * Configures presentation mode (hides toolbars / menus) and registers
 * the ExcalidrawImperativeAPI with AvelutBoardController on mount.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
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

  // Seed the initial elements with the lesson topic title
  const initialElements = useMemo(() => {
    avelutBoardController.initBoard(topicTitle);
    try {
      return convertToExcalidrawElements([
        {
          type: 'text',
          x: 60,
          y: 40,
          text: `📚 ${topicTitle}`,
          fontSize: 36,
          fontFamily: 1,
          textAlign: 'left',
          verticalAlign: 'top',
          strokeColor: '#38BDF8',
        },
      ]);
    } catch {
      return [];
    }
  }, [topicTitle]);

  const handleApiSet = (api: ExcalidrawImperativeAPI) => {
    console.log('[ExcalidrawLiveBoard] API ready');
    apiRef.current = api;
    avelutBoardController.setApi(api);
    avelutBoardController.setLessonTitle(topicTitle);
    onBoardReady?.(api);
  };

  useEffect(() => {
    if (apiRef.current) {
      avelutBoardController.setApi(apiRef.current);
    }
  }, [topicTitle]);

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-[#0A0A0A] ${className}`}
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
            toggleTheme: false,
          },
        }}
        initialData={{
          elements: initialElements,
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

