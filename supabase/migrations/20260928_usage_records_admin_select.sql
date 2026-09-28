-- Allow admins to read all usage_records for monitoring dashboards.
-- Users keep SELECT on their own rows.

DROP POLICY IF EXISTS "usage_records_admin_select" ON public.usage_records;
CREATE POLICY "usage_records_admin_select" ON public.usage_records
  FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- Helpful indexes for admin metrics queries
CREATE INDEX IF NOT EXISTS idx_usage_records_created ON public.usage_records (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_records_feature ON public.usage_records (feature, created_at DESC);
