// Proves the backfill prompt in a real browser. That prompt is where attempt 2
// stops letting silence score as success: a past day with nothing logged is
// gray `nolog`, and on open the app asks — "No log for Saturday. How many?" —
// and then, only when the answer is within cap, lets the user decide whether
// that day keeps the streak or breaks it. Attempt 1 failed partly because an
// unlogged day looked like a clean one. This walk is the proof that it can't.
//
// What the unit suite cannot see, and this walk does:
//   · the prompt asks the NEWEST missed day first, one day at a time;
//   · Keep really bridges two runs and Break really cuts one — in the streak
//     chip on Today's header, not just in store.js;
//   · the calendar paints a backfilled day as logged, and a skipped one gray;
//   · after a reload the answered days never ask again, the skipped one does,
//     and every event that was already there is byte-for-byte untouched.
//
// Three browser contexts, each on a PINNED clock (America/Chicago), all on the
// same synthetic 90-day plan (9/day · 9 mg · [6, 3], Day 1 Tue 2026-09-22), so
// "today" is always Mon 2026-10-05 = Day 14 and the 7-day window is Days 7–13:
//   A  Keep · Break · Skip   the plan's flow 3, plus: a check-in-only day still
//                            prompts, a skipped day re-prompts after reload, a
//                            gray day 8 days old never prompts, and a detour
//                            into read-only Attempt 1 prompts for nothing.
//   B  over cap              one over the cap never asks Keep/Break; the day
//                            goes amber and the streak stays cut.
//
// A and B also let a DAY GO BY ON THE SAME MOUNT: the page stays open, the
// pinned clock moves to Tue 10-06, and — with no reload and no tab switch —
// the newly missed Monday must be asked. That is how iOS resumes an installed
// PWA: from memory, nothing remounts. A list taken once per mount would stay
// empty for good, and a skipped Tuesday would never ask again — which is how
// attempt 1 faded. (A: yesterday's skip asks again; B: the page opened with
// nothing missed, the exact case a per-mount list got wrong.)
//   C  five missed days      at most 3 are asked per open, whether they're
//                            skipped or answered — answering three never pulls
//                            a 4th in behind them. The next open (a reload)
//                            asks again: the same three after skips, the 4th
//                            and 5th once the first three are answered.
//
// Every expected number is written twice: by hand in the fixture comments (the
// spec's rules applied with a pencil), and by store.js on the attempt READ BACK
// from the browser's localStorage. The walk checks the UI against both, and the
// two against each other — so a drift in the domain, the screen, or the rules
// each shows up as its own failure. `--dry` prints the fixtures, the plan of
// steps and runs the hand-vs-store.js checks, with no browser.
//
// Every fixture is a v2 root with an ARCHIVED Attempt 1 (seed-v1.mjs, migrated
// the way the app migrates it) beside the active Attempt 2, plus the synthetic
// v1 key. So every context also proves: `pouch-down-v1` byte-identical (it is
// the rollback, and nothing in the app may ever write it), and Attempt 1
// untouched — backfill writes only ever land on the active attempt.
//
// Awards are pre-marked as celebrated (every award any state in this walk can
// earn) so an unlock overlay can't sit on top of the prompt. walk-awards.mjs
// owns celebrations; this walk owns the prompt.
//
// Synthetic data only. James's real data never enters this repo; it is public.
//
// Usage: node scripts/e2e/walk-backfill.mjs [--dist DIR] [--out DIR] [--port N] [--keep] [--dry]
import { chromium } from 'playwright-core';
import * as e2e from './lib.mjs';
import { seedV1, seedV1String } from './seed-v1.mjs';
import { generatePlan } from '../../src/planGenerator.js';
import { LEGACY_PLAN } from '../../src/legacyPlan.js';
import { capForDay } from '../../src/plan.js';
import { streaks, statusForDay, missedDays, todayKey } from '../../src/store.js';
import { awardsFor } from '../../src/awards.js';
import { dayKeyAt, offsetMinInZone } from '../../src/time.js';

const args = e2e.parseArgs({ name: 'walk-backfill', port: 4333 });
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------- the clock */

// Node and the browser must agree on "today", or a Day-14 fixture quietly
// becomes Day 13 and every expectation shifts by one. Both run in Chicago, and
// store.js is only ever called here inside atNow(), which pins Node's clock to
// the same instant the browser boots on.
const TZ = 'America/Chicago';
process.env.TZ = TZ;
const NOW = '2026-10-05T10:00:00-05:00'; // Mon, CDT — mid-morning, nothing logged yet today
const NOW_MS = Date.parse(NOW);
const TODAY = '2026-10-05';
// The same-mount day change: the clock jumps here with the page still open.
const NEXT = '2026-10-06T10:00:00-05:00'; // Tue — Mon 10-05 (Day 14) is now a missed day
const NEXT_MS = Date.parse(NEXT);

const RealDate = Date;
function atNow(fn, at = NOW_MS) {
  class PinnedDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(at);
    }
    static now() {
      return at;
    }
  }
  globalThis.Date = PinnedDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/* ------------------------------------------------------------ day helpers */

const epochDay = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86400000);
const dayStrOf = (ed) => new Date(ed * 86400000).toISOString().slice(0, 10);
const addDays = (s, n) => dayStrOf(epochDay(s) + n);
const pad = (n) => String(n).padStart(2, '0');

const START = '2026-09-22'; // Day 1, a Tuesday. TODAY is Day 14.
const TODAY_N = epochDay(TODAY) - epochDay(START) + 1;
const dayOf = (n) => addDays(START, n - 1);
const numOf = (day) => epochDay(day) - epochDay(START) + 1;

// Same formatting BackfillPrompt uses (local noon, so the weekday can't slip).
const weekdayOf = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
const monthDayOf = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const DAY_BY_LABEL = new Map(Array.from({ length: TODAY_N }, (_, i) => [monthDayOf(dayOf(i + 1)), dayOf(i + 1)]));
const short = (n) => `d${n} ${weekdayOf(dayOf(n)).slice(0, 3)} ${monthDayOf(dayOf(n))}`;

/* --------------------------------------------------------------- the plan */

const SETTINGS = {
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  costPerTin: 5,
  pouchesPerTin: 20,
  wakeTime: '07:00',
  sleepTime: '23:00',
};

const PLAN = generatePlan({
  pouchesPerDay: 9,
  mg: 9,
  strengths: [6, 3],
  lengthDays: 90,
  startDate: START,
  mealTimes: SETTINGS.mealTimes,
  sleepTime: SETTINGS.sleepTime,
  pouchesPerTin: SETTINGS.pouchesPerTin,
});
// Days 1–15 are the "Baseline hold" stage at 8/day, so every day in this walk
// has cap 8 (checked in domainChecks — the fixtures lean on it).
const CAP = 8;

/* ------------------------------------------------------------- the events */

