import React, { useEffect, useState, useRef } from 'react';
import { Database, Play, AlertTriangle, CheckCircle2, XCircle, RefreshCw, Eye } from 'lucide-react';
import { getMigrationStatus, executeMigrations, MigrationFile, AppliedMigration, ensureMigrationTable } from '../../../services/migrationRunner';

export const DatabaseMigrationsView: React.FC = () => {
    const [pending, setPending] = useState<MigrationFile[]>([]);
    const [applied, setApplied] = useState<AppliedMigration[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [showConfirm, setShowConfirm] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const logsEndRef = useRef<HTMLDivElement>(null);

    const loadStatus = async () => {
        setIsLoading(true);
        try {
            await ensureMigrationTable();
            const { pending, applied } = await getMigrationStatus();
            setPending(pending);
            setApplied(applied);
        } catch (error) {
            console.error('Failed to load migration status:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadStatus();
    }, []);

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const handleRun = async (dryRun: boolean) => {
        if (!dryRun) {
            if (confirmText !== 'MIGRATE') {
                return;
            }
            setShowConfirm(false);
            setConfirmText('');
        }

        setIsRunning(true);
        setLogs([]);
        try {
            const result = await executeMigrations({ dryRun });
            setLogs(result.logs);
            if (!dryRun) {
                await loadStatus();
            }
        } catch (error: any) {
            setLogs(prev => [...prev, `CRITICAL ERROR: ${error?.message || String(error)}`]);
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white flex items-center gap-3">
                        <Database className="w-6 h-6 text-amber-500" />
                        Database Migrations
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400 mt-1 text-sm font-medium">
                        Manage and execute pending schema updates.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => loadStatus()}
                        disabled={isLoading || isRunning}
                        className="p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition flex items-center gap-2"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        <span className="text-sm font-bold">Refresh</span>
                    </button>
                    <button
                        onClick={() => handleRun(true)}
                        disabled={isLoading || isRunning || pending.length === 0}
                        className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-200 dark:hover:bg-slate-700 transition disabled:opacity-50 flex items-center gap-2"
                    >
                        <Eye className="w-4 h-4" />
                        Dry Run
                    </button>
                    <button
                        onClick={() => setShowConfirm(true)}
                        disabled={isLoading || isRunning || pending.length === 0}
                        className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-xl font-black text-sm transition disabled:opacity-50 flex items-center gap-2 shadow-sm"
                    >
                        <Play className="w-4 h-4" />
                        Run {pending.length} Pending
                    </button>
                </div>
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Left Column: Status Lists */}
                <div className="space-y-6">
                    {/* Pending Migrations */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                Pending Migrations ({pending.length})
                            </h3>
                        </div>
                        <div className="p-0">
                            {pending.length === 0 ? (
                                <div className="p-8 text-center text-slate-500 text-sm">
                                    No pending migrations. Database is up to date!
                                </div>
                            ) : (
                                <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[400px] overflow-y-auto">
                                    {pending.map(m => (
                                        <li key={m.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                                            <div className="font-medium text-slate-900 dark:text-white text-sm">{m.title}</div>
                                            <div className="text-xs text-slate-500 mt-1 font-mono">{m.id}</div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>

                    {/* Applied Migrations */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                Applied Migrations ({applied.length})
                            </h3>
                        </div>
                        <div className="p-0">
                            {applied.length === 0 ? (
                                <div className="p-8 text-center text-slate-500 text-sm">
                                    No applied migrations found.
                                </div>
                            ) : (
                                <ul className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[400px] overflow-y-auto">
                                    {applied.slice().reverse().map(a => (
                                        <li key={a.id} className="p-4 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                                            {a.success ? (
                                                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                                            ) : (
                                                <XCircle className="w-5 h-5 text-red-500 shrink-0" />
                                            )}
                                            <div>
                                                <div className="font-mono text-xs text-slate-900 dark:text-white">{a.id}</div>
                                                <div className="text-xs text-slate-500 mt-1">
                                                    {new Date(a.applied_at).toLocaleString()}
                                                </div>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Runner Logs */}
                <div className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 flex flex-col h-[500px] lg:h-auto shadow-sm">
                    <div className="p-4 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
                        <h3 className="font-bold text-white flex items-center gap-2 text-sm">
                            <Database className="w-4 h-4 text-slate-400" />
                            Execution Logs
                        </h3>
                        {isRunning && (
                            <span className="flex items-center gap-2 text-xs font-bold text-amber-500">
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                                RUNNING...
                            </span>
                        )}
                    </div>
                    <div className="p-4 flex-1 overflow-y-auto font-mono text-xs text-slate-300 space-y-2 whitespace-pre-wrap">
                        {logs.length === 0 ? (
                            <div className="text-slate-600 italic">No logs yet. Run a migration or dry run to see output.</div>
                        ) : (
                            logs.map((log, i) => (
                                <div key={i} className={
                                    log.includes('[ERROR]') || log.includes('CRITICAL ERROR') ? 'text-red-400 font-bold' :
                                    log.includes('[SUCCESS]') ? 'text-emerald-400' :
                                    log.includes('[DRY RUN]') ? 'text-cyan-400' :
                                    'text-slate-300'
                                }>
                                    {log}
                                </div>
                            ))
                        )}
                        <div ref={logsEndRef} />
                    </div>
                </div>
            </div>

            {/* Confirm Modal */}
            {showConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800">
                        <div className="flex items-center gap-4 mb-4 text-red-500">
                            <AlertTriangle className="w-8 h-8" />
                            <h3 className="text-xl font-black text-slate-900 dark:text-white">Execute Migrations</h3>
                        </div>
                        <p className="text-slate-600 dark:text-slate-400 text-sm mb-6">
                            You are about to execute <strong>{pending.length}</strong> schema migrations directly against the production database.
                            This action cannot be undone.
                        </p>

                        <div className="space-y-2 mb-6">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                Type 'MIGRATE' to confirm
                            </label>
                            <input
                                type="text"
                                value={confirmText}
                                onChange={e => setConfirmText(e.target.value)}
                                placeholder="MIGRATE"
                                className="w-full p-4 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 rounded-xl text-slate-900 dark:text-white font-mono text-center font-bold tracking-widest outline-none focus:ring-2 focus:ring-amber-500 transition-all"
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => { setShowConfirm(false); setConfirmText(''); }}
                                className="flex-1 p-4 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleRun(false)}
                                disabled={confirmText !== 'MIGRATE'}
                                className="flex-1 p-4 rounded-xl font-bold text-sm bg-red-500 hover:bg-red-600 text-white transition disabled:opacity-50 disabled:hover:bg-red-500"
                            >
                                Execute Now
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
