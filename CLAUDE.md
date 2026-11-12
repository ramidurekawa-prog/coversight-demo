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
- **Pages:** add a screen in `lib/pages.js` (title, icon, nav group) and map
  it in `components/screen.jsx`; `tests/routes.test.js` enforces both. Id
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
- **Jobs and tests:** `server/jobs.ts` (sync, links, detection, proof, reverify, billing, cleanup)
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
    Claude when `ANTHROPIC_API_KEY` is set; rows always go back for review.
- **The agent crew:** `lib/agents/` (pure). `crew.js` holds the 19 roles; each
  subscribes to events and returns *effects*; `policy.js` `authorize()` checks
  every effect (permission level, the one agent a job belongs to, and the
  eleven `NEVER` rules) before `cycle.js` applies it through a store
  (`server/agents/store.ts` on Postgres, `memory-store.js` in the browser
  preview and tests). Agents never start tests, write back, raise autonomy,
  commit data or confirm mappings: a person's accept in `server/agents/service.ts`
  does that, as that person. `tests/crew-scenarios.test.js` grades the crew on
  scenarios; add one when an agent learns something new.
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
