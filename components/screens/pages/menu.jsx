'use client';

/* Menu prices: does each plate earn what it should, and which price change
 * to make next. Answer first (headline and three numbers), then the one
 * recommended change, already picked, with the money it adds and the cost of
 * waiting, next to the Plate Map that shows why. Every dish, 52 weeks and the
 * method sit behind one click. Fixes happen here: a stale or estimated plate
 * cost is entered on this page, never on another one.
 * Every figure comes from lib/data/page/menu.js on the room's own data. */

import * as React from 'react';
import { Button, Icon } from '../../kit';
import { engine, useEngine, useSaved } from '../../engine';
import { useCv, cvMoney, CV_D, CV_DS, CV_ROOM, CV_MENU, Claim, cvScale } from '../core';
import { DenseMenu } from '../dense-sections';
import { CORNERS, WAIT_WEEKS, menuView, plateCostRows } from '../../../lib/data/page/menu';
import { explain, predict, reactionWord } from '../../../lib/data/page/menu-lab';
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
function Tester({ v, sel, setSel, onMore }) {
  const cv = useCv();
  const eng = useEngine();
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

  /* A change that isn't a price: a placement test, added to the plan as a task. */
  if (move && move.kind !== 'price') {
    const mid = move.taskId;
    const added = eng.tasks?.some((t) => t.roomId === CV_D.id && t.approvalId === mid && t.status !== 'cancelled');
    return (
      <section className={s.action} aria-label="Recommended change">
        <MoveChips v={v} sel={sel} setSel={setSel} onMore={onMore} />
        <h2 className={s.actionTitle}>{move.title}</h2>
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
      <MoveChips v={v} sel={sel} setSel={setSel} onMore={onMore} />
      <h2 className={s.actionTitle}>
        {changed ? <>{price > item.price ? 'Raise' : 'Lower'} the {item.name.toLowerCase()} from {cents(item.price)} to {cents(price)}</> : <>{item.name} at {cents(item.price)}</>}
      </h2>
      <div className={s.facts}>
        <span><b>{cents(item.cm)}</b> earned a plate</span>
        <span><b>{item.units}</b> plates a week</span>
        <span className={item.cost / item.price > 0.4 ? s.factWarn : undefined}><b>{pct(item.cost / item.price)}</b> of the price is food</span>
      </div>

      {!r ? (
        <p className={s.note}><Icon name="Ban" size={16} />{item.balancing ? 'This line rolls up sides and add-ons, so it has no single price to test.' : `We don’t have enough weeks on the ${item.name.toLowerCase()} yet. Change it on judgment, and we’ll measure what happens.`}</p>
      ) : (
        <>
          <div className={s.priceRow}>
            <span className={s.priceLbl}>New price</span>
            <div className={s.stepper}>
              <button type="button" className={s.stepBtn} onClick={() => step(-1)} aria-label="A step lower"><Icon name="Minus" size={16} /></button>
              <output className={s.priceOut} aria-live="polite">{cents(price)}</output>
              <button type="button" className={s.stepBtn} onClick={() => step(1)} aria-label="A step higher"><Icon name="Plus" size={16} /></button>
            </div>
            {recommended ? <span className={s.recTag}><Icon name="Sparkles" size={14} />Best price</span>
              : move?.kind === 'price' && move.item === item.key ? <button type="button" className={s.textBtn} onClick={() => setSel({ ...sel, price: move.to })}>Back to the best price ({cents(move.to)})</button> : null}
          </div>
          {changed && (
            <Gain value={r.kept} lo={r.bad} hi={r.good} claim={item.costEstimated ? 'est' : 'mod'}>
              <span>Sales <b>{money(r.sales, { sign: true })}</b> a week</span>
              <span>{plates > 0 ? <>About <b>{plates}</b> fewer {plates === 1 ? 'plate' : 'plates'} of {item.units}</> : plates < 0 ? <>About <b>{-plates}</b> more plates</> : 'About the same plates'}</span>
              {r.kept > 0 && !done && <span className={s.factGood}>Waiting {WAIT_WEEKS} weeks leaves about <b>{money(Math.round(r.kept) * WAIT_WEEKS)}</b> on the table</span>}
            </Gain>
          )}
        </>
      )}

      {needsCost ? (
        <div className={s.unlock}>
          <p className={s.unlockHead}><Icon name="Lock" size={16} />Check the plate cost first{unlock ? <>, then this change is ready</> : null}.</p>
          <CostFix dish={item} unlocks={unlock?.value} compact />
        </div>
      ) : (
        <div className={s.ctaRow}>
          {done ? <>
            <span className={s.doneMark}><Icon name="CircleCheck" size={18} />Approved. The steps are on Today, and the test starts when guests pay the new price.</span>
            {v.pick && <Button variant="secondary" iconRight="ArrowRight" onClick={() => setSel({ move: v.pick.id, dish: v.pick.item || sel.dish, price: v.pick.to ?? sel.price })}>Next: {CV_MENU.find((d) => d.key === v.pick.item)?.name || 'menu placement'} +{money(v.pick.value)}/wk</Button>}
          </>
            : <Button icon="Check" className={s.cta} disabled={!changed || over || !r || r.kept <= 0} onClick={() => cv.approve(id)}>Review this change</Button>}
          {!done && changed && r && r.kept > 0 && !over && <span className={s.ctaNote}>Tested for 6 weeks before anything counts.</span>}
        </div>
      )}
      {say && <p className={s.maker}><span className={s.makerTag}><Icon name="Sparkles" size={14} />Menu Maker</span>{say}</p>}
      {r && changed && (r.bad < 0 && r.kept > 0 || wide || over) && (
        <div className={s.notes}>
          {r.bad < 0 && r.kept > 0 && <p className={s.note}><Icon name="TriangleAlert" size={16} />Uncertain: the bad case loses money. A test settles it before anything is counted.</p>}
          {wide && <p className={s.note}><Icon name="TriangleAlert" size={16} />Guests’ reaction to this dish is loosely measured, so expect a wide result and a longer test.</p>}
          {over && <p className={s.note}><Icon name="Fence" size={16} />That’s past your {v.fence}% limit for one price change. Pick a smaller step.</p>}
        </div>
      )}
    </section>
  );
}

function Gain({ value, lo, hi, claim, children }) {
  const up = value >= 0;
  return (
    <div className={s.gain}>
      <div className={s.gainMain}>
        <span className={up ? s.gainBig : s.lossBig}>{money(value, { sign: true })}</span>
        <span className={s.gainUnit}>a week, most likely</span>
        <Claim k={claim} />
      </div>
      {Number.isFinite(lo) && Number.isFinite(hi) && (
        <div className={s.cases} title="8 in 10 weeks land between these. Potential until a test proves it.">
          <span className={hi >= 0 ? s.caseGood : s.caseBad}><Icon name="TrendingUp" size={15} />Good week <b>{money(hi, { sign: true })}</b></span>
          <span className={lo >= 0 ? s.caseGood : s.caseBad}><Icon name="TrendingDown" size={15} />Bad week <b>{money(lo, { sign: true })}</b></span>
        </div>
      )}
      {children && <div className={s.facts}>{children}</div>}
    </div>
  );
}

function MoveChips({ v, sel, setSel, onMore }) {
  if (!v.moves.length) return <span className={s.over}><Icon name="Sparkles" size={14} />Try a price on any dish</span>;
  const sorted = [...v.moves].sort((a, b) => Number(b.ready) - Number(a.ready));
  const shown = sorted.filter((m, i) => i < 3 || m.id === sel.move);
  const more = v.moves.length + v.later.length - shown.length;
  return (
    <div className={s.chips} role="radiogroup" aria-label="Changes we found">
      {shown.map((m, i) => {
        const on = sel.move === m.id;
        const dish = m.item ? CV_MENU.find((d) => d.key === m.item) : null;
        return (
          <button key={m.id} type="button" role="radio" aria-checked={on} className={`${s.moveChip} ${on ? s.moveChipOn : ''}`}
            onClick={() => setSel({ move: m.id, dish: m.item || sel.dish, price: m.to ?? (dish?.price ?? sel.price) })}>
            {m.done ? <Icon name="CircleCheck" size={15} className={s.icGood} /> : !m.ready ? <Icon name="Lock" size={15} /> : i === 0 || m.id === v.pick?.id ? <Icon name="Sparkles" size={15} /> : null}
            <span>{dish ? dish.name : 'Menu placement'}</span>
            <b className={s.chipMoney}>+{money(m.value)}</b>
          </button>
        );
      })}
      {more > 0 && <button type="button" className={s.moreChip} onClick={onMore}>+{more} more</button>}
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

  return (
    <div className={`cv-page wide ${s.page}`}>
      {/* 1 · How is the menu doing? */}
      <header className={s.head}>
        <div className={s.statusRow}>
          <span className={`${s.chip} ${s[st.cls]}`}><Icon name={st.icon} size={14} />{st.label}</span>
          <span className={s.context}>Menu prices · {CV_ROOM.name} · week of {v.period} · {v.dishes} dishes</span>
        </div>
        <h1 className={s.headline}>{v.headline}</h1>
        <div className={s.lines}>
          {v.good && <span className={s.lineGood}><Icon name="Trophy" size={16} />{v.good}</span>}
          {v.bad && <span className={s.lineWarn}><Icon name="TriangleAlert" size={16} />{v.bad}</span>}
        </div>
      </header>

      <div className={s.kpis}>
        <div className={s.kpi}>
          <span className={s.kpiLbl}>Each plate leaves you</span>
          <span className={s.kpiBig}>{cents(v.weeks.wcm)}</span>
          {v.weeks.beat >= v.weeks.of / 2
            ? <span className={s.kpiGood}><Icon name="TrendingUp" size={15} />Better than {v.weeks.beat} of your last {v.weeks.of} weeks{v.weeks.streak >= 2 ? ` · ${v.weeks.streak} weeks above usual` : ''}</span>
            : <span className={s.kpiSub}>Your usual week: {cents(v.weeks.avg)} a plate</span>}
        </div>
        <div className={s.kpi}>
          <span className={s.kpiLbl}>Food cost, share of sales</span>
          <span className={s.kpiBig}>{v.food ? pct(v.food.now, 1) : '—'}</span>
          {v.food && <span className={v.food.now <= v.food.then ? s.kpiGood : v.food.status === 'good' ? s.kpiSub : s.kpiWarn}>
            <Icon name={v.food.now <= v.food.then ? 'TrendingDown' : 'TrendingUp'} size={15} />{v.food.now <= v.food.then ? 'Lower' : 'Higher'} than {v.food.vs.toLowerCase()} ({pct(v.food.then, 1)})
          </span>}
        </div>
        <div className={`${s.kpi} ${nowWins ? s.kpiWin : ''}`}>
          {nowWins ? (
            <>
              <span className={s.kpiLbl}>Kept by your menu changes</span>
              <span className={`${s.kpiBig} ${s.green}`}>{money(v.bankedWeek)}<small>/wk</small></span>
              <span className={s.kpiGood}><Icon name="BadgeCheck" size={15} />Verified · {v.banked.length} {v.banked.length === 1 ? 'change' : 'changes'}</span>
            </>
          ) : (
            <>
              <span className={s.kpiLbl}>Your menu plan</span>
              <span className={s.kpiBig}>{v.progress.done}<small> of {v.progress.of} done</small></span>
              <span className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={v.progress.of} aria-valuenow={v.progress.done} aria-label="Menu changes made"><i style={{ width: `${Math.max(progressPct * 100, 3)}%` }} /></span>
              <span className={s.kpiGood}>
                {v.doneSum > 0 && <>{money(v.doneSum)}/wk on its way · </>}
                {v.openSum > 0 ? <>{money(v.openSum)}/wk potential to go</> : v.progress.of ? 'All done. Results come back here.' : 'Nothing waiting'}
                {(v.doneSum > 0 || v.openSum > 0) && <Claim k="mod" />}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 2 · The one thing to do, and 3 · why */}
      <div className={s.main}>
        <Tester key={`${sel.move}-${sel.dish}`} v={v} sel={sel} setSel={setSel} onMore={() => { setOpen('balanced'); setTimeout(() => document.getElementById('menu-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
        <section className={s.card} aria-label="Plate Map">
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}>Plate Map</h2>
            <span className={s.cardSub}>Every dish: how much it sells, what each plate earns. Tap one to try a price.</span>
          </div>
          <PlateMap v={v} sel={sel.dish} onSel={pickDish} />
          <div className={s.legend}>
            <span><i className={s.lgGood} />Earns more than your average plate ({cents(v.cmWeighted)})</span>
            <span><i className={s.lgDash} />Price never tested</span>
            <Claim k="obs" />
          </div>
          <TrackRecord t={v.track} />
        </section>
      </div>

      {/* Fix it here: costs the changes rest on */}
      {fixes.length > 0 && (
        <section className={s.fixCard} aria-label="Fix plate costs">
          <div className={s.cardHead}>
            <h2 className={s.cardTitle}><Icon name="Lock" size={17} />{v.waitingSum > 0 ? <>Unlock <span className={s.green}>{money(v.waitingSum)}/wk</span> more</> : 'Check these plate costs'}</h2>
            <span className={s.cardSub}>Type what one plate costs you to make. Every margin on this page updates.</span>
          </div>
          {fixes.slice(0, 4).map((d) => <CostFix key={`${d.key}-${d.cost}`} dish={d} unlocks={firstWaiting(d.key)} />)}
          {fixes.length > 4 && <p className={s.cardSub}>{fixes.length - 4} more dishes in “Every dish” below.</p>}
        </section>
      )}

      {/* 4 · The detail, behind one click */}
      <section className={s.detail} id="menu-detail">
        <div className={s.detailTabs} role="tablist" aria-label="Menu detail">
          {[['balanced', `Balanced menu (${v.all.filter((m) => m.kind === 'price').length})`, 'Sparkles'], ['dishes', `Every dish (${v.dishes})`, 'LayoutList'], ['weeks', '52 weeks', 'ChartLine'], ['how', 'How we work it out', 'Calculator']].map(([k, label, icon]) => (
            <button key={k} type="button" role="tab" aria-selected={open === k} className={`${s.detailTab} ${open === k ? s.detailTabOn : ''}`} onClick={() => setOpen(open === k ? null : k)}>
              <Icon name={icon} size={16} />{label}<Icon name={open === k ? 'ChevronUp' : 'ChevronDown'} size={15} />
            </button>
          ))}
          <span className={s.mixNote}>
            {v.weeks.slide > 0.4
              ? <><Icon name="Shuffle" size={15} />Each plate earns {cents(v.weeks.slide)} less than 13 weeks ago while costs held: guests are picking dishes that earn less. Placement helps more than price.</>
              : <><Icon name="Flame" size={15} />Hottest plate: {v.high[0] ? `${v.high[0].name}, ${pct(v.high[0].foodRate ?? v.high[0].cost / v.high[0].price)} food` : 'none over 40% food'}.</>}
          </span>
        </div>
        {open === 'balanced' && <Balanced v={v} keepOrders={keepOrders} setKeep={(k) => setLabSet({ keepOrders: k }, `Balanced menu keeps at least ${Math.round(k * 100)}% of each dish's orders`)} onTry={(m) => { setSel({ move: m.id, dish: m.item, price: m.to }); document.querySelector(`.${s.action}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />}
        {open === 'dishes' && <DishTable v={v} sel={sel.dish} onSel={(k) => { pickDish(k); document.querySelector(`.${s.action}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} />}
        {open === 'weeks' && <div className={s.detailBody}><DenseMenu /></div>}
        {open === 'how' && (
          <div className={`${s.detailBody} ${s.how}`}>
            <p><b>Earns per plate</b> is the price minus what the plate costs to make. The line on the Plate Map is your average plate, weighted by how many of each you sell.</p>
            <p><b>How guests react to a price</b> is learned from your own weeks: what each dish sold at each price, with the week’s guest count taken out so a busy week isn’t read as a price effect. A dish with little history leans on how your whole menu reacts, never on a made-up number. Every new week and every finished test sharpens it.</p>
            <p><b>Switching:</b> some guests who skip a dish after a price rise order another one instead. We measure how often that happens on your menu and count it only inside its range.</p>
            <p><b>Good week and bad week</b> are the edges of the range 8 in 10 weeks land in. The track record checks that range against your real past price changes.</p>
            <p><b>Balanced menu</b> tries every price inside your {v.fence}% limit for each dish and keeps the one that leaves the most money, only when even the bad week doesn’t lose money and the dish keeps at least {Math.round(v.keepOrders * 100)}% of its orders. Changes go out {v.all.length > 5 ? 'five at a time' : 'together'}, one menu update each round.</p>
            <p><b>Potential</b> money is a model until a test proves it. A change is tested for 6 weeks against dishes whose price didn’t move; only the low end of a verified result is ever counted.</p>
            <p><b>Sides and add-ons</b> is whatever the {v.dishes - 1} named dishes don’t cover in this week’s sales and food cost, so these totals always match what you earned.</p>
            <p className={s.cardSub}>Unmarked numbers come from your own restaurant’s data{CV_D.room.fromToast ? `: Toast through ${CV_D.room.fromToast.end}` : ''}.</p>
          </div>
        )}
      </section>
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
