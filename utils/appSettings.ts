import type { AppSettings } from '../types';

export const APP_SETTINGS_PATH = 'app_settings/global';

export const DEFAULT_USAGE_SETTINGS = {
  plans: {
    free: {
      name: 'Free Plan',
      description: 'Fundamental study tools with standard constraints',
      price: 0,
      monthly_ai_credits: 10,
      limits: {
        courses: 2,
      },
    },
    basic: {
      name: 'Basic Plan',
      description: 'Unlock advanced guides and higher limits. Twitter-style blue badge included.',
      price: 1000,
      monthly_ai_credits: 50,
      limits: {
        courses: 5,
      },
    },
    pro: {
      name: 'Pro Plan',
      description: 'Ultimate academic assistance with maximum limits. Purple badge included.',
      price: 2500,
      monthly_ai_credits: 200,
      limits: {
        courses: 15,
      },
    },
  },
  feature_costs: {
    visual_solve: 2,
    chat_interaction: 1,
    flashcard_generation: 3,
    ai_quiz_generation: 1,
    study_guide_lesson: 1,
    study_guide_extraction: 5,
  },
  feature_models: {
    visual_solve: 'gemini-3.1-flash-lite',
    chat_interaction: 'gemini-3.1-flash-lite',
    flashcard_generation: 'gemini-3.1-flash-lite',
    ai_quiz_generation: 'gemini-3.1-flash-lite',
    study_guide_lesson: 'gemini-3.1-flash-lite',
    study_guide_extraction: 'gemini-3.1-flash-lite',
    title_generation: 'gemini-3.1-flash-lite',
  },
  additional_prices: {
    visual_messages_price: 200,
    visual_messages_count: 10,
    studyguide_course_price: 300,
    studyguide_request_price: 50,
  },
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  primary_gemini_model: 'gemini-3.1-flash-lite',
  gemini_api_key: '',
  upload_center_uploads_enabled: true,
  coming_soon_enabled: false,
  paystack_public_key: '',
  paystack_secret_key: '',
  custom_user_limit_rpm: 10,
  custom_user_limit_tpm: 250000,
  usage_settings: DEFAULT_USAGE_SETTINGS,
  youtube_api_key: '',
  google_client_id: '',
  google_api_key: '',
  pinecone_api_key: '',
  pinecone_index_name: '',
};