const slotHM = (slot) => {
  if (slot.anchor === 'fixed') return slot.time;
  const [h, m] = SETTINGS.mealTimes[slot.anchor].split(':').map(Number);
  const t = h * 60 + m + (slot.offsetMin || 0);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

// Local wall-clock time on `day` in TZ, as epoch ms (resolved twice for DST).
const tsFor = (day, hm, plusMin = 0) => {
  const [h, m] = hm.split(':').map(Number);
  const naive = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m + plusMin) * 60000;
  const ms = naive - offsetMinInZone(naive, TZ) * 60000;
  return naive - offsetMinInZone(ms, TZ) * 60000;
};

// Day codes, one per plan day before today:
//   '6'    six pouches, each five minutes after its slot (green: 6 ≤ cap 8)
//   '8'    exactly the cap — still green
//   '5+r'  five pouches and a resisted craving
//   'c'    only a morning sleep check-in: NOT logged (a check-in says nothing
//          about nicotine), so it is still `nolog` and still prompts
//   '-'    nothing at all: `nolog`
function buildEvents(cid, pattern) {
  const stage = PLAN.stages[0];
  let k = 0;
  const mk = (type, ms, extra = {}) => {
    const tzOffsetMin = offsetMinInZone(ms, TZ);
    return { id: `bf${cid}-${++k}`, ts: new Date(ms).toISOString(), tzOffsetMin, day: dayKeyAt(ms, tzOffsetMin), type, trigger: null, ...extra };
  };
  const events = [];
  for (let n = 1; n < TODAY_N; n++) {
    const code = pattern[n] ?? '-';
    const day = dayOf(n);
    if (code === 'c') {
      events.push(mk('checkin', tsFor(day, '07:30'), { source: 'manual', sleepQuality: 3, workout: false }));
      continue;
    }
    const pouches = Number.parseInt(code, 10) || 0;
    const firstSlotAt = new Date(tsFor(day, slotHM(stage.slots[0]))).toISOString();
    for (let i = 0; i < pouches; i++) {
      const slot = stage.slots[i];
      const slotMs = tsFor(day, slotHM(slot));
      events.push(mk('pouch', slotMs + 5 * 60000, {
        trigger: i === 0 ? 'routine' : null,
        ctx: { nth: i + 1, cap: stage.pouchesPerDay, slotId: slot.id, slotLabel: slot.label, slotAt: new Date(slotMs).toISOString(), firstSlotAt },
      }));
    }
    if (code.endsWith('+r')) events.push(mk('resisted', tsFor(day, '15:20'), { trigger: 'stress' }));
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  return events;
}

// Attempt 1, archived — built the way migrate.js builds it from the same
// synthetic v1 (every event stamped America/New_York), so the root looks like
// James's phone will: a past attempt that ended in silence beside the new one.
function archivedAttempt1() {
  const v1 = seedV1();
  const { apiKey: _k, ...settings } = v1.settings;
  const events = v1.events.map((e) => {
    const ms = Date.parse(e.ts);
    const tzOffsetMin = offsetMinInZone(ms, 'America/New_York');
    return { ...e, tzOffsetMin, day: dayKeyAt(ms, tzOffsetMin) };
  });
  return {
    id: 'a1', status: 'archived', createdAt: events[0].ts, archivedAt: '2026-09-21T13:00:00.000Z',
    settings, plan: LEGACY_PLAN, events,
    celebratedStages: v1.celebratedStages, celebratedAwards: [], checkinDismissedFor: null,
  };
}

// What api.logBackfill appends: stamped NOW (the day it was ENTERED), with
// `day` overridden to the day being filled in.
const backfillEvent = (n, count, streak, i) => ({
  id: `expected-${i}`, ts: new Date(NOW_MS).toISOString(), tzOffsetMin: offsetMinInZone(NOW_MS, TZ),
  day: dayOf(n), type: 'backfill', trigger: null, count, streak,
});
const withBackfills = (attempt, list) => ({
  ...attempt,
  events: [...attempt.events, ...list.map((b, i) => backfillEvent(b.n, b.count, b.streak, i))],
});

/* ------------------------------------------------------------- fixtures */

// A — the plan's flow 3. Streak by hand (a run counts consecutive green days;
// `nolog` and a "Break it here" backfill reset it to 0; today, still unlogged
// at 10 AM, is skipped rather than breaking it):
//
//   d1  Tue 9/22  6      green   run 1
//   d2  Wed 9/23  7      green   run 2
//   d3  Thu 9/24  8      green   run 3   (exactly the cap is still green)
//   d4  Fri 9/25  6      green   run 4
//   d5  Sat 9/26  5+r    green   run 5   ← best 5
//   d6  Sun 9/27  -      nolog   run 0   8 days before today: OUTSIDE the
//                                        window. Never prompts, stays gray.
//   d7  Mon 9/28  6      green   run 1   (first day inside the 7-day window)
//   d8  Tue 9/29  -      nolog   run 0   prompted 3rd → SKIP → stays gray,
//                                        re-prompts after reload
//   d9  Wed 9/30  6      green   run 1
//   d10 Thu 10/1  c      nolog   run 0   check-in only; prompted 2nd →
//                                        leave at cap 8 → BREAK IT HERE
//   d11 Fri 10/2  6      green   run 1
//   d12 Sat 10/3  -      nolog   run 0   prompted 1st (newest) → 5 → KEEP
//   d13 Sun 10/4  6+r    green   run 1
//   d14 Mon 10/5  today, unlogged        skipped
//
//   seeded             current 1 (d13)            best 5 (d1–d5)
//   after Keep d12     current 3 (d11, d12, d13)  best 5   ← Keep extended it
//   after Break d10    current 3                  best 5   ← Keep on d10 would
//                      have made it 5 (d9–d13); Break cut it at d10
//   after Skip d8      unchanged: current 3, best 5
//
// The chip shows "3 day streak" with "best 5" (it names a best only when it's
// ≥ 3 and above the current run — which this layout arranges on purpose).
const A = {
  id: 'A',
  title: 'Keep extends, Break cuts, Skip stays gray',
  pattern: { 1: '6', 2: '7', 3: '8', 4: '6', 5: '5+r', 6: '-', 7: '6', 8: '-', 9: '6', 10: 'c', 11: '6', 12: '-', 13: '6+r' },
  prompts: [12, 10, 8], // newest first
  backfills: [
    { n: 12, count: 5, streak: 'keep' },
    { n: 10, count: CAP, streak: 'break' },
  ],
  hand: {
    seeded: { current: 1, best: 5 },
    steps: [{ current: 3, best: 5 }, { current: 3, best: 5 }],
    counterfactual: { label: 'Keep on d10 instead of Break', list: [{ n: 12, count: 5, streak: 'keep' }, { n: 10, count: CAP, streak: 'keep' }], current: 5, best: 5 },
  },
  gray: [6, 8], // still nolog at the end
};

// B — over cap. By hand:
//
//   d1–d11  6–7 pouches   green   run 1…11  ← best 11
//   d12 Sat 10/3  -       nolog   run 0     prompted → cap 8 + 1 = 9 → Save:
//                                           NO Keep/Break question; amber
//   d13 Sun 10/4  6       green   run 1
//
//   seeded             current 1   best 11
//   after 9 on d12     current 1   best 11  ← over cap broke it (a within-cap
//                      Keep would have made it 13, d1–d13)
const B = {
  id: 'B',
  title: 'an over-cap backfill never asks, and breaks the streak',
  pattern: { 1: '6', 2: '6', 3: '7', 4: '6', 5: '6', 6: '5', 7: '6', 8: '6', 9: '7', 10: '6', 11: '6', 12: '-', 13: '6' },
  prompts: [12],
  backfills: [{ n: 12, count: CAP + 1, streak: 'break' }],
  hand: {
    seeded: { current: 1, best: 11 },
    steps: [{ current: 1, best: 11 }],
    counterfactual: { label: 'a within-cap Keep on d12', list: [{ n: 12, count: CAP, streak: 'keep' }], current: 13, best: 13 },
  },
  gray: [],
};

// C — five missed days inside the window; only three may be asked per open.
//
//   d1–d7   6       green   run 1…7  ← best 7
//   d8  Tue 9/29  - nolog   5th newest: not asked in opens 1–2; open 3 asks it 2nd
//   d9  Wed 9/30  - nolog   4th newest: not asked in opens 1–2; open 3 asks it 1st
//   d10 Thu 10/1  6 green   run 1
//   d11 Fri 10/2  - nolog   asked 3rd
//   d12 Sat 10/3  - nolog   asked 2nd
//   d13 Sun 10/4  - nolog   asked 1st
//
//   seeded             current 0 ("No streak going yet")   best 7
//   open 1: Skip ×3 → prompt gone, all five still gray
//   open 2 (reload): the same three again → Keep 6 on each → prompt gone,
//                    NO 4th day asked this open (d9, d8 still gray)
//   after d13, d12, d11 kept   current 4 (d10–d13)          best 7
//   open 3 (reload): d9, then d8 → Skip both → prompt gone
const C = {
  id: 'C',
  title: 'at most three prompts per open',
  pattern: { 1: '6', 2: '6', 3: '6', 4: '6', 5: '6', 6: '6', 7: '6', 8: '-', 9: '-', 10: '6', 11: '-', 12: '-', 13: '-' },
  prompts: [13, 12, 11],
  backfills: [
    { n: 13, count: 6, streak: 'keep' },
    { n: 12, count: 6, streak: 'keep' },
    { n: 11, count: 6, streak: 'keep' },
  ],
  hand: {
    seeded: { current: 0, best: 7 },
    steps: [{ current: 1, best: 7 }, { current: 2, best: 7 }, { current: 4, best: 7 }],
    counterfactual: null,
  },
  gray: [8, 9],
};

const CONTEXTS = [A, B, C];

const V1 = seedV1String();
const A1 = archivedAttempt1();
const A1_JSON = JSON.stringify(A1);

// Every award any state of this context can reach, pre-marked as celebrated.
function celebratedFor(attempt, backfills, extra = []) {
  const states = [attempt];
  for (let i = 1; i <= backfills.length; i++) states.push(withBackfills(attempt, backfills.slice(0, i)));
  for (const list of extra) states.push(withBackfills(attempt, list));
  const ids = new Set();
  for (const s of states) for (const a of atNow(() => awardsFor(s))) if (a.earned) ids.add(a.id);
  return [...ids].sort();
}

function fixtureFor(X) {
  const bare = {
    id: 'a2', status: 'active', createdAt: '2026-09-22T01:30:00.000Z', archivedAt: null,
    settings: SETTINGS, plan: PLAN, events: buildEvents(X.id, X.pattern),
    celebratedStages: [], celebratedAwards: [],
    checkinDismissedFor: TODAY, // keeps the morning check-in card out of the shots
  };
  const extra = X.hand.counterfactual ? [X.hand.counterfactual.list] : [];
  const attempt = { ...bare, celebratedAwards: celebratedFor(bare, X.backfills, extra) };
  const root = { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [A1, attempt] };
  return { attempt, root, rootJSON: JSON.stringify(root) };
}

const FIX = Object.fromEntries(CONTEXTS.map((X) => [X.id, fixtureFor(X)]));

/* --------------------------------------------- hand vs store.js, no browser */

const sameStreak = (s, h) => s.current === h.current && s.best === h.best;
const fmtS = (s) => `current ${s.current} · best ${s.best}`;

function domainChecks(rec) {
  rec.section('domain · hand derivation vs store.js (no browser)');
  rec.check('Pinned clock: Node and store.js agree today is Mon 2026-10-05 (Day 14)',
    atNow(() => todayKey()) === TODAY && TODAY_N === 14, `todayKey ${atNow(() => todayKey())}, day ${TODAY_N}`);
  const caps = Array.from({ length: TODAY_N }, (_, i) => capForDay(PLAN, i + 1));
  rec.check(`Every fixture day has cap ${CAP} (Baseline hold)`, caps.every((c) => c === CAP), caps.join(','));

  for (const X of CONTEXTS) {
    const { attempt } = FIX[X.id];
    const md = atNow(() => missedDays(attempt)).map((d) => numOf(d.day));
    rec.check(`${X.id}: missedDays() asks ${X.prompts.map((n) => `d${n}`).join(', ')}, newest first`,
      JSON.stringify(md) === JSON.stringify(X.prompts), `store.js says ${md.map((n) => `d${n}`).join(', ') || 'none'}`);
    const s0 = atNow(() => streaks(attempt));
    rec.check(`${X.id}: seeded streak by hand = store.js (${fmtS(X.hand.seeded)})`, sameStreak(s0, X.hand.seeded), `store.js ${fmtS(s0)}`);
    X.backfills.forEach((b, i) => {
      const s = atNow(() => streaks(withBackfills(attempt, X.backfills.slice(0, i + 1))));
      rec.check(`${X.id}: after ${b.streak} ${b.count} on d${b.n}, hand = store.js (${fmtS(X.hand.steps[i])})`,
        sameStreak(s, X.hand.steps[i]), `store.js ${fmtS(s)}`);
    });
    const cf = X.hand.counterfactual;
    if (cf) {
      const s = atNow(() => streaks(withBackfills(attempt, cf.list)));
      rec.check(`${X.id}: counterfactual (${cf.label}) = ${fmtS(cf)} — so the real choice visibly mattered`,
        sameStreak(s, cf) && !sameStreak(cf, X.hand.steps[X.hand.steps.length - 1]), `store.js ${fmtS(s)}`);
    }
    const grays = X.gray.map((n) => atNow(() => statusForDay(withBackfills(attempt, X.backfills), dayOf(n))));
    if (X.gray.length) {
      rec.check(`${X.id}: ${X.gray.map((n) => `d${n}`).join(', ')} still nolog after the backfills`,
        grays.every((s) => s === 'nolog'), grays.join(','));
    }
  }
}

function printFixtures() {
  log(`\nclock: ${NOW} (${TZ}) — today ${TODAY} = Day ${TODAY_N}; window = Days ${TODAY_N - 7}–${TODAY_N - 1}`);
  log(`plan: 90 days from ${START} → quit ${PLAN.quitDate}; stage 1 "${PLAN.stages[0].name}" days ${PLAN.stages[0].days.join('–')} at ${CAP}/day`);
  log(`storage: pouch-down-v1 = seedV1String() (${V1.length} bytes) · pouch-down-v2 = { a1 archived (${A1.events.length} events, legacy plan), a2 active }`);
  for (const X of CONTEXTS) {
    const { attempt } = FIX[X.id];
    log(`\n${X.id} · ${X.title}`);
    for (let n = 1; n < TODAY_N; n++) {
      const st = atNow(() => statusForDay(attempt, dayOf(n)));
      const mark = X.prompts.includes(n) ? `  ← prompt #${X.prompts.indexOf(n) + 1}` : '';
      log(`  ${short(n).padEnd(16)} ${String(X.pattern[n] ?? '-').padEnd(4)} ${st}${mark}`);
    }
    log(`  events ${attempt.events.length} · celebratedAwards ${attempt.celebratedAwards.join(', ')}`);
    log('  steps:');
    STEPS[X.id].forEach((s, k) => log(`   ${String(k + 1).padStart(2)}. ${s}`));
  }
}

const STEPS = {
  A: [
    'open Today → prompt asks d12 (Sat Oct 3) first; stepper starts at cap 8',
    'step down to 5 → Save → fork shows "Your call…" with Keep my streak / Break it here → Keep',
    'chip reads 3 (was 1); prompt moves to d10 (Thu Oct 1, check-in only)',
    'leave at 8 (= cap, within cap) → Save → fork → Break it here; chip stays 3, best 5',
    'prompt moves to d8 (Tue Sep 29) → Skip → prompt gone; d6 (8 days old) never asked',
    'storage: exactly two new backfill events; every seeded event byte-identical; a1 untouched',
    'Calendar: d12 5/8 and d10 8/8 logged; d6, d8 gray; every day matches statusForDay()',
    'reload → only d8 asks again (d12/d10 never); backfills survived (no re-seed) → Skip',
    'same mount, clock → Tue 10-06: Day 15; asks d14 (Mon, newly missed), then d8 again (skips reset with the day) → Skip both',
    'Settings → Attempt 1 (read-only): no prompt at all → Exit; a1 + v1 still byte-identical',
  ],
  B: [
    'open → prompt asks d12 → step up to 9 (cap + 1) → Save',
    'no Keep/Break question ever appears; backfill stored with streak "break"',
    'chip: 1, best 11 (a within-cap Keep would have made 13); Calendar: d12 amber 9/8',
    'reload → no prompt; storage append-only; a1 + v1 byte-identical',
    'same mount, clock → Tue 10-06 (opened with nothing missed): Day 15; asks d14 (Mon) → Skip',
  ],
  C: [
    'open → d13, Skip → d12, Skip → d11, Skip → prompt gone (exactly 3 asked; d9, d8 never)',
    'Calendar: all five missed days still gray',
    'reload → d13 asked first again → Keep 6 · d12 Keep 6 · d11 Keep 6',
    'after the third answer: NO 4th prompt this open (d9, d8 stay unasked, still gray)',
    'chip: 4, best 7; storage: exactly three backfills, append-only',
    'reload → the 4th (d9) is asked now, then d8 → Skip both → prompt gone',
    'Calendar: d13, d12, d11 logged 6/8; d9, d8 gray; a1 + v1 byte-identical',
  ],
};

/* ---------------------------------------------------------------- browser */

const UNLOCK = '[role="dialog"][aria-modal="true"][aria-labelledby]';
const notes = [];

// An award unlock sitting on top of the prompt would block every tap. The
// fixtures pre-mark every reachable award, so this should never fire; if it
// does, dismiss it and say so rather than let it masquerade as a prompt bug.
async function clearOverlay(page, where) {
  for (let i = 0; i < 4; i++) {
    const n = await page.locator(UNLOCK).count();
    if (!n) return;
    const t = (await page.locator(UNLOCK).first().innerText().catch(() => '')).split('\n')[0];
    notes.push(`unexpected award overlay at ${where}: "${t}"`);
    log(`  (dismissed an unexpected award overlay at ${where}: "${t}")`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

// The prompt is the card that asks "No log for …". Innermost match, in case a
// parent ever becomes a card too.
const promptCard = (page) => page.locator('.card').filter({ hasText: /No log for/i }).last();

async function promptState(page) {
  const card = promptCard(page);
  if (!(await card.count())) return null;
  const text = await card.innerText().catch(() => null);
  if (text === null) return null;
  const weekday = text.match(/No log for (\w+)/i)?.[1] ?? null;
  const monthDay = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}\b/)?.[0] ?? null;
  const statusText = await card.locator('[role="status"]').first().innerText().catch(() => '');
  const count = Number((statusText || text.replace(/No log for[^\n]*/i, '')).match(/\d+/)?.[0] ?? NaN);
  const day = DAY_BY_LABEL.get(monthDay) ?? null;
  return { text, weekday, monthDay, day, n: day ? numOf(day) : null, count, fork: /Your call/i.test(text) };
}

// Polls until `pred(state)` holds (state may be null = no prompt).
async function waitPrompt(page, pred, ms = 5000) {
  const deadline = Date.now() + ms;
  let s = null;
  do {
    s = await promptState(page);
    if (pred(s)) return { ok: true, s };
    await page.waitForTimeout(120);
  } while (Date.now() < deadline);
  return { ok: false, s };
}

const promptBtn = (page, rx) => promptCard(page).getByRole('button', { name: rx }).first();

async function tap(page, rx) {
  try {
    const b = promptBtn(page, rx);
    await b.waitFor({ state: 'visible', timeout: 4000 });
    await b.click();
    await page.waitForTimeout(200);
    return true;
  } catch {
    return false;
  }
}

// Sets the stepper to `target` one tap at a time, like a thumb would.
async function setCount(page, target) {
  for (let i = 0; i < 45; i++) {
    const s = await promptState(page);
    if (!s || !Number.isFinite(s.count)) return false;
    if (s.count === target) return true;
    const ok = await tap(page, s.count > target ? /fewer|minus|less|decrease/i : /more|plus|increase|add/i);
    if (!ok) return false;
  }
  return false;
}

// The chip on Today's header. Its aria-label carries the exact numbers; the
// visible number springs (AnimatedNumber), so poll it until it lands.
const chipLoc = (page) => page.getByRole('button', { name: /trophy case/i }).first();

async function readChip(page, expectCurrent) {
  const chip = chipLoc(page);
  try {
    await chip.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    return null;
  }
  let label = '', visible = NaN;
  const deadline = Date.now() + 3000;
  do {
    label = (await chip.getAttribute('aria-label')) ?? '';
    const txt = await chip.innerText();
    visible = /\d/.test(txt) ? Number(txt.match(/\d+/)[0]) : 0;
    if (visible === expectCurrent) break;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  const current = /no streak/i.test(label) ? 0 : Number(label.match(/(\d+)\s*day streak/i)?.[1] ?? NaN);
  const best = label.match(/best\s*(\d+)/i) ? Number(label.match(/best\s*(\d+)/i)[1]) : null;
  return { label, current, best, visible };
}

// Chip vs store.js on the stored attempt vs the hand derivation — all three.
async function checkChip(rec, page, L, stored, hand) {
  const fromStore = atNow(() => streaks(stored));
  const chip = await readChip(page, hand.current);
  if (!chip) return rec.check(`${L} streak chip visible`, false, 'no chip on Today');
  rec.check(`${L} store.js on the STORED attempt = hand (${fmtS(hand)})`, sameStreak(fromStore, hand), `store.js ${fmtS(fromStore)}`);
  rec.check(`${L} chip shows ${hand.current} — hand = store.js = screen`,
    chip.current === hand.current && chip.visible === hand.current && fromStore.current === hand.current,
    `label "${chip.label}" · visible ${chip.visible} · store.js ${fromStore.current}`);
  // The chip names a best only when it's ≥ 3 and above the current run.
  const shown = hand.current > 0 && hand.best >= 3 && hand.current < hand.best;
  rec.check(`${L} chip ${shown ? `names best ${hand.best}` : 'names no best'}`,
    shown ? chip.best === hand.best && fromStore.best === hand.best : chip.best === null,
    `label "${chip.label}"`);
  return chip;
}

const storedRoot = async (page) => JSON.parse((await e2e.readStorage(page, 'pouch-down-v2')) ?? 'null');
const storedA2 = (root) => root?.attempts?.find((a) => a.id === 'a2') ?? null;

// (1) Append-only: every seeded event byte-identical and in place, and exactly
// the expected backfills appended after them — stamped with the moment they
// were entered (today), filed under the day they fill in.
function checkAppendOnly(rec, L, seededEvents, stored, expected) {
  const evs = stored?.events ?? [];
  const bad = seededEvents.filter((e, i) => JSON.stringify(evs[i]) !== JSON.stringify(e)).length;
  rec.check(`${L} all ${seededEvents.length} seeded events byte-identical, in order`, bad === 0 && evs.length >= seededEvents.length,
    bad ? `${bad} changed/missing` : '');
  const added = evs.slice(seededEvents.length);
  const bf = evs.filter((e) => e.type === 'backfill');
  rec.check(`${L} exactly ${expected.length} new event(s), all backfills`,
    added.length === expected.length && bf.length === expected.length && added.every((e) => e.type === 'backfill'),
    `appended ${added.length}: ${added.map((e) => `${e.type}/${e.day}/${e.count}/${e.streak}`).join(', ') || 'none'}`);
  expected.forEach((x, i) => {
    const e = added[i];
    const entered = e && Number.isFinite(Date.parse(e.ts)) ? dayKeyAt(Date.parse(e.ts), e.tzOffsetMin) : null;
    rec.check(`${L} backfill #${i + 1}: day ${dayOf(x.n)} · count ${x.count} · streak "${x.streak}"`,
      !!e && e.type === 'backfill' && e.day === dayOf(x.n) && e.count === x.count && e.streak === x.streak,
      e ? JSON.stringify({ day: e.day, count: e.count, streak: e.streak }) : 'missing');
    rec.check(`${L} backfill #${i + 1} stamped when entered (today, CDT), filed under d${x.n}`,
      !!e && entered === TODAY && e.tzOffsetMin === -300 && typeof e.id === 'string' && e.id.length > 0,
      e ? `ts ${e.ts} · tz ${e.tzOffsetMin} · entered ${entered}` : 'missing');
  });
  const ids = evs.map((e) => e.id);
  rec.check(`${L} event ids unique`, new Set(ids).size === ids.length);
}

// (5) + the rollback: Attempt 1 and v1 exactly as seeded.
async function checkUntouched(rec, page, L) {
  const root = await storedRoot(page);
  const a1 = root?.attempts?.find((a) => a.id === 'a1');
  rec.check(`${L} archived Attempt 1 byte-identical (no backfill ever lands there)`, JSON.stringify(a1) === A1_JSON,
    a1 ? `${a1.events.length} events, ${a1.events.filter((e) => e.type === 'backfill').length} backfills` : 'MISSING');
  rec.check(`${L} root still points at a2`, root?.activeAttemptId === 'a2' && root?.attempts?.length === 2,
    `active ${root?.activeAttemptId} · ${root?.attempts?.length} attempts`);
  await e2e.v1Unchanged(page, V1, rec);
}

// (3) The calendar, cell by cell: the listed days as logged (with count) or
// gray, and every past day's gray-ness matching statusForDay() on storage.
async function checkCalendar(rec, page, L, stored, { logged = [], gray = [], amber = [] }, shot) {
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.waitForTimeout(700);
  const cells = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label^="Day "]')].map((el) => ({
      aria: el.getAttribute('aria-label') ?? '', cls: String(el.className ?? ''), text: el.innerText ?? '',
    })));
  const byN = new Map(cells.map((c) => [Number(c.aria.match(/^Day (\d+)/)?.[1]), c]));
  await rec.snap(page, shot);
  const isGray = (c) => /no log/i.test(c.aria) || /\bcal-nolog\b/.test(c.cls);
  for (const x of logged) {
    const c = byN.get(x.n);
    const ok = !!c && !isGray(c) && (c.aria.includes(`${x.count} of ${CAP}`) || c.text.includes(`${x.count}/${CAP}`));
    rec.check(`${L} calendar d${x.n} logged ${x.count}/${CAP}, not gray`, ok, c ? `"${c.aria}" · ${c.cls}` : 'no cell');
  }
  for (const n of gray) {
    const c = byN.get(n);
    rec.check(`${L} calendar d${n} gray "no log"`, !!c && isGray(c), c ? `"${c.aria}" · ${c.cls}` : 'no cell');
  }
  for (const x of amber) {
    const c = byN.get(x.n);
    rec.check(`${L} calendar d${x.n} amber (over cap ${x.count}/${CAP})`, !!c && !isGray(c) && /yellow|amber|over/i.test(c.cls),
      c ? `"${c.aria}" · ${c.cls}` : 'no cell');
  }
  const wrong = [];
  for (let n = 1; n < TODAY_N; n++) {
    const c = byN.get(n);
    const want = atNow(() => statusForDay(stored, dayOf(n))) === 'nolog';
    if (!c || isGray(c) !== want) wrong.push(`d${n}`);
  }
  rec.check(`${L} every past day's gray-ness matches statusForDay() on storage`, wrong.length === 0, wrong.join(', '));
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.waitForTimeout(500);
}

