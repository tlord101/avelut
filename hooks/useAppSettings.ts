import { useEffect, useState } from 'react';
import { onValue, ref as dbRef } from 'firebase/database';
import { db } from '../firebase';
import type { AppSettings } from '../types';
import { APP_SETTINGS_PATH, DEFAULT_APP_SETTINGS, normalizeAppSettings } from '../utils/appSettings';

export const useAppSettings = () => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const settingsRef = dbRef(db, APP_SETTINGS_PATH);
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      setSettings(normalizeAppSettings(snapshot.val()));
      setIsLoading(false);
    }, () => {
      setSettings(DEFAULT_APP_SETTINGS);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { settings, isLoading };
};
