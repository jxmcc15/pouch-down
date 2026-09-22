// "Just logged" is enforced by the api, not by a UI timer: iOS suspends
// setTimeout while the phone is locked, so a toast can still be on screen long
// after it should have gone. The api checks the event's own age instead.
// Kept out of state.jsx so importing these doesn't break fast refresh there.

// The log toast shows for 12 s; undo stays valid a little past that so a tap
// landing as the toast leaves still counts. The UI must hide its undo by then.
export const UNDO_WINDOW_MS = 15000;

// Mood tags may only *complete* the just-made log — same spirit as undo.
export const TAG_WINDOW_MS = 15000;

// An event stamped further ahead of "now" than this means the clock was set
// back after logging. Its age can't be trusted, so it isn't "just logged".
export const CLOCK_SKEW_MS = 5000;

export function isJustLogged(ev, windowMs, now = Date.now()) {
  const age = now - Date.parse(ev.ts);
  return age >= -CLOCK_SKEW_MS && age <= windowMs; // NaN (bad ts) fails both
}
