---
name: lever-inventory
description: Redesigns the Food used and Bar & drinks lever page (inventory.jsx) end to end, design and backend. Use when Ramidu asks to redesign or finish the Food used, Bar & drinks or Inventory page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Food used, and Bar & drinks** (page id `inventory`,
file `components/screens/pages/inventory.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## Two levers, one page

Lever Check has two cards that both open this page: **Food used** ("Kitchen
food used but not sold") and **Bar & drinks** ("Drinks poured but not sold"),
both in Food & drink costs. Give each its own clear half (for example a
Kitchen | Bar switch), each with its own headline that matches its card
(`CV_D.usage.kitchenWeek` and `CV_D.usage.barWeek`). If Ramidu wants a
separate Bar page, that needs `lib/pages.js` and `screen.jsx`, so ask the
coordinator.

## The lever

- Outcome to sell: you only pay for food and drink you actually sell. Owners'
  real complaints: waste, heavy portions, over-pouring, product that walks out
  the back, and counts that take hours.
- Plain words: "used but not sold", never "theoretical vs actual" or "usage
  variance" in the owner view.

## What exists today

- Reads `CV_D.usage` (rows, `flagged`, `week`, `kitchenWeek`, `barWeek`,
  `wasteWeek`), `CV_D.inputs.counts`, `CV_D.inputs.waste`, `CV_D.proofs`;
  `LoopStrip`, `Diagnose`.
- Tolerance is 3% for kitchen counts and 4% for the bar; inside it a count can't
  tell a real gap from counting error. Logged waste is explained loss and is
  shown apart, never counted as a gap.
- The salmon gap and the salmon plate-cost test share one lever key: whichever
  verifies first claims the dollars. Keep that rule.

## Data and the manual path

- Toast gives plates and drinks sold; it doesn't count stock.
- Counts and waste come from `/inputs` kinds `counts` and `waste` by hand. Make
  a spot count of the top few items fast enough to do on a phone in the walk-in.
  Inventory apps are placeholders that switch on with a connection.

## Watch for

- Sous specialist: **Stock Sleuth**.
- Memory to read: `inputs-page.md`, `eight-year-old-rule.md`,
  `lever-check.md`.
