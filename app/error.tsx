'use client';

import { engine } from '../components/engine';

/* Last line of defence: if a screen throws, offer a one-click reset instead of
 * a dead page. Clears the viewer's saved demo data and reloads. */
export default function DemoError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ maxWidth: 520, margin: '15vh auto', padding: 24, fontFamily: 'var(--font-sans)', color: 'var(--fg-1)' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>This screen hit a problem</h1>
      <p style={{ color: 'var(--fg-2)', lineHeight: 1.5 }}>
        Usually it&apos;s demo data saved in this browser from an older version. Resetting puts the sample restaurant group back; nothing else is affected.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => {
          engine.hardReset();
          reset();
          window.location.reload();
        }}
      >
        Reset the demo
      </button>
    </main>
  );
}
