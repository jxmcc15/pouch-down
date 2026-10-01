# Late pouches, mistakes, and today unlocked — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A forgotten pouch can be logged after the fact with the time it happened (or "unknown"), an accidental tap can be marked as a mistake, and Fix this day opens for today — all as new events, with every number in the app computed from one live list.

**Architecture:** Two new pure modules carry the whole feature's logic. `src/liveEvents.js` is the choke point: `liveEvents(state)` drops every pouch named by a `void` event, memoized on the events array; `eventsForDay` filters it, so every counting reader gets the live list for free, and the raw list is read only by screens that draw struck rows and by the write guards. `src/latePouch.js` turns a chosen app day + wall-clock time into an instant under the 4am rule and says whether it is in the future, so `state.jsx` (validation + stamping) and `FixDaySheet.jsx` (the resolved line) can never disagree. Everything else is readers switching lists, two new api methods, three screens drawing three new row facts, and tests that pin each.

**Tech Stack:** Vite + React 19 + Framer Motion, vanilla JS (no TypeScript), Vitest (Node, `TZ=America/Chicago`), Playwright-core walks in `scripts/e2e/`.

**Spec:** `docs/superpowers/specs/2026-10-01-late-pouch-and-mistake-design.md` — decisions 1–7 are final; do not re-ask.

**Rules that bind every task** (from CLAUDE.md and the spec): append-only — `undoEvent` and `tagEvent` stay the only mutations; silence is never success; nothing James-specific in code or tests, synthetic data only; bucket by `dayKeyOf`, display by `fmtTime`/`localHM`, never `ev.ts` in the reader's zone; tests run pinned to America/Chicago; a celebrated award never un-earns; never push; never touch `dist/`; comments explain *why* in the voice of the existing files; no dead code, no unused imports, no `// TODO`.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/liveEvents.js` (new) | `liveEvents`, `isVoided`, `pouchFlags` — the live list and the three row facts | 1, 6 |
| `src/store.js` | re-exports the live list; `rawEventsForDay`; `eventsForDay` filters live; readers switch; `classifyPouch` untimed bucket; timing readers skip untimed | 1, 2 |
| `src/awards.js`, `src/money.js`, `src/ingest.js`, `src/components/StatsView.jsx`, `src/components/GapsCard.jsx`, `src/components/awards/AwardUnlock.jsx` | readers switch to `liveEvents` | 1 |
| `src/justLogged.js` | `enteredAtOf`; `isJustLogged` reads it | 2 |
| `src/pouchVerdict.js` | `untimed` → "time unknown", muted | 2 |
| `src/latePouch.js` (new) | `TIME_RE`, `lateInstant`, `resolveLate` — day + HH:MM → instant under the 4am rule, future check, display label | 3 |
| `src/state.jsx` | `logLatePouch`, `voidPouch`; `reasonBody` shared validator | 3 |
| `src/__tests__/liveEvents.test.js` (new) | the bulletproof equivalence test + unit tests | 1 |
| `src/__tests__/justLogged.test.js` (new), `store.test.js`, `root.test.js`, `awards.test.js`, `money.test.js`, `ingest.test.js`, `coach.test.js`, `renderGuards.test.js` | pins | 2, 4, 6 |
| `src/__tests__/latePouch.test.js` (new) | pure-module tests + the api guard matrix in the synchronous-hook harness | 3 |
| `src/components/ReasonFields.jsx` (new) | chip row + note, shared by `ReasonEditor` and `AddPouchCard` | 5 |
| `src/components/FixDaySheet.jsx` | Add a pouch card, Mark as mistake, struck/late/untimed rows, today's copy | 5 |
| `src/components/HistoryTimeline.jsx`, `src/components/TodayLog.jsx` | rows read raw; three new row facts; void rows render nothing | 6 |
| `src/coach.js` | the "What you can and can't do" path copy | 4 |
| `scripts/e2e/walk-latepouch.mjs` (new), `scripts/e2e/run-all.mjs` | the seventh walk | 7 |
| `CLAUDE.md` | domain rules | 7 |
| `docs/superpowers/reports/<date>-late-pouch-build-log.md` | the report | 8 |

Dependency order: 1 → 2 → {3 ∥ 4} → {5 ∥ 6} → 7 → 8. Task 5 needs 3; Task 6 needs 2 (and `pouchFlags` from 1).

---

## Shared fixtures (every test task uses these shapes)

`store.test.js`, `awards.test.js` and `money.test.js` already define, at the top of the file:

```js
const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const pouches = (day, n) => Array.from({ length: n }, () => ev('pouch', day));
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T17:00:00.000Z')); }); // day 5, noon CT
afterEach(() => vi.useRealTimers());
```

New test files copy this block. Two event shapes this plan adds, as the tests build them:

```js
// a void of pouch `p`, entered now (ts), filed under the pouch's day
const voidOf = (p, ts = '2026-09-25T17:00:00.000Z') => ({ id: `v${++seq}`, ts, tzOffsetMin: -300, day: p.day, type: 'void', target: p.id, trigger: null });
// a late pouch with a chosen time; `ts` IS the time it happened
const late = (day, ts, extra = {}) => ({ ...ev('pouch', day), ts, ctx: null, late: true, enteredAt: '2026-09-25T17:00:00.000Z', ...extra });
// a late pouch whose time is unknown: ts === enteredAt, timeKnown:false
const untimed = (day) => late(day, '2026-09-25T17:00:00.000Z', { timeKnown: false });
```

---

### Task 1: The live list — `liveEvents.js`, `rawEventsForDay`, every reader switched

The whole feature's safety. Written test-first; the bulletproof test is red until every reader walks the live list.

**Files:**
- Create: `src/liveEvents.js`
- Create: `src/__tests__/liveEvents.test.js`
- Modify: `src/store.js` (`eventsForDay` ~line 88; `disciplineStats`, `firstPouchTimes`, `gapStats`, `hourHistogram`, `checkinForDay`, `correlationStats`, `timeSinceLastPouch`, `markdownSummary` trigger tally — every `state.events` in the file except none remain)
- Modify: `src/awards.js:81,101`, `src/ingest.js:190`, `src/components/StatsView.jsx:148,262`, `src/components/GapsCard.jsx:24`, `src/components/awards/AwardUnlock.jsx:165`

