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
