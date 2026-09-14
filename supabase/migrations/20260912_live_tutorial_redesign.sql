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
AS $$
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
$$;

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
AS $$
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
$$;

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
