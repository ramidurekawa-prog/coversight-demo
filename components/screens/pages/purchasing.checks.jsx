'use client';

/* Supplier prices · the food cost loop on invoices: what's leaking, the ask
   to the vendor (approved here, sent from the manager's own email), and the
   next invoice confirming it. Checks come from lib/data/page/purchasing.js;
   the server re-checks an approval (server/tasks.ts) and confirms it from the
   next invoice the room enters (verifyTasks). */

import * as React from 'react';
import { Button, Icon } from '../../kit';
import { engine, useEngine } from '../../engine';
import { useCv, cvMoney, CV_D, CV_ROOM, Claim, Pill } from '../core';
import { foodCostChecks, vendorAsk } from '../../../lib/data/page/purchasing.js';

const ICON = { price: 'Truck', pack: 'Package', unit: 'Ruler' };
const SHOW = 3;

function Ask({ check, task, primary }) {
  const cv = useCv();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const email = vendorAsk(check, { room: CV_ROOM.name, from: CV_ROOM.gm || 'Purchasing' });
  if (check.kind === 'unit') {
    return <Button size="sm" variant="secondary" icon="FilePen" onClick={() => cv.go('inputs', { kind: 'invoices' })}>Fix the unit on Data</Button>;
  }
  if (task?.status === 'verified') {
    const back = task.outcome?.backCents;
    return <Pill tone="good" icon="CircleCheck">Fixed on the invoice{back ? ` · about ${cvMoney(Math.round(back / 100))} back every 28 days` : ''}</Pill>;
  }
  const approve = async () => {
    setBusy(true);
    const t = await engine.createTask(check.approvalId, { title: check.title, system: 'Your vendor', diff: [] });
    setBusy(false);
    if (t) { setOpen(true); cv.toast(`Tracked. Send the email, then add ${check.vendor}’s next invoice on Data and Coversight checks it.`); }
  };
  return (
    <div className="cv-col" style={{ gap: 8, alignItems: 'flex-start' }}>
      {task
        ? <span className="cv-row nowrap" style={{ gap: 8 }}><Pill tone="warn" icon="Hourglass">Asked · waiting for the next invoice</Pill><button type="button" className="cv-link cv-small" onClick={() => setOpen((o) => !o)}>{open ? 'Hide the email' : 'See the email'}</button></span>
        : <Button size="sm" variant={primary ? 'primary' : 'secondary'} icon="Mail" disabled={busy} onClick={approve}>{busy ? 'One moment…' : `Ask ${check.vendor}`}</Button>}
      {open && email && (
        <div className="cv-col" style={{ gap: 8, width: '100%' }}>
          <pre className="cv-small" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, padding: 12, borderRadius: 8, background: 'var(--surface-sunken)' }}><b>{email.subject}</b>{'\n\n'}{email.body}</pre>
          <a className="btn btn-secondary btn-sm" href={`mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}><Icon name="Mail" size={14} /> Open in your email</a>
          <span className="cv-xs cv-faint">Coversight doesn’t have {check.vendor}’s address, so this opens in your own email to send.</span>
        </div>
      )}
    </div>
  );
}

/** The leaks on this room's invoices, biggest first, each with its ask and where it stands. */
export function InvoiceChecks() {
  const eng = useEngine();
  const [all, setAll] = React.useState(false);
  const checks = foodCostChecks(CV_D.room);
  const taskFor = (c) => (eng.tasks || []).find((t) => t.roomId === CV_D.id && t.approvalId === c.approvalId && t.status !== 'cancelled') ?? null;
  const total = checks.reduce((s, c) => s + (c.cents ?? 0), 0);
  const fixed = checks.filter((c) => taskFor(c)?.status === 'verified').length;
  const shown = all ? checks : checks.slice(0, SHOW);
  if (!checks.length) {
    return (
      <section className="cv-card" aria-labelledby="inv-checks">
        <span className="cv-h4" id="inv-checks"><Icon name="CircleCheck" size={18} style={{ color: 'var(--money-up)', verticalAlign: '-3px', marginRight: 6 }} />No leaks on these invoices</span>
        <span className="cv-small cv-muted">Every line is at or under its earlier price, with the same pack size. Coversight checks again when the next invoices come in.</span>
      </section>
    );
  }
  return (
    <section className="cv-card" aria-labelledby="inv-checks">
      <div className="cv-card-head" style={{ alignItems: 'flex-end' }}>
        <div className="cv-col" style={{ gap: 2 }}>
          <span className="cv-over">Money leaking on your invoices · last 28 days</span>
          <span className="cv-num" id="inv-checks" style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1, color: 'var(--money-down)' }}>{cvMoney(Math.round(total / 100))}</span>
          <span className="cv-small cv-muted">{checks.length} thing{checks.length === 1 ? '' : 's'} to ask about{fixed ? ` · ${fixed} already fixed` : ''}. Each ask is one email; the next invoice shows whether it worked.</span>
        </div>
        <Claim k="obs" label="From your invoices" />
      </div>
      {shown.map((c, i) => {
        const t = taskFor(c);
        return (
          <div key={c.id} className="cv-row nowrap" style={{ alignItems: 'flex-start', gap: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <span className={`cv-q-ico ${c.kind === 'unit' ? 'warn' : 'bad'}`}><Icon name={ICON[c.kind]} size={18} /></span>
            <div className="cv-col" style={{ gap: 6, flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 17 }}>{c.title}</span>
              <span className="cv-small cv-muted">{c.say}</span>
              <Ask check={c} task={t} primary={i === 0 && !t} />
            </div>
            <span className="cv-num" style={{ fontWeight: 700, fontSize: 20, color: c.cents ? 'var(--money-down)' : 'var(--fg-3)', whiteSpace: 'nowrap' }}>{c.cents ? cvMoney(Math.round(c.cents / 100)) : 'check first'}</span>
          </div>
        );
      })}
      {checks.length > SHOW && (
        <button type="button" className="cv-link cv-small" style={{ alignSelf: 'flex-start' }} onClick={() => setAll((a) => !a)}>{all ? 'Show the top 3' : `Show ${checks.length - SHOW} more`}</button>
      )}
      <span className="cv-xs cv-faint">Dollars are what you paid over the earlier price (or over your order guide, where you entered it) on the last 28 days of invoices. What a vendor gives back counts once the next invoice shows it, and it is never booked as verified savings.</span>
    </section>
  );
}
