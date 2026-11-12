# Working on pages in parallel

Several agents can work on different pages at the same time. Each one owns one
page, end to end: its design and its backend. These rules keep their pull
requests from colliding. CLAUDE.md still applies in full.

## Done means

- The person has approved the page's design (on the PR's Vercel preview).
- The page's backend is complete for real customer use: it persists, is
  scoped to the viewer's group and rooms, refuses bad input on the server, and
  works for a sample visitor and for a real account. Nothing on the page is a
  mock-up of behaviour that doesn't exist.
- The design improves what's there. Keep the design system
  (`app/globals.css` tokens and `cv-*` classes, `components/kit.jsx`).

## What a page owns

One branch and one PR per page: `page/<pageId>`.

A page thread edits only:

- `components/screens/pages/<pageId>.jsx`, and new files next to it named
  `<pageId>.*` (for example `<pageId>.module.css` for page-only styles, or
  `<pageId>-chart.jsx`).
- New files under `lib/data/page/<pageId>.js`, `server/page/<pageId>.ts`,
  `app/api/page/<pageId>/**`, `tests/page-<pageId>.test.*`.
- The existing backend it owns (table below).

| Page | Also owns |
|---|---|
| billing | `server/billing.ts`, `lib/data/billing.js` (billing parts only; `bookedBetween`/`utcDay` are shared), `app/api/billing/**` |
| connect | `server/toast-conn.ts`, `server/pos-sync.ts`, `app/api/toast/**` |
| data | `app/api/export/**`, `app/api/org/**` |
| inputs | `components/screens/bring-in.jsx`, `components/screens/toast-import.jsx` (also used by connect: keep its props), `server/links.ts`, `server/extract.ts`, `app/api/inputs/**` |
| system | `components/screens/crew.jsx`, `server/agents/**`, `lib/agents/**`, `app/api/agents/**`, `app/api/activity/**` |
| team | `server/team.ts`, `app/api/team/**`, `app/api/invites/**`, `app/api/orgs/**` |
| today | `components/screens/tasks.jsx`, `server/tasks.ts`, `app/api/tasks/**` |
| windows | `server/proof.ts`, `lib/data/pilot.js`, `app/api/windows/**` |

Everything else is shared.

## Shared files

- **Append-only registries.** Add one line per entry and keep the order. Never
  edit or reorder another page's lines. On a rebase conflict, keep both sides.
  - Icons in `components/kit.jsx`.
  - `ACTION_KEYS` in `server/actions.ts`. Prefix new keys with the page id,
    for example `accountant.closeNote`. Existing keys keep their names.
  - Jobs in `server/jobs.ts`, crons in `vercel.json`.
  - New seed content: a new top-level key in `lib/data/seed.js` named for the
    page. Never change existing seed data.
- **Hands off.** Don't change these in a page PR: `components/screens/core.jsx`,
  the shared helpers in `components/screens/*.jsx` (`week`, `areas`, `extra`,
  `live`, `dense-*`), `components/shell.jsx`, `components/engine.js`,
  `components/screen.jsx`, `lib/pages.js`, `lib/data/model.js`,
  `app/globals.css`, `server/db/client.ts`, auth. If a page needs a change
  there, say so in its thread, and the coordinator gets it landed once for
  everyone.
- **Figures.** Never move a pinned figure (`tests/figures.test.js`,
  `tests/data.test.js`). New computation goes in `lib/data/page/<pageId>.js`,
  is pure, and is what both browser and server call. If a pinned figure has to
  move, stop and ask.

## Database changes

Prefer no migration: use `useSaved` with a new `ACTION_KEYS` entry, or
`room_data`. If a page needs a table:

1. Add it to `server/db/schema.ts` (tables named `<pageId>_*`).
2. Rebase on the latest `origin/main` first, then run `pnpm db:generate`.
   Never hand-number or hand-edit a migration or `meta/_journal.json`.
3. If main gains a migration before your PR merges, drop yours, rebase, and
   generate again.

PRs with migrations merge one at a time.

## Before pushing

Rebase on `origin/main`, run `pnpm check`, and open the PR following
CLAUDE.md: begin with `## Quick Understanding`, end with
`## Unattended-run uncertainties`. Never merge your own PR.
