import { supabase } from '../lib/supabaseClient';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';

export interface TimetableSession {
    id: string;
    day: string;
    time: string;
    subject: string;
    topic: string;
    activity: string;
    location?: string;
    complete: boolean;
    date?: string; // YYYY-MM-DD
    badgeColor?: 'blue' | 'purple' | 'amber' | 'green';
}

export interface ActivityItem {
    id: string;
    month: string;
    dayNum: string | number;
    title: string;
    meta: string;
    badgeColor: 'blue' | 'purple' | 'amber' | 'green';
}

interface TimetablePageProps {
    userProfile: UserProfile;
    onNavigate?: (tab: string) => void;
    setCustomHeaderConfig?: (config: any) => void;
}

// Default initial schedule data matching the user's uploaded screenshots
const DEFAULT_SCHEDULE_ITEMS: TimetableSession[] = [
    {
        id: 'sched_1',
        day: 'Wednesday',
        time: '08:30 AM - 09:15 AM',
        subject: 'Physics',
        topic: 'Class 9C - Physics',
        activity: 'Lecture',
        location: 'Room 204',
        complete: false,
        badgeColor: 'blue',
    },
    {
        id: 'sched_2',
        day: 'Wednesday',
        time: '09:30 AM - 10:15 AM',
        subject: 'Physics',
        topic: 'Class 10A - Physics',
        activity: 'Lecture',
        location: 'Room 205',
        complete: false,
        badgeColor: 'blue',
    },
    {
        id: 'sched_3',
        day: 'Wednesday',
        time: '11:15 AM - 12:00 PM',
        subject: 'Physics',
        topic: 'Class 11B - Physics',
        activity: 'Lab',
        location: 'Lab 1',
        complete: false,
        badgeColor: 'purple',
    },
    {
        id: 'sched_4',
        day: 'Wednesday',
        time: '02:00 PM - 02:45 PM',
        subject: 'Physics',
        topic: 'Class 12A - Physics',
        activity: 'Lecture',
        location: 'Room 206',
        complete: false,
        badgeColor: 'amber',
    },
];

