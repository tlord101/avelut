import type { AppSettings } from '../types';

export const APP_SETTINGS_PATH = 'app_settings/global';

/**
 * Pricing model (NGN):
 * - Free: unlimited Avelut AI chat; everything else heavily capped → push to paid
 * - Weekly: short exam-crunch plan
 * - Pro (₦3,999/mo): only monthly Pro plan — unlimited study tools; 15-min live 1×/day included
 * - 30-min & 60-min live tutorials: always credit top-up (all tiers)
 */
export const DEFAULT_USAGE_SETTINGS = {
  tiers: {
    free: {
      tier_id: 'free',
      display_name: 'Free',
      description:
        'Unlimited Avelut AI chat. Study tools heavily limited: 3 flashcard sets/day, 1 quiz/day, 1 camera scan/day. One 15-min live voice tutorial per month. Upgrade for unlimited study tools & daily live lessons.',
      price_ngn: 0,
      credit_allocation: 50,
      max_saved_courses: 3,
      // Live: 15 min only, once per month
      live_tutorial_daily_topics: 0,
      live_tutorial_monthly_topics: 1,
      live_tutorial_included_minutes: 15,
      live_tutorial_minutes_label: '1 × 15-min lesson / month',
      // Avelut AI main chat = unlimited; study-guide / notebook tutor chats capped
      chat_daily_limit: -1,
      study_chat_daily_limit: 15,
      scan_daily_limit: 1,
      flashcard_daily_limit: 3,
      quiz_daily_limit: 1,
      max_notebooks: 20,
      sources_per_notebook: 10,
      max_source_words: 100000,
      max_source_mb: 50,
      deep_research_monthly: 2,
      audio_overviews_daily: 0,
      video_overviews_daily: 0,
      reports_daily: 2,
      has_verification_badge: false,
      badge_color: 'none',
    },
    weekly: {
      tier_id: 'weekly',
      display_name: 'Weekly',
      description:
        '7-day boost: unlimited study chats, scans, flashcards & quizzes. 15-min live voice tutorial 1×/day (7/week). 30-min & 60-min lessons available via credits.',
      price_ngn: 1499,
      credit_allocation: 400,
      max_saved_courses: -1,
      live_tutorial_daily_topics: 1,
      live_tutorial_weekly_topics: 7,
      live_tutorial_included_minutes: 15,
      live_tutorial_minutes_label: '1 × 15-min / day (7/week)',
      chat_daily_limit: -1,
      study_chat_daily_limit: -1,
      scan_daily_limit: -1,
      flashcard_daily_limit: -1,
      quiz_daily_limit: -1,
      max_notebooks: 100,
      sources_per_notebook: 50,
      max_source_words: 500000,
      max_source_mb: 200,
      has_verification_badge: true,
      badge_color: 'blue',
    },
    // Sole monthly Pro plan
    monthly: {
      tier_id: 'monthly',
      display_name: 'Pro',
      description:
        'Unlimited study tools (chat, scans, flashcards, quizzes). 15-min live voice tutorial 1× per day. Longer 30-min & 60-min lessons unlock with credits.',
      price_ngn: 3999,
      credit_allocation: 2000,
      max_saved_courses: -1,
      live_tutorial_daily_topics: 1,
      live_tutorial_monthly_topics: 30,
      live_tutorial_included_minutes: 15,
      live_tutorial_minutes_label: '1 × 15-min / day included',
      chat_daily_limit: -1,
      study_chat_daily_limit: -1,
      scan_daily_limit: -1,
      flashcard_daily_limit: -1,
      quiz_daily_limit: -1,
      max_notebooks: 100,
      sources_per_notebook: 50,
      max_source_words: 500000,
      max_source_mb: 200,
      has_verification_badge: true,
      badge_color: 'purple',
    },
    // Optional long prepaid (not a monthly charge)
    semester: {
      tier_id: 'semester',
      display_name: 'Semester',
      description:
        'Pro access for a full semester (~4 months). Same Pro limits: unlimited study tools + 15-min live 1×/day. 30/60-min via credits.',
      price_ngn: 11999,
      credit_allocation: 8000,
      max_saved_courses: -1,
      live_tutorial_daily_topics: 1,
      live_tutorial_monthly_topics: 30,
      live_tutorial_included_minutes: 15,
      live_tutorial_minutes_label: '1 × 15-min / day included',
      chat_daily_limit: -1,
      study_chat_daily_limit: -1,
      scan_daily_limit: -1,
      flashcard_daily_limit: -1,
      quiz_daily_limit: -1,
      max_notebooks: 100,
      sources_per_notebook: 50,
      max_source_words: 500000,
      max_source_mb: 200,
      has_verification_badge: true,
      badge_color: 'gold',
    },
    // Legacy aliases → map to weekly / Pro
    basic: {
      tier_id: 'basic',
      display_name: 'Weekly',
      description:
        '7-day boost: unlimited study tools. 15-min live 1×/day. 30/60-min via credits.',
      price_ngn: 1499,
      credit_allocation: 400,
      max_saved_courses: -1,
      live_tutorial_daily_topics: 1,
      live_tutorial_weekly_topics: 7,
      live_tutorial_included_minutes: 15,
      live_tutorial_minutes_label: '1 × 15-min / day (7/week)',
      has_verification_badge: true,
      badge_color: 'blue',
    },
    premium: {
      tier_id: 'premium',
      display_name: 'Pro',
      description:
        'Unlimited study tools. 15-min live 1×/day included. 30-min & 60-min via credits.',
      price_ngn: 3999,
      credit_allocation: 2000,
      max_saved_courses: -1,
      live_tutorial_daily_topics: 1,
      live_tutorial_monthly_topics: 30,
      live_tutorial_included_minutes: 15,
      live_tutorial_minutes_label: '1 × 15-min / day included',
      has_verification_badge: true,
      badge_color: 'purple',
    },
  },
  feature_costs: {
    // Live duration pricing (credits ≈ ₦1 each for PAYG)
    live_tutorial: 150,              // 15-min when over free/plan quota
    live_tutorial_15: 150,
    live_tutorial_30: 350,           // always credit-paid (not in plan allowance)
    live_tutorial_60: 650,           // always credit-paid
    live_tutorial_question: 50,
    flashcard_generation: 50,
    chat_interaction: 1,             // study-guide / notebook chat only; main Avelut chat free on Free
    visual_solve: 5,
    ai_quiz_generation: 50,
    study_guide_lesson: 300,
    study_guide_extraction: 10,
  },
  feature_models: {
    visual_solve: 'qwen/qwen3.7-flash',
    chat_interaction: 'qwen/qwen3.7-flash',
    flashcard_generation: 'qwen/qwen3.7-flash',
    ai_quiz_generation: 'qwen/qwen3.7-flash',
    study_guide_lesson: 'qwen/qwen3.7-flash',
    study_guide_extraction: 'qwen/qwen3.7-flash',
    title_generation: 'qwen/qwen3.7-flash',
  },
  additional_prices: {
    live_tutorial_pass: 150,
    live_tutorial_30_pass: 350,
    live_tutorial_60_pass: 650,
    flashcards_pack_10: 500,
    visual_messages_price: 200,
    visual_messages_count: 10,
    studyguide_course_price: 300,
    studyguide_request_price: 50,
  },
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  primary_ai_provider: 'openrouter',
  openrouter_api_key: '',
  openrouter_model: 'qwen/qwen3.7-flash',
  openrouter_base_url: 'https://openrouter.ai/api/v1',
  alibaba_api_key: '',
  alibaba_base_url: 'https://ws-o3v6mh0i8y9tqdfx.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
  alibaba_model: 'qwen3.7-flash',
  active_voice_provider: 'grok',
  studyguide_voice_provider: 'grok',
  notebook_voice_provider: 'grok',
  alibaba_voice_model: 'qwen3-tts-flash',
  alibaba_voice_name: 'Cherry',
  grok_api_key: '',
  grok_voice_id: 'altair',
  upload_center_uploads_enabled: true,
  coming_soon_enabled: false,
  show_playstore_modal: true,
  playstore_modal_collect_emails: true,
  paystack_public_key: '',
  custom_user_limit_rpm: 10,
  custom_user_limit_tpm: 250000,
  usage_settings: DEFAULT_USAGE_SETTINGS as any,
  youtube_api_key: '',
  google_client_id: '',
  google_api_key: '',
  pinecone_api_key: '',
  pinecone_index_name: '',
  revenuecat_api_key_android: '',
};

