---
name: lever-menu
description: Redesigns the Menu prices lever page (menu.jsx) end to end, design and backend. Use when Ramidu asks to redesign or finish the Menu prices / Menu page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Menu prices** (page id `menu`,
file `components/screens/pages/menu.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## The lever

- Lever Check card: **Menu prices**, "What you charge for each dish" (group Food
  & drink costs). Headline and status match that card.
- Outcome to sell: each plate earns what it should, and a price change is made
  with confidence instead of fear. Owners' real complaints: not knowing what a
  dish really costs, being scared a price rise will drive guests away, food
  costs rising faster than menu prices, and dishes that sell well but earn
  little.
- Plain words: "earns per plate", "sells a lot / sells a little", not menu-
  engineering jargon (no "plowhorse", "contribution margin" in the owner view).

## What exists today

- Reads `CV_MENU`, `CV_CM_WEIGHTED`, `cvPriceMove` and
  `cvPriceMoveInterval` (with `Interval`) from `core.jsx`, and
  `CV_D.hist.rows`; `MenuScatter`, `DenseMenu`.
- Price moves are tested before anything is booked; the range shown is the
  model's, and a range that can lose money is called "uncertain".

## Data and the manual path

- Toast gives dishes, prices and plates sold.
- Recipes and plate costs come from `/inputs` kind `recipes` by hand (or a
  costing tool placeholder). Without recipes, say what the page can't know yet.
- Supplier price rises flow in from the Supplier prices page; link the two
  through the same ingredient, never recompute it here.

## Watch for

- Sous specialist: **Menu Maker**.
- Memory to read: `eight-year-old-rule.md`, `lever-check.md`,
  `today-design-decisions.md`.
