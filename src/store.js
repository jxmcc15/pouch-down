// Derivations over one attempt ({ status, archivedAt, settings, plan, events, … }).
// Events are the truth; everything else (counts, streaks, calendar colors) is
// derived at read time. Persistence lives in root.js. Never mutate or delete
// history except explicit single-event undo.

import { stageForDay, capForDay } from './plan.js';
import { stampNow, dayKeyOf, localHM, DAY_CUTOFF_HOURS } from './time.js';

// ---- events ----------------------------------------------------------------

let idCounter = 0;
// type: 'pouch' | 'resisted' | 'checkin' ('backfill' events are built by the caller)
// trigger: 'coffee' | 'driving' | 'stress' | 'after-meal' | 'boredom' | null
export function makeEvent(type, trigger = null, now = new Date()) {
  return { id: `${now.getTime()}-${idCounter++}`, ...stampNow(now), type, trigger };
}

export function fmtTime(tsOrEvent) {
  const { h, m } = localHM(typeof tsOrEvent === 'object' && tsOrEvent.ts ? tsOrEvent : { ts: new Date(tsOrEvent).toISOString() });
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDuration(ms) {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  return h >= 1 ? `${h}h ${min % 60}m` : `${min % 60}m`;
}

export function dayKeyFor(tsOrEvent) { // kept for callers holding only a timestamp
  return dayKeyOf(typeof tsOrEvent === 'string' ? { ts: tsOrEvent } : tsOrEvent);
}

export function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey(now = new Date()) {
  return stampNow(now).day;
}

// Pure calendar-day arithmetic on UTC midnights. Device-zone Date objects
// (constructing at noon local, diffing/setDate) break in zones that skip a
// wall-clock day around a DST transition; this doesn't.
function epochDayOf(dateStr) {
  return Math.round(Date.parse(`${dateStr}T00:00:00Z`) / 86400000);
}
function dateStrOfEpochDay(epochDay) {
  return new Date(epochDay * 86400000).toISOString().slice(0, 10);
}

// Day number within the attempt's plan: 1..totalDays. 0 or negative = pre-plan, beyond = post-quit.
export function dayNumberFor(state, dateStr) {
  return epochDayOf(dateStr) - epochDayOf(state.plan.startDate) + 1;
}

export function dateForDayNumber(state, n) {
  return dateStrOfEpochDay(epochDayOf(state.plan.startDate) + n - 1);
}

// A backfill's count is trusted only if it's a real whole number ≥ 0 — an
// invalid one is treated everywhere as if the backfill never happened.
function backfillCount(e) {
  return Number.isInteger(e.count) && e.count >= 0 ? e.count : null;
}

// The day an attempt is scored "as of": today while active; for an archived
// attempt, the earlier of the day it was archived and its quit date.
// `archivedDay` is the app day stamped at archive time, in the zone you were in
// then; re-deriving it from `archivedAt` would use wherever the phone is now,
// so only attempts archived before the stamp existed fall back to that.
export function asOfDay(state) {
  if (state.status !== 'archived') return todayKey();
  const archived = state.archivedDay || dayKeyFor(state.archivedAt);
  return archived < state.plan.quitDate ? archived : state.plan.quitDate;
}

export function eventsForDay(state, dateStr) {
  return state.events.filter((e) => dayKeyOf(e) === dateStr);
}

// Pouches used that day: taps plus anything backfilled afterwards.
export function pouchesForDay(state, dateStr) {
  let n = 0;
  for (const e of eventsForDay(state, dateStr)) {
    if (e.type === 'pouch') n++;
    else if (e.type === 'backfill') {
      const c = backfillCount(e);
      if (c != null) n += c;
    }
  }
  return n;
}

export function resistedForDay(state, dateStr) {
  return eventsForDay(state, dateStr).filter((e) => e.type === 'resisted').length;
}

// ---- day status / streak ----------------------------------------------------

// Silence is not success: a day counts as logged only if the user told the app
// something about nicotine that day. A sleep check-in alone doesn't.
export function isLogged(state, dateStr) {
  return eventsForDay(state, dateStr).some((e) => e.type === 'pouch' || e.type === 'resisted' || (e.type === 'backfill' && backfillCount(e) != null));
}

// 'future' | 'pre' | 'green' | 'yellow' | 'nolog' | 'today-under' | 'today-over'
export function statusForDay(state, dateStr) {
  const today = asOfDay(state);
  const n = dayNumberFor(state, dateStr);
  if (dateStr > today) return 'future';
  if (n < 1) return 'pre';
  const over = pouchesForDay(state, dateStr) > capForDay(state.plan, n);
  if (dateStr === today && state.status !== 'archived') return over ? 'today-over' : 'today-under';
  // silence is never success — a past unlogged day is nolog, quit day or not
  if (!isLogged(state, dateStr)) return 'nolog';
  return over ? 'yellow' : 'green';
}

export function dayCountsForStreak(state, dateStr) {
  if (!isLogged(state, dateStr)) return false;
  if (pouchesForDay(state, dateStr) > capForDay(state.plan, dayNumberFor(state, dateStr))) return false;
  return !eventsForDay(state, dateStr).some((e) => e.type === 'backfill' && backfillCount(e) != null && e.streak === 'break');
}

// Consecutive green days ending yesterday, plus today once it's logged and
// under cap. nolog, over-cap, and "break it here" backfills all break it.
// Deliberate: a today already over cap zeroes `current` at once, not tomorrow;
// showing a streak you know is already broken would be a fake number.
export function streaks(state) {
  const asOf = asOfDay(state);
  const endN = Math.min(dayNumberFor(state, asOf), state.plan.totalDays);
  let run = 0, best = 0;
  for (let i = 1; i <= endN; i++) {
    const d = dateForDayNumber(state, i);
    if (dayCountsForStreak(state, d)) run++;
    else if (state.status !== 'archived' && d === asOf && !isLogged(state, d)) continue; // today, not logged yet
    else run = 0;
    if (run > best) best = run;
  }
  return { current: run, best };
}

export const currentStreak = (state) => streaks(state).current;

// Recent unlogged plan days to offer for backfill, newest first. Never today.
export function missedDays(state, { max = 3, windowDays = 7 } = {}) {
  if (state.status === 'archived') return [];
  const n = dayNumberFor(state, todayKey());
  const out = [];
  for (let i = Math.min(n - 1, state.plan.totalDays); i >= Math.max(1, n - windowDays) && out.length < max; i--) {
    const day = dateForDayNumber(state, i);
    if (!isLogged(state, day)) out.push({ day, dayNum: i, cap: capForDay(state.plan, i) });
  }
  return out;
}

// ---- nicotine ---------------------------------------------------------------

export function mgForDay(state, dateStr) {
  const n = dayNumberFor(state, dateStr);
  const stage = stageForDay(state.plan, Math.max(1, Math.min(n, state.plan.totalDays)));
  const mgPerPouch = n < 1 ? state.plan.baseline.mg : stage ? stage.mg : 0;
  return pouchesForDay(state, dateStr) * mgPerPouch;
}

export function plannedMgForDay(state, n) {
  const { baseline } = state.plan;
  if (n < 1) return baseline.pouchesPerDay * baseline.mg;
  const s = stageForDay(state.plan, n);
  return s ? s.pouchesPerDay * s.mg : 0;
}

// ---- slots / pacing ----------------------------------------------------------

// Minutes after midnight on the day's calendar date. Can run past 24:00 (the
// slot after a 23:45 dinner, or a floater like "24:15" after a late one):
// that's still the same 4am→4am day, so it's counted on, never wrapped.
function slotMinutes(slotDef, settings) {
  const hm = slotDef.anchor === 'fixed' ? slotDef.time : settings.mealTimes[slotDef.anchor] || '12:00';
  const [h, m] = String(hm).split(':').map(Number);
  const total = h * 60 + m + (slotDef.anchor === 'fixed' ? 0 : slotDef.offsetMin || 0);
  return Number.isFinite(total) ? total : 12 * 60; // a garbled time must never crash a log
}

// The instant a slot unlocks on app day `dateStr`. Given `tzOffsetMin` it's
// built in that zone — an old pouch's own — so its verdict doesn't depend on
// where the phone is when you read it; without, in the device's zone (live
// pacing). Date's own overflow carries minutes ≥ 1440 into the next date.
function slotTimeToday(slotDef, settings, dateStr, tzOffsetMin = null) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const min = slotMinutes(slotDef, settings);
  return tzOffsetMin == null
    ? new Date(y, mo - 1, d, 0, min)
    : new Date(Date.UTC(y, mo - 1, d, 0, min) - tzOffsetMin * 60000);
}

