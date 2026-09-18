import { supabase } from '../lib/supabaseClient';

export interface MigrationFile {
  id: string;
  title: string;
  sql: string;
}

export interface AppliedMigration {
  id: string;
  applied_at: string;
  checksum?: string;
  success: boolean;
  details?: string;
}

export interface MigrationRunResult {
  success: boolean;
  appliedCount: number;
  skippedCount: number;
  failedMigrationId?: string;
  logs: string[];
}

// ── Curated Ordered Registry of Schema Migrations ──────────────────────────
export const EMBEDDED_MIGRATIONS: MigrationFile[] = [
  {
    id: '20260830000001_initial_avelut_schema.sql',
    title: 'Initial Avelut Schema',
    sql: `
-- ==============================================================================
-- AVELUT COMPLETE SUPABASE SCHEMA & ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- 1. Enable UUID Extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    full_name TEXT,
    username TEXT UNIQUE,
    avatar_url TEXT,
    school_id TEXT,
    school_name TEXT,
    college_id TEXT,
    department_id TEXT,
    department_name TEXT,
    level TEXT,
    xp INTEGER DEFAULT 0,
    streak INTEGER DEFAULT 0,
    last_active_date DATE DEFAULT CURRENT_DATE,
    ai_credits INTEGER DEFAULT 50,
    is_admin BOOLEAN DEFAULT FALSE,
    is_paid_subscriber BOOLEAN DEFAULT FALSE,
    fcm_token TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to automatically create profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS \$\$
BEGIN
    INSERT INTO public.profiles (
        id,
        email,
        full_name,
        avatar_url,
        username,
        created_at,
        updated_at
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url',
        LOWER(COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1) || '_' || SUBSTRING(NEW.id::text FROM 1 FOR 6))),
        NOW(),
        NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET
        email = EXCLUDED.email,
        updated_at = NOW();
    RETURN NEW;
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Academic Hierarchy Tables
CREATE TABLE IF NOT EXISTS public.schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_name TEXT,
    state TEXT,
    country TEXT DEFAULT 'Nigeria',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.colleges (
    id TEXT PRIMARY KEY,
    school_id TEXT REFERENCES public.schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    short_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.departments (
    id TEXT PRIMARY KEY,
    college_id TEXT REFERENCES public.colleges(id) ON DELETE CASCADE,
    school_id TEXT REFERENCES public.schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    short_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.courses (
    id TEXT PRIMARY KEY,
    department_id TEXT REFERENCES public.departments(id) ON DELETE SET NULL,
    school_id TEXT REFERENCES public.schools(id) ON DELETE SET NULL,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    level TEXT NOT NULL,
    semester INTEGER DEFAULT 1,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.topics (
    id TEXT PRIMARY KEY,
    course_id TEXT REFERENCES public.courses(id) ON DELETE CASCADE,
    topic_name TEXT NOT NULL,
    topic_order INTEGER DEFAULT 1,
    overview_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Past Questions Repository
CREATE TABLE IF NOT EXISTS public.past_questions (
    id TEXT PRIMARY KEY,
    department_id TEXT NOT NULL,
    level TEXT NOT NULL,
    course_id TEXT NOT NULL,
    year TEXT NOT NULL,
    questions_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dynamic System App Settings
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. User Progress & Learning Memory
CREATE TABLE IF NOT EXISTS public.user_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    course_id TEXT REFERENCES public.courses(id) ON DELETE CASCADE,
    topic_id TEXT REFERENCES public.topics(id) ON DELETE CASCADE,
    completed_boards INTEGER DEFAULT 0,
    total_boards INTEGER DEFAULT 10,
    is_mastered BOOLEAN DEFAULT FALSE,
    score INTEGER DEFAULT 0,
    last_studied_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS public.exam_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    department_id TEXT,
    course_id TEXT,
    exam_type TEXT,
    score INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    questions_json JSONB NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    action_url TEXT,
    metadata_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Messenger & Social Collaboration
CREATE TABLE IF NOT EXISTS public.messenger_conversations (
    id TEXT PRIMARY KEY,
    user1_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user2_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    last_message_preview TEXT,
    last_message_sender UUID REFERENCES public.profiles(id),
    last_message_time TIMESTAMPTZ DEFAULT NOW(),
    unread_user1 INTEGER DEFAULT 0,
    unread_user2 INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.messenger_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES public.messenger_conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    message_type TEXT DEFAULT 'text', -- 'text' | 'image' | 'voice' | 'file'
    text_content TEXT,
    media_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_delivered BOOLEAN DEFAULT FALSE,
    is_read BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS public.study_partners (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, partner_id)
);

-- 7. Subscriptions, Daily Topic Allowance & Paystack Tracking
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    plan_type TEXT DEFAULT 'free', -- 'free' | 'weekly' | 'monthly' | 'semester'
    status TEXT DEFAULT 'active', -- 'active' | 'expired' | 'cancelled'
    daily_topic_allowance INTEGER DEFAULT 1,
    topics_used_today INTEGER DEFAULT 0,
    last_reset_date DATE DEFAULT CURRENT_DATE,
    unlocked_topics_pack INTEGER DEFAULT 0,
    paystack_reference TEXT,
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- 8. Feedback & Support Reports
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    type TEXT NOT NULL, -- 'bug' | 'content_error' | 'feature_request' | 'feedback'
    title TEXT,
    details TEXT NOT NULL,
    context_data JSONB,
    status TEXT DEFAULT 'pending', -- 'pending' | 'reviewed' | 'resolved'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- INDEXES FOR HIGH QUERY PERFORMANCE
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_school_dept ON public.profiles(school_id, department_id);
CREATE INDEX IF NOT EXISTS idx_topics_course ON public.topics(course_id, topic_order);
CREATE INDEX IF NOT EXISTS idx_courses_dept ON public.courses(department_id, level);
CREATE INDEX IF NOT EXISTS idx_user_progress_user ON public.user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_history_user ON public.exam_history(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messenger_messages_convo ON public.messenger_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messenger_conv_users ON public.messenger_conversations(user1_id, user2_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.past_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messenger_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Public profiles are viewable by authenticated users"
ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Course Structure Policies (Public read for authenticated users)
CREATE POLICY "Schools readable by all authenticated" ON public.schools FOR SELECT TO authenticated USING (true);
CREATE POLICY "Colleges readable by all authenticated" ON public.colleges FOR SELECT TO authenticated USING (true);
CREATE POLICY "Departments readable by all authenticated" ON public.departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Courses readable by all authenticated" ON public.courses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Topics readable by all authenticated" ON public.topics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Past questions readable by authenticated" ON public.past_questions FOR SELECT TO authenticated USING (true);
CREATE POLICY "App settings readable by authenticated" ON public.app_settings FOR SELECT TO authenticated USING (true);

-- User Progress Policies
CREATE POLICY "Users can manage their own progress"
ON public.user_progress FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Exam History Policies
CREATE POLICY "Users can manage their own exam history"
ON public.exam_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Notifications Policies
CREATE POLICY "Users can view and update their own notifications"
ON public.notifications FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Messenger Conversations Policies
CREATE POLICY "Users can view conversations they belong to"
ON public.messenger_conversations FOR SELECT TO authenticated
USING (auth.uid() = user1_id OR auth.uid() = user2_id);

CREATE POLICY "Users can create or update their conversations"
ON public.messenger_conversations FOR ALL TO authenticated
USING (auth.uid() = user1_id OR auth.uid() = user2_id)
WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);

-- Messenger Messages Policies
CREATE POLICY "Users can view messages sent or received"
ON public.messenger_messages FOR SELECT TO authenticated
USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can send messages"
ON public.messenger_messages FOR INSERT TO authenticated
WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Users can update received messages"
ON public.messenger_messages FOR UPDATE TO authenticated
USING (auth.uid() = recipient_id OR auth.uid() = sender_id);

-- Study Partners Policies
CREATE POLICY "Users can manage their study partners"
ON public.study_partners FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Subscriptions Policies
CREATE POLICY "Users can view their own subscription"
ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own subscription"
ON public.subscriptions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reports Policies
CREATE POLICY "Users can submit reports"
ON public.reports FOR INSERT TO authenticated WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Admins can view reports"
ON public.reports FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- ==============================================================================
-- 9. STORAGE BUCKETS & STORAGE POLICIES
-- ==============================================================================

-- A. Profile Avatars Bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile_avatars', 'profile_avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile_avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- B. Solution Shares Bucket (For Visual Solver solution forwarding)
INSERT INTO storage.buckets (id, name, public)
VALUES ('solution_shares', 'solution_shares', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Solution share images are viewable by authenticated users"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'solution_shares');

CREATE POLICY "Users can upload solution share images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'solution_shares' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ==============================================================================
-- 10. ENABLE SUPABASE REALTIME BROADCASTING
-- ==============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messenger_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messenger_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_progress;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
`
  },
  {
    id: '20260831000001_complete_supabase_transition.sql',
    title: 'Complete Supabase Transition',
    sql: `
-- ==============================================================================
-- AVELUT COMPLETE SUPABASE TRANSITION MIGRATION
-- ==============================================================================

-- 1. App Settings Table
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "App settings readable by all"
ON public.app_settings FOR SELECT USING (true);

CREATE POLICY "Admins can update app settings"
ON public.app_settings FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- 2. Textbooks & Course Materials Table
CREATE TABLE IF NOT EXISTS public.materials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    course_code TEXT,
    course_id TEXT REFERENCES public.courses(id) ON DELETE SET NULL,
    department_id TEXT REFERENCES public.departments(id) ON DELETE SET NULL,
    school_id TEXT REFERENCES public.schools(id) ON DELETE SET NULL,
    level TEXT,
    file_url TEXT NOT NULL,
    file_type TEXT DEFAULT 'pdf', -- 'pdf' | 'epub' | 'docx' | 'image'
    file_size_bytes BIGINT,
    page_count INTEGER,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploader_name TEXT,
    download_count INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Materials are viewable by all authenticated users"
ON public.materials FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can upload course materials"
ON public.materials FOR INSERT TO authenticated WITH CHECK (auth.uid() = uploaded_by);

CREATE POLICY "Users can update their own materials or admins"
ON public.materials FOR UPDATE TO authenticated
USING (auth.uid() = uploaded_by OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- 3. Usage & AI Credits Audit Log Table
CREATE TABLE IF NOT EXISTS public.usage_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    credits_spent INTEGER NOT NULL DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    model TEXT,
    provider TEXT,
    details_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own usage records"
ON public.usage_records FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own usage records"
ON public.usage_records FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 4. Atomic PostgreSQL RPC Functions for Credits, XP, and Streaks

-- A. Deduct AI Credits atomically
CREATE OR REPLACE FUNCTION public.deduct_user_credits(
    p_user_id UUID,
    p_amount INTEGER
)
RETURNS JSONB AS \$\$
DECLARE
    v_current_credits INT;
    v_new_credits INT;
    v_is_admin BOOLEAN;
BEGIN
    SELECT ai_credits, is_admin INTO v_current_credits, v_is_admin
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    -- Admins have unlimited credits
    IF v_is_admin IS TRUE THEN
        RETURN jsonb_build_object('success', true, 'remaining_credits', v_current_credits, 'unlimited', true);
    END IF;

    IF v_current_credits < p_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits', 'current_credits', v_current_credits);
    END IF;

    v_new_credits := v_current_credits - p_amount;

    UPDATE public.profiles
    SET ai_credits = v_new_credits, updated_at = NOW()
    WHERE id = p_user_id;

    RETURN jsonb_build_object('success', true, 'remaining_credits', v_new_credits);
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

-- B. Increment AI Credits atomically (e.g. refills, rewards)
CREATE OR REPLACE FUNCTION public.increment_user_credits(
    p_user_id UUID,
    p_amount INTEGER
)
RETURNS JSONB AS \$\$
DECLARE
    v_new_credits INT;
BEGIN
    UPDATE public.profiles
    SET ai_credits = COALESCE(ai_credits, 0) + p_amount, updated_at = NOW()
    WHERE id = p_user_id
    RETURNING ai_credits INTO v_new_credits;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    RETURN jsonb_build_object('success', true, 'credits', v_new_credits);
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

-- C. Increment User XP atomically
CREATE OR REPLACE FUNCTION public.increment_user_xp(
    p_user_id UUID,
    p_amount INTEGER
)
RETURNS JSONB AS \$\$
DECLARE
    v_new_xp INT;
BEGIN
    UPDATE public.profiles
    SET xp = COALESCE(xp, 0) + p_amount, updated_at = NOW()
    WHERE id = p_user_id
    RETURNING xp INTO v_new_xp;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    RETURN jsonb_build_object('success', true, 'xp', v_new_xp);
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

-- D. Update Daily Streak atomically
CREATE OR REPLACE FUNCTION public.update_daily_streak(
    p_user_id UUID
)
RETURNS JSONB AS \$\$
DECLARE
    v_last_active DATE;
    v_streak INT;
    v_today DATE := CURRENT_DATE;
BEGIN
    SELECT last_active_date, COALESCE(streak, 0) INTO v_last_active, v_streak
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User not found');
    END IF;

    IF v_last_active IS NULL OR v_last_active < v_today - INTERVAL '1 day' THEN
        -- Streak broke or first activity
        v_streak := 1;
    ELSIF v_last_active = v_today - INTERVAL '1 day' THEN
        -- Consecutive active day
        v_streak := v_streak + 1;
    END IF;
    -- If v_last_active = v_today, streak remains unchanged

    UPDATE public.profiles
    SET streak = v_streak, last_active_date = v_today, updated_at = NOW()
    WHERE id = p_user_id;

    RETURN jsonb_build_object('success', true, 'streak', v_streak, 'last_active_date', v_today);
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Course Materials Storage Bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('materials', 'materials', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Materials files are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'materials');

CREATE POLICY "Authenticated users can upload materials"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'materials');

CREATE POLICY "Users can manage their uploaded materials"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'materials' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 6. Add Realtime Publications
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.materials;
`
  },
  {
    id: '20260905_messenger_notifications.sql',
    title: 'Messenger Notifications',
    sql: `
-- Avelut: Messenger + notifications on Supabase (Realtime / WebSockets)
-- Safe to re-run. Compatible with existing \`reports.reporter_id\` column.

-- Chats (1:1 for now; extendable to groups)
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  is_group boolean default false,
  title text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.chat_members (
  chat_id uuid references public.chats(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  other_user_id uuid,
  last_message_text text,
  last_message_at timestamptz,
  last_message_sender_id uuid,
  last_message_is_read boolean default true,
  unread_count int default 0,
  created_at timestamptz default now(),
  primary key (chat_id, user_id)
);

create index if not exists chat_members_user_idx on public.chat_members(user_id);
create index if not exists chat_members_updated_idx on public.chat_members(user_id, last_message_at desc nulls last);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  text text,
  media_url text,
  media_type text,
  reply_to uuid references public.messages(id) on delete set null,
  is_deleted boolean default false,
  created_at timestamptz default now()
);

create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  body text,
  type text default 'general',
  data jsonb default '{}'::jsonb,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- reports may already exist with reporter_id (not reporter_uid)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id),
  reported_id uuid,
  chat_id uuid,
  reason text,
  created_at timestamptz default now()
);

-- Ensure expected columns exist on legacy reports tables
do \$\$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'reports'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_id'
    ) and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_uid'
    ) then
      alter table public.reports rename column reporter_uid to reporter_id;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reporter_id'
    ) then
      alter table public.reports add column reporter_id uuid references auth.users(id);
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reported_id'
    ) then
      alter table public.reports add column reported_id uuid;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'chat_id'
    ) then
      alter table public.reports add column chat_id uuid;
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'reason'
    ) then
      alter table public.reports add column reason text;
    end if;
  end if;
end \$\$;

create table if not exists public.study_partners (
  user_id uuid references auth.users(id) on delete cascade,
  partner_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, partner_id)
);

create table if not exists public.user_blocks (
  user_id uuid references auth.users(id) on delete cascade,
  blocked_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, blocked_id)
);

-- Presence columns on profiles (if table exists)
do \$\$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='profiles') then
    alter table public.profiles add column if not exists is_online boolean default false;
    alter table public.profiles add column if not exists last_seen timestamptz;
  end if;
end \$\$;

-- RLS
alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.study_partners enable row level security;
alter table public.user_blocks enable row level security;

drop policy if exists chat_members_select on public.chat_members;
create policy chat_members_select on public.chat_members for select using (auth.uid() = user_id);

drop policy if exists chat_members_all on public.chat_members;
create policy chat_members_all on public.chat_members for all using (auth.uid() = user_id);

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (
  exists (select 1 from public.chat_members m where m.chat_id = messages.chat_id and m.user_id = auth.uid())
);

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert with check (
  auth.uid() = sender_id and
  exists (select 1 from public.chat_members m where m.chat_id = messages.chat_id and m.user_id = auth.uid())
);

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update using (auth.uid() = sender_id);

drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications for all using (auth.uid() = user_id);

-- Use reporter_id (existing column name in your DB)
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert with check (auth.uid() = reporter_id);

drop policy if exists study_partners_own on public.study_partners;
create policy study_partners_own on public.study_partners for all using (auth.uid() = user_id);

drop policy if exists user_blocks_own on public.user_blocks;
create policy user_blocks_own on public.user_blocks for all using (auth.uid() = user_id);

drop policy if exists chats_select on public.chats;
create policy chats_select on public.chats for select using (
  exists (select 1 from public.chat_members m where m.chat_id = chats.id and m.user_id = auth.uid())
);

drop policy if exists chats_insert on public.chats;
create policy chats_insert on public.chats for insert with check (true);

-- Realtime publication (ignore if already added)
do \$\$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.chat_members;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.profiles;
  exception when duplicate_object then null;
  end;
end \$\$;
`
  },
  {
    id: '20260905_reports_policy_fix.sql',
    title: 'Reports Policy Fix',
    sql: `
-- Quick fix only: run this if the big migration failed on reports_insert policy.
-- Your DB already has reports.reporter_id (not reporter_uid).

drop policy if exists reports_insert on public.reports;

create policy reports_insert on public.reports
  for insert
  with check (auth.uid() = reporter_id);
`
  },
  {
    id: '20260906_create_app_kv.sql',
    title: 'Create App Kv',
    sql: `
﻿-- ==============================================================================
-- Migration: Create app_kv table for key-value storage and settings
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_kv (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;

-- Allow public read access to app_kv
CREATE POLICY "Allow public read on app_kv"
ON public.app_kv FOR SELECT USING (true);

-- Allow authenticated users to insert/update app_kv
CREATE POLICY "Allow authenticated insert/update on app_kv"
ON public.app_kv FOR ALL TO authenticated
USING (true)
WITH CHECK (true);

-- Allow anon to read/write app_kv if needed (e.g. app_updates, theme before login)
CREATE POLICY "Allow anon insert/update on app_kv"
ON public.app_kv FOR ALL TO anon
USING (true)
WITH CHECK (true);
`
  },
  {
    id: '20260906_fix_notifications_and_study_partners_rls.sql',
    title: 'Fix Notifications And Study Partners Rls',
    sql: `
﻿-- Migration: Fix notifications and study_partners RLS policies
-- Prevents 403 Forbidden when sending partner request notifications or creating mutual study connections

-- 1. Notifications policies
DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
DROP POLICY IF EXISTS notifications_own ON public.notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;

CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id OR auth.role() = 'anon');
CREATE POLICY "Anyone can insert notifications" ON public.notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- 2. Study partners policies
DROP POLICY IF EXISTS "study_partners_own" ON public.study_partners;
DROP POLICY IF EXISTS study_partners_own ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_select" ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_insert" ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_delete" ON public.study_partners;

CREATE POLICY "study_partners_select" ON public.study_partners FOR SELECT USING (auth.uid() = user_id OR auth.uid() = partner_id);
CREATE POLICY "study_partners_insert" ON public.study_partners FOR INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() = partner_id);
CREATE POLICY "study_partners_delete" ON public.study_partners FOR DELETE USING (auth.uid() = user_id OR auth.uid() = partner_id);
`
  },
  {
    id: '20260908_create_topic_teaching_structures_and_views.sql',
    title: 'Create Topic Teaching Structures And Views',
    sql: `
-- ==============================================================================
-- Migration: Create topic_teaching_structures and user_topic_views tables
-- ==============================================================================

-- 1. Create topic_teaching_structures table
CREATE TABLE IF NOT EXISTS public.topic_teaching_structures (
    topic_key TEXT PRIMARY KEY,
    topic_title TEXT NOT NULL,
    course_name TEXT DEFAULT 'General',
    duration_mode INTEGER DEFAULT 30,
    structure_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.topic_teaching_structures ENABLE ROW LEVEL SECURITY;

-- Allow public read access to topic_teaching_structures (authenticated & anon)
DROP POLICY IF EXISTS "Allow public read on topic_teaching_structures" ON public.topic_teaching_structures;
CREATE POLICY "Allow public read on topic_teaching_structures"
ON public.topic_teaching_structures FOR SELECT USING (true);

-- Allow authenticated & anon to insert/update topic_teaching_structures
DROP POLICY IF EXISTS "Allow public insert/update on topic_teaching_structures" ON public.topic_teaching_structures;
CREATE POLICY "Allow public insert/update on topic_teaching_structures"
ON public.topic_teaching_structures FOR ALL
USING (true)
WITH CHECK (true);

-- 2. Create user_topic_views table
CREATE TABLE IF NOT EXISTS public.user_topic_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    course_name TEXT DEFAULT 'General',
    topic_key TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT user_topic_views_user_topic_key UNIQUE (user_id, topic_key)
);

ALTER TABLE public.user_topic_views ENABLE ROW LEVEL SECURITY;

-- Allow public read access to user_topic_views
DROP POLICY IF EXISTS "Allow public read on user_topic_views" ON public.user_topic_views;
CREATE POLICY "Allow public read on user_topic_views"
ON public.user_topic_views FOR SELECT USING (true);

-- Allow public insert/update on user_topic_views
DROP POLICY IF EXISTS "Allow public insert/update on user_topic_views" ON public.user_topic_views;
CREATE POLICY "Allow public insert/update on user_topic_views"
ON public.user_topic_views FOR ALL
USING (true)
WITH CHECK (true);

-- 3. Ensure live_tutorial_minutes column exists on profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS live_tutorial_minutes INTEGER DEFAULT 120;
`
  },
  {
    id: '20260908_fix_study_partners_upsert_rls.sql',
    title: 'Fix Study Partners Upsert Rls',
    sql: `
-- Migration: Fix study_partners upsert RLS — add UPDATE policy
-- The previous migration only created SELECT, INSERT, DELETE policies.
-- Supabase .upsert() uses INSERT ... ON CONFLICT DO UPDATE which requires an UPDATE policy.
-- This consolidates into a single FOR ALL policy.

-- Drop all existing individual policies
DROP POLICY IF EXISTS "study_partners_select" ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_insert" ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_delete" ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_update" ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_own" ON public.study_partners;
DROP POLICY IF EXISTS "study_partners_all" ON public.study_partners;

-- Create single permissive policy for all operations
CREATE POLICY "study_partners_all" ON public.study_partners
  FOR ALL TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = partner_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = partner_id);
`
  },
  {
    id: '20260909_fix_messenger_delivery.sql',
    title: 'Fix Messenger Delivery',
    sql: `
-- Make direct chats and message delivery atomic under RLS.

alter table public.chats add column if not exists direct_key text;
create unique index if not exists chats_direct_key_unique
  on public.chats (direct_key)
  where direct_key is not null;

create or replace function public.get_or_create_direct_chat(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as \$\$
declare
  v_user_id uuid := auth.uid();
  v_chat_id uuid;
  v_direct_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  if p_other_user_id is null or p_other_user_id = v_user_id then
    raise exception 'A different recipient is required';
  end if;

  if not exists (select 1 from auth.users where id = p_other_user_id) then
    raise exception 'Recipient does not exist';
  end if;

  v_direct_key := least(v_user_id::text, p_other_user_id::text) || ':' || greatest(v_user_id::text, p_other_user_id::text);

  select id into v_chat_id
  from public.chats
  where direct_key = v_direct_key;

  if v_chat_id is null then
    insert into public.chats (direct_key)
    values (v_direct_key)
    on conflict (direct_key) where direct_key is not null do update
    set direct_key = excluded.direct_key
    returning id into v_chat_id;
  end if;

  insert into public.chat_members (chat_id, user_id, other_user_id)
  values
    (v_chat_id, v_user_id, p_other_user_id),
    (v_chat_id, p_other_user_id, v_user_id)
  on conflict (chat_id, user_id) do update
  set other_user_id = excluded.other_user_id;

  return v_chat_id;
end;
\$\$;

create or replace function public.send_chat_message(
  p_chat_id uuid,
  p_message_id uuid,
  p_sender_id uuid,
  p_text text,
  p_media_url text,
  p_media_type text,
  p_reply_to uuid,
  p_created_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as \$\$
declare
  v_created_at timestamptz := coalesce(p_created_at, now());
  v_summary text;
  v_inserted_message_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_sender_id then
    raise exception 'Sender must be the authenticated user';
  end if;

  if not exists (
    select 1
    from public.chat_members
    where chat_id = p_chat_id and user_id = p_sender_id
  ) then
    raise exception 'Sender is not a chat member';
  end if;

  insert into public.messages (
    id,
    chat_id,
    sender_id,
    text,
    media_url,
    media_type,
    reply_to,
    created_at
  )
  values (
    p_message_id,
    p_chat_id,
    p_sender_id,
    coalesce(p_text, ''),
    p_media_url,
    p_media_type,
    p_reply_to,
    v_created_at
  )
  on conflict (id) do nothing
  returning id into v_inserted_message_id;

  if v_inserted_message_id is null then
    return;
  end if;

  v_summary := case
    when p_media_type = 'voice' then 'Voice message'
    when p_media_type = 'image' then 'Image file'
    when p_media_type = 'file' then 'Document file'
    when coalesce(p_text, '') <> '' then p_text
    else 'Media'
  end;

  update public.chat_members
  set
    last_message_text = v_summary,
    last_message_at = v_created_at,
    last_message_sender_id = p_sender_id,
    last_message_is_read = user_id = p_sender_id,
    unread_count = case
      when user_id = p_sender_id then 0
      else unread_count + 1
    end
  where chat_id = p_chat_id;
end;
\$\$;

revoke all on function public.get_or_create_direct_chat(uuid) from public;
revoke all on function public.send_chat_message(uuid, uuid, uuid, text, text, text, uuid, timestamptz) from public;
grant execute on function public.get_or_create_direct_chat(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, uuid, uuid, text, text, text, uuid, timestamptz) to authenticated;

-- The RPCs above exclusively create memberships and update recipient previews.
-- Clients may only update or hide their own inbox entry.
drop policy if exists chat_members_all on public.chat_members;
drop policy if exists chat_members_insert on public.chat_members;
drop policy if exists chat_members_update on public.chat_members;
drop policy if exists chat_members_delete on public.chat_members;
create policy chat_members_update on public.chat_members
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy chat_members_delete on public.chat_members
  for delete using (auth.uid() = user_id);

-- Message body/content cannot be inserted or edited through the client;
-- senders may only soft-delete their own messages.
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update using (auth.uid() = sender_id)
  with check (auth.uid() = sender_id and is_deleted = true);

drop policy if exists chats_insert on public.chats;
create policy chats_insert on public.chats
  for insert with check (false);
`
  },
  {
    id: '20260911_lesson_prep_cloud.sql',
    title: 'Lesson Prep Cloud',
    sql: `
-- ============================================================
-- Avelut: Cloud lesson package generation
-- Run in Supabase Dashboard → SQL Editor (as postgres / service)
-- Project: eywpksapztzbnthlgfhd
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lesson_prep_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_key          text NOT NULL,
  user_id           text NOT NULL,
  topic_title       text NOT NULL,
  course_name       text,
  syllabus_context  text,
  duration_mode     smallint NOT NULL CHECK (duration_mode IN (15, 30, 60)),
  voice             text NOT NULL DEFAULT 'Altair',
  content_hash      text,
  model_version     text NOT NULL DEFAULT 'v1',
  status            text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'running', 'uploading', 'ready', 'failed', 'cancelled')),
  phase             text NOT NULL DEFAULT 'queued'
                    CHECK (phase IN ('queued', 'structure', 'boards', 'tts', 'upload', 'ready', 'failed')),
  total_boards      int NOT NULL DEFAULT 0,
  next_board_index  int NOT NULL DEFAULT 0,
  completed_boards  int NOT NULL DEFAULT 0,
  progress_percent  int NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  message           text,
  last_error        text,
  attempt_count     int NOT NULL DEFAULT 0,
  max_attempts      int NOT NULL DEFAULT 5,
  locked_at         timestamptz,
  locked_by         text,
  priority          int NOT NULL DEFAULT 100,
  storage_prefix    text,
  structure_path    text,
  manifest_path     text,
  package_bytes     bigint,
  charged           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz,
  ready_at          timestamptz,
  failed_at         timestamptz,
  UNIQUE (prep_key)
);

CREATE INDEX IF NOT EXISTS idx_lesson_prep_jobs_status_priority
  ON public.lesson_prep_jobs (status, priority, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_lesson_prep_jobs_user
  ON public.lesson_prep_jobs (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_prep_jobs_content_hash
  ON public.lesson_prep_jobs (content_hash, duration_mode, voice, model_version)
  WHERE status = 'ready';

CREATE TABLE IF NOT EXISTS public.lesson_packages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_key          text NOT NULL UNIQUE,
  user_id           text NOT NULL,
  topic_title       text NOT NULL,
  course_name       text,
  duration_mode     smallint NOT NULL,
  voice             text NOT NULL,
  content_hash      text,
  model_version     text NOT NULL DEFAULT 'v1',
  total_boards      int NOT NULL,
  storage_prefix    text NOT NULL,
  structure_path    text NOT NULL,
  manifest_path     text NOT NULL,
  package_bytes     bigint,
  checksum_sha256   text,
  status            text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'expired', 'deleted')),
  ready_at          timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_packages_user
  ON public.lesson_packages (user_id, ready_at DESC);

CREATE TABLE IF NOT EXISTS public.lesson_package_boards (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prep_key          text NOT NULL,
  board_index       int NOT NULL,
  board_number      int NOT NULL,
  board_path        text NOT NULL,
  audio_path        text,
  has_speech        boolean NOT NULL DEFAULT false,
  is_valid          boolean NOT NULL DEFAULT true,
  checksum_sha256   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prep_key, board_index)
);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS \$\$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
\$\$;

DROP TRIGGER IF EXISTS trg_lesson_prep_jobs_updated ON public.lesson_prep_jobs;
CREATE TRIGGER trg_lesson_prep_jobs_updated
  BEFORE UPDATE ON public.lesson_prep_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_lesson_prep_job(p_worker_id text)
RETURNS SETOF public.lesson_prep_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \$\$
DECLARE
  job public.lesson_prep_jobs;
BEGIN
  UPDATE public.lesson_prep_jobs
  SET status = 'queued', locked_at = NULL, locked_by = NULL,
      message = 'Requeued after stale lock'
  WHERE status = 'running'
    AND locked_at IS NOT NULL
    AND locked_at < now() - interval '15 minutes';

  SELECT * INTO job
  FROM public.lesson_prep_jobs
  WHERE status = 'queued'
    AND attempt_count < max_attempts
  ORDER BY priority ASC, created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.lesson_prep_jobs
  SET status = 'running',
      locked_at = now(),
      locked_by = p_worker_id,
      attempt_count = attempt_count + 1,
      started_at = COALESCE(started_at, now()),
      message = 'Worker claimed job'
  WHERE id = job.id
  RETURNING * INTO job;

  RETURN NEXT job;
END;
\$\$;

ALTER TABLE public.lesson_prep_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_package_boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lesson_prep_jobs_select_own ON public.lesson_prep_jobs;
CREATE POLICY lesson_prep_jobs_select_own ON public.lesson_prep_jobs
  FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS lesson_packages_select_own ON public.lesson_packages;
CREATE POLICY lesson_packages_select_own ON public.lesson_packages
  FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS lesson_package_boards_select_own ON public.lesson_package_boards;
CREATE POLICY lesson_package_boards_select_own ON public.lesson_package_boards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.lesson_prep_jobs j
      WHERE j.prep_key = lesson_package_boards.prep_key
        AND j.user_id = auth.uid()::text
    )
  );

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON public.lesson_prep_jobs TO authenticated;
GRANT SELECT ON public.lesson_packages TO authenticated;
GRANT SELECT ON public.lesson_package_boards TO authenticated;
GRANT ALL ON public.lesson_prep_jobs TO service_role;
GRANT ALL ON public.lesson_packages TO service_role;
GRANT ALL ON public.lesson_package_boards TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_lesson_prep_job(text) TO service_role;

-- Create Storage bucket lesson-packages (private) in Dashboard → Storage
`
  },
  {
    id: '20260912_live_tutorial_redesign.sql',
    title: 'Live Tutorial Redesign',
    sql: `
-- ============================================================
-- Avelut: Live Tutorial Redesign Schema & RPC Migration
-- ============================================================

-- Topic teaching structure (one per topic + course + duration)
CREATE TABLE IF NOT EXISTS public.topic_teaching_structures (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_key         text NOT NULL,
  topic_title       text NOT NULL,
  course_name       text,
  duration_minutes  int NOT NULL CHECK (duration_minutes IN (15, 30, 60)),
  content_hash      text,
  structure_json    jsonb NOT NULL,
  board_count       int NOT NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS duration_minutes int NOT NULL DEFAULT 30;
ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS duration_mode int DEFAULT 30;
ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS course_name text DEFAULT '';
ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS board_count int NOT NULL DEFAULT 0;
ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.topic_teaching_structures ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.topic_teaching_structures 
SET duration_minutes = COALESCE(duration_minutes, duration_mode, 30) 
WHERE duration_minutes IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_teaching_structures_unique
  ON public.topic_teaching_structures (topic_key, duration_minutes, COALESCE(course_name, ''));

-- Live minute pools (server source of truth for weekly/monthly minute usage)
CREATE TABLE IF NOT EXISTS public.live_minute_pools (
  user_id     text NOT NULL,
  period_key  text NOT NULL,
  used_minutes int NOT NULL DEFAULT 0,
  updated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, period_key)
);

-- Atomic RPC to deduct user credits
CREATE OR REPLACE FUNCTION public.deduct_user_credits(p_user_id text, p_amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \$\$
DECLARE
  v_current int;
  v_new int;
BEGIN
  SELECT COALESCE(ai_credits, 0) INTO v_current
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
  END IF;

  IF v_current < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient credits balance', 'remaining_credits', v_current);
  END IF;

  v_new := v_current - p_amount;

  UPDATE public.profiles
  SET ai_credits = v_new,
      updated_at = now()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true, 'remaining_credits', v_new);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
\$\$;

-- Atomic RPC to consume live tutorial minutes
CREATE OR REPLACE FUNCTION public.consume_live_tutorial_minutes(
  p_user_id text,
  p_period_key text,
  p_minutes int,
  p_allowance int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS \$\$
DECLARE
  v_used int := 0;
  v_remaining int := 0;
BEGIN
  INSERT INTO public.live_minute_pools (user_id, period_key, used_minutes, updated_at)
  VALUES (p_user_id, p_period_key, 0, now())
  ON CONFLICT (user_id, period_key) DO NOTHING;

  SELECT used_minutes INTO v_used
  FROM public.live_minute_pools
  WHERE user_id = p_user_id AND period_key = p_period_key
  FOR UPDATE;

  v_remaining := GREATEST(0, p_allowance - v_used);

  IF v_remaining < p_minutes THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient live tutorial minutes in pool', 'remaining_minutes', v_remaining);
  END IF;

  UPDATE public.live_minute_pools
  SET used_minutes = used_minutes + p_minutes,
      updated_at = now()
  WHERE user_id = p_user_id AND period_key = p_period_key;

  RETURN jsonb_build_object('success', true, 'used_minutes', v_used + p_minutes, 'remaining_minutes', p_allowance - (v_used + p_minutes));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
\$\$;

-- RLS policies
ALTER TABLE public.topic_teaching_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_minute_pools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS topic_teaching_structures_read_authenticated ON public.topic_teaching_structures;
CREATE POLICY topic_teaching_structures_read_authenticated ON public.topic_teaching_structures
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS live_minute_pools_own ON public.live_minute_pools;
CREATE POLICY live_minute_pools_own ON public.live_minute_pools
  FOR ALL USING (auth.uid()::text = user_id);

GRANT SELECT ON public.topic_teaching_structures TO authenticated;
GRANT ALL ON public.topic_teaching_structures TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.live_minute_pools TO authenticated;
GRANT ALL ON public.live_minute_pools TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_user_credits(text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_live_tutorial_minutes(text, text, int, int) TO authenticated, service_role;
`
  },
  {
    id: '20260913_playground_tables.sql',
    title: 'Playground Tables',
    sql: `
-- ============================================================
-- Avelut: Playground Supabase Database Schema Migration
-- ============================================================

-- Shared catalog of past question packs
CREATE TABLE IF NOT EXISTS public.past_question_packs (
  id              text PRIMARY KEY,
  title           text NOT NULL,
  course_code     text,
  course_name     text,
  year            text,
  type            text NOT NULL DEFAULT 'mcq',
  question_count  int NOT NULL DEFAULT 0,
  questions       jsonb NOT NULL,
  published       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

-- User flashcard decks
CREATE TABLE IF NOT EXISTS public.user_flashcard_decks (
  id          text PRIMARY KEY,
  user_id     text NOT NULL,
  title       text NOT NULL,
  topic_name  text,
  cards       jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- User CBT practice exams
CREATE TABLE IF NOT EXISTS public.user_cbt_exams (
  id               text PRIMARY KEY,
  user_id          text NOT NULL,
  title            text NOT NULL,
  topic_name       text,
  duration_minutes int NOT NULL DEFAULT 15,
  questions        jsonb NOT NULL,
  created_at       timestamptz DEFAULT now()
);

-- User CBT exam attempts
CREATE TABLE IF NOT EXISTS public.user_cbt_attempts (
  id              text PRIMARY KEY,
  user_id         text NOT NULL,
  exam_id         text NOT NULL,
  answers         jsonb NOT NULL,
  score           int NOT NULL,
  total_questions int NOT NULL,
  completed_at    bigint NOT NULL,
  created_at      timestamptz DEFAULT now()
);

-- AI theory solutions cache
CREATE TABLE IF NOT EXISTS public.theory_solutions (
  id                 text PRIMARY KEY, -- packId::questionId
  pack_id            text NOT NULL,
  question_id        text NOT NULL,
  solution_markdown  text NOT NULL,
  created_at         timestamptz DEFAULT now()
);

-- RLS Enablement
ALTER TABLE public.past_question_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_cbt_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_cbt_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theory_solutions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS past_question_packs_read ON public.past_question_packs;
CREATE POLICY past_question_packs_read ON public.past_question_packs
  FOR SELECT TO authenticated, anon USING (published = true);

DROP POLICY IF EXISTS user_flashcard_decks_own ON public.user_flashcard_decks;
CREATE POLICY user_flashcard_decks_own ON public.user_flashcard_decks
  FOR ALL USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS user_cbt_exams_own ON public.user_cbt_exams;
CREATE POLICY user_cbt_exams_own ON public.user_cbt_exams
  FOR ALL USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS user_cbt_attempts_own ON public.user_cbt_attempts;
CREATE POLICY user_cbt_attempts_own ON public.user_cbt_attempts
  FOR ALL USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS theory_solutions_read ON public.theory_solutions;
CREATE POLICY theory_solutions_read ON public.theory_solutions
  FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS theory_solutions_insert ON public.theory_solutions;
CREATE POLICY theory_solutions_insert ON public.theory_solutions
  FOR INSERT TO authenticated WITH CHECK (true);

-- Grants
GRANT SELECT ON public.past_question_packs TO authenticated, anon;
GRANT ALL ON public.user_flashcard_decks TO authenticated;
GRANT ALL ON public.user_cbt_exams TO authenticated;
GRANT ALL ON public.user_cbt_attempts TO authenticated;
GRANT SELECT, INSERT ON public.theory_solutions TO authenticated, anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
`
  },
  {
    id: '20260914_create_exec_sql.sql',
    title: 'Create Exec Sql',
    sql: `
CREATE OR REPLACE FUNCTION public.exec_sql(query text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS \$\$ BEGIN EXECUTE query; END; \$\$; REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated;
`
  }
];

