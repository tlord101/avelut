import { supabase } from '../lib/supabaseClient';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';

export interface TimetableSession {
    id: string;
    day: string; // e.g. "Monday", "Tuesday", etc.
    time: string; // e.g. "08:30 AM - 09:15 AM"
    subject: string;
    topic: string;
    activity: string;
    location?: string;
    complete: boolean;
    date?: string; // Optional specific date: YYYY-MM-DD
    badgeColor?: 'blue' | 'purple' | 'amber' | 'green';
}

export interface ActivityItem {
    id: string;
    month: string; // e.g. "MAY", "OCT"
    dayNum: string | number;
    title: string;
    meta: string;
    date?: string; // YYYY-MM-DD
    badgeColor: 'blue' | 'purple' | 'amber' | 'green';
}

interface TimetablePageProps {
    userProfile: UserProfile;
    onNavigate?: (tab: string) => void;
    setCustomHeaderConfig?: (config: any) => void;
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_ABBRS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const TimetablePage: React.FC<TimetablePageProps> = ({
    userProfile,
    onNavigate,
    setCustomHeaderConfig,
}) => {
    const { addToast } = useToast();

    // Default to real-world current date
    const today = useMemo(() => new Date(), []);
    const [currentYear, setCurrentYear] = useState<number>(today.getFullYear());
    const [currentMonthIndex, setCurrentMonthIndex] = useState<number>(today.getMonth());
    const [selectedDate, setSelectedDate] = useState<number>(today.getDate());

    // Real data states initialized to empty (NO dummy data)
    const [sessions, setSessions] = useState<TimetableSession[]>([]);
    const [activities, setActivities] = useState<ActivityItem[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isSaving, setIsSaving] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<'schedule' | 'activities'>('schedule');

    // Modals
    const [isAddSessionModalOpen, setIsAddSessionModalOpen] = useState(false);
    const [isAddActivityModalOpen, setIsAddActivityModalOpen] = useState(false);

    // Form states for adding a session
    const [formSubject, setFormSubject] = useState('');
    const [formTopic, setFormTopic] = useState('');
    const [formDay, setFormDay] = useState('Monday');
    const [formStartTime, setFormStartTime] = useState('09:00 AM');
    const [formEndTime, setFormEndTime] = useState('10:00 AM');
    const [formLocation, setFormLocation] = useState('Room 101');
    const [formActivity, setFormActivity] = useState('Lecture');
    const [formColor, setFormColor] = useState<'blue' | 'purple' | 'amber' | 'green'>('blue');

    // Form states for adding an activity
    const [formActTitle, setFormActTitle] = useState('');
    const [formActDate, setFormActDate] = useState(() => today.toISOString().split('T')[0]);
    const [formActMeta, setFormActMeta] = useState('10:00 AM - 12:00 PM • Main Hall');
    const [formActColor, setFormActColor] = useState<'blue' | 'purple' | 'amber' | 'green'>('purple');

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

    // Currently selected day of week name
    const selectedDateObj = useMemo(() => {
        return new Date(currentYear, currentMonthIndex, selectedDate);
    }, [currentYear, currentMonthIndex, selectedDate]);

    const selectedDayOfWeek = useMemo(() => {
        return FULL_WEEKDAYS[selectedDateObj.getDay()] || 'Wednesday';
    }, [selectedDateObj]);

    const selectedDateIso = useMemo(() => {
        const y = currentYear;
        const m = String(currentMonthIndex + 1).padStart(2, '0');
        const d = String(selectedDate).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }, [currentYear, currentMonthIndex, selectedDate]);

    // Load timetable from Supabase & LocalStorage
    const loadTimetable = useCallback(async () => {
        if (!userProfile?.uid) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        try {
            // First check local storage for instant offline rendering
            const localRaw = localStorage.getItem(`avelut_timetable_${userProfile.uid}`);
            if (localRaw) {
                try {
                    const parsed = JSON.parse(localRaw);
                    if (Array.isArray(parsed)) {
                        setSessions(parsed);
                    } else if (typeof parsed === 'object' && parsed) {
                        if (Array.isArray(parsed.sessions)) setSessions(parsed.sessions);
                        if (Array.isArray(parsed.activities)) setActivities(parsed.activities);
                    }
                } catch {}
            }

            // Sync with Supabase app_kv
            const { data, error } = await supabase
                .from('app_kv')
                .select('value')
                .eq('key', `timetable:${userProfile.uid}`)
                .maybeSingle();

            if (!error && data && data.value) {
                if (Array.isArray(data.value)) {
                    setSessions(data.value);
                } else if (typeof data.value === 'object') {
                    setSessions(Array.isArray(data.value.sessions) ? data.value.sessions : []);
                    setActivities(Array.isArray(data.value.activities) ? data.value.activities : []);
                }
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
                    if (payload.new && payload.new.value) {
                        const val = payload.new.value;
                        if (Array.isArray(val)) {
                            setSessions(val);
                        } else if (typeof val === 'object') {
                            if (Array.isArray(val.sessions)) setSessions(val.sessions);
                            if (Array.isArray(val.activities)) setActivities(val.activities);
                        }
                        try {
                            localStorage.setItem(`avelut_timetable_${userProfile.uid}`, JSON.stringify(val));
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
            const detail = e.detail;
            if (detail) {
                if (Array.isArray(detail.sessions)) setSessions(detail.sessions);
                if (Array.isArray(detail.activities)) setActivities(detail.activities);
            } else {
                void loadTimetable();
            }
        };
        window.addEventListener('avelut_timetable_updated', handleUpdate);
        return () => window.removeEventListener('avelut_timetable_updated', handleUpdate);
    }, [loadTimetable]);

    // Save changes to Supabase app_kv
    const saveTimetableData = async (newSessions: TimetableSession[], newActivities: ActivityItem[]) => {
        if (!userProfile?.uid) return;
        setIsSaving(true);
        const payload = {
            sessions: newSessions,
            activities: newActivities,
            updated_at: new Date().toISOString(),
        };

        try {
            setSessions(newSessions);
            setActivities(newActivities);
            localStorage.setItem(`avelut_timetable_${userProfile.uid}`, JSON.stringify(payload));

            const { error } = await supabase
                .from('app_kv')
                .upsert({
                    key: `timetable:${userProfile.uid}`,
                    value: payload,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'key' });

            if (error) throw error;
        } catch (err: any) {
            console.error('[TimetablePage] Save error:', err);
            addToast('Failed to save to Supabase. Check network.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

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

    const handleJumpToToday = () => {
        const n = new Date();
        setCurrentYear(n.getFullYear());
        setCurrentMonthIndex(n.getMonth());
        setSelectedDate(n.getDate());
    };

    // Calendar Grid Calculation with Dynamic Dots from Real Supabase Data
    const calendarDays = useMemo(() => {
        const firstDayOfMonth = new Date(currentYear, currentMonthIndex, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();
        const daysInPrevMonth = new Date(currentYear, currentMonthIndex, 0).getDate();

        const cells: Array<{
            dayNumber: number;
            isCurrentMonth: boolean;
            isPrevMonth?: boolean;
            isNextMonth?: boolean;
            hasDot?: 'blue' | 'purple' | 'amber' | 'green';
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
        const monthAbbr = MONTH_ABBRS[currentMonthIndex];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(currentYear, currentMonthIndex, d);
            const dayName = FULL_WEEKDAYS[dateObj.getDay()];
            const iso = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

            // Check if user has real sessions or activities on this day
            const hasSession = sessions.some(
                (s) => s.date === iso || (s.day && s.day.toLowerCase() === dayName.toLowerCase())
            );
            const hasActivity = activities.some(
                (a) => a.date === iso || (String(a.dayNum) === String(d) && (!a.month || a.month.toUpperCase() === monthAbbr))
            );

            let hasDot: 'blue' | 'purple' | 'amber' | 'green' | undefined = undefined;
            if (hasActivity) {
                hasDot = 'green';
            } else if (hasSession) {
                hasDot = 'blue';
            }

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
    }, [currentYear, currentMonthIndex, sessions, activities]);

    // Sessions filtered for the currently selected day
    const filteredSessions = useMemo(() => {
        return sessions.filter((s) => {
            if (s.date && s.date === selectedDateIso) return true;
            if (s.day && s.day.toLowerCase() === selectedDayOfWeek.toLowerCase()) return true;
            return false;
        });
    }, [sessions, selectedDateIso, selectedDayOfWeek]);

    // Toggle Session Complete
    const handleToggleSessionComplete = async (sessionId: string) => {
        const next = sessions.map((s) =>
            s.id === sessionId ? { ...s, complete: !s.complete } : s
        );
        await saveTimetableData(next, activities);
    };

    // Delete Session
    const handleDeleteSession = async (sessionId: string) => {
        const next = sessions.filter((s) => s.id !== sessionId);
        await saveTimetableData(next, activities);
        addToast('Session removed from timetable.', 'info');
    };

    // Delete Activity
    const handleDeleteActivity = async (activityId: string) => {
        const next = activities.filter((a) => a.id !== activityId);
        await saveTimetableData(sessions, next);
        addToast('Activity removed.', 'info');
    };

    // Add Session Handler
    const handleSaveNewSession = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedSubject = formSubject.trim();
        if (!trimmedSubject) {
            addToast('Please enter a subject name.', 'info');
            return;
        }

        const newSession: TimetableSession = {
            id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            day: formDay,
            time: `${formStartTime.trim()} - ${formEndTime.trim()}`,
            subject: trimmedSubject,
            topic: formTopic.trim() || trimmedSubject,
            activity: formActivity,
            location: formLocation.trim() || 'Room 101',
            complete: false,
            badgeColor: formColor,
        };

        const updated = [...sessions, newSession];
        await saveTimetableData(updated, activities);
        addToast(`Added "${trimmedSubject}" for ${formDay}`, 'success');
        setFormSubject('');
        setFormTopic('');
        setIsAddSessionModalOpen(false);
    };

    // Add Activity Handler
    const handleSaveNewActivity = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedTitle = formActTitle.trim();
        if (!trimmedTitle) {
            addToast('Please enter an activity title.', 'info');
            return;
        }

        let mAbbr = 'OCT';
        let dayNumber = '15';
        if (formActDate) {
            const parts = formActDate.split('-');
            if (parts.length === 3) {
                const monthNum = parseInt(parts[1], 10) - 1;
                mAbbr = MONTH_ABBRS[monthNum] || 'OCT';
                dayNumber = String(parseInt(parts[2], 10));
            }
        }

        const newActivity: ActivityItem = {
            id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: trimmedTitle,
            date: formActDate,
            month: mAbbr,
            dayNum: dayNumber,
            meta: formActMeta.trim() || 'Scheduled activity',
            badgeColor: formActColor,
        };

        const updated = [...activities, newActivity];
        await saveTimetableData(sessions, updated);
        addToast(`Activity "${trimmedTitle}" added!`, 'success');
        setFormActTitle('');
        setIsAddActivityModalOpen(false);
    };

    const getPillColorClasses = (color?: 'blue' | 'purple' | 'amber' | 'green') => {
        switch (color) {
            case 'purple':
                return {
                    pill: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300',
                    border: 'border-l-[3.5px] border-purple-500 bg-purple-50/70 dark:bg-purple-950/30',
                };
            case 'amber':
                return {
                    pill: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
                    border: 'border-l-[3.5px] border-amber-500 bg-amber-50/70 dark:bg-amber-950/30',
                };
            case 'green':
                return {
                    pill: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
                    border: 'border-l-[3.5px] border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30',
                };
            case 'blue':
            default:
                return {
                    pill: 'bg-blue-100 dark:bg-blue-950/60 text-[#0066FF] dark:text-blue-400',
                    border: 'border-l-[3.5px] border-[#0066FF] bg-blue-50/70 dark:bg-blue-950/30',
                };
        }
    };

    return (
        <div className="w-full min-h-screen pb-24 sm:pb-16 bg-[#F8FAFC] dark:bg-[#0F0F12] text-neutral-900 dark:text-white transition-colors duration-200">
            {/* Top Bar / Header */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 pb-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 dark:bg-blue-400/10 text-[#0066FF] dark:text-blue-400 text-xs font-bold uppercase tracking-wider mb-1">
                            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                <path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 4h-2v-2h2v2zm4 0h-2v-2h2v2z" />
                            </svg>
                            <span>Academic Calendar</span>
                            {isSaving && <span className="animate-pulse text-[10px] lowercase">• saving to supabase...</span>}
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900 dark:text-white">
                            Study Timetable
                        </h1>
                        <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                            Synced in real-time with your Supabase cloud account.
                        </p>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                        <button
                            type="button"
                            onClick={() => {
                                setFormDay(selectedDayOfWeek);
                                setIsAddSessionModalOpen(true);
                            }}
                            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-neutral-300 dark:border-white/10 bg-white dark:bg-[#1E1E22] hover:bg-neutral-50 dark:hover:bg-white/10 text-xs sm:text-sm font-bold text-neutral-800 dark:text-neutral-200 transition-all shadow-xs cursor-pointer"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                            <span>Add Class</span>
                        </button>

                        <button
                            type="button"
                            onClick={handleOpenAiPlanner}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0066FF] hover:bg-blue-600 text-white text-xs sm:text-sm font-bold transition-all shadow-sm shadow-blue-500/25 active:scale-95 cursor-pointer"
                        >
                            <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                            </svg>
                            <span>AI Auto-Plan</span>
                        </button>
                    </div>
                </div>

                {/* Mobile view switch tabs */}
                <div className="flex items-center gap-2 mt-4 md:hidden border-b border-neutral-200 dark:border-white/10 pb-2">
                    <button
                        type="button"
                        onClick={() => setActiveTab('schedule')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${
                            activeTab === 'schedule'
                                ? 'bg-neutral-900 text-white dark:bg-white dark:text-black'
                                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                        }`}
                    >
                        Schedule ({filteredSessions.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('activities')}
                        className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${
                            activeTab === 'activities'
                                ? 'bg-neutral-900 text-white dark:bg-white dark:text-black'
                                : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white'
                        }`}
                    >
                        Upcoming Activities ({activities.length})
                    </button>
                </div>
            </div>

            {/* Main Content Layout */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                    {/* LEFT COLUMN: Calendar & Schedule */}
                    <div
                        className={`md:col-span-7 space-y-6 ${
                            activeTab === 'schedule' ? 'block' : 'hidden md:block'
                        }`}
                    >
                        {/* 1. Monthly Calendar Grid */}
                        <div className="rounded-[28px] bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-white/10 shadow-sm p-5 sm:p-6 transition-all">
                            {/* Calendar Header: Month, Year & Arrows */}
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <h2 className="text-lg sm:text-xl font-bold tracking-tight text-neutral-900 dark:text-white">
                                        {MONTH_NAMES[currentMonthIndex]} {currentYear}
                                    </h2>
                                    <button
                                        type="button"
                                        onClick={handleJumpToToday}
                                        className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 transition"
                                    >
                                        Today
                                    </button>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={handlePrevMonth}
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95"
                                        aria-label="Previous month"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleNextMonth}
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10 transition active:scale-95"
                                        aria-label="Next month"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Weekday Labels */}
                            <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 text-center">
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
                                    const isToday =
                                        cell.isCurrentMonth &&
                                        cell.dayNumber === today.getDate() &&
                                        currentMonthIndex === today.getMonth() &&
                                        currentYear === today.getFullYear();

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
                                            ) : isToday ? (
                                                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border-2 border-[#0066FF] text-[#0066FF] dark:text-blue-400 flex items-center justify-center font-bold text-xs sm:text-sm">
                                                    {cell.dayNumber}
                                                </div>
                                            ) : (
                                                <span className="text-xs sm:text-sm">{cell.dayNumber}</span>
                                            )}

                                            {/* Event indicator dot */}
                                            {cell.isCurrentMonth && cell.hasDot && !isSelected && (
                                                <span
                                                    className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${
                                                        cell.hasDot === 'green'
                                                            ? 'bg-emerald-500'
                                                            : cell.hasDot === 'purple'
                                                            ? 'bg-purple-500'
                                                            : 'bg-[#0066FF]'
                                                    }`}
                                                />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 2. Schedule for Selected Day */}
                        <div className="rounded-[28px] bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-white/10 shadow-sm p-5 sm:p-6 transition-all">
                            {/* Section Header */}
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                                        {selectedDayOfWeek}’s Schedule
                                    </h2>
                                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                                        {MONTH_NAMES[currentMonthIndex]} {selectedDate}, {currentYear}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setFormDay(selectedDayOfWeek);
                                            setIsAddSessionModalOpen(true);
                                        }}
                                        className="text-xs font-bold text-[#0066FF] dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
                                    >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                        </svg>
                                        <span>Add</span>
                                    </button>
                                </div>
                            </div>

                            {/* Schedule Cards List */}
                            {isLoading ? (
                                <div className="py-10 text-center text-xs text-neutral-400">
                                    Loading your timetable from Supabase...
                                </div>
                            ) : filteredSessions.length === 0 ? (
                                <div className="py-10 px-4 text-center rounded-2xl border border-dashed border-neutral-200 dark:border-white/10 space-y-3">
                                    <div className="w-10 h-10 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 text-[#0066FF] dark:text-blue-400 flex items-center justify-center">
                                        <svg className="w-5 h-5 fill-none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                                        </svg>
                                    </div>
                                    <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                                        No classes or study sessions for this day.
                                    </p>
                                    <p className="text-xs text-neutral-400 max-w-xs mx-auto">
                                        Add your courses manually or upload your timetable to let AI arrange your study routine.
                                    </p>
                                    <div className="flex items-center justify-center gap-2 pt-2">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setFormDay(selectedDayOfWeek);
                                                setIsAddSessionModalOpen(true);
                                            }}
                                            className="px-3.5 py-1.5 rounded-full border border-neutral-300 dark:border-white/10 text-xs font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-white/5 transition"
                                        >
                                            + Add Class
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleOpenAiPlanner}
                                            className="px-3.5 py-1.5 rounded-full bg-[#0066FF] text-white text-xs font-bold hover:bg-blue-600 transition"
                                        >
                                            ✨ AI Plan
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {filteredSessions.map((session, index) => {
                                        const timeParts = session.time.split('-').map((t) => t.trim());
                                        const timeStart = timeParts[0] || '09:00 AM';
                                        const timeEnd = timeParts[1] || '10:00 AM';
                                        const colorStyle = getPillColorClasses(session.badgeColor);

                                        return (
                                            <div
                                                key={session.id || index}
                                                className={`p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-[#212124] border border-neutral-200/70 dark:border-white/5 shadow-xs flex items-center gap-3 sm:gap-4 transition hover:border-neutral-300 dark:hover:border-white/10 ${
                                                    session.complete ? 'opacity-60' : ''
                                                }`}
                                            >
                                                {/* Left Column: Time Box with vertical border accent */}
                                                <div
                                                    className={`w-24 sm:w-28 py-2 px-2.5 rounded-r-xl ${colorStyle.border} flex flex-col justify-center text-center shrink-0`}
                                                >
                                                    <span className="text-[11px] sm:text-xs font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
                                                        {timeStart}
                                                    </span>
                                                    <span className="text-[10px] sm:text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 leading-tight mt-0.5">
                                                        {timeEnd}
                                                    </span>
                                                </div>

                                                {/* Right Column: Title, Room, Activity */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <h3 className={`text-sm sm:text-[15px] font-bold text-neutral-900 dark:text-white truncate ${session.complete ? 'line-through' : ''}`}>
                                                            {session.topic || session.subject}
                                                        </h3>

                                                        {session.activity && (
                                                            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-bold ${colorStyle.pill}`}>
                                                                {session.activity}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center justify-between mt-1 text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                                                        <span>{session.location || 'Room 101'}</span>

                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleToggleSessionComplete(session.id)}
                                                                className={`text-[11px] font-semibold hover:underline cursor-pointer ${
                                                                    session.complete ? 'text-emerald-500' : 'text-neutral-400'
                                                                }`}
                                                            >
                                                                {session.complete ? '✓ Done' : 'Mark done'}
                                                            </button>

                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteSession(session.id)}
                                                                className="text-neutral-400 hover:text-rose-500 transition p-1"
                                                                title="Delete session"
                                                            >
                                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Upcoming Activities */}
                    <div
                        className={`md:col-span-5 space-y-6 ${
                            activeTab === 'activities' ? 'block' : 'hidden md:block'
                        }`}
                    >
                        <div className="rounded-[28px] bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-white/10 shadow-sm p-5 sm:p-6 transition-all">
                            {/* Upcoming Activities Header */}
                            <div className="flex items-center justify-between mb-5">
                                <div>
                                    <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-white">
                                        Upcoming Activities
                                    </h2>
                                    <p className="text-xs text-neutral-400 dark:text-neutral-500">
                                        Exams, assignments & milestones
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsAddActivityModalOpen(true)}
                                    className="text-xs font-bold text-[#0066FF] dark:text-blue-400 hover:underline cursor-pointer flex items-center gap-1"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                    </svg>
                                    <span>Add</span>
                                </button>
                            </div>

                            {/* Upcoming Activities List */}
                            {activities.length === 0 ? (
                                <div className="py-8 px-4 text-center rounded-2xl border border-dashed border-neutral-200 dark:border-white/10 space-y-2">
                                    <p className="text-xs font-medium text-neutral-500">
                                        No upcoming exams or activities added yet.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setIsAddActivityModalOpen(true)}
                                        className="text-xs font-bold text-[#0066FF] hover:underline"
                                    >
                                        + Schedule an Exam or Quiz
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {activities.map((item) => {
                                        const colorStyle = getPillColorClasses(item.badgeColor);

                                        return (
                                            <div
                                                key={item.id}
                                                className="flex items-center gap-3.5 sm:gap-4 p-2.5 rounded-2xl hover:bg-neutral-50 dark:hover:bg-white/5 transition group"
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
                                                    <div className="flex items-center justify-between gap-1">
                                                        <h3 className="text-sm sm:text-[15px] font-bold text-neutral-900 dark:text-white leading-snug truncate">
                                                            {item.title}
                                                        </h3>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteActivity(item.id)}
                                                            className="text-neutral-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition p-1"
                                                            title="Delete activity"
                                                        >
                                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                            </svg>
                                                        </button>
                                                    </div>
                                                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1 font-medium truncate">
                                                        {item.meta}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

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
                                            Automate with AI Scheduler
                                        </h4>
                                        <p className="text-[11px] sm:text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                                            Upload your faculty timetable screenshot or syllabus to automatically sync all your classes into Supabase.
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

            {/* MODAL 1: Add Session Modal */}
            {isAddSessionModalOpen && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
                    <div className="w-full max-w-md bg-white dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-white/10 pb-3">
                            <h3 className="text-lg font-bold text-neutral-900 dark:text-white">
                                Add Class / Study Session
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsAddSessionModalOpen(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveNewSession} className="space-y-3.5 text-xs">
                            <div>
                                <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                    Subject / Course Code
                                </label>
                                <input
                                    type="text"
                                    value={formSubject}
                                    onChange={(e) => setFormSubject(e.target.value)}
                                    placeholder="e.g. PHY101 or Physics"
                                    required
                                    className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                />
                            </div>

                            <div>
                                <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                    Topic / Class Title
                                </label>
                                <input
                                    type="text"
                                    value={formTopic}
                                    onChange={(e) => setFormTopic(e.target.value)}
                                    placeholder="e.g. Classical Mechanics Lecture"
                                    className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        Day of the Week
                                    </label>
                                    <select
                                        value={formDay}
                                        onChange={(e) => setFormDay(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    >
                                        {FULL_WEEKDAYS.map((d) => (
                                            <option key={d} value={d} className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">
                                                {d}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        Activity Type
                                    </label>
                                    <select
                                        value={formActivity}
                                        onChange={(e) => setFormActivity(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    >
                                        <option value="Lecture" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Lecture</option>
                                        <option value="Lab" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Lab Session</option>
                                        <option value="Study" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Self Study</option>
                                        <option value="Tutorial" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Live Tutorial</option>
                                        <option value="Revision" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Revision</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        Start Time
                                    </label>
                                    <input
                                        type="text"
                                        value={formStartTime}
                                        onChange={(e) => setFormStartTime(e.target.value)}
                                        placeholder="09:00 AM"
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        End Time
                                    </label>
                                    <input
                                        type="text"
                                        value={formEndTime}
                                        onChange={(e) => setFormEndTime(e.target.value)}
                                        placeholder="10:00 AM"
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        Location / Venue
                                    </label>
                                    <input
                                        type="text"
                                        value={formLocation}
                                        onChange={(e) => setFormLocation(e.target.value)}
                                        placeholder="Room 101 or Virtual"
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        Color Accent
                                    </label>
                                    <select
                                        value={formColor}
                                        onChange={(e: any) => setFormColor(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    >
                                        <option value="blue" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Blue</option>
                                        <option value="purple" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Purple</option>
                                        <option value="amber" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Amber</option>
                                        <option value="green" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Green</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsAddSessionModalOpen(false)}
                                    className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-400 font-semibold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 rounded-xl bg-[#0066FF] hover:bg-blue-600 text-white font-bold transition shadow-xs"
                                >
                                    Save Session
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* MODAL 2: Add Activity Modal */}
            {isAddActivityModalOpen && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
                    <div className="w-full max-w-md bg-white dark:bg-[#1C1C1E] border border-neutral-200 dark:border-white/10 rounded-3xl p-6 shadow-2xl space-y-4">
                        <div className="flex items-center justify-between border-b border-neutral-100 dark:border-white/10 pb-3">
                            <h3 className="text-lg font-bold text-neutral-900 dark:text-white">
                                Add Upcoming Activity / Exam
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsAddActivityModalOpen(false)}
                                className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-white"
                            >
                                ✕
                            </button>
                        </div>

                        <form onSubmit={handleSaveNewActivity} className="space-y-3.5 text-xs">
                            <div>
                                <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                    Activity Title
                                </label>
                                <input
                                    type="text"
                                    value={formActTitle}
                                    onChange={(e) => setFormActTitle(e.target.value)}
                                    placeholder="e.g. Chemistry Midterm Exam or Final Quiz"
                                    required
                                    className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        Date
                                    </label>
                                    <input
                                        type="date"
                                        value={formActDate}
                                        onChange={(e) => setFormActDate(e.target.value)}
                                        required
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    />
                                </div>
                                <div>
                                    <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                        Color Badge
                                    </label>
                                    <select
                                        value={formActColor}
                                        onChange={(e: any) => setFormActColor(e.target.value)}
                                        className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                    >
                                        <option value="purple" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Purple</option>
                                        <option value="blue" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Blue</option>
                                        <option value="amber" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Amber</option>
                                        <option value="green" className="bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white">Green</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block font-bold text-neutral-700 dark:text-neutral-300 mb-1">
                                    Time & Location (Meta)
                                </label>
                                <input
                                    type="text"
                                    value={formActMeta}
                                    onChange={(e) => setFormActMeta(e.target.value)}
                                    placeholder="e.g. 10:00 AM - 12:00 PM • Lecture Theater 1"
                                    className="w-full px-3 py-2 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white focus:outline-none focus:border-[#0066FF]"
                                />
                            </div>

                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-100 dark:border-white/10">
                                <button
                                    type="button"
                                    onClick={() => setIsAddActivityModalOpen(false)}
                                    className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-400 font-semibold"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-5 py-2 rounded-xl bg-[#0066FF] hover:bg-blue-600 text-white font-bold transition shadow-xs"
                                >
                                    Save Activity
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
