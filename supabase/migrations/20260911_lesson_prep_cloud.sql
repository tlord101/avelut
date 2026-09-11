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
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_prep_jobs_updated ON public.lesson_prep_jobs;
CREATE TRIGGER trg_lesson_prep_jobs_updated
  BEFORE UPDATE ON public.lesson_prep_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_lesson_prep_job(p_worker_id text)
RETURNS SETOF public.lesson_prep_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

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