**Readers that must NOT switch** (they draw struck rows or guard writes, and they are the only ones): `reasonsOf` in store.js (a reason for a voided pouch must still index), `LogToast.jsx` (`find` by id and the "is last" check), the write guards in `state.jsx` (`tagEvent`, `undoEvent`, `reasonFields`, and Task 3's `voidPouch` guard — they look at raw history on purpose), and `AwardUnlock.jsx:165` **stays raw**: it reads the *newest* event to wait out the undo window, and a void is the newest event after a mistake is marked. (The spec listed AwardUnlock among the switchers; the code says otherwise — the newest raw event is what undo acts on. Record this in the build log.)

- [ ] **Step 1: Write `src/liveEvents.js`**

```js
// The live list: the events that count. A pouch named by a `void` event is
// dropped; everything else passes — including the void itself, which no reader
// scores. This is the ONE place a mistake stops counting. Every reader that
// computes a number walks `liveEvents` (or `eventsForDay`, which filters it);
// the raw list is for drawing struck rows and for the write guards, nothing
// else. Memoized on the events array: every append makes a new one, like
// `reasonsOf` in store.js, so a screen with sixty rows filters once.

const liveIndex = new WeakMap();

function indexOf(state) {
  let idx = liveIndex.get(state.events);
  if (!idx) {
    const voided = new Set();
    for (const e of state.events) {
      if (e.type === 'void' && typeof e.target === 'string') voided.add(e.target);
    }
    // Only a pouch can be voided. A stored void naming a resisted or a check-in
    // (hostile data; the api never writes one) changes nothing.
    const live = state.events.filter((e) => !(e.type === 'pouch' && voided.has(e.id)));
    idx = { voided, live };
    liveIndex.set(state.events, idx);
  }
  return idx;
}

export function liveEvents(state) {
  return indexOf(state).live;
}

// For the screens that draw a struck row: is this pouch named by a void?
export function isVoided(state, ev) {
  return ev.type === 'pouch' && indexOf(state).voided.has(ev.id);
}

// The three facts a pouch row draws besides its verdict. Strict equality on
// purpose: `late: 'yes'` or `timeKnown: 0` in stored data is neither.
export function pouchFlags(state, ev) {
  return { voided: isVoided(state, ev), late: ev.late === true, untimed: ev.timeKnown === false };
}
```

- [ ] **Step 2: Write the failing tests — `src/__tests__/liveEvents.test.js`**

Copy the shared fixture block (above) plus `voidOf`/`late`/`untimed`. Then:

```js
import * as S from '../store.js';
import { liveEvents, isVoided, pouchFlags } from '../liveEvents.js';
import { moneyStats } from '../money.js';
import { awardsFor } from '../awards.js';
import { calendarMonths } from '../calendarMonths.js';
import { renderLiveLog } from '../ingest.js';

describe('liveEvents', () => {
  it('drops a pouch named by a void and nothing else', () => {
    const [p1, p2] = pouches('2026-09-21', 2);
    const r = ev('resisted', '2026-09-21');
    const v = voidOf(p1);
    const s = attempt([p1, p2, r, v]);
    expect(liveEvents(s).map((e) => e.id)).toEqual([p2.id, r.id, v.id]);
    expect(isVoided(s, p1)).toBe(true);
    expect(isVoided(s, p2)).toBe(false);
  });
  it('a void naming a resisted or an unknown id changes nothing', () => {
    const r = ev('resisted', '2026-09-21');
    const s = attempt([r, voidOf(r), { ...voidOf(r), target: 'nope' }, { ...voidOf(r), target: 42 }]);
    expect(liveEvents(s)).toHaveLength(4);
    expect(isVoided(s, r)).toBe(false);
  });
  it('is memoized on the events array', () => {
    const s = attempt(pouches('2026-09-21', 3));
    expect(liveEvents(s)).toBe(liveEvents(s));
    expect(liveEvents({ ...s, events: [...s.events] })).not.toBe(liveEvents(s));
  });
  it('pouchFlags reads only true booleans', () => {
    const s = attempt([]);
    expect(pouchFlags(s, { ...ev('pouch', '2026-09-21'), late: 'yes', timeKnown: 0 })).toEqual({ voided: false, late: false, untimed: false });
    expect(pouchFlags(s, { ...ev('pouch', '2026-09-21'), late: true, timeKnown: false })).toEqual({ voided: false, late: true, untimed: true });
  });
});

// THE BULLETPROOF TEST. For every pouch P in a week of synthetic history,
// state A (P logged, then voided) must read identically to state B (P never
// logged) through every exported reader that returns a number or a list.
// A reader that forgets the live list fails here, by name.
describe('a voided pouch reads exactly like a pouch never logged', () => {
  const days = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'];
  const base = [
    ...pouches(days[0], 8), ev('resisted', days[0], { trigger: 'coffee' }),
    ...pouches(days[1], 10).map((p, i) => ({ ...p, ts: `${days[1]}T${String(12 + i).padStart(2, '0')}:00:00.000Z`, trigger: i % 2 ? 'stress' : null })),
    ...pouches(days[2], 3),
    ev('checkin', days[3], { source: 'manual', sleepQuality: 4, workout: true }), ...pouches(days[3], 7),
    ...pouches(days[4], 2).map((p, i) => ({ ...p, ts: `${days[4]}T${13 + i}:30:00.000Z` })),
  ];
  // a reason on one pouch, so the trigger tally is in play
  const reasoned = base.find((e) => e.type === 'pouch' && e.day === days[2]);
  base.push({ ...ev('reason', days[2]), target: reasoned.id, triggers: ['boredom'], note: 'synthetic' });

  const readers = (s) => ({
    perDay: days.map((d) => [S.pouchesForDay(s, d), S.timedPouchesForDay(s, d), S.isLogged(s, d), S.statusForDay(s, d), S.resistedForDay(s, d), S.dayCountsForStreak(s, d), S.mgForDay(s, d), S.checkinForDay(s, d)?.id ?? null]),
    streaks: S.streaks(s),
    discipline: S.disciplineStats(s),
    first: S.firstPouchTimes(s),
    gaps: S.gapStats(s),
    hours: S.hourHistogram(s),
    since: S.timeSinceLastPouch(s),
    pacing: { ...S.pacingForNow(s), now: null },
    corr: S.correlationStats(s),
    missed: S.missedDays(s),
    md: S.markdownSummary(s, 7, 1),
    money: moneyStats(s),
    awards: awardsFor(s),
    months: calendarMonths(s),
    live: renderLiveLog({ version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [s] }, { exportedAt: '2026-09-25T17:00:00.000Z', now: new Date() }),
  });

  for (const p of base.filter((e) => e.type === 'pouch')) {
    it(`pouch ${p.id} on ${p.day}`, () => {
      const A = attempt([...base, voidOf(p)]);
      const B = attempt(base.filter((e) => e.id !== p.id));
      expect(JSON.stringify(readers(A))).toBe(JSON.stringify(readers(B)));
    });
  }

  it('voiding the only pouch of a day makes it nolog again, never green', () => {
    const [p] = pouches('2026-09-22', 1);
    const s = attempt([...pouches('2026-09-21', 5), p, voidOf(p)]);
    expect(S.statusForDay(s, '2026-09-22')).toBe('nolog');
    expect(S.isLogged(s, '2026-09-22')).toBe(false);
    expect(S.streaks(s).current).toBe(0);
  });
});
```

Note on `pacingForNow`: it carries `now` (a Date) and slot `at` Dates; `JSON.stringify` serialises Dates, and both states are read under the same fake clock, so `now: null` only trims noise. `gapStats.currentGapMs` and `timeSinceLastPouch` use `Date.now()` — pinned by the fake timers, equal in A and B.

Ingest: `renderLiveLog` reads the Mac clock for the stale banner; `now: new Date()` is the pinned clock. Fine.

- [ ] **Step 3: Run — expect red**

Run: `npx vitest run src/__tests__/liveEvents.test.js`
Expected: the unit tests pass (the module exists); the bulletproof cases FAIL — every reader still walks `state.events`, so state A counts the voided pouch.

- [ ] **Step 4: Switch the readers in `store.js`**

Top of `store.js`:

```js
import { liveEvents } from './liveEvents.js';
export { liveEvents, isVoided, pouchFlags } from './liveEvents.js';
```

Replace `eventsForDay`:

```js
// Every event stamped on that day, voided pouches included. For the screens
// that draw a struck row and nothing else — a count must never come from here.
export function rawEventsForDay(state, dateStr) {
  return state.events.filter((e) => dayKeyOf(e) === dateStr);
}

// The day's events that count. Every per-day reader goes through here, so a
// voided pouch is gone from all of them at once.
export function eventsForDay(state, dateStr) {
  return liveEvents(state).filter((e) => dayKeyOf(e) === dateStr);
}
```

Then every `for (const … of state.events)` / `state.events.filter` / `state.events.map` in `disciplineStats`, `firstPouchTimes`, `gapStats`, `hourHistogram`, `checkinForDay`, `correlationStats`, `timeSinceLastPouch`, and the trigger tally in `markdownSummary` becomes `liveEvents(state)`. After this step `grep -n "state\.events" src/store.js` prints only `rawEventsForDay` and `reasonsOf`.

- [ ] **Step 5: Switch the readers outside `store.js`**

- `src/awards.js:81` `eventDays`: `liveEvents(state).map(dayKeyOf)`; `:101` `resisted`: `liveEvents(state).filter(…)`. Import `liveEvents` from `./store.js`.
- `src/ingest.js:190` trigger tally: `for (const e of liveEvents(state))`. Add `liveEvents` to the store import.
- `src/components/StatsView.jsx:148` `liveEvents(state).forEach(…)`; `:262` `liveEvents(state).filter(…)`. Add to the store import.
- `src/components/GapsCard.jsx:24` `!liveEvents(state).some(…)`.
- `src/components/awards/AwardUnlock.jsx:165` — **leave raw** (see the note above the steps). Add a one-line comment above it: `// Raw on purpose: undo acts on the newest event of all, a void included.`

- [ ] **Step 6: Run — expect green, whole suite**

Run: `npx vitest run src/__tests__/liveEvents.test.js` → all pass. Then `npm test` → 607 + new, 4 skipped, nothing else moved. Then `npm run lint` → the one known warning only.

- [ ] **Step 7: Commit**

```bash
git add src/liveEvents.js src/__tests__/liveEvents.test.js src/store.js src/awards.js src/ingest.js src/components/StatsView.jsx src/components/GapsCard.jsx src/components/awards/AwardUnlock.jsx
git commit -m "Live list: one choke point drops voided pouches from every number

liveEvents(state) is memoized on the events array and every counting reader
walks it; eventsForDay filters it, so per-day readers switch for free. The raw
list stays only where a struck row is drawn or a write is guarded. The
equivalence test proves a voided pouch reads like one never logged, reader by
reader."
```

---

### Task 2: `enteredAt` for the just-logged window; the untimed verdict; timing readers skip it

**Files:**
- Modify: `src/justLogged.js`
- Create: `src/__tests__/justLogged.test.js`
- Modify: `src/store.js` (`classifyPouch`, `disciplineStats`, `firstPouchTimes`, `gapStats`, `hourHistogram`, `timeSinceLastPouch`, `markdownSummary` first-pouch cell)
- Modify: `src/ingest.js` `dayRow` first-pouch cell (~line 131–148)
- Modify: `src/pouchVerdict.js`
- Modify: `src/components/awards/AwardUnlock.jsx:55,168–169` (`UNDOABLE` gains `'void'`; the wait reads `enteredAtOf`)
- Modify: `src/__tests__/store.test.js` (append a describe)

- [ ] **Step 1: Failing tests — `src/__tests__/justLogged.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { isJustLogged, enteredAtOf, UNDO_WINDOW_MS, CLOCK_SKEW_MS } from '../justLogged.js';

const NOW = Date.parse('2026-10-02T02:05:11.000Z');

describe('enteredAtOf', () => {
  it('prefers enteredAt and falls back to ts', () => {
    expect(enteredAtOf({ ts: 'a', enteredAt: 'b' })).toBe('b');
    expect(enteredAtOf({ ts: 'a' })).toBe('a');
  });
});

describe('isJustLogged reads when the event was WRITTEN, not when it happened', () => {
  it('a late pouch from hours ago is just-logged by its enteredAt', () => {
    const ev = { ts: '2026-10-01T21:30:00.000Z', enteredAt: new Date(NOW - 3000).toISOString() };
    expect(isJustLogged(ev, UNDO_WINDOW_MS, NOW)).toBe(true);
  });
  it('without enteredAt the ts rules, as before', () => {
    expect(isJustLogged({ ts: new Date(NOW - 3000).toISOString() }, UNDO_WINDOW_MS, NOW)).toBe(true);
    expect(isJustLogged({ ts: new Date(NOW - UNDO_WINDOW_MS - 1).toISOString() }, UNDO_WINDOW_MS, NOW)).toBe(false);
  });
  it('an enteredAt in the future (clock set back) is not just-logged; a bad one fails', () => {
    expect(isJustLogged({ ts: 'x', enteredAt: new Date(NOW + CLOCK_SKEW_MS + 1).toISOString() }, UNDO_WINDOW_MS, NOW)).toBe(false);
    expect(isJustLogged({ ts: 'x', enteredAt: 'garbage' }, UNDO_WINDOW_MS, NOW)).toBe(false);
  });
});
```

- [ ] **Step 2: Failing tests appended to `src/__tests__/store.test.js`**

```js
describe('an untimed pouch counts everywhere a count is taken and is skipped wherever a clock is read', () => {
  const D = '2026-09-22';
  const u = { ...ev('pouch', D), ts: '2026-09-25T17:00:00.000Z', ctx: null, late: true, timeKnown: false, enteredAt: '2026-09-25T17:00:00.000Z' };
  const t = { ...ev('pouch', D), ts: `${D}T14:00:00.000Z` };
  it('classifyPouch returns the untimed bucket', () => {
    expect(S.classifyPouch(attempt([u]), u)).toEqual({ bucket: 'untimed', deltaMin: null, preFirstSlot: false });
  });
  it('counts toward the day', () => {
    const s = attempt([u, t]);
    expect(S.pouchesForDay(s, D)).toBe(2);
    expect(S.timedPouchesForDay(s, D)).toBe(2);
    expect(S.isLogged(s, D)).toBe(true);
    expect(S.mgForDay(s, D)).toBe(2 * 9);
  });
  it('goes to the "no timing" bucket of disciplineStats', () => {
    const d = S.disciplineStats(attempt([u, t]));
    expect(d.backfilled).toBe(1);
    expect(d.onTime + d.early + d.overCap).toBe(1);
  });
  it('is skipped by firstPouchTimes, gapStats, hourHistogram and timeSinceLastPouch', () => {
    const s = attempt([u, t]);
    expect(S.firstPouchTimes(s)).toEqual([{ dayNum: 2, date: D, minutesSince4am: (9 * 60 - 4 * 60 + 1440) % 1440 }]); // 14:00Z = 9:00 CDT
    expect(S.gapStats(s).longestGapMs).toBeNull(); // one timed pouch, no pair
    expect(S.hourHistogram(s).reduce((n, b) => n + b.onTime + b.off, 0)).toBe(1);
    expect(S.timeSinceLastPouch(s)).toBe(Date.now() - Date.parse(t.ts));
    expect(S.timeSinceLastPouch(attempt([u]))).toBeNull();
  });
  it('markdownSummary shows — for first pouch on an untimed-only day', () => {
    const line = S.markdownSummary(attempt([u]), 7).split('\n').find((l) => l.includes(`| ${D} |`));
    expect(line).toContain('| 1 | 0 | 0 | — |');
  });
});
```

- [ ] **Step 3: Run — expect red**

Run: `npx vitest run src/__tests__/justLogged.test.js src/__tests__/store.test.js`
Expected: `enteredAtOf` undefined; the untimed describe fails (bucket is `'on-time'`, first-pouch reads the enteredAt clock).

- [ ] **Step 4: `src/justLogged.js`**

```js
// When the event was WRITTEN. A tap's ts is that moment; a late pouch's ts is
// when it happened, hours earlier, so it carries `enteredAt` as well. Undo and
// the just-logged window read this, never ts alone.
export const enteredAtOf = (ev) => ev.enteredAt ?? ev.ts;

export function isJustLogged(ev, windowMs, now = Date.now()) {
  const age = now - Date.parse(enteredAtOf(ev));
  return age >= -CLOCK_SKEW_MS && age <= windowMs; // NaN (bad stamp) fails both
}
```

- [ ] **Step 5: `src/store.js` — the untimed bucket and the skips**

`classifyPouch`, after the `n < 1` line:

```js
  // A pouch whose time is unknown counts; it can't be early, on time or
  // scored against a slot. Timing readers skip this bucket.
  if (ev.timeKnown === false) return { bucket: 'untimed', deltaMin: null, preFirstSlot: false };
```

`disciplineStats`, inside the loop after `classifyPouch`: `if (v.bucket === 'untimed') { totals.backfilled++; continue; }` placed before the `baseline` check. Update the `backfilled` comment: `// backfilled and untimed pouches carry no timing, so they share a bucket`.

`firstPouchTimes`: `if (e.type !== 'pouch' || e.timeKnown === false) continue;`
`gapStats`: `.filter((e) => e.type === 'pouch' && e.timeKnown !== false)`
`hourHistogram`: `if (e.type !== 'pouch' || e.timeKnown === false) continue;`
`timeSinceLastPouch`: `if (e.type !== 'pouch' || e.timeKnown === false) continue;`
`markdownSummary` first-pouch loop: the `first` assignment only when `e.timeKnown !== false` (the early/over counters stay: an untimed pouch is neither).

- [ ] **Step 6: `src/ingest.js` `dayRow`** — same rule as `markdownSummary`: `first` is only set for pouches with `e.timeKnown !== false`.

- [ ] **Step 7: `src/pouchVerdict.js`** — add before the early check: `if (v.bucket === 'untimed') return { text: 'time unknown', color: 'var(--fg-muted)' };`

- [ ] **Step 8: `src/components/awards/AwardUnlock.jsx`** — `const UNDOABLE = new Set(['pouch', 'resisted', 'void']);` with the comment extended: a void can earn an award (a yellow day turns green) while "Marked · Undo" is still showing, so the unlock waits for it too. The wait: `const wait = UNDO_WINDOW_MS - (now - Date.parse(enteredAtOf(last))) + RECHECK_PAD_MS;` importing `enteredAtOf` from `../../justLogged.js`.

- [ ] **Step 9: Run — green; whole suite; lint**

Run: `npm test` → all green. `npm run lint` → the one known warning.

- [ ] **Step 10: Commit**

```bash
git add src/justLogged.js src/__tests__/justLogged.test.js src/store.js src/ingest.js src/pouchVerdict.js src/components/awards/AwardUnlock.jsx src/__tests__/store.test.js
git commit -m "Just-logged reads enteredAt; an untimed pouch counts but is never clocked

A late pouch's ts is when it happened; enteredAt is when it was written, and
undo must follow the latter. A pouch with timeKnown:false gets its own verdict
bucket so every timing reader can skip it while every count keeps it."
```

---

### Task 3: `latePouch.js`, `logLatePouch` and `voidPouch` in `state.jsx`

**Files:**
- Create: `src/latePouch.js`
- Create: `src/__tests__/latePouch.test.js`
- Modify: `src/state.jsx` (`reasonFields` → shared `reasonBody`; two new api methods)

- [ ] **Step 1: Write `src/latePouch.js`**

```js
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

// The instant of `time` (HH:MM) on app day `day`, or null if either won't do.
// The 4am rule: 00:00–03:59 belongs to the app day that started the evening
// before, so a time before the cutoff lands on the NEXT calendar date.
export function lateInstant(day, time) {
  if (typeof day !== 'string' || !DAY_RE.test(day) || typeof time !== 'string' || !TIME_RE.test(time)) return null;
  const [y, mo, d] = day.split('-').map(Number);
  const [h, m] = time.split(':').map(Number);
  const at = new Date(y, mo - 1, d + (h < DAY_CUTOFF_HOURS ? 1 : 0), h, m);
  const ms = at.getTime();
  return Number.isFinite(ms) ? { ms, tzOffsetMin: localOffsetMin(at), nextCalendarDay: h < DAY_CUTOFF_HOURS } : null;
}

// What the sheet shows above Save, and what the api checks. `time` null means
// the time is unknown: the pouch is stamped at `now` with timeKnown:false.
// → { ok, ms, tzOffsetMin, future, nextCalendarDay } — `ok` false when the
// inputs are malformed; `future` true when the instant is past now (+ skew).
export function resolveLate({ day, time, now = Date.now() }) {
  if (time === null) return { ok: typeof day === 'string' && DAY_RE.test(day), ms: now, tzOffsetMin: localOffsetMin(new Date(now)), future: false, nextCalendarDay: false };
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
```

- [ ] **Step 2: Pure-module tests, first half of `src/__tests__/latePouch.test.js`**

The file ALSO holds the api matrix (Step 5), so it needs the synchronous-hook harness: copy the `fake = vi.hoisted(…)` block, the `vi.mock('react', …)`, and the `await import` lines verbatim from `src/__tests__/corrections.test.js` lines 7–50, then the `plan`/`T0`/`store`/`seed`/`withEvents`/`events()`/`beforeEach`/`afterEach` block from the same file (the plan starts 2026-09-01; "now" is `T0 = 2026-09-24T15:00:00Z` = 10:00 CDT, day 24). Add to the imports: `const { lateInstant, resolveLate, fmtHM } = await import('../latePouch.js');` and `const { dayKeyAt } = await import('../time.js');` and `const { isVoided, liveEvents, pouchesForDay, statusForDay } = await import('../store.js');`.

```js
describe('lateInstant — the 4am rule meets a time picker (America/Chicago)', () => {
  it('an afternoon time is that calendar date', () => {
    const r = lateInstant('2026-09-23', '16:30');
    expect(new Date(r.ms).toISOString()).toBe('2026-09-23T21:30:00.000Z');
    expect(r.tzOffsetMin).toBe(-300);
    expect(r.nextCalendarDay).toBe(false);
    expect(dayKeyAt(r.ms, r.tzOffsetMin)).toBe('2026-09-23');
  });
  it('01:30 on app day D is calendar D+1, and dayKeyAt still says D', () => {
    const r = lateInstant('2026-09-23', '01:30');
    expect(new Date(r.ms).toISOString()).toBe('2026-09-24T06:30:00.000Z');
    expect(r.nextCalendarDay).toBe(true);
    expect(dayKeyAt(r.ms, r.tzOffsetMin)).toBe('2026-09-23');
  });
  it('03:59 is still D; 04:00 is D itself', () => {
    expect(dayKeyAt(lateInstant('2026-09-23', '03:59').ms, -300)).toBe('2026-09-23');
    expect(new Date(lateInstant('2026-09-23', '04:00').ms).toISOString()).toBe('2026-09-23T09:00:00.000Z');
  });
  it('refuses malformed input', () => {
    for (const [d, t] of [['2026-9-23', '12:00'], ['2026-09-23', '24:00'], ['2026-09-23', '7:00'], ['2026-09-23', null], [null, '12:00'], ['2026-09-23', '12:60']]) expect(lateInstant(d, t)).toBeNull();
  });
});

describe('resolveLate', () => {
  const now = Date.parse('2026-09-24T15:00:00Z'); // 10:00 CDT
  it('a time later than now on today is future', () => {
    expect(resolveLate({ day: '2026-09-24', time: '10:30', now }).future).toBe(true);
    expect(resolveLate({ day: '2026-09-24', time: '09:30', now }).future).toBe(false);
  });
  it('unknown time resolves to now, never future', () => {
    expect(resolveLate({ day: '2026-09-23', time: null, now })).toEqual({ ok: true, ms: now, tzOffsetMin: -300, future: false, nextCalendarDay: false });
  });
  it('malformed is not ok', () => {
    expect(resolveLate({ day: '2026-09-23', time: 'noon', now }).ok).toBe(false);
    expect(resolveLate({ day: 'yesterday', time: null, now }).ok).toBe(false);
  });
});

describe('fmtHM', () => {
  it('reads like a clock', () => {
    expect(fmtHM('16:30')).toBe('4:30 PM'); expect(fmtHM('00:05')).toBe('12:05 AM'); expect(fmtHM('12:00')).toBe('12:00 PM'); expect(fmtHM('x')).toBe('');
  });
});
```

- [ ] **Step 3: Run — pure tests green** (`npx vitest run src/__tests__/latePouch.test.js`). The api describes come next and will be red.

- [ ] **Step 4: `src/state.jsx` — the shared reason validator and the two methods**

Replace `reasonFields` with:

```js
// The triggers + note a reason carries, validated the one way. → { triggers,
// note } (both may be empty), or null when the input won't do.
function reasonBody({ triggers = [], note = '' }) {
  if (!Array.isArray(triggers) || !triggers.every((t) => TRIGGERS.includes(t)) || typeof note !== 'string') return null;
  return { triggers: [...new Set(triggers)], note: note.trim().slice(0, NOTE_MAX) };
}

// The reason event for a pouch in this attempt, or null if the input won't do.
function reasonFields(a, { target, triggers = [], note = '' }) {
  const pouch = a.events.find((e) => e.id === target && e.type === 'pouch');
  const body = pouch && reasonBody({ triggers, note });
  if (!body) return null;
  return body.triggers.length || body.note ? { day: dayKeyOf(pouch), target, ...body } : null;
}

// A remembered pouch may land on any plan day from Day 1 through today — days
// past quit day included (the coming "still free" check-in must not be
// blocked) — never on a pre-plan baseline day, never in the future.
function latePouchOk(a, { day, time, triggers, note }) {
  if (typeof day !== 'string' || !DAY_RE.test(day) || day > todayKey()) return false;
  if (dayNumberFor(a, day) < 1) return false;
  const r = resolveLate({ day, time });
  return r.ok && !r.future && reasonBody({ triggers, note }) !== null;
}

// The pouch a void would name: a pouch of this attempt not already voided.
const voidable = (a, id) => a.events.some((e) => e.id === id && e.type === 'pouch') && !isVoided(a, { id, type: 'pouch' });
```

Imports to add: `import { resolveLate } from './latePouch.js';` and `isVoided` to the store import. `DAY_RE` already exists in state.jsx; keep that one (don't import latePouch's).

The two methods, after `logReason`:

```js
      // A pouch remembered later, with the time it happened or 'unknown'. One
      // state update, two events when triggers or a note were given: the
      // reason FIRST, then the pouch, so the pouch is the newest and undo takes
      // only it (a reason whose target is gone is harmless). → pouch id | null.
      logLatePouch({ day, time = null, triggers = [], note = '' } = {}) {
        const a = editable();
        const input = { day, time, triggers, note };
        if (!a || !latePouchOk(a, input)) return null;
        const now = new Date();
        const r = resolveLate({ day, time, now: now.getTime() });
        const pouch = {
          id: makeId(now), ts: new Date(r.ms).toISOString(), tzOffsetMin: r.tzOffsetMin, day,
          type: 'pouch', trigger: null, ctx: null, late: true, enteredAt: now.toISOString(),
          ...(time === null ? { timeKnown: false } : {}),
        };
        const body = reasonBody({ triggers, note });
        const reason = body.triggers.length || body.note ? { ...makeEvent('reason', null, now), day, target: pouch.id, ...body } : null;
        onActive((cur) => (latePouchOk(cur, input) ? { ...cur, events: [...cur.events, ...(reason ? [reason] : []), pouch] } : cur));
        return pouch.id;
      },
      // Marks a pouch as a mistake: a new event naming it; the pouch is never
      // touched. From then on liveEvents drops the pouch from every number.
      // Undo within the window is the only way back. → void id | null.
      voidPouch(id) {
        const a = editable();
        if (!a || !voidable(a, id)) return null;
        const pouch = a.events.find((e) => e.id === id);
        const ev = { ...makeEvent('void'), day: dayKeyOf(pouch), target: id };
        onActive((cur) => (voidable(cur, id) ? { ...cur, events: [...cur.events, ev] } : cur));
        return ev.id;
      },
```

Note `makeEvent(type, trigger, now)` already takes a `now`; the reason uses the same instant as the pouch's `enteredAt`. `makeEvent('void')` stamps today as `day`; it is overwritten with the pouch's day, as the spec says.

- [ ] **Step 5: The api guard matrix — second half of `src/__tests__/latePouch.test.js`**

With the harness: `seed(withEvents([...]))`, then `app().api.logLatePouch(...)`, then `events()`. `T0` is 10:00 CDT on 2026-09-24 (day 24); `Y = '2026-09-23'`.

```js
describe('api.logLatePouch', () => {
  const p = (day, extra = {}) => ev('pouch', day, extra);
  beforeEach(() => seed(withEvents([p(Y), p(Y)])));

  it('appends a timed pouch stamped with the chosen day and time, ctx null, late, enteredAt now', () => {
    const id = app().api.logLatePouch({ day: Y, time: '16:30' });
    expect(id).toEqual(expect.any(String));
    const last = events().at(-1);
    expect(last).toMatchObject({ id, type: 'pouch', day: Y, ts: '2026-09-23T21:30:00.000Z', tzOffsetMin: -300, ctx: null, late: true, enteredAt: new Date(T0).toISOString(), trigger: null });
    expect(last.timeKnown).toBeUndefined();
    expect(pouchesForDay(app().state, Y)).toBe(3);
  });
  it('the 4am rule: 01:30 on app day D stamps calendar D+1 and still buckets on D', () => {
    app().api.logLatePouch({ day: Y, time: '01:30' });
    const last = events().at(-1);
    expect(last.ts).toBe('2026-09-24T06:30:00.000Z');
    expect(last.day).toBe(Y);
    expect(pouchesForDay(app().state, Y)).toBe(3);
    expect(pouchesForDay(app().state, '2026-09-24')).toBe(0);
  });
  it('unknown time: ts === enteredAt, timeKnown false, day as chosen', () => {
    app().api.logLatePouch({ day: Y, time: null });
    const last = events().at(-1);
    expect(last).toMatchObject({ day: Y, timeKnown: false, late: true, ts: new Date(T0).toISOString(), enteredAt: new Date(T0).toISOString() });
  });
  it('reasons produce a second event ordered BEFORE the pouch, targeting it', () => {
    const id = app().api.logLatePouch({ day: Y, time: '16:30', triggers: ['boredom', 'boredom'], note: '  late meeting  ' });
    const [reason, pouch] = events().slice(-2);
    expect(pouch.id).toBe(id);
    expect(reason).toMatchObject({ type: 'reason', target: id, day: Y, triggers: ['boredom'], note: 'late meeting' });
    expect(triggersFor(app().state, pouch)).toEqual(['boredom']);
  });
  it('no reason event when triggers and note are empty', () => {
    const before = events().length;
    app().api.logLatePouch({ day: Y, time: '16:30' });
    expect(events().length).toBe(before + 1);
  });
  it('undo removes only the pouch; the reason stays, harmless', () => {
    const id = app().api.logLatePouch({ day: Y, time: '16:30', triggers: ['stress'] });
    app().api.undoEvent(id);
    expect(events().at(-1).type).toBe('reason');
    expect(pouchesForDay(app().state, Y)).toBe(2);
  });
  it('today is allowed; a past time today is fine; a future time today is refused', () => {
    expect(app().api.logLatePouch({ day: '2026-09-24', time: '09:30' })).toEqual(expect.any(String));
    expect(app().api.logLatePouch({ day: '2026-09-24', time: '10:30' })).toBeNull();
  });
  it('a nolog past day becomes logged by a remembered pouch', () => {
    const D = '2026-09-20';
    expect(statusForDay(app().state, D)).toBe('nolog');
    app().api.logLatePouch({ day: D, time: null });
    expect(statusForDay(app().state, D)).toBe('green');
  });
  it('refuses: bad day string, pre-plan day, future day, bad time, bad triggers, non-string note', () => {
    const before = events().length;
    for (const input of [
      { day: 'yesterday', time: '12:00' }, { day: '2026-08-31', time: '12:00' }, { day: '2026-09-25', time: '12:00' },
      { day: Y, time: '7:00' }, { day: Y, time: 'noon' }, { day: Y, time: '12:00', triggers: ['rage'] }, { day: Y, time: '12:00', note: 7 },
    ]) expect(app().api.logLatePouch(input)).toBeNull();
    expect(events().length).toBe(before);
  });
  it('a day past quit day is allowed (the still-free check-in must not be blocked)', () => {
    at(Date.parse('2026-10-05T15:00:00Z')); // day 35 of a 30-day plan
    expect(app().api.logLatePouch({ day: '2026-10-02', time: null })).toEqual(expect.any(String));
  });
  it('read-only attempt refuses', () => {
    const r = withEvents([p(Y)]);
    seed(archiveActive(r));
    expect(app().api.logLatePouch({ day: Y, time: '12:00' })).toBeNull();
  });
});

describe('api.voidPouch', () => {
  const p1 = ev('pouch', Y), p2 = ev('pouch', Y), r1 = ev('resisted', Y);
  beforeEach(() => seed(withEvents([p1, p2, r1])));

  it('appends a void naming the pouch, filed under the pouch day; the pouch stops counting', () => {
    const id = app().api.voidPouch(p1.id);
    const last = events().at(-1);
    expect(last).toMatchObject({ id, type: 'void', target: p1.id, day: Y, tzOffsetMin: -300, trigger: null });
    expect(events().find((e) => e.id === p1.id)).toEqual(p1); // untouched
    expect(isVoided(app().state, p1)).toBe(true);
    expect(pouchesForDay(app().state, Y)).toBe(1);
  });
  it('refuses an unknown id, a resisted id, and an already-voided id', () => {
    expect(app().api.voidPouch('nope')).toBeNull();
    expect(app().api.voidPouch(r1.id)).toBeNull();
    expect(app().api.voidPouch(p1.id)).toEqual(expect.any(String));
    expect(app().api.voidPouch(p1.id)).toBeNull();
    expect(events().filter((e) => e.type === 'void')).toHaveLength(1);
  });
  it('undo inside the window removes the void; outside it, the void stays', () => {
    const v = app().api.voidPouch(p1.id);
    app().api.undoEvent(v);
    expect(isVoided(app().state, p1)).toBe(false);
    const v2 = app().api.voidPouch(p1.id);
    at(T0 + 16000);
    app().api.undoEvent(v2);
    expect(isVoided(app().state, p1)).toBe(true);
  });
  it('voiding the only pouch of a day makes it nolog, not green', () => {
    const D = '2026-09-22';
    const only = ev('pouch', D);
    seed(withEvents([only]));
    app().api.voidPouch(only.id);
    expect(statusForDay(app().state, D)).toBe('nolog');
  });
  it('read-only attempt refuses', () => {
    seed(archiveActive(withEvents([p1])));
    expect(app().api.voidPouch(p1.id)).toBeNull();
  });
});
```

(`triggersFor` and `archiveActive` are already imported in the harness block copied from corrections.test.js.)

- [ ] **Step 6: Run — green; whole suite; lint**

Run: `npx vitest run src/__tests__/latePouch.test.js src/__tests__/corrections.test.js src/__tests__/state-guards.test.js` then `npm test`, `npm run lint`.

- [ ] **Step 7: Commit**

```bash
git add src/latePouch.js src/__tests__/latePouch.test.js src/state.jsx
git commit -m "api: logLatePouch and voidPouch — a remembered pouch with its time, a mistake as a new event

latePouch.js resolves a chosen app day + wall-clock time under the 4am rule in
the phone's current zone, so the api and the sheet share one truth about
'later than now'. The reason is appended before the pouch so undo takes the
pouch alone. A void names a pouch and never touches it."
```

---

### Task 4: Validation, awards, money, ingest, coach — the pins

Parallel with Task 3 (disjoint files). All tests; the one code change is the coach paragraph.

**Files:**
- Modify: `src/__tests__/root.test.js`, `src/__tests__/awards.test.js`, `src/__tests__/money.test.js`, `src/__tests__/ingest.test.js`, `src/__tests__/coach.test.js`
- Modify: `src/coach.js:69`

- [ ] **Step 1: `root.test.js` — the new shapes are well-formed; fixtures unchanged**

```js
describe('wellFormed accepts the late-pouch and void shapes without a new clause', () => {
  const root = (events) => ({ ...freshRoot(), attempts: [{ ...attemptShape('a1'), events }] });
  const base = { id: 'p', ts: '2026-10-01T21:30:00.000Z', tzOffsetMin: -300, day: '2026-10-01', type: 'pouch', trigger: null, ctx: null };
  it('a timed late pouch and an untimed one pass', () => {
    expect(wellFormed(root([{ ...base, late: true, enteredAt: '2026-10-02T02:05:11.000Z' }]))).toBe(true);
    expect(wellFormed(root([{ ...base, late: true, timeKnown: false, enteredAt: '2026-10-02T02:05:11.000Z' }]))).toBe(true);
  });
  it('a void passes, even with a non-string target (stored data that never matches a pouch)', () => {
    const v = { id: 'v', ts: '2026-10-02T02:05:11.000Z', tzOffsetMin: -300, day: '2026-10-01', type: 'void', target: 'p', trigger: null };
    expect(wellFormed(root([base, v]))).toBe(true);
    expect(wellFormed(root([base, { ...v, target: 42 }]))).toBe(true);
    expect(wellFormed(root([base, { ...v, target: null }]))).toBe(true);
  });
  it('an object where a renderable belongs still fails', () => {
    expect(wellFormed(root([{ ...base, late: { yes: true } }]))).toBe(false);
    expect(wellFormed(root([{ ...base, enteredAt: {} }]))).toBe(false);
  });
});
```

(`freshRoot`, `attemptShape`, `wellFormed` already exist in that file.) Run: all existing root tests still pass — that is requirement (b).

- [ ] **Step 2: `awards.test.js`**

```js
describe('voids and untimed pouches', () => {
  const voidOf = (p) => ({ id: `v${++seq}`, ts: '2026-09-25T17:00:00.000Z', tzOffsetMin: -300, day: p.day, type: 'void', target: p.id, trigger: null });
  it('a celebrated award survives a void that un-derives it (latched, earnedOn null)', () => {
    // honest-yellow: day 1 at 9 > cap 8 — then the ninth pouch is voided
    const evs = pouches('2026-09-21', 9);
    const before = attempt(evs);
    expect(get(before, 'honest-yellow').earned).toBe(true);
    const after = attempt([...evs, voidOf(evs[8])], { celebratedAwards: ['honest-yellow'] });
    expect(get(after, 'honest-yellow')).toMatchObject({ earned: true, earnedOn: null, progress: 1 });
    expect(get(attempt([...evs, voidOf(evs[8])]), 'honest-yellow').earned).toBe(false); // not celebrated → truly un-derived
  });
  it('a day with an untimed pouch is never allOnTime', () => {
    // a settled day whose every tap is on time earns on-the-clock; add an untimed pouch and it doesn't
    const D = '2026-09-21';
    const stage = plan.stages[0];
    const onTime = stage.slots.slice(0, stage.pouchesPerDay).map((s, i) => ({ ...ev('pouch', D), ts: `${D}T${String(12 + i).padStart(2, '0')}:00:00.000Z`, ctx: { nth: i + 1, cap: stage.pouchesPerDay, slotId: s.id, slotLabel: s.label, slotAt: `${D}T${String(11 + i).padStart(2, '0')}:00:00.000Z`, firstSlotAt: `${D}T11:00:00.000Z` } }));
    expect(get(attempt(onTime), 'on-the-clock').earned).toBe(true);
    const u = { ...ev('pouch', D), ts: '2026-09-25T17:00:00.000Z', ctx: null, late: true, timeKnown: false, enteredAt: '2026-09-25T17:00:00.000Z' };
    expect(get(attempt([...onTime.slice(1), u]), 'on-the-clock').earned).toBe(false);
  });
  it('day-zero is unaffected by a void on an earlier day', () => {
    const q = plan.stages.at(-1).days[0];
    const evs = pouches('2026-09-21', 3);
    const a = attempt([...evs, voidOf(evs[0])]);
    expect(get(a, 'day-zero').earned).toBe(false); // quit day not reached — unchanged by the void
    expect(q).toBeGreaterThan(5);
  });
});
```

If the `on-the-clock` first assertion needs the ctx shaped differently (cap vs slots), read `dayFacts.allOnTime` and adjust the fixture — the contract is: all-on-time day earns; the same day with one untimed pouch replacing one tap does not.

- [ ] **Step 3: `money.test.js`**

```js
describe('voids and untimed pouches in money', () => {
  const voidOf = (p) => ({ id: `v${++seq}`, ts: '2026-09-25T17:00:00.000Z', tzOffsetMin: -300, day: p.day, type: 'void', target: p.id, trigger: null });
  it('a void changes kept money exactly as if the pouch were never logged', () => {
    const evs = [...pouches('2026-09-21', 6), ...pouches('2026-09-22', 5)];
    const A = moneyStats(attempt([...evs, voidOf(evs[2])]));
    const B = moneyStats(attempt(evs.filter((e) => e.id !== evs[2].id)));
    expect(A).toEqual(B);
  });
  it('an untimed pouch costs the same as a tap', () => {
    const u = { ...ev('pouch', '2026-09-21'), ts: '2026-09-25T17:00:00.000Z', ctx: null, late: true, timeKnown: false, enteredAt: '2026-09-25T17:00:00.000Z' };
    expect(moneyStats(attempt([...pouches('2026-09-21', 5), u])).spent).toBe(moneyStats(attempt(pouches('2026-09-21', 6))).spent);
  });
});
```

- [ ] **Step 4: `ingest.test.js`** — inside `describe('renderLiveLog')`, using that file's `a2`/`ev` helpers (read the top of the file for the exact names):

```js
  it('a voided pouch is gone from used; an untimed-only day shows — for first pouch; a day whose only pouch is voided reads no log', () => {
    const d1 = '2026-09-21', d2 = '2026-09-22', d3 = '2026-09-23';
    const p1 = ev('pouch', d1), p2 = ev('pouch', d1), only = ev('pouch', d3);
    const u = { ...ev('pouch', d2), ts: '2026-09-25T17:00:00.000Z', ctx: null, late: true, timeKnown: false, enteredAt: '2026-09-25T17:00:00.000Z' };
    const v = (p) => ({ ...ev('void', p.day), target: p.id });
    const root = { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [{ ...a2, events: [p1, p2, v(p2), u, only, v(only)] }] };
    const md = renderLiveLog(root, { exportedAt: '2026-09-25T17:00:00.000Z', now: new Date() });
    const row = (d) => md.split('\n').find((l) => l.includes(`| ${d} |`));
    expect(row(d1)).toMatch(/\| 1 \| 0 \| 0 \| /);            // used 1 (p2 voided)
    expect(row(d2)).toMatch(/\| 1 \| 0 \| 0 \| — \|/);         // used 1, first —
    expect(row(d3)).toContain('no log');
  });
```

Adjust the regexes to the column order in `dayRow` (`Day | Date | Cap | Used | Early | Over | First | Resisted | Sleep | Status`) if they don't match on first run — the three facts are what's pinned.

- [ ] **Step 5: `coach.js` + `coach.test.js`**

Replace in `src/coach.js:69` the parenthetical `(correct a total, add reasons to a pouch)` with `(add a pouch you missed, with its time or 'unknown'; mark an accidental tap as a mistake; correct a past total; add reasons)`. In `coach.test.js` beside the `'Fix this day'` pin add:

```js
    expect(system).toContain("add a pouch you missed, with its time or 'unknown'; mark an accidental tap as a mistake");
```

- [ ] **Step 6: Run — green; whole suite; lint; commit**

```bash
git add src/__tests__/root.test.js src/__tests__/awards.test.js src/__tests__/money.test.js src/__tests__/ingest.test.js src/__tests__/coach.test.js src/coach.js
git commit -m "Pins: late and void shapes are well-formed; awards latch, money and the Live Log follow the live list; coach names the new path"
```

---

### Task 5: `FixDaySheet.jsx` — Add a pouch, Mark as mistake, struck rows, today unlocked

Needs Task 3 merged. Design brief: Modern Dark Cinema unchanged; 44px targets; 16px inputs; Framer springs only; height animates like `ReasonEditor`; `?static`/reduced motion honoured (use `motion.*` with the file's `spring`, nothing hand-rolled). Copy is warm, direct, shame-free. A struck row is muted, never red; "added later" and "time unknown" are faint facts.

**Files:**
- Create: `src/components/ReasonFields.jsx`
- Modify: `src/components/FixDaySheet.jsx`

- [ ] **Step 1: Extract `ReasonFields`**

```jsx
// The trigger chips and the note, as one controlled block. ReasonEditor (why a
// pouch happened) and AddPouchCard (why a remembered pouch happened) both draw
// it, so the two can never drift apart.
import { motion } from 'framer-motion';
import { TRIGGERS } from '../triggers.js';

export const NOTE_MAX = 140;
const chipStyle = { minHeight: 36, padding: '6px 13px', fontSize: 13 };

export default function ReasonFields({ picked, note, onToggle, onNote }) {
  return (
    <>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {TRIGGERS.map((t) => (
          <motion.button key={t} type="button" className={`chip ${picked.includes(t) ? 'selected' : ''}`} aria-pressed={picked.includes(t)} style={chipStyle} whileTap={{ scale: 0.94 }} onClick={() => onToggle(t)}>
            {t}
          </motion.button>
        ))}
      </div>
      <input type="text" aria-label="Note" placeholder="anything else?" maxLength={NOTE_MAX} value={note} onChange={(e) => onNote(e.target.value)}
        style={{ width: '100%', marginTop: 10, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg)', fontSize: 16 }} />
    </>
  );
}
```

`ReasonEditor` keeps its state (`picked`, `note`, `failed`) and renders `<ReasonFields picked={picked} note={note} onToggle={toggle} onNote={(v) => { setNote(v); setFailed(false); }} />`. Remove `TRIGGERS` and `NOTE_MAX` from FixDaySheet's imports/consts (import `NOTE_MAX` only if still used).

- [ ] **Step 2: `AddPouchCard`**

Props: `{ state, day, isToday }`. Imports: `resolveLate, fmtHM` from `../latePouch.js`; `UNDO_WINDOW_MS` from `../justLogged.js`; `useApp` (api, tick).

State: `open` (bool, default false), `time` (string `'HH:MM'`; default today → the current minute as `HH:MM` from `new Date()`, past → `'12:00'`), `unknown` (bool), `picked`, `note`, `failed`, `added` (`{ id, until } | null`).

Collapsed: one full-width row button (`minHeight: 48`) — `aria-label="Add a pouch"`, text **Add a pouch** with a faint second line *one you missed, with its time*. Tap → `open`. The expanded form (inside `<AnimatePresence initial={false}>` with the same `initial/animate/exit` height block ReasonEditor uses):

1. Row: `<input type="time" aria-label="Time" value={time} disabled={unknown} onChange…>` styled `fontSize: 16, minHeight: 44, padding: '0 12px', borderRadius: 12, border: '1px solid var(--border-strong)', background: 'var(--surface)', color: 'var(--fg)'` beside a chip `aria-pressed={unknown}` **I don't remember the time**.
2. `<ReasonFields …/>`.
3. The resolved line, `role="status" aria-live="polite"`, `className="small"`: `${fmtHeader(day)} · ${unknown ? 'time unknown' : fmtHM(time)}`; when `resolved.nextCalendarDay` append ` · counts toward ${fmtShort(day)} (days run to 4 AM)` in faint; when `resolved.future` the line instead reads `${fmtHM(time)} — that's later than now` in `var(--fg-muted)`, and Save is disabled.
4. Buttons row: ghost **Cancel** (closes, resets) · accent **Save pouch** (`disabled={!resolved.ok || resolved.future}`). On click: `const id = api.logLatePouch({ day, time: unknown ? null : time, triggers: picked, note }); if (!id) setFailed(true); else { setAdded({ id, until: Date.now() + 12000 }); setOpen(false); reset fields }`.
5. `failed && <SaveFailed text="That didn’t save — check the time and try again." />`.

Added state (replaces the collapsed row while `added && Date.now() < added.until`; `tick` from `useApp` re-renders each second so it falls off on its own): a row reading **Added** in `var(--green)` + a chip `aria-label="Undo adding this pouch"` **Undo** → `api.undoEvent(added.id); setAdded(null)`. After `until`, `setAdded(null)` on the next render (derive: `const showAdded = added && Date.now() < added.until`; when `added && !showAdded` clear it in an effect or inline on next open). Resolution: compute `resolved = resolveLate({ day, time: unknown ? null : time })` on each render — it reads `Date.now()`, which `tick` refreshes, so "later than now" turns false as the minute passes.

- [ ] **Step 3: `ReasonEditor` gains Mark as mistake with a confirm step**

New prop `onMarked(voidId)`. State `confirming` (bool). Button row:
- not confirming: ghost **Mark as mistake** (`flex: '0 0 auto'`) · ghost **Cancel** · accent **Save reasons**;
- confirming (swap inside `<AnimatePresence mode="wait">`, same height spring): a `<p className="small" style={{ margin: '2px 0 10px' }}>` **Mark this pouch as a mistake? It stops counting; it stays in your history.** then ghost **Keep it** (→ `setConfirming(false)`) · accent **Confirm** → `const v = api.voidPouch(ev.id); if (v) { onMarked(v); onDone(); } else setFailed(true);`.

Hidden when `readOnly` (`useApp().readOnly`) — the editor itself never shows read-only today, but guard the button anyway.

- [ ] **Step 4: `PouchList` reads raw and draws three facts**

- `rawEventsForDay(state, day).filter(pouch)`, sorted by `ts` (unchanged sort — an untimed pouch sorts by its enteredAt; fine).
- State `marked` (`{ id, voidId, until } | null`) set by `onMarked` from the editor.
- Per row `const { voided, late, untimed } = pouchFlags(state, ev)`.
- Clock segment: `untimed ? 'time unknown' : fmtTime(ev)`; aria-label `untimed ? 'Pouch, time unknown' : \`Pouch at ${fmtTime(ev)}\``.
- Late: a faint segment **added later** after the verdict.
- Voided: the row is a `<div role="listitem" aria-label={`${label}, marked as a mistake`}>` with the same layout but no `onClick`, no pencil, `textDecoration: 'line-through'` on the time and verdict spans, everything in `var(--fg-faint)`, dot `background: var(--fg-faint)`, trailing segment **mistake**. While `marked?.id === ev.id && Date.now() < marked.until`: trailing **Marked** + chip `aria-label="Undo marking this pouch"` **Undo** → `api.undoEvent(marked.voidId); setMarked(null)`.
- The header line: "Pouches with a time" → **Pouches**; the hint "Tap one to add why it happened." → **Tap one to add why it happened, or to mark a mistake.** Empty state: **None logged yet.**

- [ ] **Step 5: `FixDaySheet` layout and today's copy**

- `const canAdd = n >= 1 && day <= todayKey(); const rawPouches = rawEventsForDay(state, day).some((e) => e.type === 'pouch');` (import `todayKey`, `rawEventsForDay`, `pouchFlags` from store).
- Order: header → `{status === 'nolog' && <BackfillForm card>}` → `{(green|yellow) && n <= totalDays && <CorrectionForm>}` → `{isToday && <p className="small muted" style={{ margin: '14px 0 0' }}>Today's total comes from the log — add one you missed below.</p>}` → `{canAdd && !readOnly && <AddPouchCard key={day} state={state} day={day} isToday={isToday} />}` → `{(status !== 'nolog' || rawPouches) && <PouchList …/>}` → Done.
- Delete the "corrections open tomorrow" paragraph.
- The sheet's doc comment: "Everything here appends: a backfill, a correction, a reason, a remembered pouch, or a void. Nothing logged is ever rewritten."

- [ ] **Step 6: Verify by hand in the browser** — `npm run dev` is fine for a look, but the gate is the walk (Task 7). Run `npm test` and `npm run lint` (one known warning) and `npm run build && rm -rf dist/`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ReasonFields.jsx src/components/FixDaySheet.jsx
git commit -m "Fix this day: add a pouch you missed (time or unknown), mark a mistake with a confirm, today unlocked

The Add card and the confirm step animate height like ReasonEditor; the
resolved line and the 'later than now' check come from latePouch.js, the same
module the api validates with. A struck row is muted, never red."
```

---

### Task 6: `HistoryTimeline.jsx` and `TodayLog.jsx` rows; `renderGuards` tests

Parallel with Task 5 (disjoint files). Needs Task 2.

**Files:**
- Modify: `src/components/HistoryTimeline.jsx` (`DayRows` reads `rawEventsForDay`; `EventRow` pouch branch; `void` → `null`)
- Modify: `src/components/TodayLog.jsx` (reads `rawEventsForDay(state, todayKey())`; pouch row; drop the local `pouchVerdict` copy and import `pouchVerdict` from `../pouchVerdict.js`; `void` → `null`)
- Modify: `src/__tests__/renderGuards.test.js`

- [ ] **Step 1: Failing tests in `renderGuards.test.js`** — extend `hostile` with:

```js
  { id: 'p2', ts: `${DAY}T16:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null, late: 'yes', enteredAt: {} },
  { id: 'p3', ts: `${DAY}T17:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null, late: true, timeKnown: false, enteredAt: `${DAY}T17:00:00.000Z` },
  { id: 'p4', ts: `${DAY}T18:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null },
  { id: 'v1', ts: `${DAY}T18:30:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'void', target: 'p4', trigger: null },
  { id: 'v2', ts: `${DAY}T18:31:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'void', target: { evil: true }, trigger: null },
```

and assertions in both the TodayLog and HistoryTimeline cases: output contains `time unknown` once, `mistake` once, `added later` once (p3 only — p2's `late: 'yes'` is not late), does not contain `[object Object]`, and contains no row for `v1`/`v2` themselves (count of `line-through` is 1).

- [ ] **Step 2: `HistoryTimeline.jsx`**

Imports: swap `eventsForDay` for `rawEventsForDay`, add `pouchFlags`. `DayRows`: `[...rawEventsForDay(state, dateStr)]`. In `EventRow`'s pouch branch:

```jsx
    const { voided, late, untimed } = pouchFlags(state, ev);
    const v = pouchVerdict(state, ev);
    const color = voided ? 'var(--fg-faint)' : v.color;
    const struck = voided ? { textDecoration: 'line-through' } : undefined;
    icon = <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'block', opacity: 0.85 }} />;
    segs = [
      <span key="t" className="muted num" style={struck}>{untimed ? 'time unknown' : fmtTime(ev)}</span>,
      ...(slotLabel ? [<span key="s" className="muted" style={struck}>{slotLabel}</span>] : []),
      <span key="v" style={{ color, fontWeight: 500, ...struck }}>{v.text}</span>,
      ...(late ? [<span key="l" className="faint">added later</span>] : []),
      ...(voided ? [<span key="x" className="faint">mistake</span>] : []),
      ...tagSeg, ...(note ? [...] : []),
    ];
```

The `else` branch comment: "`reason` and `void` events never render as lines — a reason shows on its pouch; a void shows as the strike on its pouch."

- [ ] **Step 3: `TodayLog.jsx`** — the same three facts in the pouch row (`time unknown` replaces the clock, `added later` faint, struck + `mistake` when voided), reading `rawEventsForDay(state, todayKey())`. Replace the local `pouchVerdict(v)` with `import { pouchVerdict } from '../pouchVerdict.js'` and call `pouchVerdict(state, ev)` (same strings; one source). The "since last pouch" ticker is unchanged (live, skips untimed via Task 2).

- [ ] **Step 4: Run — green; lint; commit**

```bash
git add src/components/HistoryTimeline.jsx src/components/TodayLog.jsx src/__tests__/renderGuards.test.js
git commit -m "History and Today's log draw the three new row facts: struck mistake, added later, time unknown"
```

---

### Task 7: `walk-latepouch.mjs`, `run-all.mjs`, `CLAUDE.md`

Needs 5 and 6. Model the walk on `walk-fixday.mjs` — same pinned-clock pattern (`atNow`, `TZ`, `tsFor`, `celebratedFor`, `clearOverlay`, `tab`, `openHistory`, `sheetLoc`, `storedRoot`, `checkAppendOnly`), fresh file. Port **4341**. Before running a walk, `lsof -i :4341` — another walk may hold the port.

**Files:**
- Create: `scripts/e2e/walk-latepouch.mjs`
- Modify: `scripts/e2e/run-all.mjs` (`WALKS` gains `{ name: 'walk-latepouch', port: 4341 }` last)
- Modify: `CLAUDE.md` domain rules

- [ ] **Step 1: The fixture**

Clock `NOW = '2026-09-24T21:00:00-05:00'` (Thu, Day 3, 9 PM CDT). Same 90-day plan and settings as walk-fixday (cap 8, perPouch $0.25). Events: d1 six pouches, d2 four, **today three** taps at the first three slots (+5 min). Pre-mark awards via `celebratedFor` over the states `[seed, +reason+pouch, +reason+pouch+void]`. `checkinDismissedFor: TODAY`.

Hand numbers: today 3/8 → after the add 4/8 → after the void 3/8. Money: `loggedDays 3`, used 13 → 14 → 13 at $0.25: kept = 3×9×0.25 − used×0.25 = $6.75 − $3.25 = **$3.50** → **$3.25** → **$3.50**. Write them in the file's comment block AND assert them via `moneyStats` on the stored attempt (hand vs store.js, like `domainChecks`).

The expected appended events: `REASON = { type:'reason', day: TODAY, target: <pouch id>, triggers:['boredom'], note: '' }`, `POUCH = { type:'pouch', day: TODAY, ts: tsFor(TODAY,'16:30'), tzOffsetMin: -300, ctx: null, late: true, enteredAt: <NOW-ish> }`, `VOID = { type:'void', day: TODAY, target: <one of the seeded today taps> }`.

- [ ] **Step 2: The steps**

1. Open `?static` → Today renders; **Today ring/count reads 3** (read the `LogRing` text or the Today's log row count — pick the stable one, assert it).
2. Calendar → tap today's cell (`[aria-label^="Day 3, Sep 24:"]`) → sheet "Fix this day" for Day 3; **the sheet contains "Today's total comes from the log"** and does NOT contain "corrections open tomorrow"; no "Actual total" spinbutton (today keeps the stepper closed).
3. Tap **Add a pouch** → `getByLabel('Time')` → `fill('16:30')` → chip **boredom** (aria-pressed) → the `role=status` line reads `Thu, Sep 24 · 4:30 PM` (use the sheet's own `fmtHeader` format; assert `/4:30 PM/`) → snap `add-card-open` → **Save pouch** → the card shows **Added** and an **Undo** chip → snap `added`. Also before saving, set the time to `22:30` and assert the line reads "later than now" and Save is disabled; then back to `16:30`.
4. Done → storage: seeded events byte-identical, exactly two appended: reason then pouch; the pouch has `ts === tsFor(TODAY,'16:30')` ISO, `day === TODAY`, `late === true`, `ctx === null`, `enteredAt` parses and its day is TODAY; the reason targets the pouch with `['boredom']`.
5. Reload (no re-seed) → Stats → History → Day 3 rows: a row with `4:30 PM`, `added later`, `boredom`; header `4/8`; Today tab: the Money card dropped by one pouch (kept reads `$3.25`; find the figure the card prints — read `MoneyCard.jsx` for the exact text).
6. Stats → History → pencil `Fix Day 3, Sep 24` → tap the row of the **first seeded tap today** (`Pouch at <fmtTime>`) → **Mark as mistake** → the confirm text **Mark this pouch as a mistake? It stops counting; it stays in your history.** is visible → snap `confirm` → **Confirm** → the editor closes; the row is now a `listitem` whose text contains `mistake` and **Marked** + **Undo**; snap `struck-row` → Done.
7. Reload → History Day 3 header `3/8`; the struck row's text contains `mistake`; `4:30 PM` row still there; Today's ring reads 3; Money kept back to `$3.50`. Snap `reload-history` (fullPage) and `today-log`.
8. Storage: seeded byte-identical; exactly **three** appended: reason, pouch, void; the void's `target` is the first seeded tap's id, `day === TODAY`; ids unique. `v1Unchanged(page, null, rec)`.

Screenshots the coordinator needs (named exactly): `add-card-open`, `struck-row`, `reload-history`, `today-log`.

- [ ] **Step 3: `run-all.mjs`** — append `{ name: 'walk-latepouch', port: 4341 },` to `WALKS`.

- [ ] **Step 4: Run** — `node scripts/e2e/walk-latepouch.mjs --dry` (fixture + hand-vs-store checks), then `node scripts/e2e/walk-latepouch.mjs --out /tmp/…` with a private build, then `npm run e2e` → 7/7, 0 console errors.

- [ ] **Step 5: `CLAUDE.md`** — in Domain rules, after the Event types bullet, add:

```
- **A pouch may carry `late: true`, `enteredAt` (when it was written) and
  `timeKnown: false`** (a remembered pouch whose time is unknown: `ts ===
  enteredAt`, `day` chosen, counted everywhere, clocked nowhere). **`void`
  events** (`{ day, target }`) name a pouch that was a mistake; the pouch is
  never touched. **Counts come only from `liveEvents`/`eventsForDay`
  (`src/liveEvents.js`).** Raw events (`rawEventsForDay`, `state.events`) are
  for drawing struck rows and for the write guards, nothing else. Accepted
  drift: adding a pouch between two taps does not renumber the later tap's
  stamped ctx, so one per-pouch verdict can be off by a slot; counts, caps,
  streaks, money and awards derive from counts and stay right. `isJustLogged`
  reads `enteredAt ?? ts`. Undo and `tagEvent` are still the only mutations.
```

And in the "Never rewrite logged events" bullet, after "Undo of the just-logged event is the only allowed deletion", nothing changes — append one clause to the api list: `logLatePouch` and `voidPouch` append.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e/walk-latepouch.mjs scripts/e2e/run-all.mjs CLAUDE.md
git commit -m "Walk: add a 4:30 PM pouch at 9 PM, mark a tap as a mistake, reload — three appended events and the numbers agree; domain rules"
```

---

### Task 8: Screenshots, reviews, build log, hand-back (coordinator)

- [ ] Run every gate on the final commit: `npm test`, `npm run lint`, `npm run build && rm -rf dist/`, `npm run e2e` (7/7, 0 console errors). Record the numbers.
- [ ] Read the four after-screenshots from the walk's `--out` folder in the scratchpad (never the repo).
- [ ] Sol (GPT-5.6) one call with `git diff main...HEAD`, store.js / liveEvents.js / state.jsx / the walk called out. Gemini one call with the spec's "The screens" section + final `FixDaySheet.jsx` + the screenshots described in words. Verify every claim against the code; fix accepted ones (fresh implementer, reviewer), log rejected ones with the reason.
- [ ] Write `docs/superpowers/reports/<run-date>-late-pouch-build-log.md` in the voice of the 2026-09-28 log: what changed and why; the concepts (memoized views over an append-only log; one choke point over scattered filters; the 4am rule meeting a time picker); every solo decision (AwardUnlock stays raw; `UNDOABLE` gains `void`; the Add card is collapsed-by-default; the "counts toward … (days run to 4 AM)" hint; `pouchFlags` as the one place the three row facts are read; TodayLog adopting the shared `pouchVerdict`); what each reviewer caught; the gates with numbers; "for Build 2".
- [ ] Commit the log. Hand James the merge command and stop.

---

## Self-review (done while writing)

- **Spec coverage:** data model (T1, T3) · live list + every reader named (T1) · untimed verdict and timing skips (T2) · write rules incl. reason-then-pouch order and double guard (T3) · validation tests (T4) · screens: FixDaySheet (T5), History/TodayLog (T6) · coach copy (T4) · CLAUDE.md (T7) · every listed test (T1–T6) · walk + run-all (T7) · gates and screenshots (T8). One deliberate deviation from the spec's reader list: `AwardUnlock.jsx:165` stays raw (it reads the newest event for the undo wait, where a void is the newest event) — recorded for the build log.
- **Names used consistently:** `liveEvents`, `isVoided`, `pouchFlags`, `rawEventsForDay`, `eventsForDay`, `enteredAtOf`, `resolveLate`, `lateInstant`, `fmtHM`, `reasonBody`, `latePouchOk`, `voidable`, `logLatePouch({ day, time, triggers, note })`, `voidPouch(id)`, bucket `'untimed'`, aria labels `Add a pouch` / `Time` / `Save pouch` / `Mark as mistake` / `Confirm` / `Keep it` / `Undo adding this pouch` / `Undo marking this pouch`.