export const BOOTSTRAP_SQL = `-- ==============================================================================
-- 1. Create exec_sql RPC function (Required for Web-based Migrations)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  EXECUTE query;
END;
$$;

REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated, anon, service_role;

-- ==============================================================================
-- 2. Create schema_migrations tracking table
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz DEFAULT now(),
  checksum text,
  success boolean DEFAULT true,
  details text
);

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schema_migrations_read" ON public.schema_migrations;
CREATE POLICY "schema_migrations_read" ON public.schema_migrations FOR SELECT USING (true);

DROP POLICY IF EXISTS "schema_migrations_write" ON public.schema_migrations;
CREATE POLICY "schema_migrations_write" ON public.schema_migrations FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);
`;

export function getAllMigrationsSql(): string {
  return [
    BOOTSTRAP_SQL,
    '-- ==============================================================================',
    '-- PENDING MIGRATIONS',
    '-- ==============================================================================',
    ...EMBEDDED_MIGRATIONS.map((m) => `-- >>> [${m.id}] ${m.title}\n${m.sql.trim()}`)
  ].join('\n\n');
}

export async function checkExecSqlAvailability(): Promise<{
  available: boolean;
  message?: string;
}> {
  try {
    const { error } = await supabase.rpc('exec_sql', { query: 'SELECT 1;' });
    if (error) {
      if (error.code === 'PGRST202' || error.message?.includes('Could not find the function')) {
        return {
          available: false,
          message: 'RPC function "public.exec_sql" does not exist in the database schema cache.',
        };
      }
      return { available: false, message: error.message };
    }
    return { available: true };
  } catch (err: any) {
    return { available: false, message: err?.message || String(err) };
  }
}

