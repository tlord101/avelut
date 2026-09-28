import { GoogleSignIn, ErrorCode } from '@capawesome/capacitor-google-sign-in';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { User, Session } from '@supabase/supabase-js';

let isPluginInitialized = false;

export interface GoogleSignInResponse {
  user: User | null;
  session: Session | null;
  canceled?: boolean;
  error?: string | null;
}

/**
 * Performs native Google Sign-In using the Capacitor Google Sign-In plugin,
 * then exchanges the retrieved ID Token with Supabase Auth via `signInWithIdToken`.
 */
export async function nativeGoogleSignIn(): Promise<GoogleSignInResponse> {
  if (!isSupabaseConfigured) {
    return {
      user: null,
      session: null,
      error: 'Supabase is not configured.',
    };
  }

  const clientId =
    import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    '1087192461942-7p6u3m8a0c23k1r3n9g4j8k5l2m0n1o2.apps.googleusercontent.com';

  try {
    if (!isPluginInitialized) {
      await GoogleSignIn.initialize({ clientId });
      isPluginInitialized = true;
    }

    const result = await GoogleSignIn.signIn();

    if (!result || !result.idToken) {
      return {
        user: null,
        session: null,
        error: 'Google Sign-In failed to return an ID token.',
      };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: result.idToken,
    });

    if (error) {
      return {
        user: null,
        session: null,
        error: error.message || 'Supabase authentication failed with Google ID token.',
      };
    }

    return {
      user: data.user,
      session: data.session,
      error: null,
    };
  } catch (err: any) {
    const errorMessage = err?.message || String(err);

    if (
      err?.code === ErrorCode.SignInCanceled ||
      errorMessage.includes('SIGN_IN_CANCELED') ||
      errorMessage.toLowerCase().includes('cancel')
    ) {
      return {
        user: null,
        session: null,
        canceled: true,
        error: null,
      };
    }

    return {
      user: null,
      session: null,
      error: errorMessage || 'An unexpected error occurred during Google Sign-In.',
    };
  }
}

export default nativeGoogleSignIn;
