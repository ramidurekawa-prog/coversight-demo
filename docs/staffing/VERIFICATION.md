# Pre-shift staffing flow: semantics and verification

Companion to [FINDINGS.md](FINDINGS.md). Everything here is computed by
`lib/data/page/staffing.js` (pure, shared by browser and server) and checked
again on the server by `server/page/staffing.ts` before a change is approved.

## The flow

1. **Data** takes two new inputs, typed, pasted or uploaded like any other kind:
   - `services` (Guests by hour): date, hour, guests, servers. This becomes the
     room's own service history (`room.serviceOwn`), read before Toast's or the
     sample's. It never touches `levers.serviceHours`, so no pinned figure moves.
   - `shifts` (Staff schedule): date, role, start, end, and optional name,
     hourly rate, clock-in and clock-out. Saving a date replaces that date's
     shifts only.
2. **The call** (`staffingDecision`) for one date and service compares the
   schedule with what each hour needs. The need is sized to the top of the
   likely range and is never below the room's fence minimum. Covercast
   supplies the range when the history is Toast's or the sample's; typed
   history stands on its own. Each hour is counted at its thinnest half hour,
   so a 5:30 start does not count as covering 5:00.
   - A short stretch comes first: **add 1 server**.
   - Otherwise the call is the **largest later start or earlier end** (in
     30-minute steps, at least 30 minutes) that still covers every hour it
     touches, and only hours that have history.
   - Otherwise **no change**.
3. **States.** `act` means a change passes every guardrail. The other states
   are `hold`, `blocked`, `late`, `live`, `over`, `closed` and `decided`.
   - `blocked` names the missing or stale input and how to fix it.
   - `late` means it is past the deadline, which is 60 minutes before the shift.
   - `decided` means a change is already approved for this service.
4. **One record.**
   - Today's card is `staff:<date>:<meal>`. "Keep the schedule", "Not now" and
     "Assign" are Today's queue ops, used from both Today and Service.
   - Approving creates one task, `shift:<date>:<meal>:<kind>:…`, through
     `createTask`.
   - `createTask` runs `refuseShift`. It checks the role, re-checks the call
     on fresh data, refuses if the change differs, and allows one change per
     service under an advisory lock.
   - The server builds the evidence and stores it on `tasks.evidence`.
5. **After service**, clock-ins entered on Data run `verifyTasks`.
   - A shift task becomes `verified` when the clock-ins show the planned
     change (within 5 minutes). It becomes `mismatch` when they show only part
     of it, or none.
   - The outcome stages are stored on `tasks.outcome`.

## Money and claims

| Figure | Claim | Source |
|---|---|---|
| Estimate on the card | Estimated, "before offsets" | moved minutes × rate. The rate comes from the shift's own hourly rate, else the Toast blended wage, else the sample wage, and is labelled with its source. Integer cents. |
| "Labor not paid" after service | Observed | clock-in difference × the same rate (straight time; payroll not checked). Other servers clocking in early or out late are offsets. |
| Counted as savings | none | Always **not eligible**. The spec's labor-hours method needs 8 comparable services before and 4 after, with service checks. It is not built, so nothing here is Bookable or reaches billing. |

Fixture (tested): 30 minutes at $24 is a **$12 estimate**. Di clocking in
15 minutes late is **$6 observed**, and the task becomes `mismatch` because
it fell short of 30 minutes.

## States kept apart

- **Missing:** no rows for that service.
- **Limited:** some history, but fewer than 3 same-weekday services, or not
  enough busy hours to measure a server's pace.
- **Stale:** the schedule was saved more than 7 days before the service.
- **Zero vs blank:** zero servers with guests is a warning; a blank count is an
  error; an hourly rate of 0 is an error.
- **Estimated:** the card. **Observed:** the clock-ins.
- **Unchanged:** a save identical to what's stored adds nothing.
- **Small hours:** a time without am or pm that reads as 1:00 to 6:59 am is
  warned ("4:30 is read as 4:30 am").

## Verification matrix

| Check | Where |
|---|---|
| Time parsing: 4:30 pm, 4:30p, 4pm, 16:30, 1630, 12 am, bad values | `tests/page-staffing.test.js` |
| Small-hours warning, end before start, overnight | same |
| Zero vs blank, rate 0 | same |
| Saving a date twice replaces it, never doubles | same |
| Blocked: no schedule, thin history, stale schedule; clock-ins "after the shift" | same |
| $12 estimate; ids; every touched hour still covered; sections and reservations are always the manager's call | same |
| Add before cut; hold when it fits; fence minimum respected | same |
| Late after the deadline, live once service starts, over, closed | same |
| Decided when approved; other room's task or cancelled task ignored | same |
| One Today card per service; one data card at a time; sample room shows none until a schedule exists | same |
| Data link rows: that date's shifts, or the missing past services | same |
| Outcome: pending, $6 observed and mismatch, matched with offsets, adverse night | same |
| Server: same call as the browser; room scope; date window | `tests/page-staffing.test.ts` |
| Approval keeps server evidence and ignores the browser's title and steps; audit has the version | same |
| Retry and two managers resolve to one task; a different change for the service is refused | same |
| Floor manager refused; GM of another room refused | same |
| Facts moved, or past the deadline: refused | same |
| A `cut:` id posted directly is refused by `refuseCut` | same |
| Today card moves to approved; clock-ins verify or mismatch the task | same |
| Browser walkthrough (desktop 1440×900, iPhone 13) | `/mnt/project-files/staffing/screens/` (`walkthrough.txt` plus 22 screenshots) |