const DEFAULT_UPCOMING_ACTIVITIES: ActivityItem[] = [
    {
        id: 'act_1',
        month: 'MAY',
        dayNum: '21',
        title: 'Physics Practical - Lab Session',
        meta: 'Class 10A • 09:30 AM - 11:00 AM',
        badgeColor: 'blue',
    },
    {
        id: 'act_2',
        month: 'MAY',
        dayNum: '22',
        title: 'Chemistry Quiz',
        meta: 'Class 11B • 10:30 AM - 11:00 AM',
        badgeColor: 'purple',
    },
    {
        id: 'act_3',
        month: 'MAY',
        dayNum: '23',
        title: 'Maths Worksheet Discussion',
        meta: 'Class 9C • 11:15 AM - 12:00 PM',
        badgeColor: 'amber',
    },
    {
        id: 'act_4',
        month: 'MAY',
        dayNum: '24',
        title: 'Parent-Teacher Meeting',
        meta: 'Virtual • 04:00 PM - 06:00 PM',
        badgeColor: 'green',
    },
];

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const WEEKDAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export const TimetablePage: React.FC<TimetablePageProps> = ({
    userProfile,
    onNavigate,
    setCustomHeaderConfig,
}) => {
    const { addToast } = useToast();

    // Default viewing month May 2026 (matching mockup) or current
    const [currentYear, setCurrentYear] = useState(2026);
    const [currentMonthIndex, setCurrentMonthIndex] = useState(4); // May (0-indexed)
    const [selectedDate, setSelectedDate] = useState<number>(20); // 20th active
    const [sessions, setSessions] = useState<TimetableSession[]>(DEFAULT_SCHEDULE_ITEMS);
    const [activities, setActivities] = useState<ActivityItem[]>(DEFAULT_UPCOMING_ACTIVITIES);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'schedule' | 'activities'>('schedule');

    // Header sync
    useEffect(() => {
        if (!setCustomHeaderConfig) return;
        setCustomHeaderConfig({
            title: 'Study Timetable',
            className: 'bg-transparent',
        });
        return () => {
            setCustomHeaderConfig(null);
        };
    }, [setCustomHeaderConfig]);

    // Load timetable from Supabase & LocalStorage
    const loadTimetable = useCallback(async () => {
        if (!userProfile?.uid) return;
        try {
            // First check local storage for instant rendering
            const localRaw = localStorage.getItem(`avelut_timetable_${userProfile.uid}`);
            if (localRaw) {
                try {
                    const parsed = JSON.parse(localRaw);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        setSessions(parsed);
                    }
                } catch {}
            }

            // Sync with Supabase app_kv
            const { data } = await supabase
                .from('app_kv')
                .select('value')
                .eq('key', `timetable:${userProfile.uid}`)
                .maybeSingle();

            if (data && Array.isArray(data.value) && data.value.length > 0) {
                setSessions(data.value);
                try {
                    localStorage.setItem(`avelut_timetable_${userProfile.uid}`, JSON.stringify(data.value));
                } catch {}
            }
        } catch (e) {
            console.warn('[Supabase] Failed to load user timetable:', e);
        } finally {
            setIsLoading(false);
        }
    }, [userProfile?.uid]);

    useEffect(() => {
        void loadTimetable();
    }, [loadTimetable]);

    // Subscribe to Supabase Realtime changes
    useEffect(() => {
        if (!userProfile?.uid) return;

        const channel = supabase
            .channel(`public:app_kv:timetable:${userProfile.uid}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'app_kv',
                    filter: `key=eq.timetable:${userProfile.uid}`,
                },
                (payload: any) => {
                    if (payload.new && Array.isArray(payload.new.value)) {
                        setSessions(payload.new.value);
                        try {
                            localStorage.setItem(`avelut_timetable_${userProfile.uid}`, JSON.stringify(payload.new.value));
                        } catch {}
                    }
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [userProfile?.uid]);

    // Listen for timetable update events (dispatched by CalendarModal)
    useEffect(() => {
        const handleUpdate = (e: any) => {
            if (e.detail?.sessions && Array.isArray(e.detail.sessions)) {
                setSessions(e.detail.sessions);
            } else {
                void loadTimetable();
            }
        };
        window.addEventListener('avelut_timetable_updated', handleUpdate);
        return () => window.removeEventListener('avelut_timetable_updated', handleUpdate);
    }, [loadTimetable]);

    const handleOpenAiPlanner = () => {
        window.dispatchEvent(new CustomEvent('avelut_open_calendar_modal'));
    };

    // Month Navigation
    const handlePrevMonth = () => {
        if (currentMonthIndex === 0) {
            setCurrentMonthIndex(11);
            setCurrentYear((prev) => prev - 1);
        } else {
            setCurrentMonthIndex((prev) => prev - 1);
        }
    };

    const handleNextMonth = () => {
        if (currentMonthIndex === 11) {
            setCurrentMonthIndex(0);
            setCurrentYear((prev) => prev + 1);
        } else {
            setCurrentMonthIndex((prev) => prev + 1);
        }
    };

    // Calendar Grid Calculation
    const calendarDays = useMemo(() => {
        const firstDayOfMonth = new Date(currentYear, currentMonthIndex, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();
        const daysInPrevMonth = new Date(currentYear, currentMonthIndex, 0).getDate();

        const cells: Array<{
            dayNumber: number;
            isCurrentMonth: boolean;
            isPrevMonth?: boolean;
            isNextMonth?: boolean;
            hasDot?: 'blue' | 'green';
        }> = [];

        // Previous month trailing days
        for (let i = firstDayOfMonth - 1; i >= 0; i--) {
            cells.push({
                dayNumber: daysInPrevMonth - i,
                isCurrentMonth: false,
                isPrevMonth: true,
            });
        }

        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
            let hasDot: 'blue' | 'green' | undefined = undefined;
            if (d === 21 || d === 22) hasDot = 'blue';
            if (d === 24) hasDot = 'green';
            cells.push({
                dayNumber: d,
                isCurrentMonth: true,
                hasDot,
            });
        }

        // Next month trailing days to complete grid (up to 35 or 42)
        const totalNeeded = cells.length <= 35 ? 35 : 42;
        let nextDay = 1;
        while (cells.length < totalNeeded) {
            cells.push({
                dayNumber: nextDay++,
                isCurrentMonth: false,
                isNextMonth: true,
            });
        }

        return cells;
    }, [currentYear, currentMonthIndex]);

    const getPillColorClasses = (color: 'blue' | 'purple' | 'amber' | 'green') => {
        switch (color) {
            case 'blue':
                return {
                    pill: 'bg-blue-100 dark:bg-blue-950/60 text-[#0066FF] dark:text-blue-400',
                    border: 'border-[#0066FF]',
                    tint: 'bg-blue-50/70 dark:bg-blue-950/30',
                };
            case 'purple':
                return {
                    pill: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300',
                    border: 'border-purple-500',
                    tint: 'bg-purple-50/70 dark:bg-purple-950/30',
                };
            case 'amber':
                return {
                    pill: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
                    border: 'border-amber-500',
                    tint: 'bg-amber-50/70 dark:bg-amber-950/30',
                };
            case 'green':
                return {
                    pill: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
                    border: 'border-emerald-500',
                    tint: 'bg-emerald-50/70 dark:bg-emerald-950/30',
                };
            default:
                return {
                    pill: 'bg-blue-100 dark:bg-blue-950/60 text-[#0066FF] dark:text-blue-400',
                    border: 'border-[#0066FF]',
                    tint: 'bg-blue-50/70 dark:bg-blue-950/30',
                };
        }
    };

    return (
        <div className="w-full min-h-screen pb-24 sm:pb-16 bg-[#F8FAFC] dark:bg-[#0F0F12] text-neutral-900 dark:text-white transition-colors duration-200">
            {/* Top Bar / Actions */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 dark:bg-blue-400/10 text-[#0066FF] dark:text-blue-400 text-xs font-bold uppercase tracking-wider mb-1">
                            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 4h-2v-2h2v2zm4 0h-2v-2h2v2z" />
                            </svg>
                            <span>Academic Calendar</span>
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-neutral-900 dark:text-white">
                            Timetable & Schedule
                        </h1>
                    </div>

                    {/* AI Planner Trigger Button */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleOpenAiPlanner}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#0066FF] hover:bg-[#0052cc] text-white text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 active:scale-95 transition-all cursor-pointer"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                            </svg>
                            <span>Plan with AI</span>
                        </button>
                    </div>
                </div>

                {/* Mobile View Toggle */}
                <div className="flex md:hidden items-center p-1 mt-4 rounded-xl bg-neutral-200/60 dark:bg-white/5 border border-neutral-200/50 dark:border-white/5">
                    <button
                        type="button"
                        onClick={() => setActiveTab('schedule')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                            activeTab === 'schedule'
                                ? 'bg-white dark:bg-[#212124] text-neutral-900 dark:text-white shadow-xs'
                                : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                    >
                        Calendar & Schedule
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('activities')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition ${
                            activeTab === 'activities'
                                ? 'bg-white dark:bg-[#212124] text-neutral-900 dark:text-white shadow-xs'
                                : 'text-neutral-500 dark:text-neutral-400'
                        }`}
                    >
                        Upcoming Activities
                    </button>
                </div>
            </div>

            {/* Main Dual-Column Content */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-4">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                    {/* LEFT COLUMN: Calendar Widget + Today's Schedule (Matches Screenshot 2) */}
                    <div
                        className={`md:col-span-7 space-y-6 ${
                            activeTab === 'schedule' ? 'block' : 'hidden md:block'
                        }`}
                    >
                        {/* 1. Calendar Widget */}
                        <div className="rounded-[28px] bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-white/10 shadow-sm p-5 sm:p-6 transition-all">
                            {/* Calendar Header */}
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                                    Calendar
                                </h2>
                            </div>

                            {/* Month & Year Navigation Row */}
                            <div className="flex items-center justify-between px-2 mb-4">
                                <button
                                    type="button"
                                    onClick={handlePrevMonth}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer"
                                    aria-label="Previous month"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>

                                <span className="text-sm sm:text-base font-bold text-neutral-900 dark:text-white tracking-tight">
                                    {MONTH_NAMES[currentMonthIndex]} {currentYear}
                                </span>

                                <button
                                    type="button"
                                    onClick={handleNextMonth}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95 cursor-pointer"
                                    aria-label="Next month"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </div>

                            {/* Weekday Names Header */}
                            <div className="grid grid-cols-7 gap-1 text-center mb-2">
                                {WEEKDAY_NAMES.map((name) => (
                                    <div
                                        key={name}
                                        className="text-[11px] sm:text-xs font-semibold text-neutral-400 dark:text-neutral-500 tracking-wider py-1"
                                    >
                                        {name}
                                    </div>
                                ))}
                            </div>

                            {/* Days Grid */}
                            <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center">
                                {calendarDays.map((cell, idx) => {
                                    const isSelected = cell.isCurrentMonth && cell.dayNumber === selectedDate;
                                    return (
                                        <button
                                            key={`day_${idx}`}
                                            type="button"
                                            onClick={() => {
                                                if (cell.isCurrentMonth) {
                                                    setSelectedDate(cell.dayNumber);
                                                }
                                            }}
                                            className={`relative h-10 sm:h-11 rounded-xl flex flex-col items-center justify-center transition-all cursor-pointer ${
                                                isSelected
                                                    ? 'font-bold'
                                                    : cell.isCurrentMonth
                                                    ? 'text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 font-medium'
                                                    : 'text-neutral-300 dark:text-neutral-600 cursor-default font-normal'
                                            }`}
                                        >
                                            {/* Highlight Circle for Active Selected Day */}
                                            {isSelected ? (
                                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#0066FF] text-white flex items-center justify-center font-bold text-xs sm:text-sm shadow-md shadow-blue-500/30">
                                                    {cell.dayNumber}
                                                </div>
                                            ) : (
                                                <span className="text-xs sm:text-sm">{cell.dayNumber}</span>
                                            )}

                                            {/* Event indicator dot */}
                                            {cell.isCurrentMonth && cell.hasDot && !isSelected && (
                                                <span
                                                    className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                                                        cell.hasDot === 'blue'
                                                            ? 'bg-[#0066FF]'
                                                            : 'bg-emerald-500'
                                                    }`}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 2. Today's Schedule (Matches Screenshot 2 bottom section) */}
                        <div className="rounded-[28px] bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-white/10 shadow-sm p-5 sm:p-6 transition-all">
                            {/* Section Header */}
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                                    Today's Schedule
                                </h2>
                                <button
                                    type="button"
                                    onClick={handleOpenAiPlanner}
                                    className="text-xs sm:text-sm font-semibold text-[#0066FF] hover:underline cursor-pointer"
                                >
                                    View Timetable
                                </button>
                            </div>

                            {/* Schedule Cards List */}
                            <div className="space-y-3">
                                {sessions.map((session, index) => {
                                    // Parse time start and end for column display
                                    const timeParts = session.time.split('-').map((t) => t.trim());
                                    const timeStart = timeParts[0] || '09:00 AM';
                                    const timeEnd = timeParts[1] || '10:00 AM';
                                    const isNowActive = index === 1; // 2nd card has the "Now" badge matching Screenshot 2

                                    // Left vertical accent styling
                                    let borderAccent = 'border-l-[3.5px] border-[#0066FF] bg-blue-50/60 dark:bg-blue-950/30';
                                    if (index === 2) {
                                        borderAccent = 'border-l-[3.5px] border-rose-400 dark:border-rose-500 bg-rose-50/50 dark:bg-rose-950/20';
                                    } else if (index === 3) {
                                        borderAccent = 'border-l-[3.5px] border-amber-400 dark:border-amber-500 bg-amber-50/50 dark:bg-amber-950/20';
                                    }

                                    return (
                                        <div
                                            key={session.id || index}
                                            className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#212124] border border-neutral-200/70 dark:border-white/5 shadow-xs flex items-center gap-3 sm:gap-4 transition hover:border-neutral-300 dark:hover:border-white/10"
                                        >
                                            {/* Left Column: Time Box with vertical border accent */}
                                            <div
                                                className={`w-24 sm:w-28 py-2 px-2.5 rounded-r-xl ${borderAccent} flex flex-col justify-center text-center shrink-0`}
                                            >
                                                <span className="text-[11px] sm:text-xs font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
                                                    {timeStart}
                                                </span>
                                                <span className="text-[10px] sm:text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 leading-tight mt-0.5">
                                                    {timeEnd}
                                                </span>
                                            </div>

                                            {/* Right Column: Title, Room, and "Now" Badge */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <h3 className="text-sm sm:text-[15px] font-bold text-neutral-900 dark:text-white truncate">
                                                        {session.topic || session.subject}
                                                    </h3>

                                                    {/* "Now" Pill Badge (as seen in Screenshot 2) */}
                                                    {isNowActive && (
                                                        <span className="shrink-0 px-2.5 py-0.5 rounded-full bg-[#0066FF] text-white text-[11px] font-bold tracking-wide shadow-xs">
                                                            Now
                                                        </span>
                                                    )}
                                                </div>

                                                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 font-medium">
                                                    {session.location || 'Room 204'}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Upcoming Activities (Matches Screenshot 1) */}
                    <div
                        className={`md:col-span-5 space-y-6 ${
                            activeTab === 'activities' ? 'block' : 'hidden md:block'
                        }`}
                    >
                        <div className="rounded-[28px] bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-white/10 shadow-sm p-5 sm:p-6 transition-all">
                            {/* Upcoming Activities Header */}
                            <div className="flex items-center justify-between mb-5">
                                <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                                    Upcoming Activities
                                </h2>
                                <button
                                    type="button"
                                    onClick={() => addToast('Viewing all upcoming academic activities.', 'info')}
                                    className="text-xs sm:text-sm font-semibold text-[#0066FF] hover:underline cursor-pointer"
                                >
                                    View All
                                </button>
                            </div>

                            {/* Upcoming Activities List */}
                            <div className="space-y-4">
                                {activities.map((item) => {
                                    const colorStyle = getPillColorClasses(item.badgeColor);

                                    return (
                                        <div
                                            key={item.id}
                                            className="flex items-center gap-3.5 sm:gap-4 p-2.5 rounded-2xl hover:bg-neutral-50 dark:hover:bg-white/5 transition"
                                        >
                                            {/* Date Badge: Top Month Pill + Bottom Large Day Number */}
                                            <div className="w-13 sm:w-14 bg-neutral-100/70 dark:bg-white/5 border border-neutral-200/80 dark:border-white/10 rounded-xl overflow-hidden shrink-0 flex flex-col items-center shadow-xs">
                                                {/* Top Pill Month */}
                                                <div
                                                    className={`w-full py-0.5 text-center text-[10px] sm:text-[11px] font-black uppercase tracking-wider ${colorStyle.pill}`}
                                                >
                                                    {item.month}
                                                </div>
                                                {/* Bottom Large Day Number */}
                                                <div className="py-1 text-center text-lg sm:text-xl font-black text-neutral-900 dark:text-white leading-tight">
                                                    {item.dayNum}
                                                </div>
                                            </div>

                                            {/* Event Details */}
                                            <div className="flex-1 min-w-0">
                                                <h3 className="text-sm sm:text-[15px] font-bold text-neutral-900 dark:text-white leading-snug truncate">
                                                    {item.title}
                                                </h3>
                                                <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 font-medium truncate">
                                                    {item.meta}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Assistant banner / prompt to schedule */}
                            <div className="mt-6 pt-5 border-t border-neutral-100 dark:border-white/5">
                                <div className="p-4 rounded-2xl bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-full bg-[#0066FF] text-white flex items-center justify-center shrink-0 shadow-xs">
                                        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                                        </svg>
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="text-xs sm:text-sm font-bold text-neutral-900 dark:text-white">
                                            Need to add a course syllabus?
                                        </h4>
                                        <p className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                                            Upload a timetable screenshot or type your class routine to auto-organize your week.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleOpenAiPlanner}
                                            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-bold text-[#0066FF] hover:underline cursor-pointer"
                                        >
                                            <span>Open AI Scheduler</span>
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
