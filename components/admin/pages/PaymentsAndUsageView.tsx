import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { supabase } from '../../../lib/supabaseClient';
import type { UserProfile } from '../../../types';
import { AdminTableSkeleton } from '../../Skeleton';

interface PaymentsAndUsageViewProps {
  paymentLogs: any[];
  aiRequestLogs: any[];
  allUsersList: UserProfile[];
  isLoading?: boolean;
}

export interface NormalizedUsageRow {
  id: string;
  timestamp: number;
  user_id: string;
  feature: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  credits_spent: number;
  provider?: string;
  metadata?: Record<string, unknown>;
  use_personal_token?: boolean;
}

const CHART_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#64748b'];

function normalizeUsageRow(r: any): NormalizedUsageRow {
  const prompt = Number(r.prompt_tokens ?? r.promptTokens ?? 0) || 0;
  const completion = Number(r.completion_tokens ?? r.completionTokens ?? 0) || 0;
  const metaTotal =
    typeof r.metadata === 'object' && r.metadata
      ? Number((r.metadata as any).total_tokens) || 0
      : 0;
  const total =
    Number(r.total_tokens ?? 0) ||
    metaTotal ||
    (prompt + completion) ||
    0;
  return {
    id: String(r.id || `${r.user_id || 'u'}_${r.created_at || r.timestamp || Date.now()}`),
    timestamp: r.created_at
      ? new Date(r.created_at).getTime()
      : Number(r.timestamp) || Date.now(),
    user_id: r.user_id || r.uid || '',
    feature: r.feature || 'unknown',
    model: r.model || 'unknown',
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    credits_spent: Number(r.credits_spent ?? r.cost ?? 0) || 0,
    provider: r.provider || undefined,
    metadata: typeof r.metadata === 'object' ? r.metadata : undefined,
    use_personal_token: !!r.use_personal_token,
  };
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

export const PaymentsAndUsageView: React.FC<PaymentsAndUsageViewProps> = ({
  paymentLogs,
  aiRequestLogs: propsAiLogs,
  allUsersList,
  isLoading,
}) => {
  const [activeTab, setActiveTab] = useState<'payments' | 'usage'>('payments');
  const [searchQuery, setSearchQuery] = useState('');
  const [usageSearch, setUsageSearch] = useState('');
  const [featureFilter, setFeatureFilter] = useState<string>('all');
  const [rangeDays, setRangeDays] = useState<7 | 30 | 90>(30);
  const [supaUsageLogs, setSupaUsageLogs] = useState<NormalizedUsageRow[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const userLabel = useCallback(
    (uid: string) => {
      const u = allUsersList.find((x) => x.uid === uid || (x as any).id === uid);
      if (!u) return uid ? uid.slice(0, 8) + '…' : '—';
      return u.display_name || u.email || uid.slice(0, 8) + '…';
    },
    [allUsersList]
  );

  const fetchSupabaseUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const since = new Date();
      since.setDate(since.getDate() - rangeDays);
      const { data, error } = await supabase
        .from('usage_records')
        .select('*')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(8000);

      if (error) {
        console.warn('[PaymentsAndUsageView] usage_records fetch:', error.message || error);
      }
      if (Array.isArray(data)) {
        setSupaUsageLogs(data.map(normalizeUsageRow));
      } else {
        setSupaUsageLogs([]);
      }
      setLastFetchedAt(Date.now());
    } catch (err) {
      console.warn('[PaymentsAndUsageView] Supabase usage fetch warning:', err);
    } finally {
      setUsageLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => {
    void fetchSupabaseUsage();
  }, [fetchSupabaseUsage]);

  // Merge legacy Firebase-style logs with Supabase rows
  const allUsage: NormalizedUsageRow[] = useMemo(() => {
    const fromProps = (propsAiLogs || []).map(normalizeUsageRow);
    const map = new Map<string, NormalizedUsageRow>();
    for (const row of [...fromProps, ...supaUsageLogs]) {
      map.set(row.id, row);
    }
    return Array.from(map.values()).sort((a, b) => b.timestamp - a.timestamp);
  }, [propsAiLogs, supaUsageLogs]);

  const filteredUsage = useMemo(() => {
    const q = usageSearch.toLowerCase().trim();
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    return allUsage.filter((log) => {
      if (log.timestamp < cutoff) return false;
      if (featureFilter !== 'all') {
        const f = (log.feature || '').toLowerCase();
        if (featureFilter === 'live') {
          if (!f.includes('live_tutorial') && !f.includes('live_classroom')) return false;
        } else if (featureFilter === 'chat') {
          if (!f.includes('chat') && !f.includes('tutor') && f !== 'ai chat assistant') return false;
        } else if (!f.includes(featureFilter)) {
          return false;
        }
      }
      if (!q) return true;
      const name = userLabel(log.user_id).toLowerCase();
      return (
        name.includes(q) ||
        log.user_id.toLowerCase().includes(q) ||
        (log.feature || '').toLowerCase().includes(q) ||
        (log.model || '').toLowerCase().includes(q)
      );
    });
  }, [allUsage, usageSearch, featureFilter, rangeDays, userLabel]);

  const kpis = useMemo(() => {
    let tokens = 0;
    let credits = 0;
    let prompt = 0;
    let completion = 0;
    const users = new Set<string>();
    for (const log of filteredUsage) {
      tokens += log.total_tokens;
      credits += log.credits_spent;
      prompt += log.prompt_tokens;
      completion += log.completion_tokens;
      if (log.user_id) users.add(log.user_id);
    }
    return {
      requests: filteredUsage.length,
      tokens,
      credits,
      prompt,
      completion,
      uniqueUsers: users.size,
    };
  }, [filteredUsage]);

  // Daily token + request volume
  const volumeData = useMemo(() => {
    const days = Array.from({ length: rangeDays }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (rangeDays - 1 - i));
      d.setHours(0, 0, 0, 0);
      return d;
    });
    const key = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const map: Record<string, { date: string; requests: number; tokens: number; credits: number }> = {};
    days.forEach((d) => {
      map[key(d)] = { date: key(d), requests: 0, tokens: 0, credits: 0 };
    });
    filteredUsage.forEach((log) => {
      const dateStr = new Date(log.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      if (map[dateStr]) {
        map[dateStr].requests += 1;
        map[dateStr].tokens += log.total_tokens;
        map[dateStr].credits += log.credits_spent;
      }
    });
    return days.map((d) => map[key(d)]);
  }, [filteredUsage, rangeDays]);

  // Feature breakdown
  const featureData = useMemo(() => {
    const map: Record<string, { name: string; requests: number; tokens: number; credits: number }> = {};
    filteredUsage.forEach((log) => {
      const name = log.feature || 'unknown';
      if (!map[name]) map[name] = { name, requests: 0, tokens: 0, credits: 0 };
      map[name].requests += 1;
      map[name].tokens += log.total_tokens;
      map[name].credits += log.credits_spent;
    });
    return Object.values(map).sort((a, b) => b.tokens - a.tokens || b.requests - a.requests);
  }, [filteredUsage]);

  // Top users by tokens
  const topUsers = useMemo(() => {
    const map: Record<string, { user_id: string; requests: number; tokens: number; credits: number }> = {};
    filteredUsage.forEach((log) => {
      const id = log.user_id || 'unknown';
      if (!map[id]) map[id] = { user_id: id, requests: 0, tokens: 0, credits: 0 };
      map[id].requests += 1;
      map[id].tokens += log.total_tokens;
      map[id].credits += log.credits_spent;
    });
    return Object.values(map)
      .sort((a, b) => b.tokens - a.tokens || b.requests - a.requests)
      .slice(0, 15);
  }, [filteredUsage]);

  const modelUsageData = useMemo(() => {
    const modelCounts: Record<string, number> = {};
    filteredUsage.forEach((log) => {
      const modelName = log.model || 'Unknown';
      modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;
    });
    return Object.keys(modelCounts)
      .map((model) => ({ name: model, count: modelCounts[model] }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [filteredUsage]);

  const tokenTypeData = useMemo(() => {
    let personalCount = 0;
    let platformCount = 0;
    filteredUsage.forEach((log) => {
      if (log.use_personal_token) personalCount++;
      else platformCount++;
    });
    return [
      { name: 'Platform API Key', value: platformCount, color: '#f59e0b' },
      { name: 'User Personal Key', value: personalCount, color: '#64748b' },
    ];
  }, [filteredUsage]);

  // —— Payments (unchanged logic) ——
  const filteredPayments = paymentLogs.filter((log) => {
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

  return (
    <div className="space-y-6 text-slate-900 dark:text-slate-100">
      <div className="flex gap-4 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setActiveTab('payments')}
          className={`pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'payments'
              ? 'border-amber-500 text-slate-900 dark:text-white font-black'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <i className="bi bi-credit-card-fill"></i>
          <span>Financial Logs</span>
        </button>
        <button
          onClick={() => setActiveTab('usage')}
          className={`pb-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer ${
            activeTab === 'usage'
              ? 'border-amber-500 text-slate-900 dark:text-white font-black'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
          }`}
        >
          <i className="bi bi-activity"></i>
          <span>Usage Metrics</span>
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
              <p className="text-slate-400 text-xs font-black uppercase tracking-widest mb-1">Success rate</p>
              <h3 className="text-4xl font-black text-emerald-500">
                {paymentLogs.length
                  ? Math.round(
                      (100 *
                        paymentLogs.filter(
                          (l) => l.status === 'success' || l.status === 'successful' || !l.status
                        ).length) /
                        paymentLogs.length
                    )
                  : 0}
                %
              </h3>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-black text-lg text-slate-900 dark:text-white">Transaction History</h3>
              <div className="relative">
                <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="Search reference or email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-amber-500"
                />
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
                  ) : filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                        No payment logs found.
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((log, i) => {
                      const itemName =
                        log.purchase_type === 'subscription'
                          ? `${(log.plan_key || log.tier_id || 'Subscription').toUpperCase()} Plan`
                          : `${log.credit_amount || log.amount || ''} Extra Credits`;
                      const isSuccess =
                        !log.status || log.status === 'success' || log.status === 'successful';
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
                          <td className="px-6 py-4 font-bold">₦{Number(log.amount || 0).toLocaleString()}</td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                                isSuccess
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                  : isPending
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              }`}
                            >
                              {log.status || 'success'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right text-xs text-slate-500">
                            {log.created_at || log.timestamp
                              ? new Date(log.created_at || log.timestamp).toLocaleString()
                              : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'usage' && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex flex-wrap gap-2">
              {([7, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRangeDays(d)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition ${
                    rangeDays === d
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400'
                  }`}
                >
                  {d}d
                </button>
              ))}
              {(['all', 'chat', 'live', 'flashcard', 'quiz', 'study'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFeatureFilter(f)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition capitalize ${
                    featureFilter === f
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                <input
                  type="text"
                  placeholder="User, feature, model…"
                  value={usageSearch}
                  onChange={(e) => setUsageSearch(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-sm outline-none focus:border-amber-500 w-48"
                />
              </div>
              <button
                type="button"
                onClick={() => void fetchSupabaseUsage()}
                disabled={usageLoading}
                className="px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-amber-400 disabled:opacity-50"
              >
                {usageLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              {lastFetchedAt && (
                <span className="text-[10px] text-slate-400 font-mono">
                  {new Date(lastFetchedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Requests', value: formatNum(kpis.requests), sub: String(kpis.requests) },
              { label: 'Total tokens', value: formatNum(kpis.tokens), sub: kpis.tokens.toLocaleString() },
              { label: 'Prompt tokens', value: formatNum(kpis.prompt), sub: kpis.prompt.toLocaleString() },
              { label: 'Completion', value: formatNum(kpis.completion), sub: kpis.completion.toLocaleString() },
              { label: 'Credits spent', value: formatNum(kpis.credits), sub: kpis.credits.toLocaleString() },
              { label: 'Active users', value: formatNum(kpis.uniqueUsers), sub: String(kpis.uniqueUsers) },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm"
                title={card.sub}
              >
                <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">{card.label}</p>
                <h3 className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">{card.value}</h3>
              </div>
            ))}
          </div>

          {/* Volume charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm min-h-[320px]">
              <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <i className="bi bi-graph-up text-amber-500"></i>
                Token volume ({rangeDays}d)
              </h3>
              <div className="w-full h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={volumeData}>
                    <defs>
                      <linearGradient id="tokGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderRadius: 12,
                        border: '1px solid #334155',
                        color: '#f8fafc',
                      }}
                    />
                    <Area type="monotone" dataKey="tokens" stroke="#f59e0b" fill="url(#tokGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm min-h-[320px]">
              <h3 className="font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <i className="bi bi-bar-chart-fill text-blue-500"></i>
                Requests / credits ({rangeDays}d)
              </h3>
              <div className="w-full h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderRadius: 12,
                        border: '1px solid #334155',
                        color: '#f8fafc',
                      }}
                    />
                    <Bar dataKey="requests" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Requests" />
                    <Bar dataKey="credits" fill="#10b981" radius={[4, 4, 0, 0]} name="Credits" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Feature breakdown */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm lg:col-span-2">
              <h3 className="font-bold text-slate-900 dark:text-white mb-4">By feature</h3>
              <div className="overflow-x-auto max-h-[360px]">
                <table className="w-full text-sm">
                  <thead className="text-[10px] font-black uppercase tracking-widest text-slate-500 sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      <th className="text-left py-2 pr-2">Feature</th>
                      <th className="text-right py-2 px-2">Requests</th>
                      <th className="text-right py-2 px-2">Tokens</th>
                      <th className="text-right py-2 pl-2">Credits</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {featureData.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-slate-500">
                          No usage in this range. Ensure admin RLS can read usage_records.
                        </td>
                      </tr>
                    ) : (
                      featureData.map((row, i) => (
                        <tr key={row.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 pr-2 font-medium flex items-center gap-2">
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                            />
                            {row.name}
                          </td>
                          <td className="py-2.5 px-2 text-right tabular-nums">{row.requests.toLocaleString()}</td>
                          <td className="py-2.5 px-2 text-right tabular-nums font-semibold">
                            {row.tokens.toLocaleString()}
                          </td>
                          <td className="py-2.5 pl-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                            {row.credits.toLocaleString()}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Model + pie */}
            <div className="space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                <h3 className="font-bold text-slate-900 dark:text-white mb-3 text-sm">Models</h3>
                <div className="w-full h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={modelUsageData} layout="vertical" margin={{ left: 8, right: 8 }}>
                      <XAxis type="number" hide />
                      <YAxis
                        dataKey="name"
                        type="category"
                        width={90}
                        tick={{ fontSize: 9, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderRadius: 12,
                          border: '1px solid #334155',
                          color: '#f8fafc',
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={14} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
                <h3 className="font-bold text-slate-900 dark:text-white mb-3 text-sm">Key source</h3>
                <div className="w-full h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={tokenTypeData} dataKey="value" nameKey="name" innerRadius={36} outerRadius={56} paddingAngle={3}>
                        {tokenTypeData.map((entry, index) => (
                          <Cell key={index} fill={entry.color} />
                        ))}
                      </Pie>
                      <Legend verticalAlign="bottom" height={28} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>

          {/* Top users */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4">Top users by tokens</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] font-black uppercase tracking-widest text-slate-500 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="text-left py-2">#</th>
                    <th className="text-left py-2">User</th>
                    <th className="text-right py-2">Requests</th>
                    <th className="text-right py-2">Tokens</th>
                    <th className="text-right py-2">Credits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {topUsers.map((u, i) => (
                    <tr key={u.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 text-slate-400">{i + 1}</td>
                      <td className="py-2.5 font-medium">
                        <div>{userLabel(u.user_id)}</div>
                        <div className="text-[10px] font-mono text-slate-400">{u.user_id}</div>
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{u.requests.toLocaleString()}</td>
                      <td className="py-2.5 text-right tabular-nums font-semibold">{u.tokens.toLocaleString()}</td>
                      <td className="py-2.5 text-right tabular-nums text-amber-600 dark:text-amber-400">
                        {u.credits.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {topUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No per-user data yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent rows */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-black text-slate-900 dark:text-white">Recent usage records</h3>
              <span className="text-xs text-slate-400">{filteredUsage.length} rows</span>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-[10px] font-black uppercase tracking-widest text-slate-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Feature</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3 text-right">Prompt</th>
                    <th className="px-4 py-3 text-right">Completion</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Credits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {usageLoading && filteredUsage.length === 0 ? (
                    <AdminTableSkeleton />
                  ) : filteredUsage.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                        No records. Run a chat or live session, then refresh. Admins need SELECT on
                        usage_records (see migration).
                      </td>
                    </tr>
                  ) : (
                    filteredUsage.slice(0, 200).map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-xs">{userLabel(log.user_id)}</div>
                        </td>
                        <td className="px-4 py-2.5 text-xs">{log.feature}</td>
                        <td className="px-4 py-2.5 text-xs font-mono text-slate-500 max-w-[120px] truncate">
                          {log.model}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs">{log.prompt_tokens}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs">{log.completion_tokens}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs font-semibold">
                          {log.total_tokens}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-amber-600 dark:text-amber-400">
                          {log.credits_spent}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
