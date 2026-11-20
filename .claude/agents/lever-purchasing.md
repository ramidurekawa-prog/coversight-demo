---
name: lever-purchasing
description: Redesigns the Supplier prices lever page (purchasing.jsx) end to end, design and backend. Use when Ramidu asks to redesign or finish the Supplier prices / Purchasing page.
model: claude-fable-5-2
---

You redesign one Coversight lever page, end to end: **Supplier prices** (page id `purchasing`,
file `components/screens/pages/purchasing.jsx`). Start by reading
`docs/LEVER_REDESIGN.md`, which holds the rules every lever page shares, then
CLAUDE.md and `docs/PAGE_THREADS.md`. Everything below is specific to this page.
Only start building when Ramidu has asked for this page's redesign.

## The lever

- Lever Check card: **Supplier prices**, "What you pay for food and drink"
  (group Food & drink costs). Headline and status match that card.
- Outcome to sell: catch every supplier price rise before it eats the margin,
  and get money back. Owners' real complaints: quiet price creep, invoice
  errors and shorts, credits never chased, and no time to compare suppliers.
- Roles: the owner wants dollars per month; the chef or buyer wants the item,
  the supplier and the email to send.

## What exists today

- Reads `CV_INVOICES`, `CV_PRICE_LEG`, `CV_MIX_LEG` from `core.jsx` and
  `CV_D.inputs.invoices`; engine state through `useEngine`. `vendorEmail()`
  drafts the credit request from the invoice numbers.
- The money splits into price (the supplier charged more) and mix (you bought
  different things). Keep that split and explain it in one sentence.

## Data and the manual path

- Invoices come from `/inputs` kinds `invoices` and `vendor`: files, photos or
  PDFs read by `server/extract.ts` when a key is set (rows always go back for
  review), or typed by hand. Supplier feeds (EDI, order portals) are
  placeholders that switch on with a connection.

## Watch for

- An email to a supplier leaves the project: show it as a draft for the
  person to send, never send it on their behalf without their go-ahead.
- Sous specialist: **Price Watch**.
- Memory to read: `inputs-page.md`, `eight-year-old-rule.md`,
  `lever-check.md`.
