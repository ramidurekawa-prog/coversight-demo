# coversight-demo

A clickable demo of the finished Coversight product on a sample restaurant
group (Rosewood: Oakland, Berkeley, Walnut Creek). Next.js on Vercel with a
Postgres (Neon) backend and real logins; with no database it falls back to the
browser-only demo. It is a sales and investor tool, separate from the platform
monorepo (`ramidurekawa-prog/streamlinekitchenco-platform-monorepo`); nothing
here ships to customers.

## Rules

- **Numbers are computed, never typed.** All data lives in `lib/data/seed.js`;
  every figure comes from `lib/data/model.js`; screens read the current room
  via `CV_D` from `components/screens/core.jsx`. `tests/figures.test.js` and
  `tests/data.test.js` pin the headline figures and check every room's totals
  close. If a pinned figure moves, change it deliberately.
- **Verified rates are frozen.** Inputs (`lib/data/apply.js`) may move
  estimates, observed figures and detectors, never a packet's bookable rate.
- **Room content** (queues, meetings, narrative) is per room in the seed and
  uses `{tokens}` filled by the model; `tests/data.test.js` fails on any
  unresolved token.
- **Every dollar carries a claim strength** (Estimated, Modelled, Causal,
  Bookable, Observed) with its icon, never colour alone.
- **Design system:** tokens and kit classes in `app/globals.css` come from the
  monorepo's design system. Use existing classes before adding new ones.
- **Pages:** one file per page at `components/screens/pages/<pageId>.jsx`.
  Add a screen in `lib/pages.js` (title, icon, nav group) and import it in
  `components/screen.jsx`; `tests/routes.test.js` enforces all three. Helpers
  used by more than one page live in `components/screens/*.jsx`. When several
  agents work on pages at once, follow `docs/PAGE_THREADS.md`. Id
  screens (`/packet/:id`, `/finding/:id`) list their ids in `lib/pages.js`.
- **Icons:** lucide-react, imported by name in `components/kit.jsx`. A new icon
  must be added there (`tests/icons.test.js` catches misses).
- **Dependencies:** latest stable behind pnpm's 14-day release-age gate, same
  as the monorepo's ADR-0010. Exceptions go in `minimumReleaseAgeExclude`
  with a reason.
- **Branching:** never iterate on `main`; work on a branch and open a PR. Agent
  PRs open with `## Quick Understanding` (plain language) and end with
  `## Unattended-run uncertainties`. Never merge your own PR.
- **Backend:** `server/` (Drizzle schema + migrations, Better Auth, org and
  input services), `app/api/*` routes. The dataset is stored seed-shaped per
  room and kind (`room_data`) so `lib/data/model.js` still computes every
  figure; never compute figures on the server differently from the browser.
  Every account and every "try the sample" visitor gets a private copy of the
  sample group. Schema changes: edit `server/db/schema.ts`, then
  `pnpm db:generate` and commit the migration. `tests/server.test.ts` runs
  against PGlite (no Postgres needed).
- **Operator decisions** (cleared cards, approvals, meetings, fences, plan
  hours, the period package) use `useSaved(key, initial)` from
  `components/engine.js`; each key needs a zod schema and scope in
  `server/actions.ts` `ACTION_KEYS`, or the server refuses it.
- **Jobs and tests:** `server/jobs.ts` (sync, links, detection, proof, reverify, billing, cleanup, sous)
  run from Vercel Cron (`vercel.json` → `/api/cron/<job>`, `CRON_SECRET`) or
  "Run now". Test windows (`server/proof.ts`) are measured in weeks of the
  room's *data* via `lib/data/readers.js` and closed with `lib/data/pilot.js`;
  never book anything outside `windowState`.
- **Ingestion lanes.** Every lane ends in the same reader and checks; never
  compute a figure differently by lane.
  - *Lane 1, POS:* `server/pos-sync.ts` pulls Toast's Standard API a business
    day at a time into `pos_days` (rows shaped like the exports by
    `lib/data/toast-api.js`) and rebuilds the room's `toast` input with
    `summarizeToast()`. Nightly `sync` job (hourly needs Vercel Pro: Hobby rejects sub-daily crons at deploy); 13-week backfill over several runs.
  - *Toast exports:* `lib/data/toast.js` reads Toast's data-export CSVs in the
    browser into the `toast` input kind; `server/toast-schema.ts` bounds it.
  - *Lane 2, easy imports:* `lib/data/sniff.js` reads anything dropped or
    pasted (CSV/TSV, .xlsx via `lib/data/xlsx.js`, zips) and classifies each
    table; the Data inputs review panel still validates and previews it.
    `server/links.ts` fetches Google Sheets / Dropbox links (those hosts only)
    and re-reads linked ones daily (`links` job), committing only tabs with
    zero errors. `server/extract.ts` reads a photo or PDF into rows with
    Claude (through the shared AI engine) when `ANTHROPIC_API_KEY` is set; rows always go back for review.