// Returns today's slots with times, how many pouches are logged, and which
// slot is "next" — the pacing model: slot k unlocks at its scheduled time,
// and you've "spent" slots equal to pouches used today (a count, not a time,
// so a backfill for today — which the UI never offers — would still spend slots).
export function pacingForNow(state) {
  const now = new Date();
  const dateStr = todayKey();
  const n = dayNumberFor(state, dateStr);
  const stage = stageForDay(state.plan, n);
  if (!stage || n < 1 || n > state.plan.totalDays) return { mode: n < 1 ? 'pre' : 'post', slots: [] };

  const used = pouchesForDay(state, dateStr);
  const cap = stage.pouchesPerDay;
  const slots = stage.slots.map((s, i) => ({
    ...s,
    at: slotTimeToday(s, state.settings, dateStr),
    index: i,
    spent: i < used,
  }));
  const nextSlot = used >= cap ? null : slots[used];
  const unlocked = nextSlot ? now >= nextSlot.at : false;
  return { mode: 'plan', dateStr, dayNum: n, stage, used, cap, slots, nextSlot, unlocked, now };
}

// ---- per-tap classification ---------------------------------------------------
// Hybrid snapshot model: settings-dependent raw facts (slot times, cap, nth)
// are stamped on the event at log time; verdicts are always computed at read
// time so they recompute for free after an undo.

