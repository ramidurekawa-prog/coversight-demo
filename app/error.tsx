'use client';

import { engine } from '../components/engine';

/* Last line of defence: if a screen throws, offer to try again first, then a
 * one-click reset instead of a dead page. Reset clears the viewer's saved demo
 * data and reloads. */
export default function DemoError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="cv-error" role="alert">
      <div className="cv-error-card">
        <span className="cv-error-ico" aria-hidden="true">!</span>
        <h1>This page didn&apos;t load</h1>
        <p>
          Nothing you saved is lost. Try again first. If it keeps happening, it&apos;s usually demo data saved in this browser
          from an older version: resetting puts the sample restaurant group back, and nothing else is affected.
        </p>
        <div className="cv-error-acts">
          <button type="button" className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              engine.hardReset();
              reset();
              window.location.reload();
            }}
          >
            Reset the demo
          </button>
        </div>
      </div>
    </main>
  );
}
