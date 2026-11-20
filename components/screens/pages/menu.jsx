'use client';

/* Menu prices: the answer first, then four simple parts shown one at a
 * time (Prices, Menu changes, Deals, Your dishes). Prices shows one change:
 * the dish, the new price, the money and one button; the reasons sit behind
 * "Why this price?". Every dish, 52 weeks and the method sit behind a tap. Fixes happen here: a stale or estimated plate
 * cost is entered on this page, never on another one.
 * Every figure comes from lib/data/page/menu.js on the room's own data. */

import * as React from 'react';
import { Button, Icon } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_DS, CV_ROOM, CV_MENU, Claim, cvScale } from '../core';
import { DenseMenu } from '../dense-sections';
import { CORNERS, WAIT_WEEKS, menuChanges, menuView, plateCostRows, teamNote } from '../../../lib/data/page/menu';
import { explain, predict, reactionWord } from '../../../lib/data/page/menu-lab';
import { DEAL_KINDS, dealEconomics, dealResults, keptPerGuest, visitLadder } from '../../../lib/data/page/menu-deals';
import { analyze, checkRows } from '../../../lib/data/page/inputs';
import { jfetch } from './inputs-data';
import s from './menu.module.css';

const money = (n, o) => cvMoney(Math.round(n), o);
const cents = (n) => cvMoney(n, { cents: true });
const pct = (n, dp = 0) => `${(n * 100).toFixed(dp)}%`;
const STATUS = {
  good: { label: 'On track', icon: 'CircleCheck', cls: 'chip_good' },
  watch: { label: 'Worth a look', icon: 'Eye', cls: 'chip_warn' },
  bad: { label: 'Needs you', icon: 'TriangleAlert', cls: 'chip_bad' },
};

