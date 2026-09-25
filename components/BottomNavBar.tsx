import React, { useState, useEffect, useRef } from 'react';
import { Play } from 'lucide-react';
import { CameraIcon } from './icons/CameraIcon';
import { ShutterIcon } from './icons/ShutterIcon';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { AIIcon } from './icons/AIIcon';
import { ChatsIcon } from './icons/ChatsIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import type { UserProfile } from '../types';
import { triggerHaptic } from '../utils/capacitorUtils';
import { PlaygroundIcon } from '../constants';

interface BottomNavBarProps {
  activeItem: string;
  onItemClick: (id: string) => void;
  isVisible: boolean;
  userProfile: UserProfile | null;
  items?: { id: string; icon: React.ReactElement; label: string }[];
  onCenterActionClick?: () => void;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  activeItem,
  onItemClick,
  isVisible,
  userProfile,
  items,
  onCenterActionClick,
}) => {
  const baseNavItems = [
    { id: 'playground', icon: <PlaygroundIcon className="w-[26px] h-[26px]" />, label: 'Play' },
    { id: 'study_guide', icon: <StudyGuideIcon />, label: 'Guide' },
    { id: 'live_tutorial_setup', icon: <Play className="w-6 h-6" />, label: 'Tutorial' },
    { id: 'chat', icon: <AIIcon />, label: 'AI' },
    { id: 'messenger', icon: <ChatsIcon />, label: 'Chats' },
  ];

  const adminNavItems = [
    { id: 'admin', icon: <ShieldCheckIcon />, label: 'Admin' },
    { id: 'playground', icon: <PlaygroundIcon className="w-6 h-6" />, label: 'Play' },
  ];

  const navItems = items || (userProfile?.is_admin ? adminNavItems : baseNavItems);

  const containerRef = useRef<HTMLDivElement>(null);
  const [navSize, setNavSize] = useState({ width: 375, height: 76 });
  const [clipId] = useState(() => `nav-clip-${Math.random().toString(36).substr(2, 9)}`);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setNavSize((prev) => {
          const newWidth = entry.contentRect.width;
          const newHeight = containerRef.current?.clientHeight || 76;
          if (newWidth === 0) return prev;
          if (prev.width === newWidth && prev.height === newHeight) return prev;
          return { width: newWidth, height: newHeight };
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  if (!isVisible) return null;

  const renderTab = (itemId: string, iconComponent: React.ReactElement, label: string) => {
    const isActive = activeItem === itemId;
    const activeColorClass = isActive
      ? 'text-[#0066FF] dark:text-[#0066FF]'
      : 'text-[#002D62] dark:text-slate-400';

    return (
      <button
        key={itemId}
        data-tour-id={`bottomnav-${itemId}`}
        onClick={() => {
          triggerHaptic();
          onItemClick(itemId);
        }}
        className={`flex flex-col items-center justify-center h-full w-full focus:outline-none group active:scale-95 transition-all duration-200 ${activeColorClass}`}
      >
        <div className="mb-1 transition-transform group-hover:scale-105 duration-200">
          {React.cloneElement(iconComponent as React.ReactElement<any>, {
            active: isActive,
            className: 'w-[26px] h-[26px]',
          })}
        </div>
        <span className={`text-[11px] tracking-wide transition-all duration-200 ${isActive ? 'font-bold' : 'font-semibold'}`}>
          {label}
        </span>
      </button>
    );
  };

  if (navItems.length !== 5) {
    return (
      <nav className="fixed bottom-0 left-0 right-0 flex justify-center z-[120] animate-fade-in-up pb-[env(safe-area-inset-bottom,0px)] bg-transparent pointer-events-none">
        <div className="relative w-full max-w-md h-16 bg-white/90 dark:bg-[#0A0A0A]/90 backdrop-blur-xl rounded-full border border-slate-200/80 dark:border-white/10 px-6 flex items-center justify-around pointer-events-auto shadow-lg">
          {navItems.map((item) => {
            const isActive = activeItem === item.id;
            const activeColorClass = isActive
              ? 'text-[#0066FF] dark:text-[#0066FF]'
              : 'text-[#002D62] dark:text-slate-400';
            return (
              <button
                key={item.id}
                onClick={() => onItemClick(item.id)}
                className={`flex flex-col items-center justify-center focus:outline-none ${activeColorClass}`}
              >
                <div className="mb-1">
                  {React.cloneElement(item.icon as React.ReactElement<any>, {
                    active: isActive,
                    className: 'w-6 h-6',
                  })}
                </div>
                <span className="text-[10px] font-semibold">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    );
  }

  const { width: navWidth, height: navHeight } = navSize;
  const height = navHeight;
  const cx = navWidth / 2;
  const notchWidth = 136;
  const halfNotch = notchWidth / 2;
  const depth = 38;
  const r = 24;
  const xLeft = cx - halfNotch;
  const xRight = cx + halfNotch;
  const safeNavWidth = navWidth > 0 ? navWidth : typeof window !== 'undefined' ? window.innerWidth : 375;
  const safeHeight = Math.max(height, 50);

  const pathD = [
    `M 0 ${safeHeight}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    `L ${xLeft} 0`,
    `C ${cx - 38} 0, ${cx - 44} ${depth}, ${cx} ${depth}`,
    `C ${cx + 44} ${depth}, ${cx + 38} 0, ${xRight} 0`,
    `L ${safeNavWidth - r} 0`,
    `A ${r} ${r} 0 0 1 ${safeNavWidth} ${r}`,
    `L ${safeNavWidth} ${safeHeight}`,
    `L 0 ${safeHeight}`,
    'Z',
  ].join(' ');

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex justify-center z-[120] animate-fade-in-up pointer-events-none">
      <svg width="0" height="0" className="absolute pointer-events-none">
        <defs>
          <clipPath id={clipId}>
            <path d={pathD} />
          </clipPath>
        </defs>
      </svg>
      <div
        ref={containerRef}
        className="relative w-full max-w-md h-[calc(76px+env(safe-area-inset-bottom,0px))] bg-transparent pointer-events-auto"
      >
        <div
          className="absolute inset-0 z-0 transform-gpu"
          style={{
            clipPath: `url(#${clipId})`,
            WebkitClipPath: `url(#${clipId})`,
            transform: 'translateZ(0)',
            WebkitTransform: 'translateZ(0)',
            willChange: 'transform',
          }}
        >
          <div className="absolute inset-0 bg-white/95 dark:bg-[#0A0A0A]/95 backdrop-blur-xl translate-z-0 border-t border-slate-200/80 dark:border-white/10" />
        </div>

        <svg
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
          viewBox={`0 0 ${navWidth} ${height}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d={pathD} stroke="rgba(255, 255, 255, 0.12)" strokeWidth="1.5" fill="none" />
        </svg>

        <button
          onClick={() => (onCenterActionClick ? onCenterActionClick() : onItemClick(navItems[2].id))}
          className={`absolute -top-[25px] left-1/2 -translate-x-1/2 w-[64px] h-[64px] rounded-full bg-white dark:bg-[#0A0A0A] border-[4px] border-[#E53935] flex items-center justify-center shadow-md hover:scale-105 active:scale-95 transition-all z-30 cursor-pointer ${
            activeItem === 'live_tutorial_setup' ? 'ring-4 ring-[#E53935]/30' : ''
          }`}
        >
          <Play className="w-8 h-8 text-[#E53935] fill-current ml-1" />
        </button>

        <div className="grid grid-cols-5 w-full relative z-20 px-2" style={{ height: '76px' }}>
          <div className="flex items-center justify-center">
            {renderTab(navItems[0].id, navItems[0].icon, navItems[0].label)}
          </div>
          <div className="flex items-center justify-center">
            {renderTab(navItems[1].id, navItems[1].icon, navItems[1].label)}
          </div>
          <div className="flex items-center justify-center" />
          <div className="flex items-center justify-center">
            {renderTab(navItems[3].id, navItems[3].icon, navItems[3].label)}
          </div>
          <div className="flex items-center justify-center">
            {renderTab(navItems[4].id, navItems[4].icon, navItems[4].label)}
          </div>
        </div>
      </div>
    </nav>
  );
};
