import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { UserProfile } from '../types';

export interface AuthSessionUser {
  id: string;
  email: string | null;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
    username?: string;
    [key: string]: any;
  };
}

export type AuthStateChangeCallback = (user: AuthSessionUser | null) => void;

class AuthService {
  private static instance: AuthService;

  private constructor() {}

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Get current authenticated user session from Supabase.
   */
  public async getCurrentUser(): Promise<AuthSessionUser | null> {
    if (!isSupabaseConfigured) return null;
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session?.user) return null;
      return {
        id: session.user.id,
        email: session.user.email || null,
        user_metadata: session.user.user_metadata,
      };
    } catch (err) {
      console.warn('[AuthService] Error getting session:', err);
      return null;
    }
  }

  /**
   * Listen to Supabase auth state changes.
   */
  public onAuthStateChange(callback: AuthStateChangeCallback): () => void {
    if (!isSupabaseConfigured) {
      callback(null);
      return () => {};
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        callback({
          id: session.user.id,
          email: session.user.email || null,
          user_metadata: session.user.user_metadata,
        });
      } else {
        callback(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }

  /**
   * Sign up with email & password.
   */
  public async signUp(email: string, password: string, fullName?: string, metadata?: Record<string, any>) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || '',
          ...metadata,
          role: 'user',
          is_admin: false,
        },
      },
    });
    if (error) throw error;
    return data;
  }

  /**
   * Sign in with email & password.
   */
  public async signIn(email: string, password: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  }

  /**
   * Sign in with OAuth (e.g. Google).
   */
  public async signInWithGoogle(redirectTo?: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo || (typeof window !== 'undefined' ? window.location.origin : undefined),
      },
    });
    if (error) throw error;
    return data;
  }

  /**
   * Sign in anonymously (guest mode).
   */
  public async signInAnonymously() {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data;
  }

  /**
   * Sign out current user.
   */
  public async signOut() {
    if (!isSupabaseConfigured) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  /**
   * Send password reset email.
   */
  public async sendPasswordResetEmail(email: string, redirectTo?: string) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo || (typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined),
    });
    if (error) throw error;
    return data;
  }

  /**
   * Update current user profile / metadata.
   */
  public async updateProfile(attributes: { full_name?: string; avatar_url?: string; [key: string]: any }) {
    if (!isSupabaseConfigured) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.updateUser({
      data: attributes,
    });
    if (error) throw error;
    return data;
  }
}

export const authService = AuthService.getInstance();
export default authService;
