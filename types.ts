import type React from 'react';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export interface UserProfile {
  uid: string;
  display_name: string;
  email?: string;
  photo_url?: string;
  xp?: number;
  school_id?: string;
  college_id?: string;
  department_id?: string;
  level?: string;
  status?: 'active' | 'suspended' | 'deleted';
  current_streak: number;
  last_streak_date?: string; // ISO date string 'YYYY-MM-DD' of the last day a streak was awarded
  last_activity_date: number; // Store as timestamp
  notifications_enabled: boolean;
  is_admin?: boolean; // Legacy property, migrating to role
  role?: 'superadmin' | 'deptadmin' | 'user';
  admin_department_ids?: string[]; // Array of dept IDs they can manage if deptadmin
  is_online?: boolean;
  last_seen?: number;
  privacy_consent?: {
    granted: boolean;
    timestamp: number;
  };
  has_completed_tour?: boolean;
  is_activated?: boolean;
  subscription_status?: 'none' | 'free' | 'weekly' | 'monthly' | 'semester' | 'basic' | 'pro' | 'personal_token' | 'premium';
  personal_api_key?: string;
  use_personal_token?: boolean;
  paystack_reference?: string;
  selected_free_course_id?: string;
  fcm_token?: string;
  default_semester_tab?: string;
  ai_credits_balance?: number;
  blocked_users?: Record<string, boolean>;
  cover_photo?: string;
  bio?: string;
  contact_details?: string;
  total_tokens_used?: number;
  time_spent_in_app?: number;
  privacy_settings?: {
    public_contact: boolean;
    public_school: boolean;
    public_department: boolean;
    public_level: boolean;
  };
  theme_preferences?: {
    mode: 'light' | 'dark';
  };
  referral_code?: string;
  referred_by?: string;
  referrals_count?: number;
}

export interface Feedback {
  id: string;
  uid: string;
  type: 'suggestion' | 'complaint' | 'bug';
  content: string;
  timestamp: number;
  status: 'pending' | 'reviewed' | 'resolved';
}

export interface Report {
  id: string;
  reporter_uid: string;
  reported_uid: string;
  chat_id?: string;
  reason: string;
  timestamp: number;
}

export interface Message {
  id: string;
  text?: string;
  sender: 'user' | 'bot';
  timestamp: number;
  image_url?: string; // Optional image URL
  audioUrl?: string; // For voice notes
  audioDuration?: number; // Duration in seconds
  // FIX: Add optional conversation_id for AI Chat messages.
  conversation_id?: string;
}

// Types for the new Exam System
export interface Question {
  question: string;
  options?: string[];
  correctAnswer?: string;
  explanation: string;
}

export interface ExamQuestionResult extends Question {
  userAnswer: string;
  isCorrect: boolean;
}

export interface ExamHistoryItem {
  id:string;
  user_id: string;
  department_id: string;
  examType?: 'objective' | 'theory' | 'pq';
  score: number;
  total_questions: number;
  timestamp: number;
  questions: ExamQuestionResult[];
}

// Types for the new Study Guide System
export interface Topic {
  topic_id: string;
  topic_name: string;
  topic_context?: string;
  start_point?: string;
  end_point?: string;
  is_complete?: boolean;
}

export interface Course {
  course_id: string;
  course_name: string;
  course_code?: string;
  course_unit?: number;
  course_status?: string;
  academic_session?: string;
  topics?: Topic[];
  level: string; // 100lvl, 200lvl, etc.
  semester?: 'first' | 'second';
  textbook_url?: string;
  textbook_urls?: string[];
  textbook_shared_key?: string;
  linked_departments?: string[];
  progress?: {
    last_context?: string;
    completed?: boolean;
    started_at?: number;
    last_accessed?: number;
  };
}

export interface DiagnosticTopicResult {
  score: number;
  status: 'Mastered' | 'Review Recommended' | 'Critical Focus';
}

export interface DiagnosticResult {
  timestamp: number;
  topic_results: {
    [topic_id: string]: DiagnosticTopicResult;
  };
}

export interface Department {
  id: string;
  name: string;
  levels: {
    [level: string]: {
      courses: {
        [courseId: string]: Course;
      };
    };
  };
}

export interface College {
  id: string;
  name: string;
  departments: Record<string, Department>;
}

export interface School {
  id: string;
  name: string;
  colleges: Record<string, College>;
}

export interface UserProgress {
  [topic_id: string]: {
    is_complete: boolean;
    timestamp?: number;
    study_duration_seconds?: number;
    xp_earned?: number;
  };
}

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  photo_url?: string;
  department_id?: string;
  level?: string;
  xp?: number;
  last_updated_at?: number;
}

export interface DashboardAssessment {
  summary: string;
  strengths: string[];
  concerns: string[];
  next_steps: string[];
  confidence: number;
  evidence: string[];
  generated_at: number;
}

// Type for the Dashboard data
export interface DashboardData {
    totalTopics: number;
    completedTopicsCount: number;
    completedCoursesCount: number;
    totalStudySeconds: number;
    averageTopicStudySeconds: number;
    averageCourseStudySeconds: number;
    examAverageScore: number;
    understandingScore: number;
    understandingLabel: string;
    backedFacts: string[];
    aiAssessment?: DashboardAssessment | null;
    examHistory: ExamHistoryItem[];
}

