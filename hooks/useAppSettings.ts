import { useEffect, useState } from 'react';
import { onValue, ref as dbRef } from 'firebase/database';
import { db } from '../firebase';
import type { AppSettings } from '../types';
import { APP_SETTINGS_PATH, DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../utils/appSettings';
import { readCachedJson, writeCachedJson } from '../utils/cache';

const CACHE_KEY = 'avelut_app_settings';

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(() => {
    return readCachedJson<AppSettings>(CACHE_KEY, DEFAULT_APP_SETTINGS);
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window !== 'undefined') {
      return !window.localStorage.getItem(CACHE_KEY);
    }
    return true;
  });

  useEffect(() => {
    const settingsRef = dbRef(db, APP_SETTINGS_PATH);
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      const normalized = normalizeAppSettings(snapshot.val());
      setSettings(normalized);
      setIsLoading(false);
      writeCachedJson(CACHE_KEY, normalized);
    }, () => {
      setSettings(DEFAULT_APP_SETTINGS);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { settings, isLoading };
};
