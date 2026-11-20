---
name: lever-throughput
description: Redesigns the Tables lever page (throughput.jsx) end to end, design and backend. Use when Ramidu asks to redesign or finish the Tables / Throughput page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Tables** (page id `throughput`,
file `components/screens/pages/throughput.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## The lever

- Lever Check card: **Tables**, "Whether you run out of seats" (group Guests &
  sales). The page headline and status must match that card.
- Outcome to sell: every seat earns on the busy nights, and nobody waits by the
  door while a table sits finished. Owners' real complaints: turning walk-ins
  away on Friday and Saturday, long waits, slow turns, and an empty room on
  Tuesday that costs the same rent.
- Roles: the owner wants covers lost and won in dollars; the GM wants which
  hours and which tables to fix tonight; the host wants a simple pace to seat to.

## What exists today

- Reads `CV_D.room.throughput`, `CV_D.room.levers` and `measuredFillPct` from
  `lib/data/levers.js`; `DenseThroughput` from `dense-sections.jsx`.
- Covercast (`lib/data/forecast/`, `GET /api/forecast?room=`) is the only
  source for busy-hour forecasts. Never use a page-made average.
- The Service page (PR 61 and follow-ups) owns tonight's floor. Link to it for
  tonight; this page owns the pattern across weeks.

## Data and the manual path

- Toast gives covers, checks and table times when connected.
- A reservations or waitlist feed is a placeholder in
  `server/forecast-feeds.ts`; switch it on with a key, never block on it.
- Without feeds, let a manager enter covers turned away or the wait by hand
  (a `throughput.*` action key), labelled as hand-entered.

## Watch for

- Seats lost only matter on hours when the room is truly full. Say so plainly,
  and don't count a faster turn as money when the room isn't full.
- Sous specialist: **Seat Finder**.
- Memory to read: `service-page.md`, `covercast-forecast.md`,
  `eight-year-old-rule.md`, `lever-check.md`.
