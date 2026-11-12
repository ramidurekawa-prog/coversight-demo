'use client';

import * as React from 'react';

import { authClient } from '../../lib/client/auth';

/* Sign in, create an account, or try the sample. A new account (or a sample
   visitor) starts on its own private copy of the sample group, so every screen
   works at once; connecting Toast replaces it with the restaurant's own data. */

type Mode = 'in' | 'up' | 'reset';

export default function LoginPage() {
  const [mode, setMode] = React.useState<Mode>('in');
  const [form, setForm] = React.useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = React.useState<null | 'form' | 'sample'>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const next = () => {
    const n = new URLSearchParams(window.location.search).get('next');
    return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
  };
  const done = () => window.location.assign(next());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy('form');
    setError(null);
    if (mode === 'reset') {
      const r = await authClient.requestPasswordReset({ email: form.email.trim(), redirectTo: '/reset-password/' });
      setBusy(null);
      if (r.error) { setError(r.error.message ?? 'Couldn’t send the reset link. Try again.'); return; }
      setSent(true);
      return;
    }
    const res =
      mode === 'in'
        ? await authClient.signIn.email({ email: form.email.trim(), password: form.password })
        : await authClient.signUp.email({ email: form.email.trim(), password: form.password, name: form.name.trim() || form.email.trim() });
    setBusy(null);
    if (res.error) {
      setError(res.error.message ?? 'That didn’t work. Check the email and password.');
      return;
    }
    done();
  };

  const sample = async () => {
    if (busy) return;
    setBusy('sample');
    setError(null);
    const res = await authClient.signIn.anonymous();
    setBusy(null);
    if (res.error) {
      setError(res.error.message ?? 'Couldn’t start the sample. Try again.');
      return;
    }
    done();
  };

  const field = (key: keyof typeof form, label: string, type = 'text', auto?: string) => (
    <label className="cv-col" style={{ gap: 4 }}>
      <span className="cv-small" style={{ fontWeight: 600 }}>{label}</span>
      <input className="input" type={type} autoComplete={auto} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} required={key !== 'name'} minLength={key === 'password' ? 10 : undefined} />
    </label>
  );

  return (
    <main className="cv-login">
      <div className="cv-card cv-login-card">
        <div className="cv-col" style={{ gap: 4 }}>
          <span className="cv-over">Coversight</span>
          <h1 className="cv-h3" style={{ margin: 0 }}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset your password'}</h1>
          <span className="cv-small cv-muted">Your restaurants’ profit, found and proved.</span>
        </div>
        <form className="cv-col" style={{ gap: 12 }} onSubmit={submit}>
          {mode === 'up' && field('name', 'Your name', 'text', 'name')}
          {field('email', 'Email', 'email', 'email')}
          {mode !== 'reset' && field('password', 'Password', 'password', mode === 'in' ? 'current-password' : 'new-password')}
          {sent && <p className="cv-small" role="status" style={{ margin: 0 }}>If that email has an account, a reset link is on its way. It works for an hour.</p>}
          {error && <p className="cv-small" role="alert" style={{ color: 'var(--error-600)', margin: 0 }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={!!busy}>{busy === 'form' ? 'One moment…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Email me a reset link'}</button>
        </form>
        <button className="cv-link" type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}>
          {mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
        {mode === 'in' && <button className="cv-link" type="button" onClick={() => { setMode('reset'); setError(null); setSent(false); }}>Forgot your password?</button>}
        <div className="cv-login-sep"><span>or</span></div>
        <button className="btn btn-secondary" type="button" onClick={sample} disabled={!!busy}>
          {busy === 'sample' ? 'Setting up the sample…' : 'Try the sample restaurant group'}
        </button>
        <span className="cv-xs cv-faint">The sample is a private copy of a made-up three-room group. Nothing you change there is seen by anyone else.</span>
      </div>
    </main>
  );
}
