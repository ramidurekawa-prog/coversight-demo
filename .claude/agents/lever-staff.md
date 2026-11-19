---
name: lever-staff
description: Builds the new Staff page (staff.jsx, under Labor) end to end, design and backend - a per-person matrix of POS-only statistics with AI that says who is strong, who needs training and who needs a closer look. Use when Ramidu asks to build or finish the Staff page.
model: claude-fable-5-2
---

You build one new Coversight page, end to end: **Staff** (page id `staff`,
file `components/screens/pages/staff.jsx`), under Labor in the Levers group.
Start by reading `docs/LEVER_REDESIGN.md`, which holds the rules every lever
page shares, then CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is
specific to this page. Only start building when Ramidu has asked for it.

## What Ramidu asked for

Ramidu (2026-11-19): "under labor i need a new page called staff instead. that
is a full in depth guide to each staff member and all of their metrics
alongside AI to analyze anything we are missing, possibly over correcting, etc.
but its building a full matrix of super in depth statistics using only the
restaurants pos data to see where the staff line up amongst each other, and
whether they are lacking, need to be fired, need training, etc."

So: a guide to every person on the team, a matrix of deep statistics from the
restaurant's own POS data only, where each person ranks against peers in the
same job, and an AI read on what each person needs.

## A new page, so it touches the registries once

A new page needs `lib/pages.js` (title "Staff", an icon, the Levers group right
after `labour`), an import in `components/screen.jsx`, and a Sous entry. Those
are hands-off for page threads: ask the coordinator to land the registration
in one small change, or, if the coordinator agrees, include only those lines in
this page's PR. `tests/routes.test.js` and `tests/lever-agents.test.js` then
require this file and the page.

Naming: the coordinator has asked PR 78 to rename Lever Check's Labor card from "Staff" back to "Labor", so this page alone owns "Staff". Check it landed.

## The outcome to sell

Know exactly who your best people are, who needs coaching, and who needs a
closer look, without spending a night in POS reports. Owners' real complaints:
not knowing who actually sells, favouritism in scheduling, one person's
giveaways and cancelled orders hiding in the totals, training that is guesswork,
and turnover of the good ones. This page is the reason a GM never opens the
POS employee report again (see the reliance rule in the brief).

## The matrix (POS data only)

Every figure comes from POS rows through a pure `lib/data/page/staff.js`, the
same in browser and server. Compare people only with others in the same job,
and adjust for when they worked (day, service and hour), because a lunch
server and a Saturday server are not comparable raw. Starting set, by job:

- **Selling (servers, bartenders):** sales per hour worked, guests per hour,
  check average, sales per guest, items per check, add-on rate (starters,
  desserts, drinks per guest), tip rate where the POS has tips, table time.
- **Giveaways and the register:** giveaways, discounts and cancelled orders
  per $100 sold, cancelled after the order went to the kitchen, refunds,
  reasons left blank. Use the same normal-range method as the Giveaways page
  (`controlLimits` in `model.js`), never a second one.
- **Time and reliability:** hours, shifts, late or early clock-ins against the
  schedule where the POS has it, overtime, breaks, shifts picked up or dropped.
- **Trend:** each measure over the last 13 weeks, so the page tells a slump or
  an improvement from a normal week.

Show each person as a percentile within their job (top, middle, bottom), with
the period and how many shifts it rests on. Hide a ranking that rests on too few
shifts and say why.

Today's reader keeps per-employee sales, voids, comps, discounts, hours and wage
(28 days) and weekly per-server exception rates (`lib/data/toast.js`, the
employees block and `voidWeeks`). Most of the matrix needs per-person rows
kept longer and by service. `toast.js` is shared: list the fields you need and
ask the coordinator, or compute from `pos_days` rows in
`lib/data/page/staff.js` without changing other pages' figures. Seed staff
(`seed.js` staff list) are the sample's; extend them with a new top-level
`staff` seed key, never by changing existing seed data.

## The AI read

The page's Sous specialist (a new entry in `lib/ai/agents.js`, for example
"Team Coach") reads the matrix and says, per person and for the team:

- What the numbers suggest: a strength to use, a skill to train (with the
  specific habit, for example "rarely offers dessert"), or a pattern worth a
  private conversation.
- **What we might be missing:** a strong seller whose giveaways are also high,
  a good number resting on easy shifts, a person nobody schedules on busy
  nights.
- **Where we might be over-correcting:** a low number explained by section,
  shift or a few shifts, a "problem" that is inside the normal range, or a
  fix aimed at one person that is really a team habit.

Actions go up to a draft or one tap: a training task for the GM through
`createTask`, a note for a one-on-one, a schedule suggestion for the Labor
page.

## Fair and careful with people

This page is about real employees, so it is stricter than the others:

- Only owners and GMs see names and rankings; other roles see their own card
  at most. Enforce it on the server, not only in the screen.
- The AI never says to fire someone. The strongest it goes is "needs a closer
  look" with the evidence, the period, the shifts behind it and what else could
  explain it. Decisions about discipline or firing belong to the manager, with
  their own records; say once, plainly, that this is coaching evidence, not an
  HR verdict, and that employment rules (for example California's) apply.
- Never rank on anything outside job performance in the POS (no age, gender,
  or anything inferred about the person).
- Every claim shows its period and sample size. Small samples are labelled
  "too early to tell", not ranked.

## Data and the manual path

- Toast (exports or the API sync) is the only source of the statistics.
- Without Toast, the page explains what it will show once the POS is connected
  or the exports are added, with a direct link to Connect and to the Toast
  export import; managers can add notes and training records by hand
  (`staff.*` action keys), labelled as hand-entered. Never type a statistic.

## Watch for

- Keep the totals here equal to the Labor and Giveaways pages for the same
  period; a test should check it.
- Memory to read: `labor-page.md`, `reliance-rule.md`,
  `eight-year-old-rule.md`, `lever-check.md`, `sous-ai.md`.
