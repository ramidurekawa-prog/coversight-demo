---
name: coversight-ux-pipeline
description: Audit, redesign, implement, and browser-test Coversight operator pages using Taste Skill, Impeccable, Emil Kowalski skills, Playwright CLI, and optional Figma context. Use whenever improving app UX or visuals.
---

# Coversight UX → implementation → verification

## 0. Preflight

Work from the **current repo**, not a mocked or assumed app. Read the root `CLAUDE.md`, `docs/COVERSIGHT_DESIGN_SYSTEM.md`, and `docs/QUALITY_SCORECARD.md`. Run `git status --short`; preserve all user modifications. Determine the actual framework, project scripts, route/component topology, data source adapters, typecheck/build/test commands, and authentication requirements. Do not use production credentials or modify real customer data. List installed design skills and CLI tools and report any unavailable ones.

## 1. Reality-first baseline (mandatory)

- Inventory all user-facing routes/pages; locate Today, Service, Labor, Data Inputs, and any related shared components.
- Run the app locally using its documented script. Browse each page and capture baseline screenshots at desktop and phone dimensions using `playwright-cli` where possible.
- Record whether each visible element actually works (buttons, dropdowns, date selectors, filters, dialogs, navigation, manual inputs, save/cancel, loading/empty/errors).
- Trace the visual numbers back to source code/API or mock/demo adapters; distinguish actual, forecast, assumed, manual, and verified. Flag impossible or ungrounded economic claims.
- Audit operator tasks and accessibility before proposing stylistic changes. Treat a missing tool or blocked login as a blocker, never a pass.
- Grade with the attached scorecard, clearly identified as an editorial rubric (not an empirically measured universal score).

## 2. Design synthesis

- Consult **Taste Skill** for visual direction/references; adapt it to a data-dense operational app rather than copying marketing/landing-page sections.
- Consult **Impeccable** (`/impeccable init` if needed; its audit/critique/detector workflow) for typography, whitespace, consistent hierarchy, contrast, and AI-generated UI anti-patterns.
- Consult **Emil Kowalski's** `emil-design-eng` and `review-animations` for restrained motion, interaction feedback, layout and transitions. Remove motion that increases cognitive load; honor reduced-motion.
- If the user supplied an actual Figma file/frame and the official Figma integration is connected, compare intended components/tokens/measurements with code. Do NOT assume a Figma file exists or use it if disconnected.
- Establish/reuse a single design system using real existing tokens. Prefer operator actionability to flourishes.

## 3. Decision and implementation sequence

Prioritize by: **incorrect data/unsafe recommendations > broken interactions > confusing decisions > accessibility/responsiveness > visual consistency > polish**.

Iterate by route or coherent component group. For each:
1. State primary user job, top decision, essential context and next action.
2. Propose changes, map exact affected files, and preserve data contract/behavior.
3. Implement production-quality code using the project's patterns; avoid unrequested new dependencies.
4. Show one clear primary CTA, relevant savings/impact and confidence provenance; don't invent values.
5. Keep deep analytics accessible but not in the primary scanning path. Minimize required clicks/scrolled distance without over-compression.
6. Verify empty, error, loading, permissions, manual vs connected data, and mobile states.

## 4. Browser QA loop

- Launch local server; determine actual address from terminal output.
- Use official Playwright CLI commands and references (`playwright-cli` or `npx playwright cli`); do not invent click targets. Take snapshots/screenshots at desktop (~1440px wide), tablet (~768px), and mobile (~390px) where the app supports them.
- Exercise the actual major workflows, not only view screens. Validate user input, controls, form errors, dialog focus, state persistence when applicable, routing, and failure handling. Check keyboard and visible focus.
- Inspect browser console, network errors, layout overflow, text clipping, touch targets, contrast and reduced motion.
- Run available lint, typecheck, test, build and any relevant Impeccable detector steps. Only run commands actually supported by this repository; if absent, report that.
- Fix verified defects and repeat until no **known critical** issues remain, or clearly report blockers. Screenshots alone are insufficient proof of correctness.
- Never fabricate screenshots, coverage, timing, validation outcomes, or numeric ROI.

## 5. Deliverable and stop conditions

Write a compact summary using `docs/DELIVERY_TEMPLATE.md`, with: baseline scores, files changed, before/after screenshots paths, working interactions tested, commands actually run and their outcomes, remaining known gaps, and what needs a human decision. Prefer explicit results over claiming '100/100'. Do not deploy/commit/push without user instruction. Stop and ask before destructive/irreversible actions, spending money, logging into third-party accounts or touching production data.

If asked to "automate all pages", start with an exhaustive audit, implement the highest-impact fixes per page in order, and continuously run checks as context/time permit. Never claim the work is ongoing beyond this Claude Code session.