async function openContext(browser, X) {
  const ctx = await e2e.phoneContext(browser, { tz: TZ, now: NOW });
  await e2e.seedStorage(ctx, { 'pouch-down-v1': V1, 'pouch-down-v2': FIX[X.id].rootJSON });
  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, X.id);
  return { ctx, page, errors };
}

async function boot(page, base, L, rec, shot) {
  await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' });
  const up = await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
  rec.check(`${L} Today renders with the streak chip`, up);
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} boot`);
  await rec.snap(page, shot);
}

// One prompt, answered: checks it asks the day we expect, sets the count,
// saves, and (within cap) takes the fork. Returns what it saw.
async function answer(rec, page, L, b, { expectFork }) {
  const d = dayOf(b.n);
  const w = await waitPrompt(page, (s) => s && s.day === d && !s.fork);
  rec.check(`${L} prompt asks ${short(b.n)}: "No log for ${weekdayOf(d)}."`,
    w.ok && new RegExp(`No log for ${weekdayOf(d)}\\.`).test(w.s.text),
    w.s ? `showing ${w.s.weekday} ${w.s.monthDay}` : 'no prompt');
  if (!w.ok) return false;
  rec.check(`${L} stepper starts at that day's cap (${CAP})`, w.s.count === CAP, `shows ${w.s.count}`);
  const set = await setCount(page, b.count);
  rec.check(`${L} stepper set to ${b.count}`, set, set ? '' : `stuck at ${(await promptState(page))?.count}`);
  if (!(await tap(page, /^save$/i))) return rec.check(`${L} Save tappable`, false);
  if (expectFork) {
    const f = await waitPrompt(page, (s) => s && s.fork);
    const copy = f.s?.text ?? '';
    rec.check(`${L} within cap → the fork: "Your call. The app only knows what you tell it."`,
      f.ok && copy.includes('Your call. The app only knows what you tell it.'), f.ok ? '' : 'no fork');
    const keepV = await promptBtn(page, /^Keep my streak$/).isVisible().catch(() => false);
    const breakV = await promptBtn(page, /^Break it here$/).isVisible().catch(() => false);
    rec.check(`${L} fork offers "Keep my streak" and "Break it here"`, keepV && breakV, `keep ${keepV} · break ${breakV}`);
    await rec.snap(page, `${L.replace(/\W+/g, '')}-d${b.n}-fork`);
    const ok = await tap(page, b.streak === 'keep' ? /^Keep my streak$/ : /^Break it here$/);
    rec.check(`${L} tapped ${b.streak === 'keep' ? 'Keep my streak' : 'Break it here'}`, ok);
  }
  // The day must leave the prompt once answered.
  const gone = await waitPrompt(page, (s) => !s || s.day !== d);
  rec.check(`${L} d${b.n} leaves the prompt once answered`, gone.ok, gone.s ? `still ${gone.s.monthDay}` : '');
  await clearOverlay(page, `${L} after d${b.n}`);
  return true;
}

