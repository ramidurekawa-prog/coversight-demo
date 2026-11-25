# Mise: the restaurant's brain

Mise en place is how a kitchen gets everything in its place before service.
Mise does that for the whole restaurant: one understanding of the business that
every page, consultant and Sous answer reads from. It holds no data of its own;
everything comes from the derived room, the casebook and the room's saved
decisions.

**Mise is not a page.** It is a system built into the platform that is always
working: it runs in the background when data arrives and every night, and what
it knows travels with every decision the platform already shows.

## Always on (`server/ai/mise.ts` `thinkMise()`)

| When | Trigger |
| --- | --- |
| Every night, 4:30 am Pacific | the `mise` job (`vercel.json`) |
| New data or results | right after the `sync`, `links`, `proof` and `reverify` jobs |
| Someone saves or undoes an entry or import | `after()` in `/api/inputs` and `/api/inputs/:id/undo` |

Each pass re-reads every room. When a room's records changed it keeps the new
state (`snapshots` kind `mise.state`: what it knows, its gaps, the top things
that would teach it most, closed tests), tells the room's people what it
learned from each test that closed since the last pass (`mise.learned`, once
per test, never for a sample group), and with the AI engine on re-writes the
brain model's read. The first pass for a room only takes stock.

## Where it shows up

- **Every page's agent strip**: under the move, one line from Mise: what went
  wrong last time something like it was tried, else the consultant's record.
- **The Pass (Sous)**: an open ticket carries Mise's brief (how, its record,
  last time, who does it at its level, how we'll know); tests being watched
  say how they are pointing; proven ones how they ended against the estimate
  and the lesson.
- **Sous answers**: "What do you know about us?" and "What would make you
  smarter?" (the Data Steward on Data pages asks it too).
- **Consultants (a Settings tab)**: the casebook, the brain model's read of each
  consultant, and when Mise last re-read the data.
- **How We Work** (Proof group): the plain explanation of Mise, Covercast,
  Sous and the consultants for owners, with what each never does and the fine
  print. It is the only place Mise is described; nothing about it sits on Proof.

## What it knows (`lib/ai/understanding.js`)

Five levels, each a list of things it knows (`text`, `source`, optional claim)
and things it doesn't know yet (`need`, `unlocks`, `fix`):

| Level | Reads from |
| --- | --- |
| Industry | wage rules for the room's state/city (`rulesFor`), the consultants' line checks, the benchmark network (honestly empty below its floor) |
| Group | the group's rooms, verified saving, what the casebook learned across rooms |
| Location | sales history, typical week, top earner, vendors, feeds |
| Management | the GM, who has led tests and how they ended, approvals made vs open, the notebook, suggestions set aside |
| Team | staff roles, hours, register patterns |

`smarter` ranks the data that would teach it most: stale feeds first, then the
line-check `needs`, grouped. `understandingFacts()` turns all of it into Sous
facts (`know:<level>`, `know:smarter`), each with `say`/`todo`.

## Every decision, before, during and after (`lib/ai/mise.js`)

- **Before** (`callBrief`): what, why, how (the consultant's own fix, or the
  draft/approval steps), what it should be worth with its claim, the
  consultant's aim (a corrected figure only with `MIN_RATE_N` measured
  results, otherwise words), what broke last time, who does it at the level
  granted (`levelFor`: every level still ends at a person), and how it will be
  measured (lever changes only).
- **During** (`duringRead`): a running test's interval so far, as pointing the
  right way, the wrong way, or not clear yet; or stopped for missing data.
- **After** (`afterRead`): each closed test against its estimate, and the
  lesson the consultant took from it.

## The brain model (`server/ai/mise.ts`)

`BRAIN_MODEL` in `server/ai/claude.ts` (one setting, `claude-fable-5-2`) writes
a short read of each level and each consultant from the records only. Every
line must pass `numbersOk()` or it is dropped. Reads are cached in `snapshots`
(kind `mise`) by the records' hash, spend the `mise` daily allowance, and are
re-written by `thinkMise()` whenever the records change. With no key, the provider down, or the
allowance spent, the page stands on the built-in records.

## Rules

- Never a figure that isn't in the records. Potential stays potential until a
  test verifies it.
- It learns across a group's own rooms only. Other restaurants' data waits for
  the benchmark network floor (20 locations, 5 groups).
- Mise never acts. It never claims to beat a person or plain rules before
  `LIFT_RESULTS`.
