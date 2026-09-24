# Duration modal / credits fix

## Status on main
- `utils/usage.ts` — updated (`DeductCreditsResult`, server-preferring deduct)
- `components/NotebookDetail.tsx` — memoized voice session (hooks-safe)
- `components/VoiceTutorialPage.tsx` / `StudyGuide.tsx` — apply patches below if not yet merged

## Root cause
`VoiceTutorialPage` had:
```ts
useEffect(() => { setIsDurationModalOpen(true); setSelectedDurationMode(null); ... }, [topicTitle, courseName, initialSessionData]);
```
Parents rebuild `initialSessionData` every render → modal re-opens → session remounts → Alibaba/speech re-fire → credits charged again.

## Apply
```bash
git apply patches/duration-modal-VoiceTutorialPage.patch
# then finish the rest of handleConfirmDuration (startCommittedRef guard) from the full diff
```

Or pull the full fixed files from a local fix branch.

## What the full fix does
1. `sessionIdentity` from topic/course ids (stable)
2. Reset effect only on `sessionIdentity`
3. `startCommittedRef` prevents double `deductAICredits` / `commitLiveTutorialStart`
4. Memoized session objects in StudyGuide + NotebookDetail
5. `deductAICredits` prefers Supabase RPC, returns sync status