async function skip(rec, page, L, n) {
  const d = dayOf(n);
  const w = await waitPrompt(page, (s) => s && s.day === d);
  rec.check(`${L} prompt asks ${short(n)}`, w.ok, w.s ? `showing ${w.s.weekday} ${w.s.monthDay}` : 'no prompt');
  if (!w.ok) return false;
  await rec.snap(page, `${L.replace(/\W+/g, '')}-d${n}-skip`);
  const ok = await tap(page, /^skip$/i);
  rec.check(`${L} Skip d${n}`, ok);
  return ok;
}

// No prompt, and it stays gone — a day asked late is still asked.
async function expectNoPrompt(rec, page, L, why) {
  const w = await waitPrompt(page, (s) => !s, 3000);
  let late = null;
  if (w.ok) {
    await page.waitForTimeout(1200);
    late = await promptState(page);
  }
  rec.check(`${L} no prompt ${why}`, w.ok && !late, (late ?? w.s) ? `asking ${(late ?? w.s).weekday} ${(late ?? w.s).monthDay}` : '');
}

// Moves the pinned clock to NEXT with the page still open — no reload, no tab
// switch — and checks the prompt picks up the new app day on its own (the 1 s
// tick re-renders Today). `want` is the hand-derived ask order; store.js on the
// stored attempt at NEXT must agree. Every day asked is skipped, so nothing is
// written.
async function nextDaySameMount(rec, page, id, want) {
  const L = `${id}: [next day, same mount]`;
  rec.section(`${id} · same mount, next day`);
  const before = await e2e.readStorage(page, 'pouch-down-v2');
  // A DOM node from Today's header: if Today remounted, it would be detached.
  await page.evaluate(() => {
    window.__sameMount = [...document.querySelectorAll('button')]
      .find((b) => /trophy case/i.test(b.getAttribute('aria-label') ?? '')) ?? null;
  });
  const stored = storedA2(await storedRoot(page));
  const fromStore = atNow(() => missedDays(stored), NEXT_MS).map((d) => numOf(d.day));
  rec.check(`${L} hand = store.js at Tue 10-06: asks ${want.map((n) => `d${n}`).join(' → ')}`,
    JSON.stringify(fromStore) === JSON.stringify(want), fromStore.map((n) => `d${n}`).join(' → ') || 'none');
  await page.clock.setSystemTime(NEXT_MS);
  const w = await waitPrompt(page, (s) => !!s, 5000);
  const text = await e2e.bodyText(page);
  await rec.snap(page, `${id}-next-day`);
  rec.check(`${L} Today moved to Day ${TODAY_N + 1} on its own`, new RegExp(`Day ${TODAY_N + 1} of 90`, 'i').test(text),
    (text.match(/Day \d+ of 90/i) ?? ['no day header'])[0]);
  rec.check(`${L} still the same mount (no reload, no remount)`,
    await page.evaluate(() => !!window.__sameMount && window.__sameMount.isConnected));
  rec.check(`${L} asks the newly missed ${short(want[0])} without a reload`, w.s?.n === want[0],
    w.s ? `asking ${w.s.weekday} ${w.s.monthDay}` : 'no prompt');
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const s = await waitPrompt(page, (x) => !!x && !seen.includes(x.n), 2500);
    if (!s.ok) break;
    seen.push(s.s.n);
    if (!(await tap(page, /^skip$/i))) break;
  }
  rec.check(`${L} asked exactly ${want.map((n) => `d${n}`).join(' → ')} this new day`,
    JSON.stringify(seen) === JSON.stringify(want), seen.map((n) => `d${n}`).join(' → ') || 'none');
  await expectNoPrompt(rec, page, L, 'after skipping them');
  rec.check(`${L} skips wrote nothing`, (await e2e.readStorage(page, 'pouch-down-v2')) === before);
}

