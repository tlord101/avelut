import { db, ref as dbRef, remove, update } from '@/lib/backend';
import React, { useState } from 'react';
import { useToast } from '../../../hooks/useToast';
import type { UserProfile } from '../../../types';
import { DEFAULT_USAGE_SETTINGS } from '../../../utils/appSettings';

interface UserControlViewProps {
    allUsersList: UserProfile[];
    refreshUsers: () => void;
    isUsersLoading?: boolean;
    currentUserProfile?: UserProfile;
    allDepartments?: any[];
}

export const UserControlView: React.FC<UserControlViewProps> = ({ allUsersList, refreshUsers, isUsersLoading, currentUserProfile, allDepartments = [] }) => {
    const { addToast } = useToast();
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'premium' | 'suspended'>('all');
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
    const [currentPage, setCurrentPage] = useState(1);
    const usersPerPage = 10;

    // Edit State
    const [editXp, setEditXp] = useState<number>(0);
    const [editSub, setEditSub] = useState<string>('free');
    const [editRole, setEditRole] = useState<'superadmin' | 'deptadmin' | 'user'>('user');
    const [editAdminDepts, setEditAdminDepts] = useState<string[]>([]);
    const [editStatus, setEditStatus] = useState<string>('active');
    const [editCredits, setEditCredits] = useState<number>(0);

    const filteredUsers = allUsersList.filter(user => {
        const matchesSearch = (user.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
                               user.email?.toLowerCase().includes(searchQuery.toLowerCase()));
        
        if (statusFilter === 'premium') return matchesSearch && user.subscription_status === 'premium';
        if (statusFilter === 'suspended') return matchesSearch && user.status === 'suspended';
        return matchesSearch;
    });

    const totalPages = Math.ceil(filteredUsers.length / usersPerPage) || 1;
    const startIndex = (currentPage - 1) * usersPerPage;
    const paginatedUsers = filteredUsers.slice(startIndex, startIndex + usersPerPage);

    const handleEditStart = (user: UserProfile) => {
        setEditingUserId(user.uid);
        setEditXp(user.xp || 0);
        setEditSub(user.subscription_status || 'free');
        setEditRole(user.role || (user.is_admin ? 'superadmin' : 'user'));
        setEditAdminDepts(user.admin_department_ids || []);
        setEditStatus(user.status || 'active');
        setEditCredits(user.ai_credits_balance ?? 0);
    };

    const handleSaveEdit = async () => {
        if (!editingUserId) return;
        try {
            await update(dbRef(db, `users/${editingUserId}`), {
                xp: Number(editXp),
                subscription_status: editSub,
                role: editRole,
                is_admin: editRole === 'superadmin', // Keep legacy flag synced
                admin_department_ids: editRole === 'deptadmin' ? editAdminDepts : null,
                status: editStatus,
                ai_credits_balance: Number(editCredits),
                ai_credits: Number(editCredits),
            });
            addToast("User updated successfully!", "success");
            setEditingUserId(null);
            refreshUsers();
        } catch (error: any) {
            addToast("Failed to update user: " + error.message, "error");
        }
    };

    const handleDeleteUser = async (uid: string, name: string) => {
        if (!window.confirm(`Are you absolutely sure you want to completely delete ${name}? This action cannot be undone.`)) return;
        try {
            // Note: In Firebase Auth, a server function is needed to actually delete the auth account. 
            // We just mark as deleted or remove from Realtime DB.
            await remove(dbRef(db, `users/${uid}`));
            addToast("User completely deleted.", "success");
            setSelectedUsers(prev => {
                const next = new Set(prev);
                next.delete(uid);
                return next;
            });
            refreshUsers();
        } catch (error: any) {
            addToast("Failed to delete user: " + error.message, "error");
        }
    };

    const handleBatchDeleteUsers = async () => {
        if (selectedUsers.size === 0) return;
        if (!window.confirm(`Are you absolutely sure you want to completely delete ${selectedUsers.size} selected users? This action cannot be undone.`)) return;
        try {
            const updates: any = {};
            selectedUsers.forEach(uid => {
                updates[`users/${uid}`] = null;
            });
            await update(dbRef(db), updates);
            addToast(`${selectedUsers.size} users completely deleted.`, "success");
            setSelectedUsers(new Set());
            refreshUsers();
        } catch (error: any) {
            addToast("Failed to delete users: " + error.message, "error");
        }
    };

    const toggleUserSelection = (uid: string) => {
        setSelectedUsers(prev => {
            const next = new Set(prev);
            if (next.has(uid)) {
                next.delete(uid);
            } else {
                next.add(uid);
            }
            return next;
        });
    };

    const toggleAllUsersSelection = () => {
        if (selectedUsers.size === filteredUsers.length && filteredUsers.length > 0) {
            setSelectedUsers(new Set());
        } else {
            setSelectedUsers(new Set(filteredUsers.map(u => u.uid)));
        }
    };

    return (
        <div className="space-y-6 text-slate-900 dark:text-slate-100">
            {/* Header & Controls */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
                        <i className="bi bi-people-fill text-2xl"></i>
                    </div>
                    <div>
                        <h3 className="font-black text-xl text-slate-900 dark:text-white leading-tight">User Control</h3>
                        <div className="flex items-center gap-3 mt-1">
                            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">{allUsersList.length} Total Registered</p>
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                {allUsersList.filter(u => u.is_online || (u.last_seen && Date.now() - u.last_seen < 5 * 60 * 1000)).length} Active Now
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                        <input 
                            type="text" 
                            placeholder="Search name or email..." 
                            value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setCurrentPage(1);
                        }}
                            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-900 dark:text-white transition-all"
                        />
                    </div>
                    <select 
                        value={statusFilter}
                        onChange={(e: any) => {
                            setStatusFilter(e.target.value);
                            setCurrentPage(1);
                        }}
                        className="py-2.5 px-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all cursor-pointer"
                    >
                        <option value="all">All Users</option>
                        <option value="premium">Premium</option>
                        <option value="suspended">Suspended</option>
                    </select>
                    {selectedUsers.size > 0 && (
                        <button
                            onClick={handleBatchDeleteUsers}
                            className="flex items-center gap-2 px-4 py-2.5 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 font-bold text-sm rounded-xl hover:bg-rose-100 transition-colors cursor-pointer"
                        >
                            <i className="bi bi-trash"></i>
                            <span>Delete ({selectedUsers.size})</span>
                        </button>
                    )}
                </div>
            </div>

            {/* User List */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                                <th className="px-6 py-4 w-12">
                                    <input 
                                        type="checkbox" 
                                        className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
                                        checked={filteredUsers.length > 0 && selectedUsers.size === filteredUsers.length}
                                        onChange={toggleAllUsersSelection}
                                    />
                                </th>
                                <th className="px-6 py-4">User</th>
                                <th className="px-6 py-4">Subscription</th>
                                <th className="px-6 py-4">XP Points</th>
                                <th className="px-6 py-4">Metrics</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-12 text-center">
                                        <i className="bi bi-exclamation-circle text-3xl text-slate-400 mx-auto mb-2 block"></i>
                                        <p className="text-slate-500 font-bold">No users found matching your criteria.</p>
                                    </td>
                                </tr>
                            ) : (
                                paginatedUsers.map(user => (
                                    <tr key={user.uid} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group">
                                        <td className="px-6 py-4">
                                            <input 
                                                type="checkbox" 
                                                className="w-4 h-4 rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 cursor-pointer"
                                                checked={selectedUsers.has(user.uid)}
                                                onChange={() => toggleUserSelection(user.uid)}
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <img 
                                                    src={user.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.display_name || 'U')}&background=1e293b&color=f8fafc`} 
                                                    alt="" 
                                                    className="w-10 h-10 rounded-full border border-slate-200 dark:border-slate-700 object-cover"
                                                />
                                                <div>
                                                    <p className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                                                        <span>{user.display_name || 'Anonymous User'}</span>
                                                        {(user.role === 'superadmin' || user.is_admin) && <span title="Super Admin"><i className="bi bi-shield-fill-check text-amber-500 text-xs"></i></span>}
                                                        {user.role === 'deptadmin' && <span title="Department Admin"><i className="bi bi-shield-fill text-slate-400 text-xs"></i></span>}
                                                    </p>
                                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{user.email || 'No email provided'}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {editingUserId === user.uid ? (
                                                <select 
                                                    value={editSub} 
                                                    onChange={e => {
                                                        const newSub = e.target.value;
                                                        setEditSub(newSub);
                                                        const planKey = (newSub === 'pro' ? 'premium' : newSub) as 'free' | 'basic' | 'premium';
                                                        const defaultCredits = DEFAULT_USAGE_SETTINGS.tiers[planKey]?.credit_allocation ?? 30;
                                                        setEditCredits(defaultCredits);
                                                    }}
                                                    className="p-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm outline-none focus:border-amber-500"
                                                >
                                                    <option value="free">Free</option>
                                                    <option value="basic">Basic</option>
                                                    <option value="premium">Premium</option>
                                                    <option value="personal_token">Personal Token</option>
                                                </select>
                                            ) : (
                                                <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border ${
                                                    user.subscription_status === 'premium' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30' :
                                                    user.subscription_status === 'basic' ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700' :
                                                    'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                                                }`}>
                                                    {user.subscription_status || 'Free'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            {editingUserId === user.uid ? (
                                                <div className="flex flex-col gap-2">
                                                    <input 
                                                        type="number" 
                                                        value={editXp} 
                                                        onChange={e => setEditXp(Number(e.target.value))}
                                                        className="w-24 p-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm outline-none focus:border-amber-500"
                                                        title="XP Points"
                                                    />
                                                    <input 
                                                        type="number" 
                                                        value={editCredits} 
                                                        onChange={e => setEditCredits(Number(e.target.value))}
                                                        className="w-24 p-2 border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 rounded-lg text-sm outline-none"
                                                        title="AI Credits"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{user.xp || 0} XP</span>
                                                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded w-max">{user.ai_credits_balance ?? 0} Credits</span>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-1 text-[10px] uppercase font-bold tracking-wider">
                                                <span className="text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded w-max">Tokens: {(user.total_tokens_used || 0).toLocaleString()}</span>
                                                <span className="text-slate-500 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 px-2 py-1 rounded w-max">Time: {Math.floor((user.time_spent_in_app || 0) / 60)} min</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            {editingUserId === user.uid ? (
                                                <div className="flex flex-col gap-2">
                                                    <select 
                                                        value={editStatus} 
                                                        onChange={e => setEditStatus(e.target.value)}
                                                        className="p-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm outline-none focus:border-amber-500"
                                                    >
                                                        <option value="active">Active</option>
                                                        <option value="suspended">Suspended</option>
                                                    </select>
                                                    {(currentUserProfile?.role === 'superadmin' || currentUserProfile?.is_admin) && (
                                                        <div className="flex flex-col gap-2 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                                                            <select 
                                                                value={editRole} 
                                                                onChange={e => setEditRole(e.target.value as any)}
                                                                className="p-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm outline-none focus:border-amber-500"
                                                            >
                                                                <option value="user">User</option>
                                                                <option value="deptadmin">Department Admin</option>
                                                                <option value="superadmin">Super Admin</option>
                                                            </select>
                                                            {editRole === 'deptadmin' && (
                                                                <div className="flex flex-col gap-1">
                                                                    <label className="text-[10px] font-bold text-slate-500 uppercase">Manageable Departments</label>
                                                                    <select
                                                                        multiple
                                                                        value={editAdminDepts}
                                                                        onChange={e => {
                                                                            const options = Array.from(e.target.selectedOptions, option => option.value);
                                                                            setEditAdminDepts(options);
                                                                        }}
                                                                        className="p-2 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white rounded-lg text-sm outline-none focus:border-amber-500 h-24"
                                                                    >
                                                                        {allDepartments?.map(dept => (
                                                                            <option key={dept.id} value={dept.id}>{dept.departmentName || dept.name || dept.id}</option>
                                                                        ))}
                                                                    </select>
                                                                    <p className="text-[10px] text-slate-400">Hold Ctrl/Cmd to select multiple</p>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${
                                                    user.status === 'suspended' ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40' :
                                                    user.status === 'deleted' ? 'bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700' :
                                                    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/40'
                                                }`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${user.status === 'suspended' ? 'bg-rose-500' : user.status === 'deleted' ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                                                    {user.status || 'Active'}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {editingUserId === user.uid ? (
                                                    <>
                                                        <button 
                                                            onClick={handleSaveEdit}
                                                            className="p-2 bg-amber-500 text-slate-950 rounded-lg hover:bg-amber-400 transition cursor-pointer font-bold"
                                                            title="Save Changes"
                                                        >
                                                            <i className="bi bi-check-lg"></i>
                                                        </button>
                                                        <button 
                                                            onClick={() => setEditingUserId(null)}
                                                            className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition cursor-pointer"
                                                            title="Cancel"
                                                        >
                                                            <i className="bi bi-x-lg"></i>
                                                        </button>
                                                    </>
                                                ) : (
                                                    <>
                                                        <button 
                                                            onClick={() => handleEditStart(user)}
                                                            className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition opacity-0 group-hover:opacity-100 cursor-pointer"
                                                            title="Edit User"
                                                        >
                                                            <i className="bi bi-pencil"></i>
                                                        </button>
                                                        <button 
                                                            onClick={() => handleDeleteUser(user.uid, user.display_name)}
                                                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition opacity-0 group-hover:opacity-100 cursor-pointer"
                                                            title="Delete User"
                                                        >
                                                            <i className="bi bi-trash"></i>
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {totalPages > 1 && (
                    <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest">
                            Showing {startIndex + 1} to {Math.min(startIndex + usersPerPage, filteredUsers.length)} of {filteredUsers.length}
                        </span>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                            >
                                Previous
                            </button>
                            <span className="px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg">
                                Page {currentPage} of {totalPages}
                            </span>
                            <button 
                                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-50 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
