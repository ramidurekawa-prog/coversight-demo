# Pre-shift staffing: changes from customer feedback

Ramidu shared a sample of public customer reviews of comparable products and
asked for the lessons to be applied to Today, Service, Data and Proof, through
the real routes and persistence, keeping Coversight's own design and
restaurant language. Feedback from restaurant operators (Toast Now, OpenTable,
7shifts, Tenzo) was weighted most. Feedback from other industries (Linear,
Ramp, Datadog, Fivetran, Flatfile, Stripe) was treated as a design hypothesis
and checked against how a GM works a shift. All of it is one dinner decision
(Rosewood Oakland, Tue Nov 24), manual-entry pilot only, reusing Covercast,
the task system and the proof stages already in this PR.

## What changed, and which feedback informed it

| Area | Feedback | What changed | Where |
| --- | --- | --- | --- |
| Today | Linear: fast queue, but some workflows are hard to find | The next decision leads the first screen. Its card now carries the room, the service and date, who approves, the deadline, the change, the reason and the estimate. A staffing call for the next day's service ranks with today's deadlines. Once a schedule is entered for today, the sample's own "tonight" staffing approval folds into the real call, so there is one staffing decision per service, not two. | `today.parts.jsx` (`frameFor`, `ActionCard`), `lib/data/page/today.js` |
| Today | Ramp: clear pending, approved and done states; weak delegation; inaccurate autofill | Every staffing call shows who approves ("The GM or the owner") and where it stands: Needs approval, Waiting on the GM (asked when, by whom), Approved, Made, Clock-ins match. A floor manager's button is "Ask the GM to approve". It hands the card to the GM through Today's existing assign op, and the card then sits in the compact "Waiting on something else" group, marked seen or not seen yet. The suggested time stays editable: nearer times are offered as chips, and each is its own approval that the server re-checks. | `staffing.jsx` (`ApprovalLine`, `TimeChoice`, `useCanApprove`), `today.jsx`, `today.review.jsx`, `server/page/staffing.ts` (`refuseShift` takes the call's own `options`) |
| Today | Toast Now: operators like sales, labor and who's on in one phone view; loading and sign-in friction; unsolicited AI distracts | The numbers strip now sits under the lead decision instead of above it. A failed refresh keeps the last usable view on screen, says when it was current, and offers Try again. The engine no longer drops a signed-in page to the sample when one refresh fails. Sous stays one line above the page and is never needed to act. | `today.jsx`, `components/engine.js` (`refresh`), `RefreshNote` |
| Service | OpenTable: control over changing conditions, recovering mid-shift | Lunch and Dinner stay the two big controls. "Something different tonight? Update the guests expected" adds or removes guests for one hour, with a reason (large party, event nearby, weather, closed for part of it, something else) and an optional note. The call is worked out again for that hour and can be taken back. | `AdjustGuests`, `staffing.adjust` action key |
| Service | 7shifts: scheduled vs needed in one place; a missed-punch alert after the shift was covered | One table compares scheduled, after the change, needed and on the clock for the same hours. When a gap is covered (the schedule changes so no decision is left), the call leaves the active list, and Service and Today keep it as "Covered" history. Nothing goes on warning about it, because the warning is the live call itself. | `StaffingCompare`, `coveredNote`, `useSeenCalls`, `staffing.seen` action key |
| Service | Datadog: one clear chart; alert fatigue | One chart puts guests above servers. Guests show the likely count, its range, the forecast before a manager's change, and the guests who came. Servers show scheduled, after the change, needed and on the clock. One at-risk window is marked across both ("Watch 4 pm–5 pm: no spare server if guests reach the top of the range"). It replaces the separate "Short from" marker, so the same worry is said once. | `StaffingHours`, `riskWindow` |
| Service | Tenzo: sales and labor together; unreliable source data hurt confidence | The original forecast, each GM change with its reason and who made it, and the actuals as they arrive are all kept. "What changed the outlook" lists the history save, the schedule save and each change, newest first. After the shift the outcome reads "Forecast 138, 158 after your change (large party) · 153 came in". | `outlookChanges`, `forecast.original`, outcome `guard.vs` |
| Data | Fivetran: knowing when a pipeline stops; troubleshooting is hard | The staffing check on Data shows one status row for each input it runs on: source, room, dates covered, last good save (time and rows), the latest attempt (saved, or didn't save and why) and the decision it blocks, with the fix. A failed attempt says the last good data is still the one in use. | `staffingSources`, `components/screens/attempts.js`, `inputs.jsx` |
| Data | Flatfile: mapping and validation help; slow imports and unclear failures | Headers no name matches get a suggested column from their words, flagged "Guess" with a question, and the save waits for a yes. A blank number says "Guests is blank. Type 0 if it really was none", and a typed 0 stays a real zero. A failed save keeps every row and fix, with Try again. Unsaved edits are kept in the browser until saved ("Bring them back"). The bar shows "Saving 360 rows… 4 s", then "Double-checking what was stored". Each set of rows carries one attempt id, so the server saves a retry or a double tap once, and two at once wait for each other. A refused save is logged as `inputs.failed`. | `guessColumns`, `mappingReview`, `inputs-editor.jsx`, `server/page/inputs.ts` (`attempt`, `replayOf`) |
| Proof | Stripe: transactions and payouts together; fees and exceptions hard to follow | The observed dollar opens its proof in place. The proof shows three amounts that are never merged: estimated before the shift, the observed labor difference, and verified savings. Below them, line by line: the decision, the baseline schedule, what was done, the records (schedule row, clock-in row, payroll), the calculation, each offset by person, the payroll check, what could count once verified, and what counts now. Missing evidence names who can provide it. A missing payroll record means nothing can count. With payroll in, the cautious figure is the lower of clock and payroll, after offsets. An added server is a cost, never a saving. A new optional "Paid hours" column on the schedule carries payroll. | `proofOf` in `staffing.js`, `StaffingProof`, `paid_hours` in `ingest.js` |

## The eight checks

Automated: `tests/staffing-feedback.test.js` (19, pure) and
`tests/staffing-feedback.test.ts` (5, the server on PGlite). The signed-in
walkthrough ran on a local Postgres 16 with the app's real routes: two
accounts, an owner and a floor manager in the same group. Only the network
failures and the slow save were simulated, with Playwright routes. The log and
screenshots are in the project files under `staffing/screens/signed-in/`.

| # | Check | Result | How |
| --- | --- | --- | --- |
| 1 | A first-time GM on a phone finds the next action, its deadline and its reason | **Partly passes.** On a phone, getting from Today's row to a fixed, saved schedule and back to the Tuesday dinner decision took 7 taps and 0 scrolls ("Review Diana's 4:30 pm start before 3:30 pm"). The decision card shows the room, the service and date, who approves, the deadline, the change and the reason. But in the sample group, the first phone screen leads with the sample's own same-night card ("Check 8 pm staffing, 45 min left"), and the Tuesday row sits below it. That card really is more urgent. On desktop the Tuesday row is in the first screen. | walkthrough, `01-today-first-screen`, `07-back-to-decision` |
| 2 | A covered shift stops warning; an unrelated issue stays | **Passes.** Wednesday's "Add 1 server from 5 pm to 10 pm" became "No change recommended" once Eve was added. It is marked Covered on Service and listed under "Covered since it was shown" on Today, with no active Wednesday warning left. The other 7 open rows stayed. | walkthrough `17`, `18`; pure tests |
| 3 | An action waiting on another manager shows its owner and status; the server enforces who approves | **Passes.** The floor manager tapped "Ask the GM to approve". Today then showed "Waiting on Marcus Rivera (GM), asked 5:01 pm by Fay Okafor · not seen yet". The floor manager's direct approval was refused with a 403 ("The GM or the owner approves a schedule change"), and the owner then approved. | walkthrough `11`, `12`, `13`; server test |
| 4 | A network failure keeps the view and unsaved corrections; a retry saves once | **Passes.** With the save cut off, the fixed cell still read "10:00 pm", with Try again. The retry saved: schedule entries went from 0 to 1. A refresh failure on Today kept the page, with "Couldn't refresh at 5:01 pm. Showing what was current at 5:01 pm." and Try again. On the server, the same attempt sent twice, both one after the other and both at once, is stored once. | walkthrough `05`, `06`, `14`; server test |
| 5 | A paste with mismapped columns, an invalid time and a real zero is fixable in the preview | **Passes.** "Employee Name", "In", "Out" and "Paid hrs" were flagged as guesses with a question. In and Out were remapped to Starts and Ends and confirmed. "25:00 isn't a time" was fixed in the preview. Eve's paid hours of 0 stayed a real 0, with no warning. | walkthrough `03`, `04`; pure tests |
| 6 | A slow import shows processing, failed or committed; a failed attempt leaves the prior data intact | **Passes.** A 6 s save showed "Saving 360 rows… 4 s", then "Not saved". The Data status row read "Last save failed · last good … 126 rows · The last good data is still the one in use". The database still held one guests-by-hour entry. | walkthrough `19`, `20`; server test |
| 7 | A GM forecast adjustment keeps the original, the reason and the actuals | **Passes.** "+20 guests at 7 pm, large party" changed the call to "Add 1 server from 7 pm to 8 pm". "What changed the outlook" listed it, and taking it back restored "Start Diana at 5 pm". The server keeps the forecast as 158 against an original 138, with the reason and who made it. | walkthrough `09`, `10`; server test |
| 8 | An offsetting cost or missing payroll is visible in Proof and affects verified savings | **Passes.** The proof showed $12.00 Estimated, a $6.00 labor difference less a $4.00 offset (Ana in 10 min early), so $2.00 Observed, and $0.00 Verified. It also said "Nothing can count until payroll confirms the hours" and named who can add payroll. With Diana's paid hours at 5.25, "Could count once verified" read $2.00, and verified savings stayed $0.00. | walkthrough `15`, `16`; pure tests |

The walkthrough found and fixed four things:

- The save bar stuck on "Saving 0 rows…" after a save.
- An approved card was still listed as waiting on the GM.
- "asked by" showed an account id instead of the person's name.
- The Data status rows read this browser's saved attempts during the server render, which caused a hydration mismatch.

The browser-only path, with no database, no integrations and no AI key, was walked again, through to the outcome stages, on desktop and phone (`walkthrough.txt`).

Walkthrough setup:

- The sample only shows Tuesday's dinner on Today once Monday dinner is under way. So the local server and browser clocks ran 45 minutes ahead (4:50 pm instead of 4:05 pm Pacific).
- Database timestamps use the real clock, so a few "last good" times read about 45 minutes earlier than the attempt times.

## What still needs a real restaurant pilot

- **Whether a GM finds the next action unprompted.** The phone test counts
  taps and scrolls for someone who knows the screens. A first-time GM, in the
  middle of a real afternoon, is the real test.
- **The sample's "tonight" story.** In the sample group, the written sample's
  same-night cut card still leads Today until a schedule is entered for
  today. A room on its own data has no such card.
- **Delegation beyond "ask the GM".** It reuses Today's assign op. Whether
  floor managers want to ask a named GM, and whether GMs want a nudge after
  some minutes, needs a pilot.
- **Guest changes.** The reasons list and the plus-or-minus guests per hour
  are a guess at how a GM thinks about a large party or an event. A pilot
  should show whether they think in guests, tables or covers per service.
- **Payroll as the check on clock-ins.** "Paid hours" typed per shift is a
  stand-in for a payroll export. Who in a real restaurant would type it, and
  when, is unknown.
- **Failed-attempt status.** It is kept in the browser. A failure that never
  reached the server can't be on the server's record, so another device
  won't see it. Refused saves are on the server's audit log.
- **Duplicate saves.** Saves are deduplicated per attempt id: through the
  audit log across instances, and in memory for two requests on one
  instance at the same moment. Two instances receiving the same attempt
  within milliseconds could still both save. The rows would then be
  identical, so the second is a no-op on the figures.
- **Covered history.** It rests on the call having been shown on a screen
  (`staffing.seen`). A gap covered before anyone looked leaves no history,
  which is fine, but it is worth saying.