export async function ensureMigrationTable(): Promise<boolean> {
  const check = await checkExecSqlAvailability();
  if (!check.available) {
    return false;
  }

  try {
    const { error } = await supabase.rpc('exec_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
          id text PRIMARY KEY,
          applied_at timestamptz DEFAULT now(),
          checksum text,
          success boolean DEFAULT true,
          details text
        );
        ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
        DROP POLICY IF EXISTS "schema_migrations_read" ON public.schema_migrations;
        CREATE POLICY "schema_migrations_read" ON public.schema_migrations FOR SELECT USING (true);
        DROP POLICY IF EXISTS "schema_migrations_write" ON public.schema_migrations;
        CREATE POLICY "schema_migrations_write" ON public.schema_migrations FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);
      `
    });

    return !error;
  } catch (e) {
    console.warn('[MigrationRunner] ensureMigrationTable exception:', e);
    return false;
  }
}

export async function getMigrationStatus(): Promise<{
  applied: AppliedMigration[];
  pending: MigrationFile[];
  isExecSqlAvailable: boolean;
}> {
  const { available } = await checkExecSqlAvailability();
  if (available) {
    await ensureMigrationTable();
  }

  let applied: AppliedMigration[] = [];
  if (available) {
    try {
      const { data } = await supabase.from('schema_migrations').select('*');
      if (Array.isArray(data)) {
        applied = data as AppliedMigration[];
      }
    } catch (e) {
      console.warn('[MigrationRunner] Failed to select schema_migrations:', e);
    }
  }

  const appliedIds = new Set(applied.filter((a) => a.success).map((a) => a.id));
  const pending = EMBEDDED_MIGRATIONS.filter((m) => !appliedIds.has(m.id));

  return { applied, pending, isExecSqlAvailable: available };
}

export async function executeMigrations(options?: {
  dryRun?: boolean;
}): Promise<MigrationRunResult> {
  const isDryRun = !!options?.dryRun;
  const logs: string[] = [];
  logs.push(`[${new Date().toLocaleTimeString()}] Starting schema migration runner (${isDryRun ? 'DRY RUN' : 'EXECUTE MODE'})...`);

  const { applied, pending, isExecSqlAvailable } = await getMigrationStatus();
  logs.push(`Found ${applied.length} applied migrations, ${pending.length} pending migrations.`);

  if (!isDryRun && !isExecSqlAvailable) {
    logs.push('\n[ERROR] One-Time Database Setup Required:');
    logs.push('  The Postgres function "public.exec_sql" does not exist in Supabase.');
    logs.push('  Supabase REST API prohibits arbitrary DDL without this function.');
    logs.push('');
    logs.push('  👉 Open your Supabase SQL Editor:');
    logs.push('  https://supabase.com/dashboard/project/eywpksapztzbnthlgfhd/sql');
    logs.push('');
    logs.push('  1. Click "Copy Bootstrap SQL" in the banner above.');
    logs.push('  2. Paste it into the Supabase SQL Editor and click "Run".');
    logs.push('  3. Return here and run the migrations again.');

    return {
      success: false,
      appliedCount: 0,
      skippedCount: pending.length,
      logs,
    };
  }

  if (pending.length === 0) {
    logs.push('Database schema is already fully up to date! Nothing to apply.');
    return {
      success: true,
      appliedCount: 0,
      skippedCount: EMBEDDED_MIGRATIONS.length,
      logs,
    };
  }

  let appliedCount = 0;

  for (const m of pending) {
    logs.push(`\n---> [${m.id}] ${m.title}`);

    if (isDryRun) {
      logs.push(`  [DRY RUN] Would execute ${m.sql.trim().length} bytes of SQL.`);
      appliedCount++;
      continue;
    }

    try {
      const { error: rpcErr } = await supabase.rpc('exec_sql', { query: m.sql });

      if (rpcErr) {
        throw new Error(`RPC exec_sql failed: ${rpcErr.message}`);
      }

      await supabase.from('schema_migrations').upsert({
        id: m.id,
        applied_at: new Date().toISOString(),
        success: true,
        details: `Applied ${m.title} (${m.sql.trim().length} bytes)`,
      });

      logs.push(`  [SUCCESS] Applied ${m.id}`);
      appliedCount++;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      logs.push(`  [ERROR] Failed to apply ${m.id}: ${errMsg}`);

      try {
        await supabase.from('schema_migrations').upsert({
          id: m.id,
          applied_at: new Date().toISOString(),
          success: false,
          details: `Error: ${errMsg}`,
        });
      } catch {}

      return {
        success: false,
        appliedCount,
        skippedCount: pending.length - appliedCount,
        failedMigrationId: m.id,
        logs,
      };
    }
  }

  logs.push(`\n[${new Date().toLocaleTimeString()}] Migration completed successfully! ${appliedCount} migration(s) processed.`);

  return {
    success: true,
    appliedCount,
    skippedCount: EMBEDDED_MIGRATIONS.length - appliedCount,
    logs,
  };
}
