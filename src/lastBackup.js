// When this phone last sent a backup out — an app-day, not a secret, not data.
// It lives in its own localStorage key, outside the root, so it never rides in
// a backup or a recovery dump and never touches an attempt. Settings reads it to
// say how long it has been, and nothing is ever judged from it.
//
// Every touch of localStorage is guarded twice, the same way proxyConfig.js
// guards the device token: reaching the property can throw on its own (Safari
// with site data blocked) and so can each method (private mode, full quota).
// Either way the day still holds for this session — it just won't survive a
// reload. Never a crash.
//
// No React in this file on purpose: components read it and subscribe to it, and
// tests use it without a renderer.

export const LAST_BACKUP_KEY = 'pouch-down-last-backup';

// Only an app-day ever goes in or comes out, so a stray value in storage (or a
// Date handed in by mistake) reads as "no backup yet" rather than as nonsense.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

let current = '';
let loaded = false;
const listeners = new Set();

function store() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// → the app-day of the last backup, or '' when none has gone out. Reads storage
// once, on first ask, so no caller has to remember an init step. Unlike the
// device token, '' is a real answer here, so a flag — not an empty memory —
// says whether storage has been read.
export function getLastBackup() {
  if (!loaded) {
    loaded = true;
    try {
      current = store()?.getItem(LAST_BACKUP_KEY) ?? '';
    } catch {
      current = '';
    }
    if (!DAY.test(current)) current = '';
  }
  return current;
}

// Record (or, with anything that isn't a day, forget) the last backup and tell
// everyone watching.
export function setLastBackup(day) {
  current = typeof day === 'string' && DAY.test(day) ? day : '';
  loaded = true;
  try {
    const s = store();
    if (current) s?.setItem(LAST_BACKUP_KEY, current);
    else s?.removeItem(LAST_BACKUP_KEY);
  } catch {
    // memory-only from here: the day holds for this page, not past a reload
  }
  for (const fn of listeners) fn(current);
}

// subscribe(fn) → unsubscribe. fn is called with the new day on every change,
// never on subscribe — a component reads the current value with getLastBackup().
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
