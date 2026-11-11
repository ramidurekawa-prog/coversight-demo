'use client';

import * as React from 'react';

import { Button, Icon } from '../kit';
import { CV_LOCS, Callout, PageHead, Pill, useCv } from './core';
import { useEngine } from '../engine';

/* Team & groups: which groups you belong to (and switching), starting your own
 * group, the people in this one, invite links, roles and rooms. */

const ROLE = { owner: 'Owner', admin: 'Admin', gm: 'GM' };
const inputStyle = { height: 32, padding: '0 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg-1)', font: 'inherit', fontSize: 'var(--text-sm)' };

async function call(path, body) {
  const res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

function RoomPicks({ value, onChange }) {
  const rooms = CV_LOCS.filter((l) => l.id !== 'all');
  return (
    <span className="cv-row" style={{ gap: 6, flexWrap: 'wrap' }}>
      {rooms.map((r) => (
        <label key={r.id} className="cv-row nowrap cv-small" style={{ gap: 4 }}>
          <input type="checkbox" checked={value.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} />{r.short}
        </label>
      ))}
    </span>
  );
}

function Groups() {
  const eng = useEngine();
  const [orgs, setOrgs] = React.useState(null);
  const [form, setForm] = React.useState({ name: '', rooms: [{ name: '', seats: 80 }] });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  React.useEffect(() => { call('/api/orgs').then(setOrgs).catch((e) => setErr(e.message)); }, []);
  const go = async (orgId) => { await call('/api/orgs/switch', { orgId }); window.location.assign('/'); };
  const create = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await call('/api/orgs', { name: form.name, rooms: form.rooms.map((r) => ({ name: r.name, seats: Number(r.seats) || 1 })) });
      window.location.assign('/inputs/');
    } catch (x) { setErr(x.message); setBusy(false); }
  };
  const setRoom = (i, k, v) => setForm({ ...form, rooms: form.rooms.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  return (
    <section className="cv-card" aria-labelledby="groups-head">
      <div className="cv-card-head"><span className="cv-h4" id="groups-head">Your groups</span></div>
      {!orgs ? <span className="cv-small cv-muted">Loading…</span> : (
        <div className="cv-col" style={{ gap: 0 }}>
          {orgs.orgs.map((o) => (
            <div key={o.id} className="cv-row nowrap" style={{ gap: 10, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <Icon name={o.sample ? 'FlaskConical' : 'Building2'} size={16} />
              <span className="cv-small" style={{ flex: 1, fontWeight: o.id === orgs.current ? 700 : 400 }}>{o.name}</span>
              <Pill>{ROLE[o.role]}</Pill>
              {o.id === orgs.current ? <Pill tone="good" icon="Check">Viewing</Pill> : <Button size="sm" variant="secondary" onClick={() => go(o.id)}>Switch</Button>}
            </div>
          ))}
        </div>
      )}
      {eng.viewer?.anonymous ? (
        <Callout icon="Lock">Create an account (sign out, then “Create an account”) to start your own group. Sample guests can’t.</Callout>
      ) : (
        <form className="cv-col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }} onSubmit={create}>
          <span className="cv-small" style={{ fontWeight: 600 }}>Start your own group</span>
          <span className="cv-xs cv-faint">Each room starts on sample numbers so every page works today, labelled as such; loading its Toast exports on Data inputs replaces them with its own.</span>
          <input style={inputStyle} placeholder="Group name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} maxLength={80} aria-label="Group name" />
          {form.rooms.map((r, i) => (
            <span key={i} className="cv-row nowrap" style={{ gap: 8 }}>
              <input style={{ ...inputStyle, flex: 1 }} placeholder={`Room ${i + 1} name`} value={r.name} onChange={(e) => setRoom(i, 'name', e.target.value)} required maxLength={60} aria-label={`Room ${i + 1} name`} />
              <input style={{ ...inputStyle, width: 90 }} type="number" min={1} max={2000} value={r.seats} onChange={(e) => setRoom(i, 'seats', e.target.value)} aria-label={`Room ${i + 1} seats`} />
              <span className="cv-xs cv-faint">seats</span>
              {form.rooms.length > 1 && <Button size="sm" variant="ghost" icon="Trash2" aria-label={`Remove room ${i + 1}`} onClick={() => setForm({ ...form, rooms: form.rooms.filter((_, j) => j !== i) })} />}
            </span>
          ))}
          <span className="cv-row" style={{ gap: 8 }}>
            {form.rooms.length < 12 && <Button size="sm" variant="ghost" icon="Plus" onClick={() => setForm({ ...form, rooms: [...form.rooms, { name: '', seats: 80 }] })}>Add a room</Button>}
            <Button size="sm" icon="Check" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create the group'}</Button>
          </span>
        </form>
      )}
      {err && <Callout tone="warn" icon="CircleX">{err}</Callout>}
    </section>
  );
}

function People() {
  const cv = useCv();
  const [team, setTeam] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [inv, setInv] = React.useState({ role: 'gm', rooms: [], email: '' });
  const [link, setLink] = React.useState(null);
  const [edit, setEdit] = React.useState(null);
  const load = React.useCallback(() => call('/api/team').then(setTeam).catch((e) => setErr(e.message)), []);
  React.useEffect(() => { load(); }, [load]);
  const can = team && team.role !== 'gm';
  const run = (p) => p.then((t) => { if (t.people) setTeam((x) => ({ ...x, ...t })); setErr(null); return t; }).catch((e) => { setErr(e.message); return null; });
  const invite = async (e) => {
    e.preventDefault();
    const r = await run(call('/api/team/invites', { role: inv.role, rooms: inv.role === 'gm' ? inv.rooms : null, email: inv.email.trim() || null }));
    if (r?.link) { setLink(new URL(r.link, window.location.origin).toString()); setInv({ role: 'gm', rooms: [], email: '' }); }
  };
  const roomName = (id) => CV_LOCS.find((l) => l.id === id)?.short || id;
  if (!team) return <section className="cv-card"><span className="cv-small cv-muted">{err || 'Loading…'}</span></section>;
  return (
    <section className="cv-card" aria-labelledby="people-head">
      <div className="cv-card-head"><span className="cv-h4" id="people-head">People in this group</span><Pill icon="Users">{team.people.length}</Pill></div>
      <div className="cv-col" style={{ gap: 0 }}>
        {team.people.map((p) => (
          <div key={p.userId} className="cv-col" style={{ gap: 6, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div className="cv-row nowrap" style={{ gap: 10 }}>
              <span className="cv-col" style={{ gap: 2, flex: 1 }}>
                <span className="cv-small" style={{ fontWeight: 600 }}>{p.guest ? 'Sample guest' : p.name}{p.you ? ' (you)' : ''}</span>
                <span className="cv-xs cv-faint">{p.email || '—'}{p.role === 'gm' && p.rooms ? ` · ${p.rooms.map(roomName).join(', ')}` : ''}</span>
              </span>
              <Pill>{ROLE[p.role]}</Pill>
              {can && !p.you && <Button size="sm" variant="ghost" icon="Pencil" onClick={() => setEdit(edit?.userId === p.userId ? null : { userId: p.userId, role: p.role, rooms: p.rooms || [] })}>Change</Button>}
              {p.you && team.people.length > 1 && <Button size="sm" variant="ghost" onClick={async () => { const r = await run(call(`/api/team/members/${p.userId}/remove`, {})); if (r?.left) window.location.assign('/'); }}>Leave</Button>}
            </div>
            {edit?.userId === p.userId && (
              <div className="cv-row" style={{ gap: 8, paddingLeft: 4 }}>
                <select style={inputStyle} value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })} aria-label="Role">
                  {Object.entries(ROLE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {edit.role === 'gm' && <RoomPicks value={edit.rooms} onChange={(rooms) => setEdit({ ...edit, rooms })} />}
                <Button size="sm" icon="Check" onClick={async () => { if (await run(call(`/api/team/members/${p.userId}`, { role: edit.role, rooms: edit.role === 'gm' ? edit.rooms : null }))) { setEdit(null); cv.toast('Role saved.'); } }}>Save</Button>
                <Button size="sm" variant="ghost" icon="Trash2" onClick={async () => { if (await run(call(`/api/team/members/${p.userId}/remove`, {}))) { setEdit(null); cv.toast('Removed from the group. Their login stays.'); } }}>Remove from group</Button>
              </div>
            )}
          </div>
        ))}
      </div>
      {can && (
        <>
          {team.invites.length > 0 && (
            <div className="cv-col" style={{ gap: 4 }}>
              <span className="cv-over">Open invites</span>
              {team.invites.map((i) => (
                <div key={i.id} className="cv-row nowrap" style={{ gap: 8 }}>
                  <span className="cv-small" style={{ flex: 1 }}>{ROLE[i.role]}{i.rooms ? ` · ${i.rooms.map(roomName).join(', ')}` : ''}{i.email ? ` · ${i.email}` : ''} <span className="cv-xs cv-faint">expires {new Date(i.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></span>
                  <Button size="sm" variant="ghost" onClick={() => run(call(`/api/team/invites/${i.id}/revoke`, {}))}>Revoke</Button>
                </div>
              ))}
            </div>
          )}
          <form className="cv-col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }} onSubmit={invite}>
            <span className="cv-small" style={{ fontWeight: 600 }}>Invite someone</span>
            <span className="cv-row" style={{ gap: 8 }}>
              <select style={inputStyle} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })} aria-label="Invite role">
                <option value="gm">GM (their rooms only)</option><option value="admin">Admin (every room)</option>{team.role === 'owner' && <option value="owner">Owner</option>}
              </select>
              <input style={{ ...inputStyle, flex: 1, minWidth: 180 }} type="email" placeholder="Email (optional: we email the link)" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} aria-label="Invite email" />
            </span>
            {inv.role === 'gm' && <RoomPicks value={inv.rooms} onChange={(rooms) => setInv({ ...inv, rooms })} />}
            <span><Button size="sm" icon="UserPlus" type="submit" disabled={inv.role === 'gm' && !inv.rooms.length}>Create invite link</Button></span>
          </form>
          {link && (
            <Callout tone="good" icon="Link">
              <span className="cv-col" style={{ gap: 6 }}>
                <span>Send this link. It works once and expires in 14 days; it won’t be shown again.</span>
                <span className="cv-row nowrap" style={{ gap: 6 }}>
                  <input readOnly style={{ ...inputStyle, flex: 1 }} value={link} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                  <Button size="sm" variant="secondary" icon="Copy" onClick={() => { try { navigator.clipboard.writeText(link); cv.toast('Link copied.'); } catch { /* select it instead */ } }}>Copy</Button>
                </span>
              </span>
            </Callout>
          )}
        </>
      )}
      {err && <Callout tone="warn" icon="CircleX">{err}</Callout>}
    </section>
  );
}

function CvTeam() {
  const eng = useEngine();
  return (
    <div className="cv-page">
      <PageHead over="Team & groups" q="Who can see what?"
        sub="Owners and admins see every room and can change settings. A GM sees only their rooms. Invite by link; change anyone's role or rooms here." />
      {eng.mode !== 'server' ? (
        <Callout icon="Info">Accounts and invites need the server. This preview is running in your browser only.</Callout>
      ) : (
        <div className="cv-grid g2" style={{ alignItems: 'start' }}>
          <People />
          <Groups />
        </div>
      )}
    </div>
  );
}

export { CvTeam };
