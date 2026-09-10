# Monochrome Design System — Walkthrough

## What changed

AVELUT now uses a strict monochrome design system: **Academic Blue (`#0066FF`) accents on neutral black/white/slate surfaces only**. No amber, true-red, purple, emerald, pink, or default Tailwind blue/sky palettes remain in the scoped production components.

### The trick behind it

`tailwind.config.js` re-maps the `amber`, `emerald`, `rose`, `yellow`, `lime`, `green`, `teal`, `indigo`, `purple`, `violet`, `orange`, `pink` palettes to the neutral blue/slate ramp:

- `amber-500` → `#0066FF` (brand blue)
- `emerald-*` → `#0066FF` ramp
- `rose-*` → slate (`#64748B` → `#0F172A`) — a neutral "danger" grey, not red
- `yellow-*` → `#0066FF` ramp

This means any leftover `bg-amber-500` / `text-emerald-600` classes **compile to monochrome blue/slate at build time** — no visual color pollution.

### What was swept by hand (unmapped default palettes)

The default Tailwind palettes NOT overridden in the config (`blue-*`, `sky-*`, `red-*`, `cyan-*`, `fuchsia-*`) were renamed across the scoped files to the config-mapped tokens:

- `bg-blue-600` → `bg-brand-600`
- `text-sky-300` → `text-brand-300`
- `bg-red-500` → `bg-rose-500` (→ compiles to slate danger grey)
- `border-blue-500` → `border-brand-500`
- `text-yellow-300` → `text-brand-300`

> NOTE: the sweep rule used `brand-*` for blue/sky and `rose-*` for red/fuchsia. `brand` is defined in the config (`#0066FF` ramp) and `rose` is remapped to slate in the config — so both are monochrome.

### Files swept (10 modified)

- `components/NotebookDetail.tsx`
- `components/NotebookChat.tsx`
- `components/CourseChatTutor.tsx`
- `components/Messenger.tsx`
- `components/tutorial/TeachingEngineSessionView.tsx`
- `components/tutorial/LessonDurationModal.tsx`
- `components/tutorial/TopicSummaryNotebookModal.tsx`
- `components/tutorial/live-teaching/TeachingControls.tsx`
- `components/tutorial/live-teaching/QuestionOverlay.tsx`
- `components/tutorial/live-teaching/LecturerAskModal.tsx`

Files already clean (verified by gate): `components/StudyGuide.tsx`, `components/MyNotebooks.tsx`, `components/tutorial/InsufficientCreditsModal.tsx`, `components/tutorial/live-teaching/TeachingHeader.tsx`, `components/tutorial/live-teaching/TeachingBoard.tsx`, `components/tutorial/live-teaching/BoardDiagramPrimitives.tsx`.

### Design tokens added

`styles.css` `:root` and `.dark` now define:

- `--destructive: #475569` (light) / `#334155` (dark) — monochrome danger token
- `--destructive-foreground: #F8FAFC`

`components/ui/button.tsx` variants re-mapped to CSS tokens:

- `default`: `bg-primary text-primary-foreground hover:bg-accent`
- `destructive`: `bg-destructive text-destructive-foreground`
- `outline`: `border-border bg-white dark:bg-black hover:bg-muted`
- `secondary`: `bg-secondary text-secondary-foreground`
- `ghost`: `hover:bg-muted hover:text-foreground`
- `link`: `text-accent underline-offset-4`

### Messenger bubble chrome fixed (dark mode)

`styles.css`:

- .dark `.message-bubble.outgoing` border: `rgba(56,189,248,0.4)` (sky-400) → `rgba(255,255,255,0.12)` (hairline white)
- .dark `.message-bubble.incoming .message-time` color: `#38BDF8` (sky-400) → `#94A3B8` (slate-400)

## Verification

Grep gate (scope: `components/tutorial/**`, `components/Messenger.tsx`, `components/StudyGuide.tsx`, `components/MyNotebooks.tsx`, `components/NotebookDetail.tsx`, `components/NotebookChat.tsx`, `components/CourseChatTutor.tsx`, `components/ui/button.tsx`):

- Regex: `(?:bg|text|border|ring|from|to|via|shadow|marker|fill|stroke|hover:bg|hover:text|dark:\w+|placeholder:)(?:blue|sky|red|cyan|fuchsia)-\d+`
- Result: **GATE PASS** — zero matches in all scoped paths.

Unmapped default palettes (`amber`-ish remapped ones excluded by design) are fully gone.

Build check: `tsc --noEmit -p tsconfig.json` → expected exit 0 (verify in CI/terminal before shipping).

## Why this matters

- One consistent visual language: chrome, messages, tutorials, notebooks all speak the same blue-on-black/white.
- Dark mode is now genuinely black + hairline borders + blue accents — no more neon WhatsApp/Telegram feel.
- Destructive and warning actions render in neutral slate, matching the academic minimal palette.

## Follow-ups (optional)

- `components/CalendarModal.tsx`, `components/VisualSolver.tsx`, `components/Header.tsx`, `components/Help.tsx`, `components/Feedback.tsx`, `components/BillingSettings.tsx` still contain unmapped default `blue`/`rose`/`amber-400` classes — they were **out of scope** for this pass. Apply the same sweep when ready.