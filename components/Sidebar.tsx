import React from 'react';
import type { NavItem, UserProfile } from '../types';
import { ShieldCheckIcon } from './icons/ShieldCheckIcon';
import { navigationItems, secondaryNavigationItems, adminNavigationItems } from '../constants';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';




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
    isModal?: boolean;
    onClick: () => void;
    unreadCount?: number;
    unreadMessagesCount?: number;
}> = ({ item, isActive, isExpanded, isModal, onClick, unreadCount = 0, unreadMessagesCount = 0 }) => (
    <li className="relative">
        <button
            onClick={onClick}
            data-tour-id={`sidebar-${item.id}`}
            className={`w-full flex transition-all duration-350 ease-in-out group hover:scale-[1.02] ${
                isModal 
                    ? 'flex-col items-center justify-center p-3 rounded-2xl gap-2 text-center h-full' 
                    : `items-center p-3 rounded-xl text-left ${isExpanded ? 'justify-start' : 'justify-center'}`
            } ${
                isActive
                ? (isModal ? 'bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 font-bold border border-blue-500/20' : 'bg-blue-600 text-white font-bold shadow-md shadow-blue-500/10')
                : (isModal ? 'bg-white dark:bg-black/50 dark:bg-slate-800/50 text-slate-600 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-slate-700' : 'text-slate-655 opacity-85 hover:bg-white dark:bg-black/50 hover:text-blue-600 hover:opacity-100')
            }`}
        >
            {!isModal && isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-white dark:bg-black rounded-r-full"></div>}
            <span className={`flex-shrink-0 transition-all duration-300 ease-in-out ${!isModal && isExpanded ? 'mr-4' : 'mr-0'} ${!isModal && isActive ? 'text-white' : (isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-gray-400 group-hover:text-blue-600')}`}>{item.icon}</span>
            <span className={`font-semibold overflow-hidden transition-opacity duration-300 ease-in-out flex-1 ${!isModal && isExpanded ? 'opacity-100 whitespace-nowrap' : (isModal ? 'text-xs leading-tight' : 'opacity-0 whitespace-nowrap')}`}>
                {item.label}
            </span>
            {isExpanded && !isModal && item.id === 'messenger' && unreadMessagesCount > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-black rounded-full h-4 min-w-4 px-1 flex items-center justify-center shadow-sm">
                    {unreadMessagesCount}
                </span>
            )}
            {((!isExpanded && item.id === 'messenger') || (isModal && item.id === 'messenger')) && unreadMessagesCount > 0 && (
                <span className="absolute top-2 right-2 flex h-2 w-2 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800" />
            )}
        </button>
    </li>
);

const SidebarContent: React.FC<{
    isExpanded: boolean;
    isModal?: boolean;
    activeItem: string;
    onItemClick: (id: string) => void;
    userProfile: UserProfile | null;
    onLogout: () => void;
    items?: NavItem[];
    secondaryItems?: NavItem[];
    unreadCount?: number;
    unreadMessagesCount?: number;
}> = ({ isExpanded, isModal, activeItem, onItemClick, userProfile, onLogout, items = navigationItems, secondaryItems = secondaryNavigationItems, unreadCount = 0, unreadMessagesCount = 0 }) => (
    <div className={`h-full p-4 flex flex-col ${isModal ? '' : 'bg-transparent'}`}>
      {/* Top Section: Logo */}
      <div className={`flex items-center flex-shrink-0 px-2 pt-2 ${isModal ? 'mb-6 justify-center' : 'mb-10'}`}>
        {isExpanded ? (
          <img src="/logo_full.png" alt="AVELUT Logo" className={`object-contain ${isModal ? 'h-8' : 'h-10'}`} />
        ) : (
          <img src="/logo_icon.png" alt="AVELUT Logo" className="w-10 h-10 object-contain" />
        )}
      </div>
      
      {/* Middle Section: Navigation */}
      <nav className="flex-grow overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!isModal && <p className={`text-[10px] font-black text-slate-400 opacity-80 uppercase tracking-widest mb-4 transition-opacity duration-300 ease-in-out ${isExpanded ? 'pl-3 opacity-100' : 'opacity-0'}`}>Menu</p>}
        <ul className={isModal ? "grid grid-cols-3 gap-3" : "space-y-1"}>
          {items.map((item) => (
              <NavButton key={item.id} item={item} isActive={activeItem === item.id} isExpanded={isExpanded} isModal={isModal} onClick={() => onItemClick(item.id)} unreadCount={unreadCount} unreadMessagesCount={unreadMessagesCount} />
          ))}
        </ul>
      </nav>
      
      {/* Bottom Section: Profile & Logout */}
      <div className="flex-shrink-0">
        <div className={`mt-6 p-3 rounded-xl border relative ${isModal ? 'bg-slate-50 dark:bg-black dark:bg-slate-800/50 border-slate-100 dark:border-slate-700' : 'bg-white dark:bg-black/45 backdrop-blur-sm border-white/50 shadow-sm'}`}>
          {unreadCount > 0 && (
             <span className="absolute top-2 right-2 flex h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse ring-2 ring-white dark:ring-slate-800" title={`${unreadCount} unread notifications`} />
          )}
          <div className="flex items-center">
            <Avatar display_name={userProfile?.display_name || null} photo_url={userProfile?.photo_url} className="w-10 h-10 flex-shrink-0" />
            <div className={`ml-3 whitespace-nowrap overflow-hidden transition-opacity duration-300 ease-in-out ${isExpanded ? 'opacity-100' : 'opacity-0'}`}>
              <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <span>{userProfile?.display_name}</span>
                <VerificationBadge status={userProfile?.subscription_status} />
              </p>
              <p className="text-[10px] text-slate-500 dark:text-gray-400 dark:text-slate-400 font-extrabold uppercase tracking-widest">{userProfile?.level} Level</p>
            </div>
          </div>
        </div>
      </div>
    </div>
);


export const Sidebar = React.memo<SidebarProps>(({ activeItem, onItemClick, userProfile, onLogout, isMobileSidebarOpen, onCloseMobileSidebar, items, secondaryItems, unreadCount = 0, unreadMessagesCount = 0 }) => {
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
      {/* Mobile Sidebar (Fly-in Modal) */}
      <div
        className={`fixed inset-0 z-[125] flex items-center justify-center p-4 transition-all duration-300 md:hidden ${isMobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      >
        <div
          className="absolute inset-0 bg-charcoal/40 dark:bg-black/60 backdrop-blur-sm"
          onClick={onCloseMobileSidebar}
          aria-hidden="true"
        ></div>
        
        <aside className={`relative w-full max-w-sm max-h-[85vh] bg-white dark:bg-black/80 dark:bg-black/80 backdrop-blur-xl border border-white/40 dark:border-slate-700 shadow-2xl rounded-3xl overflow-hidden transform transition-all duration-400 cubic-bezier(0.34, 1.56, 0.64, 1) ${isMobileSidebarOpen ? 'scale-100 translate-y-0 opacity-100 rotate-0' : 'scale-75 translate-y-8 opacity-0 -rotate-2'}`}>
            <SidebarContent 
                isExpanded={true}
                isModal={true}
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
          className={`hidden md:block flex-shrink-0 bg-white dark:bg-black/60 dark:bg-card/40 backdrop-blur-lg border-r border-white/40 dark:border-border shadow-sm w-72 h-full`}
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
});

Sidebar.displayName = 'Sidebar';