/* -------------------------------------------------------------- context A */

async function walkA(browser, base, rec) {
  const X = A;
  const { attempt } = FIX.A;
  rec.section(`A · ${X.title}`);
  const { ctx, page, errors } = await openContext(browser, X);
  const L = 'A:';
  await boot(page, base, L, rec, 'A-open');
  const seen = new Set();
  const first = await waitPrompt(page, (s) => !!s);
  if (first.s) seen.add(first.s.n);
  rec.check(`${L} the NEWEST missed day is asked first (${short(12)})`, first.s?.n === 12,
    first.s ? `first asked ${first.s.weekday} ${first.s.monthDay}` : 'no prompt');
  await checkChip(rec, page, `${L} [seeded]`, storedA2(await storedRoot(page)), X.hand.seeded);

  // 1st: Keep on d12 bridges d11 and d13.
  await answer(rec, page, `${L} [Keep d12]`, X.backfills[0], { expectFork: true });
  await checkChip(rec, page, `${L} [after Keep d12]`, storedA2(await storedRoot(page)), X.hand.steps[0]);
  await rec.snap(page, 'A-after-keep');

  // 2nd: d10 has only a sleep check-in — still unlogged, still asked. At the
  // cap exactly (within cap), Break cuts what Keep would have made 5.
  const p2 = await waitPrompt(page, (s) => !!s);
  if (p2.s) seen.add(p2.s.n);
  await answer(rec, page, `${L} [Break d10]`, X.backfills[1], { expectFork: true });
  const afterBreak = storedA2(await storedRoot(page));
  const chip = await checkChip(rec, page, `${L} [after Break d10]`, afterBreak, X.hand.steps[1]);
  rec.check(`${L} Break cut it: chip is not the Keep-on-d10 counterfactual (${X.hand.counterfactual.current})`,
    !!chip && chip.current !== X.hand.counterfactual.current, chip ? `chip ${chip.current}` : '');
  await rec.snap(page, 'A-after-break');

  // 3rd: d8 → Skip. Then nothing else: d6 is gray but 8 days old, and with the
  // window now holding no other missed day there is room it could take.
  const p3 = await waitPrompt(page, (s) => !!s);
  if (p3.s) seen.add(p3.s.n);
  await skip(rec, page, L, 8);
  await expectNoPrompt(rec, page, L, 'after Skip (d6, 8 days old, is never asked)');
  rec.check(`${L} asked exactly ${X.prompts.map((n) => `d${n}`).join(' → ')} this open`,
    JSON.stringify([...seen]) === JSON.stringify(X.prompts), [...seen].map((n) => `d${n}`).join(' → '));
  await rec.snap(page, 'A-after-skip');

  // (1) storage, (3) calendar, (5) untouched.
  const stored = storedA2(await storedRoot(page));
  checkAppendOnly(rec, L, attempt.events, stored, X.backfills);
  await checkCalendar(rec, page, L, stored, { logged: X.backfills, gray: X.gray }, 'A-calendar');
  await checkUntouched(rec, page, L);

  // (4) reload: the answered days never ask again; the skipped one does; and
  // the backfills are still there (a re-seed would have wiped them).
  rec.section('A · reload');
  const before = JSON.stringify(stored.events);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} reload`);
  const again = storedA2(await storedRoot(page));
  rec.check(`${L} after reload the backfills are still stored (seeding did not re-run)`,
    JSON.stringify(again?.events) === before && again.events.filter((e) => e.type === 'backfill').length === 2,
    `${again?.events?.filter((e) => e.type === 'backfill').length} backfills`);
  const r = await waitPrompt(page, (s) => !!s);
  await rec.snap(page, 'A-reload');
  rec.check(`${L} after reload the skipped d8 asks again — not d12 or d10`, r.s?.n === 8,
    r.s ? `asking ${r.s.weekday} ${r.s.monthDay}` : 'no prompt');
  await checkChip(rec, page, `${L} [after reload]`, again, X.hand.steps[1]);
  await skip(rec, page, `${L} [reload]`, 8);
  await expectNoPrompt(rec, page, L, 'after skipping d8 again');

  // A day goes by with the app still open: yesterday's skip asks again, and so
  // does the day that just went by unlogged.
  await nextDaySameMount(rec, page, 'A', [14, 8]);

  // Read-only isolation: Attempt 1 is full of gray days, and must ask nothing.
  rec.section('A · read-only Attempt 1');
  const snapshot = JSON.stringify(storedA2(await storedRoot(page)));
  let viewed = false;
  let why = '';
  try {
    await page.locator('button[aria-label="Settings"]').first().click();
    await page.waitForTimeout(600);
    await rec.snap(page, 'A-settings');
    const row = page.getByRole('button', { name: /^Attempt 1\b/i }).first();
    await row.scrollIntoViewIfNeeded({ timeout: 4000 });
    await row.click({ timeout: 4000 });
    viewed = true;
  } catch (e) {
    why = String(e.message ?? e).split('\n')[0];
    const names = await page.locator('button').evaluateAll((els) =>
      els.map((b) => (b.getAttribute('aria-label') || b.innerText).replace(/\s+/g, ' ').slice(0, 40)));
    why += ` · buttons: ${names.join(' | ')}`;
  }
  rec.check(`${L} opened Attempt 1 from Settings`, viewed, why.slice(0, 600));
  if (viewed) {
    await page.waitForTimeout(700);
    await clearOverlay(page, `${L} viewer`);
    const text = await e2e.bodyText(page);
    const exitBtn = page.getByRole('button', { name: /exit read-only/i }).first();
    rec.check(`${L} viewer is read-only (Exit banner shown)`, await exitBtn.isVisible().catch(() => false));
    rec.check(`${L} viewer asks for no backfill (Attempt 1 has gray days galore)`, !/No log for/i.test(text));
    await rec.snap(page, 'A-viewer');
    await exitBtn.click().catch(() => {});
    await page.waitForTimeout(500);
    rec.check(`${L} Exit returns to Attempt 2's Today`, await chipLoc(page).isVisible().catch(() => false));
  }
  rec.check(`${L} viewing Attempt 1 changed nothing in Attempt 2`, JSON.stringify(storedA2(await storedRoot(page))) === snapshot);
  await checkUntouched(rec, page, `${L} [end]`);
  if (!args.keep) await ctx.close();
  return errors;
}

