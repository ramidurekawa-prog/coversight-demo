# Lever page redesigns: the shared brief

Every lever-page agent in `.claude/agents/lever-*.md` reads this file first.
It holds the rules all of them share. The agent file adds what is specific to
its own page. CLAUDE.md and `docs/PAGE_THREADS.md` still apply in full; where
this file is stricter, follow this file.

## What the levers are

Lever Check (page id `summary`, `lib/data/page/summary.js`, PR 78) is the hub
for the levers: one card per lever, grouped, with a status (green on track,
amber drifting, red worse than a normal week or a limit crossed with dollars on
it, grey no data). It is **not** the home page. Each lever card opens a lever
page, and that page is what these agents redesign.

| Lever Check card | Group | Opens page | Agent |
|---|---|---|---|
| Sales & guests | Guests & sales | `week` (has its own thread) | none |
| Tables | Guests & sales | `throughput` | `lever-throughput` |
| Delivery | Guests & sales | `channels` | `lever-channels` |
| Staff | Your team & the shift | `labour` | `lever-labour` |
| Kitchen speed | Your team & the shift | `kitchen` | `lever-kitchen` |
| Giveaways | Your team & the shift | `controls` | `lever-controls` |
| Menu prices | Food & drink costs | `menu` | `lever-menu` |
| Supplier prices | Food & drink costs | `purchasing` | `lever-purchasing` |
| Food used | Food & drink costs | `inventory` | `lever-inventory` |
| Bar & drinks | Food & drink costs | `inventory` | `lever-inventory` |

Until PR 78 merges, read `summary.js` from its branch
(`git show origin/claude/project-thread-g0fho5:lib/data/page/summary.js`).

## The goal: a full redesign, built to completion

"Build every lever to completion" (Ramidu, 2026-11-18): each lever works end to
end for a real restaurant, not only the sample. A full redesign means a new
layout, new copy and the backend behind it, not a restyle of today's page.

The page must answer, in this order:

1. **How is this lever doing?** One answer-first headline and one big number,
   the same figure and status as its Lever Check card.
2. **What is the one thing to do?** One action card with the money at stake,
   its claim strength and the single persimmon button.
3. **Why?** One picture (a chart or a simple visual) that shows the problem
   without reading.
4. **The detail.** Tables, breakdowns, method, data sources and the quiet notes
   about feeds sit behind a click ("See why", a fold or a drawer).

## The rules every lever page follows

**The 8-year-old test.** Imagine an 8-year-old looking at the screen. Could they
tell what it is about, whether it is good or bad, and what to press? If not,
simplify. Everyday words: "Staff" not "labor share", "giveaways" not "comps",
"food used but not sold" not "usage variance", "tables" not "throughput". Each
element gets one number and one sentence. No unlabeled charts, no tag clutter.

**Sell the outcome.** Lead with what the owner gets (money kept, a full room,
a calm Friday), framed against the industry's real complaints for this lever,
per restaurant and per role (owner, GM, kitchen, bar). Give Coversight's own
parts their own names (as with Covercast and Sous). Borrow what works in the
best restaurant software and in past restaurant consulting; never copy a
competitor's look or name.

**Little to read, little to scroll.** About two minutes to understand and act.
Real emphasis where it matters, and nowhere else. Polish like a strong SaaS
product page. The answer and the action fit above the fold on a 1440 x 900
desktop and are the first thing on a phone.

**Today's style.** Manrope; headline and key numbers about 36 px, body about 17;
the Persimmon & Ink palette from `app/theme.css` and the kit in
`app/page-style.css`. Persimmon is for action and selected states only, green
for verified good, red for a real problem, amber for caution or late data, navy
for structure. Exactly one filled persimmon button per page. Colour a change
only when it matters. Use existing `cv-*` classes and `components/kit.jsx`
before adding styles; page-only styles go in `<pageId>.module.css`. If the page
has its own module, add it to `OWN_STYLE` in `components/screen.jsx` through
the coordinator (that file is hands-off for page threads).

**Numbers are computed, never typed.** Every figure comes from
`lib/data/model.js` or a new pure `lib/data/page/<pageId>.js` that both browser
and server call. Never fabricate data, never move a pinned figure
(`tests/figures.test.js`, `tests/data.test.js`); stop and ask if one has to.
Counts reconcile from one source. Every number names its period ("last week",
"tonight so far", "28 days").

**Trust.** Every dollar carries its claim strength with its icon (Estimated,
Modeled, Causal, Bookable, Observed), never colour alone. Unrealized money is
"potential", never "saved", until a test verifies it. Hold back a
recommendation that rests on a late feed. Verified rates are frozen. Mark only
non-observed numbers; one line says unmarked numbers come from the
restaurant's own data.

**Integrations are placeholders with a manual path.** Every feed (Toast,
7shifts, delivery apps, invoices, counts) switches on when its key or
connection is added. When it is missing or down, the page still works from
hand-entered data (`/inputs` kinds, `useSaved` keys), labelled as hand-entered.
Missing or late connections never change the lever's status and never shout:
they are a quiet note behind the detail click. Never ask for API keys.

**Sous.** Once PR 72 merges, the page's Sous specialist (`lib/ai/agents.js`, the line checks in
`lib/ai/playbook.js`) is a deep consultant in this lever. The shell
draws its strip above the page; check the page looks right under it. If the
lever's checks are thin, add this page's entries only (append, never edit
another page's), with the rule each one follows.

**Plain owner view.** US spelling (Labor, Modeled). No developer or demo chrome
in the owner view; anything like that hides behind `?tools=1`.

## Backend: done for real customers

As `docs/PAGE_THREADS.md` says: the page persists what people decide, is scoped
to the viewer's group and rooms, refuses bad input on the server (zod schema
and scope in `server/actions.ts` `ACTION_KEYS`, keys prefixed with the page
id), and works both for a "try the sample" visitor and for a real account with
its own Toast data. Nothing on the page pretends to do something it does not.
Actions that change the business create tasks through `server/tasks.ts`
`createTask` and tests through `server/proof.ts`; agents never start tests or
write back on their own.

## How a redesign run goes

1. Read CLAUDE.md, `docs/PAGE_THREADS.md`, this file, your agent file, the
   current page and every helper it imports, the lever's card in `summary.js`,
   and the project memory files your agent file names.
2. Write a short plan for the thread (what the page will say, the one action,
   the picture, what moves behind a click, the backend pieces) and post it
   before building when Ramidu is around; otherwise build the plan and say
   which reading you chose.
3. Build on one branch and one PR for the page. Edit only the files your page
   owns; ask the coordinator for anything hands-off.
4. Add `tests/page-<pageId>.test.*` that pins the page's own figures to the
   model and checks the headline matches the Lever Check card.
5. Run the page on the sample and on a Toast room. Screenshot desktop
   (1440 x 900, fold and opened detail) and phone into
   `/mnt/project-files/<pageId>/` as `v1-desktop.png`, `v1-open.png`,
   `v1-phone.png` (next round v2, and so on), and check each against the
   8-year-old test before showing it.
6. `pnpm check` before pushing. The PR opens with `## Quick Understanding`
   (plain language), ends with `## Unattended-run uncertainties`, and lists
   anything the page still lacks. Never merge it: Ramidu merges after
   approving the design on the Vercel preview.
