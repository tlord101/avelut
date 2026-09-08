-- ==============================================================================
-- AVELUT COMPLETE, UPDATED, AND CONSOLIDATED SUPABASE SCHEMA
-- ==============================================================================
-- Run this entire script in your Supabase Project SQL Editor (Database > SQL Editor).
-- This script is completely idempotent: safe to run on new or existing databases.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. CORE & PROFILE TABLES
-- ==============================================================================

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
    is_online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure presence columns exist if table was previously created
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;

-- Trigger to automatically create profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 3. KEY-VALUE & APPLICATION SETTINGS (Resolves RTDB 404s)
-- ==============================================================================

-- General Key-Value Store for client Realtime DB compatibility (app_updates, preferences, etc.)
CREATE TABLE IF NOT EXISTS public.app_kv (
    key TEXT PRIMARY KEY,
    value JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- System App Settings
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 4. ACADEMIC HIERARCHY TABLES
-- ==============================================================================

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

CREATE TABLE IF NOT EXISTS public.past_questions (
    id TEXT PRIMARY KEY,
    department_id TEXT NOT NULL,
    level TEXT NOT NULL,
    course_id TEXT NOT NULL,
    year TEXT NOT NULL,
    questions_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 5. USER PROGRESS & LEARNING MEMORY
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.user_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    department_id TEXT,
    course_id TEXT,
    exam_type TEXT,
    score INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    questions_json JSONB NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT,
    body TEXT,
    message TEXT,
    type TEXT DEFAULT 'general',
    data JSONB DEFAULT '{}'::jsonb,
    metadata_json JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    action_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all notification columns exist if table was previously created
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata_json JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS data JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS action_url TEXT;

-- ==============================================================================
-- 6. MESSENGER, CHATS & SOCIAL
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group BOOLEAN DEFAULT FALSE,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.chat_members (
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    other_user_id UUID,
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ,
    last_message_sender_id UUID,
    last_message_is_read BOOLEAN DEFAULT TRUE,
    unread_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    text TEXT,
    media_url TEXT,
    media_type TEXT,
    reply_to UUID REFERENCES public.messages(id) ON DELETE SET NULL,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.study_partners (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    partner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, partner_id)
);

CREATE TABLE IF NOT EXISTS public.user_blocks (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    blocked_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reported_id UUID,
    chat_id UUID,
    reason TEXT,
    type TEXT DEFAULT 'bug',
    title TEXT,
    details TEXT,
    context_data JSONB,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 7. COURSE MATERIALS & USAGE RECORDS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    course_code TEXT,
    course_id TEXT REFERENCES public.courses(id) ON DELETE SET NULL,
    department_id TEXT REFERENCES public.departments(id) ON DELETE SET NULL,
    school_id TEXT REFERENCES public.schools(id) ON DELETE SET NULL,
    level TEXT,
    file_url TEXT NOT NULL,
    file_type TEXT DEFAULT 'pdf',
    file_size_bytes BIGINT,
    page_count INTEGER,
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploader_name TEXT,
    download_count INTEGER DEFAULT 0,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    plan_type TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    daily_topic_allowance INTEGER DEFAULT 1,
    topics_used_today INTEGER DEFAULT 0,
    last_reset_date DATE DEFAULT CURRENT_DATE,
    unlocked_topics_pack INTEGER DEFAULT 0,
    paystack_reference TEXT,
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.topic_teaching_structures (
    topic_key TEXT PRIMARY KEY,
    topic_title TEXT NOT NULL,
    course_name TEXT DEFAULT 'General',
    duration_mode INTEGER DEFAULT 30,
    structure_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_topic_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    course_name TEXT DEFAULT 'General',
    topic_key TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT user_topic_views_user_topic_key UNIQUE (user_id, topic_key)
);

-- ==============================================================================
-- 8. INDEXES FOR MAXIMUM QUERY EFFICIENCY
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_profiles_school_dept ON public.profiles(school_id, department_id);
CREATE INDEX IF NOT EXISTS idx_topics_course ON public.topics(course_id, topic_order);
CREATE INDEX IF NOT EXISTS idx_courses_dept ON public.courses(department_id, level);
CREATE INDEX IF NOT EXISTS idx_user_progress_user ON public.user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_history_user ON public.exam_history(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON public.chat_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_updated ON public.chat_members(user_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON public.messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_kv_key ON public.app_kv(key);
CREATE INDEX IF NOT EXISTS idx_usage_records_user ON public.usage_records(user_id, created_at DESC);

-- ==============================================================================
-- 9. RPC FUNCTIONS (Atomic Credits, XP & Streaks)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.deduct_user_credits(
    p_user_id UUID,
    p_amount INTEGER
)
RETURNS JSONB AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.increment_user_credits(
    p_user_id UUID,
    p_amount INTEGER
)
RETURNS JSONB AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.increment_user_xp(
    p_user_id UUID,
    p_amount INTEGER
)
RETURNS JSONB AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 10. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.past_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- app_kv Policies (Safe, multi-role)
DROP POLICY IF EXISTS "Allow public read on app_kv" ON public.app_kv;
CREATE POLICY "Allow public read on app_kv" ON public.app_kv FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow authenticated insert/update on app_kv" ON public.app_kv;
CREATE POLICY "Allow authenticated insert/update on app_kv" ON public.app_kv FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon insert/update on app_kv" ON public.app_kv;
CREATE POLICY "Allow anon insert/update on app_kv" ON public.app_kv FOR ALL TO anon USING (true) WITH CHECK (true);

-- app_settings Policies
DROP POLICY IF EXISTS "App settings readable by all" ON public.app_settings;
CREATE POLICY "App settings readable by all" ON public.app_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can update app settings" ON public.app_settings;
CREATE POLICY "Admins can update app settings" ON public.app_settings FOR ALL TO authenticated 
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Profiles Policies
DROP POLICY IF EXISTS "Public profiles are viewable by authenticated users" ON public.profiles;
CREATE POLICY "Public profiles are viewable by authenticated users" ON public.profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Academic Hierarchy Policies
DROP POLICY IF EXISTS "Schools readable by all" ON public.schools;
CREATE POLICY "Schools readable by all" ON public.schools FOR SELECT USING (true);

DROP POLICY IF EXISTS "Colleges readable by all" ON public.colleges;
CREATE POLICY "Colleges readable by all" ON public.colleges FOR SELECT USING (true);

DROP POLICY IF EXISTS "Departments readable by all" ON public.departments;
CREATE POLICY "Departments readable by all" ON public.departments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Courses readable by all" ON public.courses;
CREATE POLICY "Courses readable by all" ON public.courses FOR SELECT USING (true);

DROP POLICY IF EXISTS "Topics readable by all" ON public.topics;
CREATE POLICY "Topics readable by all" ON public.topics FOR SELECT USING (true);

DROP POLICY IF EXISTS "Past questions readable by authenticated" ON public.past_questions;
CREATE POLICY "Past questions readable by authenticated" ON public.past_questions FOR SELECT TO authenticated USING (true);

-- Progress & Exam History
DROP POLICY IF EXISTS "Users can manage their own progress" ON public.user_progress;
CREATE POLICY "Users can manage their own progress" ON public.user_progress FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own exam history" ON public.exam_history;
CREATE POLICY "Users can manage their own exam history" ON public.exam_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Notifications
DROP POLICY IF EXISTS "notifications_own" ON public.notifications;
DROP POLICY IF EXISTS notifications_own ON public.notifications;
DROP POLICY IF EXISTS "Users can manage their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Anyone can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can delete their own notifications" ON public.notifications;

CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id OR auth.role() = 'anon');
CREATE POLICY "Anyone can insert notifications" ON public.notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);

-- Messenger & Chats
DROP POLICY IF EXISTS "chat_members_select" ON public.chat_members;
CREATE POLICY "chat_members_select" ON public.chat_members FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_members_all" ON public.chat_members;
CREATE POLICY "chat_members_all" ON public.chat_members FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chats_select" ON public.chats;
CREATE POLICY "chats_select" ON public.chats FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.chat_members m WHERE m.chat_id = chats.id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "chats_insert" ON public.chats;
CREATE POLICY "chats_insert" ON public.chats FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "messages_select" ON public.messages;
CREATE POLICY "messages_select" ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.chat_members m WHERE m.chat_id = messages.chat_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "messages_insert" ON public.messages;
CREATE POLICY "messages_insert" ON public.messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id AND
  EXISTS (SELECT 1 FROM public.chat_members m WHERE m.chat_id = messages.chat_id AND m.user_id = auth.uid())
);

DROP POLICY IF EXISTS "messages_update" ON public.messages;
CREATE POLICY "messages_update" ON public.messages FOR UPDATE USING (auth.uid() = sender_id);

-- Study Partners & Blocks
DROP POLICY IF EXISTS "study_partners_own" ON public.study_partners;
CREATE POLICY "study_partners_own" ON public.study_partners FOR ALL TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_blocks_own" ON public.user_blocks;
CREATE POLICY "user_blocks_own" ON public.user_blocks FOR ALL TO authenticated USING (auth.uid() = user_id);

-- Reports
DROP POLICY IF EXISTS "reports_insert" ON public.reports;
CREATE POLICY "reports_insert" ON public.reports FOR INSERT WITH CHECK (auth.uid() = reporter_id);

DROP POLICY IF EXISTS "reports_admin_select" ON public.reports;
CREATE POLICY "reports_admin_select" ON public.reports FOR SELECT TO authenticated 
USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Course Materials
DROP POLICY IF EXISTS "Materials viewable by authenticated users" ON public.materials;
CREATE POLICY "Materials viewable by authenticated users" ON public.materials FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Users can upload course materials" ON public.materials;
CREATE POLICY "Users can upload course materials" ON public.materials FOR INSERT TO authenticated WITH CHECK (auth.uid() = uploaded_by);

DROP POLICY IF EXISTS "Users can update their own materials or admins" ON public.materials;
CREATE POLICY "Users can update their own materials or admins" ON public.materials FOR UPDATE TO authenticated 
USING (auth.uid() = uploaded_by OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true));

-- Usage Records
DROP POLICY IF EXISTS "Users can view their own usage records" ON public.usage_records;
CREATE POLICY "Users can view their own usage records" ON public.usage_records FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own usage records" ON public.usage_records;
CREATE POLICY "Users can insert their own usage records" ON public.usage_records FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Subscriptions
DROP POLICY IF EXISTS "Users can view their own subscription" ON public.subscriptions;
CREATE POLICY "Users can view their own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage their own subscription" ON public.subscriptions;
CREATE POLICY "Users can manage their own subscription" ON public.subscriptions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Topic Teaching Structures & Topic Views
ALTER TABLE public.topic_teaching_structures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on topic_teaching_structures" ON public.topic_teaching_structures;
CREATE POLICY "Allow public read on topic_teaching_structures" ON public.topic_teaching_structures FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert/update on topic_teaching_structures" ON public.topic_teaching_structures;
CREATE POLICY "Allow public insert/update on topic_teaching_structures" ON public.topic_teaching_structures FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.user_topic_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow public read on user_topic_views" ON public.user_topic_views;
CREATE POLICY "Allow public read on user_topic_views" ON public.user_topic_views FOR SELECT USING (true);
DROP POLICY IF EXISTS "Allow public insert/update on user_topic_views" ON public.user_topic_views;
CREATE POLICY "Allow public insert/update on user_topic_views" ON public.user_topic_views FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- 11. STORAGE BUCKETS & POLICIES
-- ==============================================================================

INSERT INTO storage.buckets (id, name, public) 
VALUES ('profile_avatars', 'profile_avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('solution_shares', 'solution_shares', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('course_materials', 'course_materials', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'profile_avatars');

DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar" ON storage.objects FOR INSERT TO authenticated 
WITH CHECK (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar" ON storage.objects FOR UPDATE TO authenticated 
USING (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar" ON storage.objects FOR DELETE TO authenticated 
USING (bucket_id = 'profile_avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ==============================================================================
-- 12. ENABLE REALTIME PUBLICATION
-- ==============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chats; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_members; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_progress; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_kv; EXCEPTION WHEN duplicate_object THEN NULL; END;
        BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings; EXCEPTION WHEN duplicate_object THEN NULL; END;
    END IF;
END $$;