/* -------------------------------------------------------------- context B */

async function walkB(browser, base, rec) {
  const X = B;
  const { attempt } = FIX.B;
  rec.section(`B · ${X.title}`);
  const { ctx, page, errors } = await openContext(browser, X);
  const L = 'B:';
  await boot(page, base, L, rec, 'B-open');
  await checkChip(rec, page, `${L} [seeded]`, storedA2(await storedRoot(page)), X.hand.seeded);

  const b = X.backfills[0];
  const w = await waitPrompt(page, (s) => s && s.n === b.n);
  rec.check(`${L} prompt asks ${short(b.n)}`, w.ok, w.s ? `showing ${w.s.weekday} ${w.s.monthDay}` : 'no prompt');
  const set = await setCount(page, b.count);
  rec.check(`${L} stepper set to ${b.count} (cap ${CAP} + 1)`, set);
  await rec.snap(page, 'B-over-cap');
  // Watch every frame from Save on: the fork must never appear, not even briefly.
  await page.evaluate(() => {
    window.__forkSeen = false;
    const look = () => { if (/Your call|Keep my streak|Break it here/.test(document.body.innerText)) window.__forkSeen = true; };
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  const saved = await tap(page, /^save$/i);
  rec.check(`${L} Save tappable`, saved);
  await page.waitForTimeout(1200);
  rec.check(`${L} over cap: the Keep/Break question never appeared`, (await page.evaluate(() => window.__forkSeen)) === false);
  await expectNoPrompt(rec, page, L, 'after the over-cap save (the only missed day is answered)');
  await clearOverlay(page, `${L} after save`);

  const stored = storedA2(await storedRoot(page));
  checkAppendOnly(rec, L, attempt.events, stored, X.backfills);
  const chip = await checkChip(rec, page, `${L} [after over-cap]`, stored, X.hand.steps[0]);
  rec.check(`${L} the streak broke: chip is not ${X.hand.counterfactual.current} (what a within-cap Keep would give)`,
    !!chip && chip.current !== X.hand.counterfactual.current, chip ? `chip ${chip.current}` : '');
  await rec.snap(page, 'B-after');
  await checkCalendar(rec, page, L, stored, { amber: X.backfills }, 'B-calendar');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await clearOverlay(page, `${L} reload`);
  await expectNoPrompt(rec, page, `${L} [reload]`, 'after reload');
  rec.check(`${L} after reload the backfill is still stored (no re-seed)`,
    JSON.stringify(storedA2(await storedRoot(page))?.events) === JSON.stringify(stored.events));
  await rec.snap(page, 'B-reload');

  // The exact case a once-per-mount list got wrong: this open started with
  // nothing missed. A day later, same page, Monday must be asked.
  await nextDaySameMount(rec, page, 'B', [14]);
  await checkUntouched(rec, page, L);
  if (!args.keep) await ctx.close();
  return errors;
}

/* -------------------------------------------------------------- context C */

async function walkC(browser, base, rec) {
  const X = C;
  const { attempt } = FIX.C;
  rec.section(`C · ${X.title}`);
  const { ctx, page, errors } = await openContext(browser, X);
  const L = 'C:';
  await boot(page, base, L, rec, 'C-open');
  await checkChip(rec, page, `${L} [seeded]`, storedA2(await storedRoot(page)), X.hand.seeded);

  // Open 1: skip everything it asks. It must ask exactly three, newest first.
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const w = await waitPrompt(page, (s) => !!s && !seen.includes(s.n), 2500);
    if (!w.ok) break;
    seen.push(w.s.n);
    await rec.snap(page, `C-open1-ask-${i + 1}-d${w.s.n}`);
    if (!(await tap(page, /^skip$/i))) break;
  }
  rec.check(`${L} open 1 asked exactly ${X.prompts.map((n) => `d${n}`).join(' → ')} (at most 3, newest first)`,
    JSON.stringify(seen) === JSON.stringify(X.prompts), seen.map((n) => `d${n}`).join(' → ') || 'none');
  await expectNoPrompt(rec, page, L, 'after three skips (d9, d8 still missed but never asked)');
  await checkCalendar(rec, page, L, storedA2(await storedRoot(page)), { gray: [8, 9, 11, 12, 13] }, 'C-calendar-skipped');
  rec.check(`${L} skipping wrote nothing`, JSON.stringify(storedA2(await storedRoot(page))?.events) === JSON.stringify(attempt.events));

  // Open 2: a reload asks the same three again, newest first — then answer them.
  rec.section('C · open 2 (reload)');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} reload`);
  const r = await waitPrompt(page, (s) => !!s);
  rec.check(`${L} after reload the skipped days ask again, newest (d13) first`, r.s?.n === 13,
    r.s ? `asking ${r.s.weekday} ${r.s.monthDay}` : 'no prompt');
  for (let i = 0; i < X.backfills.length; i++) {
    const b = X.backfills[i];
    await answer(rec, page, `${L} [Keep d${b.n}]`, b, { expectFork: true });
    await checkChip(rec, page, `${L} [after Keep d${b.n}]`, storedA2(await storedRoot(page)), X.hand.steps[i]);
  }
  // With d13/d12/d11 answered, missedDays() now holds d9 and d8 — but the spec
  // says "on open, up to the 3 most recent", so this open is done: answering
  // three must not pull a 4th in behind them.
  await expectNoPrompt(rec, page, `${L} [open 2]`, 'after answering three — no 4th day asked in the same open');
  await rec.snap(page, 'C-open2-after-three');
  const stored = storedA2(await storedRoot(page));
  checkAppendOnly(rec, L, attempt.events, stored, X.backfills);
  await checkChip(rec, page, `${L} [end of open 2]`, stored, X.hand.steps[X.hand.steps.length - 1]);
  const stillMissed = atNow(() => missedDays(stored)).map((d) => numOf(d.day));
  rec.check(`${L} d9 and d8 are still missed (so the empty prompt is the per-open cap, not "nothing left")`,
    JSON.stringify(stillMissed) === '[9,8]', stillMissed.map((n) => `d${n}`).join(', ') || 'none');

  // Open 3: the next open recomputes — the 4th and 5th newest are asked now.
  rec.section('C · open 3 (reload)');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} reload 2`);
  const r3 = await waitPrompt(page, (s) => !!s);
  rec.check(`${L} the next open (reload) asks the 4th day, d9, first`, r3.s?.n === 9,
    r3.s ? `asking ${r3.s.weekday} ${r3.s.monthDay}` : 'no prompt');
  await rec.snap(page, 'C-open3-d9');
  await skip(rec, page, `${L} [open 3]`, 9);
  await skip(rec, page, `${L} [open 3]`, 8);
  await expectNoPrompt(rec, page, `${L} [open 3]`, 'after skipping d9 and d8');
  rec.check(`${L} open 3 wrote nothing (skips only)`,
    JSON.stringify(storedA2(await storedRoot(page))?.events) === JSON.stringify(stored.events));

  await checkCalendar(rec, page, L, stored, { logged: X.backfills, gray: X.gray }, 'C-calendar-end');
  await checkUntouched(rec, page, L);
  if (!args.keep) await ctx.close();
  return errors;
}

/* ------------------------------------------------------------------ main */

e2e.run(async () => {
  const rec = e2e.createRecorder(args.out);
  if (args.dry) {
    printFixtures();
    domainChecks(rec);
    return e2e.finish(rec);
  }
  domainChecks(rec);
  const dist = args.dist ?? (await e2e.buildApp(`${args.out}/build`));
  const { base } = await e2e.startPreview({ dist, port: args.port });
  const browser = await chromium.launch();
  const errors = [];
  errors.push(await walkA(browser, base, rec));
  errors.push(await walkB(browser, base, rec));
  errors.push(await walkC(browser, base, rec));
  if (notes.length) log(`\nnotes (not failures):\n - ${notes.join('\n - ')}`);
  if (!args.keep) await browser.close();
  return e2e.finish(rec, errors);
});
