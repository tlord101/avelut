# Board Visual Tools Integration Architecture

## Overview
Avelut Live Classroom incorporates advanced visual rendering tools powered by real-time LLM tool calls. The board primarily handles Excalidraw-native JSON primitives, but now supports arbitrary high-fidelity SVG illustration via a floating SVG rendering slot.

### Realtime Tool Call Schema
The `QwenRealtimeTeacherService` registers three tools for the AI Teacher:
1. `board_action` (Pre-existing): Renders skeletal boxes, arrows, and KaTeX text.
2. `draw_mermaid`: Renders architecture, processes, and flows via `MermaidBoardService`.
3. `illustrate_object`: Generates detailed representations of objects/entities via `LlmSvgObjectCache`.

### 1. draw_mermaid Tool
**Flow:**
- Model calls `draw_mermaid({ mermaid_code })`.
- `QwenRealtimeTeacherService` receives call, invokes `mermaidBoardService.renderToSvg()`.
- `MermaidBoardService` intercepts syntax, ensures a dark theme is configured (`%%{init: {'theme': 'dark'}}%%`), converts to base64, and calls the `mermaid.ink/svg/` API.
- SVG is stored in an in-memory Map cache.
- `AvelutBoardController.setSvgIllustration()` is called, setting the state.
- `AvelutLiveClassroomView` receives state and renders the `dangerouslySetInnerHTML` SVG overlay over Excalidraw.

### 2. illustrate_object Tool
**Flow:**
- Model calls `illustrate_object({ object_description })`.
- `QwenRealtimeTeacherService` receives call, invokes `LlmSvgObjectCache.getOrGenerate()`.
- The cache checks memory, then `localStorage` (cross-session SSR persistence).
- On miss, it asks the non-realtime `qwen3.8-flash` model to generate raw SVG syntax.
- Returns SVG, updates caches, and renders overlay via `AvelutBoardController.setSvgIllustration()`.

### 3. Word Wrap Labeling
Previously, labels dynamically added via `board_action` (e.g. `drawShape`) were hard-truncated at 28 characters. This has been replaced by a word-wrapping engine in `AvelutBoardController`.
- `wordWrap` computes line breaks dynamically based on character count per line (26 chars) without breaking words (unless single word exceeds limits).
- `_drawShape` computes `cardHeight = Math.max(cardHeight, lineCount * 24 + 32)` dynamically ensuring text fits inside rendered Excalidraw shapes.
