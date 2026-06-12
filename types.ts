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
  department_id: string;
  level: string;
  current_streak: number;
  last_streak_date?: string; // ISO date string 'YYYY-MM-DD' of the last day a streak was awarded
  last_activity_date: number; // Store as timestamp
  notifications_enabled: boolean;
  is_admin?: boolean; // New property for admin access
  is_online?: boolean;
  last_seen?: number;
  privacy_consent?: {
    granted: boolean;
    timestamp: number;
  };
  has_completed_tour?: boolean;
  is_activated?: boolean;
  subscription_status?: 'none' | 'free' | 'basic' | 'pro' | 'personal_token' | 'premium';
  personal_api_key?: string;
  use_personal_token?: boolean;
  paystack_reference?: string;
  selected_free_course_id?: string;
  fcm_token?: string;
  default_semester_tab?: string;
  ai_credits_balance?: number;
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
  options: string[];
  correctAnswer: string;
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
  topics: Topic[];
  level: string; // 100lvl, 200lvl, etc.
  semester?: 'first' | 'second';
  textbook_url?: string;
  textbook_urls?: string[];
  textbook_shared_key?: string;
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
    geminiAssessment?: DashboardAssessment | null;
    examHistory: ExamHistoryItem[];
}

export interface PlanLimit {
  courses: number;
}

export interface PlanConfig {
  name: string;
  description: string;
  price: number;
  monthly_ai_credits: number;
  limits: PlanLimit;
}

export interface UsageSettings {
  plans: {
    free: PlanConfig;
    basic: PlanConfig;
    pro: PlanConfig;
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

export interface AppSettings {
  primary_gemini_model: string;
  gemini_api_key: string;
  upload_center_uploads_enabled: boolean;
  coming_soon_enabled: boolean;
  paystack_public_key: string;
  paystack_secret_key: string;
  custom_user_limit_rpm: number;
  custom_user_limit_tpm: number;
  usage_settings?: UsageSettings;
  youtube_api_key?: string;
  google_client_id?: string;
  google_api_key?: string;
}

// Type for the new Notification System
export interface Notification {
  id: string;
  type: 'study_update' | 'exam_reminder' | 'welcome' | 'study_reminder';
  title: string;
  message: string;
  timestamp: number;
  is_read: boolean;
  link?: string;
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
    // FIX: Added chat_id to match database schema and resolve typing error.
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
    };
    created_at: number;
    last_activity_timestamp: number;
    typing?: string[]; // Array of UIDs of users currently typing
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