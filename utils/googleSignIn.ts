import { GoogleSignIn, ErrorCode } from '@capawesome/capacitor-google-sign-in';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { isNative } from './capacitorUtils';
import type { User, Session } from '@supabase/supabase-js';

let isPluginInitialized = false;

export interface GoogleSignInResponse {
  user: User | null;
  session: Session | null;
  canceled?: boolean;
  error?: string | null;
}

/**
 * Performs Google Sign-In using Supabase OAuth on web or native Google Sign-In plugin on mobile,
 * then exchanges the retrieved ID Token with Supabase Auth via `signInWithIdToken` for native apps.
 */
export async function nativeGoogleSignIn(): Promise<GoogleSignInResponse> {
  if (!isSupabaseConfigured) {
    return {
      user: null,
      session: null,
      error: 'Supabase is not configured.',
    };
  }

  const redirectUrl =
    typeof window !== 'undefined' && window.location.origin
      ? window.location.origin
      : 'https://www.avelut.xyz';

  // On Web browser (non-native Capacitor), use Supabase OAuth redirect flow directly
  if (!isNative()) {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        return {
          user: null,
          session: null,
          error: error.message || 'Google OAuth failed to start.',
        };
      }

      // signInWithOAuth redirects the browser, so session/user will be handled on return
      return {
        user: null,
        session: null,
        error: null,
      };
    } catch (err: any) {
      return {
        user: null,
        session: null,
        error: err?.message || 'Google OAuth redirection failed.',
      };
    }
  }

  // Native Mobile Flow (Capacitor Android / iOS)
  const clientId =
    import.meta.env.VITE_GOOGLE_CLIENT_ID ||
    '1087192461942-7p6u3m8a0c23k1r3n9g4j8k5l2m0n1o2.apps.googleusercontent.com';

  try {
    if (!isPluginInitialized) {
      await GoogleSignIn.initialize({ 
        clientId, 
        scopes: ['profile', 'email'] 
      });
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

    // Only silently ignore explicit user cancellations.
    // If it's a configuration error (SHA-1 mismatch, etc.), show the error so the developer knows.
    if (
      err?.code === ErrorCode.SignInCanceled ||
      errorMessage === 'Sign in canceled' ||
      errorMessage === 'The user closed the hint selector.' ||
      errorMessage.includes('SIGN_IN_CANCELED') ||
      (errorMessage.toLowerCase().includes('cancel') && !errorMessage.includes('GetCredential'))
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
