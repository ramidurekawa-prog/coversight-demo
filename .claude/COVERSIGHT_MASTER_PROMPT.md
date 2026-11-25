# PASTE THIS ENTIRE PROMPT INTO CLAUDE CODE (FROM THE COVERSIGHT REPO)

You are my senior product-design, frontend-engineering, restaurant-operations and quality-assurance team. Execute a complete, repo-grounded Coversight UX modernization and reliability pass using the installed `coversight-ux-pipeline` skill.

**Objective:** Make Coversight feel like world-class, reliable software for actual restaurant owners and managers, with an extremely fast, action-first interface and transparent financial claims. I want the strongest realistically achievable design, not cosmetic mockups. Inspect the whole current app and improve it in working code, preserving core functionality.

## Activate the stack

1. Read and follow `CLAUDE.md`, `.claude/skills/coversight-ux-pipeline/SKILL.md`, `docs/COVERSIGHT_DESIGN_SYSTEM.md` and `docs/QUALITY_SCORECARD.md`.
2. Verify tool availability rather than assuming successful installation. For inspiration use **Taste Skill** (`design-taste-frontend`); for critique and cleanup use **Impeccable**; for restrained interaction polish use **Emil Kowalski** (`emil-design-eng`, `review-animations`); use **Playwright CLI** for actual browser execution and screenshots. Use the **Figma** plugin only if it is connected **and** an actual Figma file/selection is available. If anything is unavailable, transparently continue with the verified tools and record the limitation.
3. Respect the product's existing codebase, architecture, brand decisions, and live business logic. Do not convert app pages into marketing landing pages.

## Audit before edits

- Read package scripts/config, routes, relevant components/hooks/services, shared primitives and chart libraries. Map the actual current pages, data models and demo vs real sources. Preserve all current uncommitted work.
- Start the app locally and inspect all reachable pages. Prioritize **Today, Service, Labor, Data Inputs**, then evaluate other connected pages and shared components. Do not assert a route exists without verifying it.
- Take baseline desktop and mobile screenshots with Playwright; test visible controls, navigation, inputs, state changes and failure states. Trace KPIs, forecasts, savings and recommendations to their actual implementation.
- Produce a baseline scorecard by page using the project rubric and identify the highest-impact problems. This audit is required; don't skip to a sweeping redesign based on assumptions.

## Redesign and implement, not just recommend

- Build one coherent visual system from the real current design tokens, fonts and components. Favor warm cream, restrained persimmon, deliberate semantic color, strong alignment and excellent typography when consistent with our existing brand.
- Make visual hierarchy unmissable: what is happening → why it matters → recommended action → evidence/uncertainty → verification. Minimize unnecessary clicks and scrolling without compressing important decisions into illegible clutter.
- For Today: center high-priority actionable issues, quick CTAs, business impact, and optional customization without clutter.
- For Service: distinguish lunch and dinner, current service from forecast, staffing thresholds and actionable recommended cut/retain decisions. Preserve operator rules and time-dependent safety; label uncertainty and manager approval.
- For Labor: show all days, staffing vs demand, clear labor implications, simple controls and planning decisions. Preserve underlying calculations.
- For Data Inputs: make manual data entry effortless, grouped, validated and visibly saved, with accurate provenance and useful error/empty states. Integrations may be incomplete; don't fabricate them.
- Improve shared navigation, page density, responsive screens, button states, forms, table interaction, visual consistency, loading feedback, error messages and accessibility where the audit shows real gaps.
- Ensure any new motion is purposeful, fast, optional for reduced-motion users and does not distract from operational decisions.
- Make meaningful code changes route by route. Do not simply write a roadmap, generate static prototypes or leave dead buttons. Reuse components and test business logic.

## Loop until verified

For each implementation batch: edit → build/typecheck/test → run app → inspect with Playwright → capture screenshot → interact with the page → fix discovered defects → recheck. Test desktop, tablet, and mobile; keyboard controls, focus visibility, empty/error/loading states and important workflows. Where possible use real data paths or clearly identified demo fixtures; never claim a financial action was verified without proof. Run Impeccable checks. Fix critical and high-priority issues, and explicitly report what you could not verify.

## Required output

Provide a concise page-by-page audit (before and after score with evidence), exact files changed, screenshots/artifact locations, checked browser flows and commands/results, remaining bugs and a prioritized final punch list. Grade progress based on tested reality, never inflate to 100/100. Do not deploy, force push, delete data, change production permissions, or spend money without my approval. Do not pause after giving only a plan: begin the actual audit and implementation in this session. If blocked by login/auth or permissions, complete everything possible offline and list the precise human actions required.
