
import React from 'react';
import type { NavItem } from './types';
import { StudyGuideIcon } from './components/icons/StudyGuideIcon';
import { CameraIcon } from './components/icons/CameraIcon';
import { AIIcon } from './components/icons/AIIcon';
import { MessengerIcon } from './components/icons/MessengerIcon';
import { StackIcon } from './components/icons/StackIcon';
import { GraduationCapIcon } from './components/icons/GraduationCapIcon';

/** Outlined stroke icons for B&W sidebar */
const NotebooksIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  React.createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      className,
      fill: 'none',
      viewBox: '0 0 24 24',
      stroke: 'currentColor',
      strokeWidth: 1.75,
    },
    React.createElement('path', {
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      d: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25',
    })
  )
);

const PlaygroundIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  React.createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      className,
      fill: 'none',
      viewBox: '0 0 24 24',
      stroke: 'currentColor',
      strokeWidth: 1.75,
    },
    React.createElement('path', {
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      d: 'M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5',
    })
  )
);

const UserOutlineIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  React.createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      className,
      fill: 'none',
      viewBox: '0 0 24 24',
      stroke: 'currentColor',
      strokeWidth: 1.75,
    },
    React.createElement('path', {
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      d: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z',
    })
  )
);

export const navigationItems: NavItem[] = [
  { id: 'chat', label: 'New Chat', icon: React.createElement(AIIcon, { className: 'w-5 h-5' }) },
  { id: 'study_guide', label: 'Study Guide', icon: React.createElement(StudyGuideIcon, { className: 'w-5 h-5' }) },
  { id: 'messenger', label: 'Messages', icon: React.createElement(MessengerIcon, { className: 'w-5 h-5' }) },
  { id: 'playground', label: 'Playground', icon: React.createElement(PlaygroundIcon) },
];

export const adminNavigationItems: NavItem[] = [
  { id: 'admin', label: 'Admin Panel', icon: React.createElement(GraduationCapIcon, { className: 'w-5 h-5' }) },
];

export const secondaryNavigationItems: NavItem[] = [];

export { UserOutlineIcon, NotebooksIcon, PlaygroundIcon };
