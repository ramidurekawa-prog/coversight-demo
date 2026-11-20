---
name: lever-controls
description: Redesigns the Giveaways lever page (controls.jsx: comps, voids, discounts) end to end, design and backend. Use when Ramidu asks to redesign or finish the Giveaways / Controls page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Giveaways** (page id `controls`,
file `components/screens/pages/controls.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## The lever

- Lever Check card: **Giveaways**, "Free food, discounts and cancelled orders"
  (group Your team & the shift). Headline and status match that card. Say
  "giveaways", "cancelled orders" and "discounts", never "comps", "voids" or
  "exceptions" in the owner view.
- Outcome to sell: free food goes where you meant it to, and the register
  tells you when a pattern needs a quiet word. Owners' real complaints:
  comps creeping up, voids after the food went out, discounts without a reason,
  and the fear of theft they can't prove.
- Roles: only owners and GMs see names. Frame a person's pattern as worth a
  conversation, never as proof of wrongdoing.

## What exists today

- Reads `EXCEPTION_TYPES` and `controlLimits` from `model.js`,
  `weeklySeries` from `readers.js`, `CV_D.room.levers.voidWeeks`,
  `CV_D.hist.rows`, `CV_D.staff`, `CV_D.allProof`; `ControlChart`, `LoopStrip`,
  `Diagnose`, `DenseControls`; engine state through `useEngine`.
- The limits are statistical (a normal range per week). Explain them as "more
  than a normal week", with the method behind a click.

## Data and the manual path

- Toast gives every comp, void and discount with the person and reason.
- Without Toast, a manager can enter the week's giveaway total by type by hand
  (`controls.*` key), labelled as hand-entered.

## Watch for

- Sous specialist: **Register Guard**.
- Memory to read: `eight-year-old-rule.md`, `lever-check.md`,
  `today-design-decisions.md`.