- **The agent crew:** `lib/agents/` (pure). `crew.js` holds the 19 roles; each
  subscribes to events and returns *effects*; `policy.js` `authorize()` checks
  every effect (permission level, the one agent a job belongs to, and the
  eleven `NEVER` rules) before `cycle.js` applies it through a store
  (`server/agents/store.ts` on Postgres, `memory-store.js` in the browser
  preview and tests). Agents never start tests, write back, raise autonomy,
  commit data or confirm mappings: a person's accept in `server/agents/service.ts`
  does that, as that person. `tests/crew-scenarios.test.js` grades the crew on
  scenarios; add one when an agent learns something new.
- **AI (Sous):** every AI call goes through `askClaude()` in `server/ai/claude.ts`
  (one model, `claude-opus-5-5`, via `@anthropic-ai/sdk`; structured JSON
  replies; a per-group daily allowance). It is a placeholder that switches on
  with `ANTHROPIC_API_KEY`: with no key, or the provider down, every caller
  falls back to its built-in path, so nothing may depend on AI to work.
  Sous, the AI teammate (`lib/ai/sous.js`, pure; `server/ai/sous.ts`;
  `components/sous.jsx`, opened from the top bar on every page), reads a
  derived room into plain-sentence *facts* and answers, briefs and notices from
  those only. AI-written text must pass `numbersOk()` (no figure the facts
  don't contain) or it is discarded. New things for Sous to know are new facts
  in `sousFacts()`, never numbers in a prompt. Every page has its own Sous
  agent (`lib/ai/agents.js`: a name, a job, the fact topics it leads with and
  its questions), shown above the page by `PageAgent` from the shell, so page
  files stay untouched. Agents hold no data of their own: they all read the
  same facts, which is the shared brain. A new page needs an entry there
  (`tests/sous.test.js` fails without one). `lib/ai/moves.js` holds what an
  agent recommends (`sousMoves()`: one move, its stake with a claim, and an
  act that is only ever a draft, an approval sheet or a screen: agents never
  send, approve or change anything themselves), what the room told it
  (`sousRemember()`, saved under the `sous` action key; `sous.seen` per person
  keeps the strip quiet until an agent has something new) and each area's
  verified track record (`agentRecord()`). `sousLinks()` ties one ingredient
  across pages; its figures keep their own claims and are never summed.
  Sous opens as *the Pass* (`sousBoard()`: tickets in three lanes, Do now /
  Keeping an eye on / Proven, with one ask line), not a chat window: keep it
  a board. Each specialist's expertise is its *line check*
  (`lib/ai/playbook.js`: `lineCheck(page, d)`): the things a consultant in
  that area checks, run on the room, each `found` (with the fix), `clear` or
  `needs` (says what data is missing). Wage rules are tables by state and city
  there (`rulesFor(profile)`, from the room's `state`/`city`); never type a
  pay rate or state a rule for a place with no table, and every rule says it
  is a summary to confirm with payroll. A new skill for an agent is a new
  check, which also becomes a fact and can become its move.
  The *day loop* (`lib/ai/loop.js`, `dayLoop()`) gives Day Captain (Today),
  Shift Pulse (Service) and Data Steward (Data pages) their checkups: last
  night against Covercast's day-before call and its last-7-day record, today's
  covers and each service's floor (Service's own `servicePlan`), every decision
  still open (approved but not made, made but not in the data, hand-offs not
  opened, meeting actions due) and the data behind it (stale feeds, missing
  days, typo-looking days). Callers pass the loop's context as `day` (tasks,
  queue hand-offs, open cards, meeting actions, fences; own rooms also their
  series and Covercast). A loop left open (`LOOP_BREAK`) leads the moves;
  staffing advice is held while 7shifts is stale. "What needs me before we
  open?" answers with `openingList()`. Sous talks to
  people who do not want to read: a fact's `say` is one or two short spoken
  sentences and `todo` the one thing to do (an answer shows those first, the
  full record behind "Show me why"); write both for any new fact or check. Sous learns
  by memory, never by retraining (`lib/ai/learn.js`): the room's notebook
  (`sous.notes`, people's own words, read as "You told me" records and shown
  on the moves they bear on; a "never email" note turns an email move into a
  screen), what works here (`sousLearned()` from proofs, the `sous.learn` log
  of moves acted on and what was set aside; `rankMoves()` puts proven kinds
  first and never reorders anything urgent) and the person (`sous.me`: what
  they ask about orders the questions offered). The nightly `sous` job notifies
  what it noticed and pre-writes briefs. `tests/sous.test.js` and
  `tests/sous.test.ts` cover it; `tests/helpers/fake-claude.ts` stands in for
  the API.
