import React, { useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { UserProfile } from '../../../types';
import type { AdminTab } from '../AdminLayout';
import { AdminStatCardSkeleton, PageSkeleton } from '../../Skeleton';

interface DashboardViewProps {
    paymentLogs: any[];
    aiRequestLogs: any[];
    allUsersList: UserProfile[];
    onNavigate: (tab: AdminTab) => void;
    isLoading?: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
    paymentLogs, aiRequestLogs, allUsersList, onNavigate, isLoading
}) => {
    const premiumUsersCount = allUsersList.filter(u => u.subscription_status === 'premium').length;

    // Process data for Revenue Chart
    const revenueData = useMemo(() => {
        const last30Days = Array.from({ length: 30 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (29 - i));
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        const dataMap: Record<string, number> = {};
        last30Days.forEach(date => dataMap[date] = 0);

        paymentLogs.forEach(log => {
            if (!log.timestamp) return;
            const dateStr = new Date(log.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (dataMap[dateStr] !== undefined) {
                dataMap[dateStr] += Number(log.amount) || 0;
            }
        });

        return last30Days.map(date => ({
            date,
            revenue: dataMap[date]
        }));
    }, [paymentLogs]);

    // Process data for User Growth Chart
    const userGrowthData = useMemo(() => {
        const last30Days = Array.from({ length: 30 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (29 - i));
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        const dataMap: Record<string, number> = {};
        last30Days.forEach(date => dataMap[date] = 0);

        allUsersList.forEach(user => {
            const timestamp = (user as any).created_at || user.last_activity_date || 0;
            if (!timestamp) return;
            const dateStr = new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (dataMap[dateStr] !== undefined) {
                dataMap[dateStr] += 1;
            }
        });

        return last30Days.map(date => ({
            date,
            users: dataMap[date]
        }));
    }, [allUsersList]);

    const cards = [
        {
            title: 'Total Payments',
            value: paymentLogs.length,
            iconClass: 'bi bi-credit-card-fill',
            tab: 'payments' as AdminTab
        },
        {
            title: 'AI Queries',
            value: aiRequestLogs.length,
            iconClass: 'bi bi-stars',
            tab: 'usage-analytics' as AdminTab
        },
        {
            title: 'Registered Users',
            value: allUsersList.length,
            iconClass: 'bi bi-people-fill',
            tab: 'users' as AdminTab
        },
        {
            title: 'Premium Subs',
            value: premiumUsersCount,
            iconClass: 'bi bi-award-fill',
            tab: 'users' as AdminTab
        }
    ];

    return (
        <div className="space-y-6 text-slate-900 dark:text-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {isLoading ? (
                    Array.from({ length: 4 }).map((_, i) => <AdminStatCardSkeleton key={i} />)
                ) : cards.map((card, idx) => (
                    <div key={idx} className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group hover:border-amber-500/50 transition-all duration-300">
                        <div className="flex items-center justify-between relative z-10">
                            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
                                <i className={`${card.iconClass} text-xl`}></i>
                            </div>
                            <button 
                                onClick={() => onNavigate(card.tab)}
                                className="w-8 h-8 rounded-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-400 hover:text-amber-500 hover:border-amber-500/50 transition-colors cursor-pointer"
                            >
                                <i className="bi bi-arrow-up-right text-xs"></i>
                            </button>
                        </div>
                        
                        <div className="mt-6 relative z-10">
                            <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{card.value}</h3>
                            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-1">{card.title}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm min-h-[350px] flex flex-col">
                    {isLoading ? <PageSkeleton /> : (
                        <>
                    <h3 className="font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                        <i className="bi bi-graph-up text-amber-500"></i>
                        <span>Revenue (Last 30 Days)</span>
                    </h3>
                    <div className="flex-grow w-full h-full min-h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={revenueData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dx={-10} tickFormatter={(val) => `₦${val}`} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc' }}
                                    formatter={(value: number) => [`₦${value.toLocaleString()}`, 'Revenue']}
                                />
                                <Line type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b', strokeWidth: 2, stroke: '#0f172a' }} activeDot={{ r: 6 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    </>)}
                </div>
                
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm min-h-[350px] flex flex-col">
                    {isLoading ? <PageSkeleton /> : (
                        <>
                    <h3 className="font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                        <i className="bi bi-people-fill text-amber-500"></i>
                        <span>User Signups (Last 30 Days)</span>
                    </h3>
                    <div className="flex-grow w-full h-full min-h-[250px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={userGrowthData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dx={-10} />
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc' }}
                                    formatter={(value: number) => [value, 'New Users']}
                                />
                                <Bar dataKey="users" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    </>)}
                </div>
            </div>
        </div>
    );
};
