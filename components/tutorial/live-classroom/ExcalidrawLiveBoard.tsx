/**
 * ExcalidrawLiveBoard.tsx
 *
 * Full-screen, dark-theme Excalidraw canvas for the Avelut Live Classroom.
 * Configures presentation mode (hides toolbars / menus) and registers
 * the ExcalidrawImperativeAPI with AvelutBoardController on mount.
 */

import React, { useEffect, useRef, useMemo } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { avelutBoardController } from '../../../services/live-classroom/AvelutBoardController';
import { useTheme } from '../../../contexts/ThemeContext';

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

  // Hook into Avelut theme context with fallback to document/system dark mode
  let themeMode: 'light' | 'dark' = 'dark';
  try {
    const themeContext = useTheme();
    if (themeContext?.mode) {
      themeMode = themeContext.mode;
    }
  } catch {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      themeMode = 'dark';
    } else if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      themeMode = 'dark';
    } else {
      themeMode = 'light';
    }
  }

  const isDark = themeMode === 'dark';
  const boardBg = isDark ? '#0A0A0A' : '#F8FAFC';

  // Seed the initial elements with the lesson topic title
  const initialElements = useMemo(() => {
    avelutBoardController.setTheme(themeMode);
    avelutBoardController.initBoard(topicTitle);
    return avelutBoardController.getElements();
  }, [topicTitle]);

  const handleApiSet = (api: ExcalidrawImperativeAPI) => {
    console.log('[ExcalidrawLiveBoard] API ready, theme:', themeMode);
    apiRef.current = api;

    // Lock the board immediately on load with correct theme & canvas background
    api.updateScene({
      appState: {
        theme: themeMode,
        viewBackgroundColor: boardBg,
        viewModeEnabled: true,
        zenModeEnabled: true,
        zoom: { value: 1.0 as any },
        scrollX: 0,
        scrollY: 0,
      }
    });
    avelutBoardController.setTheme(themeMode);
    avelutBoardController.setApi(api);
    avelutBoardController.setLessonTitle(topicTitle);
    onBoardReady?.(api);
  };

  // Sync theme changes dynamically
  useEffect(() => {
    avelutBoardController.setTheme(themeMode);
    if (apiRef.current) {
      apiRef.current.updateScene({
        appState: {
          theme: themeMode,
          viewBackgroundColor: boardBg,
        }
      });
    }
  }, [themeMode, boardBg]);

  useEffect(() => {
    if (apiRef.current) {
      avelutBoardController.setApi(apiRef.current);
    }
  }, [topicTitle]);

  return (
    <div
      className={`relative w-full h-full overflow-hidden select-none excalidraw-live-board ${
        isDark ? 'bg-[#0A0A0A]' : 'bg-[#F8FAFC]'
      } ${className}`}
    >
      {/* Aggressively suppress all Excalidraw UI bars, docks, tools, sidebars, and mobile bottom bars */}
      <style>{`
        .excalidraw-live-board .excalidraw.theme--dark {
          --theme-filter: none !important;
        }
        .excalidraw-live-board .excalidraw canvas,
        .excalidraw-live-board canvas {
          --theme-filter: none !important;
          filter: none !important;
        }
        .excalidraw-live-board .excalidraw .layer-ui__wrapper,
        .excalidraw-live-board .excalidraw .App-bottom-bar,
        .excalidraw-live-board .excalidraw .bottom-bar,
        .excalidraw-live-board .excalidraw .layer-ui__wrapper__footer,
        .excalidraw-live-board .excalidraw .mobile-misc-buttons,
        .excalidraw-live-board .excalidraw [data-testid="main-menu-trigger"],
        .excalidraw-live-board .excalidraw .App-toolbar,
        .excalidraw-live-board .excalidraw .App-toolbar-content,
        .excalidraw-live-board .excalidraw .App-menu,
        .excalidraw-live-board .excalidraw .sidebar-trigger,
        .excalidraw-live-board .excalidraw .sidebar,
        .excalidraw-live-board .excalidraw .footer-center,
        .excalidraw-live-board .excalidraw .zoom-actions,
        .excalidraw-live-board .excalidraw .undo-redo-buttons,
        .excalidraw-live-board .excalidraw .hint,
        .excalidraw-live-board .excalidraw .help-icon,
        .excalidraw-live-board .excalidraw .buttonList,
        .excalidraw-live-board .excalidraw .UserList,
        .excalidraw-live-board .excalidraw .dropdown-menu-container,
        .excalidraw-live-board .excalidraw .encrypted-icon-tooltip,
        .excalidraw-live-board .excalidraw .shapes-section,
        .excalidraw-live-board .excalidraw .stack,
        .excalidraw-live-board .excalidraw .Island {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }
      `}</style>
      <Excalidraw
        excalidrawAPI={handleApiSet}
        theme={themeMode}
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
            theme: themeMode,
            viewBackgroundColor: boardBg,
            viewModeEnabled: true,
            zenModeEnabled: true,
            currentItemStrokeColor: isDark ? '#38BDF8' : '#0284C7',
            currentItemBackgroundColor: 'transparent',
            currentItemFontFamily: 1,
            gridSize: null,
            zoom: { value: 1.0 as any },
            scrollX: 0,
            scrollY: 0,
          },
        }}
      />
    </div>
  );
};

export default ExcalidrawLiveBoard;

