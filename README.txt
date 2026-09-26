AVELUT FIXES — drop-in files
============================

Copy these files into your avelut repo root (overwrite):

  components/UploadCenter.tsx
  components/Header.tsx
  components/tutorial/TeachingEngineSessionView.tsx
  components/tutorial/LiveSynchronizedTutorialView.tsx
  services/teachingEnginePrompt.ts
  services/teachingEngineService.ts
  capacitor.config.json

Then:
  npm run build
  npx cap sync android   # if native

What each file fixes:
1. UploadCenter.tsx
   - PDF/image course form extraction detects level (100lvl…) and semester (first/second)
   - Saves under correct levels/{level}/courses path with semester
   - UI shows editable Level + Semester dropdowns per extracted course

2. teachingEnginePrompt.ts
   - After intro, concept boards MUST draw diagrams
   - Comparison boards MUST use tables
   - At least one diagram/table in first 3 post-intro boards

3. teachingEngineService.ts
   - After student interrupt answer, lesson auto-resumes (no hang)

4. TeachingEngineSessionView.tsx
   - isAnsweringOnBoardRef so resume works after mic interrupt

5. LiveSynchronizedTutorialView.tsx
   - Auto-continues playback after student question (~4.5s)

6. Header.tsx + capacitor.config.json
   - Safe-area padding; StatusBar no longer overlays webview
