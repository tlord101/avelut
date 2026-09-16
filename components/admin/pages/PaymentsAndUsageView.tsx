import React, { useState, useEffect, useMemo } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { supabase } from '../../../lib/supabaseClient';
import type { UserProfile } from '../../../types';
import { AdminTableSkeleton } from '../../Skeleton';

interface PaymentsAndUsageViewProps {
    paymentLogs: any[];
    aiRequestLogs: any[];
    allUsersList: UserProfile[];
    isLoading?: boolean;
}

export const PaymentsAndUsageView: React.FC<PaymentsAndUsageViewProps> = ({ paymentLogs, aiRequestLogs: propsAiLogs, allUsersList, isLoading }) => {
    const [activeTab, setActiveTab] = useState<'payments' | 'usage'>('payments');
    const [searchQuery, setSearchQuery] = useState('');
    const [supaUsageLogs, setSupaUsageLogs] = useState<any[]>([]);

    useEffect(() => {
        const fetchSupabaseUsage = async () => {
            try {
                const { data } = await supabase.from('usage_records').select('*').limit(5000);
                if (Array.isArray(data)) {
                    setSupaUsageLogs(data.map(r => ({
                        timestamp: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
                        feature: r.feature,
                        model: r.model || 'qwen3.7-flash',
                        use_personal_token: false,
                    })));
                }
            } catch (err) {
                console.warn('[PaymentsAndUsageView] Supabase usage fetch warning:', err);
            }
        };
        void fetchSupabaseUsage();
    }, []);

    const aiRequestLogs = useMemo(() => {
        return [...(propsAiLogs || []), ...supaUsageLogs];
    }, [propsAiLogs, supaUsageLogs]);

    const filteredPayments = paymentLogs.filter(log => {
        const query = searchQuery.toLowerCase();
        return (
            (log.reference || log.id || '').toLowerCase().includes(query) ||
            (log.user_email || log.email || '').toLowerCase().includes(query) ||
            (log.user_name || log.metadata?.user_name || '').toLowerCase().includes(query)
        );
    });

    const totalRevenue = paymentLogs.reduce((acc, log) => {
        const isSuccess = log.status === 'success' || log.status === 'successful';
        return isSuccess ? acc + (Number(log.amount) || 0) : acc;
    }, 0);

    // AI Query Volume Data (Area Chart)
    const queryVolumeData = useMemo(() => {
        const last30Days = Array.from({ length: 30 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (29 - i));
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        });

        const dataMap: Record<string, number> = {};
        last30Days.forEach(date => dataMap[date] = 0);

        aiRequestLogs.forEach(log => {
            if (!log.timestamp) return;
            const dateStr = new Date(log.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            if (dataMap[dateStr] !== undefined) {
                dataMap[dateStr] += 1;
            }
        });

        return last30Days.map(date => ({
            date,
            queries: dataMap[date]
        }));
    }, [aiRequestLogs]);

    // Personal vs Platform Token Data (Pie Chart)
    const tokenTypeData = useMemo(() => {
        let personalCount = 0;
        let platformCount = 0;
        aiRequestLogs.forEach(log => {
            if (log.use_personal_token) personalCount++;
            else platformCount++;
        });
        
        return [
            { name: 'Platform API Key', value: platformCount, color: '#f59e0b' }, // Amber
            { name: 'User Personal Key', value: personalCount, color: '#64748b' } // Slate
        ];
    }, [aiRequestLogs]);

    // Model Usage Breakdown (Bar Chart)
    const modelUsageData = useMemo(() => {
        const modelCounts: Record<string, number> = {};
        aiRequestLogs.forEach(log => {
            const modelName = log.model || 'Unknown Model';
            modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;
        });

        return Object.keys(modelCounts).map(model => ({
            name: model,
            count: modelCounts[model]
        })).sort((a, b) => b.count - a.count);
    }, [aiRequestLogs]);

    return (
        <div className="space-y-6 text-slate-900 dark:text-slate-100">
            {/* Header Tabs */}
            <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800">
                <button 
                    onClick={() => setActiveTab('payments')}
                    className={`pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${activeTab === 'payments' ? 'border-amber-500 text-slate-900 dark:text-white font-black' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                    <i className="bi bi-credit-card-fill"></i>
                    <span>Financial Logs</span>
                </button>
                <button 
                    onClick={() => setActiveTab('usage')}
                    className={`pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${activeTab === 'usage' ? 'border-amber-500 text-slate-900 dark:text-white font-black' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                    <i className="bi bi-activity"></i>
                    <span>System Usage Analytics</span>
                </button>
            </div>

            {activeTab === 'payments' && (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">Total Revenue</p>
                            <h3 className="text-4xl font-black text-amber-500">₦{totalRevenue.toLocaleString()}</h3>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">Total Transactions</p>
                            <h3 className="text-4xl font-black text-slate-900 dark:text-white">{paymentLogs.length}</h3>
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
                            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">Premium Users</p>
                            <h3 className="text-4xl font-black text-slate-900 dark:text-white">{allUsersList.filter(u => u.subscription_status === 'premium').length}</h3>
                        </div>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <h3 className="font-black text-lg text-slate-900 dark:text-white">Transaction History</h3>
                            <div className="flex gap-3">
                                <div className="relative">
                                    <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                                    <input 
                                        type="text" 
                                        placeholder="Search reference or email..." 
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-amber-500"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                                    <tr>
                                        <th className="px-6 py-4">Reference</th>
                                        <th className="px-6 py-4">Student</th>
                                        <th className="px-6 py-4">Item / Pack</th>
                                        <th className="px-6 py-4">Amount</th>
                                        <th className="px-6 py-4">Status</th>
                                        <th className="px-6 py-4 text-right">Date & Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                                    {isLoading ? (
                                        <AdminTableSkeleton />
                                    ) : filteredPayments.map((log, i) => {
                                        const itemName = log.purchase_type === 'subscription'
                                            ? `${(log.plan_key || log.tier_id || 'Subscription').toUpperCase()} Plan`
                                            : `${log.credit_amount || log.amount || ''} Extra Credits`;
                                        const isSuccess = (!log.status || log.status === 'success' || log.status === 'successful');
                                        const isPending = log.status === 'initiated' || log.status === 'pending';

                                        return (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                                                <td className="px-6 py-4 font-mono text-xs text-slate-500 dark:text-slate-400 select-all">
                                                    {log.reference || log.id || '—'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="font-bold text-slate-900 dark:text-white leading-tight">
                                                        {log.user_name || log.metadata?.user_name || 'Student'}
                                                    </div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                                        {log.user_email || log.email || '—'}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                        {itemName}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                                                    ₦{(Number(log.amount) || 0).toLocaleString()}
                                                </td>
                                                <td className="px-6 py-4">
                                                    {isSuccess ? (
                                                        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 rounded-md text-[10px] font-black uppercase w-max border border-emerald-200 dark:border-emerald-900/40">
                                                            <i className="bi bi-check-circle-fill"></i> Success
                                                        </span>
                                                    ) : isPending ? (
                                                        <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1 rounded-md text-[10px] font-black uppercase w-max border border-amber-200 dark:border-amber-900/40">
                                                            <i className="bi bi-clock-fill"></i> Pending
                                                        </span>
                                                    ) : (
                                                        <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 px-2.5 py-1 rounded-md text-[10px] font-black uppercase w-max border border-rose-200 dark:border-rose-900/40">
                                                            <i className="bi bi-x-circle-fill"></i> Failed
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 text-right text-slate-500 dark:text-slate-400 font-medium text-xs">
                                                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {filteredPayments.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-12 text-center text-slate-500 font-bold">
                                                No transactions recorded.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'usage' && (
                <div className="space-y-6">
                    {/* Top Row: AI Volume */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm min-h-[350px] flex flex-col">
                        <h3 className="font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                            <i className="bi bi-cpu text-amber-500"></i>
                            <span>AI Query Volume (Last 30 Days)</span>
                        </h3>
                        <div className="flex-grow w-full h-full min-h-[250px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={queryVolumeData}>
                                    <defs>
                                        <linearGradient id="colorQueries" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} dx={-10} />
                                    <Tooltip 
                                        contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc' }}
                                        formatter={(value: number) => [value, 'Total AI Queries']}
                                    />
                                    <Area type="monotone" dataKey="queries" stroke="#f59e0b" fillOpacity={1} fill="url(#colorQueries)" strokeWidth={3} activeDot={{ r: 6 }} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {/* Bottom Row: Pies and Bars */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Token Type Distribution */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm min-h-[350px] flex flex-col">
                            <h3 className="font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <i className="bi bi-key-fill text-amber-500"></i>
                                <span>Token Authorization Source</span>
                            </h3>
                            <div className="flex-grow w-full h-full min-h-[250px] flex items-center justify-center">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={tokenTypeData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={90}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {tokenTypeData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc' }}
                                            formatter={(value: number) => [value, 'Requests']}
                                        />
                                        <Legend verticalAlign="bottom" height={36} iconType="circle" />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Model Usage */}
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm min-h-[350px] flex flex-col">
                            <h3 className="font-bold text-slate-900 dark:text-white mb-6 flex items-center gap-2">
                                <i className="bi bi-hdd-network-fill text-amber-500"></i>
                                <span>API Model Traffic</span>
                            </h3>
                            <div className="flex-grow w-full h-full min-h-[250px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={modelUsageData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" opacity={0.2} />
                                        <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                                        <YAxis dataKey="name" type="category" width={100} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc' }}
                                            formatter={(value: number) => [value, 'Queries']}
                                            cursor={{fill: 'rgba(255,255,255,0.05)'}}
                                        />
                                        <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={24} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
