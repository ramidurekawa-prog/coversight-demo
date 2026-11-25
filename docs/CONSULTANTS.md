# Consultant agents that learn

Every lever has a consultant agent (Roster Coach for labor, Price Watch for
supplier prices, and so on). The goal is consultants that get better with every
result until they beat a human consultant. They are allowed to say so only when
real results show it. This file is the contract for how they learn. The master
spec sections it follows are System 14 (confidence), 15 (agent authority),
16 (the outcome record and ranking) and 17 (the benchmark network) in
`/mnt/project-files/reference/SKC-full-layout.html`.

## How a consultant learns

Learning is memory that is read every time. The model is never retrained.

| What | Where | Learned from |
| --- | --- | --- |
| **The call log**: every move the consultant put forward, once, with what it estimated then | `sous.calls` (room key), `recordCalls()` | the moves Sous shows; logged by the Consultants page and the nightly `sous` job |
| **The casebook**: every call that went to a test, as an outcome record | `casesFrom()` | a real group's `test_windows`; the sample's proof history |
| **The record**: clear reads, held up, broke a guardrail, too small to tell, open | `recordOf()` | the casebook |
| **Its aim**: what was measured as a share of what it estimated | `recordOf().aim`, `aimSentence()`, `adjustEstimate()` | clear reads only |
| **Its lessons**: one sentence per ending | `lessonOf()` | the case's ending and reason |
| **Its authority**: the level it has earned in each room | `earnedLevel()` | the record, by room and across the group |
| **What works here, what the person likes** | `lib/ai/learn.js` (unchanged) | proofs, acted-on and set-aside moves, questions asked |

All of it is pure (`lib/ai/casebook.js`, `lib/ai/room-moves.js`) and runs the
same in the browser, on the server and in tests.

## Authority: earned by evidence, granted by a person

| Level | May | Earned when |
| --- | --- | --- |
| A0 Observes | read and report | always |
| A1 Recommends | suggest a change | a test in the group gave a clear read |
| A2 Drafts | write the change out for approval | a change held up in the group |
| A3 Acts inside your limits | reversible changes inside the fences | two held up in the group, one in this room, estimates within 25% |
| A4 Holds the line | keep a proven change in place | a change held 13 weeks in this room, three held up in the group, no guardrail ever broken in the group |

- A guardrail breach in a room drops that consultant to A1 there for 90 days.
- A person picks the working level, up to the earned one (`autonomy` key, on
  Consultants and System). `saveAction` refuses a raise above what was earned
  (`guardAutonomy`, `earnedAutonomy` in `server/actions.ts`); lowering is
  always allowed.
- No agent raises a level (`lib/agents/policy.js` refuses `autonomy.raise`).
  Money, staff, suppliers and anything outside the product stay at level five:
  a person approves each one. Today nothing writes to Toast or 7shifts, so
  every level still ends at a task to approve.

## Honesty rules

- Counts before rates. A rate shows only with at least `MIN_RATE_N` (5)
  results; below that the screen says "2 of 3".
- An adjusted estimate is still an estimate (`claim: 'est'`) and needs five
  measured changes.
- Learning crosses rooms inside one group, never groups. The benchmark network
  needs 20 comparable restaurants from 5 groups (`NETWORK`); until then the page
  says "not yet".
- "Is the learning paying off" needs 30 results from calls made after learning
  was switched on (`LIFT_RESULTS`), compared against plain rules. Until then no
  screen says the consultants beat rules or a person.
- Facts for Sous name consultants by area ("the labor consultant"), never by a
  page agent's name, so the agent answering stays itself.

## Adding to it

- A new lever: add it to `CONSULTANTS` with the page agent's name
  (`tests/casebook.test.js` checks they match `lib/ai/agents.js`).
- A new kind of evidence (a guardrail, a measurement design): it becomes a
  field on the case in `casesFrom()`, a lesson in `lessonOf()` and, if it
  should gate authority, a need in `earnedLevel()`, with a test.