// Raw facts to stamp on a pouch event, computed against the pre-append state.
export function pouchCtxForNow(state) {
  const dateStr = todayKey();
  const n = dayNumberFor(state, dateStr);
  const pacing = pacingForNow(state);
  if (pacing.mode !== 'plan') {
    return {
      nth: pouchesForDay(state, dateStr) + 1,
      cap: capForDay(state.plan, n),
      slotId: null,
      slotLabel: null,
      slotAt: null,
      firstSlotAt: null,
    };
  }
  return {
    nth: pacing.used + 1,
    cap: pacing.cap,
    slotId: pacing.nextSlot?.id ?? null,
    slotLabel: pacing.nextSlot?.label ?? null,
    slotAt: pacing.nextSlot?.at.toISOString() ?? null,
    firstSlotAt: pacing.slots[0]?.at.toISOString() ?? null,
  };
}

// Events logged before ctx stamping existed get their ctx reconstructed from
// the stage plus *current* settings — a small, accepted drift — with slot times
// in the zone the pouch was logged in. Never written back.
function deriveCtx(state, ev, dateStr, n) {
  const stage = stageForDay(state.plan, Math.min(n, state.plan.totalDays));
  const cap = capForDay(state.plan, n);
  const dayPouches = eventsForDay(state, dateStr)
    .filter((e) => e.type === 'pouch')
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const nth = dayPouches.findIndex((e) => e.id === ev.id) + 1 || 1;
  const slotDefs = stage?.slots ?? [];
  const slots = slotDefs.map((s) => slotTimeToday(s, state.settings, dateStr, ev.tzOffsetMin ?? null));
  return {
    nth,
    cap,
    slotId: nth <= slotDefs.length ? slotDefs[nth - 1].id : null,
    slotLabel: nth <= slotDefs.length ? slotDefs[nth - 1].label : null,
    slotAt: nth <= Math.min(cap, slots.length) ? slots[nth - 1].toISOString() : null,
    firstSlotAt: slots[0]?.toISOString() ?? null,
  };
}

// → { bucket: 'baseline'|'on-time'|'early'|'over-cap', deltaMin: number|null, preFirstSlot: bool }
// deltaMin is signed: negative = minutes early, positive = minutes held past unlock.
export function classifyPouch(state, ev) {
  const dateStr = dayKeyOf(ev);
  const n = dayNumberFor(state, dateStr);
  if (n < 1) return { bucket: 'baseline', deltaMin: null, preFirstSlot: false };
  const ctx = ev.ctx || deriveCtx(state, ev, dateStr, n);
  const ts = new Date(ev.ts).getTime();
  const preFirstSlot = ctx.firstSlotAt ? ts < new Date(ctx.firstSlotAt).getTime() : false;
  if (ctx.nth > ctx.cap) return { bucket: 'over-cap', deltaMin: null, preFirstSlot };
  if (!ctx.slotAt) return { bucket: 'on-time', deltaMin: null, preFirstSlot };
  const deltaMin = Math.round((ts - new Date(ctx.slotAt).getTime()) / 60000);
  return { bucket: deltaMin < 0 ? 'early' : 'on-time', deltaMin, preFirstSlot };
}

