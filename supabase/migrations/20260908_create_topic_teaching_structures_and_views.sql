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
