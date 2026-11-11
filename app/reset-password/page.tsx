'use client';

import * as React from 'react';

import { authClient } from '../../lib/client/auth';

/* Better Auth sends people here from the reset email with ?token=… (or ?error=INVALID_TOKEN). */
export default function ResetPasswordPage() {
  const [pw, setPw] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [bad, setBad] = React.useState(false);
  React.useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setToken(q.get('token'));
    setBad(!!q.get('error') || !q.get('token'));
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    const r = await authClient.resetPassword({ newPassword: pw, token });
    setBusy(false);
    setMsg(r.error ? { ok: false, text: r.error.message ?? 'That link didn’t work. Ask for a new one.' } : { ok: true, text: 'Password changed. Sign in with the new one.' });
  };
  return (
    <main className="cv-login">
      <div className="cv-card cv-login-card">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-over">Coversight</span>
          <h1 className="cv-h3" style={{ margin: 0 }}>Choose a new password</h1>
        </div>
        {bad ? (
          <p className="cv-small" role="alert" style={{ margin: 0 }}>This reset link has expired or was already used. <a className="cv-link" href="/login/">Ask for a new one</a>.</p>
        ) : msg?.ok ? (
          <p className="cv-small" role="status" style={{ margin: 0 }}>{msg.text} <a className="cv-link" href="/login/">Sign in</a></p>
        ) : (
          <form className="cv-col" style={{ gap: 12 }} onSubmit={submit}>
            <label className="cv-col" style={{ gap: 4 }}>
              <span className="cv-small" style={{ fontWeight: 600 }}>New password (10+ characters)</span>
              <input className="input" type="password" autoComplete="new-password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} />
            </label>
            {msg && <p className="cv-small" role="alert" style={{ color: 'var(--error-600)', margin: 0 }}>{msg.text}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'One moment…' : 'Set the new password'}</button>
          </form>
        )}
      </div>
    </main>
  );
}