- **Forecasting (Covercast):** `lib/data/forecast/` (pure) forecasts covers and
  sales by day, week, service, hour and 15 minutes, with a measured 80% range;
  `server/forecast.ts` + `GET /api/forecast?room=`. Pages that show a forecast
  or "forecast need" read it from here, never their own average. Hand-entered
  signals use the `forecast.signals` action key; feeds (weather, events,
  reservations) live in `server/forecast-feeds.ts` and switch on with a key.
  `tests/forecast.test.ts` checks it beats the usual-night method on the
  sample; `node scripts/covercast-report.mjs` prints the full accuracy report.
  The model is picked per task (`select.js`: day, service, slot, prep; V1,
  V2 = V1 + gradient-boosted trees from `gbm.js`, each method alone): picked
  on the first half of the scored window, used only if it holds up on the
  second, else V1. Sellouts and turned-away guests (`forecast.signals`
  `capacity`) feed demand. `live.js` forecasts the rest of a shift from the
  host's counts (`forecast.live`); `decisions.js` sizes staffing and prep by
  cost and keeps the pilot ledger (`forecast.decisions`). Backtest savings are
  Simulated; only logged outcomes are Observed.
- **Groups and people:** `server/team.ts`. A person can belong to several
  groups; the `cv-org` cookie picks the one in view (`viewerFor` only honours
  it for their own memberships). Invite tokens are stored hashed. Never
  hardcode the sample's room ids in model or screens: derive from `ds.rooms`.
- **Billing:** `lib/data/billing.js` (pure, cents) builds an invoice from
  verified test windows only (accrued per day while verified; credits for days
  billed after a later reversal). `server/billing.ts` drafts monthly, finalizes
  only after the accountant approves that month's package. Finalizing never
  waits on Stripe: delivery (`deliverInvoice`) runs only when
  `STRIPE_SECRET_KEY` is set, resumes from `delivery_progress`, sends an
  Idempotency-Key per call, and retries with backoff after every job run.
  Sample groups are never sent.
- **Notifications:** `server/notify.ts` `notify()` for anything an operator
  should hear about (dedupe key per event); email goes through the outbox and
  Resend only when `RESEND_API_KEY` + `MAIL_FROM` are set, else it's kept as
  skipped. Never email a sample guest.
- **Secrets:** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `CREDENTIALS_KEY`,
  `CRON_SECRET`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY` live in Vercel env only. Never log, return or export them, or
  a Toast client secret.

`pnpm check` = typecheck + tests + build. Run it before pushing.


<!-- COVERSIGHT_CLAUDE_KIT_BEGIN -->
## Coversight: always-on quality standards

Use the `.claude/skills/coversight-ux-pipeline/SKILL.md` workflow for user-facing UI/UX changes, audits, or design-system work. Read `docs/COVERSIGHT_DESIGN_SYSTEM.md` and `docs/QUALITY_SCORECARD.md` first. The repository's actual running code, data contracts and existing tests take precedence over any assumptions in this kit.

**Product job:** Coversight is a restaurant operations decision system, not a generic marketing site or a decorative analytics dashboard. Each page should quickly communicate what is happening, why it matters financially, what decision to make, and how to verify its effect. Optimize for an owner/GM/restaurant operator with limited time and high task urgency.

**Never break these rules:**
- Preserve working integrations, calculations, APIs, routing, authentication, permissions, persisted data, accessibility, and tests while redesigning. Do not delete functionality to simplify a screenshot.
- Never fabricate live restaurant data, verified savings, confidence intervals, test results, or business outcomes. Clearly label demo, manually entered, forecast, and verified values.
- Start with an inventory and baseline audit of the **actual** repository and rendered application. Do not assume a page/feature exists based on this file.
- Reduce scanning/clicking/scrolling without hiding decisions or safety constraints. Favor a primary decision/CTA and clear disclosure of supporting reasoning.
- Use the existing brand system as authority. Cream + persimmon is a visual direction, not permission to invent authoritative brand tokens or change established colors without evidence.
- Respect keyboard use, focus, contrast, touch targets, responsive widths, reduced-motion preferences, and loading/empty/error states.
- For changes to a page, test in a real browser with Playwright CLI at representative desktop and mobile sizes, use screenshots, and retest after fixing failures. Run appropriate repo tests/build checks when available.
- Do not run destructive database commands, migrate production data, reveal secrets, deploy, merge, force-push, or push to remote without explicit user approval. Keep secrets out of screenshots and reports.
- Finish each task with a small, evidence-based scorecard and specify what is untested, unfinished, or blocked.

**Page focus:** Today = a minimal action-first daily command hub; Service = in-shift staffing/coverage decision support; Labor = forecast vs staffing planning with sensible minimums; Data Inputs = accurate, low-friction manual/import entries and trust states. These are product intentions, not assertions about the repo's current implementation.
<!-- COVERSIGHT_CLAUDE_KIT_END -->

