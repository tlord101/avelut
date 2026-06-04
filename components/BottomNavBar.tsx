import React, { useState, useEffect } from 'react';
import { HomeIcon } from './icons/HomeIcon';
import { CameraIcon } from './icons/CameraIcon';
import { StudyGuideIcon } from './icons/StudyGuideIcon';
import { ChatIcon } from './icons/ChatIcon';
import { MessengerIcon } from './icons/MessengerIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import type { UserProfile } from '../types';

interface BottomNavBarProps {
  activeItem: string;
  onItemClick: (id: string) => void;
  isVisible: boolean;
  userProfile: UserProfile | null;
  items?: { id: string, icon: React.ReactElement, label: string }[];
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({ activeItem, onItemClick, isVisible, userProfile, items }) => {
  const baseNavItems = [
    { id: 'dashboard', icon: <HomeIcon />, label: 'Home' },
    { id: 'study_guide', icon: <StudyGuideIcon />, label: 'Guide' },
    { id: 'visual_solver', icon: <CameraIcon />, label: 'Solver' },
    { id: 'chat', icon: <ChatIcon className="w-7 h-7" />, label: 'Chat' },
    { id: 'messenger', icon: <MessengerIcon className="w-7 h-7" />, label: 'Connect' },
  ];

  const adminNavItems = [
    { id: 'admin', icon: <ShieldCheckIcon />, label: 'Admin' },
    { id: 'dashboard', icon: <HomeIcon />, label: 'Home' },
  ];

  const navItems = items || (userProfile?.is_admin ? adminNavItems : baseNavItems);

  const activeIndex = navItems.findIndex(item => item.id === activeItem);

  if (!isVisible || activeIndex === -1) {
      return null;
  }

  const isStudentNav = navItems.length === 5;

  return (
    <nav className="fixed bottom-0 left-0 right-0 flex justify-center z-30 md:hidden animate-fade-in-up bottom-nav">
      <div className="relative w-full max-w-md h-16 bg-white/80 backdrop-blur-xl rounded-full shadow-2xl border border-white/30">
        
        {/* The moving bubble that provides the "cutout" effect */}
        <div 
          className={`absolute -top-3 w-14 h-14 bg-gray-100 rounded-full transition-all duration-500 ease-[cubic-bezier(0.68,-0.55,0.27,1.55)]`}
          style={{ left: `calc(${(activeIndex + 0.5) * (100 / navItems.length)}% - 1.75rem)` }}
        />

        {/* The active icon that moves with the bubble */}
        <div
          className={`absolute -top-3 w-14 h-14 rounded-full bg-gradient-to-tr from-lime-500 to-teal-500 flex items-center justify-center text-white shadow-lg transition-all duration-500 ease-[cubic-bezier(0.68,-0.55,0.27,1.55)]`}
          style={{ left: `calc(${(activeIndex + 0.5) * (100 / navItems.length)}% - 1.75rem)` }}
        >
          {navItems[activeIndex] && React.cloneElement(navItems[activeIndex].icon, { className: 'w-8 h-8' })}
        </div>
        
        {/* The static, clickable placeholders */}
        <div className="flex items-center h-full">
          {navItems.map((item, index) => {
            const isMiddle = isStudentNav && index === 2;

            if (isMiddle) {
              return (
                <button
                  key={item.id}
                  onClick={() => onItemClick(item.id)}
                  data-tour-id={`bottomnav-${item.id}`}
                  className="flex-1 flex flex-col items-center justify-center h-full text-gray-500 transition-colors relative"
                  aria-label={item.label}
                >
                  {/* Floating larger button container for middle Solver button when inactive */}
                  <div className={`transition-all duration-300 ${activeIndex === index ? 'opacity-0 scale-50' : 'opacity-100 scale-100'} absolute -top-3 left-1/2 -translate-x-1/2 w-14 h-14 rounded-full bg-white shadow-[0_8px_24px_rgba(0,136,204,0.22)] border-2 border-[#0088CC]/20 flex items-center justify-center z-10 active:scale-95`}>
                    {React.cloneElement(item.icon, { className: 'w-7 h-7 text-[#002D62]' })}
                  </div>
                  <span className={`text-[10px] sm:text-xs mt-1 transition-all duration-300 ${activeIndex === index ? 'opacity-0 scale-50' : 'opacity-100 scale-100'} absolute bottom-1 font-bold text-[#002D62]/70`}>
                    {item.label}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => onItemClick(item.id)}
                data-tour-id={`bottomnav-${item.id}`}
                className="flex-1 flex flex-col items-center justify-center h-full text-gray-500 transition-colors"
                aria-label={item.label}
              >
                {/* This icon is hidden when its tab is active */}
                <div className={`transition-opacity duration-300 ${activeIndex === index ? 'opacity-0' : 'opacity-100'}`}>
                  {React.cloneElement(item.icon, { className: 'w-7 h-7' })}
                </div>
                {/* This label is hidden when its tab is active */}
                <span className={`text-[10px] sm:text-xs mt-1 transition-all duration-300 ${activeIndex === index ? 'opacity-0 scale-50' : 'opacity-100 scale-100'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};