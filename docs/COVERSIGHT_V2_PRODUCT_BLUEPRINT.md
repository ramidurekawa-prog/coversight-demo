# Coversight 2.0 — Product blueprint and acceptance criteria

Status: **proposed demo-product architecture** (not a claim that every feature is shipped). Owner: Coversight product/engineering. Created: 2026-10-29. Transferred from the production-repository proposal into the Coversight demo repo.

## The company we are building

An operational **profit improvement system** for independent full-service restaurants and 2–10-location groups. Coversight ingests properly authorized operational records, detects anomalies, explains evidence and alternative causes, proposes affordable actions to the people who can execute them, follows up, and **measures outcomes without counting estimates as verified savings**.

**North-star metric:** credible, incremental net operating improvement retained by customers over time, alongside active customer retention and software gross margin. Avoid optimizing raw numbers of alerts, insights, dashboards, agents, or estimated "found" dollars.

**Product law:** no extrapolated opportunity, proposed action, confidence score, or model output is represented as booked/verified savings. Only the existing verification engine's recorded gate outcomes may mint verified amounts, and reversals must propagate to the ledger and billing. Do not automatically change schedules, prices, purchasing, staffing, or employee permissions in v1.

## What exists, and what does not

- **Demo repo:** \`ramidurekawa-prog/coversight-demo\`. Static Next.js export with a deterministic three-location Rosewood group, computed reports and a broad ideal-state UX. Browser-only inputs. **No backend, login, or live restaurant data.** Preserve its narratives, design language, and most product interactions as a design reference.
- **Separate production repo (reference only; not modified by this demo PR):** Fastify API, typed Zod contracts, Postgres/Drizzle tenant repositories, Rosewood fixtures, Toast Simulator, engine metrics and seven detector types (\`labor_overstaff\`, \`overtime\`, \`menu_margin\`, \`mix_shift\`, \`table_turns\`, \`ticket_time\`, \`void_comp\`), confidence-tier ranking, manager approvals/action lifecycle, verification gates, test infrastructure, and UI surfaces.
- The existence of code/tests **does not prove** that real POS data, live restaurant outcomes, pricing or competitive advantage have been validated. \`docs/V1_BUILD_PLAN.md\` describes what remains on the path to a paid Profit Pilot. Current unclosed decisions/issues must be rechecked before implementing a feature.
- The separate production engine ranks findings by impact, confidence, freshness and actionability. This demo repo now has an optional pure TypeScript planning engine in `lib/planning/weekly-plan.ts` with tests in `tests/weekly-plan.test.ts`. It is **not connected to the demo's on-screen planning figures** and must not replace the existing `lib/data/model.js` calculations or pinned tests without an explicit design and test pass.
- \`Toast Simulator\` is a test substitute, not Toast authorization. Provider terms, permissions and merchant agreement must be reviewed before live ingestion. Cross-customer comparisons, model training on merchant data and provider-specific writeback require separately verified rights.

## Proposed UX: one system, three perspectives

### GM / shift leader: "Tell me what matters *today*"

Home: (1) operational status and source freshness, (2) no more than three priority actions, (3) explicit owner, effort and next step, (4) "why this?" with source records, (5) approve/reject/defer/block, (6) what changed afterward. Service pressure is a **forecast with intervals** and service guardrails, not a staffing instruction. Mobile-friendly. One action can be understood in under 60 seconds.

### Owner / regional operator: "Where is my profit leaking, and what actually improved?"

Home: location comparisons using consistent definitions, operating margin bridge, opportunity portfolio (**estimates separate from realized**), weekly plan within manager-hour budget, change history, verified savings vs software fees, source-health caveats, and small-group rollups. Never sum potentially overlapping opportunity estimates into an advertised total.

### Accountant / controller: "Can I reproduce the numbers?"

Reconcile source transactions and payroll expenses, show ledger revisions and methodology, separate attribution from ordinary volume/price changes, inspect verification packets, export accountant-reviewed reports. Missing GL/accounting feeds → clearly label "operational estimate" not P&L profit.

## Universal recommendation contract (every feature uses this)

Each finding must expose: stable ID, org/location, detector and version, analysis period and timezone, source record references, formula/metric definition, coverage and freshness, observed baseline, comparator, confidence and limitations, competing causes, **conservative economic range** (including costs), non-additivity/overlap group, guardrail status, recommended human action, required approval, owner, expected manager minutes, reversibility, verification design, lifecycle timeline, and result state.

**Recommendation levels:** \`blocked\` (unsafe or invalid inputs), \`investigate\` (plausible but insufficient evidence), \`ready_for_review\` (adequate quantified evidence; still needs human approval to execute). Never imply \`ready_for_review\` means safe to execute automatically. Keep estimates and verified claims in separate types/fields.

**Abstention is a feature.** If cost data is absent, schedule a cost-data task; if labor coverage is insufficient, ask the operator to validate minimum staffing; if comparison peers are poor, suppress benchmark ranking.

**Every significant feature passes five test classes:** normal case, missing/stale/conflicting feeds, opposite-direction finding (e.g. understaffing), multi-location/role isolation, and mathematical regression against source totals.

## Module specifications — build the best coherent version, not the longest list

| Module | Competitor capabilities to learn from (not unique claims) | Coversight 2.0 target | Required evidence and hard acceptance test | Priority |
|---|---|---|---|---|
| **1. Today / manager command center** | Toast IQ/agents, Fourth iQ, Tenzo | Top three actionable opportunities, reason codes, manager-time budget, one tap to acknowledge/approve/defer, service guardrails | No stale, blocked or insufficient-evidence action shown as executable; priority explanation matches engine; mobile accessible | P0 |
| **2. Data connections and trust** | Tenzo/Avero cross-POS feeds, Toast reporting | Permissioned adapter layer + CSV fallback; source fingerprint, reconciliation, freshness and coverage per feature; provider-neutral canonical schema | Imports idempotent; duplicate/reversal handling; 100% rejected-row reporting; tenant isolation; real authorization before production | P0 |
| **3. Opportunity / diagnostic engine** | Avero loss controls, Restoke AI, Toast | Explainable detectors, baselines, confidence, estimated range, competing causes, linked source records | False positives inspected; negative/zero values and segment definitions tested; detector version recorded | P0 |
| **4. Weekly Plan / manager attention** | Fourth real-time action, Tenzo priorities | Manager-hour-constrained, conservative net-benefit plan; do not double-count overlapping levers; non-actionable investigations separate | No more than available manager minutes; negative net opportunities never selected; failed guardrails blocked; deterministic | P0 |
| **5. Actions and execution** | Fourth, Restoke, Momos' emerging actions | Approved playbooks, owner, due date, dependency/blocker, required confirmations, manual-first execution, exceptions and audit | Role-specific approval enforced server-side; impossible state transitions rejected; no unauthorized writeback | P0 |
| **6. Proof / experiments** | Black Box insight-to-action framing, Momos, Fourth | Predeclared baseline, comparison/matched periods, confounders, guardrails, full verification packet, reversals | Existing four-gate engine only source for verified savings; unimplemented statistical assumptions clearly labeled; accountant reproduction | P0 |
| **7. Savings ledger and billing** | Avero reporting, Toast financial reports | Separate projected, in-test, verified, reversed; reconcile subscriptions; no fee based on unverified dollars | No estimated-to-verified leakage; reversals restate results; arithmetic tests against raw records | P0 |
| **8. Labor optimization** | Fourth, Toast Scheduling Agent, TouchBistro | Hourly demand vs planned/actual staffing, wage costs, overtime, skill coverage, min coverage, service risk, alternatives | Never reduce staff based on fixed covers/server-hour; actual demand capacity by role and concept required; wage/meal/rest compliance review | P1 |
| **9. Discounts / voids / comps** | Avero, Toast, Katalyst | Segment and employee-role baselines, reason codes, anomaly clusters; investigate instead of accusation | Avoid duplicate reduction in sales and exposure; legitimate hospitality excluded; no misconduct inference from unusual rates | P1 |
| **10. Menu contribution / mix** | Apicbase, Restoke, Toast benchmarks, Oracle | Recipe and modifier cost provenance, realized price, popularity, true contribution, staged menu changes | Missing or stale ingredient cost suppresses profit claim; recipe version and discount treatment defined | P1 |
| **11. Procurement / invoices** | Apicbase, Restoke, Fourth | Unit-normalized vendor prices, substitutions, purchasing variance and delivery exceptions | UOM conversion verified; no suggestion that breaks product quality/contract constraints | P2 |
| **12. Inventory / waste** | Apicbase, Restoke, Fourth | Theoretical vs actual usage, item-level shrink, spoilage, prep yield, reorder suggestions | Recipe and count coverage gates; invoices + POS + counts reconcile within stated tolerance | P2 |
| **13. Kitchen and throughput** | Plainsight video+KDS, Oracle/KDS, Avero table turns | Ticket stage time, bottlenecks, queue simulations, seating/turn decomposition | Instrumented timestamps and actual table occupancy needed; do not infer physical behavior from POS alone | P2 |
| **14. Delivery economics** | Toast channel reporting, TouchBistro | Margin by channel after commissions, discounts, packaging and processing fees | Reconciled channel settlement; clear definition of contribution, not gross sales | P2 |
| **15. Guest voice and recovery** | Momos, TruRating, Slang AI | Consent-aware feedback, review themes, recovery tasks, channel/shift root-cause links | Guest consent and quality controls; avoid exposing individual staff or private guest data beyond permissions | P2 |
| **16. Weather / events / forecasting** | Tenzo forecasting, Fourth demand planning | Hierarchical daypart forecasts with prediction intervals, rolling backtests, known event/weather features | Compare against simple seasonal baseline; abstain if model isn't demonstrably better | P2 |
| **17. Multi-location portfolio** | Black Box network, Tenzo, Oracle | Group hierarchy, common metric dictionary, peer/seasonality-adjusted comparisons, playbook rollouts | No cross-tenant access; unequal source coverage labeled; compare like-for-like | P2 |
| **18. Benchmarking** | Black Box Intelligence, Toast Benchmarking, RestaurantData.com | Permissioned cohorts, minimum k-anonymity/thresholds, normalization by concept/scale/region and data vintage | Legal data rights first; no single-store reidentification; never present unsupported ranks | P3 |
| **19. Ask Coversight** | Toast IQ, Tenzo, Restoke | Grounded question answering over permitted metric APIs, with numbers, formulas, cited source periods and abstention | No SQL on unauthorized tenant data; no invented financial figures or unapproved actions | P3 |
| **20. Integrations and ecosystem** | Oracle, TouchBistro, Toast, Slang, Tenzo | Stable partner adapters and approved writebacks, explicit user permissions and revocation controls | Contract and license review, audit, idempotency, rollback path, customer authorization | staged |

### Other competitor-specific lessons

- **Plainsight:** physical-observation data can corroborate POS but cameras add cost, privacy and installation burden. Defer.
- **TruRating:** short, context-linked guest feedback is more actionable than unstructured online review sentiment alone.
- **Slang AI:** phone and reservation automation is a viable adjacent business, **not** a near-term Coversight feature.
- **RestaurantData.com and Bloomberry/Dashmote:** useful for prospect discovery and integration prioritization; detection datasets must not be described as verified installed-POS market share.
- **Katalyst:** POS providers are adding AI KPIs rapidly; don't sell generic KPIs as differentiation.
- **Oracle/TouchBistro:** connectors and business rules must handle enterprise configuration differences.

## Feature slices and workflow contracts

### Today card

- Title describes a **decision**, not an unexplained alert.
- Evidence: observed current figure, comparable baseline, time range, source quality, likely drivers, alternative explanations.
- Economics: conservative range and implementation cost, with capital/weekly benefit explicitly marked *estimated*.
- Action: owner, instructions, expected manager effort, risk, deadline, approval, monitoring plan.
- Status: \`ready_for_review\` / \`investigate\` / \`blocked\`; "not enough data" is useful.
- Proof: direct link to action timeline and, when window closes, verification packet.

### Labor

1. Normalize sales by daypart, location timezone and job code; reconcile clocked wages and scheduled wages.
2. Derive actual observed productivity distribution and coverage, then forecast demand with interval.
3. Evaluate candidate schedule changes against peak-demand, skills, minimum roles, law, breaks, service quality and overtime.
4. Propose **options** with risks rather than automatically sending anyone home.
5. Run a time-bounded manager-approved test; evaluate actual net benefit and service counter-metrics.

### Menu

1. Resolve POS item/modifier aliases to versioned recipe costs.
2. Separate listed price from effective realized price and discounts.
3. Calculate item contribution with packaging/fees when relevant; carry "cost unknown" for incomplete recipes.
4. Evaluate change alternatives (portion, vendor, placement, pricing) and model demand uncertainty.
5. Require manager confirmation, test and reversible rollback. Never claim price elasticity without experimental/credible historical support.

### Evidence and verification

- Define baseline **before** initiating the change; avoid comparison-window contamination.
- Record timestamped policy, intervention, store, owner, and confounders.
- Complete the preexisting four gates and source-tier rules; monitor counter-metrics after closing.
- Store immutable verification snapshots with model/version and source lineage.
- Calculate gross and net outcomes, distinguish **incremental realized improvement** from potentially overlapping estimates.
- Surface failures, rejections and reversals clearly; never hide poor outcomes to improve marketing/billing.

### Onboarding

- Wizard for organization/location/timezone/roles/consent.
- Import 8–12 weeks of authorized records if available.
- Mapping validation with preview, rejects and totals reconciliation.
- Data-quality report with unlockable diagnostics as coverage improves.
- Initial useful result from limited data; clearly label which advanced features require additional feeds.

## Suggested first paid pilot scope (do not build 20 modules first)

1. Real-data upload/ingestion with secure tenant scope and reproducible source totals.
2. Labor-versus-demand or void/comp diagnostic chosen from customer evidence.
3. Decision card / Weekly Plan with manager-time, risk and overlap gates.
4. Approval → manager execution (manual) → monitoring → four-gate verdict.
5. Owner proof report / accounting-friendly savings ledger, with clear claims.
6. Repeated outcomes measured against a restaurant's existing reporting tools.

**Do not ship cross-customer benchmarks, autonomous staff changes, payment/telephone workflows, camera surveillance or all-area AI claims in the initial pilot.**

## Commercial and risk assumptions

- Initial test price: $1,000 paid Profit Pilot; subsequent subscription price to be validated by interviews and actual renewals. Keep onboarding/consulting hours costed separately.
- Test with at least 3 design partners and at least 2 paid continuing restaurants before expanding feature scope.
- Compare against **the software the restaurant already uses** on time-to-decision, action completion, accuracy, net benefit and manager minutes. Claims of superiority require measured advantage.
- Safeguards: role-based permissions; human approval; data minimization; retention and deletion; tenant isolation; consent; provider access rights; incident response; complete audit; revocation.
- Known threats: provider API restrictions, incomplete data, labor-law risk, false-positive recommendations, unattributable savings, costly support, operator churn and low pricing power. Any critical unfixed risk blocks customer launch.

## Release gates

**P0 Product truth / 0–3 pilot locations**
- Source-to-report reconciliation and tenant-access tests pass.
- No verified dollar minted except through verification engine; negative/overlapping estimates stay separate.
- One workflow completed with genuine customer data and human-approved action.
- Repeatable onboarding, rollback and support runbook.

**P1 Repeatability / 3–25 locations**
- Two diagnostics tested in real conditions; false alerts and implementation effort measured.
- Users identify a valuable decision without analyst explanation.
- Evidence of actual paid renewals; delivery costs and human hours tracked.

**P2 Scale / 25–250 locations**
- Expand only the integrations and modules demanded by retaining customers.
- Automated monitoring and repeatable account support; measured unit economics.
- Owner and GM cross-location views with adequate metric comparability.

**P3 Network / 250+ locations, conditional**
- Legal right to aggregate; suitable sample/cohort quality; externally reviewed security posture.
- Benchmarks and intervention learning prove incremental customer value.
- Agentic actions only within explicit scoped permissions, reversible controls and auditability.

## Engineering implementation order and non-goals

1. Preserve `lib/data/seed.js`, `lib/data/model.js`, `components/engine.js`, and all golden/demo calculations. The **decision-planning module is an independently tested pure module** (`lib/planning/weekly-plan.ts`), not a replacement for the demo's existing visuals, financial math, or verification claims.
2. Design future demo data-model fields for source lineage, coverage, abstention reasons, incremental cost assumptions and action readiness, but do not display them as live customer data.
3. Show desired import/validation, data-quality and evidence states only as clearly labelled sample workflows here; real secure ingestion and tenant isolation require the separate production platform.
4. An eventual demo UI integration can connect Today → Finding → Plan → Action → Proof → Ledger **only through the common Rosewood seed/model** and with golden tests updated deliberately.
5. Track time to insight, suggestion accept rate, completion, reversals, net benefit, support minutes, onboarding and retention only when real authorized pilot data is available; demo examples are illustrative.
6. Defer real AI agents, cross-customer data use and writeback until deterministic source-backed reporting, authorization and reconciliation are proven.

**Not in scope for this demo repository:** live backend or integrations, guaranteed savings claims; guaranteed competitive superiority; copying competitor IP; deploying to customer environments; changing live schedules, wages, menus or procurement; obtaining unapproved provider data; automatically starting a paid contract.

## Links reviewed

- Existing product: https://coversight-demo.vercel.app/today/ and https://github.com/ramidurekawa-prog/coversight-demo
- Current platform: https://github.com/ramidurekawa-prog/streamlinekitchenco-platform-monorepo
- Toast: https://pos.toasttab.com/ and https://support.toasttab.com/en/article/Toast-Benchmarking-Overview
- Tenzo: https://www.gotenzo.com/
- Avero: https://averoinc.com/
- Fourth: https://www.fourth.com/solution/ai
- Restoke: https://www.restoke.ai/features/restaurant-intelligence
- Black Box Intelligence: https://blackboxintelligence.com/
- Plainsight: https://plainsight.ai/restaurant
- Apicbase: https://get.apicbase.com/
- Momos: https://www.momos.com/
- TruRating: https://trurating.com/restaurant-intelligence/
- Slang AI: https://www.slang.ai/restaurants
- TouchBistro: https://www.touchbistro.com/
- Oracle: https://www.oracle.com/food-beverage/
- Katalyst: https://www.katalystos.com/blog/restaurant-intelligence-the-gateway-to-restaurant-analytics
- RestaurantData.com: https://restaurantdata.com/

**Scope caveat:** competitor categories and publicly advertised capabilities are market inputs, not a verified claim that a vendor does or does not possess any particular depth of functionality. Actual competitive superiority must be established through live customer comparisons.
