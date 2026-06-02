import type { AppSettings } from '../types';

export const APP_SETTINGS_PATH = 'app_settings/global';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  primary_gemini_model: 'gemini-2.5-flash-lite',
  gemini_api_key: '',
  upload_center_uploads_enabled: true,
  coming_soon_enabled: false,
  paystack_public_key: '',
  paystack_secret_key: '',
  custom_user_limit_rpm: 10,
  custom_user_limit_tpm: 250000,
};

export const normalizeAppSettings = (raw: Partial<AppSettings> | null | undefined): AppSettings => ({
  primary_gemini_model: (raw?.primary_gemini_model || DEFAULT_APP_SETTINGS.primary_gemini_model).toString().trim() || DEFAULT_APP_SETTINGS.primary_gemini_model,
  gemini_api_key: (raw?.gemini_api_key || DEFAULT_APP_SETTINGS.gemini_api_key).toString().trim(),
  upload_center_uploads_enabled: raw?.upload_center_uploads_enabled ?? DEFAULT_APP_SETTINGS.upload_center_uploads_enabled,
  coming_soon_enabled: raw?.coming_soon_enabled ?? DEFAULT_APP_SETTINGS.coming_soon_enabled,
  paystack_public_key: (raw?.paystack_public_key || DEFAULT_APP_SETTINGS.paystack_public_key).toString().trim(),
  paystack_secret_key: (raw?.paystack_secret_key || DEFAULT_APP_SETTINGS.paystack_secret_key).toString().trim(),
  custom_user_limit_rpm: typeof raw?.custom_user_limit_rpm === 'number' ? raw.custom_user_limit_rpm : DEFAULT_APP_SETTINGS.custom_user_limit_rpm,
  custom_user_limit_tpm: typeof raw?.custom_user_limit_tpm === 'number' ? raw.custom_user_limit_tpm : DEFAULT_APP_SETTINGS.custom_user_limit_tpm,
});
