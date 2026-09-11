# Cloud Lesson Prep — Deploy Guide (Avelut)

Server-side Live Tutorial packages: prepare in cloud → download to device → offline play.

## Repo paths

```
supabase/
  config.toml
  migrations/20260911_lesson_prep_cloud.sql
  functions/
    lesson-prep-enqueue/index.ts
    lesson-prep-worker/index.ts
    lesson-feedback-speech/index.ts
docs/
  CLOUD_LESSON_PREP_DEPLOY.md
  ALL_IN_ONE_IMPLEMENTATION_PROMPT.md
```

## Step 1 — SQL

1. Open Supabase SQL Editor for project `eywpksapztzbnthlgfhd`
2. Paste and run `supabase/migrations/20260911_lesson_prep_cloud.sql`
3. Confirm tables: `lesson_prep_jobs`, `lesson_packages`, `lesson_package_boards`
4. Confirm RPC: `claim_lesson_prep_job`

## Step 2 — Storage bucket

1. Storage → New bucket → name `lesson-packages` → **Private**
2. Optional policy (SQL):

```sql
CREATE POLICY "Users read own lesson packages"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'lesson-packages'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
```

## Step 3 — Deploy Edge Functions

```bash
npx supabase login
npx supabase link --project-ref eywpksapztzbnthlgfhd

npx supabase secrets set \
  OPENROUTER_API_KEY="<your key>" \
  SPEECH_API_URL="https://<your-vercel-domain>/api/speech"

npx supabase functions deploy lesson-prep-enqueue
npx supabase functions deploy lesson-prep-worker
npx supabase functions deploy lesson-feedback-speech
```

Set `SUPABASE_SERVICE_ROLE_KEY` in Edge secrets from Dashboard → Settings → API (do not commit it).

## Step 4 — Optional cron

Every minute POST to `https://eywpksapztzbnthlgfhd.supabase.co/functions/v1/lesson-prep-worker` with service role Authorization, body `{"kick":true}`.

## Step 5 — Client

See `docs/ALL_IN_ONE_IMPLEMENTATION_PROMPT.md` for full agent prompt (modal + enqueue + download + offline player + feedback audio).

## Step 6 — Finish worker stubs

Implement `generateStructure`, `generateBoard`, `synthesizeSpeech` in `lesson-prep-worker` by porting client teaching engine + speech APIs.

## Why auto-deploy was not done from the agent environment

No Supabase CLI session and DDL requires SQL Editor / Management API. Run steps 1–3 once on your machine.
