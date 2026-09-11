# ALL-IN-ONE PROMPT — Avelut Cloud Lesson Prep + Offline Player + Modal Fix

Paste into your coding agent with repo tlord101/avelut open.

## Goals

### A. Modal
In `components/tutorial/LessonDurationModal.tsx` change sheet `mb-8 sm:mb-0` → `mb-[52px] sm:mb-0` (~20px higher on mobile).

### B. Cloud prep
Replace client sequential board/TTS loop in `lessonPrepService.startPrep` with:
1. POST Edge Function `lesson-prep-enqueue` (user JWT) with topicTitle, courseName, syllabusContext, durationMode, voice, contentHash
2. Realtime (or 2s poll) on `lesson_prep_jobs` by prep_key
3. Map job status → LessonPrepStatus (preparing / failed)
4. When job.status === ready: download structure+boards+audio via Storage signed URLs; install into existing lessonPackageStore / checkpoint keys; only then local ready + notifications
5. Resume = re-enqueue / continue download
6. Do not run old client generate loop for new preps

### C. Offline player guard
If loadReadyPackage succeeds: hydrate caches; offlinePackageMode=true; forbid structure/board/full TTS network; no “Lecturer preparing…” UI; single audio owner from package.

### D. Micro-check feedback
POST lesson-feedback-speech for ~3s audio; else text; never regenerate next board.

### E. Worker
Port generateStructure, generateBoard, synthesizeSpeech into `supabase/functions/lesson-prep-worker/index.ts` from teachingEngineService / lessonPrepService / api/speech.

### Acceptance
- Modal higher on mobile
- Prepare creates cloud job without client board loop
- Open lesson starts immediately offline when package installed
- No dual voices
- Kill app mid-prep; resume works
- Question feedback short audio or text then local next board

See also docs/CLOUD_LESSON_PREP_DEPLOY.md for SQL + deploy commands.
Files already in repo under supabase/ and docs/.
