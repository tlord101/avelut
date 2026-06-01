import type { AppSettings } from '../types';

export const APP_SETTINGS_PATH = 'app_settings/global';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  primary_gemini_model: 'gemini-2.5-flash-lite',
  gemini_api_key: '',
  upload_center_uploads_enabled: true,
  coming_soon_enabled: false,
};

export const normalizeAppSettings = (raw: Partial<AppSettings> | null | undefined): AppSettings => ({
  primary_gemini_model: (raw?.primary_gemini_model || DEFAULT_APP_SETTINGS.primary_gemini_model).toString().trim() || DEFAULT_APP_SETTINGS.primary_gemini_model,
  gemini_api_key: (raw?.gemini_api_key || DEFAULT_APP_SETTINGS.gemini_api_key).toString().trim(),
  upload_center_uploads_enabled: raw?.upload_center_uploads_enabled ?? DEFAULT_APP_SETTINGS.upload_center_uploads_enabled,
  coming_soon_enabled: raw?.coming_soon_enabled ?? DEFAULT_APP_SETTINGS.coming_soon_enabled,
});
