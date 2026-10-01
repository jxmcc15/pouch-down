// A remembered pouch: the user names the app day it belongs to and the
// wall-clock time it happened (or says they don't remember). This turns that
// into an instant the rest of the app can stamp — in the phone's CURRENT zone,
// because that is the clock the user is reading when they pick "4:30 PM".
// Shared by the api (validate + stamp) and the sheet (the resolved line and
// the "later than now" check), so the two can never disagree.
import { DAY_CUTOFF_HOURS, localOffsetMin } from './time.js';
import { CLOCK_SKEW_MS } from './justLogged.js';

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A day string that names a real calendar date. The shape alone lets
// '2026-09-31' through, and Date quietly rolls it into October — a pouch
// stamped under a day that doesn't exist would be in no bucket at all.
function isCalendarDay(day) {
  if (typeof day !== 'string' || !DAY_RE.test(day)) return false;
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) === day;
}

// The instant of `time` (HH:MM) on app day `day`, or null if either won't do.
// The 4am rule: 00:00–03:59 belongs to the app day that started the evening
// before, so a time before the cutoff lands on the NEXT calendar date.
export function lateInstant(day, time) {
  if (!isCalendarDay(day) || typeof time !== 'string' || !TIME_RE.test(time)) return null;
  const [y, mo, d] = day.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const nextCalendarDay = h < DAY_CUTOFF_HOURS;
  const at = new Date(y, mo - 1, d + (nextCalendarDay ? 1 : 0), h, m);
  return { ms: at.getTime(), tzOffsetMin: localOffsetMin(at), nextCalendarDay };
}

// What the sheet shows above Save, and what the api checks. `time` null means
// the time is unknown: the pouch is stamped at `now` with timeKnown:false.
// → { ok, ms, tzOffsetMin, future, nextCalendarDay } — `ok` false when the
// inputs are malformed; `future` true when the instant is past now (+ skew).
export function resolveLate({ day, time, now = Date.now() }) {
  if (time === null) return { ok: isCalendarDay(day), ms: now, tzOffsetMin: localOffsetMin(new Date(now)), future: false, nextCalendarDay: false };
  const at = lateInstant(day, time);
  if (!at) return { ok: false, ms: null, tzOffsetMin: null, future: false, nextCalendarDay: false };
  return { ok: true, ...at, future: at.ms > now + CLOCK_SKEW_MS };
}

// "4:30 PM" from "16:30" — for the resolved line, in the user's own words.
export function fmtHM(time) {
  if (typeof time !== 'string' || !TIME_RE.test(time)) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
