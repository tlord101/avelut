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
    return avelutBoardController.getElements();
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
      className={`relative w-full h-full overflow-hidden bg-[#0A0A0A] select-none excalidraw-live-board ${className}`}
    >
      {/* Aggressively suppress all Excalidraw UI bars, docks, tools, sidebars */}
      <style>{`
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .App-toolbar,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .App-toolbar-content,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .App-menu,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .sidebar-trigger,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .sidebar,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .footer-center,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .zoom-actions,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .undo-redo-buttons,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .hint,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .help-icon,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .buttonList,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .UserList,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .dropdown-menu-container,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .encrypted-icon-tooltip,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .shapes-section,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .stack,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper .Island {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `}</style>
      <Excalidraw
        excalidrawAPI={handleApiSet}
        theme="dark"
        viewModeEnabled={true}
        zenModeEnabled={true}
        gridModeEnabled={false}
        renderTopRightUI={() => null}
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
            viewModeEnabled: true,
            zenModeEnabled: true,
            currentItemStrokeColor: '#38BDF8',
            currentItemBackgroundColor: 'transparent',
            currentItemFontFamily: 1,
            gridSize: null,
            zoom: { value: 1.0 },
            scrollX: 0,
            scrollY: 0,
          },
        }}
      />
    </div>
  );
};

export default ExcalidrawLiveBoard;