// ---- derived stats -------------------------------------------------------------

export function disciplineStats(state) {
  const today = todayKey();
  const zero = () => ({ onTime: 0, early: 0, overCap: 0, preFirstSlot: 0, backfilled: 0 });
  const totals = zero();
  const todayCounts = zero();
  let earlySum = 0, earlyN = 0, heldSum = 0, heldN = 0;
  for (const ev of state.events) {
    // backfilled pouches carry no timing, so they get their own bucket
    if (ev.type === 'backfill') {
      const c = backfillCount(ev);
      if (c != null) totals.backfilled += c;
      continue;
    }
    if (ev.type !== 'pouch') continue;
    const v = classifyPouch(state, ev);
    if (v.bucket === 'baseline') continue;
    const add = (c) => {
      if (v.bucket === 'on-time') c.onTime++;
      else if (v.bucket === 'early') c.early++;
      else c.overCap++;
      // counted only within the early bucket so it stays a true subset of
      // `early` — the card and export both present it as "of which N…"
      if (v.preFirstSlot && v.bucket === 'early') c.preFirstSlot++;
    };
    add(totals);
    if (dayKeyOf(ev) === today) add(todayCounts);
    if (v.deltaMin != null) {
      if (v.bucket === 'early') { earlySum += -v.deltaMin; earlyN++; }
      else if (v.bucket === 'on-time') { heldSum += v.deltaMin; heldN++; }
    }
  }
  return {
    ...totals,
    avgMinEarly: earlyN ? earlySum / earlyN : null,
    avgMinHeld: heldN ? heldSum / heldN : null,
    today: todayCounts,
  };
}

// First pouch per plan day, as minutes since the 4am day cutoff (so a 1am
// pouch reads as ~21h into the *previous* day, which is where it belongs).
// Wall-clock time is the zone the pouch was logged in. Taps only: backfills
// carry no timing.
export function firstPouchTimes(state) {
  const firstByDay = new Map();
  for (const e of state.events) {
    if (e.type !== 'pouch') continue;
    const k = dayKeyOf(e);
    const prev = firstByDay.get(k);
    if (!prev || Date.parse(e.ts) < Date.parse(prev.ts)) firstByDay.set(k, e);
  }
  const out = [];
  for (const [date, e] of firstByDay) {
    const dayNum = dayNumberFor(state, date);
    if (dayNum < 1 || dayNum > state.plan.totalDays) continue;
    const { h, m } = localHM(e);
    const minutesSince4am = (h * 60 + m - DAY_CUTOFF_HOURS * 60 + 1440) % 1440;
    out.push({ dayNum, date, minutesSince4am });
  }
  return out.sort((a, b) => a.dayNum - b.dayNum);
}

// Taps only: backfills carry no timing. `longestGapEnd` is the pouch event that
// ended the longest gap, for display in the zone it was logged in.
// `currentGapMs` is a live clock, so it's null unless the attempt is live: a
// past attempt ended, and "29 days since your last pouch" would be built from
// silence after it.
export function gapStats(state) {
  const pouches = state.events
    .filter((e) => e.type === 'pouch')
    .map((e) => ({ ev: e, ts: new Date(e.ts).getTime(), dayKey: dayKeyOf(e) }))
    .sort((a, b) => a.ts - b.ts);
  const today = todayKey();
  const weekStart = dateStrOfEpochDay(epochDayOf(today) - 6);

  let todaySum = 0, todayN = 0, weekSum = 0, weekN = 0;
  let longest = null, longestEnd = null;
  for (let i = 1; i < pouches.length; i++) {
    const gap = pouches[i].ts - pouches[i - 1].ts;
    if (longest == null || gap > longest) { longest = gap; longestEnd = pouches[i]; }
    // averages only pair pouches within the same day, so sleep never inflates them
    if (pouches[i].dayKey === pouches[i - 1].dayKey) {
      if (pouches[i].dayKey === today) { todaySum += gap; todayN++; }
      if (pouches[i].dayKey >= weekStart) { weekSum += gap; weekN++; }
    }
  }
  const last = pouches[pouches.length - 1];
  return {
    avgGapTodayMin: todayN ? todaySum / todayN / 60000 : null,
    avgGap7dMin: weekN ? weekSum / weekN / 60000 : null,
    longestGapMs: longest,
    longestGapEndedAt: longestEnd ? new Date(longestEnd.ts).toISOString() : null,
    longestGapEnd: longestEnd ? longestEnd.ev : null,
    currentGapMs: last && state.status !== 'archived' && asOfDay(state) >= today ? Date.now() - last.ts : null,
  };
}