export interface TierConfig {
  tier_id: string;
  display_name: string;
  description: string;
  price_ngn: number;
  credit_allocation: number;
  max_saved_courses: number;
  has_verification_badge: boolean;
  badge_color: 'none' | 'blue' | 'purple' | string;
}

export interface UsageSettings {
  tiers: {
    free: TierConfig;
    basic: TierConfig;
    premium: TierConfig;
  };
  feature_costs: {
    visual_solve: number;
    chat_interaction: number;
    flashcard_generation: number;
    ai_quiz_generation: number;
    study_guide_lesson: number;
    study_guide_extraction: number;
  };
  feature_models?: {
    visual_solve?: string;
    chat_interaction?: string;
    flashcard_generation?: string;
    ai_quiz_generation?: string;
    study_guide_lesson?: string;
    study_guide_extraction?: string;
    title_generation?: string;
  };
  additional_prices: {
    visual_messages_price: number;
    visual_messages_count: number;
    studyguide_course_price: number;
    studyguide_request_price: number;
  };
}

export type VoiceProvider = 'grok' | 'alibaba' | 'browser';
export type AIProvider = 'openrouter' | 'alibaba_qwen';

export interface AppSettings {
  show_playstore_modal?: boolean;
  playstore_modal_collect_emails?: boolean;
  primary_ai_provider?: AIProvider;
  openrouter_api_key?: string;
  openrouter_model?: string;
  openrouter_base_url?: string;
  alibaba_api_key?: string;
  alibaba_base_url?: string;
  alibaba_model?: string;
  active_voice_provider?: VoiceProvider;
  studyguide_voice_provider?: VoiceProvider;
  notebook_voice_provider?: VoiceProvider;
  alibaba_voice_model?: string;
  alibaba_voice_name?: string;
  grok_api_key?: string;
  grok_voice_id?: string;
  upload_center_uploads_enabled?: boolean;
  coming_soon_enabled?: boolean;
  paystack_public_key: string;
  custom_user_limit_rpm?: number;
  custom_user_limit_tpm?: number;
  usage_settings?: UsageSettings;
  support_email?: string;
  support_phone?: string;
  support_address?: string;
  youtube_api_key?: string;
  google_client_id?: string;
  google_api_key?: string;
  pinecone_api_key?: string;
  pinecone_index_name?: string;
  revenuecat_api_key_android?: string;
}

// Type for the new Notification System
export interface Notification {
  id: string;
  type: 'study_update' | 'exam_reminder' | 'welcome' | 'study_reminder' | 'study_partner_request' | 'messenger' | 'app_update' | 'general_info' | 'personal';
  title: string;
  message: string;
  timestamp: number;
  is_read: boolean;
  link?: string;
  route?: string; // App-internal route to navigate to
  audience?: 'all' | 'single';
  category?: 'general_info' | 'personal' | 'study_update' | 'exam_reminder' | 'welcome' | 'study_reminder' | 'study_partner_request' | 'messenger' | 'app_update';
  action_buttons?: { label: string; action: string; metadata?: any }[]; // For inline buttons like "Reply", "View"
  sender_id?: string; // Useful for replying directly to a user
}

// Type for the new Chat History System
export interface ChatConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: number;
  last_updated_at: number;
}

// Types for new Private Messaging System
export interface PrivateMessage {
    id: string;
    chat_id: string;
    sender_id: string;
    text?: string;
    timestamp: number;
    image_url?: string;
    audio_url?: string;
    audio_duration?: number;
    is_edited?: boolean;
    is_one_time_view?: boolean;
    viewed_by?: string[];
    reply_to?: {
        message_id: string;
        text?: string;
        image_url?: string;
        audio_url?: string;
        sender_id: string;
    };
    reactions?: Record<string, string>; // user_id -> emoji
    is_forwarded?: boolean;
    status?: 'sent' | 'delivered' | 'read';
}

export interface PrivateChat {
    id: string;
    members: string[]; // array of 2 user UIDs
    member_info: {
        [uid: string]: {
            display_name: string;
            photo_url?: string;
            is_online?: boolean;
            last_seen?: number;
        }
    };
    last_message?: {
        text: string;
        timestamp: number;
        sender_id: string;
        read_by: string[]; // Array of UIDs that have read this message
        status?: 'sent' | 'delivered' | 'read';
    };
    created_at: number;
    last_activity_timestamp: number;
    typing?: string[]; // Array of UIDs of users currently typing
    recording?: string[]; // Array of UIDs of users currently recording voice note
}


// Type for the new Toast Notification System
export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  message: string;
}

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  secure: boolean;
  from_email: string;
  from_name: string;
}

export interface HeaderConfig {
  title?: React.ReactNode;
  leftActions?: React.ReactNode;
  rightActions?: React.ReactNode;
  hideBottomNav?: boolean;
  hideTitle?: boolean;
  hideDefaultRightActions?: boolean;
  hideProfileAvatar?: boolean;
  className?: string;
  onNewChat?: () => void;
  onClearChat?: () => void;
  onDeleteChat?: () => void;
  hasActiveChat?: boolean;
  hasMessages?: boolean;
}