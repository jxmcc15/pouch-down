// The Claude API key, held for this session only.
//
// It is the one secret the app holds, and it does not need to be at rest: the
// coach is used now and then, and a password manager can fill a password field
// on demand. So the key lives in a variable for as long as the page is open,
// and sessionStorage carries it across a reload — sessionStorage is per-tab, so
// another page on the same origin never sees it. Nothing here ever writes to
// localStorage; the v2 root's `device.apiKey` is left blank for good.
//
// No React in this file on purpose: it is a plain module that components read
// and subscribe to, so tests (and the api layer) can use it without a renderer.

export const SESSION_KEY = 'pouch-down-session-key';

let current = '';
const listeners = new Set();

// Every touch of sessionStorage is guarded twice: reaching the property can
// throw on its own (Safari with site data blocked), and so can each method
// (private mode, full quota). Either way the key still works for this session —
// it just won't survive a reload. Never a crash, never a lost session.
function store() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

// → the key for this session, or '' when there isn't one. Reads through to
// sessionStorage while memory is empty, which is what makes a reload seamless
// and keeps this module free of any init step a caller could forget.
export function getKey() {
  if (current) return current;
  try {
    current = store()?.getItem(SESSION_KEY) ?? '';
  } catch {
    current = '';
  }
  return current;
}

// Set (or, with an empty value, drop) the key and tell everyone watching.
// Anything that isn't a string is no key at all rather than a stringified
// surprise sent to the API.
export function setKey(value) {
  current = typeof value === 'string' ? value : '';
  try {
    const s = store();
    if (current) s?.setItem(SESSION_KEY, current);
    else s?.removeItem(SESSION_KEY);
  } catch {
    // memory-only from here: the key holds for this page, not past a reload
  }
  for (const fn of listeners) fn(current);
}

export const clearKey = () => setKey('');

// subscribe(fn) → unsubscribe. fn is called with the new key on every change,
// never on subscribe — a component reads the current value with getKey().
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
