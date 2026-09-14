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
