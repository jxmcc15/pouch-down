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
  return { version: SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS }, events: [], celebratedStages: [] };
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
    type, // 'pouch' | 'resisted'
    trigger, // 'coffee' | 'driving' | 'stress' | 'after-meal' | 'boredom' | null
  };
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

// ---- export -----------------------------------------------------------------

export function markdownSummary(state, days = 7) {
  const today = todayKey();
  const endN = dayNumberFor(today);
  const lines = [
    `## Pouch Down — log through ${today} (day ${Math.max(endN, 0)}/${TOTAL_DAYS})`,
    '',
    '| Day | Date | Cap | Used | Resisted | mg | Status |',
    '|---|---|---|---|---|---|---|',
  ];
  for (let i = Math.max(1, endN - days + 1); i <= endN; i++) {
    const d = dateForDayNumber(i);
    if (d > today) break;
    const used = pouchesForDay(state, d);
    const res = resistedForDay(state, d);
    const status = statusForDay(state, d);
    lines.push(`| ${i} | ${d} | ${capForDay(i)} | ${used} | ${res} | ${mgForDay(state, d)}mg | ${status.includes('over') || status === 'yellow' ? 'over' : 'on plan'} |`);
  }
  const triggers = {};
  state.events.filter((e) => e.trigger).forEach((e) => {
    triggers[e.trigger] = (triggers[e.trigger] || 0) + 1;
  });
  const trigLine = Object.entries(triggers).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t} (${c})`).join(', ');
  lines.push('', `Streak: ${currentStreak(state)} · Saved: $${moneySaved(state).toFixed(2)}${trigLine ? ` · Triggers: ${trigLine}` : ''}`);
  return lines.join('\n');
}
