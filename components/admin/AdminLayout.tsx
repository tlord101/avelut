import React, { useState } from 'react';
import { Menu, Bell } from 'lucide-react';
import type { UserProfile } from '../../types';

export type AdminTab = 'dashboard' | 'schools' | 'departments' | 'questions' | 'users' | 'payments' | 'usage-analytics' | 'app' | 'app-updates' | 'email-configs' | 'notifications' | 'emails' | 'usage-settings' | 'purchase-logs' | 'tickets' | 'cofounders' | 'seo' | 'feedback' | 'github-integration' | 'database-migrations';

interface AdminLayoutProps {
    children: React.ReactNode;
    activeTab: AdminTab;
    onNavigate: (tab: string) => void;
    userProfile: UserProfile;
}

const SIDEBAR_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', iconClass: 'bi bi-house-door-fill' },
    { id: 'schools', label: 'Schools & Hierarchy', iconClass: 'bi bi-buildings-fill' },
    { id: 'questions', label: 'Past Questions', iconClass: 'bi bi-question-circle-fill' },
    { id: 'users', label: 'User Control', iconClass: 'bi bi-people-fill' },
    { id: 'payments', label: 'Payments', iconClass: 'bi bi-credit-card-fill' },
    { id: 'usage-analytics', label: 'Analytics', iconClass: 'bi bi-graph-up' },
    { id: 'notifications', label: 'Push Notifications', iconClass: 'bi bi-bell-fill' },
    { id: 'emails', label: 'SMTP Emails', iconClass: 'bi bi-envelope-fill' },
    { id: 'app', label: 'System Settings', iconClass: 'bi bi-gear-fill' },
    { id: 'database-migrations', label: 'Database / Migrations', iconClass: 'bi bi-database-fill' },
    { id: 'app-updates', label: 'App Updates', iconClass: 'bi bi-phone-fill' },
    { id: 'tickets', label: 'Support Tickets', iconClass: 'bi bi-inbox-fill' },
    { id: 'cofounders', label: 'Co-Founders', iconClass: 'bi bi-person-badge-fill' },
    { id: 'seo', label: 'SEO & Marketing', iconClass: 'bi bi-globe2' },
    { id: 'feedback', label: 'User Feedback', iconClass: 'bi bi-chat-left-dots-fill' },
    { id: 'github-integration', label: 'CI/CD & GitHub', iconClass: 'bi bi-github' },
];

export const AdminLayout: React.FC<AdminLayoutProps> = ({ 
    children, activeTab, onNavigate, userProfile 
}) => {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleNav = (tab: AdminTab) => {
        onNavigate(tab);
        setIsMobileMenuOpen(false);
    };

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex overflow-hidden">
            {/* Sidebar */}
            <aside className={`fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] flex flex-col ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}>
                <div className="p-6 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-amber-500 text-slate-950 shadow-sm flex items-center justify-center font-black">
                            <i className="bi bi-shield-lock-fill text-lg"></i>
                        </div>
                        <div>
                            <h1 className="font-black text-xl tracking-tight text-slate-900 dark:text-white leading-tight">Admin<span className="text-amber-500">Pro</span></h1>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Command Center</p>
                        </div>
                    </div>
                    <button 
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="md:hidden p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                        <i className="bi bi-x-lg text-lg"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-1">
                    {SIDEBAR_ITEMS.map((item) => {
                        const isActive = activeTab === item.id;
                        return (
                            <button
                                key={item.id}
                                onClick={() => handleNav(item.id as AdminTab)}
                                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl font-bold text-sm transition-all duration-200 cursor-pointer ${
                                    isActive 
                                        ? 'bg-amber-500 text-slate-950 shadow-sm font-black' 
                                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <div className="flex items-center gap-3">
                                    <i className={`${item.iconClass} text-lg ${isActive ? 'text-slate-950' : 'text-slate-400'}`}></i>
                                    <span>{item.label}</span>
                                </div>
                                {isActive && <i className="bi bi-chevron-right text-xs text-slate-950 font-black"></i>}
                            </button>
                        );
                    })}
                </div>

                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-200 dark:bg-slate-800 flex items-center justify-center font-black text-slate-700 dark:text-slate-300 text-sm">
                            {userProfile.display_name?.charAt(0) || 'A'}
                        </div>
                        <div className="overflow-hidden">
                            <p className="font-black text-xs text-slate-900 dark:text-white truncate">{userProfile.display_name}</p>
                            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">Master Admin</p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
                {/* Mobile Header Overlay */}
                {isMobileMenuOpen && (
                    <div className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-40 md:hidden" onClick={() => setIsMobileMenuOpen(false)} />
                )}

                {/* Topbar */}
                <header className="h-20 bg-white backdrop-blur-xl border-b border-slate-200 sticky top-0 z-30 px-4 sm:px-8 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden p-2 -ml-2 text-slate-500 hover: dark:text-white rounded-xl hover:bg-slate-100 transition">
                            <Menu className="w-6 h-6" />
                        </button>
                        <h2 className="text-xl sm:text-2xl font-black  dark:text-white tracking-tight capitalize hidden sm:block">
                            {(activeTab || '').replace('-', ' ')}
                        </h2>
                    </div>

                    <div className="flex items-center gap-3">
                        <button className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover: dark:text-white hover:bg-slate-50 transition relative">
                            <Bell className="w-5 h-5" />
                            <span className="absolute top-2 right-2.5 w-2 h-2 bg-red-500 rounded-full border border-white" />
                        </button>
                    </div>
                </header>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-8 scroll-smooth relative">
                    <div className="max-w-6xl mx-auto w-full">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
};
