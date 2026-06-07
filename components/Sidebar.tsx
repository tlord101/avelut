import React from 'react';
import type { NavItem, UserProfile } from '../types';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { navigationItems, secondaryNavigationItems, adminNavigationItems } from '../constants';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';



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
  unreadCount?: number;
  unreadMessagesCount?: number;
}

const NavButton: React.FC<{
    item: NavItem;
    isActive: boolean;
    isExpanded: boolean;
    onClick: () => void;
    unreadCount?: number;
    unreadMessagesCount?: number;
}> = ({ item, isActive, isExpanded, onClick, unreadCount = 0, unreadMessagesCount = 0 }) => (
    <li className="relative">
        <button
            onClick={onClick}
            data-tour-id={`sidebar-${item.id}`}
            className={`w-full flex items-center p-3 rounded-xl text-left transition-all duration-350 ease-in-out group hover:scale-[1.02]
            ${isExpanded ? 'justify-start' : 'justify-center'}
            ${
                isActive
                ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/10'
                : 'text-slate-655 opacity-85 hover:bg-white/50 hover:text-blue-600 hover:opacity-100'
            }`}
        >
            {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-white rounded-r-full"></div>}
            <span className={`flex-shrink-0 transition-all duration-300 ease-in-out ${isExpanded ? 'mr-4' : 'mr-0'} ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-blue-600'}`}>{item.icon}</span>
            <span className={`font-semibold whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out flex-1 ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
                {item.label}
            </span>
            {isExpanded && item.id === 'messenger' && unreadMessagesCount > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-black rounded-full h-4 min-w-4 px-1 flex items-center justify-center shadow-sm">
                    {unreadMessagesCount}
                </span>
            )}
            {!isExpanded && item.id === 'messenger' && unreadMessagesCount > 0 && (
                <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
            )}
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
    unreadCount?: number;
    unreadMessagesCount?: number;
}> = ({ isExpanded, activeItem, onItemClick, userProfile, onLogout, items = navigationItems, secondaryItems = secondaryNavigationItems, unreadCount = 0, unreadMessagesCount = 0 }) => (
    <div className="h-full p-4 flex flex-col bg-transparent">
      {/* Top Section: Logo */}
      <div className="flex items-center mb-10 flex-shrink-0 px-2 pt-2">
        {isExpanded ? (
          <img src="/logo_full.png" alt="AVELUT Logo" className="h-10 object-contain" />
        ) : (
          <img src="/logo_icon.png" alt="AVELUT Logo" className="w-10 h-10 object-contain" />
        )}
      </div>
      
      {/* Middle Section: Navigation */}
      <nav className="flex-grow overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <p className={`text-[10px] font-black text-slate-400 opacity-80 uppercase tracking-widest mb-4 transition-opacity duration-300 ease-in-out ${isExpanded ? 'pl-3 opacity-100' : 'opacity-0'}`}>Menu</p>
        <ul className="space-y-1">
          {items.map((item) => (
              <NavButton key={item.id} item={item} isActive={activeItem === item.id} isExpanded={isExpanded} onClick={() => onItemClick(item.id)} unreadCount={unreadCount} unreadMessagesCount={unreadMessagesCount} />
          ))}
        </ul>
      </nav>
      
      {/* Bottom Section: Profile & Logout */}
      <div className="flex-shrink-0">
         <ul className="space-y-1 pt-4 border-t border-white/40">
              {secondaryItems.map((item) => (
                  <NavButton key={item.id} item={item} isActive={activeItem === item.id} isExpanded={isExpanded} onClick={() => onItemClick(item.id)} unreadCount={unreadCount} unreadMessagesCount={unreadMessagesCount} />
              ))}
               <li>
                  <button
                      onClick={onLogout}
                      className={`w-full flex items-center p-3 rounded-xl text-left transition-colors duration-300 ease-in-out text-slate-655 opacity-85 hover:bg-red-50 hover:text-red-600 hover:opacity-100 group ${isExpanded ? 'justify-start' : 'justify-center'}`}
                  >
                      <span className="flex-shrink-0 text-slate-500 group-hover:text-red-600"><LogoutIcon /></span>
                      <span className={`font-semibold ml-4 whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>Logout</span>
                  </button>
              </li>
          </ul>
        <div className="mt-6 p-3 bg-white/45 backdrop-blur-sm rounded-xl border border-white/50 shadow-sm relative">
          {unreadCount > 0 && (
             <span className="absolute top-2 right-2 flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse ring-2 ring-white" title={`${unreadCount} unread notifications`} />
          )}
          <div className="flex items-center">
            <Avatar display_name={userProfile?.display_name || null} photo_url={userProfile?.photo_url} className="w-10 h-10 flex-shrink-0" />
            <div className={`ml-3 whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
              <p className="font-bold text-slate-800 flex items-center gap-1.5">
                <span>{userProfile?.display_name}</span>
                <VerificationBadge status={userProfile?.subscription_status} />
              </p>
              <p className="text-[10px] text-slate-500 font-extrabold uppercase tracking-widest">{userProfile?.level} Level</p>
            </div>
          </div>
        </div>
      </div>
    </div>
);


export const Sidebar: React.FC<SidebarProps> = ({ activeItem, onItemClick, userProfile, onLogout, isMobileSidebarOpen, onCloseMobileSidebar, items, secondaryItems, unreadCount = 0, unreadMessagesCount = 0 }) => {
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
        <div className="absolute inset-0 bg-charcoal/30 backdrop-blur-sm" onClick={onCloseMobileSidebar} aria-hidden="true"></div>
        <aside className="relative w-80 h-full bg-white/70 backdrop-blur-lg border-r border-white/40 shadow-xl">
          <SidebarContent
            isExpanded={true}
            activeItem={activeItem}
            onItemClick={handleMobileItemClick}
            userProfile={userProfile}
            onLogout={handleMobileLogout}
            items={navItems}
            secondaryItems={secondaryItems}
            unreadCount={unreadCount}
            unreadMessagesCount={unreadMessagesCount}
           />
        </aside>
      </div>
      
      {/* Desktop Sidebar */}
      <aside 
          className={`hidden md:block flex-shrink-0 bg-white/60 backdrop-blur-lg border-r border-white/40 shadow-sm w-72 h-full`}
      >
        <SidebarContent 
            isExpanded={true}
            activeItem={activeItem}
            onItemClick={onItemClick}
            userProfile={userProfile}
            onLogout={onLogout}
            items={navItems}
            secondaryItems={secondaryItems}
            unreadCount={unreadCount}
            unreadMessagesCount={unreadMessagesCount}
        />
      </aside>
    </>
  );
};
