---
name: lever-kitchen
description: Redesigns the Kitchen speed lever page (kitchen.jsx) end to end, design and backend. Use when Ramidu asks to redesign or finish the Kitchen speed / Kitchen page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Kitchen speed** (page id `kitchen`,
file `components/screens/pages/kitchen.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## The lever

- Lever Check card: **Kitchen speed**, "How fast food gets to guests" (group
  Your team & the shift). Headline and status match that card. This lever
  claims $0, so it is never red: show speed and its effect on guests, not a
  made-up dollar figure.
- Outcome to sell: food out on time on the busiest hour, and the station that
  holds tickets up found before Friday. Owners' and chefs' real complaints:
  slow tickets at the rush, one station backing up the rest, remakes, and not
  knowing if it's the people or the station.
- Roles: the chef wants the station and the hour; the owner wants whether it
  costs guests or tables.

## What exists today

- Reads `CV_D.room.tickets` and `CV_D.feeds` (the kitchen display feed);
  `TicketChart`, `LoopStrip`, `Diagnose`, `DenseKitchen`; saved state via
  `useSaved`.
- PR 66 added a "Kitchen: is the line keeping up?" card on Labor, with cooks on
  the line entered by hand (`labour.crew`). Link to it or share its reading;
  don't build a second, different count.

## Data and the manual path

- Toast kitchen display ticket times when connected; a placeholder for other
  kitchen screens.
- Without a feed, a chef can log a few ticket times or "late tickets tonight"
  by hand (`kitchen.*` key), labelled as hand-entered.

## Watch for

- Sous specialist: **Line Coach**.
- Memory to read: `labor-page.md`, `service-page.md`,
  `eight-year-old-rule.md`, `lever-check.md`.
