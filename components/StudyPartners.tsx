import { auth, db, dbRef, get, increment, onValue, push, set, update } from '@/lib/backend';
import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile } from '../types';
import { Avatar } from './Avatar';
import { useToast } from '../hooks/useToast';
import { writeCachedJson, readCachedJson } from '../utils/cache';

interface StudyPartnersProps {
    userProfile: UserProfile;
    onNavigate: (route: string) => void;
}

export const StudyPartners: React.FC<StudyPartnersProps> = ({ userProfile, onNavigate }) => {
    const { addToast } = useToast();
    const [activeTab, setActiveTab] = useState<'find' | 'requests'>('find');
    const [searchQuery, setSearchQuery] = useState('');
    const [scopeFilter, setScopeFilter] = useState<'all' | 'my_school' | 'my_college'>('all');
    const [schoolFilter, setSchoolFilter] = useState<string>('all');
    const [levelFilter, setLevelFilter] = useState<string>('all');
    
    const [allUsers, setAllUsers] = useState<UserProfile[]>(() => 
        readCachedJson<UserProfile[]>(`messenger_users_v2`, [])
    );
    const [studyPartners, setStudyPartners] = useState<Record<string, boolean>>(() => 
        readCachedJson<Record<string, boolean>>(`messenger_${userProfile.uid}_study_partners`, {})
    );
    const [partnerRequests, setPartnerRequests] = useState<Record<string, any>>(() => 
        readCachedJson<Record<string, any>>(`messenger_${userProfile.uid}_partner_requests`, {})
    );
    const [missingProfiles, setMissingProfiles] = useState<Record<string, UserProfile>>({});

    // Fetch users (same as Messenger logic)
    useEffect(() => {
        if (!auth.currentUser) return;
        const usersRef = dbRef(db, 'users');
        const unsubUsers = onValue(usersRef, (snapshot) => {
            if (snapshot.exists()) {
                const usersData = snapshot.val();
                let usersList: UserProfile[] = [];
                if (Array.isArray(usersData)) {
                    usersList = usersData.filter(Boolean).map(u => ({ uid: u.uid || u.id, ...u }));
                } else if (usersData && typeof usersData === 'object') {
                    usersList = Object.entries(usersData).map(([uid, val]: [string, any]) => ({
                        uid: val?.uid || val?.id || uid,
                        ...val
                    })) as UserProfile[];
                }
                setAllUsers(usersList);
                writeCachedJson(`messenger_users_v2`, usersList);
            }
        });

        const partnersRef = dbRef(db, `study_partners/${auth.currentUser.uid}`);
        const unsubPartners = onValue(partnersRef, (snapshot) => {
            const data = snapshot.exists() ? snapshot.val() : {};
            setStudyPartners(data);
            writeCachedJson(`messenger_${userProfile.uid}_study_partners`, data);
        });

        const requestsRef = dbRef(db, `partner_requests/${auth.currentUser.uid}`);
        const unsubRequests = onValue(requestsRef, (snapshot) => {
            const data = snapshot.exists() ? snapshot.val() : {};
            setPartnerRequests(data);
            writeCachedJson(`messenger_${userProfile.uid}_partner_requests`, data);
        });

        return () => {
            unsubUsers();
            unsubPartners();
            unsubRequests();
        };
    }, [userProfile.uid]);

    useEffect(() => {
        const fetchMissingProfiles = async () => {
            const missingIds = new Set<string>();
            const safeUsers = Array.isArray(allUsers) ? allUsers : Object.values(allUsers || {});
            Object.values(partnerRequests || {}).forEach((req: any) => {
                if (req?.senderId && !safeUsers.find(u => u?.uid === req.senderId) && !missingProfiles[req.senderId]) missingIds.add(req.senderId);
                if (req?.receiverId && !safeUsers.find(u => u?.uid === req.receiverId) && !missingProfiles[req.receiverId]) missingIds.add(req.receiverId);
            });

            if (missingIds.size > 0) {
                const newMissingProfiles = { ...missingProfiles };
                for (const uid of missingIds) {
                    try {
                        const snapshot = await get(dbRef(db, `users/${uid}`));
                        if (snapshot.exists()) {
                            newMissingProfiles[uid] = { uid, ...snapshot.val() };
                        }
                    } catch (e) {
                        console.error("Failed to fetch missing profile", e);
                    }
                }
                setMissingProfiles(newMissingProfiles);
            }
        };

        if (Object.keys(partnerRequests).length > 0) {
            fetchMissingProfiles();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [partnerRequests, allUsers]);

    const sendPartnerRequest = async (targetUser: UserProfile) => {
        if (!auth.currentUser || !userProfile) return;
        const now = Date.now();
        // Optimistic UI update
        setPartnerRequests(prev => ({
            ...prev,
            [targetUser.uid]: {
                status: 'sent',
                senderName: userProfile.display_name || 'User',
                senderId: auth.currentUser!.uid,
                receiverId: targetUser.uid,
                timestamp: now
            }
        }));

        try {
            const myRequestRef = dbRef(db, `partner_requests/${auth.currentUser.uid}/${targetUser.uid}`);
            const theirRequestRef = dbRef(db, `partner_requests/${targetUser.uid}/${auth.currentUser.uid}`);

            await set(myRequestRef, {
                status: 'sent',
                senderName: userProfile.display_name || 'User',
                senderId: auth.currentUser.uid,
                receiverId: targetUser.uid,
                timestamp: now
            });
            await set(theirRequestRef, {
                status: 'received',
                senderName: userProfile.display_name || 'User',
                senderId: auth.currentUser.uid,
                receiverId: targetUser.uid,
                timestamp: now
            });

            try {
                const notifRef = push(dbRef(db, `notifications/${targetUser.uid}`));
                await set(notifRef, {
                    id: notifRef.key,
                    title: 'New Study Partner Request',
                    message: `${userProfile.display_name || 'A user'} sent you a study partner request!`,
                    type: 'study_partner_request',
                    is_read: false,
                    timestamp: now,
                    action_buttons: [
                        { label: 'View Request', action: 'navigate', route: 'study_partners' }
                    ]
                });
            } catch (notifErr) {
                console.warn('[StudyPartners] notification dispatch non-fatal:', notifErr);
            }

            addToast(`Study partner request sent to ${targetUser.display_name}!`, 'success');
        } catch (err: any) {
            console.error('Failed to send partner request:', err);
            // Revert optimistic update on failure
            setPartnerRequests(prev => {
                const copy = { ...prev };
                delete copy[targetUser.uid];
                return copy;
            });
            addToast('Failed to send request: ' + err.message, 'error');
        }
    };

    const acceptPartnerRequest = async (targetUser: UserProfile) => {
        if (!auth.currentUser) return;
        // Optimistic UI update
        setStudyPartners(prev => ({ ...prev, [targetUser.uid]: true }));
        setPartnerRequests(prev => {
            const copy = { ...prev };
            delete copy[targetUser.uid];
            return copy;
        });

        try {
            const myPartnerRef = dbRef(db, `study_partners/${auth.currentUser.uid}/${targetUser.uid}`);
            const theirPartnerRef = dbRef(db, `study_partners/${targetUser.uid}/${auth.currentUser.uid}`);
            await set(myPartnerRef, true);
            await set(theirPartnerRef, true);

            const myRequestRef = dbRef(db, `partner_requests/${auth.currentUser.uid}/${targetUser.uid}`);
            const theirRequestRef = dbRef(db, `partner_requests/${targetUser.uid}/${auth.currentUser.uid}`);
            await set(myRequestRef, null);
            await set(theirRequestRef, null);

            addToast(`You are now connected with ${targetUser.display_name}!`, 'success');
        } catch (err: any) {
            console.error('Failed to accept request:', err);
            addToast('Error accepting request.', 'error');
        }
    };

    const declinePartnerRequest = async (targetUid: string) => {
        if (!auth.currentUser) return;
        // Optimistic UI update
        setPartnerRequests(prev => {
            const copy = { ...prev };
            delete copy[targetUid];
            return copy;
        });

        try {
            const myRequestRef = dbRef(db, `partner_requests/${auth.currentUser.uid}/${targetUid}`);
            const theirRequestRef = dbRef(db, `partner_requests/${targetUid}/${auth.currentUser.uid}`);
            await set(myRequestRef, null);
            await set(theirRequestRef, null);
            addToast('Request declined / cancelled.', 'info');
        } catch (err: any) {
            console.error('Failed to decline request:', err);
            addToast('Error declining request.', 'error');
        }
    };

    const safeAllUsers = useMemo(() => (Array.isArray(allUsers) ? allUsers : (allUsers && typeof allUsers === 'object' ? Object.values(allUsers) : [])), [allUsers]);

    const availableSchools = useMemo(() => {
        const setOfSchools = new Set<string>();
        safeAllUsers.forEach(u => {
            if (u?.school_id) setOfSchools.add(u.school_id);
        });
        return Array.from(setOfSchools).sort();
    }, [safeAllUsers]);

    const filteredUsers = useMemo(() => {
        let users = safeAllUsers.filter(u => u && u.uid !== auth.currentUser?.uid);

        // Scope filter
        if (scopeFilter === 'my_school' && userProfile.school_id) {
            users = users.filter(u => u.school_id === userProfile.school_id);
        } else if (scopeFilter === 'my_college' && userProfile.college_id) {
            users = users.filter(u => u.college_id === userProfile.college_id);
        }

        // Specific school filter
        if (schoolFilter !== 'all') {
            users = users.filter(u => u.school_id === schoolFilter);
        }

        // Academic Level filter
        if (levelFilter !== 'all') {
            users = users.filter(u => u.level === levelFilter || (u.level && u.level.startsWith(levelFilter)));
        }

        // Universal Search: Name, Department, School, College, Level
        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            users = users.filter(u => {
                const name = (u.display_name || '').toLowerCase();
                const dept = (u.department_id || '').toLowerCase();
                const deptReadable = dept.replace(/_/g, ' ');
                const school = (u.school_id || '').toLowerCase();
                const schoolReadable = school.replace(/_/g, ' ');
                const college = (u.college_id || '').toLowerCase();
                const collegeReadable = college.replace(/_/g, ' ');
                const level = (u.level || '').toLowerCase();
                const levelReadable = `${level} level`;

                return name.includes(q) ||
                       dept.includes(q) || deptReadable.includes(q) ||
                       school.includes(q) || schoolReadable.includes(q) ||
                       college.includes(q) || collegeReadable.includes(q) ||
                       level.includes(q) || levelReadable.includes(q);
            });
        }
        return users;
    }, [allUsers, searchQuery, scopeFilter, schoolFilter, levelFilter, userProfile.school_id, userProfile.college_id]);

    const sentRequests = Object.values(partnerRequests).filter((req: any) => req.status === 'sent');
    const receivedRequests = Object.values(partnerRequests).filter((req: any) => req.status === 'received');

    return (
        <div className="flex flex-col h-full w-full bg-[#F8F9FA] dark:bg-black animate-fade-in">
            {/* Header */}
            <div className="flex items-center px-4 py-4 bg-white dark:bg-black border-b border-[#E9ECEF] dark:border-white/10 shrink-0 sticky top-0 z-10">
                <button
                    onClick={() => window.dispatchEvent(new Event('app-go-back'))}
                    className="mr-3 w-10 h-10 flex items-center justify-center rounded-full hover:bg-neutral-100 text-[#6C757D] dark:text-gray-400 transition"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>
                <div className="flex-1">
                    <h1 className="text-xl font-black text-[#212529] dark:text-white">Study Partners</h1>
                    <p className="text-xs font-semibold text-[#6C757D] dark:text-gray-400">Discover and connect with students across any school and faculty</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[#E9ECEF] dark:border-white/10 bg-white dark:bg-black px-4 py-3 shrink-0 gap-3">
                <button
                    onClick={() => setActiveTab('find')}
                    className={`px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition ${activeTab === 'find' ? 'bg-[#009EE2] text-white shadow-md shadow-[#009EE2]/20' : 'text-[#6C757D] dark:text-gray-400 hover:text-[#212529] dark:hover:text-white bg-neutral-50 dark:bg-black hover:bg-neutral-100 dark:hover:bg-neutral-900 dark:border dark:border-white/10'}`}
                >
                    Find Partners
                </button>
                <button
                    onClick={() => setActiveTab('requests')}
                    className={`px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition flex items-center gap-2 ${activeTab === 'requests' ? 'bg-[#009EE2] text-white shadow-md shadow-[#009EE2]/20' : 'text-[#6C757D] dark:text-gray-400 hover:text-[#212529] dark:hover:text-white bg-neutral-50 dark:bg-black hover:bg-neutral-100 dark:hover:bg-neutral-900 dark:border dark:border-white/10'}`}
                >
                    Requests
                    {(receivedRequests.length > 0 || sentRequests.length > 0) && (
                        <span className={`rounded-full text-[10px] font-black h-5 px-1.5 flex items-center justify-center ${activeTab === 'requests' ? 'bg-white dark:bg-black text-[#009EE2] dark:text-[#F8F9FA]' : 'bg-red-500 text-white'}`}>
                            {receivedRequests.length + sentRequests.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                {activeTab === 'find' ? (
                    <>
                        <div className="max-w-2xl mx-auto space-y-3">
                            {/* Search Input */}
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="Search by name, university, college, department, or level..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="w-full bg-white dark:bg-[#0A0A0A] text-sm font-semibold text-slate-900 dark:text-white pl-10 pr-10 py-3.5 rounded-2xl border border-slate-200 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-[#0066FF] transition placeholder:text-slate-400"
                                />
                                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                </div>
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                    >
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    </button>
                                )}
                            </div>

                            {/* Filters Bar */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200/60 dark:border-white/5 text-xs">
                                    <button
                                        onClick={() => { setScopeFilter('all'); setSchoolFilter('all'); }}
                                        className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer ${
                                            scopeFilter === 'all' && schoolFilter === 'all'
                                                ? 'bg-white dark:bg-[#0A0A0A] text-[#0066FF]'
                                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        All Universities
                                    </button>
                                    {userProfile.school_id && (
                                        <button
                                            onClick={() => { setScopeFilter('my_school'); setSchoolFilter('all'); }}
                                            className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer capitalize ${
                                                scopeFilter === 'my_school'
                                                    ? 'bg-white dark:bg-[#0A0A0A] text-[#0066FF]'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            My Campus
                                        </button>
                                    )}
                                    {userProfile.college_id && (
                                        <button
                                            onClick={() => { setScopeFilter('my_college'); setSchoolFilter('all'); }}
                                            className={`px-3 py-1 rounded-lg font-bold transition cursor-pointer capitalize ${
                                                scopeFilter === 'my_college'
                                                    ? 'bg-white dark:bg-[#0A0A0A] text-[#0066FF]'
                                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                            }`}
                                        >
                                            My Faculty
                                        </button>
                                    )}
                                </div>

                                <div className="flex items-center gap-2">
                                    {availableSchools.length > 1 && scopeFilter === 'all' && (
                                        <select
                                            value={schoolFilter}
                                            onChange={e => setSchoolFilter(e.target.value)}
                                            className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-xl py-1 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0066FF] capitalize cursor-pointer"
                                        >
                                            <option value="all">Any School ({availableSchools.length})</option>
                                            {availableSchools.map(sch => (
                                                <option key={sch} value={sch}>
                                                    {sch.replace(/_/g, ' ')}
                                                </option>
                                            ))}
                                        </select>
                                    )}

                                    <select
                                        value={levelFilter}
                                        onChange={e => setLevelFilter(e.target.value)}
                                        className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-xl py-1 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-[#0066FF] cursor-pointer"
                                    >
                                        <option value="all">Any Level</option>
                                        <option value="100">100 Level</option>
                                        <option value="200">200 Level</option>
                                        <option value="300">300 Level</option>
                                        <option value="400">400 Level</option>
                                        <option value="500">500 Level</option>
                                        <option value="600">600 Level</option>
                                        <option value="Postgraduate">Postgraduate</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* User List */}
                        <div className="max-w-2xl mx-auto space-y-2.5">
                            {filteredUsers.map(u => {
                                const isPartner = studyPartners[u.uid] === true;
                                const req = partnerRequests[u.uid];
                                return (
                                    <div
                                        key={u.uid}
                                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 bg-white dark:bg-[#0A0A0A] border border-slate-200/80 dark:border-white/10 rounded-2xl hover:border-slate-300 dark:hover:border-white/20 transition cursor-pointer"
                                        onClick={() => onNavigate(`public_profile_${u.uid}`)}
                                    >
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <Avatar
                                                className="w-11 h-11 sm:w-12 sm:h-12 rounded-full shrink-0 object-cover border border-slate-200 dark:border-white/10"
                                                photo_url={u.photo_url}
                                                display_name={u.display_name || 'User'}
                                            />
                                            <div className="min-w-0 flex-1">
                                                <h4 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                                                    {u.display_name}
                                                </h4>
                                                
                                                {/* Institutional Context Badges */}
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                                    {u.school_id && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/40 text-[#0066FF] dark:text-blue-300 border border-blue-100 dark:border-blue-900/30 capitalize">
                                                            <span>🏛️</span>
                                                            <span className="truncate max-w-[130px]">{u.school_id.replace(/_/g, ' ')}</span>
                                                        </span>
                                                    )}
                                                    {u.college_id && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-white/5 capitalize">
                                                            <span>🏢</span>
                                                            <span className="truncate max-w-[120px]">{u.college_id.replace(/_/g, ' ')}</span>
                                                        </span>
                                                    )}
                                                    {u.department_id && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-white/5 capitalize">
                                                            <span>📚</span>
                                                            <span className="truncate max-w-[140px]">{u.department_id.replace(/_/g, ' ')}</span>
                                                        </span>
                                                    )}
                                                    {u.level && (
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30">
                                                            {u.level}L
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action Controls */}
                                        <div className="shrink-0 flex items-center justify-end" onClick={e => e.stopPropagation()}>
                                            {isPartner ? (
                                                <span className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-xl">
                                                    ✓ Connected
                                                </span>
                                            ) : req?.status === 'sent' ? (
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-xs font-bold text-slate-600 bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-2.5 py-1.5 rounded-xl">
                                                        Pending
                                                    </span>
                                                    <button
                                                        onClick={() => declinePartnerRequest(u.uid)}
                                                        className="text-[11px] font-bold text-slate-500 hover:text-red-500 transition px-2 py-1 cursor-pointer"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : req?.status === 'received' ? (
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        onClick={() => declinePartnerRequest(u.uid)}
                                                        className="text-xs font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 px-3 py-1.5 rounded-xl transition cursor-pointer"
                                                    >
                                                        Decline
                                                    </button>
                                                    <button
                                                        onClick={() => acceptPartnerRequest(u)}
                                                        className="text-xs font-bold text-white bg-[#0066FF] hover:bg-[#0055D4] px-3 py-1.5 rounded-xl transition cursor-pointer"
                                                    >
                                                        Accept
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => sendPartnerRequest(u)}
                                                    className="text-xs font-bold text-white bg-[#0066FF] hover:bg-[#0055D4] px-3.5 py-1.5 rounded-xl transition cursor-pointer"
                                                >
                                                    Connect
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                            {filteredUsers.length === 0 && (
                                <div className="text-center py-10 bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 rounded-2xl p-6">
                                    <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">No students found matching your criteria.</p>
                                    <p className="text-xs text-slate-400 mt-1">Try searching by university name, college, department, or level.</p>
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="max-w-2xl mx-auto space-y-8">
                        {receivedRequests.length > 0 && (
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-wider text-[#6C757D] dark:text-gray-400 mb-4 pl-1">Received Requests ({receivedRequests.length})</h3>
                                <div className="space-y-3">
                                    {receivedRequests.map((req: any) => {
                                        const sender = allUsers.find(u => u.uid === req.senderId) || missingProfiles[req.senderId];
                                        return (
                                            <div key={req.senderId} className="flex items-center gap-4 p-4 bg-white dark:bg-black border border-[#E9ECEF] dark:border-white/10 rounded-2xl shadow-sm cursor-pointer" onClick={() => onNavigate(`public_profile_${req.senderId}`)}>
                                                <Avatar className="w-12 h-12 rounded-full shrink-0 object-cover border border-[#E9ECEF] dark:border-white/10" photo_url={sender?.photo_url} display_name={req.senderName || sender?.display_name || 'User'} />
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="font-bold text-base text-[#212529] dark:text-white truncate">{req.senderName || sender?.display_name || 'User'}</h4>
                                                    <p className="text-xs text-[#6C757D] dark:text-gray-400 font-medium truncate mt-0.5">Wants to connect with you</p>
                                                </div>
                                                <div className="shrink-0 flex gap-2" onClick={e => e.stopPropagation()}>
                                                    <button onClick={() => declinePartnerRequest(req.senderId)} className="text-xs font-bold text-[#6C757D] dark:text-gray-400 bg-neutral-100 hover:bg-neutral-200 px-4 py-2 rounded-xl transition">Decline</button>
                                                    <button onClick={() => sender && acceptPartnerRequest(sender)} className="text-xs font-black text-white bg-[#0066FF] hover:bg-[#0055D4] px-4 py-2 rounded-xl shadow-sm transition">Accept</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {sentRequests.length > 0 && (
                            <div>
                                <h3 className="text-xs font-black uppercase tracking-wider text-[#6C757D] dark:text-gray-400 mb-4 pl-1">Sent Requests ({sentRequests.length})</h3>
                                <div className="space-y-3">
                                    {sentRequests.map((req: any) => {
                                        const receiver = allUsers.find(u => u.uid === req.receiverId) || missingProfiles[req.receiverId];
                                        return (
                                            <div key={req.receiverId} className="flex items-center gap-4 p-4 bg-white dark:bg-black border border-[#E9ECEF] dark:border-white/10 rounded-2xl shadow-sm cursor-pointer hover:shadow-md transition" onClick={() => onNavigate(`public_profile_${req.receiverId}`)}>
                                                <Avatar className="w-10 h-10 rounded-full shrink-0 object-cover border border-[#E9ECEF] dark:border-white/10" photo_url={receiver?.photo_url} display_name={receiver?.display_name || 'User'} />
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="font-bold text-sm text-[#212529] dark:text-white truncate">{receiver?.display_name || 'Unknown'}</h4>
                                                </div>
                                                <div className="shrink-0 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                                                    <span className="text-xs font-bold text-slate-600 bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-xl hidden sm:inline-block">Pending</span>
                                                    <button onClick={() => declinePartnerRequest(req.receiverId)} className="text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-xl transition border border-slate-200">Cancel</button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {receivedRequests.length === 0 && sentRequests.length === 0 && (
                            <div className="text-center py-10 bg-white dark:bg-black border border-[#E9ECEF] dark:border-white/10 rounded-3xl">
                                <p className="text-[#6C757D] dark:text-gray-400 font-medium text-sm">No pending requests.</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