/* ================================================================ Plate Map */
function PlateMap({ v, sel, onSel }) {
  const W = 560, H = 340, P = { l: 40, r: 12, t: 26, b: 30 };
  const maxU = Math.ceil(Math.max(...CV_MENU.map((m) => m.units)) / 50) * 50 + 10;
  const maxCM = Math.ceil(Math.max(...CV_MENU.map((m) => m.cm)) / 4) * 4;
  const x = cvScale(0, maxU, P.l, W - P.r), y = cvScale(0, maxCM, H - P.b, P.t);
  const mx = x(v.meanUnits), my = y(v.cmWeighted);
  /* Name a few dishes (the selected one first), skipping any label that would sit on one already placed. */
  const placed = [];
  const named = new Set();
  [sel, ...v.ready.map((m) => m.item), v.best?.key, v.high[0]?.key].filter(Boolean).forEach((k) => {
    const m = CV_MENU.find((d) => d.key === k);
    if (!m || named.has(k)) return;
    const px = x(m.units), py = y(m.cm);
    if (placed.some(([qx, qy]) => Math.abs(qx - px) < 120 && Math.abs(qy - py) < 16)) return;
    placed.push([px, py]); named.add(k);
  });
  const zones = [
    ['gem', P.l, P.t, mx - P.l, my - P.t], ['star', mx, P.t, W - P.r - mx, my - P.t],
    ['rethink', P.l, my, mx - P.l, H - P.b - my], ['thin', mx, my, W - P.r - mx, H - P.b - my],
  ];
  return (
    <svg className={s.map} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Every dish by how much it sells and what each plate earns. Each dish is a button.">
      {zones.map(([k, zx, zy, zw, zh]) => <rect key={k} className={s[`zone_${CORNERS[k].tone}`]} x={zx} y={zy} width={Math.max(0, zw)} height={Math.max(0, zh)} />)}
      {zones.map(([k, zx, zy, zw]) => (
        <text key={`${k}-t`} className={s.zoneLbl} x={k === 'gem' || k === 'rethink' ? zx + 8 : zx + zw - 8} y={k === 'gem' || k === 'star' ? zy - 8 : H - P.b - 8} textAnchor={k === 'gem' || k === 'rethink' ? 'start' : 'end'}>{CORNERS[k].label}</text>
      ))}
      {Array.from({ length: maxCM / 4 + 1 }, (_, i) => i * 4).map((n) => <text key={n} className={s.axis} x={P.l - 6} y={y(n) + 4} textAnchor="end">${n}</text>)}
      {Array.from({ length: Math.floor(maxU / 50) + 1 }, (_, i) => i * 50).map((n) => <text key={n} className={s.axis} x={x(n)} y={H - 10} textAnchor="middle">{n}</text>)}
      <text className={s.axisLbl} x={W - P.r} y={H} textAnchor="end">plates a week →</text>
      <text className={s.axisLbl} x={4} y={P.t + 2} textAnchor="start" transform={`rotate(90 4 ${P.t + 2})`}>earns per plate</text>
      {v.list.filter((m) => !m.balancing).map((m) => {
        const on = sel === m.key;
        const tone = CORNERS[m.corner].tone;
        const lx = m.units > maxU * 0.7 ? x(m.units) - 11 : x(m.units) + 11;
        return (
          <g key={m.key} className={s.dot} onClick={() => onSel(m.key)} tabIndex={0} role="button" aria-pressed={on} aria-label={`${m.name}: ${m.units} plates a week, earns ${cents(m.cm)} a plate`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSel(m.key); } }}>
            <circle cx={x(m.units)} cy={y(m.cm)} r={on ? 9 : 6} className={on ? s.dotOn : s[`dot_${tone}`]} strokeDasharray={m.e == null && !on ? '2 2' : undefined} />
            {named.has(m.key) && (
              <text className={on ? s.dotLblOn : s.dotLbl} x={lx} y={y(m.cm) + 4} textAnchor={m.units > maxU * 0.7 ? 'end' : 'start'}>{m.name}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ================================================================ fix a plate cost, here */
function CostFix({ dish, unlocks, compact }) {
  const cv = useCv();
  const eng = useEngine();
  const [val, setVal] = React.useState(String(dish.cost.toFixed(2)));
  const [ask, setAsk] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const cost = Number(String(val).replace(/[$,\s]/g, ''));
  const save = async (confirmed = false) => {
    setErr(null);
    const prior = eng.inputs?.[CV_D.id]?.recipes;
    const opts = prior?.opts;
    const room = CV_DS.rooms[CV_D.id];
    const res = checkRows('recipes', plateCostRows(prior?.rows, dish, cost), room, opts);
    if (!res.ok) { setErr(res.error); return; }
    const a = analyze({ base: eng.base, inputs: eng.inputs, roomId: CV_D.id, kind: 'recipes', rows: res.rows, opts, windows: eng.windows, issues: res.issues });
    if (a.confirm.length && !confirmed) { setAsk(a.confirm); return; }
    const summary = `${dish.name} plate cost: ${cents(dish.cost)} → ${cents(cost)}`;
    setBusy(true);
    try {
      if (eng.mode === 'server') {
        await jfetch('/api/inputs', { method: 'POST', body: JSON.stringify({ roomId: CV_D.id, kind: 'recipes', rows: res.rows, opts, summary, confirm: confirmed || undefined, provenance: { source: 'grid' } }) });
        await engine.hydrate();
      } else {
        engine.commit('recipes', CV_D.id, a.rows, summary, opts);
      }
      cv.toast(`${summary}. Saved for ${CV_ROOM.short}; every margin here is recomputed.`);
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); setAsk(null); }
  };
  return (
    <div className={compact ? s.fixRowCompact : s.fixRow}>
      <div className={s.fixDish}>
        <b>{dish.name}</b>
        <span>{dish.costEstimated ? 'Plate cost is a guess' : 'Plate cost needs a check'} · sells for {cents(dish.price)}</span>
      </div>
      <label className={s.fixField}>
        <span className="sr-only">Plate cost for {dish.name}</span>
        <span aria-hidden="true">$</span>
        <input inputMode="decimal" value={val} onChange={(e) => { setVal(e.target.value); setAsk(null); }} aria-invalid={!!err} />
      </label>
      {ask ? (
        <Button variant="secondary" size="sm" icon="Check" disabled={busy} onClick={() => save(true)}>Yes, save</Button>
      ) : (
        <Button variant="secondary" size="sm" icon="Check" disabled={busy || !(cost > 0)} onClick={() => save(false)}>{unlocks ? `Save, unlock ${money(unlocks)}/wk` : 'Save'}</Button>
      )}
      {ask && <p className={s.fixNote}>{ask.join(' ')}</p>}
      {err && <p className={s.fixErr} role="alert"><Icon name="TriangleAlert" size={14} />{err}</p>}
    </div>
  );
}

/* ================================================================ the recommended change */
/* One change at a time: the dish, the price, the money, one button. The
 * numbers behind it (sales, plates, the Menu Maker's reason) sit behind "Why". */
function Tester({ v, sel, setSel, onAll }) {
  const cv = useCv();
  const eng = useEngine();
  const [why, setWhy] = React.useState(false);
  const move = v.moves.find((m) => m.id === sel.move) || null;
  const item = CV_MENU.find((m) => m.key === sel.dish) || CV_MENU[0];
  const price = sel.price;
  const r = item.balancing ? null : predict(v.lab, item, price);
  const L = v.lab.dishes[item.key];
  const recommended = move && move.kind === 'price' && price === move.to;
  const changed = price !== item.price;
  const fence = v.fence / 100;
  const step = (d) => { const st = item.price < 10 ? 0.25 : 0.5; setSel({ ...sel, price: Math.max(+(item.price * (1 - fence)).toFixed(2), Math.min(+(item.price * (1 + fence)).toFixed(2), Math.round((price + d * st) / st) * st)) }); };
  const over = Math.abs(price / item.price - 1) > fence + 1e-9;
  const wide = L?.se != null && L.e && L.se / Math.abs(L.e) > 0.4;
  const id = `price:${item.key}:${price}`;
  const done = eng.tasks?.some((t) => t.roomId === CV_D.id && t.approvalId.startsWith(`price:${item.key}:`) && t.status !== 'cancelled');
  const needsCost = item.costEstimated || (move && move.needsCost && move.item === item.key);
  const unlock = v.waiting.find((m) => m.item === item.key);
  const plates = r ? Math.round(r.lost) : 0;
  const say = changed && r ? explain(v.lab, item, r) : null;
  const nav = <MoveNav v={v} sel={sel} setSel={setSel} onAll={onAll} />;

  /* A change that isn't a price: a placement test, added to the plan as a task. */
  if (move && move.kind !== 'price') {
    const mid = move.taskId;
    const added = eng.tasks?.some((t) => t.roomId === CV_D.id && t.approvalId === mid && t.status !== 'cancelled');
    return (
      <section className={s.action} aria-label="Recommended change">
        {nav}
        <h2 className={s.dishName}>{move.title}</h2>
        <p className={s.actionWhy}>{move.why}</p>
        <Gain value={move.value} lo={move.lo} hi={move.hi} claim={move.claim} />
        <div className={s.ctaRow}>
          {added ? <span className={s.doneMark}><Icon name="CircleCheck" size={18} />On your plan. The steps are on Today.</span>
            : <Button icon="Check" className={s.cta} onClick={() => { void engine.createTask(mid, { title: move.title, system: 'Menu', diff: [['Menu', 'As now', move.title]] }); cv.toast(`${move.title}: added to your plan. The steps are on Today.`); }}>Add to my plan</Button>}
        </div>
      </section>
    );
  }

  return (
    <section className={s.action} aria-label="Recommended change">
      {nav}
      <div className={s.dishRow}>
        <h2 className={s.dishName}>{item.name}</h2>
        {r && (
          <div className={s.stepper}>
            <button type="button" className={s.stepBtn} onClick={() => step(-1)} aria-label="A step lower"><Icon name="Minus" size={18} /></button>
            <span className={s.priceWas}>{cents(item.price)}</span>
            <Icon name="ArrowRight" size={18} className={s.priceArrow} />
            <output className={s.priceOut} aria-live="polite" aria-label="New price">{cents(price)}</output>
            <button type="button" className={s.stepBtn} onClick={() => step(1)} aria-label="A step higher"><Icon name="Plus" size={18} /></button>
          </div>
        )}
      </div>
      {r && (recommended ? <span className={s.recTag}><Icon name="Sparkles" size={14} />Best price for this dish</span>
        : move?.kind === 'price' && move.item === item.key ? <button type="button" className={s.textBtn} onClick={() => setSel({ ...sel, price: move.to })}>Back to the best price ({cents(move.to)})</button> : null)}

      {!r ? (
        <p className={s.note}><Icon name="Ban" size={16} />{item.balancing ? 'This line rolls up sides and add-ons, so it has no single price to test.' : `We don’t have enough weeks on the ${item.name.toLowerCase()} yet. Change it on judgment, and we’ll measure what happens.`}</p>
      ) : changed ? (
        <Gain value={r.kept} lo={r.bad} hi={r.good} claim={item.costEstimated ? 'est' : 'mod'} />
      ) : (
        <p className={s.note}><Icon name="Info" size={16} />Tap + or − to try a new price.</p>
      )}
      {over && <p className={s.note}><Icon name="Fence" size={16} />That’s past your {v.fence}% limit for one price change. Pick a smaller step.</p>}
      {r && changed && r.bad < 0 && r.kept > 0 && <p className={s.note}><Icon name="TriangleAlert" size={16} />A bad week could lose money. A test settles it before anything counts.</p>}

      {needsCost ? (
        <div className={s.unlock}>
          <p className={s.unlockHead}><Icon name="Lock" size={16} />Check the plate cost first{unlock ? <>, then this change is ready</> : null}.</p>
          <CostFix dish={item} unlocks={unlock?.value} compact />
        </div>
      ) : (
        <div className={s.ctaRow}>
          {done ? <>
            <span className={s.doneMark}><Icon name="CircleCheck" size={18} />Approved. The steps are on Today.</span>
            {v.pick && <Button variant="secondary" iconRight="ArrowRight" onClick={() => setSel({ move: v.pick.id, dish: v.pick.item || sel.dish, price: v.pick.to ?? sel.price })}>Next change</Button>}
          </>
            : <Button icon="Check" className={s.cta} disabled={!changed || over || !r || r.kept <= 0} onClick={() => cv.approve(id)}>Review this change</Button>}
          {r && changed && <button type="button" className={s.whyBtn} aria-expanded={why} onClick={() => setWhy(!why)}>Why this price?<Icon name={why ? 'ChevronUp' : 'ChevronDown'} size={16} /></button>}
        </div>
      )}

      {why && r && changed && (
        <div className={s.why}>
          {say && <p className={s.maker}><span className={s.makerTag}><Icon name="Sparkles" size={14} />Menu Maker</span>{say}</p>}
          <div className={s.whyGrid}>
            <span><small>Sales</small><b>{money(r.sales, { sign: true })}</b><small>a week</small></span>
            <span><small>Plates</small><b>{plates > 0 ? `−${plates}` : plates < 0 ? `+${-plates}` : '±0'}</b><small>of {item.units} a week</small></span>
            <span><small>Food share</small><b className={item.cost / item.price > 0.4 ? s.warnTxt : undefined}>{pct(item.cost / price)}</b><small>was {pct(item.cost / item.price)}</small></span>
            {r.kept > 0 && !done && <span><small>Waiting {WAIT_WEEKS} weeks</small><b className={s.green}>{money(Math.round(r.kept) * WAIT_WEEKS)}</b><small>left on the table</small></span>}
          </div>
          {wide && <p className={s.note}><Icon name="TriangleAlert" size={16} />Guests’ reaction to this dish is loosely measured, so expect a wide result and a longer test.</p>}
          <p className={s.cardSub}>Tested for 6 weeks before anything counts.</p>
        </div>
      )}
    </section>
  );
}

/** The money, as one big number and a bar from a bad week to a good week. */
function Gain({ value, lo, hi, claim }) {
  const up = value >= 0;
  const ok = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
  const at = ok ? Math.min(1, Math.max(0, (value - lo) / (hi - lo))) : 0.5;
  return (
    <div className={s.gain}>
      <div className={s.gainMain}>
        <span className={up ? s.gainBig : s.lossBig}>{money(value, { sign: true })}</span>
        <span className={s.gainUnit}>a week, most likely</span>
        <Claim k={claim} />
      </div>
      {ok && (
        <div className={s.range} title="8 in 10 weeks land between these. Potential until a test proves it.">
          <span className={`${s.rangeBar} ${lo < 0 ? s.rangeRisk : ''}`}><i style={{ left: `${at * 100}%` }} /></span>
          <span className={s.rangeEnds}>
            <span className={lo >= 0 ? s.caseGood : s.caseBad}>Bad week <b>{money(lo, { sign: true })}</b></span>
            <span className={s.caseGood}>Good week <b>{money(hi, { sign: true })}</b></span>
          </span>
        </div>
      )}
    </div>
  );
}

/** "Change 2 of 5" with back and next, instead of a row of chips. */
function MoveNav({ v, sel, setSel, onAll }) {
  const list = [...v.moves].sort((a, b) => Number(b.ready) - Number(a.ready));
  if (!list.length) return <span className={s.over}><Icon name="Sparkles" size={14} />Try a price on any dish</span>;
  const i = list.findIndex((m) => m.id === sel.move);
  const go = (k) => {
    const m = list[(k + list.length) % list.length];
    const dish = m.item ? CV_MENU.find((d) => d.key === m.item) : null;
    setSel({ move: m.id, dish: m.item || sel.dish, price: m.to ?? (dish?.price ?? sel.price) });
  };
  return (
    <div className={s.nav}>
      <span className={s.over}><Icon name="Sparkles" size={14} />{i >= 0 ? `Change ${i + 1} of ${list.length}` : 'Your own price'}</span>
      <span className={s.navBtns}>
        {i < 0 ? <button type="button" className={s.textBtn} onClick={() => go(0)}>Back to our picks</button> : <>
          <button type="button" className={s.navBtn} onClick={() => go(i - 1)} aria-label="Previous change"><Icon name="ChevronLeft" size={18} /></button>
          <button type="button" className={s.navBtn} onClick={() => go(i + 1)} aria-label="Next change"><Icon name="ChevronRight" size={18} /></button>
        </>}
        <button type="button" className={s.textBtn} onClick={onAll}>See all</button>
      </span>
    </div>
  );
}
/* ================================================================ the page */
function CvMenu() {
  const eng = useEngine();
  const windows = eng.mode === 'server' ? eng.windows || [] : null;
  const fence = eng.actions?.[CV_D.id]?.fences?.f?.maxPrice ?? 8;
  const [labSet, setLabSet] = useSaved('menu.lab', { keepOrders: 0.9 });
  const keepOrders = labSet?.keepOrders ?? 0.9;
  const v = React.useMemo(() => menuView(CV_D, { tasks: eng.tasks || [], windows, fence, keepOrders }), [eng.tasks, windows, eng.version, fence, keepOrders]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = v.pick || v.moves[0] || null;
  const fallback = v.best || CV_MENU[0];
  const [sel, setSelRaw] = React.useState(() => (first
    ? { move: first.id, dish: first.item || fallback.key, price: first.to ?? (CV_MENU.find((m) => m.key === first.item)?.price ?? fallback.price + 1) }
    : { move: null, dish: fallback.key, price: fallback.price + (fallback.price < 24 ? 1 : 2) }));
  const setSel = setSelRaw;
  const pickDish = (key) => {
    const m = v.moves.find((c) => c.item === key && c.kind === 'price');
    const d = CV_MENU.find((x) => x.key === key);
    setSelRaw(m ? { move: m.id, dish: key, price: m.to } : { move: null, dish: key, price: d.price + (d.price < 24 ? 1 : 2) });
  };
  const [open, setOpen] = React.useState(null);
  const st = STATUS[v.status];
  const fixes = [...new Map([...v.waiting.filter((m) => m.needsCost).map((m) => CV_MENU.find((d) => d.key === m.item)).filter(Boolean), ...v.estimated].map((d) => [d.key, d])).values()];
  const firstWaiting = (key) => v.waiting.find((m) => m.item === key)?.value;
  const nowWins = v.bankedWeek > 0;
  const progressPct = v.progress.of ? v.progress.done / v.progress.of : 0;

  const [tab, setTab] = React.useState('prices');
  const changes = menuChanges(CV_D, { tasks: eng.tasks || [], windows: eng.windows || [] });
  const [deals] = useSaved('menu.deals', []);
  const liveDeals = (Array.isArray(deals) ? deals : []).filter((x) => x.status === 'live').length;
  const TABS = [
    ['prices', 'Prices', 'Tag', v.progress.of ? `${v.progress.done}/${v.progress.of}` : null],
    ['changes', 'Menu changes', 'History', changes.open ? `${changes.open}` : null],
    ['deals', 'Deals', 'Gift', liveDeals ? `${liveDeals} live` : null],
    ['dishes', 'Your dishes', 'LayoutGrid', null],
  ];
  const seeAll = () => { setTab('dishes'); setOpen('balanced'); };

  return (
    <div className={`cv-page wide ${s.page}`}>
      {/* The answer, then four simple parts: one shown at a time. */}
      <header className={s.head}>
        <span className={`${s.chip} ${s[st.cls]}`}><Icon name={st.icon} size={14} />{st.label}</span>
        <h1 className={s.headline}>{v.headline}</h1>
        <span className={s.context}>{CV_ROOM.name} · week of {v.period}</span>
      </header>

      <nav className={s.tabs} role="tablist" aria-label="Menu">
        {TABS.map(([k, label, icon, badge]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`${s.tab} ${tab === k ? s.tabOn : ''}`} onClick={() => setTab(k)}>
            <Icon name={icon} size={18} />{label}{badge && <span className={s.tabBadge}>{badge}</span>}
          </button>
        ))}
      </nav>

      {tab === 'prices' && (
        <div className={s.stack}>
          <Tester key={`${sel.move}-${sel.dish}`} v={v} sel={sel} setSel={setSel} onAll={seeAll} />
          <div className={s.progress}>
            <span className={s.progressLbl}>Your menu plan: <b>{v.progress.done} of {v.progress.of}</b> done</span>
            <span className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={v.progress.of} aria-valuenow={v.progress.done} aria-label="Menu changes made"><i style={{ width: `${Math.max(progressPct * 100, 3)}%` }} /></span>
            <span className={s.kpiGood}>
              {nowWins ? <><Icon name="BadgeCheck" size={15} />{money(v.bankedWeek)}/wk kept and verified</>
                : v.openSum > 0 ? <>{money(v.openSum)}/wk potential to go <Claim k="mod" /></> : v.progress.of ? 'All done. Results come back here.' : 'Nothing waiting'}
            </span>
          </div>
          {fixes.length > 0 && (
            <section className={s.fixCard} aria-label="Fix plate costs">
              <div className={s.cardHead}>
                <h2 className={s.cardTitle}><Icon name="Lock" size={17} />{v.waitingSum > 0 ? <>Unlock <span className={s.green}>{money(v.waitingSum)}/wk</span> more</> : 'Check these plate costs'}</h2>
                <span className={s.cardSub}>Type what one plate costs you to make.</span>
              </div>
              {fixes.slice(0, 3).map((d) => <CostFix key={`${d.key}-${d.cost}`} dish={d} unlocks={firstWaiting(d.key)} />)}
              {fixes.length > 3 && <p className={s.cardSub}>{fixes.length - 3} more in Your dishes.</p>}
            </section>
          )}
        </div>
      )}

      {tab === 'changes' && <div className={s.stack}><Changes eng={eng} /></div>}
      {tab === 'deals' && <div className={s.stack}><Deals v={v} /></div>}

      {tab === 'dishes' && (
        <div className={s.stack}>
          <div className={s.kpis}>
            <div className={s.kpi}>
              <span className={s.kpiLbl}>Each plate leaves you</span>
              <span className={s.kpiBig}>{cents(v.weeks.wcm)}</span>
              {v.weeks.beat >= v.weeks.of / 2
                ? <span className={s.kpiGood}><Icon name="TrendingUp" size={15} />Better than {v.weeks.beat} of your last {v.weeks.of} weeks</span>
                : <span className={s.kpiSub}>Usual week: {cents(v.weeks.avg)}</span>}
            </div>
            <div className={s.kpi}>
              <span className={s.kpiLbl}>Food cost</span>
              <span className={s.kpiBig}>{v.food ? pct(v.food.now, 1) : '—'}</span>
              {v.food && <span className={v.food.now <= v.food.then ? s.kpiGood : v.food.status === 'good' ? s.kpiSub : s.kpiWarn}>
                <Icon name={v.food.now <= v.food.then ? 'TrendingDown' : 'TrendingUp'} size={15} />{v.food.now <= v.food.then ? 'Lower' : 'Higher'} than {v.food.vs.toLowerCase()}
              </span>}
            </div>
            {v.good && <div className={s.kpi}><span className={s.kpiLbl}>Star dish</span><span className={s.kpiMid}><Icon name="Trophy" size={18} className={s.icGood} />{v.best?.name || v.good}</span><span className={s.kpiGood}>Makes you the most money</span></div>}
          </div>
          <div className={s.dishGrid}>
          <section className={s.card} aria-label="Plate Map">
            <div className={s.cardHead}>
              <h2 className={s.cardTitle}>Plate Map</h2>
              <span className={s.cardSub}>Tap a dish to try a price.</span>
            </div>
            <PlateMap v={v} sel={sel.dish} onSel={(k) => { pickDish(k); setTab('prices'); }} />
            <div className={s.legend}>
              <span><i className={s.lgGood} />Earns more than your average plate ({cents(v.cmWeighted)})</span>
              <span><i className={s.lgDash} />Price never tested</span>
              <Claim k="obs" />
            </div>
          </section>
          <TrackRecord t={v.track} />
          </div>
          <section className={s.detail} id="menu-detail">
            <div className={s.detailTabs} role="tablist" aria-label="Menu detail">
              {[['balanced', 'Best prices', 'Sparkles'], ['dishes', `Every dish (${v.dishes})`, 'LayoutList'], ['weeks', '52 weeks', 'ChartLine'], ['how', 'How it works', 'Calculator']].map(([k, label, icon]) => (
                <button key={k} type="button" role="tab" aria-selected={open === k} className={`${s.detailTab} ${open === k ? s.detailTabOn : ''}`} onClick={() => setOpen(open === k ? null : k)}>
                  <Icon name={icon} size={16} />{label}<Icon name={open === k ? 'ChevronUp' : 'ChevronDown'} size={15} />
                </button>
              ))}
            </div>
            {open === 'balanced' && <Balanced v={v} keepOrders={keepOrders} setKeep={(k) => setLabSet({ keepOrders: k }, `Balanced menu keeps at least ${Math.round(k * 100)}% of each dish's orders`)} onTry={(m) => { setSel({ move: m.id, dish: m.item, price: m.to }); setTab('prices'); }} />}
            {open === 'dishes' && <DishTable v={v} sel={sel.dish} onSel={(k) => { pickDish(k); setTab('prices'); }} />}
            {open === 'weeks' && <div className={s.detailBody}><DenseMenu /></div>}
            {open === 'how' && (
              <div className={`${s.detailBody} ${s.how}`}>
                <p><b>Earns per plate</b> is the price minus what the plate costs to make.</p>
                <p><b>How guests react to a price</b> is learned from your own weeks: what each dish sold at each price, with busy and quiet weeks taken out. A dish with little history leans on how your whole menu reacts, never on a made-up number.</p>
                <p><b>Switching:</b> some guests who skip a dish after a price rise order another one instead. We measure how often, and count it.</p>
                <p><b>Good week and bad week</b> are the edges of where 8 in 10 weeks land.</p>
                <p><b>Best prices</b> tries every price inside your {v.fence}% limit and keeps the one that leaves the most money, only when even a bad week doesn’t lose money and the dish keeps at least {Math.round(v.keepOrders * 100)}% of its orders. Changes go out five at a time.</p>
                <p><b>Potential</b> money is a model until a 6-week test proves it. Only the low end of a verified result is ever counted.</p>
                <p className={s.cardSub}>Unmarked numbers come from your own restaurant’s data{CV_D.room.fromToast ? `: Toast through ${CV_D.room.fromToast.end}` : ''}.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function DishTable({ v, sel, onSel }) {
  return (
    <div className={`cv-tablewrap ${s.detailBody}`} tabIndex={0} role="group" aria-label="Every dish">
      <table className="cv-table">
        <thead><tr><th>Dish</th><th>Where it sits</th><th className="r">Price</th><th className="r">Plate cost</th><th className="r">Food share</th><th className="r">Earns a plate</th><th className="r">Plates a week</th><th>Guests</th><th className="r">+$1 adds a week</th></tr></thead>
        <tbody>
          {v.list.map((m) => (
            <tr key={m.key} className={`cv-tr ${sel === m.key ? 'sel' : ''}`} onClick={() => onSel(m.key)}>
              <td><b>{m.name}</b> <span className="cv-xs cv-faint">{m.balancing ? 'sides and add-ons' : m.cat}</span>{m.costEstimated && <span className={s.tagWarn}>cost is a guess</span>}</td>
              <td className="cv-xs">{m.balancing ? '—' : CORNERS[m.corner].label}</td>
              <td className="r">{cents(m.price)}</td>
              <td className="r">{cents(m.cost)}</td>
              <td className={`r ${m.foodRate > 0.4 ? s.tdWarn : ''}`}>{pct(m.foodRate)}</td>
              <td className="r">{cents(m.cm)}</td>
              <td className="r">{m.units}</td>
              <td className="cv-xs">{m.balancing ? '—' : reactionWord(m.reaction)}</td>
              <td className={`r ${m.plusOne > 0 ? s.tdGood : ''}`}>{m.plusOne == null ? '—' : money(m.plusOne, { sign: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================ changes made: rollout, versions, reprint */
const STEP_ICON = { toast: 'Check', apps: 'Bike', print: 'Printer', staff: 'Users', check: 'Receipt' };
function Changes({ eng }) {
  const cv = useCv();
  const [rollout, setRollout] = useSaved('menu.rollout', {});
  const [copied, setCopied] = React.useState(false);
  const c = menuChanges(CV_D, { tasks: eng.tasks || [], rollout: rollout || {}, windows: eng.windows || [] });
  if (!c.rows.length) return (
    <section className={`${s.card} ${s.empty}`} aria-label="Your menu changes">
      <Icon name="History" size={28} />
      <h2 className={s.cardTitle}>No price changes yet</h2>
      <p className={s.cardSub}>When you approve one, it shows up here with every step to roll it out: Toast, delivery apps, reprint and your team.</p>
    </section>
  );
  const tick = (rows, k) => {
    const at = new Date().toISOString();
    const next = { ...(rollout || {}) };
    rows.forEach((r) => { next[r.id] = { ...(next[r.id] || {}), [k]: at }; if (k === 'toast' && r.taskId) engine.taskAction(r.taskId, 'done'); });
    setRollout(next, `${c.steps.find((x) => x.k === k)?.label}: ${rows.map((r) => r.name).join(', ')}`);
  };
  const untick = (r, k) => {
    const next = { ...(rollout || {}), [r.id]: { ...(rollout?.[r.id] || {}) } };
    delete next[r.id][k];
    setRollout(next, `${c.steps.find((x) => x.k === k)?.label}: ${r.name} not done yet`);
  };
  const note = teamNote(c.rows.filter((r) => r.live));
  const latest = c.versions[0];
  return (
    <section className={s.card} aria-label="Your menu changes">
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}><Icon name="History" size={17} />Your menu changes</h2>
        <span className={s.cardSub}>Menu v{latest.n} · {new Date(`${latest.day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · {c.open ? `${c.open} still rolling out` : 'every change is fully rolled out'}</span>
      </div>
      <div className={s.changeList}>
        {c.versions.flatMap((ver) => ver.changes.map((r) => (
          <div key={r.id} className={s.changeRow}>
            <div className={s.changeName}>
              <b>{r.name}</b>
              <span>{r.from != null ? cents(r.from) : ''} → <b>{cents(r.to)}</b> · v{ver.n}{r.test ? ` · test ${r.test.status}` : ''}</span>
            </div>
            <div className={s.steps} role="group" aria-label={`${r.name} rollout`}>
              {c.steps.map((st) => {
                const on = !!r.ticks[st.k];
                const auto = st.k === 'check';
                return (
                  <button key={st.k} type="button" className={`${s.step} ${on ? s.stepOn : ''}`} disabled={auto && r.ticks.check === 'data'} aria-pressed={on}
                    title={auto && !on ? `${st.label}: ticks itself when your next Toast data shows the new price` : st.label}
                    onClick={() => (on ? untick(r, st.k) : tick([r], st.k))}>
                    <Icon name={on ? 'CircleCheck' : STEP_ICON[st.k]} size={15} /><span>{st.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )))}
      </div>
      {(c.printQueue.length > 0 || note) && (
        <div className={s.changeFoot}>
          {c.printQueue.length > 0 && (
            <span className={s.footItem}><Icon name="Printer" size={15} />{c.printQueue.length === 1 ? 'One change is' : `${c.printQueue.length} changes are`} waiting for the next reprint, so it’s one print run.
              <Button variant="secondary" size="sm" onClick={() => tick(c.printQueue, 'print')}>Mark printed</Button></span>
          )}
          {note && (
            <span className={s.footItem}><Icon name="Users" size={15} />Team note ready.
              <Button variant="secondary" size="sm" icon="Copy" onClick={() => { try { void navigator.clipboard?.writeText(note); } catch { /* clipboard blocked: the note is shown */ } setCopied(true); cv.toast('Team note copied. Paste it in your team chat.'); }}>{copied ? 'Copied' : 'Copy'}</Button>
              <Button variant="ghost" size="sm" onClick={() => tick(c.rows.filter((r) => r.live && !r.ticks.staff), 'staff')}>Mark told</Button></span>
          )}
        </div>
      )}
    </section>
  );
}

/* ================================================================ specials and deals */
const pick = (list, test, fallback) => list.find(test) || fallback;
function defaultsFor(kind) {
  const food = CV_MENU.filter((m) => !m.balancing && m.cat === 'Food');
  const dessert = CV_MENU.filter((m) => !m.balancing && m.cat === 'Dessert').sort((a, b) => a.cost - b.cost)[0];
  const starter = [...food].sort((a, b) => a.cost - b.cost)[0];
  if (kind === 'bundle') return { kind, dish: pick(food, (m) => /taco/i.test(m.name), [...food].sort((a, b) => b.units - a.units)[0])?.key, buy: 3, takeUp: 0.25 };
  if (kind === 'threshold') return { kind, free: starter?.key, threshold: 75, checks: 0 };
  return { kind, free: (dessert || starter)?.key, days: 30, cards: 0 };
}

function Deals({ v }) {
  const cv = useCv();
  const [deals, setDeals] = useSaved('menu.deals', []);
  const [draft, setDraft] = React.useState(null);
  const list = Array.isArray(deals) ? deals : [];
  const e = draft ? dealEconomics(CV_D, v.lab, draft) : null;
  const save = (status) => {
    const id = `deal-${Date.now().toString(36)}`;
    const at = new Date().toISOString();
    const row = { ...draft, id, status, at, ...(status === 'live' ? { liveAt: at } : {}) };
    setDeals([row, ...list].slice(0, 40), `${e.title}: ${status === 'live' ? 'live' : 'saved as a draft'}`);
    if (status === 'live') goLive(row, e);
    setDraft(null);
  };
  const goLive = (row, econ) => {
    void engine.createTask(`deal:${row.id}`, { title: `Set up the deal: ${econ.title}`, system: 'Toast', diff: [['Discount in Toast', 'None', econ.title], ['Who can use it', '—', row.kind === 'comeback' ? 'Guests with the card' : 'Every guest']] });
    cv.toast(`${econ.title}: live. The Toast setup steps are on Today.`);
  };
  const update = (id, patch, note) => setDeals(list.map((x) => (x.id === id ? { ...x, ...patch } : x)), note);
  const ladder = visitLadder(CV_D.room.guests || null);
  const visit = keptPerGuest(CV_D);
  return (
    <section className={s.card} aria-label="Specials and deals">
      <div className={s.cardHead}>
        <h2 className={s.cardTitle}><Icon name="Gift" size={17} />Specials and deals</h2>
        <span className={s.cardSub}>Give guests a reason to order more and come back. Each guest visit leaves you about <b className={s.green}>{cents(visit)}</b> after food and staff.</span>
      </div>

      {list.map((dl) => {
        const econ = dealEconomics(CV_D, v.lab, dl);
        if (!econ) return null;
        const res = dealResults(CV_D, dl);
        return <DealRow key={dl.id} dl={dl} econ={econ} res={res} onLive={() => { update(dl.id, { status: 'live', liveAt: new Date().toISOString() }, `${econ.title}: live`); goLive(dl, econ); }}
          onEnd={() => update(dl.id, { status: 'ended' }, `${econ.title}: ended`)}
          onCount={(c) => update(dl.id, { counts: [...(dl.counts || []).filter((x) => x.week !== c.week), c].slice(-104) }, `${econ.title}: ${c.redeemed} redeemed this week`)} />;
      })}

      {!draft ? (
        <div className={s.kinds}>
          {Object.entries(DEAL_KINDS).map(([k, kd]) => (
            <button key={k} type="button" className={s.kind} onClick={() => setDraft(defaultsFor(k))}>
              <Icon name={kd.icon} size={18} /><b>{kd.label}</b><span>{kd.example}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className={s.builder}>
          <div className={s.builderForm}>
            <span className={s.over}><Icon name={DEAL_KINDS[draft.kind].icon} size={14} />{DEAL_KINDS[draft.kind].label}</span>
            {draft.kind === 'bundle' && (
              <>
                <label className={s.field}>Dish<select value={draft.dish} onChange={(x) => setDraft({ ...draft, dish: x.target.value })}>{CV_MENU.filter((m) => !m.balancing).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select></label>
                <label className={s.field}>Buy<select value={draft.buy} onChange={(x) => setDraft({ ...draft, buy: +x.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}, get 1 free</option>)}</select></label>
                <label className={s.field}>If this many of its guests take it<select value={draft.takeUp} onChange={(x) => setDraft({ ...draft, takeUp: +x.target.value })}>{[0.1, 0.25, 0.5].map((n) => <option key={n} value={n}>{Math.round(n * 100)}%</option>)}</select></label>
              </>
            )}
            {draft.kind !== 'bundle' && (
              <label className={s.field}>Free item<select value={draft.free} onChange={(x) => setDraft({ ...draft, free: x.target.value })}>{CV_MENU.filter((m) => !m.balancing).map((m) => <option key={m.key} value={m.key}>{m.name} ({cents(m.price)})</option>)}</select></label>
            )}
            {draft.kind === 'threshold' && (
              <>
                <label className={s.field}>Check of at least<span className={s.money}>$<input inputMode="decimal" value={draft.threshold} onChange={(x) => setDraft({ ...draft, threshold: +x.target.value || 0 })} /></span></label>
                <label className={s.field}>Checks a week at that size (your count)<input inputMode="numeric" value={draft.checks || ''} placeholder="e.g. 60" onChange={(x) => setDraft({ ...draft, checks: +x.target.value || 0 })} /></label>
              </>
            )}
            {draft.kind === 'comeback' && (
              <label className={s.field}>Good for<select value={draft.days} onChange={(x) => setDraft({ ...draft, days: +x.target.value })}>{[14, 30, 60].map((n) => <option key={n} value={n}>{n} days</option>)}</select></label>
            )}
          </div>
          {e && <DealMath e={e} />}
          <div className={s.builderActions}>
            <Button variant="secondary" icon="Check" onClick={() => save('live')}>Go live</Button>
            <Button variant="ghost" onClick={() => save('draft')}>Save as draft</Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className={s.ladder}>
        <span className={s.ladderHead}><Icon name="Repeat" size={15} />Coming back</span>
        {ladder ? (
          <div className={s.ladderSteps}>
            {ladder.map((st) => <span key={st.visit}><b>{st.guests.toLocaleString('en-US')}</b> {st.visit === 1 ? 'first visits' : st.visit === 2 ? 'came a 2nd time' : `came ${st.visit}+ times`}{st.onward != null ? <em>{Math.round(st.onward * 100)}% came back</em> : null}</span>)}
          </div>
        ) : (
          <span className={s.cardSub}>The goal is every first-time guest’s 3rd visit. Connect your Toast guest book or loyalty data and this shows how many guests come back a 2nd and 3rd time. Until then, a come-back offer’s card count tells you.</span>
        )}
      </div>
    </section>
  );
}

function DealMath({ e }) {
  const say = e.kind === 'bundle'
    ? (e.kept == null ? null : `Each free plate costs you ${cents(e.freeCost)} in food, while guests see ${cents(e.guestValue)} free. ${e.kept >= 0 ? `If ${Math.round(e.takeUp * 100)}% of its guests take it, it most likely keeps ${money(e.kept)} more a week${e.bad >= 0 ? ', even in a bad week.' : `, but a bad week loses ${money(-e.bad)}. Test it first.`}` : `At ${Math.round(e.takeUp * 100)}% take-up it most likely costs ${money(-e.kept)} a week; it works as a way to win new guests, not as a money maker.`}`)
    : e.kind === 'threshold'
      ? `Each free plate costs you ${cents(e.freeCost)} in food; guests see ${cents(e.guestValue)}.${e.checks ? ` At ${e.checks} checks a week it costs ${money(e.perWeek.foodCost)} a week, and pays for itself once guests add about ${money(e.spendUp)} a week reaching the line.` : ' Enter how many checks a week reach that size to see the weekly cost.'}`
      : `Each free plate costs you ${cents(e.freeCost)}; a return visit leaves you about ${cents(e.visit)}. It pays for itself if at least 1 in ${Math.max(1, Math.round(1 / e.newShare))} redemptions is a guest who wouldn’t have come back otherwise.`;
  return (
    <div className={s.dealMath}>
      <div className={s.dealNums}>
        <span><small>You pay</small><b>{cents(e.freeCost)}</b><small>food, per free plate</small></span>
        <span><small>Guests see</small><b className={s.green}>{cents(e.guestValue)}</b><small>free</small></span>
        {e.kind === 'bundle' && e.kept != null && <span><small>Most likely</small><b className={e.kept >= 0 ? s.green : s.red}>{money(e.kept, { sign: true })}</b><small>a week <Claim k="mod" /></small></span>}
        {e.kind === 'comeback' && <span><small>Each return visit</small><b className={s.green}>{cents(e.visit)}</b><small>kept</small></span>}
      </div>
      {say && <p className={s.maker}><span className={s.makerTag}><Icon name="Sparkles" size={14} />Menu Maker</span>{say}</p>}
    </div>
  );
}

function DealRow({ dl, econ, res, onLive, onEnd, onCount }) {
  const [n, setN] = React.useState('');
  const [g, setG] = React.useState('');
  const week = CV_D.hist.rows.at(-1)?.iso;
  const tone = dl.status === 'live' ? s.chip_good : dl.status === 'draft' ? s.chip_warn : '';
  return (
    <div className={s.dealRow}>
      <div className={s.changeName}>
        <b>{econ.title}</b>
        <span>
          <span className={`${s.chip} ${tone}`}>{dl.status === 'live' ? 'Live' : dl.status === 'draft' ? 'Draft' : 'Ended'}</span>
          {' '}You pay {cents(econ.freeCost)} a free plate; guests see {cents(econ.guestValue)}.
          {res && <> {res.redeemed} used in {res.weeks} {res.weeks === 1 ? 'week' : 'weeks'} · {money(res.food)} in food{res.returnRate != null ? ` · ${Math.round(res.returnRate * 100)}% of cards came back` : ''}{res.kept != null ? <> · up to <b className={res.kept >= 0 ? s.green : s.red}>{money(res.kept, { sign: true })}</b> kept, if those visits wouldn’t have happened</> : null}</>}
        </span>
      </div>
      <div className={s.dealActs}>
        {dl.status === 'draft' && <Button variant="secondary" size="sm" onClick={onLive}>Go live</Button>}
        {dl.status === 'live' && (
          <>
            <label className={s.countField}><span className="sr-only">Used this week</span><input inputMode="numeric" placeholder="Used" value={n} onChange={(x) => setN(x.target.value)} /></label>
            {dl.kind === 'comeback' && <label className={s.countField}><span className="sr-only">Cards handed out this week</span><input inputMode="numeric" placeholder="Handed out" value={g} onChange={(x) => setG(x.target.value)} /></label>}
            <Button variant="secondary" size="sm" disabled={!(+n >= 0 && n !== '') || !week} onClick={() => { onCount({ week, redeemed: Math.round(+n), ...(dl.kind === 'comeback' && g !== '' ? { given: Math.round(+g) } : {}) }); setN(''); setG(''); }}>Add this week</Button>
            <Button variant="ghost" size="sm" onClick={onEnd}>End</Button>
          </>
        )}
      </div>
    </div>
  );
}

function TrackRecord({ t }) {
  if (!t?.n) return <p className={s.trackNone}><Icon name="Info" size={15} />Once a few of your prices have changed, the Price Lab shows how close its predictions came.</p>;
  const pct0 = (x) => `${(x * 100).toFixed(1)}%`;
  return (
    <div className={s.track}>
      <span className={s.trackHead}><Icon name="BadgeCheck" size={16} />Price Lab track record</span>
      <div className={s.trackNums}>
        <span><b className={s.green}>{pct0(t.err)}</b> typical miss on plates sold</span>
        <span><b>{pct0(t.naiveErr)}</b> if you guess “same as last week”</span>
        <span><b className={s.green}>{Math.round(t.inside * 10)} in 10</b> landed inside our range</span>
      </div>
      <span className={s.trackNote}>We predicted {t.n} past price changes on {t.dishes} dishes from your other weeks only, then checked what really sold.</span>
    </div>
  );
}

function Balanced({ v, keepOrders, setKeep, onTry }) {
  const rows = v.all.filter((m) => m.kind === 'price');
  const round = new Set(v.moves.map((m) => m.id));
  const total = rows.filter((m) => m.ready && !m.done).reduce((t, m) => t + m.value, 0);
  return (
    <div className={`${s.detailBody} ${s.balanced}`}>
      <div className={s.balHead}>
        <p className={s.balLine}>Every ready change together: <b className={s.green}>{money(total, { sign: true })} a week</b>, most likely <Claim k="mod" /></p>
        <label className={s.balKeep}>Keep at least
          <select value={keepOrders} onChange={(e) => setKeep(+e.target.value)}>
            {[0.8, 0.85, 0.9, 0.95].map((k) => <option key={k} value={k}>{Math.round(k * 100)}%</option>)}
          </select>
          of each dish’s orders
        </label>
      </div>
      <div className="cv-tablewrap" tabIndex={0} role="group" aria-label="Balanced menu">
        <table className="cv-table">
          <thead><tr><th>Dish</th><th className="r">Now</th><th className="r">Best price</th><th className="r">Most likely</th><th className="r">Bad week</th><th className="r">Sales</th><th>When</th><th /></tr></thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td><b>{CV_MENU.find((d) => d.key === m.item)?.name}</b></td>
                <td className="r">{cents(m.from)}</td>
                <td className="r"><b>{cents(m.to)}</b></td>
                <td className={`r ${s.tdGood}`}>{money(m.value, { sign: true })}</td>
                <td className={`r ${m.lo >= 0 ? s.tdGood : s.tdWarn}`}>{money(m.lo, { sign: true })}</td>
                <td className="r">{money(m.sales, { sign: true })}</td>
                <td className="cv-xs">{m.done ? 'Done' : !m.ready ? 'Needs plate cost' : round.has(m.id) ? 'This round' : 'Next round'}</td>
                <td>{!m.done && <button type="button" className={s.textBtn} onClick={() => onTry(m)}>Try it</button>}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="cv-faint">No price change keeps money in a bad week right now. Your prices are balanced.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { CvMenu };
