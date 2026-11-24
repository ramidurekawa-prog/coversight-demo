# Coversight — Product Design Intent

This document captures intended operator experience. It is not evidence that any current implementation matches it. The live repository and approved Figma components are the source of truth for technical tokens and actual behavior.

## Product principle

Coversight should behave like a restaurant operations copilot above the POS: surface opportunities and problems, show what action to take, enable safe action, then conservatively measure and verify the effect. Prefer trust and clarity over chart density. Make the 3-second scan useful.

## Visual character

- Modern, calm, exceptionally legible, premium B2B software: cream/warm neutrals with selectively applied persimmon if compatible with existing brand tokens.
- A clear information hierarchy: status → critical business impact → recommended decision → action → evidence/details.
- Color carries semantics consistently; never use urgency colors solely for decoration. Do not rely on color alone.
- Reuse one spacing system, typography scale, radii, focus ring, icon family, and chart language.
- Avoid generic gradient-glass cards, unnecessary large empty blocks, excessive shadows, chart overload, gratuitous animation or marketing landing-page conventions.

## Core screens

**Today:** concise daily command center. Lead with prioritized decisions and verified/estimated economic consequences, not a wall of metrics. Allow role-based personalization only after a clean default. Important actions should not require repeated navigation.

**Service:** real-time lunch/dinner staffing and demand. Answer whether coverage is safe, whether/when to cut or retain staff, and why under the manager's own rules. Forecast bands must be identified, with safe minimums and current-vs-expected clarity. Never imply an employment action is automatically authorized.

**Labor:** week-wide and day-level forecast, shift planning, gaps, and estimated financial tradeoffs. Keep all requested days accessible. Explain assumptions and show any manager override.

**Data Inputs:** fast, accurate, well-structured manual input while integrations are being built. Strong validation, visible saved/unsaved states, clear time periods and data provenance; distinguish demo seed data from real submissions.

## Experience constraints

- Very low cognitive load and clicks, but do not bury necessary evidence or tradeoffs.
- Meaningful CTAs, clear information density, excellent mobile behavior and keyboard operability.
- Truthful states: forecast ≠ observed; estimated savings ≠ verified realized savings.
- Respect existing data integrations and protect calculations; visual changes cannot silently alter business logic.

## Where the real system lives in this repo (checked 2026-11-23)

- **Tokens:** `app/globals.css` (base scale, from the monorepo's design system) and `app/theme.css` (Persimmon & Ink: `--cv-selected` #FF8050 for action, navy sidebar, cream `--background` #F8F6F0). `app/page-style.css` holds Today's card and type treatment that other pages carry over.
- **Font:** Manrope app-wide (`@fontsource/manrope`).
- **Semantic colour:** green for anything positive or potentially positive (potential keeps its claim label), red for a real problem, amber for caution, never persimmon for status. Amber text uses `--warning-600` (#94600F, 4.8:1 on `--warning-50`); `--warning-500` is for fills and icons only.
- **Claims:** every dollar carries one of Estimated, Modeled, Causal, Bookable, Observed (`Claim` in `components/screens/core.jsx`), with its icon, never colour alone.
- **Components:** `components/kit.jsx` (Button, Icon), `components/screens/core.jsx` (Pill, Claim, Callout, the approval sheet), `components/dialog.js` (`useDialogFocus`: every dialog moves focus in, keeps Tab inside, closes on Escape and gives focus back).
- **Fix in place:** a page that carries what a Sous suggestion would open elsewhere marks it `data-agent-here="<page>"` (and `data-agent-label`), and the suggestion acts there instead of switching pages.
