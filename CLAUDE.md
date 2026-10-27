# coversight-demo

A clickable demo of the finished Coversight product on a sample restaurant
group (Rosewood: Oakland, Berkeley, Walnut Creek). Static Next.js export, no
backend, no login. It is a sales and investor tool, separate from the platform
monorepo (`ramidurekawa-prog/streamlinekitchenco-platform-monorepo`); nothing
here ships to customers.

## Rules

- **Numbers are computed, never typed.** Headline figures derive from the data
  in `components/screens/core.jsx`. `tests/figures.test.js` pins them; if you
  change data and a pinned figure moves, update every screen that quotes it
  and the test together, deliberately.
- **Every dollar carries a claim strength** (Estimated, Modelled, Causal,
  Bookable, Observed) with its icon, never colour alone.
- **Design system:** tokens and kit classes in `app/globals.css` come from the
  monorepo's design system. Use existing classes before adding new ones.
- **Pages:** add a screen in `lib/pages.js` (title, icon, nav group) and map
  it in `components/screen.jsx`; `tests/routes.test.js` enforces both. Id
  screens (`/packet/:id`, `/finding/:id`) list their ids in `lib/pages.js`.
- **Icons:** lucide-react, imported by name in `components/kit.jsx`. A new icon
  must be added there (`tests/icons.test.js` catches misses).
- **Dependencies:** latest stable behind pnpm's 14-day release-age gate, same
  as the monorepo's ADR-0010. Exceptions go in `minimumReleaseAgeExclude`
  with a reason.
- **Branching:** never iterate on `main`; work on a branch and open a PR. Agent
  PRs open with `## Quick Understanding` (plain language) and end with
  `## Unattended-run uncertainties`. Never merge your own PR.

`pnpm check` = typecheck + tests + build. Run it before pushing.
