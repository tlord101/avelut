import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import type { AppSettings } from '../types';
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../utils/appSettings';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import type { RealtimeChannel } from '@supabase/supabase-js';

const CACHE_KEY = 'avelut_app_settings';

// Singleton in-memory state & subscriber registry
let cachedSettings: AppSettings = readCachedJson<AppSettings>(CACHE_KEY, DEFAULT_APP_SETTINGS);
let isInitialized = false;
let activeChannel: RealtimeChannel | null = null;
const listeners = new Set<(settings: AppSettings) => void>();

function notifyListeners(newSettings: AppSettings) {
  cachedSettings = newSettings;
  writeCachedJson(CACHE_KEY, newSettings);
  listeners.forEach((listener) => listener(newSettings));
}

function initRealtimeSubscription() {
  if (isInitialized || !isSupabaseConfigured || typeof window === 'undefined') return;
  isInitialized = true;

  // 1. Initial Fetch
  void (async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value_json')
        .eq('key', 'global')
        .maybeSingle();

      if (!error && data?.value_json) {
        const normalized = normalizeAppSettings(data.value_json);
        notifyListeners(normalized);
      }
    } catch (err) {
      console.warn('[AppSettings] Initial fetch error:', err);
    }
  })();

  // 2. Realtime Channel Subscription (Single Global Channel)
  try {
    activeChannel = supabase
      .channel(`public:app_settings_singleton_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_settings',
          filter: 'key=eq.global',
        },
        (payload: any) => {
          if (payload.new?.value_json) {
            const normalized = normalizeAppSettings(payload.new.value_json);
            notifyListeners(normalized);
          }
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('[AppSettings] Realtime subscription error:', err);
  }
}

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(cachedSettings);
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      return !window.localStorage.getItem(CACHE_KEY);
    }
    return false;
  });

  useEffect(() => {
    initRealtimeSubscription();

    const listener = (updated: AppSettings) => {
      setSettings(updated);
      setIsLoading(false);
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return { settings, isLoading };
};
