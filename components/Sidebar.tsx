import React from 'react';
import type { NavItem, UserProfile } from '../types';
import { LogoIcon } from './icons/LogoIcon';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { navigationItems, secondaryNavigationItems, adminNavigationItems } from '../constants';
import { Avatar } from './Avatar';


// SVG icons defined directly in the component to avoid creating new files
const LogoutIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
  </svg>
);

interface SidebarProps {
  activeItem: string;
  onItemClick: (id: string) => void;
  userProfile: UserProfile | null;
  onLogout: () => void;
  isMobileSidebarOpen: boolean;
  onCloseMobileSidebar: () => void;
  items?: NavItem[];
  secondaryItems?: NavItem[];
}

const NavButton: React.FC<{
    item: NavItem;
    isActive: boolean;
    isExpanded: boolean;
    onClick: () => void;
}> = ({ item, isActive, isExpanded, onClick }) => (
    <li className="relative">
        <button
            onClick={onClick}
            data-tour-id={`sidebar-${item.id}`}
            className={`w-full flex items-center p-3 rounded-lg text-left transition-colors duration-300 ease-in-out group
            ${isExpanded ? 'justify-start' : 'justify-center'}
            ${
                isActive
                ? 'bg-mint text-emerald font-semibold'
                : 'text-charcoal opacity-70 hover:bg-off-white hover:opacity-100'
            }`}
        >
            {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-emerald rounded-r-full"></div>}
            <span className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isExpanded ? 'mr-4' : 'mr-0'}`}>{item.icon}</span>
            <span className={`font-medium whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
                {item.label}
            </span>
        </button>
    </li>
);

const SidebarContent: React.FC<{
    isExpanded: boolean;
    activeItem: string;
    onItemClick: (id: string) => void;
    userProfile: UserProfile | null;
    onLogout: () => void;
    items?: NavItem[];
    secondaryItems?: NavItem[];
}> = ({ isExpanded, activeItem, onItemClick, userProfile, onLogout, items = navigationItems, secondaryItems = secondaryNavigationItems }) => (
    <div className="h-full p-4 flex flex-col bg-white">
      {/* Top Section: Logo */}
      <div className="flex items-center mb-10 flex-shrink-0">
        <LogoIcon className="w-10 h-10 text-emerald flex-shrink-0" />
        <h1 className={`text-2xl font-bold text-charcoal tracking-tighter ml-3 whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
          VANTUTOR
        </h1>
      </div>
      
      {/* Middle Section: Navigation */}
      <nav className="flex-grow overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <p className={`text-xs font-semibold text-charcoal opacity-40 uppercase tracking-widest mb-4 transition-opacity duration-300 ease-in-out ${isExpanded ? 'pl-3 opacity-100' : 'opacity-0'}`}>Menu</p>
        <ul className="space-y-1">
          {items.map((item) => (
              <NavButton key={item.id} item={item} isActive={activeItem === item.id} isExpanded={isExpanded} onClick={() => onItemClick(item.id)} />
          ))}
        </ul>
      </nav>
      
      {/* Bottom Section: Profile & Logout */}
      <div className="flex-shrink-0">
         <ul className="space-y-1 pt-4 border-t border-gray-100">
              {secondaryItems.map((item) => (
                  <NavButton key={item.id} item={item} isActive={activeItem === item.id} isExpanded={isExpanded} onClick={() => onItemClick(item.id)} />
              ))}
               <li>
                  <button
                      onClick={onLogout}
                      className={`w-full flex items-center p-3 rounded-lg text-left transition-colors duration-300 ease-in-out text-charcoal opacity-70 hover:bg-red-50 hover:text-red-600 hover:opacity-100 group ${isExpanded ? 'justify-start' : 'justify-center'}`}
                  >
                      <span className="flex-shrink-0"><LogoutIcon /></span>
                      <span className={`font-medium ml-4 whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>Logout</span>
                  </button>
              </li>
          </ul>
        <div className="mt-6 p-3 bg-off-white rounded-xl border border-gray-100">
          <div className="flex items-center">
            <Avatar display_name={userProfile?.display_name || null} photo_url={userProfile?.photo_url} className="w-10 h-10 flex-shrink-0" />
            <div className={`ml-3 whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
              <p className="font-semibold text-charcoal">{userProfile?.display_name}</p>
              <p className="text-xs text-charcoal opacity-50 uppercase tracking-widest">{userProfile?.level} Level</p>
            </div>
          </div>
        </div>
      </div>
    </div>
);


export const Sidebar: React.FC<SidebarProps> = ({ activeItem, onItemClick, userProfile, onLogout, isMobileSidebarOpen, onCloseMobileSidebar, items, secondaryItems }) => {
  const handleMobileItemClick = (id: string) => {
    onItemClick(id);
    onCloseMobileSidebar();
  };

  const handleMobileLogout = () => {
    onLogout();
    onCloseMobileSidebar();
  };

  const navItems = items || (userProfile?.is_admin ? adminNavigationItems : navigationItems);

  return (
    <>
      {/* Mobile Sidebar */}
      <div className={`fixed inset-0 z-[110] transform transition-transform duration-300 ease-in-out md:hidden ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="absolute inset-0 bg-charcoal/20 backdrop-blur-sm" onClick={onCloseMobileSidebar} aria-hidden="true"></div>
        <aside className="relative w-80 h-full bg-white border-r border-gray-100">
          <SidebarContent
            isExpanded={true}
            activeItem={activeItem}
            onItemClick={handleMobileItemClick}
            userProfile={userProfile}
            onLogout={handleMobileLogout}
            items={navItems}
            secondaryItems={secondaryItems}
           />
        </aside>
      </div>
      
      {/* Desktop Sidebar */}
      <aside 
          className={`hidden md:block flex-shrink-0 bg-white border-r border-gray-100 w-72 h-full`}
      >
        <SidebarContent 
            isExpanded={true}
            activeItem={activeItem}
            onItemClick={onItemClick}
            userProfile={userProfile}
            onLogout={onLogout}
            items={navItems}
            secondaryItems={secondaryItems}
        />
      </aside>
    </>
  );
};
