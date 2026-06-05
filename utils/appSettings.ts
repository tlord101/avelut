import type { AppSettings } from '../types';

export const APP_SETTINGS_PATH = 'app_settings/global';

export const DEFAULT_USAGE_SETTINGS = {
  plans: {
    free: {
      name: 'Free Plan',
      description: 'Fundamental study tools with standard constraints',
      price: 0,
      limits: {
        courses: 2,
        ai_requests_per_course: 5,
        exams: 3,
        visual_messages: 10,
      },
    },
    basic: {
      name: 'Basic Plan',
      description: 'Unlock advanced guides and higher limits. Twitter-style blue badge included.',
      price: 1000,
      limits: {
        courses: 5,
        ai_requests_per_course: 20,
        exams: 10,
        visual_messages: 50,
      },
    },
    pro: {
      name: 'Pro Plan',
      description: 'Ultimate academic assistance with maximum limits. Purple badge included.',
      price: 2500,
      limits: {
        courses: 15,
        ai_requests_per_course: 100,
        exams: 50,
        visual_messages: 200,
      },
    },
  },
  additional_prices: {
    visual_messages_price: 200,
    visual_messages_count: 10,
    studyguide_course_price: 300,
    studyguide_request_price: 50,
  },
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  primary_gemini_model: 'gemini-2.5-flash-lite',
  gemini_api_key: '',
  upload_center_uploads_enabled: true,
  coming_soon_enabled: false,
  paystack_public_key: '',
  paystack_secret_key: '',
  custom_user_limit_rpm: 10,
  custom_user_limit_tpm: 250000,
  usage_settings: DEFAULT_USAGE_SETTINGS,
  youtube_api_key: '',
};

