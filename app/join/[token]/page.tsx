'use client';

import { useParams } from 'next/navigation';
import * as React from 'react';

import { authClient } from '../../../lib/client/auth';

/* An invite link: what it's for, then join (signed in) or sign in first. */
type Peek = { org: string; role: 'owner' | 'gm' | 'admin'; rooms: string[] | null };
const ROLE = { owner: 'an owner', admin: 'an admin (every room)', gm: 'a GM' };

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const [peek, setPeek] = React.useState<Peek | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [who, setWho] = React.useState<{ anonymous: boolean } | null | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    fetch(`/api/invites/${encodeURIComponent(token)}`).then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (r.ok) setPeek(b.invite); else setErr(b.error || 'This invite link has expired or was already used.');
    });
    authClient.getSession().then((s) => setWho(s.data ? { anonymous: !!(s.data.user as { isAnonymous?: boolean }).isAnonymous } : null));
  }, [token]);
  const join = async () => {
    setBusy(true);
    const r = await fetch('/api/invites/accept', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok) window.location.assign('/');
    else { setErr(b.error || 'Couldn’t join.'); setBusy(false); }
  };
  const here = `/join/${token}/`;
  return (
    <main className="cv-login">
      <div className="cv-card cv-login-card">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-over">Coversight</span>
          <h1 className="cv-h3" style={{ margin: 0 }}>{peek ? `Join ${peek.org}` : 'Invite'}</h1>
          {peek && <span className="cv-small cv-muted">You’re invited as {ROLE[peek.role]}{peek.role === 'gm' && peek.rooms ? ` for ${peek.rooms.length} room${peek.rooms.length === 1 ? '' : 's'}` : ''}.</span>}
        </div>
        {err && <p className="cv-small" role="alert" style={{ margin: 0 }}>{err}</p>}
        {peek && who === null && (
          <a className="btn btn-primary" href={`/login/?next=${encodeURIComponent(here)}`}>Sign in or create an account to join</a>
        )}
        {peek && who?.anonymous && (
          <p className="cv-small" style={{ margin: 0 }}>You’re browsing the sample as a guest. <button className="cv-link" type="button" onClick={async () => { await authClient.signOut(); window.location.assign(`/login/?next=${encodeURIComponent(here)}`); }}>Sign out and create an account</button> to join.</p>
        )}
        {peek && who && !who.anonymous && (
          <button className="btn btn-primary" type="button" disabled={busy} onClick={join}>{busy ? 'Joining…' : `Join ${peek.org}`}</button>
        )}
      </div>
    </main>
  );
}
