# Coversight demo

The finished Coversight product, clickable, on a sample three-room restaurant
group. Every figure is computed from one set of sample data, labelled with how
strong the claim is, and clickable to see how it was calculated.

- **Three full rooms** (Oakland, Berkeley, Walnut Creek): ~40 dishes, 23–35
  staff, 28–30 invoice lines from 8 vendors, 52 weeks of history, 16
  verification packets and 30 plan candidates. Switch rooms in the top bar.
- **Data inputs**: type in or upload recipe costs, invoices, inventory counts,
  a waste log, channel sales and register exceptions. Every row is validated,
  the screen previews exactly which figures move, and commits can be undone.
  Verified figures never move.

No backend, no login, no real customer data. It is a static site.

## Run it

```bash
corepack enable
pnpm install
pnpm dev            # http://localhost:3000
```

```bash
pnpm check          # typecheck + tests + static build to out/
pnpm start          # serve out/ locally
```

## Deploy

`pnpm build` writes a plain static site to `out/`. Any static host serves it:

- **Vercel / Netlify:** import the repo; defaults work (build `pnpm build`,
  output `out`).
- **Render:** `render.yaml` is included (Blueprint → static site).

## What's in it

| Area | Screens |
|---|---|
| Every day | Today, Service, Data inputs |
| Every week | This week (home), Trends (52 weeks), All rooms, Weekly meeting, The plan → Finding |
| Levers | Coverage map (all 12 operating areas), Labour, Menu, Purchasing, Inventory & waste, Kitchen, Throughput, Controls, Delivery & channels |
| Proof | Proof → Verification packet, Savings ledger, Accountant, Billing |
| Setup | First six weeks, Comparison, Sources, Fences & alerts, System |
| Build plan | `/build`: the platform gaps behind each screen, graded, in build order |

Top bar: the room switcher (Oakland, or all rooms), Owner / GM / Accountant
views, the claim-strength legend, Ask, and a link from each screen to the
gaps behind it.

## Demo walkthrough (5 minutes)

1. **This week** (`/`): $97 banked, the lower bound of a measured interval.
   Click **$97** to see the formula, inputs and sources.
2. **Open the plan** → **Raise the ribeye**: approve a price change and watch
   it write back.
3. **Proof** → the Thursday prep packet: the matched control weeks behind a
   verified result.
4. **All rooms** (room switcher): Walnut Creek's September, reconciled to
   the ledger.
5. **Billing**: the fee is a share of what's bookable, never what's estimated.
6. **Coverage map**: twelve operating areas on one closed loop (detect →
   understand → act → verify), each with the one figure the data supports.
   The column is deliberately not summed.
7. **Controls**: one server above her own control limit; the room inside its.
8. **Build plan**: what has to exist behind each screen before it's real.

## How the data works

```
lib/data/seed.js    the sample group: deterministic, Oakland's original figures as anchors
lib/data/model.js   pure functions: room data → every figure on every screen
lib/data/apply.js   hand-entered inputs → a new dataset (never mutates the seed)
lib/data/ingest.js  CSV parsing, column mapping, validation, templates, preview
components/engine.js current room + inputs + audit log; re-derives on change
```

Each room's week closes from its rows: menu sales (Σ price × plates) minus
comps and discounts is net sales; Σ plate cost × plates is food cost; Σ hours
× rate is labour; earned is what's left. A balancing "sides and add-ons" line
per room closes the menu to the week. Inputs are saved in the viewer's browser
only, so the demo always starts clean for someone new.

## Layout

```
app/                 routes (static export) + globals.css (design tokens + kit)
components/shell.jsx sidebar, top bar, drawers, toasts
components/screen.jsx page id → screen component
components/screens/  the screens and the sample data (core.jsx; areas.jsx = V3 operating areas)
lib/pages.js         page registry, nav, roles, URLs
tests/               pinned figures, dataset closure, ingestion, routing, icons
```
