---
name: lever-channels
description: Redesigns the Delivery lever page (channels.jsx) end to end, design and backend. Use when Ramidu asks to redesign or finish the Delivery / Channels page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Delivery** (page id `channels`,
file `components/screens/pages/channels.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## The lever

- Lever Check card: **Delivery**, "What delivery apps leave you" (group Guests &
  sales). Headline and status match that card.
- Outcome to sell: know what each delivery order really leaves you, and keep
  more of it. Owners' real complaints: commissions of 15 to 30%, refunds and
  disputes they never see, packaging cost, delivery prices set by guesswork,
  and guests who could order direct.
- Roles: the owner wants cents kept per dollar by app; the GM wants the refund
  and missing-item problems to fix this week.

## What exists today

- Reads `CV_D.chan` (channels, `total`, per-100 figures) and checks channel
  sales against `CV_D.week.net`. Uses `LoopStrip`, `Diagnose` (areas.jsx) and
  `DenseChannels`.
- A 10% delivery markup test with takeout as control is the ready move.

## Data and the manual path

- Toast gives sales, orders and refunds by channel.
- Commission rates and packaging are standard assumptions until the
  restaurant enters its delivery statements (`/inputs` kind `channels`). Label
  every assumed rate as such, and show plainly when hand-entered channel totals
  don't match the register.
- DoorDash, Uber Eats and Grubhub statement feeds are placeholders that switch
  on with a connection.

## Watch for

- The money left after commission, refunds and packaging is the headline,
  not gross delivery sales.
- Sous specialist: **Delivery Desk**.
- Memory to read: `eight-year-old-rule.md`, `lever-check.md`,
  `integrations-rule.md`.
