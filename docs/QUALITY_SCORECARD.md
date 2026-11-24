# Coversight Quality Scorecard (Editorial Rubric)

This 100-point rubric provides a repeatable prioritization tool. Scores are **assessments**, not independently validated usability or performance benchmarks. Explain each score with concrete evidence (screenshots, tested workflows, code paths), and record any test gaps.

| Dimension | Max | Criteria |
|---|---:|---|
| Operator action clarity & time-to-decision | 20 | 3-second scan; one clear next action; minimal navigation |
| Functional correctness & reliability | 20 | Real controls work, state persists as designed, errors handled |
| Financial/data truthfulness & provenance | 15 | Correct numbers, proper forecast/actual labels, no fabricated verified savings |
| Hierarchy & visual communication | 15 | Clear signal/noise, readable density, accessible charts |
| Design-system consistency | 10 | Reused tokens, layout, typography, semantics |
| Accessibility | 10 | Keyboard, focus, contrast, labels, reduced motion |
| Responsive behavior | 10 | No overflow/clipping, useful laptop/tablet/mobile layouts |
| **Total** | **100** | |

## Release gates (cannot be traded off against a high score)

1. No known data corruption, unauthorized action, or misleading high-stakes financial recommendation.
2. Primary controls and input/save flows function in an actual browser, or are clearly flagged as blocked/unverified.
3. Existing tests and build checks pass, or regressions are reported and addressed.
4. Keyboard accessibility, focus management and mobile overflow are checked.
5. Source-provenance distinctions (demo/manual/connected, actual/forecast, estimated/verified) are preserved.

## Evidence rules

- Record baseline vs after numbers separately. Never set scores to 100 automatically.
- Do not present a score for an uninspected route as though tested; mark it unreviewed.
- Store screenshot paths and exact test commands, and describe what was manually observed.
