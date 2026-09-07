import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { UserProfile } from '../types';
import { readCachedJson, writeCachedJson } from '../utils/cache';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidUuid = (id: string | null | undefined): boolean => {
    return typeof id === 'string' && UUID_REGEX.test(id);
};

// In-memory cache for ultra-fast zero-latency lookup
const profileMemoryCache = new Map<string, UserProfile>();

export const getCachedUserProfile = (uid: string): UserProfile | null => {
    return profileMemoryCache.get(uid) || null;
};

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
    if (!uid) return null;
    
    // Check memory cache first
    const mem = profileMemoryCache.get(uid);
    if (mem) return mem;

    // Check persistent cache
    try {
        const cached = await readCachedJson<UserProfile>(`user_profile_${uid}`);
        if (cached && (cached.display_name || cached.uid)) {
            profileMemoryCache.set(uid, cached);
            return cached;
        }
    } catch {
        // Continue to network fetch
    }

    if (!isSupabaseConfigured) return null;

    let targetUid = uid;
    if (!isValidUuid(targetUid)) {
        try {
            const { data: authData } = await supabase.auth.getUser();
            if (authData?.user?.id && isValidUuid(authData.user.id)) {
                targetUid = authData.user.id;
            } else {
                return null;
            }
        } catch {
            return null;
        }
    }

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', targetUid)
            .maybeSingle();

        if (error) {
            console.warn(`[UserProfileService] Error fetching profile for ${targetUid}:`, error);
            return null;
        }

        if (data) {
            const profile: UserProfile = {
                uid: data.id,
                display_name: data.full_name || data.username || 'User',
                photo_url: data.avatar_url || '',
                email: data.email || '',
                school_id: data.school_id,
                department_id: data.department_id,
                level: data.level,
                xp: data.xp || 0,
                current_streak: data.streak || 0,
                last_activity_date: Date.now(),
                notifications_enabled: true,
                ai_credits_balance: data.ai_credits ?? 50,
                is_admin: data.is_admin || false,
                subscription_status: data.subscription_status || (data.is_paid_subscriber ? 'premium' : 'free'),
            };
            profileMemoryCache.set(uid, profile);
            profileMemoryCache.set(targetUid, profile);
            try { writeCachedJson(`user_profile_${uid}`, profile); } catch {}
            return profile;
        }
    } catch (err) {
        console.warn(`Failed to fetch user profile for ${uid}:`, err);
    }
    return null;
};

export const getMultipleUserProfiles = async (uids: string[]): Promise<UserProfile[]> => {
    if (!uids || uids.length === 0) return [];
    const uniqueUids = Array.from(new Set(uids.filter(Boolean)));
    const profiles = await Promise.all(uniqueUids.map(uid => getUserProfile(uid)));
    return profiles.filter((p): p is UserProfile => p !== null);
};

export const subscribeUserProfile = (uid: string, callback: (profile: UserProfile | null) => void) => {
    if (!uid || !isSupabaseConfigured) return () => {};

    // Initial fetch
    void getUserProfile(uid).then(p => callback(p));

    if (!isValidUuid(uid)) {
        return () => {};
    }

    // Realtime subscription on profiles table
    try {
        const channel = supabase
            .channel(`profile_changes_${uid}_${Date.now()}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` },
                (payload) => {
                    if (payload.new && (payload.new as any).id) {
                        const data = payload.new as any;
                        const profile: UserProfile = {
                            uid: data.id,
                            display_name: data.full_name || data.username || 'User',
                            photo_url: data.avatar_url || '',
                            email: data.email || '',
                            school_id: data.school_id,
                            department_id: data.department_id,
                            level: data.level,
                            xp: data.xp || 0,
                            current_streak: data.streak || 0,
                            last_activity_date: Date.now(),
                            notifications_enabled: true,
                            ai_credits_balance: data.ai_credits ?? 50,
                            is_admin: data.is_admin || false,
                            subscription_status: data.subscription_status || (data.is_paid_subscriber ? 'premium' : 'free'),
                        };
                        profileMemoryCache.set(uid, profile);
                        try { writeCachedJson(`user_profile_${uid}`, profile); } catch {}
                        callback(profile);
                    }
                }
            )
            .subscribe();

        return () => {
            void supabase.removeChannel(channel);
        };
    } catch {
        return () => {};
    }
};
