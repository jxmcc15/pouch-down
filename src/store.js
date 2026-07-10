// Event-sourced localStorage store. Events are the truth; everything else
// (counts, streaks, money, calendar colors) is derived at read time.
// Never mutate or delete history except explicit single-event undo.

import { START_DATE, TOTAL_DAYS, BASELINE, stageForDay, capForDay } from './plan.js';

const KEY = 'pouch-down-v1';
const SCHEMA_VERSION = 1;

// A "day" runs 4am → 4am so a 1am pouch counts against the evening it
// belongs to, not the next morning.
const DAY_CUTOFF_HOURS = 4;

export const DEFAULT_SETTINGS = {
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  costPerTin: 5,
  pouchesPerTin: 20,
  apiKey: '',
  wakeTime: '07:00',
  sleepTime: '23:00',
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    if (parsed.version !== SCHEMA_VERSION) return migrate(parsed);
    return { ...freshState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } };
  } catch {
    return freshState();
  }
}

function freshState() {
  return {
    version: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    events: [],
    celebratedStages: [],
    checkinDismissedFor: null, // dayKey — hides the morning check-in card for that day
  };
}

function migrate(old) {
  // Future schema versions upgrade here; v1 has nothing to migrate from.
  return { ...freshState(), ...old, version: SCHEMA_VERSION };
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

// ---- events ----------------------------------------------------------------

let idCounter = 0;
export function makeEvent(type, trigger = null) {
  return {
    id: `${Date.now()}-${idCounter++}`,
    ts: new Date().toISOString(),
    type, // 'pouch' | 'resisted' | 'checkin'
    trigger, // 'coffee' | 'driving' | 'stress' | 'after-meal' | 'boredom' | null
  };
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function fmtDuration(ms) {
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  return h >= 1 ? `${h}h ${min % 60}m` : `${min % 60}m`;
}

export function dayKeyFor(ts) {
  const d = new Date(ts);
  d.setHours(d.getHours() - DAY_CUTOFF_HOURS);
  return localDateStr(d);
}

export function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayKey() {
  return dayKeyFor(new Date().toISOString());
}

// Day number within the plan: 1..TOTAL_DAYS. 0 or negative = pre-plan, beyond = post-quit.
export function dayNumberFor(dateStr) {
  const start = new Date(`${START_DATE}T12:00:00`);
  const d = new Date(`${dateStr}T12:00:00`);
  return Math.round((d - start) / 86400000) + 1;
}

export function dateForDayNumber(n) {
  const start = new Date(`${START_DATE}T12:00:00`);
  const d = new Date(start.getTime() + (n - 1) * 86400000);
  return localDateStr(d);
}

export function eventsForDay(state, dateStr) {
  return state.events.filter((e) => dayKeyFor(e.ts) === dateStr);
}

export function pouchesForDay(state, dateStr) {
  return eventsForDay(state, dateStr).filter((e) => e.type === 'pouch').length;
}

export function resistedForDay(state, dateStr) {
  return eventsForDay(state, dateStr).filter((e) => e.type === 'resisted').length;
}

// ---- day status / streak ----------------------------------------------------

// 'future' | 'pre' | 'green' | 'yellow' | 'today-under' | 'today-over'
export function statusForDay(state, dateStr) {
  const today = todayKey();
  const n = dayNumberFor(dateStr);
  const used = pouchesForDay(state, dateStr);
  const cap = capForDay(n);
  if (dateStr > today) return 'future';
  if (n < 1) return 'pre';
  if (dateStr === today) return used > cap ? 'today-over' : 'today-under';
  return used > cap ? 'yellow' : 'green';
}

// Consecutive on-plan days ending today (today counts only if not over).
export function currentStreak(state) {
  let streak = 0;
  const today = todayKey();
  let n = dayNumberFor(today);
  if (n < 1) return 0;
  // today counts toward the streak while it's still under cap
  if (pouchesForDay(state, today) <= capForDay(n)) streak = 1;
  for (let i = n - 1; i >= 1; i--) {
    const d = dateForDayNumber(i);
    if (pouchesForDay(state, d) <= capForDay(i)) streak++;
    else break;
  }
  return streak;
}

// ---- money ------------------------------------------------------------------

export function moneySaved(state) {
  const { costPerTin, pouchesPerTin } = state.settings;
  const perPouch = costPerTin / pouchesPerTin;
  const today = todayKey();
  const startN = 1;
  const endN = Math.min(dayNumberFor(today), 10000);
  if (endN < startN) return 0;
  let saved = 0;
  for (let i = startN; i <= endN; i++) {
    const d = dateForDayNumber(i);
    if (d > today) break;
    const used = pouchesForDay(state, d);
    saved += (BASELINE.pouchesPerDay - used) * perPouch;
  }
  return Math.max(0, saved);
}

// ---- nicotine ---------------------------------------------------------------

export function mgForDay(state, dateStr) {
  const n = dayNumberFor(dateStr);
  const stage = stageForDay(Math.max(1, Math.min(n, TOTAL_DAYS)));
  const mgPerPouch = n < 1 ? BASELINE.mg : stage ? stage.mg : 0;
  return pouchesForDay(state, dateStr) * mgPerPouch;
}

export function plannedMgForDay(n) {
  if (n < 1) return BASELINE.pouchesPerDay * BASELINE.mg;
  const s = stageForDay(n);
  return s ? s.pouchesPerDay * s.mg : 0;
}

// ---- slots / pacing ----------------------------------------------------------

function slotTimeToday(slotDef, settings, dateStr) {
  let hm;
  if (slotDef.anchor === 'fixed') {
    hm = slotDef.time;
  } else {
    const meal = settings.mealTimes[slotDef.anchor] || '12:00';
    const [h, m] = meal.split(':').map(Number);
    const total = h * 60 + m + (slotDef.offsetMin || 0);
    hm = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  return new Date(`${dateStr}T${hm}:00`);
}

// Returns today's slots with times, how many pouches are logged, and which
// slot is "next" — the pacing model: slot k unlocks at its scheduled time,
// and you've "spent" slots equal to pouches logged today.
export function pacingForNow(state) {
  const now = new Date();
  const dateStr = todayKey();
  const n = dayNumberFor(dateStr);
  const stage = stageForDay(n);
  if (!stage || n < 1 || n > TOTAL_DAYS) return { mode: n < 1 ? 'pre' : 'post', slots: [] };

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
  const n = dayNumberFor(dateStr);
  const pacing = pacingForNow(state);
  if (pacing.mode !== 'plan') {
    return {
      nth: pouchesForDay(state, dateStr) + 1,
      cap: capForDay(n),
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
// the stage plus *current* settings — a small, accepted drift. Never written back.
function deriveCtx(state, ev, dateStr, n) {
  const stage = stageForDay(Math.min(n, TOTAL_DAYS));
  const cap = capForDay(n);
  const dayPouches = eventsForDay(state, dateStr)
    .filter((e) => e.type === 'pouch')
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const nth = dayPouches.findIndex((e) => e.id === ev.id) + 1 || 1;
  const slotDefs = stage?.slots ?? [];
  const slots = slotDefs.map((s) => slotTimeToday(s, state.settings, dateStr));
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
  const dateStr = dayKeyFor(ev.ts);
  const n = dayNumberFor(dateStr);
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
  const zero = () => ({ onTime: 0, early: 0, overCap: 0, preFirstSlot: 0 });
  const totals = zero();
  const todayCounts = zero();
  let earlySum = 0, earlyN = 0, heldSum = 0, heldN = 0;
  for (const ev of state.events) {
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
    if (dayKeyFor(ev.ts) === today) add(todayCounts);
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
export function firstPouchTimes(state) {
  const firstByDay = new Map();
  for (const e of state.events) {
    if (e.type !== 'pouch') continue;
    const k = dayKeyFor(e.ts);
    const t = new Date(e.ts).getTime();
    if (!firstByDay.has(k) || t < firstByDay.get(k)) firstByDay.set(k, t);
  }
  const out = [];
  for (const [date, t] of firstByDay) {
    const dayNum = dayNumberFor(date);
    if (dayNum < 1 || dayNum > TOTAL_DAYS) continue;
    const d = new Date(t);
    const minutesSince4am = (d.getHours() * 60 + d.getMinutes() - DAY_CUTOFF_HOURS * 60 + 1440) % 1440;
    out.push({ dayNum, date, minutesSince4am });
  }
  return out.sort((a, b) => a.dayNum - b.dayNum);
}

export function gapStats(state) {
  const pouches = state.events
    .filter((e) => e.type === 'pouch')
    .map((e) => ({ ts: new Date(e.ts).getTime(), dayKey: dayKeyFor(e.ts) }))
    .sort((a, b) => a.ts - b.ts);
  const today = todayKey();
  const d7 = new Date(`${today}T12:00:00`);
  d7.setDate(d7.getDate() - 6);
  const weekStart = localDateStr(d7);

  let todaySum = 0, todayN = 0, weekSum = 0, weekN = 0;
  let longest = null, longestEnd = null;
  for (let i = 1; i < pouches.length; i++) {
    const gap = pouches[i].ts - pouches[i - 1].ts;
    if (longest == null || gap > longest) { longest = gap; longestEnd = pouches[i].ts; }
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
    longestGapEndedAt: longestEnd ? new Date(longestEnd).toISOString() : null,
    currentGapMs: last ? Date.now() - last.ts : null,
  };
}

// 24 buckets by local hour: on-time vs everything off-plan (early + over-cap).
// Baseline-day events carry no verdict and are excluded, same as discipline stats.
export function hourHistogram(state) {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, onTime: 0, off: 0 }));
  for (const e of state.events) {
    if (e.type !== 'pouch') continue;
    const v = classifyPouch(state, e);
    if (v.bucket === 'baseline') continue;
    const h = new Date(e.ts).getHours();
    if (v.bucket === 'on-time') buckets[h].onTime++;
    else buckets[h].off++;
  }
  return buckets;
}

// Latest check-in on a day wins; earlier ones stay in the log but never render.
export function checkinForDay(state, dateStr) {
  let latest = null;
  for (const e of state.events) {
    if (e.type !== 'checkin' || dayKeyFor(e.ts) !== dateStr) continue;
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
    const k = dayKeyFor(e.ts);
    if (dayNumberFor(k) < 1) continue;
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

export function markdownSummary(state, days = 7) {
  const today = todayKey();
  const endN = dayNumberFor(today);
  const lines = [
    `## Pouch Down — log through ${today} (day ${Math.max(endN, 0)}/${TOTAL_DAYS})`,
    '',
    '| Day | Date | Cap | Used | Early | Over | First | Resisted | mg | Status |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (let i = Math.max(1, endN - days + 1); i <= endN; i++) {
    const d = dateForDayNumber(i);
    if (d > today) break;
    const used = pouchesForDay(state, d);
    const res = resistedForDay(state, d);
    const status = statusForDay(state, d);
    let early = 0, over = 0, first = null;
    for (const e of eventsForDay(state, d)) {
      if (e.type !== 'pouch') continue;
      const v = classifyPouch(state, e);
      if (v.bucket === 'early') early++;
      if (v.bucket === 'over-cap') over++;
      const t = new Date(e.ts).getTime();
      if (first == null || t < first) first = t;
    }
    lines.push(`| ${i} | ${d} | ${capForDay(i)} | ${used} | ${early} | ${over} | ${first != null ? fmtTime(first) : '—'} | ${res} | ${mgForDay(state, d)}mg | ${status.includes('over') || status === 'yellow' ? 'over' : 'on plan'} |`);
  }
  const triggers = {};
  state.events.filter((e) => e.trigger).forEach((e) => {
    triggers[e.trigger] = (triggers[e.trigger] || 0) + 1;
  });
  const trigLine = Object.entries(triggers).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} (${c})`).join(', ');
  lines.push('', `Streak: ${currentStreak(state)} · Saved: $${moneySaved(state).toFixed(2)}${trigLine ? ` · Triggers: ${trigLine}` : ''}`);

  const disc = disciplineStats(state);
  if (disc.onTime + disc.early + disc.overCap > 0) {
    lines.push(
      `Discipline: ${disc.onTime} on-time · ${disc.early} early${disc.preFirstSlot ? ` (${disc.preFirstSlot} before first slot)` : ''} · ${disc.overCap} over-cap` +
      (disc.avgMinHeld != null ? ` · avg held +${Math.round(disc.avgMinHeld)}m` : '') +
      (disc.avgMinEarly != null ? ` · avg early ${Math.round(disc.avgMinEarly)}m` : '')
    );
  }
  const gaps = gapStats(state);
  if (gaps.longestGapMs != null) {
    lines.push(`Longest gap: ${fmtDuration(gaps.longestGapMs)} (incl. sleep, ended ${dayKeyFor(gaps.longestGapEndedAt)} ${fmtTime(gaps.longestGapEndedAt)})`);
  }
  let cN = 0, qSum = 0, qN = 0, hSum = 0, hN = 0, wYes = 0, wN = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - i);
    const c = checkinForDay(state, localDateStr(d));
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
