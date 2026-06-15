## 2025-05-15 - [Icon-only Button Accessibility]
**Learning:** Many interactive elements in the chat interface (AvelutAI) were implemented as icon-only buttons without `aria-label` or `title` attributes, making them inaccessible to screen readers and providing no visual hint on hover.
**Action:** Always ensure icon-only buttons have descriptive `aria-label` for screen readers and `title` for native hover tooltips.

## 2025-05-15 - [Chat Message Utility]
**Learning:** Users often need to copy AI-generated content for use in other documents. Providing a discrete "Copy" button within the message bubble improves utility without cluttering the UI.
**Action:** Include a "Copy" action with immediate feedback (toast) for long-form AI responses.

## 2025-05-16 - [Keyboard Navigation Focus States]
**Learning:** Removing default browser focus outlines (`focus:outline-none`) without providing a visible alternative breaks accessibility for keyboard-only users. Use `focus-visible` with a high-contrast ring to provide a focus indicator only when navigating via keyboard.
**Action:** Replace `focus:outline-none` with `focus-visible:ring-2` (and appropriate color/offset) to maintain design aesthetics while ensuring accessibility.

## 2025-05-16 - [Aria Label Redundancy]
**Learning:** Adding `aria-label` or `title` to buttons that already contain visible text labels creates redundancy for screen readers and visual clutter with tooltips. Only use these attributes for icon-only buttons or when the visible text is insufficient to describe the action.
**Action:** Reserve `aria-label` and `title` for interactive elements without clear visible text.
