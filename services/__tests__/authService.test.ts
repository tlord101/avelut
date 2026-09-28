import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Supabase client
vi.mock('../../lib/supabaseClient', () => {
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: {
        signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
        resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
  };
});

import { supabase } from '../../lib/supabaseClient';
import { supabaseAuthService } from '../supabaseAuthService';
import { authService } from '../authService';

describe('Auth Services - Google OAuth Callback URL', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  describe('supabaseAuthService.signInWithGoogle', () => {
    it('uses https://www.avelut.xyz/ when window.location.origin is localhost', async () => {
      // Mock window.location on localhost
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'http://localhost:3000',
          },
        },
        writable: true,
      });

      await supabaseAuthService.signInWithGoogle();

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'https://www.avelut.xyz/',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
    });

    it('uses https://www.avelut.xyz/ when window.location.origin is 127.0.0.1', async () => {
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'http://127.0.0.1:5173',
          },
        },
        writable: true,
      });

      await supabaseAuthService.signInWithGoogle();

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'https://www.avelut.xyz/',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
    });

    it('respects explicitly provided customRedirectTo even on localhost', async () => {
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'http://localhost:3000',
          },
        },
        writable: true,
      });

      await supabaseAuthService.signInWithGoogle('https://custom.domain.com/callback');

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'https://custom.domain.com/callback',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
    });

    it('uses window.location.origin when running on production domain', async () => {
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'https://www.avelut.xyz',
          },
        },
        writable: true,
      });

      await supabaseAuthService.signInWithGoogle();

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'https://www.avelut.xyz/',
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
    });
  });

  describe('authService.signInWithGoogle', () => {
    it('uses https://www.avelut.xyz/ when window.location.origin is localhost', async () => {
      Object.defineProperty(global, 'window', {
        value: {
          location: {
            origin: 'http://localhost:3000',
          },
        },
        writable: true,
      });

      await authService.signInWithGoogle();

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'https://www.avelut.xyz/',
        },
      });
    });

    it('respects custom redirectTo parameter', async () => {
      await authService.signInWithGoogle('https://mycustomapp.com/oauth');

      expect(supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: {
          redirectTo: 'https://mycustomapp.com/oauth',
        },
      });
    });
  });
});
