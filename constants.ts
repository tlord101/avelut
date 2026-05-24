

import React from 'react';
import type { NavItem } from './types';
import { DashboardIcon } from './components/icons/DashboardIcon';
import { StudyGuideIcon } from './components/icons/StudyGuideIcon';
import { ChatIcon } from './components/icons/ChatIcon';
import { ExamIcon } from './components/icons/ExamIcon';
import { CameraIcon } from './components/icons/CameraIcon';
import { HelpIcon } from './components/icons/HelpIcon';
import { GraduationCapIcon } from './components/icons/GraduationCapIcon';
import { LeaderboardIcon } from './components/icons/LeaderboardIcon';

// Define SVG icons for secondary navigation
const SettingsIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  React.createElement('svg', {
    xmlns: "http://www.w3.org/2000/svg",
    className: className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 2
  },
    React.createElement('path', {
      key: '1',
      strokeLinecap: "round",
      strokeLinejoin: "round",
      d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    }),
    React.createElement('path', {
      key: '2',
      strokeLinecap: "round",
      strokeLinejoin: "round",
      d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    })
  )
);

export const navigationItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: React.createElement(DashboardIcon) },
  { id: 'leaderboard', label: 'Leaderboard', icon: React.createElement(LeaderboardIcon) },
  { id: 'study_guide', label: 'Study Guide', icon: React.createElement(StudyGuideIcon) },
  { id: 'chat', label: 'Chat', icon: React.createElement(ChatIcon) },
  { id: 'visual_solver', label: 'Visual Solver', icon: React.createElement(CameraIcon) },
  { id: 'exam', label: 'Exam', icon: React.createElement(ExamIcon) },
];

export const adminNavigationItems: NavItem[] = [
    { id: 'admin', label: 'Admin Panel', icon: React.createElement(GraduationCapIcon) },
    { id: 'dashboard', label: 'Student View', icon: React.createElement(DashboardIcon) },
];

export const secondaryNavigationItems: NavItem[] = [
    { id: 'settings', label: 'Settings', icon: React.createElement(SettingsIcon) },
    { id: 'help', label: 'Help', icon: React.createElement(HelpIcon) },
];
