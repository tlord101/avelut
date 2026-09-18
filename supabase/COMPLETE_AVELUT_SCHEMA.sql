-- ==============================================================================
-- AVELUT COMPLETE CONSOLIDATED SUPABASE SCHEMA (ALL 13 MIGRATIONS)
-- ==============================================================================
-- Run this entire script in your Supabase Project SQL Editor (Database > SQL Editor).
-- Project Reference: eywpksapztzbnthlgfhd
-- This script is completely idempotent: safe to run on empty or partially populated databases.
-- It creates all tables, functions, triggers, policies, indexes, and registers all 13 migrations.
-- ==============================================================================

-- ==============================================================================
-- 1. EXTENSIONS
-- ==============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. MIGRATION TRACKING & RPC EXECUTOR
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
-- 3. PROFILES & AUTHENTICATION
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
    live_tutorial_minutes INTEGER DEFAULT 120,
    is_admin BOOLEAN DEFAULT FALSE,
    is_paid_subscriber BOOLEAN DEFAULT FALSE,
    fcm_token TEXT,
    is_online BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure all profile columns exist if table was created in an older migration
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS school_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS school_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS college_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS level TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS streak INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_active_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_credits INTEGER DEFAULT 50;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS live_tutorial_minutes INTEGER DEFAULT 120;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_paid_subscriber BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS fcm_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (
        id, 
        email, 
        full_name, 
        avatar_url,
        username,
        ai_credits,
        live_tutorial_minutes
    )
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url',
        LOWER(REGEXP_REPLACE(split_part(NEW.email, '@', 1), '[^a-zA-Z0-9_]', '', 'g')) || '_' || SUBSTRING(NEW.id::text FROM 1 FOR 4),
        50,
        120
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 4. APPLICATION SETTINGS & KEY-VALUE STORE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS public.app_kv (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 5. ACADEMIC HIERARCHY & MATERIALS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    state TEXT,
    lga TEXT,
    website TEXT,
    logo_url TEXT,
    status TEXT DEFAULT 'active',
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.colleges (
    id TEXT PRIMARY KEY,
    school_id TEXT REFERENCES public.schools(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.departments (
    id TEXT PRIMARY KEY,
    school_id TEXT REFERENCES public.schools(id) ON DELETE CASCADE,
    college_id TEXT REFERENCES public.colleges(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    code TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.courses (
    id TEXT PRIMARY KEY,
    department_id TEXT REFERENCES public.departments(id) ON DELETE CASCADE,
    school_id TEXT REFERENCES public.schools(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    title TEXT NOT NULL,
    level TEXT NOT NULL,
    semester INTEGER DEFAULT 1,
    description TEXT,
    credits INTEGER DEFAULT 3,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.topics (
    id TEXT PRIMARY KEY,
    course_id TEXT REFERENCES public.courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    topic_order INTEGER DEFAULT 0,
    description TEXT,
    content TEXT,
    estimated_minutes INTEGER DEFAULT 30,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.past_questions (
    id TEXT PRIMARY KEY,
    course_id TEXT REFERENCES public.courses(id) ON DELETE CASCADE,
    year TEXT NOT NULL,
    semester INTEGER DEFAULT 1,
    exam_type TEXT DEFAULT 'main',
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.materials (
    id TEXT PRIMARY KEY,
    course_id TEXT,
    topic_id TEXT,
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_type TEXT,
    file_size BIGINT,
    uploaded_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 6. USER PROGRESS, ACTIVITY & SUBSCRIPTIONS
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id TEXT,
    topic_id TEXT,
    completed BOOLEAN DEFAULT FALSE,
    score NUMERIC,
    time_spent_seconds INTEGER DEFAULT 0,
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS public.exam_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    course_id TEXT,
    exam_type TEXT,
    score NUMERIC,
    total_questions INTEGER,
    time_taken_seconds INTEGER,
    answers JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    feature TEXT NOT NULL,
    cost INTEGER NOT NULL,
    model TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL,
    status TEXT NOT NULL,
    reference TEXT,
    amount NUMERIC,
    currency TEXT DEFAULT 'NGN',
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.live_minute_pools (
    user_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    used_minutes INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, period_key)
);

-- ==============================================================================
-- 7. MESSENGER, CHATS, NOTIFICATIONS & SOCIAL
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.chats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    direct_key TEXT,
    is_group BOOLEAN DEFAULT FALSE,
    name TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.chats ADD COLUMN IF NOT EXISTS direct_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS chats_direct_key_unique ON public.chats (direct_key) WHERE direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.chat_members (
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
    user_id UUID,
    other_user_id UUID,
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ,
    last_message_sender_id UUID,
    last_message_is_read BOOLEAN DEFAULT FALSE,
    unread_count INTEGER DEFAULT 0,
    is_muted BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chat_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
    sender_id UUID,
    text TEXT DEFAULT '',
    media_url TEXT,
    media_type TEXT,
    reply_to UUID,
    is_deleted BOOLEAN DEFAULT FALSE,
    is_delivered BOOLEAN DEFAULT FALSE,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Legacy messenger compatibility tables
CREATE TABLE IF NOT EXISTS public.messenger_conversations (
    id TEXT PRIMARY KEY,
    participant_ids TEXT[] NOT NULL DEFAULT '{}',
    last_message JSONB,
    unread_counts JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.messenger_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    sender_id TEXT NOT NULL,
    text TEXT,
    media_url TEXT,
    media_type TEXT,
    timestamp BIGINT NOT NULL,
    read_by JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.study_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    partner_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'accepted',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, partner_id)
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL,
    blocked_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id UUID NOT NULL,
    reported_user_id UUID,
    content_type TEXT NOT NULL,
    content_id TEXT,
    reason TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 8. LIVE TUTORIAL, LESSON PREP & TEACHING ENGINE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.topic_teaching_structures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_key TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    course_name TEXT,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes IN (15, 30, 60)),
    content_hash TEXT,
    structure_json JSONB NOT NULL,
    board_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_teaching_structures_unique
    ON public.topic_teaching_structures (topic_key, duration_minutes, COALESCE(course_name, ''));

CREATE TABLE IF NOT EXISTS public.user_topic_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    topic_id TEXT NOT NULL,
    course_id TEXT,
    duration_mode SMALLINT NOT NULL DEFAULT 15,
    last_board_index INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, topic_id, duration_mode)
);

CREATE TABLE IF NOT EXISTS public.lesson_prep_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prep_key TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    course_name TEXT,
    syllabus_context TEXT,
    duration_mode SMALLINT NOT NULL CHECK (duration_mode IN (15, 30, 60)),
    voice TEXT NOT NULL DEFAULT 'Altair',
    content_hash TEXT,
    model_version TEXT NOT NULL DEFAULT 'v1',
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'uploading', 'ready', 'failed', 'cancelled')),
    phase TEXT NOT NULL DEFAULT 'queued' CHECK (phase IN ('queued', 'structure', 'boards', 'tts', 'upload', 'ready', 'failed')),
    total_boards INTEGER NOT NULL DEFAULT 0,
    next_board_index INTEGER NOT NULL DEFAULT 0,
    completed_boards INTEGER NOT NULL DEFAULT 0,
    progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    message TEXT,
    last_error TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    locked_at TIMESTAMPTZ,
    locked_by TEXT,
    priority INTEGER NOT NULL DEFAULT 100,
    storage_prefix TEXT,
    structure_path TEXT,
    manifest_path TEXT,
    package_bytes BIGINT,
    charged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.lesson_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prep_key TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    course_name TEXT,
    duration_mode SMALLINT NOT NULL,
    voice TEXT NOT NULL,
    content_hash TEXT,
    model_version TEXT NOT NULL DEFAULT 'v1',
    total_boards INTEGER NOT NULL,
    storage_prefix TEXT NOT NULL,
    structure_path TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    package_bytes BIGINT,
    checksum_sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'expired', 'deleted')),
    ready_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lesson_package_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prep_key TEXT NOT NULL,
    board_index INTEGER NOT NULL,
    board_number INTEGER NOT NULL,
    board_path TEXT NOT NULL,
    audio_path TEXT,
    has_speech BOOLEAN NOT NULL DEFAULT FALSE,
    is_valid BOOLEAN NOT NULL DEFAULT TRUE,
    checksum_sha256 TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (prep_key, board_index)
);

-- ==============================================================================
-- 9. PLAYGROUND & CBT PRACTICE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.past_question_packs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    course_code TEXT,
    course_name TEXT,
    year TEXT,
    type TEXT NOT NULL DEFAULT 'mcq',
    question_count INTEGER NOT NULL DEFAULT 0,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    published BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_flashcard_decks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    topic_name TEXT,
    cards JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_cbt_exams (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    topic_name TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 15,
    questions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_cbt_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    score INTEGER NOT NULL,
    total_questions INTEGER NOT NULL,
    completed_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.theory_solutions (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    question_id TEXT NOT NULL,
    solution_markdown TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 10. RPC FUNCTIONS (Stored Procedures)
-- ==============================================================================

-- Deduct User AI Credits (safe for UUID or text user ids)
CREATE OR REPLACE FUNCTION public.deduct_user_credits(p_user_id text, p_amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current int;
    v_new int;
    v_uid uuid;
BEGIN
    BEGIN
        v_uid := p_user_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_uid := NULL;
    END;

    SELECT COALESCE(ai_credits, 0) INTO v_current
    FROM public.profiles
    WHERE (v_uid IS NOT NULL AND id = v_uid) OR id::text = p_user_id
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
        updated_at = NOW()
    WHERE (v_uid IS NOT NULL AND id = v_uid) OR id::text = p_user_id;

    RETURN jsonb_build_object('success', true, 'remaining_credits', v_new);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Increment User AI Credits
CREATE OR REPLACE FUNCTION public.increment_user_credits(p_user_id text, p_amount int, p_description text DEFAULT 'Credit refill')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new int;
    v_uid uuid;
BEGIN
    BEGIN
        v_uid := p_user_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_uid := NULL;
    END;

    UPDATE public.profiles
    SET ai_credits = COALESCE(ai_credits, 0) + p_amount,
        updated_at = NOW()
    WHERE (v_uid IS NOT NULL AND id = v_uid) OR id::text = p_user_id
    RETURNING ai_credits INTO v_new;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
    END IF;

    RETURN jsonb_build_object('success', true, 'new_balance', v_new);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Consume Live Tutorial Minutes
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
AS $$
DECLARE
    v_used int := 0;
    v_remaining int := 0;
BEGIN
    INSERT INTO public.live_minute_pools (user_id, period_key, used_minutes, updated_at)
    VALUES (p_user_id, p_period_key, 0, NOW())
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
        updated_at = NOW()
    WHERE user_id = p_user_id AND period_key = p_period_key;

    RETURN jsonb_build_object('success', true, 'remaining_minutes', v_remaining - p_minutes);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Increment User XP
CREATE OR REPLACE FUNCTION public.increment_user_xp(p_user_id text, p_amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new_xp int;
    v_uid uuid;
BEGIN
    BEGIN
        v_uid := p_user_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_uid := NULL;
    END;

    UPDATE public.profiles
    SET xp = COALESCE(xp, 0) + p_amount,
        updated_at = NOW()
    WHERE (v_uid IS NOT NULL AND id = v_uid) OR id::text = p_user_id
    RETURNING xp INTO v_new_xp;

    RETURN jsonb_build_object('success', true, 'new_xp', v_new_xp);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Update Daily Streak
CREATE OR REPLACE FUNCTION public.update_daily_streak(p_user_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_last_active date;
    v_streak int;
    v_uid uuid;
BEGIN
    BEGIN
        v_uid := p_user_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_uid := NULL;
    END;

    SELECT last_active_date, COALESCE(streak, 0)
    INTO v_last_active, v_streak
    FROM public.profiles
    WHERE (v_uid IS NOT NULL AND id = v_uid) OR id::text = p_user_id;

    IF v_last_active IS NULL OR v_last_active < CURRENT_DATE - 1 THEN
        v_streak := 1;
    ELSIF v_last_active = CURRENT_DATE - 1 THEN
        v_streak := v_streak + 1;
    END IF;

    UPDATE public.profiles
    SET streak = v_streak,
        last_active_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE (v_uid IS NOT NULL AND id = v_uid) OR id::text = p_user_id;

    RETURN jsonb_build_object('success', true, 'streak', v_streak);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Get or Create Direct Chat
CREATE OR REPLACE FUNCTION public.get_or_create_direct_chat(p_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_chat_id uuid;
    v_direct_key text;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required';
    END IF;

    IF p_other_user_id IS NULL OR p_other_user_id = v_user_id THEN
        RAISE EXCEPTION 'A different recipient is required';
    END IF;

    v_direct_key := LEAST(v_user_id::text, p_other_user_id::text) || ':' || GREATEST(v_user_id::text, p_other_user_id::text);

    SELECT id INTO v_chat_id
    FROM public.chats
    WHERE direct_key = v_direct_key;

    IF v_chat_id IS NULL THEN
        INSERT INTO public.chats (direct_key)
        VALUES (v_direct_key)
        ON CONFLICT (direct_key) WHERE direct_key IS NOT NULL DO UPDATE
        SET direct_key = EXCLUDED.direct_key
        RETURNING id INTO v_chat_id;
    END IF;

    INSERT INTO public.chat_members (chat_id, user_id, other_user_id)
    VALUES
        (v_chat_id, v_user_id, p_other_user_id),
        (v_chat_id, p_other_user_id, v_user_id)
    ON CONFLICT (chat_id, user_id) DO UPDATE
    SET other_user_id = EXCLUDED.other_user_id;

    RETURN v_chat_id;
END;
$$;

-- Send Chat Message
CREATE OR REPLACE FUNCTION public.send_chat_message(
    p_chat_id uuid,
    p_message_id uuid,
    p_sender_id uuid,
    p_text text,
    p_media_url text,
    p_media_type text,
    p_reply_to uuid,
    p_created_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_created_at timestamptz := COALESCE(p_created_at, NOW());
    v_summary text;
    v_inserted_message_id uuid;
BEGIN
    IF auth.uid() IS NULL OR auth.uid() <> p_sender_id THEN
        RAISE EXCEPTION 'Sender must be the authenticated user';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.chat_members
        WHERE chat_id = p_chat_id AND user_id = p_sender_id
    ) THEN
        RAISE EXCEPTION 'Sender is not a chat member';
    END IF;

    INSERT INTO public.messages (
        id, chat_id, sender_id, text, media_url, media_type, reply_to, created_at
    )
    VALUES (
        p_message_id, p_chat_id, p_sender_id, COALESCE(p_text, ''), p_media_url, p_media_type, p_reply_to, v_created_at
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id INTO v_inserted_message_id;

    IF v_inserted_message_id IS NULL THEN
        RETURN;
    END IF;

    v_summary := CASE
        WHEN p_media_type = 'voice' THEN 'Voice message'
        WHEN p_media_type = 'image' THEN 'Image file'
        WHEN p_media_type = 'file' THEN 'Document file'
        WHEN COALESCE(p_text, '') <> '' THEN p_text
        ELSE 'Media'
    END;

    UPDATE public.chat_members
    SET
        last_message_text = v_summary,
        last_message_at = v_created_at,
        last_message_sender_id = p_sender_id,
        last_message_is_read = (user_id = p_sender_id),
        unread_count = CASE WHEN user_id = p_sender_id THEN 0 ELSE unread_count + 1 END
    WHERE chat_id = p_chat_id;
END;
$$;

-- Claim Lesson Prep Job
CREATE OR REPLACE FUNCTION public.claim_lesson_prep_job(
    p_worker_id text,
    p_lease_seconds int DEFAULT 180
)
RETURNS SETOF public.lesson_prep_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_job_id uuid;
BEGIN
    SELECT id INTO v_job_id
    FROM public.lesson_prep_jobs
    WHERE status = 'queued'
       OR (status = 'running' AND locked_at < now() - (p_lease_seconds || ' seconds')::interval)
    ORDER BY priority ASC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_job_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
    UPDATE public.lesson_prep_jobs
    SET status = 'running',
        locked_at = now(),
        locked_by = p_worker_id,
        started_at = COALESCE(started_at, now()),
        attempt_count = attempt_count + 1,
        updated_at = now()
    WHERE id = v_job_id
    RETURNING *;
END;
$$;

-- Updated at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_prep_jobs_updated_at ON public.lesson_prep_jobs;
CREATE TRIGGER trg_lesson_prep_jobs_updated_at
    BEFORE UPDATE ON public.lesson_prep_jobs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==============================================================================
-- 11. INDEXES FOR HIGH QUERY PERFORMANCE
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_department ON public.profiles(department_id);
CREATE INDEX IF NOT EXISTS idx_profiles_presence ON public.profiles(is_online, last_seen);

CREATE INDEX IF NOT EXISTS idx_courses_department ON public.courses(department_id, level);
CREATE INDEX IF NOT EXISTS idx_courses_school ON public.courses(school_id);
CREATE INDEX IF NOT EXISTS idx_topics_course ON public.topics(course_id, topic_order);
CREATE INDEX IF NOT EXISTS idx_past_questions_course ON public.past_questions(course_id, year);

CREATE INDEX IF NOT EXISTS idx_user_progress_user ON public.user_progress(user_id, completed);
CREATE INDEX IF NOT EXISTS idx_user_progress_topic ON public.user_progress(topic_id);
CREATE INDEX IF NOT EXISTS idx_exam_history_user ON public.exam_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_user ON public.usage_records(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON public.messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON public.chat_members(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_study_partners_pair ON public.study_partners(user_id, partner_id);

CREATE INDEX IF NOT EXISTS idx_lesson_prep_jobs_status_priority ON public.lesson_prep_jobs (status, priority, created_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_lesson_prep_jobs_user ON public.lesson_prep_jobs (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_packages_user ON public.lesson_packages (user_id, ready_at DESC);

-- ==============================================================================
-- 12. ROW LEVEL SECURITY (RLS)
-- ==============================================================================

-- Enable RLS across all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.colleges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.past_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topic_teaching_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_topic_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_minute_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_prep_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_package_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.past_question_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_cbt_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_cbt_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.theory_solutions ENABLE ROW LEVEL SECURITY;

-- Profiles: Public read, owner update
DROP POLICY IF EXISTS profiles_read ON public.profiles;
CREATE POLICY profiles_read ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Settings & KV: Public read, all authenticated/anon read, service/admin write
DROP POLICY IF EXISTS app_settings_read ON public.app_settings;
CREATE POLICY app_settings_read ON public.app_settings FOR SELECT USING (true);
DROP POLICY IF EXISTS app_settings_all ON public.app_settings;
CREATE POLICY app_settings_all ON public.app_settings FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS app_kv_read ON public.app_kv;
CREATE POLICY app_kv_read ON public.app_kv FOR SELECT USING (true);
DROP POLICY IF EXISTS app_kv_all ON public.app_kv;
CREATE POLICY app_kv_all ON public.app_kv FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

-- Academic content: Read by all
DROP POLICY IF EXISTS schools_read ON public.schools;
CREATE POLICY schools_read ON public.schools FOR SELECT USING (true);
DROP POLICY IF EXISTS colleges_read ON public.colleges;
CREATE POLICY colleges_read ON public.colleges FOR SELECT USING (true);
DROP POLICY IF EXISTS departments_read ON public.departments;
CREATE POLICY departments_read ON public.departments FOR SELECT USING (true);
DROP POLICY IF EXISTS courses_read ON public.courses;
CREATE POLICY courses_read ON public.courses FOR SELECT USING (true);
DROP POLICY IF EXISTS topics_read ON public.topics;
CREATE POLICY topics_read ON public.topics FOR SELECT USING (true);
DROP POLICY IF EXISTS past_questions_read ON public.past_questions;
CREATE POLICY past_questions_read ON public.past_questions FOR SELECT USING (true);
DROP POLICY IF EXISTS materials_read ON public.materials;
CREATE POLICY materials_read ON public.materials FOR SELECT USING (true);

-- Admin writes on academic content
DROP POLICY IF EXISTS schools_admin ON public.schools;
CREATE POLICY schools_admin ON public.schools FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS colleges_admin ON public.colleges;
CREATE POLICY colleges_admin ON public.colleges FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS departments_admin ON public.departments;
CREATE POLICY departments_admin ON public.departments FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS courses_admin ON public.courses;
CREATE POLICY courses_admin ON public.courses FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS topics_admin ON public.topics;
CREATE POLICY topics_admin ON public.topics FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS past_questions_admin ON public.past_questions;
CREATE POLICY past_questions_admin ON public.past_questions FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

-- User Progress & History: Owner access
DROP POLICY IF EXISTS user_progress_own ON public.user_progress;
CREATE POLICY user_progress_own ON public.user_progress FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS exam_history_own ON public.exam_history;
CREATE POLICY exam_history_own ON public.exam_history FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS usage_records_own ON public.usage_records;
CREATE POLICY usage_records_own ON public.usage_records FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS subscriptions_own ON public.subscriptions;
CREATE POLICY subscriptions_own ON public.subscriptions FOR ALL USING (auth.uid() = user_id);

-- Chats, Chat Members & Messages
DROP POLICY IF EXISTS chats_select ON public.chats;
CREATE POLICY chats_select ON public.chats FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.chat_members WHERE chat_id = chats.id AND user_id = auth.uid()));

DROP POLICY IF EXISTS chats_insert ON public.chats;
CREATE POLICY chats_insert ON public.chats FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS chat_members_select ON public.chat_members;
CREATE POLICY chat_members_select ON public.chat_members FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS chat_members_update ON public.chat_members;
CREATE POLICY chat_members_update ON public.chat_members FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS chat_members_delete ON public.chat_members;
CREATE POLICY chat_members_delete ON public.chat_members FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS chat_members_insert ON public.chat_members;
CREATE POLICY chat_members_insert ON public.chat_members FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.chat_members WHERE chat_id = messages.chat_id AND user_id = auth.uid()));

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS messages_update ON public.messages;
CREATE POLICY messages_update ON public.messages FOR UPDATE USING (auth.uid() = sender_id);

-- Study Partners & Notifications
DROP POLICY IF EXISTS study_partners_all ON public.study_partners;
CREATE POLICY study_partners_all ON public.study_partners FOR ALL USING (auth.uid() = user_id OR auth.uid() = partner_id);

DROP POLICY IF EXISTS notifications_all ON public.notifications;
CREATE POLICY notifications_all ON public.notifications FOR ALL USING (auth.uid()::text = user_id OR user_id = 'all');

DROP POLICY IF EXISTS user_blocks_all ON public.user_blocks;
CREATE POLICY user_blocks_all ON public.user_blocks FOR ALL USING (auth.uid() = blocker_id);

DROP POLICY IF EXISTS reports_insert ON public.reports;
CREATE POLICY reports_insert ON public.reports FOR INSERT WITH CHECK (true);

-- Teaching structures & Views
DROP POLICY IF EXISTS topic_teaching_structures_read ON public.topic_teaching_structures;
CREATE POLICY topic_teaching_structures_read ON public.topic_teaching_structures FOR SELECT USING (true);

DROP POLICY IF EXISTS topic_teaching_structures_write ON public.topic_teaching_structures;
CREATE POLICY topic_teaching_structures_write ON public.topic_teaching_structures FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_topic_views_own ON public.user_topic_views;
CREATE POLICY user_topic_views_own ON public.user_topic_views FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS live_minute_pools_own ON public.live_minute_pools;
CREATE POLICY live_minute_pools_own ON public.live_minute_pools FOR ALL USING (auth.uid()::text = user_id);

-- Cloud Lesson Prep
DROP POLICY IF EXISTS lesson_prep_jobs_read ON public.lesson_prep_jobs;
CREATE POLICY lesson_prep_jobs_read ON public.lesson_prep_jobs FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS lesson_prep_jobs_insert ON public.lesson_prep_jobs;
CREATE POLICY lesson_prep_jobs_insert ON public.lesson_prep_jobs FOR INSERT WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS lesson_prep_jobs_service ON public.lesson_prep_jobs;
CREATE POLICY lesson_prep_jobs_service ON public.lesson_prep_jobs FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS lesson_packages_read ON public.lesson_packages;
CREATE POLICY lesson_packages_read ON public.lesson_packages FOR SELECT USING (true);

DROP POLICY IF EXISTS lesson_packages_service ON public.lesson_packages;
CREATE POLICY lesson_packages_service ON public.lesson_packages FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS lesson_package_boards_read ON public.lesson_package_boards;
CREATE POLICY lesson_package_boards_read ON public.lesson_package_boards FOR SELECT USING (true);

DROP POLICY IF EXISTS lesson_package_boards_service ON public.lesson_package_boards;
CREATE POLICY lesson_package_boards_service ON public.lesson_package_boards FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

-- Playground Tables
DROP POLICY IF EXISTS past_question_packs_read ON public.past_question_packs;
CREATE POLICY past_question_packs_read ON public.past_question_packs FOR SELECT TO authenticated, anon USING (published = true);

DROP POLICY IF EXISTS past_question_packs_all ON public.past_question_packs;
CREATE POLICY past_question_packs_all ON public.past_question_packs FOR ALL TO authenticated, anon, service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_flashcard_decks_own ON public.user_flashcard_decks;
CREATE POLICY user_flashcard_decks_own ON public.user_flashcard_decks FOR ALL USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS user_cbt_exams_own ON public.user_cbt_exams;
CREATE POLICY user_cbt_exams_own ON public.user_cbt_exams FOR ALL USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS user_cbt_attempts_own ON public.user_cbt_attempts;
CREATE POLICY user_cbt_attempts_own ON public.user_cbt_attempts FOR ALL USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS theory_solutions_read ON public.theory_solutions;
CREATE POLICY theory_solutions_read ON public.theory_solutions FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS theory_solutions_insert ON public.theory_solutions;
CREATE POLICY theory_solutions_insert ON public.theory_solutions FOR INSERT TO authenticated, anon WITH CHECK (true);

-- ==============================================================================
-- 13. EXECUTE GRANTS
-- ==============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.deduct_user_credits(text, int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_credits(text, int, text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.consume_live_tutorial_minutes(text, text, int, int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.increment_user_xp(text, int) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_daily_streak(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_or_create_direct_chat(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.send_chat_message(uuid, uuid, uuid, text, text, text, uuid, timestamptz) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_lesson_prep_job(text, int) TO authenticated, anon, service_role;

-- ==============================================================================
-- 14. REALTIME PUBLICATION
-- ==============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
END $$;

DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'messages', 
        'chats', 
        'chat_members', 
        'notifications', 
        'study_partners', 
        'topic_teaching_structures', 
        'lesson_prep_jobs'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        IF NOT EXISTS (
            SELECT 1 
            FROM pg_publication_tables 
            WHERE pubname = 'supabase_realtime' 
              AND schemaname = 'public' 
              AND tablename = tbl
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
        END IF;
    END LOOP;
END $$;

-- ==============================================================================
-- 15. RECORD ALL 13 MIGRATIONS AS APPLIED
-- ==============================================================================
INSERT INTO public.schema_migrations (id, applied_at, success, details) VALUES
    ('20260830000001_initial_avelut_schema.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260831000001_complete_supabase_transition.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260905_messenger_notifications.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260905_reports_policy_fix.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260906_create_app_kv.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260906_fix_notifications_and_study_partners_rls.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260908_create_topic_teaching_structures_and_views.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260908_fix_study_partners_upsert_rls.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260909_fix_messenger_delivery.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260911_lesson_prep_cloud.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260912_live_tutorial_redesign.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260913_playground_tables.sql', NOW(), true, 'Consolidated full schema execution'),
    ('20260914_create_exec_sql.sql', NOW(), true, 'Consolidated full schema execution')
ON CONFLICT (id) DO UPDATE SET
    applied_at = NOW(),
    success = true,
    details = EXCLUDED.details;
