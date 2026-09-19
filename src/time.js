// Day math that does not depend on where the phone is today. A "day" runs
// 4am → 4am local. Every event is stamped at log time with the local day it
// counts toward (`day`) and the UTC offset it was logged under (`tzOffsetMin`,
// minutes east of UTC), so moving time zones never reshuffles history.

export const DAY_CUTOFF_HOURS = 4;

export function localOffsetMin(date = new Date()) {
  return -date.getTimezoneOffset();
}

export function dayKeyAt(tsMs, tzOffsetMin) {
  const d = new Date(tsMs + tzOffsetMin * 60000 - DAY_CUTOFF_HOURS * 3600000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// UTC offset (minutes east) that a named zone had at a given instant.
export function offsetMinInZone(tsMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(tsMs));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUTC - Math.floor(tsMs / 1000) * 1000) / 60000);
}

// Stamp for an event being logged right now.
export function stampNow(now = new Date()) {
  const tzOffsetMin = localOffsetMin(now);
  return { ts: now.toISOString(), tzOffsetMin, day: dayKeyAt(now.getTime(), tzOffsetMin) };
}

// The day an event counts toward. Unstamped (pre-v2) events fall back to the
// device's zone at that instant.
export function dayKeyOf(e) {
  if (e.day) return e.day;
  const ms = Date.parse(e.ts);
  return dayKeyAt(ms, localOffsetMin(new Date(ms)));
}

// Wall-clock hour/minute the event was logged at, wherever that was.
export function localHM(e) {
  const ms = Date.parse(e.ts);
  const off = e.tzOffsetMin ?? localOffsetMin(new Date(ms));
  const d = new Date(ms + off * 60000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
}
