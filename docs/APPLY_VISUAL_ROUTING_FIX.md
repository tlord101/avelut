# Apply visual routing fix

## On branch `fix/visual-tool-routing`

1. `teacherPrompt.ts` is already updated on the branch.
2. Restore the service file from main, then apply the unified patch:

```bash
git fetch origin
git checkout fix/visual-tool-routing
git checkout main -- services/live-classroom/QwenRealtimeTeacherService.ts
git apply docs/QwenRealtimeTeacherService.visual-routing.patch
# verify
grep -n "NOT mandatory\|Choose the\|Continue naturally\|tools: this.getTools()" services/live-classroom/QwenRealtimeTeacherService.ts
git add services/live-classroom/QwenRealtimeTeacherService.ts
git commit -m "fix(live-classroom): apply visual tool routing to QwenRealtimeTeacherService"
git push origin fix/visual-tool-routing
```

If `git push` fails with auth errors, use a Personal Access Token:

```bash
gh auth login
# or
git remote set-url origin https://<YOUR_PAT>@github.com/tlord101/avelut.git
git push origin fix/visual-tool-routing
```

## Test

Explain how Optics, Vibration and Waves relate in General Physics IV.

Expected: relationship diagram (draw_mermaid), not a forced vertical stack of cards.
