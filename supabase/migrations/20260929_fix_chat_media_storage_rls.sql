-- =============================================================================
-- FIX: Chat media / photo upload RLS on solution_shares bucket
-- =============================================================================
-- Problem:
--   Messenger uploads photos to paths like:
--     chat_files/<chatId>/<timestamp>_xxx.jpg
--     voice_notes/<chatId>/<timestamp>.webm
--   These go into the public "solution_shares" storage bucket.
--
--   Old INSERT policy required:
--     (storage.foldername(name))[1] = auth.uid()::text
--   So the first path segment had to be the user UUID.
--   chat_files / voice_notes do not match → "new row violates row-level security policy"
--
-- Run this entire script in Supabase → SQL Editor → New query → Run.
-- Safe to re-run (idempotent).
-- =============================================================================

-- Ensure bucket exists and is public (for permanent https URLs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('solution_shares', 'solution_shares', true)
ON CONFLICT (id) DO UPDATE SET public = true;

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile_avatars', 'profile_avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop restrictive / old policies on solution_shares
DROP POLICY IF EXISTS "Users can upload solution share images" ON storage.objects;
DROP POLICY IF EXISTS "Solution share images are viewable by authenticated users" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to solution_shares" ON storage.objects;
DROP POLICY IF EXISTS "Solution shares are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update solution_shares" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete own solution_shares paths" ON storage.objects;

-- Public read (bucket is public; getPublicUrl must work for everyone viewing chat images)
CREATE POLICY "Solution shares are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'solution_shares');

-- Any signed-in user can upload chat media, voice notes, solution shares, temp uploads
CREATE POLICY "Authenticated users can upload to solution_shares"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'solution_shares');

-- Allow upsert / overwrite (upload uses upsert: true)
CREATE POLICY "Authenticated users can update solution_shares"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'solution_shares')
WITH CHECK (bucket_id = 'solution_shares');

-- Optional cleanup: users can delete objects under chat_files / voice_notes / their uid
CREATE POLICY "Authenticated users can delete solution_shares objects"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'solution_shares');

-- Keep profile_avatars policies strict (first folder = user id)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;

CREATE POLICY "Avatar images are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'profile_avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'profile_avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'profile_avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'profile_avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Done. After running, try sending a photo in messenger again while logged in.
