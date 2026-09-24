# Avelut Realtime Visual Tool Fix

## Status on branch `fix/visual-tool-routing`

- `services/live-classroom/teacherPrompt.ts` — **already updated** (multi-tool visual routing).
- `services/live-classroom/QwenRealtimeTeacherService.ts` — apply the patch below (file was too large for a single API write in this session).

## Apply the service patch

```bash
git checkout fix/visual-tool-routing
git checkout main -- services/live-classroom/QwenRealtimeTeacherService.ts
git apply docs/QwenRealtimeTeacherService.visual-routing.patch
# Also update silence tools array to this.getTools() if the patch only hits one occurrence:
# Replace remaining tools: [this.buildBoardActionTool()] with tools: this.getTools()
git add services/live-classroom/QwenRealtimeTeacherService.ts
git commit -m "fix(live-classroom): apply visual tool routing to QwenRealtimeTeacherService"
```

## Visual selection rules

- Formula/equation → `board_action`
- Calculation/derivation → `board_action`
- Sequential procedure → `board_action`
- Concept relationships / maps / flows / hierarchy → `draw_mermaid`
- Physical/scientific object → `illustrate_object`
- Comparison → compact Excalidraw table-like grid via `board_action`

## Test

"Explain how Optics, Vibration and Waves relate in General Physics IV."

Expected: relationship diagram (e.g. Mermaid hierarchy), not a forced vertical stack of cards.
