# Attempt 2 (Attempts · Onboarding · Honest Scoring · Money · Awards) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let James restart his taper on Mon 2026-09-21 with attempt 1 preserved read-only, a plan generated from inputs he enters himself, scoring that never treats silence as success, an honest money model, and streak awards worth earning.

**Architecture:** App data becomes a v2 *root* holding a list of self-contained *attempts* (each = settings + plan + append-only events). An attempt is a superset of the old v1 `state`, so every `store.js` derivation keeps its `(state, …)` signature and reads `state.plan` instead of module constants. Plans are data produced by a pure generator. Events are stamped with local day + UTC offset at log time so history is time-zone-proof. Everything user-visible (status, streak, money, awards) is derived at read time.

**Tech Stack:** Vite 8 · React 19 · Framer Motion 12 · lucide-react · canvas-confetti · vitest 5 (node env) · Playwright via `playwright-core@1.59.1` for E2E · localStorage (Firebase comes in a later spec).

**Spec:** `docs/superpowers/specs/2026-09-18-attempts-and-onboarding-design.md` — read it first. **Branch:** `feat/attempt-2`. **Deploy freeze:** Sun 2026-09-20 6:00 PM CT.

## Ground rules (every task, every agent)

1. **NEVER `git push`.** Pushing `main` deploys to James's phone. Commit locally on `feat/attempt-2` only. James pushes.
2. **Never write or delete the `pouch-down-v1` localStorage key.** It is the rollback.
3. **Append-only history.** No code path edits or deletes a logged event except the existing just-logged undo and 15-second `tagEvent`.
4. **No personal usage data in this repo** (it is public). Real-data tests read from `POUCH_BACKUP_DIR` (= `/Users/jxm/jxm-vault/Pouch Down`) and skip when it is unset.
5. **Never commit an API key**; `device.apiKey` never appears in a backup/export.
6. Tone of all copy: warm, direct, zero shame, zero toxic positivity.
7. Match the surrounding code: no TypeScript, flat `src/`, existing comment density, Framer springs, `?static` must still kill animation.
8. A task is done when its tests pass **and** `npm test && npm run lint && npm run build && node docs/superpowers/reports/2026-07-10-math-harness.mjs` pass. Lint baseline is exactly 2 pre-existing warnings (`SOSOverlay.jsx`, `state.jsx`); do not add more.
9. Touching `src/coach.js` or `src/priceHelp.js` (Claude API calls)? Load the `claude-api` skill first.

## File map

| File | Responsibility | Status |
|---|---|---|
| `src/planGenerator.js` | `generatePlan`, `slotsFor`, ladders — pure | **done, tested** |
| `src/time.js` | `stampNow`, `dayKeyOf`, `localHM`, `dayKeyAt`, `offsetMinInZone` | **done, tested** |
| `src/migrate.js` | `migrateV1` | **done, tested (incl. real backup)** |
| `src/legacyPlan.js` | frozen 60-day plan object | done; A1 moves `STAGES` into it |
| `src/plan.js` | plan helpers taking a plan + static content | A1 rewrites |
| `src/store.js` | every derivation over an attempt; honest scoring | A2 |
| `src/root.js` | v2 root: load/save/start/archive/update | A3 |
| `src/money.js` | `moneyStats` | A4 |
| `src/awards.js` | `awardsFor` catalog + evaluation | A5 |
| `src/state.jsx` | React provider over the root; `api` | A6 |
| `src/ingest.js` + `scripts/ingest-backup.mjs` | `pouch-ingest`: backup file → vault + Live Log | A9 |
| `src/priceHelp.js` | free-text → price via Claude | B3 |
| `src/components/onboarding/*` | FrontDoor, SetupFlow, steps, PlanPreview | B1–B2 |
| `src/components/{ReadOnlyBanner,BackfillPrompt,MoneyCard}.jsx` | as named | B4–B6 |
| `src/components/{StreakChip,TrophyCase,AwardUnlock}.jsx` | awards UI | B2-session |
| `scripts/e2e/*.mjs` | Playwright flows | C |

---

## Task 0 — Foundation ✅ (commit `5ff0407`)

Already built and verified: generator (golden test reproduces the hand-written plan; 1008-combo validity sweep), zone-proof time math, v1 migration (byte-identical events; verified against the real backup under Chicago/Tokyo/London device zones), vitest wiring. `npm test` → 26 passing. **Do not rewrite these files; extend only if a task says so.**

---

# SESSION A — foundation logic (Sat AM)