// 24 buckets by local hour (the zone each pouch was logged in): on-time vs
// everything off-plan (early + over-cap). Baseline-day events carry no verdict
// and are excluded, same as discipline stats. Taps only.
export function hourHistogram(state) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, onTime: 0, off: 0 }));
  for (const e of state.events) {
    if (e.type !== 'pouch') continue;
    const v = classifyPouch(state, e);
    if (v.bucket === 'baseline') continue;
    const { h } = localHM(e);
    if (v.bucket === 'on-time') buckets[h].onTime++;
    else buckets[h].off++;
  }
  return buckets;
}

// Latest check-in on a day wins; earlier ones stay in the log but never render.
export function checkinForDay(state, dateStr) {
  let latest = null;
  for (const e of state.events) {
    if (e.type !== 'checkin' || dayKeyOf(e) !== dateStr) continue;
    if (!latest || new Date(e.ts) >= new Date(latest.ts)) latest = e;
  }
  return latest;
}

// Avg pouches/day on completed plan days that have a check-in, split by sleep
// band and workout. Today is excluded from averages (its count is still
// rising) but counts toward totalCheckins for the ≥5 unlock.
export function correlationStats(state) {
  const today = todayKey();
  const byDay = new Map();
  for (const e of state.events) {
    if (e.type !== 'checkin') continue;
    const k = dayKeyOf(e);
    if (dayNumberFor(state, k) < 1) continue;
    const prev = byDay.get(k);
    if (!prev || new Date(e.ts) >= new Date(prev.ts)) byDay.set(k, e);
  }
  const bandOf = (c) => {
    if (c.sleepQuality != null) return c.sleepQuality <= 2 ? 'poor' : c.sleepQuality === 3 ? 'ok' : 'good';
    if (c.sleepHours != null) return c.sleepHours < 6.5 ? 'poor' : c.sleepHours <= 7.5 ? 'ok' : 'good';
    return null;
  };
  const cell = () => ({ days: 0, avgPouches: null, sum: 0 });
  const sleep = { poor: cell(), ok: cell(), good: cell() };
  const workout = { yes: cell(), no: cell() };
  for (const [dateStr, c] of byDay) {
    if (dateStr >= today) continue;
    const p = pouchesForDay(state, dateStr);
    const band = bandOf(c);
    if (band) { sleep[band].days++; sleep[band].sum += p; }
    if (typeof c.workout === 'boolean') {
      const w = workout[c.workout ? 'yes' : 'no'];
      w.days++;
      w.sum += p;
    }
  }
  for (const group of [sleep, workout]) {
    for (const k of Object.keys(group)) {
      const c = group[k];
      c.avgPouches = c.days ? c.sum / c.days : null;
      delete c.sum;
    }
  }
  return { totalCheckins: byDay.size, sleep, workout };
}

// Taps only: a backfill is not a pouch taken at the moment it was entered.
export function timeSinceLastPouch(state) {
  let last = null;
  for (const e of state.events) {
    if (e.type !== 'pouch') continue;
    const t = new Date(e.ts).getTime();
    if (last == null || t > last) last = t;
  }
  return last == null ? null : Date.now() - last;
}

// ---- export -----------------------------------------------------------------

