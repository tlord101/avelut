import type React from 'react';

export interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

export interface UserProfile {
  uid: string;
  display_name: string;
  photo_url?: string;
  department_id: string;
  level: string;
  current_streak: number;
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
}

export interface Course {
  course_id: string;
  course_name: string;
  topics: Topic[];
  level?: string; // The difficulty level this course belongs to
  semester?: 'first' | 'second'; // New field for semester categorization
}


export interface UserProgress {
  [topic_id: string]: {
    is_complete: boolean;
  };
}

// Type for the Dashboard data
export interface DashboardData {
    totalTopics: number;
    completedTopicsCount: number;
    examHistory: ExamHistoryItem[];
}

// Type for the new Notification System
export interface Notification {
  id: string;
  type: 'study_update' | 'exam_reminder' | 'welcome';
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