---
name: lever-labour
description: Redesigns the Staff lever page (labour.jsx) end to end, design and backend, building on the Labor redesign in PR 66. Use when Ramidu asks to redesign or finish the Staff / Labor page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Staff** (page id `labour`,
file `components/screens/pages/labour.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## Start from PR 66, not from main

The Labor page was already rebuilt from Ramidu's own concept in PR 66 (branch
`claude/project-thread-ow383s`, thread "Redesign the Labor page"), through a
14-point review and a depth round. If PR 66 is still open, work from its
branch and keep the decisions Ramidu approved there; if it merged, start from
main. Read `labor-page.md` in project memory before anything else. A full
redesign here means bringing that page to the Lever Check bar (two minutes, 8-
year-old clear, little scrolling), not throwing away what Ramidu approved.

## The lever

- Lever Check card: **Staff**, "What you pay your team" (group Your team & the
  shift). Headline and status match that card.
- Outcome to sell: the right people on every hour, no surprise overtime, and
  wage rules kept. Owners' real complaints: overtime nobody saw coming,
  overstaffed slow nights and short busy ones, California and city wage rules,
  and turnover.
- Roles: owner, GM and ops views already exist on PR 66; keep them.

## Data and the manual path

- Toast time entries and 7shifts (placeholder connection on the Connect page)
  give hours and schedules; hand entry covers the rest (`labour.crew` and other
  `labour.*` keys).
- Forecast need comes from Covercast only, and tonight's plan from Service.

## Known gaps to close or report

From `labor-page.md`: two server-pace worlds in the sample seed, hourly
staffing by role for Toast rooms, wages without payroll burden, and
hand-entered days that don't feed the model. The shared parts go to the
coordinator; don't edit `model.js` or `apply.js` in the page PR.

- Sous specialist: **Roster Coach** (the deepest line checks today).
- Memory to read: `labor-page.md`, `covercast-forecast.md`, `service-page.md`,
  `eight-year-old-rule.md`, `lever-check.md`.