/**
 * Central resolution helper for OpenRouter API Key.
 * Priority: AppSettings -> Environment variables -> User hardcoded fallback.
 */
export const getOpenRouterApiKey = (appSettings?: AppSettings | Partial<AppSettings> | null): string => {
  const fromSettings = appSettings?.openrouter_api_key?.trim();
  if (fromSettings) {
    return fromSettings;
  }

  let fromEnv = '';
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv) {
      fromEnv = metaEnv.VITE_OPENROUTER_API_KEY || metaEnv.OPENROUTER_API_KEY || '';
    }
  } catch (_) {}

  if (!fromEnv && typeof process !== 'undefined' && process?.env) {
    fromEnv = process.env.VITE_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';
  }

  return fromEnv.trim();
};

/**
 * Central resolution helper for OpenRouter Model.
 * Resolves with priority:
 * 1. App settings `openrouter_model`
 * 2. Environment variables (OPENROUTER_MODEL / VITE_OPENROUTER_MODEL)
 * 3. Default ('qwen/qwen3.7-flash')
 */
export const getOpenRouterModel = (appSettings?: AppSettings | Partial<AppSettings> | null): string => {
  const fromSettings = appSettings?.openrouter_model?.trim();
  if (fromSettings) {
    return fromSettings;
  }

  let fromEnv = '';
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv) {
      fromEnv = metaEnv.OPENROUTER_MODEL || metaEnv.VITE_OPENROUTER_MODEL || '';
    }
  } catch (_) {}

  if (!fromEnv && typeof process !== 'undefined' && process?.env) {
    fromEnv = process.env.OPENROUTER_MODEL || process.env.VITE_OPENROUTER_MODEL || '';
  }

  return (fromEnv || DEFAULT_APP_SETTINGS.openrouter_model || 'qwen/qwen3.7-flash').trim();
};