Order: **A1 → (A2 ‖ A3) → (A4 → A5) ‖ A6 → (A7 ‖ A8) → A9** (A9 is an independent lane — start it as soon as A8's backup format is settled). A2 and A3 touch disjoint files and may run as parallel agents; so may A5 and A6; so may A7's per-file edits.

### Task A1: `plan.js` becomes plan-as-data helpers

**Files:** Modify `src/plan.js`, `src/legacyPlan.js` · Test `src/__tests__/plan.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/__tests__/plan.test.js
import { describe, it, expect } from 'vitest';
import { stageForDay, capForDay } from '../plan.js';
import { LEGACY_PLAN } from '../legacyPlan.js';

describe('plan helpers read from a plan object', () => {
  it('finds the stage for a day', () => {
    expect(stageForDay(LEGACY_PLAN, 0)).toBeNull();
    expect(stageForDay(LEGACY_PLAN, 1).name).toBe('Baseline hold');
    expect(stageForDay(LEGACY_PLAN, 11).name).toBe('First cut');
    expect(stageForDay(LEGACY_PLAN, 60).name).toBe('Quit day');
    expect(stageForDay(LEGACY_PLAN, 999).name).toBe('Quit day'); // post-quit
  });
  it('caps: pre-plan is unjudged, post-quit is zero', () => {
    expect(capForDay(LEGACY_PLAN, 0)).toBe(LEGACY_PLAN.baseline.pouchesPerDay + 1);
    expect(capForDay(LEGACY_PLAN, 1)).toBe(8);
    expect(capForDay(LEGACY_PLAN, 59)).toBe(1);
    expect(capForDay(LEGACY_PLAN, 61)).toBe(0);
  });
  it('legacy plan is self-contained data', () => {
    expect(LEGACY_PLAN).toMatchObject({ generator: 'legacy-60', startDate: '2026-07-08', quitDate: '2026-09-05', totalDays: 60, baseline: { pouchesPerDay: 9, mg: 9 } });
    expect(LEGACY_PLAN.stages).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`stageForDay` currently takes one argument): `npx vitest run src/__tests__/plan.test.js`

- [ ] **Step 3: Implement**
  - Move the `slot` helper, `MEAL_SLOTS`, and the entire `STAGES` array **verbatim** from `src/plan.js` into `src/legacyPlan.js`; inline the four constants so `legacyPlan.js` imports nothing:

```js
export const LEGACY_PLAN = {
  generator: 'legacy-60',
  startDate: '2026-07-08',
  quitDate: '2026-09-05',
  totalDays: 60,
  baseline: { pouchesPerDay: 9, mg: 9 },
  stages: STAGES, // the verbatim array, now local to this file
};
```

  - Replace `src/plan.js` with exactly: the header comment below, these two helpers, and the existing `RECOVERY_MILESTONES` and `WITHDRAWAL_NOTES` exports unchanged. **Delete** `START_DATE`, `QUIT_DATE`, `TOTAL_DAYS`, `BASELINE`, `STAGES` so stale imports break the build loudly.

```js
// Helpers over a plan object (see planGenerator.js / legacyPlan.js) plus
// static recovery content. There is no global plan: every attempt owns its own.

export function stageForDay(plan, dayNum) {
  if (dayNum < 1) return null; // pre-plan
  if (dayNum > plan.totalDays) return plan.stages[plan.stages.length - 1]; // post-quit
  return plan.stages.find((s) => dayNum >= s.days[0] && dayNum <= s.days[1]);
}

export function capForDay(plan, dayNum) {
  if (dayNum < 1) return plan.baseline.pouchesPerDay + 1; // pre-plan: not judged
  const s = stageForDay(plan, dayNum);
  return s ? s.pouchesPerDay : 0;
}
```

- [ ] **Step 4: Run — expect PASS** for `plan.test.js` and the existing generator golden test. (The app build is expected to be broken until A7; that is fine on this branch.)
- [ ] **Step 5: Commit** `git add src/plan.js src/legacyPlan.js src/__tests__/plan.test.js && git commit -m "plan.js: helpers over a plan object; freeze legacy plan as data"`

### Task A2: `store.js` derives from the attempt; honest scoring

**Files:** Modify `src/store.js` · Test `src/__tests__/store.test.js`

`state` below always means *an attempt* (`{ status, archivedAt, settings, plan, events, … }`).

- [ ] **Step 1: Write the failing tests**

```js
// src/__tests__/store.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePlan } from '../planGenerator.js';
import * as S from '../store.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const pouches = (day, n) => Array.from({ length: n }, () => ev('pouch', day));
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T17:00:00.000Z')); }); // day 5, noon CT
afterEach(() => vi.useRealTimers());

describe('day math comes from the attempt\'s plan', () => {
  it('numbers days from plan.startDate', () => {
    const s = attempt([]);
    expect(S.dayNumberFor(s, '2026-09-21')).toBe(1);
    expect(S.dayNumberFor(s, '2026-09-20')).toBe(0);
    expect(S.dateForDayNumber(s, 16)).toBe('2026-10-06');
  });
  it('buckets events by their stamped day, not the device zone', () => {
    const s = attempt([{ ...ev('pouch', '2026-09-22'), ts: '2026-09-23T08:30:00.000Z' }]); // 3:30am CT on the 23rd
    expect(S.pouchesForDay(s, '2026-09-22')).toBe(1);
    expect(S.pouchesForDay(s, '2026-09-23')).toBe(0);
  });
});

describe('honest scoring', () => {
  it('a past day with no log is nolog, never green', () => {
    const s = attempt([...pouches('2026-09-21', 8)]);
    expect(S.statusForDay(s, '2026-09-21')).toBe('green');
    expect(S.statusForDay(s, '2026-09-22')).toBe('nolog');
    expect(S.statusForDay(s, '2026-09-25')).toBe('today-under');
    expect(S.statusForDay(s, '2026-09-26')).toBe('future');
    expect(S.statusForDay(s, '2026-09-20')).toBe('pre');
  });
  it('over cap is yellow; a resisted-only day counts as logged', () => {
    const s = attempt([...pouches('2026-09-21', 9), ev('resisted', '2026-09-22')]);
    expect(S.statusForDay(s, '2026-09-21')).toBe('yellow');
    expect(S.statusForDay(s, '2026-09-22')).toBe('green');
    expect(S.isLogged(s, '2026-09-23')).toBe(false);
  });
  it('a check-in alone does not make a day logged', () => {
    const s = attempt([ev('checkin', '2026-09-22', { sleepQuality: 3 })]);
    expect(S.isLogged(s, '2026-09-22')).toBe(false);
    expect(S.statusForDay(s, '2026-09-22')).toBe('nolog');
  });
  it('backfill counts toward used and makes the day logged', () => {
    const s = attempt([ev('backfill', '2026-09-22', { count: 6, streak: 'keep' })]);
    expect(S.pouchesForDay(s, '2026-09-22')).toBe(6);
    expect(S.statusForDay(s, '2026-09-22')).toBe('green');
  });
});

describe('streaks', () => {
  const four = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
  it('counts consecutive green days; today unlogged neither extends nor breaks', () => {
    expect(S.streaks(attempt(four.flatMap((d) => pouches(d, 8))))).toEqual({ current: 4, best: 4 });
  });
  it('today logged under cap extends it', () => {
    expect(S.streaks(attempt([...four, '2026-09-25'].flatMap((d) => pouches(d, 3)))).current).toBe(5);
  });
  it('a nolog day breaks it', () => {
    const s = attempt([...pouches('2026-09-21', 8), ...pouches('2026-09-22', 8), ...pouches('2026-09-24', 8)]);
    expect(S.streaks(s)).toEqual({ current: 1, best: 2 });
  });
  it('an over day breaks it', () => {
    const s = attempt([...pouches('2026-09-23', 9), ...pouches('2026-09-24', 8)]);
    expect(S.streaks(s).current).toBe(1);
  });
  it('backfill keep preserves, backfill break breaks — the user\'s call', () => {
    const base = [...pouches('2026-09-21', 8), ...pouches('2026-09-22', 8), ...pouches('2026-09-24', 8)];
    expect(S.streaks(attempt([...base, ev('backfill', '2026-09-23', { count: 7, streak: 'keep' })])).current).toBe(4);
    expect(S.streaks(attempt([...base, ev('backfill', '2026-09-23', { count: 7, streak: 'break' })])).current).toBe(1);
  });
  it('an over-cap backfill breaks regardless of the flag', () => {
    const s = attempt([...pouches('2026-09-22', 8), ev('backfill', '2026-09-23', { count: 12, streak: 'keep' }), ...pouches('2026-09-24', 8)]);
    expect(S.streaks(s).current).toBe(1);
  });
  it('an archived attempt is scored as of its end, not today', () => {
    const s = attempt(pouches('2026-09-21', 8), { status: 'archived', archivedAt: '2026-09-23T18:00:00.000Z' });
    expect(S.asOfDay(s)).toBe('2026-09-23');
    expect(S.streaks(s)).toEqual({ current: 0, best: 1 });
  });
});

describe('missedDays (the backfill prompt list)', () => {
  it('lists recent nolog days newest first, max 3, never today', () => {
    expect(S.missedDays(attempt(pouches('2026-09-21', 8))).map((m) => m.day)).toEqual(['2026-09-24', '2026-09-23', '2026-09-22']);
  });
  it('carries the cap for each day and is empty for archived attempts', () => {
    expect(S.missedDays(attempt([]))[0]).toMatchObject({ day: '2026-09-24', dayNum: 4, cap: 8 });
    expect(S.missedDays(attempt([], { status: 'archived', archivedAt: '2026-09-25T00:00:00Z' }))).toEqual([]);
  });
});

describe('discipline stats', () => {
  it('counts backfilled pouches in their own bucket', () => {
    const d = S.disciplineStats(attempt([ev('backfill', '2026-09-22', { count: 5, streak: 'keep' })]));
    expect(d.backfilled).toBe(5);
    expect(d.onTime + d.early + d.overCap).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**: `npx vitest run src/__tests__/store.test.js`

- [ ] **Step 3: Implement** — edit `src/store.js`:
  1. Imports: `import { stageForDay, capForDay } from './plan.js';` and `import { stampNow, dayKeyOf, localHM } from './time.js';`. Delete the `START_DATE/TOTAL_DAYS/BASELINE` import, `KEY`, `SCHEMA_VERSION`, `DAY_CUTOFF_HOURS`, `DEFAULT_SETTINGS`, `loadState`, `freshState`, `migrate`, `saveState` (persistence moves to `root.js`, A3).
  2. Replace day/time helpers:

```js
let idCounter = 0;
export function makeEvent(type, trigger = null, now = new Date()) {
  return { id: `${now.getTime()}-${idCounter++}`, ...stampNow(now), type, trigger };
}

export function todayKey(now = new Date()) {
  return stampNow(now).day;
}

export function dayKeyFor(tsOrEvent) { // kept for callers holding only a timestamp
  return dayKeyOf(typeof tsOrEvent === 'string' ? { ts: tsOrEvent } : tsOrEvent);
}

export function fmtTime(tsOrEvent) {
  const { h, m } = localHM(typeof tsOrEvent === 'object' && tsOrEvent.ts ? tsOrEvent : { ts: new Date(tsOrEvent).toISOString() });
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function dayNumberFor(state, dateStr) {
  const start = new Date(`${state.plan.startDate}T12:00:00`);
  return Math.round((new Date(`${dateStr}T12:00:00`) - start) / 86400000) + 1;
}

export function dateForDayNumber(state, n) {
  const d = new Date(`${state.plan.startDate}T12:00:00`);
  d.setDate(d.getDate() + n - 1);
  return localDateStr(d);
}

// The day an attempt is scored "as of": today while active; for an archived
// attempt, the earlier of the day it was archived and its quit date.
export function asOfDay(state) {
  if (state.status !== 'archived') return todayKey();
  const archived = dayKeyFor(state.archivedAt);
  return archived < state.plan.quitDate ? archived : state.plan.quitDate;
}
```

  3. Replace counting + status + streak:

```js
export function eventsForDay(state, dateStr) {
  return state.events.filter((e) => dayKeyOf(e) === dateStr);
}

// Pouches used that day: taps plus anything backfilled afterwards.
export function pouchesForDay(state, dateStr) {
  let n = 0;
  for (const e of eventsForDay(state, dateStr)) {
    if (e.type === 'pouch') n++;
    else if (e.type === 'backfill') n += e.count;
  }
  return n;
}

// Silence is not success: a day counts as logged only if the user told the app
// something about nicotine that day. A sleep check-in alone doesn't.
export function isLogged(state, dateStr) {
  return eventsForDay(state, dateStr).some((e) => e.type === 'pouch' || e.type === 'resisted' || e.type === 'backfill');
}

// 'future' | 'pre' | 'green' | 'yellow' | 'nolog' | 'today-under' | 'today-over'
export function statusForDay(state, dateStr) {
  const today = asOfDay(state);
  const n = dayNumberFor(state, dateStr);
  if (dateStr > today) return 'future';
  if (n < 1) return 'pre';
  const over = pouchesForDay(state, dateStr) > capForDay(state.plan, n);
  if (dateStr === today && state.status !== 'archived') return over ? 'today-over' : 'today-under';
  if (n <= state.plan.totalDays && !isLogged(state, dateStr)) return 'nolog';
  return over ? 'yellow' : 'green';
}

export function dayCountsForStreak(state, dateStr) {
  if (!isLogged(state, dateStr)) return false;
  if (pouchesForDay(state, dateStr) > capForDay(state.plan, dayNumberFor(state, dateStr))) return false;
  return !eventsForDay(state, dateStr).some((e) => e.type === 'backfill' && e.streak === 'break');
}

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
```

  4. Mechanical sweep through the rest of the file — every remaining function:
     - `dayNumberFor(x)` → `dayNumberFor(state, x)`; `dateForDayNumber(n)` → `dateForDayNumber(state, n)`
     - `stageForDay(n)` → `stageForDay(state.plan, n)`; `capForDay(n)` → `capForDay(state.plan, n)`
     - `TOTAL_DAYS` → `state.plan.totalDays`; `BASELINE` → `state.plan.baseline`
     - `dayKeyFor(e.ts)` on an event → `dayKeyOf(e)`
     - `plannedMgForDay(n)` → `plannedMgForDay(state, n)`
     - `firstPouchTimes` / `hourHistogram`: replace `new Date(e.ts).getHours()/getMinutes()` with `localHM(e)`
     - `mgForDay`: multiply `pouchesForDay` (which now includes backfill) by the stage mg — unchanged otherwise
     - **Delete `moneySaved`** (replaced by `money.js`, A4).
  5. `disciplineStats`: add `backfilled: 0` to `zero()` (make sure `backfilled` is part of the returned totals), and before the loop's `if (ev.type !== 'pouch') continue;` add `if (ev.type === 'backfill') { totals.backfilled += ev.count; continue; }`.
  6. `markdownSummary(state, days)`: iterate `for (let i = Math.max(1, last - days + 1); i <= last; i++)` where `const last = Math.min(dayNumberFor(state, asOfDay(state)), state.plan.totalDays)`; when `!isLogged(state, d)` emit `| ${i} | ${d} | ${capForDay(state.plan, i)} | — | — | — | — | — | — | no log |`. Replace the `Saved:` figure with `moneyStats(state).kept` once A4 lands (A4 step 5 does this).
  7. Leave `fullBackup` for A8.

- [ ] **Step 4: Run — expect PASS**: `npx vitest run src/__tests__/store.test.js`
- [ ] **Step 5: Commit** `git add src/store.js src/__tests__/store.test.js && git commit -m "store: derive from the attempt's plan; honest scoring, streaks, missed days"`

### Task A3: `root.js` — the v2 root (parallel with A2)

**Files:** Create `src/root.js` · Test `src/__tests__/root.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// src/__tests__/root.test.js
import { describe, it, expect } from 'vitest';
import { KEY_V1, KEY_V2, DEFAULT_SETTINGS, freshRoot, loadRoot, saveRoot, startAttempt, archiveActive, updateAttempt, attemptById, lastSettings } from '../root.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), _m: m }; };
const NOW = '2026-09-20T18:00:00.000Z';
const V1 = JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-ant-TEST' }, events: [{ id: 'e1', ts: '2026-07-08T11:33:12.569Z', type: 'pouch', trigger: null }], celebratedStages: [1], checkinDismissedFor: null });
const plan = { generator: 'gen-1', startDate: '2026-09-21', quitDate: '2026-12-19', totalDays: 90, baseline: { pouchesPerDay: 9, mg: 9 }, stages: [] };

describe('loadRoot', () => {
  it('nothing stored → fresh root', () => expect(loadRoot(mem(), NOW)).toEqual({ root: freshRoot(), problem: null }));
  it('v1 only → migrates to one archived attempt', () => {
    const { root, problem } = loadRoot(mem({ [KEY_V1]: V1 }), NOW);
    expect(problem).toBeNull();
    expect(root.attempts.map((a) => [a.id, a.status])).toEqual([['a1', 'archived']]);
    expect(root.device.apiKey).toBe('sk-ant-TEST');
  });
  it('NEVER touches the v1 key', () => {
    const s = mem({ [KEY_V1]: V1 });
    saveRoot(loadRoot(s, NOW).root, s);
    expect(s.getItem(KEY_V1)).toBe(V1);
    expect(JSON.parse(s.getItem(KEY_V2)).version).toBe(2);
  });
  it('v2 wins over v1 once it exists', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: JSON.stringify({ ...freshRoot(), activeAttemptId: 'a9' }) });
    expect(loadRoot(s, NOW).root.activeAttemptId).toBe('a9');
  });
  it('corrupt v2 is reported, not papered over', () => {
    expect(loadRoot(mem({ [KEY_V2]: '{nope' }), NOW).problem).toBe('corrupt');
    expect(loadRoot(mem({ [KEY_V2]: '{"version":7}' }), NOW).problem).toBe('corrupt');
  });
  it('a v1 blob that will not migrate is reported', () => {
    expect(loadRoot(mem({ [KEY_V1]: '{nope' }), NOW).problem).toBe('migration-failed');
  });
});

describe('attempt lifecycle', () => {
  it('starts, updates immutably, archives, and numbers attempts', () => {
    const r0 = loadRoot(mem({ [KEY_V1]: V1 }), NOW).root;
    const r1 = startAttempt(r0, { plan, settings: DEFAULT_SETTINGS, now: NOW });
    expect(r1.activeAttemptId).toBe('a2');
    expect(attemptById(r1, 'a2')).toMatchObject({ status: 'active', archivedAt: null, events: [], plan });
    expect(r0.attempts).toHaveLength(1); // not mutated
    const r2 = updateAttempt(r1, 'a2', (a) => ({ ...a, events: [...a.events, { id: 'x' }] }));
    expect(attemptById(r2, 'a2').events).toHaveLength(1);
    expect(attemptById(r1, 'a2').events).toHaveLength(0);
    const r3 = archiveActive(r2, '2026-12-20T00:00:00.000Z');
    expect(r3.activeAttemptId).toBeNull();
    expect(attemptById(r3, 'a2')).toMatchObject({ status: 'archived', archivedAt: '2026-12-20T00:00:00.000Z' });
  });
  it('refuses a second active attempt', () => {
    const r1 = startAttempt(freshRoot(), { plan, settings: DEFAULT_SETTINGS, now: NOW });
    expect(() => startAttempt(r1, { plan, settings: DEFAULT_SETTINGS, now: NOW })).toThrow();
  });
  it('lastSettings carries over from the most recent attempt', () => {
    expect(lastSettings(freshRoot())).toEqual(DEFAULT_SETTINGS);
    const r = loadRoot(mem({ [KEY_V1]: V1.replace('"costPerTin":5', '"costPerTin":6.5') }), NOW).root;
    expect(lastSettings(r).costPerTin).toBe(6.5);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing).
- [ ] **Step 3: Implement**

```js
// src/root.js
// The v2 root: a list of self-contained attempts plus device-only secrets.
// The v1 key is read once for migration and never written — it is the rollback.

import { migrateV1 } from './migrate.js';
import { LEGACY_PLAN } from './legacyPlan.js';

export const KEY_V1 = 'pouch-down-v1';
export const KEY_V2 = 'pouch-down-v2';

export const DEFAULT_SETTINGS = {
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  costPerTin: 5,
  pouchesPerTin: 20,
  wakeTime: '07:00',
  sleepTime: '23:00',
};

export function freshRoot() {
  return { version: 2, device: { apiKey: '' }, activeAttemptId: null, attempts: [] };
}

// → { root, problem: null | 'corrupt' | 'migration-failed' }. With a problem the
// returned root is a placeholder: the caller must NOT save it over what's stored.
export function loadRoot(storage = localStorage, now = new Date().toISOString()) {
  const rawV2 = storage.getItem(KEY_V2);
  if (rawV2) {
    try {
      const root = JSON.parse(rawV2);
      if (root?.version === 2 && Array.isArray(root.attempts)) return { root: { ...freshRoot(), ...root }, problem: null };
    } catch { /* fall through */ }
    return { root: freshRoot(), problem: 'corrupt' };
  }
  const rawV1 = storage.getItem(KEY_V1);
  if (rawV1) {
    try {
      return { root: migrateV1(JSON.parse(rawV1), { legacyPlan: LEGACY_PLAN, now }), problem: null };
    } catch {
      return { root: freshRoot(), problem: 'migration-failed' };
    }
  }
  return { root: freshRoot(), problem: null };
}

export function saveRoot(root, storage = localStorage) {
  storage.setItem(KEY_V2, JSON.stringify(root));
}

export const attemptById = (root, id) => root.attempts.find((a) => a.id === id) ?? null;

export function updateAttempt(root, id, fn) {
  return { ...root, attempts: root.attempts.map((a) => (a.id === id ? fn(a) : a)) };
}

export function startAttempt(root, { plan, settings, now = new Date().toISOString() }) {
  if (root.activeAttemptId) throw new Error('an attempt is already active');
  const id = `a${root.attempts.length + 1}`;
  const attempt = { id, status: 'active', createdAt: now, archivedAt: null, settings, plan, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
  return { ...root, activeAttemptId: id, attempts: [...root.attempts, attempt] };
}

export function archiveActive(root, now = new Date().toISOString()) {
  if (!root.activeAttemptId) return root;
  const next = updateAttempt(root, root.activeAttemptId, (a) => ({ ...a, status: 'archived', archivedAt: now }));
  return { ...next, activeAttemptId: null };
}

export function lastSettings(root) {
  const last = root.attempts[root.attempts.length - 1];
  return last ? { ...DEFAULT_SETTINGS, ...last.settings } : { ...DEFAULT_SETTINGS };
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git add src/root.js src/__tests__/root.test.js && git commit -m "root: v2 storage, attempt lifecycle, v1 key never written"`

### Task A4: `money.js`

**Files:** Create `src/money.js` · Test `src/__tests__/money.test.js` · Modify `src/store.js` (markdown footer)

- [ ] **Step 1: Failing test** (reuse the `attempt/pouches/ev` fixture helpers from `store.test.js` — copy them into this file):

```js
describe('moneyStats counts logged days only', () => {
  it('ignores days with no log entirely', () => {
    const m = moneyStats(attempt([...pouches('2026-09-21', 8), ...pouches('2026-09-23', 6)])); // 22nd + 24th: nolog
    expect(m.perPouch).toBe(0.25);
    expect(m.loggedDays).toBe(2);
    expect(m.oldPace).toBeCloseTo(4.5);  // 2 days × 9 × $0.25
    expect(m.spent).toBeCloseTo(3.5);    // 14 × $0.25
    expect(m.kept).toBeCloseTo(1.0);
  });
  it('goes negative honestly when over the old pace', () => {
    expect(moneyStats(attempt(pouches('2026-09-21', 13))).kept).toBeCloseTo(-1.0);
  });
  it('counts backfilled pouches as spent', () => {
    expect(moneyStats(attempt([ev('backfill', '2026-09-22', { count: 5, streak: 'keep' })])).spent).toBeCloseTo(1.25);
  });
  it('projects what quitting is worth', () => {
    expect(moneyStats(attempt([])).afterQuit).toEqual({ perMonth: 67.5, perYear: 821.25 });
  });
  it('survives a zero pouches-per-tin setting', () => {
    expect(moneyStats(attempt([], { settings: { ...settings, pouchesPerTin: 0 } })).perPouch).toBe(0);
  });
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```js
// src/money.js
// What the taper is worth, counted over logged days only — an unlogged day
// saves nothing, because nobody knows what happened on it.

import { asOfDay, dayNumberFor, dateForDayNumber, isLogged, pouchesForDay } from './store.js';

export function moneyStats(state) {
  const { costPerTin, pouchesPerTin } = state.settings;
  const perPouch = pouchesPerTin > 0 ? costPerTin / pouchesPerTin : 0;
  const base = state.plan.baseline.pouchesPerDay;
  const endN = Math.min(dayNumberFor(state, asOfDay(state)), state.plan.totalDays);
  let loggedDays = 0, used = 0;
  for (let i = 1; i <= endN; i++) {
    const d = dateForDayNumber(state, i);
    if (!isLogged(state, d)) continue;
    loggedDays++;
    used += pouchesForDay(state, d);
  }
  const oldPace = loggedDays * base * perPouch;
  const spent = used * perPouch;
  return { perPouch, loggedDays, oldPace, spent, kept: oldPace - spent, afterQuit: { perMonth: base * perPouch * 30, perYear: base * perPouch * 365 } };
}
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5:** In `store.js` `markdownSummary`, import `moneyStats` lazily to avoid a cycle — pass it in instead: change the signature to `markdownSummary(state, days = 7, kept = null)` and render `Kept: $${kept.toFixed(2)}` only when `kept != null`; callers (`SettingsSheet`, `coach.js`) pass `moneyStats(state).kept`.
- [ ] **Step 6: Commit** `git commit -m "money: logged-days-only model (old pace / spent / kept / after-quit)"`

### Task A5: `awards.js` (parallel with A6)

**Files:** Create `src/awards.js` · Test `src/__tests__/awards.test.js`

- [ ] **Step 1: Failing tests** (same fixtures as `store.test.js`, plus `import { awardsFor } from '../awards.js'` and `import { LEGACY_PLAN } from '../legacyPlan.js'`; system time 2026-09-25 unless noted):

```js
const get = (s, id) => awardsFor(s).find((a) => a.id === id);
const days = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });

it('every award has the full shape and a unique id', () => {
  const all = awardsFor(attempt([]));
  expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
  for (const a of all) { expect(a).toMatchObject({ id: expect.any(String), tier: expect.stringMatching(/bronze|silver|gold|aurora/), title: expect.any(String), body: expect.any(String), earned: false, earnedOn: null }); expect(a.progress).toBeGreaterThanOrEqual(0); expect(a.progress).toBeLessThanOrEqual(1); }
});
it('showed-up: first log', () => expect(get(attempt(pouches('2026-09-22', 1)), 'showed-up')).toMatchObject({ earned: true, earnedOn: '2026-09-22' }));
it('streak-3 earns on the third green day and shows progress before', () => {
  expect(get(attempt(days('2026-09-21', 2).flatMap((d) => pouches(d, 8))), 'streak-3')).toMatchObject({ earned: false, progress: 2 / 3 });
  expect(get(attempt(days('2026-09-21', 3).flatMap((d) => pouches(d, 8))), 'streak-3')).toMatchObject({ earned: true, earnedOn: '2026-09-23' });
});
it('streak badges never un-earn after a slip', () => {
  const s = attempt([...days('2026-09-21', 3).flatMap((d) => pouches(d, 8)), ...pouches('2026-09-24', 12)]);
  expect(get(s, 'streak-3').earned).toBe(true);
});
it('honest-yellow rewards logging an over day', () => expect(get(attempt(pouches('2026-09-21', 12)), 'honest-yellow').earned).toBe(true));
it('came-back: logging right after a nolog day', () => {
  expect(get(attempt([...pouches('2026-09-21', 8), ...pouches('2026-09-23', 8)]), 'came-back')).toMatchObject({ earned: true, earnedOn: '2026-09-23' });
});
it('full-week: 7 logged days in a row, on plan or not', () => {
  vi.setSystemTime(new Date('2026-09-28T17:00:00Z'));
  expect(get(attempt(days('2026-09-21', 7).flatMap((d) => pouches(d, 12))), 'full-week').earned).toBe(true);
});
it('rode-it-out: resisted cravings', () => {
  expect(get(attempt([ev('resisted', '2026-09-21')]), 'rode-it-out').earned).toBe(true);
  expect(get(attempt([ev('resisted', '2026-09-21')]), 'rode-it-out-10')).toMatchObject({ earned: false, progress: 0.1 });
});
it('first-cut: 7 green days from the first cut', () => {
  vi.setSystemTime(new Date('2026-10-13T17:00:00Z'));
  expect(get(attempt(days('2026-10-06', 7).flatMap((d) => pouches(d, 6))), 'first-cut')).toMatchObject({ earned: true, earnedOn: '2026-10-12' });
});
it('stage awards need the stage finished and ≥70% logged', () => {
  vi.setSystemTime(new Date('2026-10-06T17:00:00Z'));
  expect(get(attempt(days('2026-09-21', 11).flatMap((d) => pouches(d, 8))), 'stage-1').earned).toBe(true);  // 11/15
  expect(get(attempt(days('2026-09-21', 10).flatMap((d) => pouches(d, 8))), 'stage-1').earned).toBe(false); // 10/15
});
it('kept-25 tracks the money model', () => {
  vi.setSystemTime(new Date('2026-10-20T17:00:00Z'));
  const s = attempt(days('2026-09-21', 29).flatMap((d) => pouches(d, 5))); // 29 × 4 × $0.25 = $29
  expect(get(s, 'kept-25').earned).toBe(true);
  expect(get(s, 'kept-100')).toMatchObject({ earned: false, progress: 0.29 });
});
it('works on the legacy plan, which has no stage.kind', () => {
  expect(() => awardsFor(attempt([], { plan: LEGACY_PLAN }))).not.toThrow();
});
```

- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement**

```js
// src/awards.js
// Awards are derived at read time from the log, like everything else — nothing
// is stored except which unlock celebrations have already played. They reward
// showing up and telling the truth; slips are never punished.

import { asOfDay, dayNumberFor, dateForDayNumber, eventsForDay, isLogged, pouchesForDay, dayCountsForStreak, classifyPouch } from './store.js';
import { capForDay } from './plan.js';

const STREAKS = [[3, 'bronze'], [7, 'bronze'], [14, 'silver'], [30, 'gold'], [60, 'gold'], [90, 'aurora']];

function dayFacts(state) {
  const perPouch = state.settings.pouchesPerTin > 0 ? state.settings.costPerTin / state.settings.pouchesPerTin : 0;
  const endN = Math.min(dayNumberFor(state, asOfDay(state)), state.plan.totalDays);
  const facts = [];
  let kept = 0, resisted = 0;
  for (let n = 1; n <= endN; n++) {
    const day = dateForDayNumber(state, n);
    const evs = eventsForDay(state, day);
    const taps = evs.filter((e) => e.type === 'pouch');
    const logged = isLogged(state, day);
    const used = pouchesForDay(state, day);
    if (logged) kept += (state.plan.baseline.pouchesPerDay - used) * perPouch;
    resisted += evs.filter((e) => e.type === 'resisted').length;
    facts.push({
      n, day, logged, kept, resisted,
      green: dayCountsForStreak(state, day),
      over: logged && used > capForDay(state.plan, n),
      allOnTime: taps.length > 0 && !evs.some((e) => e.type === 'backfill') && taps.every((e) => classifyPouch(state, e).bucket === 'on-time'),
    });
  }
  return facts;
}

// First day a run of `pred`-true days reaches `len`, plus the best run seen.
function runTo(facts, pred, len, from = 0) {
  let run = 0, best = 0;
  for (let i = from; i < facts.length; i++) {
    run = pred(facts[i]) ? run + 1 : 0;
    if (run > best) best = run;
    if (run >= len) return { on: facts[i].day, best: len };
  }
  return { on: null, best };
}

const firstDay = (facts, pred) => facts.find(pred)?.day ?? null;

export function awardsFor(state) {
  const facts = dayFacts(state);
  const out = [];
  const add = (id, tier, title, body, earnedOn, progress = 0) =>
    out.push({ id, tier, title, body, earned: earnedOn != null, earnedOn: earnedOn ?? null, progress: earnedOn != null ? 1 : Math.max(0, Math.min(1, progress)) });

  add('showed-up', 'bronze', 'Showed up', 'Your first log. Everything else is built on this.', firstDay(facts, (f) => f.logged));

  for (const [len, tier] of STREAKS) {
    if (len > state.plan.totalDays) continue;
    const r = runTo(facts, (f) => f.green, len);
    add(`streak-${len}`, tier, `${len}-day streak`, `${len} days in a row, logged and on plan.`, r.on, r.best / len);
  }

  const week = runTo(facts, (f) => f.logged, 7);
  add('full-week', 'silver', 'Full week logged', 'Seven straight days of telling the app the truth — on plan or not.', week.on, week.best / 7);

  add('honest-yellow', 'silver', 'Honest yellow', 'You logged a day you went over. A true yellow beats a fake green.', firstDay(facts, (f) => f.over));

  const back = facts.find((f, i) => i > 0 && f.logged && !facts[i - 1].logged && facts.slice(0, i).some((p) => p.logged));
  add('came-back', 'silver', 'Came back', 'You missed a day and logged the next one. That is the whole skill.', back?.day ?? null);

  const total = facts.at(-1)?.resisted ?? 0;
  add('rode-it-out', 'bronze', 'Rode it out', 'A craving came and went without a pouch.', firstDay(facts, (f) => f.resisted >= 1), total);
  add('rode-it-out-10', 'gold', 'Ten waves', 'Ten cravings ridden out. They pass whether you feed them or not.', firstDay(facts, (f) => f.resisted >= 10), total / 10);

  add('on-the-clock', 'gold', 'On the clock', 'A full day with every pouch at or after its slot. Not one early.', firstDay(facts, (f) => f.allOnTime));

  const stages = state.plan.stages;
  const cut = stages.find((s) => s.kind === 'cut') ?? stages.find((s) => s.pouchesPerDay < stages[0].pouchesPerDay);
  if (cut) {
    const r = runTo(facts, (f) => f.green, 7, cut.days[0] - 1);
    const clean = r.on && dayNumberFor(state, r.on) === cut.days[0] + 6; // must start AT the cut
    add('first-cut', 'gold', 'Survived the first cut', 'Seven on-plan days straight from the first step down — the hardest stretch.', clean ? r.on : null, clean ? 1 : Math.min(r.best, 6) / 7);
  }

  for (const s of stages) {
    if (s.pouchesPerDay === 0) continue;
    const span = facts.filter((f) => f.n >= s.days[0] && f.n <= s.days[1]);
    const length = s.days[1] - s.days[0] + 1;
    const finished = span.length === length && (state.status === 'archived' || span.at(-1).day < asOfDay(state));
    const share = span.filter((f) => f.logged).length / length;
    add(`stage-${s.id}`, 'silver', `${s.name} — cleared`, `You logged your way through ${s.name.toLowerCase()}.`, finished && share >= 0.7 ? span.at(-1).day : null, share / 0.7);
  }

  for (const [amt, tier] of [[25, 'silver'], [100, 'gold']]) {
    const keptNow = facts.at(-1)?.kept ?? 0;
    add(`kept-${amt}`, tier, `$${amt} kept`, `$${amt} that stayed in your pocket, counted on logged days only.`, firstDay(facts, (f) => f.kept >= amt), keptNow / amt);
  }

  const quit = stages.at(-1);
  const q = facts.find((f) => f.n === quit.days[0]);
  add('day-zero', 'aurora', 'Day zero', 'Quit day, logged, at zero.', q && q.logged && pouchesForDay(state, q.day) === 0 ? q.day : null);

  return out;
}

export const newlyEarned = (state) => awardsFor(state).filter((a) => a.earned && !state.celebratedAwards.includes(a.id));
```

- [ ] **Step 4: Run — PASS.** If `first-cut` progress math disagrees with a test, the test is the contract — fix the code.
- [ ] **Step 5: Commit** `git commit -m "awards: derived catalog (streaks, honesty, stages, money, quit day)"`

### Task A6: `state.jsx` — provider over the root (parallel with A5)

**Files:** Rewrite `src/state.jsx`

`useApp()` returns `{ root, state, readOnly, problem, device, api, tick }`. `state` = the attempt being viewed, else the active attempt, else `null`.

- [ ] **Step 1: Implement**

```jsx
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { loadRoot, saveRoot, freshRoot, attemptById, updateAttempt, startAttempt, archiveActive } from './root.js';
import { makeEvent, pouchCtxForNow, todayKey } from './store.js';

// Mood tags may only *complete* the just-made log — same spirit as undo.
const TAG_WINDOW_MS = 15000;

const Ctx = createContext(null);

export function AppStateProvider({ children }) {
  const [{ root, problem }, setLoaded] = useState(() => loadRoot());
  const [viewingId, setViewingId] = useState(null);
  const [tick, setTick] = useState(0); // re-render clock for countdowns
  // The api is memoized once, so it reads "are we viewing the past?" through a ref.
  const viewingRef = useRef(null);
  viewingRef.current = viewingId;

  // Never save over stored data we could not read.
  useEffect(() => { if (!problem) saveRoot(root); }, [root, problem]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const api = useMemo(() => {
    const setRoot = (fn) => setLoaded((l) => (l.problem ? l : { ...l, root: fn(l.root) }));
    // Every log mutation goes through here: active attempt only, never while viewing the past.
    const onActive = (fn) => setRoot((r) => (r.activeAttemptId && !viewingRef.current ? updateAttempt(r, r.activeAttemptId, fn) : r));
    const append = (ev) => onActive((a) => ({ ...a, events: [...a.events, ev] }));
    return {
      logPouch(trigger = null) {
        const ev = makeEvent('pouch', trigger);
        onActive((a) => ({ ...a, events: [...a.events, { ...ev, ctx: pouchCtxForNow(a) }] }));
        return ev.id;
      },
      logResisted(trigger = null) { const ev = makeEvent('resisted', trigger); append(ev); return ev.id; },
      logCheckin({ sleepQuality, sleepScore, sleepHours, workout, source = 'manual' } = {}) {
        const ev = { ...makeEvent('checkin'), source };
        if (sleepQuality != null) ev.sleepQuality = sleepQuality;
        if (sleepScore != null) ev.sleepScore = sleepScore;
        if (sleepHours != null) ev.sleepHours = sleepHours;
        if (typeof workout === 'boolean') ev.workout = workout;
        append(ev);
        return ev.id;
      },
      // Fills in a day that has no log. `day` is the day being filled, not today.
      logBackfill({ day, count, streak }) {
        const ev = { ...makeEvent('backfill'), day, count, streak };
        onActive((a) => (a.events.some((e) => e.type === 'backfill' && e.day === day) ? a : { ...a, events: [...a.events, ev] }));
        return ev.id;
      },
      tagEvent(id, trigger) {
        onActive((a) => {
          const last = a.events[a.events.length - 1];
          if (!last || last.id !== id || last.type !== 'pouch') return a;
          if (Date.now() - new Date(last.ts).getTime() > TAG_WINDOW_MS) return a;
          return { ...a, events: [...a.events.slice(0, -1), { ...last, trigger }] };
        });
      },
      undoEvent(id) { onActive((a) => ({ ...a, events: a.events.filter((e) => e.id !== id) })); },
      dismissCheckinToday() { onActive((a) => ({ ...a, checkinDismissedFor: todayKey() })); },
      updateSettings(patch) { onActive((a) => ({ ...a, settings: { ...a.settings, ...patch } })); },
      markStageCelebrated(id) { onActive((a) => (a.celebratedStages.includes(id) ? a : { ...a, celebratedStages: [...a.celebratedStages, id] })); },
      markAwardCelebrated(id) { onActive((a) => (a.celebratedAwards.includes(id) ? a : { ...a, celebratedAwards: [...a.celebratedAwards, id] })); },
      updateDevice(patch) { setRoot((r) => ({ ...r, device: { ...r.device, ...patch } })); },
      startAttempt({ plan, settings }) { setRoot((r) => startAttempt(r, { plan, settings })); },
      archiveActive() { setRoot((r) => archiveActive(r)); },
      viewAttempt(id) { setViewingId(id); },
      exitViewing() { setViewingId(null); },
      // Recovery screen only: abandon unreadable storage and begin clean.
      startFresh() { setLoaded({ root: freshRoot(), problem: null }); },
    };
  }, []);

  const viewing = viewingId ? attemptById(root, viewingId) : null;
  const state = viewing ?? attemptById(root, root.activeAttemptId);
  const readOnly = !!viewing || state?.status === 'archived';

  return <Ctx.Provider value={{ root, state, readOnly, problem, device: root.device, api, tick }}>{children}</Ctx.Provider>;
}

export function useApp() {
  return useContext(Ctx);
}
```

  Note: `pouchCtxForNow(a)` must run against the pre-append attempt — it does, inside the updater.

- [ ] **Step 2: Verify** `npm run lint` — the lint baseline stays at 2 warnings (the `only-export-components` one on this file is pre-existing).
- [ ] **Step 3: Commit** `git commit -m "state: provider over the v2 root; read-only viewing; backfill + awards api"`

### Task A7: consumers compile and run on the new model

**Files:** Modify `src/coach.js`, `src/App.jsx`, and these components: `CalendarView`, `FirstPouchChart`, `HistoryTimeline`, `PlanView`, `RecoveryTimeline`, `SettingsSheet`, `TodayView`, `StatsView` (+ any other file the build flags). One agent per file is safe — they don't overlap.

- [ ] **Step 1:** Run `npm run build` and fix every error with these substitutions (the deleted constants make each site fail loudly):

| Old | New |
|---|---|
| `TOTAL_DAYS` | `state.plan.totalDays` |
| `START_DATE` / `QUIT_DATE` | `state.plan.startDate` / `state.plan.quitDate` |
| `BASELINE` | `state.plan.baseline` |
| `STAGES` | `state.plan.stages` |
| `stageForDay(n)` / `capForDay(n)` | `stageForDay(state.plan, n)` / `capForDay(state.plan, n)` |
| `dayNumberFor(d)` / `dateForDayNumber(n)` | `dayNumberFor(state, d)` / `dateForDayNumber(state, n)` |
| `currentStreak(state)` | unchanged (now honest) |
| `moneySaved(state)` | `moneyStats(state).kept` (B6 replaces the card) |
| `state.settings.apiKey` | `device.apiKey` from `useApp()`; write via `api.updateDevice({ apiKey })` |
| `new Date(e.ts).getHours()` for display | `localHM(e)` / `fmtTime(e)` |

- [ ] **Step 2:** `src/coach.js` — `askCoach(state, messages, apiKey)`; build the prompt from `state.plan`; replace every "James"/"his"/"he" with "you"/"your"; say `${state.plan.totalDays}-day` and the plan's real dates. Load the `claude-api` skill before editing. Keep `MODEL` as is.
- [ ] **Step 3:** `src/App.jsx` — temporary gate until B1: `if (problem) return <p>Storage problem: {problem}</p>; if (!state) return <p>No active attempt yet.</p>;`
- [ ] **Step 4:** Calendar/History: map status `nolog` → a gray cell/row labelled "no log" (never the green style). Add `--nolog: rgba(255,255,255,0.18)` next to the existing status colors in `src/index.css`.
- [ ] **Step 5: Verify** `npm test && npm run lint && npm run build && node docs/superpowers/reports/2026-07-10-math-harness.mjs`. The math harness imports the old `store.js` API — update its calls with the same substitution table, building an attempt fixture with `LEGACY_PLAN`; its expected numbers must not change.
- [ ] **Step 6: Commit** per file or as one: `git commit -m "consumers: read the plan from the attempt; nolog styling; coach de-personalised"`

### Task A8: backup + export on v2 (parallel with A7)

**Files:** Modify `src/store.js` (`fullBackup`), `src/components/SettingsSheet.jsx` · Test `src/__tests__/backup.test.js`

- [ ] **Step 1: Failing test**

```js
import { fullBackup } from '../store.js';
it('exports the whole root without the API key, without mutating it', () => {
  const root = { version: 2, device: { apiKey: 'sk-ant-SECRET' }, activeAttemptId: 'a2', attempts: [{ id: 'a1', events: [{ id: 'e1' }] }, { id: 'a2', events: [] }] };
  const out = fullBackup(root);
  expect(out).not.toContain('sk-ant-SECRET');
  const parsed = JSON.parse(out);
  expect(parsed).toMatchObject({ app: 'pouch-down', format: 2 });
  expect(parsed.root.attempts).toHaveLength(2);
  expect(parsed.root.device.apiKey).toBe('');
  expect(root.device.apiKey).toBe('sk-ant-SECRET');
});
```

- [ ] **Step 2–4:** Implement and pass:

```js
export function fullBackup(root) {
  return JSON.stringify({ app: 'pouch-down', format: 2, exportedAt: new Date().toISOString(), root: { ...root, device: { ...root.device, apiKey: '' } } }, null, 2);
}
```

  In `SettingsSheet.jsx` call `fullBackup(root)` (from `useApp()`), and `markdownSummary(state, state.plan.totalDays, moneyStats(state).kept)`.
- [ ] **Step 5: Commit** `git commit -m "backup: export the v2 root, key stripped"`

### Task A9: `pouch-ingest` — get data off the phone without pasting (parallel lane, any time after A8)

**Why:** James does not want to upload or paste his data weekly. Permanent fix is Firebase sync (next spec, due 2026-09-27). Until then: phone → Settings → *Download full backup* → **AirDrop** (lands in `~/Downloads`) or *Save to Files → iCloud Drive → PouchDown* (syncs to the Mac on its own). A Mac-side command picks the file up, files it in the vault, and regenerates a readable live log. Any Claude session runs `pouch-ingest` before reviewing his data, so James's whole job is two taps. The renderer is source-agnostic so the Firebase pull reuses it.

**Files:** Create `src/ingest.js` (pure), `scripts/ingest-backup.mjs` (I/O), `src/__tests__/ingest.test.js` · Install `~/.local/bin/pouch-ingest` (2-line shell wrapper; James's other tools live there) · Personal output goes ONLY to the vault, never this repo.

- [ ] **Step 1: Failing tests**

```js
// src/__tests__/ingest.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBackup, renderLiveLog } from '../ingest.js';
import { generatePlan } from '../planGenerator.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
const ev = (type, day, extra = {}) => ({ id: `${type}-${day}-${Math.random()}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const a2 = { id: 'a2', status: 'active', createdAt: '2026-09-21T12:00:00Z', archivedAt: null, settings, plan, events: [...Array.from({ length: 8 }, () => ev('pouch', '2026-09-21')), ev('backfill', '2026-09-23', { count: 7, streak: 'keep' })], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
const v2 = JSON.stringify({ app: 'pouch-down', format: 2, exportedAt: '2026-09-25T17:00:00.000Z', root: { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [a2] } });
const v1 = JSON.stringify({ app: 'pouch-down', exportedAt: '2026-09-19T02:01:37.910Z', plan: {}, state: { version: 1, settings: { ...settings, apiKey: '' }, events: [{ id: 'e1', ts: '2026-07-08T11:33:12.569Z', type: 'pouch', trigger: null }], celebratedStages: [], checkinDismissedFor: null } });

describe('parseBackup', () => {
  it('reads a v2 backup', () => expect(parseBackup(v2)).toMatchObject({ format: 2, exportedAt: '2026-09-25T17:00:00.000Z', root: { activeAttemptId: 'a2' } }));
  it('upgrades a v1 backup to a root with one archived attempt', () => {
    const b = parseBackup(v1);
    expect(b.format).toBe(1);
    expect(b.root.attempts.map((a) => [a.id, a.status])).toEqual([['a1', 'archived']]);
  });
  it('rejects anything that is not a Pouch Down backup', () => {
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not a Pouch Down backup/);
    expect(() => parseBackup('nope')).toThrow();
  });
  it('refuses a file that still contains an API key', () => {
    expect(() => parseBackup(v2.replace('"apiKey":""', '"apiKey":"sk-ant-LEAK"'))).toThrow(/API key/);
  });
});

describe('renderLiveLog', () => {
  // Pin the clock: statuses and the 21-day window are relative to "today".
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T18:00:00.000Z')); });
  afterEach(() => vi.useRealTimers());
  const render = () => renderLiveLog(parseBackup(v2).root, { exportedAt: '2026-09-25T17:00:00.000Z', now: new Date() });

  it('is a valid vault note', () => {
    const md = render();
    expect(md.startsWith('---\ntitle: Pouch Down — Live Log\n')).toBe(true);
    expect(md).toMatch(/type: reference/);
    expect(md).toMatch(/project\/pouch-down/);
    expect(md).toMatch(/\[\[Pouch Down — Cessation System\]\]/);
  });
  it('never calls an unlogged day on plan', () => {
    const md = render();
    expect(md).toMatch(/\| 2 \| 2026-09-22 \|.*no log/);
    expect(md).toMatch(/\| 3 \| 2026-09-23 \|.*backfilled/);
    expect(md).not.toMatch(/2026-09-22.*on plan/);
  });
  it('states how fresh the data is', () => expect(render()).toMatch(/Data as of 2026-09-25/));
  it('warns when the backup is stale', () => {
    vi.setSystemTime(new Date('2026-10-05T18:00:00.000Z'));
    expect(render()).toMatch(/\[!warning\].*10 days old/);
  });
});
```

- [ ] **Step 2: Run — FAIL** (module missing).
- [ ] **Step 3: Implement `src/ingest.js`** (pure, no `fs`):
  - `parseBackup(text)` → `{ format, exportedAt, root }`. `JSON.parse`; require `app === 'pouch-down'` else `throw new Error('not a Pouch Down backup')`; if `/sk-ant-/.test(text)` → `throw new Error('backup contains an API key — refusing to store it')`; `format === 2` → `root` as is; otherwise (v1 wrapper with `.state`) → `migrateV1(j.state, { legacyPlan: LEGACY_PLAN, now: j.exportedAt }) `.
  - `renderLiveLog(root, { exportedAt, now = new Date() })` → Markdown string: YAML frontmatter (`title: Pouch Down — Live Log`, `type: reference`, `tags: [health/cessation, project/pouch-down, live-log]`, `created: <exportedAt date>`, `data_as_of: <exportedAt>`); a line linking `[[Pouch Down — Cessation System]]` and `[[Attempt 2 — Build Schedule]]`; `> [!warning] This backup is N days old — ask James to AirDrop a fresh one.` when `now − exportedAt > 3 days`; "Data as of YYYY-MM-DD HH:MM"; then for the active attempt (else the most recent): stage + day N of total, `streaks()` current/best, `moneyStats()` old pace/spent/kept, earned award titles from `awardsFor()`, `disciplineStats()` line, top triggers, and a table of the **last 21 days** — `| Day | Date | Cap | Used | Early | Over | First | Resisted | Sleep | Status |` where Status is `no log` / `backfilled` (any backfill event that day) / `over` / `on plan`, and unlogged rows show `—` in every numeric column. All day math comes from the existing `store.js` functions (which read the real clock); `now` is used only for the staleness warning. The tests pin the clock with fake timers, so never hardcode a date in the renderer.
- [ ] **Step 4: Implement `scripts/ingest-backup.mjs`** (I/O shell around the pure module):
  - Inputs: `POUCH_BACKUP_DIR` (default `/Users/jxm/jxm-vault/Pouch Down`); search dirs `~/Downloads` and `~/Library/Mobile Documents/com~apple~CloudDocs/PouchDown` for `pouch-down-backup-*.{json,txt}`.
  - For each file, newest first: `parseBackup` → on success **copy** to `$POUCH_BACKUP_DIR/Backups/<exportedAt with : → ->.json` (skip if an identical SHA-256 already exists), then **move** the Downloads original into `$POUCH_BACKUP_DIR/Backups/_ingested/` (never delete; leave iCloud copies alone). On failure: leave the file where it is and print why.
  - Render the newest valid backup to `$POUCH_BACKUP_DIR/Live Log.md`. Print a 3-line summary (files ingested, data as of, current streak). Exit 0 when there was nothing new. **Do not `git commit` in the vault** — Obsidian Git's auto-commit and Claude's own `claude:` commits cover it.
  - `--dry-run` prints what it would do and writes nothing.
- [ ] **Step 5: Install the command:** write `~/.local/bin/pouch-ingest` = `#!/bin/sh` + `exec node /Users/jxm/Projects/pouch-down/scripts/ingest-backup.mjs "$@"`, `chmod +x`. Verify: `pouch-ingest --dry-run` from any directory.
- [ ] **Step 6: Verify for real:** copy the step-1 backup from the vault into a temp dir, point the script at it with a temp `POUCH_BACKUP_DIR`, run, and read the generated Live Log — it must show attempt 1 with **no** streak and "no log" rows. Never write test output into the real vault folder.
- [ ] **Step 7 (ONLY if James said yes up front):** a launchd agent `~/Library/LaunchAgents/com.jxm.pouch-ingest.plist` (`WatchPaths`: the two search dirs; `ProgramArguments`: the wrapper; logs to `~/Library/Logs/pouch-ingest.log`) so ingestion happens the moment the AirDrop lands. **Known macOS gotcha:** a background agent reading `~/Downloads` / iCloud Drive is often blocked by privacy protection (TCC) with "Operation not permitted" and can't show a permission prompt. Test it; if blocked, do NOT try to work around it — tell James exactly which binary needs *Files and Folders* access and let him grant it in System Settings. Without the agent everything still works: Claude just runs `pouch-ingest` first.
- [ ] **Step 8:** add one line to `CLAUDE.md` under Related: "**Before reviewing James's data, run `pouch-ingest`** and read `Pouch Down/Live Log.md` in the vault — never ask him to paste an export." Commit: `git commit -m "ingest: pouch-ingest command + live log renderer (no more pasting exports)"`

### Session A exit gate

- [ ] `npm test` (expect ≥ 70 tests), lint (2 warnings), build, math harness — all pass.
- [ ] `POUCH_BACKUP_DIR="/Users/jxm/jxm-vault/Pouch Down" npm test` passes (real-data migration).
- [ ] Append a dated section to `docs/superpowers/reports/2026-09-19-attempt-2-build-log.md`: what shipped, test counts, anything deferred, surprises.

---

# SESSION B — interface (Sat PM)

**File ownership (so parallel agents never collide):** B1 owns `App.jsx` + `components/onboarding/FrontDoor.jsx` · B2 owns `components/onboarding/{SetupFlow,steps,PlanPreview}.jsx` · B3 owns `priceHelp.js` + `components/onboarding/PriceHelpSheet.jsx` · B4 owns `ReadOnlyBanner.jsx` · B5 owns `BackfillPrompt.jsx` · B6 owns `MoneyCard.jsx`. **The coordinator alone** wires B4–B6 into `TodayView.jsx` / `StatsView.jsx` / `SettingsSheet.jsx` after the agents report. Follow `SettingsSheet.jsx` and `CheckinCard.jsx` for sheet/card structure, class names, and motion. Load the `ui-ux-pro-max` skill for B2 and the awards UI.

### Task B1: boot routing + Front door

- `App.jsx` decides the screen: `problem` → `<RecoveryScreen>` (two buttons: **Download what's stored** — shares the raw `localStorage` strings for both keys via the existing share-sheet pattern; **Start fresh** → `api.startFresh()` behind a confirm step) · no `state` and no attempts → `<SetupFlow first />` · no `state` but attempts exist → `<FrontDoor />` · else the existing shell. While `readOnly`, render `<ReadOnlyBanner />` above the shell.
- `FrontDoor`: heading "Pouch Down"; primary button **Start a new attempt** → SetupFlow; below, "Past attempts" list — one row per archived attempt: `Attempt N · {startDate} – {quitDate} · {totalDays} days · {days logged} logged` → `api.viewAttempt(id)`.
- Acceptance (E2E, Session C): seeding only the v1 key boots to the Front door with one past attempt listed.

### Task B2: Setup walkthrough + plan preview

- One screen per row of spec §5's table. Local component state only — `const [draft, setDraft] = useState(() => ({ pouchesPerDay: null, mg: null, strengths: null, lengthDays: 90, startDate: tomorrow, ...lastSettings(root) }))`; **nothing is written until Begin.**
- Screen 3 defaults `strengths` to every chip below `mg`; if `mg` is the lowest chip, skip screen 3.
- Custom length: number input, min `MIN_LENGTH_DAYS` (import it), max 365.
- **Next** is disabled until the screen's value is valid. Back never loses entered values. Progress dots; slide+fade spring between screens; respects reduced motion and `?static`.
- Screen 8 (`PlanPreview`): `const plan = generatePlan({ ...draft, mealTimes: draft.mealTimes, sleepTime: draft.sleepTime, pouchesPerTin: draft.pouchesPerTin })` in a `useMemo`. Show: quit date headline ("Zero on Sat, Dec 19"), then each stage as a card — name, date range, `N/day @ X mg`, tagline, shopping line when present. **Begin** → `api.startAttempt({ plan, settings: { mealTimes, costPerTin, pouchesPerTin, wakeTime, sleepTime } })`.
- Copy is second person, plain, no exclamation marks. Screen 1 sub-copy: "Be honest — the plan is built from this number, and nobody sees it but you."
- Acceptance: 9/day · 9 mg · [6, 3] · 90 · 2026-09-21 shows 8 stages, first cut "Oct 6", quit "Dec 19"; after Begin the Today view shows pre-plan mode if Day 1 is in the future.

### Task B3: AI price help — `src/priceHelp.js`

Load the `claude-api` skill first. Isolated so a future backend proxy only changes this file.

```js
// Turns "5-pack at the gas station for $23.99 plus tax" into numbers. Same
// on-device key and direct-browser call as coach.js.
const MODEL = 'claude-haiku-4-5-20251001';
const SYSTEM = `You convert a person's description of how they buy nicotine pouches into a per-tin price. Reply with ONLY a JSON object: {"pricePerTin": number, "pouchesPerTin": number, "explanation": string}. pricePerTin is the out-the-door cost of ONE tin in the user's currency, including any tax they mention, rounded to cents. pouchesPerTin defaults to 20 if they don't say. explanation is one short sentence showing the arithmetic. If you cannot work it out, reply {"error": "one short sentence saying what is missing"}.`;

export async function priceFromText(text, apiKey) {
  if (!apiKey?.trim()) throw new Error('no-key');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: MODEL, max_tokens: 200, system: SYSTEM, messages: [{ role: 'user', content: text }] }),
  });
  if (res.status === 401) throw new Error('bad-key');
  if (!res.ok) throw new Error('api');
  const data = await res.json();
  return parsePriceReply(data.content?.[0]?.text ?? '');
}

export function parsePriceReply(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('unreadable');
  const j = JSON.parse(m[0]);
  if (j.error) throw new Error(`unclear:${j.error}`);
  const price = Number(j.pricePerTin), per = Math.round(Number(j.pouchesPerTin));
  if (!(price > 0 && price < 200) || !(per >= 1 && per <= 100)) throw new Error('unreadable');
  return { pricePerTin: Math.round(price * 100) / 100, pouchesPerTin: per, explanation: String(j.explanation ?? '') };
}
```

- Unit-test `parsePriceReply` (vitest): clean JSON; JSON wrapped in prose/code fences; `{"error":…}` → `unclear:`; garbage → `unreadable`; out-of-range price → `unreadable`.
- `PriceHelpSheet`: textarea ("Tell me how you buy them"), **Work it out**, then a result card with the explanation and **Use these** / **Try again**. Errors: `no-key` → "Add a Claude API key in Settings to use this — or just type the price in." · `unclear:` → show the model's sentence · anything else → "Couldn't work that out — enter it by hand." Never blocks manual entry. Also reachable from Settings next to the cost fields.

### Task B4: Read-only viewer

`ReadOnlyBanner`: sticky, amber-tinted glass: "Viewing Attempt {n} · {start} – {end} · read-only" + **Exit** → `api.exitViewing()`. In `TodayView` hide the log ring, SOS, check-in card, and backfill prompt when `readOnly` and show a summary card instead (days logged, best streak, kept). Settings inputs disabled when `readOnly`. (The `api` already no-ops — this is about not showing dead controls.)

### Task B5: Backfill prompt

`BackfillPrompt` renders on Today when `missedDays(state).length > 0` and not `readOnly`. One day at a time, newest first: "No log for {weekday}. How many did you have?" → stepper (0–40, starts at that day's cap) → **Skip** / **Save**. On Save: `count > cap` → `api.logBackfill({ day, count, streak: 'break' })` immediately; else show the fork — "Your call. The app only knows what you tell it." → **Keep my streak** (`'keep'`) / **Break it here** (`'break'`). Skip hides that day for this session only (component state) — it stays `nolog` and re-prompts next open. No guilt copy anywhere.

### Task B6: Money card

`MoneyCard` (replaces the old saved-money tile in Stats and the Today footer figure): three figures — **Old pace** `$oldPace` · **You spent** `$spent` · **Kept** `$kept` (`AnimatedNumber`; if `kept < 0` label it "Over your old pace" in amber, no red). Below: "Quit for good: about ${perMonth}/month back — ${perYear} a year." and a faint "Counted on {loggedDays} logged days. Unlogged days count for nothing." Tapping opens Settings at the price fields.

### Task B7: Settings → Attempts

New "Attempts" section in `SettingsSheet`: **View past attempts** (list → `api.viewAttempt`) and **End this attempt and start over** → confirm sheet ("This archives your current attempt — nothing is deleted. You'll set up a new plan.") → `api.archiveActive()` → Front door.

### Session B exit gate

- [ ] Full checks pass; walk the flow by hand in `npm run dev` with a seeded v1 key (`scripts/e2e/seed-v1.mjs` fixture — synthetic data, never the real backup).
- [ ] Build log updated.

---

# SESSION B2 — awards UI (Sun AM)

Load `ui-ux-pro-max`. Reuse `confetti.js`, `AnimatedNumber`, Framer springs. Everything reads `awardsFor(state)` / `newlyEarned(state)` / `streaks(state)`.

- **`StreakChip`** (Today header): flame icon + current streak; number springs on change; at 0 shows "Start a streak today" instead of "0"; long-press/tap opens Trophy case.
- **`TrophyCase`** (card in Stats): grid of badges by tier (bronze/silver/gold/aurora gradients drawn in CSS/SVG — no image assets). Earned: full color + earned date. Locked: dimmed, progress ring from `progress`, title visible, body hidden until earned ("Keep going to reveal"). Tap → detail sheet.
- **`AwardUnlock`** (overlay, mounted in `App.jsx`): a queue of `newlyEarned(state)`; for each — backdrop blur in, badge springs from 0.6→1 with slight overshoot, one shimmer sweep across the badge, tier-scaled confetti (bronze light → aurora full), title + body, **Nice** button → `api.markAwardCelebrated(id)` → next in queue. Never shows while `readOnly`. With `?static` or reduced motion: no confetti, fade only.
- Guard: on the first open after this ships, several awards may already be earned — cap the queue at 3 celebrations and silently mark the rest celebrated.

---

# SESSION C — QA and ship (Sun midday → 6 PM freeze)

### Task C1: E2E scripts — `scripts/e2e/*.mjs`

Add `playwright-core@1.59.1` as a devDependency (matches the cached Chromium). Each script: `vite preview` on a fixed port, `?static`, iPhone viewport 390×844, stub share/clipboard as in the step-1 test. Flows: (1) v1-only storage → Front door → view Attempt 1 → banner, no log ring, no fake streak → Exit; assert `pouch-down-v1` string is byte-identical at the end. (2) Setup walkthrough end-to-end with the acceptance inputs → preview dates → Begin → Today. (3) Seed an active attempt with two missed days → backfill one with Keep, one with Break → streak reflects both. (4) Seed 3 green days → unlock overlay shows "3-day streak" → dismiss → does not reappear on reload. (5) Corrupt v2 → recovery screen, storage untouched.

### Task C2: real-data dry run (local only, never committed)

A throwaway script seeds `pouch-down-v1` from `$POUCH_BACKUP_DIR/Attempt 1 — 2026-07-08 Backup.json` (`.state`) in headless Chromium with `timezoneId: 'America/Chicago'`, boots the app, and asserts: Front door; Attempt 1 lists the right date range; viewing it shows no streak; weekly pouch totals in the History view match `Attempt 1 — Expected.json`.

### Task C3: adversarial review

Dispatch independent review agents (use the `requesting-code-review` skill) over the branch diff, each with one lens: data loss / migration safety · append-only violations · time-zone correctness · readOnly leaks (any way to mutate a past attempt) · API key exposure · copy tone (shame, toxic positivity). Fix confirmed findings; log the rest.

### Task C4: housekeeping

`npm audit` triage (dev-only tooling — fix only what `npm audit fix` resolves without major bumps; re-run all checks) · bump the GitHub Actions in `.github/workflows/deploy.yml` to their Node 24-native majors · update `CLAUDE.md` (attempts model, honest scoring, new rules: v1 key is sacred; no personal data in repo; awards derived) · update the manifest description in `vite.config.js` (no longer "July 8 to September 5").

### Task C5: ship

- [ ] All checks + all E2E green. Merge `feat/attempt-2` → `main` locally with `--no-ff`. **Do not push.**
- [ ] Hand James the phone checklist: push → wait for deploy → reopen twice → Front door appears → Attempt 1 opens, looks right → Settings → Download full backup (v2) → AirDrop → start setup.
- [ ] If anything in C1–C3 is red at 3 PM: cut scope in this order — AI price help, Trophy case polish, Settings→Attempts — never the migration, scoring, or setup flow. Awards are derived, so shipping their UI Tuesday loses nothing.
