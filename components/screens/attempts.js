// The latest save attempt per room and input, kept in this browser. A save
// that fails never reaches the server's record, so this is how Data can say
// "latest attempt 3:12 pm didn't save" next to the last data that did.
// Storage can be unavailable (private window, blocked site data): it then
// lasts for this page load only.
const KEY = 'cv-input-attempts';
const memory = {};

function readAll() {
  try { return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {}; } catch { return memory; }
}

/** @returns {Record<string, { at: string, ok: boolean, error?: string, rows?: number }>} */
export function readAttempts(room) {
  return readAll()[room] || memory[room] || {};
}

/** @param {{ at: string, ok: boolean, error?: string, rows?: number }} rec */
export function recordAttempt(room, kind, rec) {
  memory[room] = { ...(memory[room] || {}), [kind]: rec };
  try {
    const all = readAll();
    all[room] = { ...(all[room] || {}), [kind]: rec };
    window.localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* kept in memory */ }
}

/* Unsaved rows, per room and input, so a failed save (or a reload) never loses corrections. */
const DRAFT = 'cv-input-draft';
/** @returns {{ at: string, mode: string, rows?: any[], csv?: string, ctx?: string|null } | null} */
export function readDraft(room, kind) {
  try { return JSON.parse(window.localStorage.getItem(`${DRAFT}:${room}:${kind}`) || 'null'); } catch { return memory[`draft:${room}:${kind}`] || null; }
}
export function saveDraft(room, kind, draft) {
  memory[`draft:${room}:${kind}`] = draft;
  try { if (draft) window.localStorage.setItem(`${DRAFT}:${room}:${kind}`, JSON.stringify(draft)); else window.localStorage.removeItem(`${DRAFT}:${room}:${kind}`); } catch { /* kept in memory */ }
}
