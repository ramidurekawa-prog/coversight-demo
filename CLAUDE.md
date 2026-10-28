# coversight-demo

A clickable demo of the finished Coversight product on a sample restaurant
group (Rosewood: Oakland, Berkeley, Walnut Creek). Static Next.js export, no
backend, no login. It is a sales and investor tool, separate from the platform
monorepo (`ramidurekawa-prog/streamlinekitchenco-platform-monorepo`); nothing
here ships to customers.

## Rules

- **Numbers are computed, never typed.** All data lives in `lib/data/seed.js`;
  every figure comes from `lib/data/model.js`; screens read the current room
  via `CV_D` from `components/screens/core.jsx`. `tests/figures.test.js` and
  `tests/data.test.js` pin the headline figures and check every room's totals
  close. If a pinned figure moves, change it deliberately.
- **Verified rates are frozen.** Inputs (`lib/data/apply.js`) may move
  estimates, observed figures and detectors, never a packet's bookable rate.
- **Room content** (queues, meetings, narrative) is per room in the seed and
  uses `{tokens}` filled by the model; `tests/data.test.js` fails on any
  unresolved token.
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