export function markdownSummary(state, days = 7, kept = null) {
  const asOf = asOfDay(state);
  const last = Math.min(dayNumberFor(state, asOf), state.plan.totalDays);
  const lines = [
    `## Pouch Down — log through ${asOf} (day ${Math.max(last, 0)}/${state.plan.totalDays})`,
    '',
    '| Day | Date | Cap | Used | Early | Over | First | Resisted | mg | Status |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (let i = Math.max(1, last - days + 1); i <= last; i++) {
    const d = dateForDayNumber(state, i);
    if (!isLogged(state, d)) {
      lines.push(`| ${i} | ${d} | ${capForDay(state.plan, i)} | — | — | — | — | — | — | no log |`);
      continue;
    }
    const used = pouchesForDay(state, d);
    const res = resistedForDay(state, d);
    const status = statusForDay(state, d);
    let early = 0, over = 0, first = null;
    for (const e of eventsForDay(state, d)) {
      if (e.type !== 'pouch') continue;
      const v = classifyPouch(state, e);
      if (v.bucket === 'early') early++;
      if (v.bucket === 'over-cap') over++;
      if (first == null || Date.parse(e.ts) < Date.parse(first.ts)) first = e;
    }
    lines.push(`| ${i} | ${d} | ${capForDay(state.plan, i)} | ${used} | ${early} | ${over} | ${first != null ? fmtTime(first) : '—'} | ${res} | ${mgForDay(state, d)}mg | ${status.includes('over') || status === 'yellow' ? 'over' : 'on plan'} |`);
  }
  const triggers = {};
  state.events.filter((e) => e.trigger).forEach((e) => {
    triggers[e.trigger] = (triggers[e.trigger] || 0) + 1;
  });
  const trigLine = Object.entries(triggers).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} (${c})`).join(', ');
  lines.push('', `Streak: ${currentStreak(state)}${kept != null ? ` · Kept: $${kept.toFixed(2)}` : ''}${trigLine ? ` · Triggers: ${trigLine}` : ''}`);

  const disc = disciplineStats(state);
  if (disc.onTime + disc.early + disc.overCap > 0) {
    lines.push(
      `Discipline: ${disc.onTime} on-time · ${disc.early} early${disc.preFirstSlot ? ` (${disc.preFirstSlot} before first slot)` : ''} · ${disc.overCap} over-cap` +
      (disc.avgMinHeld != null ? ` · avg held +${Math.round(disc.avgMinHeld)}m` : '') +
      (disc.avgMinEarly != null ? ` · avg early ${Math.round(disc.avgMinEarly)}m` : '')
    );
  }
  const gaps = gapStats(state);
  if (gaps.longestGapEnd != null) {
    lines.push(`Longest gap: ${fmtDuration(gaps.longestGapMs)} (incl. sleep, ended ${dayKeyOf(gaps.longestGapEnd)} ${fmtTime(gaps.longestGapEnd)})`);
  }
  let cN = 0, qSum = 0, qN = 0, hSum = 0, hN = 0, wYes = 0, wN = 0;
  for (let i = 0; i < 7; i++) {
    const d = dateStrOfEpochDay(epochDayOf(asOf) - i);
    const c = checkinForDay(state, d);
    if (!c) continue;
    cN++;
    if (c.sleepQuality != null) { qSum += c.sleepQuality; qN++; }
    if (c.sleepHours != null) { hSum += c.sleepHours; hN++; }
    if (typeof c.workout === 'boolean') { wN++; if (c.workout) wYes++; }
  }
  if (cN) {
    lines.push(`Check-ins (7d): ${cN}${qN ? ` · avg sleep quality ${(qSum / qN).toFixed(1)}/5` : ''}${hN ? ` · avg ${(hSum / hN).toFixed(1)}h sleep` : ''}${wN ? ` · workouts ${wYes}/${wN}` : ''}`);
  }
  return lines.join('\n');
}

// Complete raw v2 root as JSON — every attempt, event, check-in, and setting —
// for off-device safekeeping. Unlike markdownSummary this is lossless. The
// device API key is the one thing that never leaves the phone, so it's
// blanked here; the input root itself is never mutated.
export function fullBackup(root) {
  return JSON.stringify(
    {
      app: 'pouch-down',
      format: 2,
      exportedAt: new Date().toISOString(),
      root: { ...root, device: { ...root.device, apiKey: '' } },
    },
    null,
    2
  );
}
