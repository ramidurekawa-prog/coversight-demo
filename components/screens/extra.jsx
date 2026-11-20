'use client';

/* Shared by more than one page (see components/screens/pages/). Page threads
   don't edit this file: ask for a shared change so it lands once. */

import * as React from 'react';
import { Icon, Button } from '../kit';
import { Callout } from './core';

/* Coversight — screens added in v2: First six weeks, Portfolio, Weekly meeting,
   Finding detail, Fences & alerts, Billing, and the
   "What's missing" build view (platform gaps → waves → screens). */

/* ================================================================ platform gaps */
const CV_GAPS = [
  { n: 1, title: "Engine computes intervals and picks matched controls itself", state: "Interval is posted by a caller; the Rosewood row is inserted, not produced by the pipeline", pilot: "Estimator built: the daily proof loop measures each window and books the lower bound of a 90% interval. No reader supplies matched controls yet, so every window is a before/after", value: "The whole \"bill on the lower bound\" promise", effort: "M", grade: "A", wave: 0 },
  { n: 2, title: "All 10 verification outcomes recorded", state: "3 of 10 expressible; \"couldn't tell\" and \"didn't work\" look the same", value: "Ranker learning; honest Proof", effort: "S", grade: "A", wave: 0 },
  { n: 3, title: "Per-feed freshness from last successful sync", state: "76% score averages twelve constants; a dead feed reads healthy", pilot: "Toast connection status, sync alerts and /statusz are live. The per-feed data-quality score still averages constants", value: "Trust on first open", effort: "S", grade: "A", wave: 0 },
  { n: 4, title: "7shifts read + write-back", state: "Read-only; token goes stale", value: "Labour is the first lever ready for autonomy", effort: "M", grade: "A", wave: 1 },
  { n: 5, title: "Measured service rate replaces 14 covers/server-hour", state: "Constant; this room's best is 5.29", value: "Flips labour from 137 h idle to 37 h short", effort: "S", grade: "A", wave: 0 },
  { n: 6, title: "Invoice ingestion + price/mix decomposition", state: "No purchasing detector", value: "≈$1.3k per 28 days at Rosewood", effort: "M", grade: "B", wave: 3 },
  { n: 7, title: "Elasticity from the room's own price history", state: "Volume assumed to hold when price moves", value: "Menu goes from $11.9k claimed to ≈$1k real", effort: "M", grade: "B", wave: 3 },
  { n: 8, title: "Control-chart alerting with a stated false-alarm rate", state: "Drift found at month end", value: "Days, not quarters; no alert fatigue", effort: "M", grade: "B", wave: 1 },
  { n: 9, title: "QuickBooks Online + P&L bridge", state: "Specified, unbuilt", value: "A fee basis an accountant signs", effort: "L", grade: "B", wave: 4 },
  { n: 10, title: "Persistence and decay after verification", state: "No 26-week monitoring", value: "Stops counting one dollar forever", effort: "M", grade: "C", wave: 4 },
  { n: 11, title: "Approval, fence and autonomy records", state: "The 19-role crew runs (System), proposing only; no writeback yet", value: "Fewer manager-hours per banked dollar", effort: "L", grade: "C", wave: 2 },
  { n: 12, title: "Waitlist feed", state: "None, so faster turns are always $0", value: "≈$1k/mo ceiling at Rosewood", effort: "S", grade: "D", wave: 5 },
  { n: 13, title: "Invoicing on the reconciled figure, with credits", state: "No billing surface", value: "The commercial model, made visible", effort: "M", grade: "C", wave: 4 },
  { n: 14, title: "Notification service (one message per service)", state: "No push or SMS", value: "Service screen only works if the phone buzzes", effort: "M", grade: "B", wave: 1 },
  { n: 15, title: "Copilot answers only from records, with lineage", state: "\"Ask SKC\" button with no grounding contract", pilot: "Ask answers only from the room's own records (grounded)", value: "Plain-language access without new risk", effort: "M", grade: "C", wave: 5 },
  { n: 16, title: "Kitchen display ticket-level export", state: "Hourly station averages only", value: "Ticket times measured, not estimated", effort: "S", grade: "C", wave: 3 },
  { n: 17, title: "Usage variance: depletion × recipe vs counts + invoices", state: "No theoretical-vs-actual; counts are monthly", value: "Waste, portioning and pours become a lever", effort: "M", grade: "B", wave: 3 },
  { n: 18, title: "Per-person exception limits (voids, comps, discounts)", state: "Comp chart exists for one bar; nothing per person", value: "Register leakage found in days, with a known false-alarm rate", effort: "S", grade: "B", wave: 1 },
  { n: 19, title: "Delivery statement ingestion + channel contribution", state: "Channel totals only; no commissions or refunds", value: "Channel pricing tests with takeout as control", effort: "M", grade: "C", wave: 3 },
  { n: 20, title: "Review and loyalty feeds", state: "Guest retention has no data", value: "Ties order errors to repeat visits", effort: "M", grade: "D", wave: 5 },
  { n: 21, title: "Manual ingestion API with validation and audit log", state: "Demo validates in the browser; the platform has no upload path", pilot: "Recipe-cost upload is live (CSV or paste, unmatched names returned, dated). Counts, waste and invoices still have no upload path", value: "Restaurants without a connector still get counted", effort: "M", grade: "B", wave: 2 },
];
const CV_WAVES = [
  { w: 0, name: "Make the number real", weeks: "1–3", owner: "Engineer + Claude Code", done: "The Rosewood $97 comes out of the pipeline with an interval; a dead feed reads stale" },
  { w: 1, name: "Close the labour loop", weeks: "3–6", owner: "Engineer", done: "One real \"cut one server at 8\" approved on a phone writes back and opens a window" },
  { w: 2, name: "Weeks 0–6 and the meeting", weeks: "4–7", owner: "You (design) + Claude Code", done: "A new tenant gets useful value on day 1 with $0 banked" },
  { w: 3, name: "New levers", weeks: "6–10", owner: "Engineer", done: "Purchasing split reconciles to invoices to the cent; menu prices from data or refuses; usage gaps tie counts to invoices" },
  { w: 4, name: "The accountant", weeks: "10–14", owner: "Engineer + a pilot's controller", done: "One September-style package signed by a real controller; invoice cites it" },
  { w: 5, name: "Scale extras", weeks: "14+", owner: "Engineer", done: "Waitlist connected at one room; copilot answers cite records" },
];
const CV_PAGE_DEPS = {
  today: [3, 4], service: [4, 5, 8, 14], week: [1, 3, 8], portfolio: [1, 3, 8], meeting: [1, 8, 11], plan: [2, 7],
  finding: [2, 6, 7], menu: [7], labour: [4, 5], throughput: [12], purchasing: [6], proof: [1, 2], packet: [1, 2, 10],
  ledger: [1, 9, 10], accountant: [9], billing: [9, 13], comparison: [2], sources: [3], start: [3, 4, 6], fences: [11, 14], system: [11],
  coverage: [3, 16, 17, 18, 19, 20], inventory: [6, 17], kitchen: [12, 16], controls: [8, 18], channels: [19],
  trends: [3, 8], inputs: [3, 21],
  windows: [1, 2, 10],
};
const CV_GRADE_TONE = { A: "bad", B: "warn", C: "info", D: "neutral" };

export { CV_GAPS, CV_WAVES, CV_PAGE_DEPS, CV_GRADE_TONE };