export const normalizeAppSettings = (raw: Partial<AppSettings> | null | undefined): AppSettings => ({
  primary_gemini_model: (raw?.primary_gemini_model || DEFAULT_APP_SETTINGS.primary_gemini_model).toString().trim() || DEFAULT_APP_SETTINGS.primary_gemini_model,
  gemini_api_key: (raw?.gemini_api_key || DEFAULT_APP_SETTINGS.gemini_api_key).toString().trim(),
  youtube_api_key: (raw?.youtube_api_key || DEFAULT_APP_SETTINGS.youtube_api_key || '').toString().trim(),
  upload_center_uploads_enabled: raw?.upload_center_uploads_enabled ?? DEFAULT_APP_SETTINGS.upload_center_uploads_enabled,
  coming_soon_enabled: raw?.coming_soon_enabled ?? DEFAULT_APP_SETTINGS.coming_soon_enabled,
  paystack_public_key: (raw?.paystack_public_key || DEFAULT_APP_SETTINGS.paystack_public_key).toString().trim(),
  paystack_secret_key: (raw?.paystack_secret_key || DEFAULT_APP_SETTINGS.paystack_secret_key).toString().trim(),
  custom_user_limit_rpm: typeof raw?.custom_user_limit_rpm === 'number' ? raw.custom_user_limit_rpm : DEFAULT_APP_SETTINGS.custom_user_limit_rpm,
  custom_user_limit_tpm: typeof raw?.custom_user_limit_tpm === 'number' ? raw.custom_user_limit_tpm : DEFAULT_APP_SETTINGS.custom_user_limit_tpm,
  usage_settings: raw?.usage_settings ? {
    plans: {
      free: {
        name: raw.usage_settings.plans?.free?.name || DEFAULT_USAGE_SETTINGS.plans.free.name,
        description: raw.usage_settings.plans?.free?.description || DEFAULT_USAGE_SETTINGS.plans.free.description,
        price: typeof raw.usage_settings.plans?.free?.price === 'number' ? raw.usage_settings.plans.free.price : DEFAULT_USAGE_SETTINGS.plans.free.price,
        limits: {
          courses: typeof raw.usage_settings.plans?.free?.limits?.courses === 'number' ? raw.usage_settings.plans.free.limits.courses : DEFAULT_USAGE_SETTINGS.plans.free.limits.courses,
          ai_requests_per_course: typeof raw.usage_settings.plans?.free?.limits?.ai_requests_per_course === 'number' ? raw.usage_settings.plans.free.limits.ai_requests_per_course : DEFAULT_USAGE_SETTINGS.plans.free.limits.ai_requests_per_course,
          exams: typeof raw.usage_settings.plans?.free?.limits?.exams === 'number' ? raw.usage_settings.plans.free.limits.exams : DEFAULT_USAGE_SETTINGS.plans.free.limits.exams,
          visual_messages: typeof raw.usage_settings.plans?.free?.limits?.visual_messages === 'number' ? raw.usage_settings.plans.free.limits.visual_messages : DEFAULT_USAGE_SETTINGS.plans.free.limits.visual_messages,
        }
      },
      basic: {
        name: raw.usage_settings.plans?.basic?.name || DEFAULT_USAGE_SETTINGS.plans.basic.name,
        description: raw.usage_settings.plans?.basic?.description || DEFAULT_USAGE_SETTINGS.plans.basic.description,
        price: typeof raw.usage_settings.plans?.basic?.price === 'number' ? raw.usage_settings.plans.basic.price : DEFAULT_USAGE_SETTINGS.plans.basic.price,
        limits: {
          courses: typeof raw.usage_settings.plans?.basic?.limits?.courses === 'number' ? raw.usage_settings.plans.basic.limits.courses : DEFAULT_USAGE_SETTINGS.plans.basic.limits.courses,
          ai_requests_per_course: typeof raw.usage_settings.plans?.basic?.limits?.ai_requests_per_course === 'number' ? raw.usage_settings.plans.basic.limits.ai_requests_per_course : DEFAULT_USAGE_SETTINGS.plans.basic.limits.ai_requests_per_course,
          exams: typeof raw.usage_settings.plans?.basic?.limits?.exams === 'number' ? raw.usage_settings.plans.basic.limits.exams : DEFAULT_USAGE_SETTINGS.plans.basic.limits.exams,
          visual_messages: typeof raw.usage_settings.plans?.basic?.limits?.visual_messages === 'number' ? raw.usage_settings.plans.basic.limits.visual_messages : DEFAULT_USAGE_SETTINGS.plans.basic.limits.visual_messages,
        }
      },
      pro: {
        name: raw.usage_settings.plans?.pro?.name || DEFAULT_USAGE_SETTINGS.plans.pro.name,
        description: raw.usage_settings.plans?.pro?.description || DEFAULT_USAGE_SETTINGS.plans.pro.description,
        price: typeof raw.usage_settings.plans?.pro?.price === 'number' ? raw.usage_settings.plans.pro.price : DEFAULT_USAGE_SETTINGS.plans.pro.price,
        limits: {
          courses: typeof raw.usage_settings.plans?.pro?.limits?.courses === 'number' ? raw.usage_settings.plans.pro.limits.courses : DEFAULT_USAGE_SETTINGS.plans.pro.limits.courses,
          ai_requests_per_course: typeof raw.usage_settings.plans?.pro?.limits?.ai_requests_per_course === 'number' ? raw.usage_settings.plans.pro.limits.ai_requests_per_course : DEFAULT_USAGE_SETTINGS.plans.pro.limits.ai_requests_per_course,
          exams: typeof raw.usage_settings.plans?.pro?.limits?.exams === 'number' ? raw.usage_settings.plans.pro.limits.exams : DEFAULT_USAGE_SETTINGS.plans.pro.limits.exams,
          visual_messages: typeof raw.usage_settings.plans?.pro?.limits?.visual_messages === 'number' ? raw.usage_settings.plans.pro.limits.visual_messages : DEFAULT_USAGE_SETTINGS.plans.pro.limits.visual_messages,
        }
      }
    },
    additional_prices: {
      visual_messages_price: typeof raw.usage_settings.additional_prices?.visual_messages_price === 'number' ? raw.usage_settings.additional_prices.visual_messages_price : DEFAULT_USAGE_SETTINGS.additional_prices.visual_messages_price,
      visual_messages_count: typeof raw.usage_settings.additional_prices?.visual_messages_count === 'number' ? raw.usage_settings.additional_prices.visual_messages_count : DEFAULT_USAGE_SETTINGS.additional_prices.visual_messages_count,
      studyguide_course_price: typeof raw.usage_settings.additional_prices?.studyguide_course_price === 'number' ? raw.usage_settings.additional_prices.studyguide_course_price : DEFAULT_USAGE_SETTINGS.additional_prices.studyguide_course_price,
      studyguide_request_price: typeof raw.usage_settings.additional_prices?.studyguide_request_price === 'number' ? raw.usage_settings.additional_prices.studyguide_request_price : DEFAULT_USAGE_SETTINGS.additional_prices.studyguide_request_price,
    }
  } : DEFAULT_USAGE_SETTINGS,
});

