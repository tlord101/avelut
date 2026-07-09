## 2025-05-15 - [Icon-only Button Accessibility]
**Learning:** Many interactive elements in the chat interface (AvelutAI) were implemented as icon-only buttons without `aria-label` or `title` attributes, making them inaccessible to screen readers and providing no visual hint on hover.
**Action:** Always ensure icon-only buttons have descriptive `aria-label` for screen readers and `title` for native hover tooltips.

## 2025-05-15 - [Chat Message Utility]
**Learning:** Users often need to copy AI-generated content for use in other documents. Providing a discrete "Copy" button within the message bubble improves utility without cluttering the UI.
**Action:** Include a "Copy" action with immediate feedback (toast) for long-form AI responses.

## 2025-06-20 - [Automated Testing of Password Toggles]
**Learning:** When implementing password visibility toggles, standard Playwright locators like `get_by_role('textbox', name='Password')` will fail when the input is in `type="password"` mode, as it no longer carries the 'textbox' role. Additionally, multiple elements (input and toggle button) might share the same ARIA label or text, causing strict mode violations.
**Action:** Use unique `id` and `htmlFor` attributes for all form inputs. For testing toggles, prefer targeting by label (`get_by_label`) or specific CSS selectors to ensure the element is found regardless of its current `type` attribute.

## 2025-07-10 - [Tactile and Visual Feedback in Auth Flows]
**Learning:** Authentication screens are high-friction areas where users benefit from immediate, reassuring feedback. Adding tactile (haptic) and visual (scaling) feedback to every interaction (form submission, password toggles, navigation) makes the flow feel more physical and responsive, reducing the perceived effort of the login/signup process.
**Action:** Consistently apply `active:scale-95 transition-all` and `void triggerHaptic()` to all interactive elements in critical user journeys (Auth, Onboarding, Checkout) to enhance responsiveness.
