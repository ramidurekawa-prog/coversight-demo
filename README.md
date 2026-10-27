# Coversight demo

The finished Coversight product, clickable, on a sample three-room restaurant
group. Every figure is computed from one set of sample data, labelled with how
strong the claim is, and clickable to see how it was calculated.

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
| Every day | Today, Service |
| Every week | This week (home), All rooms, Weekly meeting, The plan → Finding |
| Levers | Menu, Labour, Throughput, Purchasing |
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
6. **Build plan**: what has to exist behind each screen before it's real.

## Layout

```
app/                 routes (static export) + globals.css (design tokens + kit)
components/shell.jsx sidebar, top bar, drawers, toasts
components/screen.jsx page id → screen component
components/screens/  the screens and the sample data (core.jsx)
lib/pages.js         page registry, nav, roles, URLs
tests/               pinned figures, routing, icon coverage
```
