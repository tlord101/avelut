/**
 * supabaseAuthService.ts — Centralized Supabase Authentication Service for Avelut
 *
 * Provides typed methods for user authentication, Google OAuth, session management,
 * and user profile synchronization with Supabase Auth & PostgreSQL.
 */

import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { UserProfile } from '../types';

export interface AuthResponse {
  user: any | null;
  profile: UserProfile | null;
  error?: string | null;
}

class SupabaseAuthService {
  /**
   * Listen to auth state changes
   */
  public onAuthStateChanged(callback: (user: any | null, profile: UserProfile | null) => void) {
    if (!isSupabaseConfigured) {
      callback(null, null);
      return () => {};
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user || null;
      if (user) {
        const profile = await this.getUserProfile(user.id);
        callback(user, profile);
      } else {
        callback(null, null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }

  /**
   * Get current authenticated user
   */
  public async getCurrentUser(): Promise<any | null> {
    if (!isSupabaseConfigured) return null;
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
  }

  /**
   * Sign up with Email and Password
   */
  public async signUpWithEmail(
    email: string,
    pass: string,
    fullName: string,
    metadata: Partial<UserProfile> = {}
  ): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return { user: null, profile: null, error: 'Supabase is not configured' };
    }

    try {
      const username = (email.split('@')[0] || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '') + '_' + Math.floor(1000 + Math.random() * 9000);
      
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password: pass,
        options: {
          data: {
            full_name: fullName.trim(),
            name: fullName.trim(),
            username,
            ...metadata,
            role: 'user',
            is_admin: false,
          },
        },
      });

      if (error) {
        return { user: null, profile: null, error: error.message };
      }

      const user = data.user;
      if (!user) {
        return { user: null, profile: null, error: 'Signup failed. Please try again.' };
      }

      // Upsert profile in Supabase
      const profile: UserProfile = {
        uid: user.id,
        email: user.email || email,
        display_name: fullName,
        school_id: metadata.school_id || '',
        department_id: metadata.department_id || '',
        level: metadata.level || '100',
        current_streak: 0,
        last_activity_date: Date.now(),
        notifications_enabled: false,
        ...metadata,
        is_admin: false,
        role: 'user',
      };

      await this.upsertProfile(user.id, profile);

      return { user, profile, error: null };
    } catch (err: any) {
      return { user: null, profile: null, error: err.message || 'Signup error' };
    }
  }

  /**
   * Sign in with Email and Password
   */
  public async signInWithEmail(email: string, pass: string): Promise<AuthResponse> {
    if (!isSupabaseConfigured) {
      return { user: null, profile: null, error: 'Supabase is not configured' };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password: pass,
      });

      if (error) {
        return { user: null, profile: null, error: error.message };
      }

      const user = data.user;
      if (!user) {
        return { user: null, profile: null, error: 'Login failed' };
      }

      const profile = await this.getUserProfile(user.id);
      return { user, profile, error: null };
    } catch (err: any) {
      return { user: null, profile: null, error: err.message || 'Login error' };
    }
  }

  /**
   * Sign in with Google OAuth
   */
  public async signInWithGoogle(): Promise<{ error?: string | null }> {
    if (!isSupabaseConfigured) {
      return { error: 'Supabase is not configured' };
    }

    try {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/` : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });

      if (error) return { error: error.message };
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Google Sign-in failed' };
    }
  }

  /**
   * Send Password Reset Email
   */
  public async sendPasswordReset(email: string): Promise<{ success: boolean; error?: string | null }> {
    if (!isSupabaseConfigured) {
      return { success: false, error: 'Supabase is not configured' };
    }

    try {
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/settings` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });

      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Password reset failed' };
    }
  }

  /**
   * Sign Out
   */
  public async signOut(): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[SupabaseAuth] Signout error:', err);
    }
  }

  /**
   * Retrieve User Profile from Supabase public.profiles
   */
  public async getUserProfile(userId: string): Promise<UserProfile | null> {
    if (!userId || !isSupabaseConfigured) return null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data) return null;

      return {
        uid: data.id,
        email: data.email,
        display_name: data.full_name,
        photo_url: data.avatar_url,
        school_id: data.school_id,
        department_id: data.department_id,
        level: data.level,
        current_streak: data.streak || 0,
        last_activity_date: Date.now(),
        notifications_enabled: Boolean(data.notifications_enabled),
        is_admin: Boolean(data.is_admin),
        role: (data.role as any) || (data.is_admin ? 'superadmin' : 'user'),
      };
    } catch (err) {
      console.warn('[SupabaseAuth] Failed to load profile:', err);
      return null;
    }
  }

  /**
   * Upsert User Profile
   */
  public async upsertProfile(userId: string, profile: Partial<UserProfile>): Promise<void> {
    if (!userId || !isSupabaseConfigured) return;

    try {
      await supabase.from('profiles').upsert({
        id: userId,
        email: profile.email,
        full_name: profile.display_name,
        avatar_url: profile.photo_url,
        school_id: profile.school_id,
        department_id: profile.department_id,
        level: profile.level,
        is_admin: profile.is_admin ?? false,
        role: profile.role || (profile.is_admin ? 'superadmin' : 'user'),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('[SupabaseAuth] Profile upsert error:', err);
    }
  }
}

export const supabaseAuthService = new SupabaseAuthService();
export default supabaseAuthService;