export const normalizeAppSettings = (raw: Partial<AppSettings> | null | undefined): AppSettings => ({
  primary_gemini_model: (raw?.primary_gemini_model || DEFAULT_APP_SETTINGS.primary_gemini_model).toString().trim() || DEFAULT_APP_SETTINGS.primary_gemini_model,
  gemini_api_key: (raw?.gemini_api_key || DEFAULT_APP_SETTINGS.gemini_api_key).toString().trim(),
  youtube_api_key: (raw?.youtube_api_key || DEFAULT_APP_SETTINGS.youtube_api_key || '').toString().trim(),
  google_client_id: (raw?.google_client_id || DEFAULT_APP_SETTINGS.google_client_id || '').toString().trim(),
  google_api_key: (raw?.google_api_key || DEFAULT_APP_SETTINGS.google_api_key || '').toString().trim(),
  pinecone_api_key: (raw?.pinecone_api_key || DEFAULT_APP_SETTINGS.pinecone_api_key || '').toString().trim(),
  pinecone_index_name: (raw?.pinecone_index_name || DEFAULT_APP_SETTINGS.pinecone_index_name || '').toString().trim(),
  upload_center_uploads_enabled: raw?.upload_center_uploads_enabled ?? DEFAULT_APP_SETTINGS.upload_center_uploads_enabled,
  coming_soon_enabled: raw?.coming_soon_enabled ?? DEFAULT_APP_SETTINGS.coming_soon_enabled,
  paystack_public_key: (raw?.paystack_public_key || DEFAULT_APP_SETTINGS.paystack_public_key).toString().trim(),
  paystack_secret_key: (raw?.paystack_secret_key || DEFAULT_APP_SETTINGS.paystack_secret_key).toString().trim(),
  custom_user_limit_rpm: typeof raw?.custom_user_limit_rpm === 'number' ? raw.custom_user_limit_rpm : DEFAULT_APP_SETTINGS.custom_user_limit_rpm,
  custom_user_limit_tpm: typeof raw?.custom_user_limit_tpm === 'number' ? raw.custom_user_limit_tpm : DEFAULT_APP_SETTINGS.custom_user_limit_tpm,
  usage_settings: raw?.usage_settings ? {
    feature_costs: {
      visual_solve: typeof raw.usage_settings.feature_costs?.visual_solve === 'number' ? raw.usage_settings.feature_costs.visual_solve : DEFAULT_USAGE_SETTINGS.feature_costs.visual_solve,
      chat_interaction: typeof raw.usage_settings.feature_costs?.chat_interaction === 'number' ? raw.usage_settings.feature_costs.chat_interaction : DEFAULT_USAGE_SETTINGS.feature_costs.chat_interaction,
      flashcard_generation: typeof raw.usage_settings.feature_costs?.flashcard_generation === 'number' ? raw.usage_settings.feature_costs.flashcard_generation : DEFAULT_USAGE_SETTINGS.feature_costs.flashcard_generation,
      ai_quiz_generation: typeof raw.usage_settings.feature_costs?.ai_quiz_generation === 'number' ? raw.usage_settings.feature_costs.ai_quiz_generation : DEFAULT_USAGE_SETTINGS.feature_costs.ai_quiz_generation,
      study_guide_lesson: typeof raw.usage_settings.feature_costs?.study_guide_lesson === 'number' ? raw.usage_settings.feature_costs.study_guide_lesson : DEFAULT_USAGE_SETTINGS.feature_costs.study_guide_lesson,
      study_guide_extraction: typeof raw.usage_settings.feature_costs?.study_guide_extraction === 'number' ? raw.usage_settings.feature_costs.study_guide_extraction : DEFAULT_USAGE_SETTINGS.feature_costs.study_guide_extraction,
    },
    feature_models: {
      visual_solve: raw.usage_settings.feature_models?.visual_solve || DEFAULT_USAGE_SETTINGS.feature_models.visual_solve,
      chat_interaction: raw.usage_settings.feature_models?.chat_interaction || DEFAULT_USAGE_SETTINGS.feature_models.chat_interaction,
      flashcard_generation: raw.usage_settings.feature_models?.flashcard_generation || DEFAULT_USAGE_SETTINGS.feature_models.flashcard_generation,
      ai_quiz_generation: raw.usage_settings.feature_models?.ai_quiz_generation || DEFAULT_USAGE_SETTINGS.feature_models.ai_quiz_generation,
      study_guide_lesson: raw.usage_settings.feature_models?.study_guide_lesson || DEFAULT_USAGE_SETTINGS.feature_models.study_guide_lesson,
      study_guide_extraction: raw.usage_settings.feature_models?.study_guide_extraction || DEFAULT_USAGE_SETTINGS.feature_models.study_guide_extraction,
      title_generation: raw.usage_settings.feature_models?.title_generation || DEFAULT_USAGE_SETTINGS.feature_models.title_generation,
    },
    plans: {
      free: {
        name: raw.usage_settings.plans?.free?.name || DEFAULT_USAGE_SETTINGS.plans.free.name,
        description: raw.usage_settings.plans?.free?.description || DEFAULT_USAGE_SETTINGS.plans.free.description,
        price: typeof raw.usage_settings.plans?.free?.price === 'number' ? raw.usage_settings.plans.free.price : DEFAULT_USAGE_SETTINGS.plans.free.price,
        monthly_ai_credits: typeof raw.usage_settings.plans?.free?.monthly_ai_credits === 'number' ? raw.usage_settings.plans.free.monthly_ai_credits : DEFAULT_USAGE_SETTINGS.plans.free.monthly_ai_credits,
        limits: {
          courses: typeof raw.usage_settings.plans?.free?.limits?.courses === 'number' ? raw.usage_settings.plans.free.limits.courses : DEFAULT_USAGE_SETTINGS.plans.free.limits.courses,
        }
      },
      basic: {
        name: raw.usage_settings.plans?.basic?.name || DEFAULT_USAGE_SETTINGS.plans.basic.name,
        description: raw.usage_settings.plans?.basic?.description || DEFAULT_USAGE_SETTINGS.plans.basic.description,
        price: typeof raw.usage_settings.plans?.basic?.price === 'number' ? raw.usage_settings.plans.basic.price : DEFAULT_USAGE_SETTINGS.plans.basic.price,
        monthly_ai_credits: typeof raw.usage_settings.plans?.basic?.monthly_ai_credits === 'number' ? raw.usage_settings.plans.basic.monthly_ai_credits : DEFAULT_USAGE_SETTINGS.plans.basic.monthly_ai_credits,
        limits: {
          courses: typeof raw.usage_settings.plans?.basic?.limits?.courses === 'number' ? raw.usage_settings.plans.basic.limits.courses : DEFAULT_USAGE_SETTINGS.plans.basic.limits.courses,
        }
      },
      pro: {
        name: raw.usage_settings.plans?.pro?.name || DEFAULT_USAGE_SETTINGS.plans.pro.name,
        description: raw.usage_settings.plans?.pro?.description || DEFAULT_USAGE_SETTINGS.plans.pro.description,
        price: typeof raw.usage_settings.plans?.pro?.price === 'number' ? raw.usage_settings.plans.pro.price : DEFAULT_USAGE_SETTINGS.plans.pro.price,
        monthly_ai_credits: typeof raw.usage_settings.plans?.pro?.monthly_ai_credits === 'number' ? raw.usage_settings.plans.pro.monthly_ai_credits : DEFAULT_USAGE_SETTINGS.plans.pro.monthly_ai_credits,
        limits: {
          courses: typeof raw.usage_settings.plans?.pro?.limits?.courses === 'number' ? raw.usage_settings.plans.pro.limits.courses : DEFAULT_USAGE_SETTINGS.plans.pro.limits.courses,
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