/**
 * Central resolution helper for Alibaba Cloud (DashScope / Model Studio) API Key for CosyVoice.
 * Order of resolution:
 * 1. App settings `alibaba_api_key`
 * 2. Client / environment variables (VITE_ALIBABA_API_KEY / ALIBABA_API_KEY)
 */
export const getAlibabaApiKey = (appSettings?: AppSettings | Partial<AppSettings> | null): string => {
  const fromSettings = appSettings?.alibaba_api_key?.trim();
  if (fromSettings) {
    return fromSettings;
  }

  let fromEnv = '';
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv) {
      fromEnv = metaEnv.VITE_ALIBABA_API_KEY || metaEnv.ALIBABA_API_KEY || '';
    }
  } catch (_) {}

  if (!fromEnv && typeof process !== 'undefined' && process?.env) {
    fromEnv = process.env.VITE_ALIBABA_API_KEY || process.env.ALIBABA_API_KEY || '';
  }

  return fromEnv ? fromEnv.trim() : '';
};

export const normalizeAppSettings = (raw: Partial<AppSettings> | null | undefined): AppSettings => ({
  primary_ai_provider: raw?.primary_ai_provider || DEFAULT_APP_SETTINGS.primary_ai_provider,
  openrouter_api_key: (raw?.openrouter_api_key || DEFAULT_APP_SETTINGS.openrouter_api_key || '').toString().trim(),
  openrouter_model: (raw?.openrouter_model || getOpenRouterModel(raw) || 'qwen/qwen3.7-flash').toString().trim(),
  openrouter_base_url: (raw?.openrouter_base_url || DEFAULT_APP_SETTINGS.openrouter_base_url || '').toString().trim(),
  alibaba_api_key: (raw?.alibaba_api_key || DEFAULT_APP_SETTINGS.alibaba_api_key || '').toString().trim(),
  alibaba_base_url: (raw?.alibaba_base_url || DEFAULT_APP_SETTINGS.alibaba_base_url || '').toString().trim(),
  alibaba_model: (raw?.alibaba_model || DEFAULT_APP_SETTINGS.alibaba_model || '').toString().trim(),
  active_voice_provider: raw?.active_voice_provider || DEFAULT_APP_SETTINGS.active_voice_provider,
  studyguide_voice_provider: raw?.studyguide_voice_provider || raw?.active_voice_provider || DEFAULT_APP_SETTINGS.studyguide_voice_provider,
  notebook_voice_provider: raw?.notebook_voice_provider || raw?.active_voice_provider || DEFAULT_APP_SETTINGS.notebook_voice_provider,
  alibaba_voice_model: (raw?.alibaba_voice_model || DEFAULT_APP_SETTINGS.alibaba_voice_model || '').toString().trim(),
  alibaba_voice_name: (raw?.alibaba_voice_name || DEFAULT_APP_SETTINGS.alibaba_voice_name || '').toString().trim(),
  grok_api_key: (raw?.grok_api_key || DEFAULT_APP_SETTINGS.grok_api_key || '').toString().trim(),
  grok_voice_id: (raw?.grok_voice_id || DEFAULT_APP_SETTINGS.grok_voice_id || '').toString().trim(),
  youtube_api_key: (raw?.youtube_api_key || DEFAULT_APP_SETTINGS.youtube_api_key || '').toString().trim(),
  google_client_id: (raw?.google_client_id || DEFAULT_APP_SETTINGS.google_client_id || '').toString().trim(),
  google_api_key: (raw?.google_api_key || DEFAULT_APP_SETTINGS.google_api_key || '').toString().trim(),
  pinecone_api_key: (raw?.pinecone_api_key || DEFAULT_APP_SETTINGS.pinecone_api_key || '').toString().trim(),
  pinecone_index_name: (raw?.pinecone_index_name || DEFAULT_APP_SETTINGS.pinecone_index_name || '').toString().trim(),
  revenuecat_api_key_android: (raw?.revenuecat_api_key_android || DEFAULT_APP_SETTINGS.revenuecat_api_key_android || '').toString().trim(),
  upload_center_uploads_enabled: raw?.upload_center_uploads_enabled ?? DEFAULT_APP_SETTINGS.upload_center_uploads_enabled,
  coming_soon_enabled: raw?.coming_soon_enabled ?? DEFAULT_APP_SETTINGS.coming_soon_enabled,
  show_playstore_modal: raw?.show_playstore_modal ?? DEFAULT_APP_SETTINGS.show_playstore_modal,
  playstore_modal_collect_emails: raw?.playstore_modal_collect_emails ?? DEFAULT_APP_SETTINGS.playstore_modal_collect_emails,
  paystack_public_key: (raw?.paystack_public_key || DEFAULT_APP_SETTINGS.paystack_public_key).toString().trim(),
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
      live_tutorial: typeof (raw.usage_settings.feature_costs as any)?.live_tutorial === 'number' ? (raw.usage_settings.feature_costs as any).live_tutorial : DEFAULT_USAGE_SETTINGS.feature_costs.live_tutorial,
      live_tutorial_15: typeof (raw.usage_settings.feature_costs as any)?.live_tutorial_15 === 'number' ? (raw.usage_settings.feature_costs as any).live_tutorial_15 : DEFAULT_USAGE_SETTINGS.feature_costs.live_tutorial_15,
      live_tutorial_30: typeof (raw.usage_settings.feature_costs as any)?.live_tutorial_30 === 'number' ? (raw.usage_settings.feature_costs as any).live_tutorial_30 : DEFAULT_USAGE_SETTINGS.feature_costs.live_tutorial_30,
      live_tutorial_60: typeof (raw.usage_settings.feature_costs as any)?.live_tutorial_60 === 'number' ? (raw.usage_settings.feature_costs as any).live_tutorial_60 : DEFAULT_USAGE_SETTINGS.feature_costs.live_tutorial_60,
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
    tiers: {
      free: {
        ...(DEFAULT_USAGE_SETTINGS.tiers.free as any),
        ...(raw.usage_settings.tiers?.free || {}),
        tier_id: raw.usage_settings.tiers?.free?.tier_id || DEFAULT_USAGE_SETTINGS.tiers.free.tier_id,
        display_name: raw.usage_settings.tiers?.free?.display_name || DEFAULT_USAGE_SETTINGS.tiers.free.display_name,
        description: raw.usage_settings.tiers?.free?.description || DEFAULT_USAGE_SETTINGS.tiers.free.description,
        price_ngn: typeof raw.usage_settings.tiers?.free?.price_ngn === 'number' ? raw.usage_settings.tiers.free.price_ngn : DEFAULT_USAGE_SETTINGS.tiers.free.price_ngn,
        credit_allocation: typeof raw.usage_settings.tiers?.free?.credit_allocation === 'number' ? raw.usage_settings.tiers.free.credit_allocation : DEFAULT_USAGE_SETTINGS.tiers.free.credit_allocation,
        max_saved_courses: typeof raw.usage_settings.tiers?.free?.max_saved_courses === 'number' ? raw.usage_settings.tiers.free.max_saved_courses : DEFAULT_USAGE_SETTINGS.tiers.free.max_saved_courses,
        has_verification_badge: typeof raw.usage_settings.tiers?.free?.has_verification_badge === 'boolean' ? raw.usage_settings.tiers.free.has_verification_badge : DEFAULT_USAGE_SETTINGS.tiers.free.has_verification_badge,
        badge_color: raw.usage_settings.tiers?.free?.badge_color || DEFAULT_USAGE_SETTINGS.tiers.free.badge_color,
      },
      basic: {
        ...(DEFAULT_USAGE_SETTINGS.tiers.basic as any),
        ...(raw.usage_settings.tiers?.basic || {}),
        tier_id: raw.usage_settings.tiers?.basic?.tier_id || DEFAULT_USAGE_SETTINGS.tiers.basic.tier_id,
        display_name: raw.usage_settings.tiers?.basic?.display_name || DEFAULT_USAGE_SETTINGS.tiers.basic.display_name,
        description: raw.usage_settings.tiers?.basic?.description || DEFAULT_USAGE_SETTINGS.tiers.basic.description,
        price_ngn: typeof raw.usage_settings.tiers?.basic?.price_ngn === 'number' ? raw.usage_settings.tiers.basic.price_ngn : DEFAULT_USAGE_SETTINGS.tiers.basic.price_ngn,
        credit_allocation: typeof raw.usage_settings.tiers?.basic?.credit_allocation === 'number' ? raw.usage_settings.tiers.basic.credit_allocation : DEFAULT_USAGE_SETTINGS.tiers.basic.credit_allocation,
        max_saved_courses: typeof raw.usage_settings.tiers?.basic?.max_saved_courses === 'number' ? raw.usage_settings.tiers.basic.max_saved_courses : DEFAULT_USAGE_SETTINGS.tiers.basic.max_saved_courses,
        has_verification_badge: typeof raw.usage_settings.tiers?.basic?.has_verification_badge === 'boolean' ? raw.usage_settings.tiers.basic.has_verification_badge : DEFAULT_USAGE_SETTINGS.tiers.basic.has_verification_badge,
        badge_color: raw.usage_settings.tiers?.basic?.badge_color || DEFAULT_USAGE_SETTINGS.tiers.basic.badge_color,
      },
      premium: {
        ...(DEFAULT_USAGE_SETTINGS.tiers.premium as any),
        ...(raw.usage_settings.tiers?.premium || {}),
        tier_id: raw.usage_settings.tiers?.premium?.tier_id || DEFAULT_USAGE_SETTINGS.tiers.premium.tier_id,
        display_name: raw.usage_settings.tiers?.premium?.display_name || DEFAULT_USAGE_SETTINGS.tiers.premium.display_name,
        description: raw.usage_settings.tiers?.premium?.description || DEFAULT_USAGE_SETTINGS.tiers.premium.description,
        price_ngn: typeof raw.usage_settings.tiers?.premium?.price_ngn === 'number' ? raw.usage_settings.tiers.premium.price_ngn : DEFAULT_USAGE_SETTINGS.tiers.premium.price_ngn,
        credit_allocation: typeof raw.usage_settings.tiers?.premium?.credit_allocation === 'number' ? raw.usage_settings.tiers.premium.credit_allocation : DEFAULT_USAGE_SETTINGS.tiers.premium.credit_allocation,
        max_saved_courses: typeof raw.usage_settings.tiers?.premium?.max_saved_courses === 'number' ? raw.usage_settings.tiers.premium.max_saved_courses : DEFAULT_USAGE_SETTINGS.tiers.premium.max_saved_courses,
        has_verification_badge: typeof raw.usage_settings.tiers?.premium?.has_verification_badge === 'boolean' ? raw.usage_settings.tiers.premium.has_verification_badge : DEFAULT_USAGE_SETTINGS.tiers.premium.has_verification_badge,
        badge_color: raw.usage_settings.tiers?.premium?.badge_color || DEFAULT_USAGE_SETTINGS.tiers.premium.badge_color,
      },
    },
    additional_prices: {
      visual_messages_price: typeof raw.usage_settings.additional_prices?.visual_messages_price === 'number' ? raw.usage_settings.additional_prices.visual_messages_price : DEFAULT_USAGE_SETTINGS.additional_prices.visual_messages_price,
      visual_messages_count: typeof raw.usage_settings.additional_prices?.visual_messages_count === 'number' ? raw.usage_settings.additional_prices.visual_messages_count : DEFAULT_USAGE_SETTINGS.additional_prices.visual_messages_count,
      studyguide_course_price: typeof raw.usage_settings.additional_prices?.studyguide_course_price === 'number' ? raw.usage_settings.additional_prices.studyguide_course_price : DEFAULT_USAGE_SETTINGS.additional_prices.studyguide_course_price,
      studyguide_request_price: typeof raw.usage_settings.additional_prices?.studyguide_request_price === 'number' ? raw.usage_settings.additional_prices.studyguide_request_price : DEFAULT_USAGE_SETTINGS.additional_prices.studyguide_request_price,
      live_tutorial_pass: typeof (raw.usage_settings.additional_prices as any)?.live_tutorial_pass === 'number' ? (raw.usage_settings.additional_prices as any).live_tutorial_pass : DEFAULT_USAGE_SETTINGS.additional_prices.live_tutorial_pass,
      live_tutorial_30_pass: typeof (raw.usage_settings.additional_prices as any)?.live_tutorial_30_pass === 'number' ? (raw.usage_settings.additional_prices as any).live_tutorial_30_pass : DEFAULT_USAGE_SETTINGS.additional_prices.live_tutorial_30_pass,
      live_tutorial_60_pass: typeof (raw.usage_settings.additional_prices as any)?.live_tutorial_60_pass === 'number' ? (raw.usage_settings.additional_prices as any).live_tutorial_60_pass : DEFAULT_USAGE_SETTINGS.additional_prices.live_tutorial_60_pass,
    },
  } : (DEFAULT_USAGE_SETTINGS as any),
});
