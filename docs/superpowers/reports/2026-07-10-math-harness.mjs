// Math verification harness for the stats expansion.
// Fakes "now" = 2026-07-20 12:00 local (plan day 13, stage 2) so multi-day
// aggregates — including a legitimately unlocked correlation card — can be
// asserted against hand-computed numbers. All events below use the
// derive-fallback path (no ctx) except one ctx-stamped control.
//
// Hand-computed expectations are inline; every assert traces to the fixture.

const RealDate = Date;
const FAKE_NOW = new RealDate('2026-07-20T12:00:00').getTime();
globalThis.Date = class extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(FAKE_NOW);
    else super(...a);
  }
  static now() { return FAKE_NOW; }
};

const store = await import('/Users/jxm/Projects/pouch-down/src/store.js');
const {
  DEFAULT_SETTINGS, classifyPouch, disciplineStats, firstPouchTimes, gapStats,
  hourHistogram, checkinForDay, correlationStats, timeSinceLastPouch,
  markdownSummary, dayKeyFor, todayKey, fmtDuration,
} = store;

let failures = 0;
function eq(label, got, want) {
  const ok = typeof want === 'number' && !Number.isInteger(want)
    ? Math.abs(got - want) < 1e-9
    : got === want;
  if (!ok) { failures++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label} = ${JSON.stringify(got)}`);
}
function match(label, got, re) {
  if (!re.test(got)) { failures++; console.log(`FAIL ${label}: ${JSON.stringify(got)} !~ ${re}`); }
  else console.log(`ok   ${label} ~ ${re}`);
}

let idc = 0;
const iso = (s) => new RealDate(s).toISOString();
const pouch = (local, trigger = null, extra = {}) =>
  ({ id: `t-${idc++}`, ts: iso(local), type: 'pouch', trigger, ...extra });
const resisted = (local, trigger) => ({ id: `t-${idc++}`, ts: iso(local), type: 'resisted', trigger });
const checkin = (local, fields) => ({ id: `t-${idc++}`, ts: iso(local), type: 'checkin', trigger: null, source: 'manual', ...fields });

// Stage 1 (days 1-10) slots: 08:15 10:30 12:45 15:00 16:30 18:45 20:30 21:45 (cap 8)
// Stage 2 (days 11-20) slots: 08:15 10:30 12:45 15:30 18:45 21:00 (cap 6)
const events = [
  // Pre-plan baseline (Jul 7, day 0): excluded from every discipline stat
  pouch('2026-07-07T20:00:00'),
  checkin('2026-07-07T09:00:00', { sleepQuality: 5 }), // pre-plan: excluded from correlation

  // Days 7-10 (Jul 14-17, stage 1): every tap exactly on its slot → on-time, delta 0
  ...['2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17'].flatMap((d, i) =>
    ['08:15', '10:30', '12:45', '15:00', '16:30', '18:45'].slice(0, [6, 4, 5, 3][i]).map((t) => pouch(`${d}T${t}:00`))),

  // Day 11 (Jul 18, stage 2): 6/6 on-time, held +5 +1 +15 +5 +5 +5
  pouch('2026-07-18T08:20:00'), pouch('2026-07-18T10:31:00'), pouch('2026-07-18T13:00:00'),
  pouch('2026-07-18T15:35:00'), pouch('2026-07-18T18:50:00'), pouch('2026-07-18T21:05:00'),

  // Day 12 (Jul 19, stage 2): 8 used vs cap 6 → 1 early, 5 on-time, 2 over-cap
  pouch('2026-07-19T07:50:00'),                    // n1 vs 08:15 → 25m early, pre-first-slot
  pouch('2026-07-19T10:40:00'),                    // n2 vs 10:30 → +10
  pouch('2026-07-19T12:45:00'),                    // n3 → 0
  pouch('2026-07-19T16:00:00', 'after-meal'),      // n4 vs 15:30 → +30 (tagged)
  pouch('2026-07-19T19:00:00'),                    // n5 vs 18:45 → +15
  pouch('2026-07-19T21:30:00'),                    // n6 vs 21:00 → +30
  pouch('2026-07-19T23:30:00'),                    // n7 > 6 → over-cap
  pouch('2026-07-20T01:30:00'),                    // 1 AM cross-cutoff → STILL day 12, n8 → over-cap
  resisted('2026-07-19T14:00:00', 'stress'),

  // Day 13 = fake "today" (Jul 20): 2 on-time (+45 via a stamped ctx control, +5 derived)
  pouch('2026-07-20T09:00:00', null, { ctx: { nth: 1, cap: 6, slotId: 'after-breakfast', slotLabel: 'After breakfast', slotAt: iso('2026-07-20T08:15:00'), firstSlotAt: iso('2026-07-20T08:15:00') } }),
  pouch('2026-07-20T10:35:00'),                    // n2 vs 10:30 → +5 (derive path)
  resisted('2026-07-20T11:00:00', 'coffee'),

  // Check-ins, 6 plan days (all before fake-today → all enter the averages)
  checkin('2026-07-14T08:30:00', { sleepQuality: 2, workout: false }), // poor · 6 pouches
  checkin('2026-07-15T08:30:00', { sleepQuality: 3, workout: true }),  // ok · 4
  checkin('2026-07-16T08:30:00', { sleepHours: 8.0, workout: true }),  // good (hours band) · 5
  checkin('2026-07-17T08:30:00', { sleepQuality: 5, workout: false }), // good · 3
  checkin('2026-07-18T08:30:00', { sleepHours: 6.0, workout: true }),  // poor (hours band) · 6
  checkin('2026-07-19T08:30:00', { sleepQuality: 1, workout: true }),  // superseded — latest wins:
  checkin('2026-07-19T09:15:00', { sleepQuality: 4, workout: false }), // good · 8
];

const state = { version: 1, settings: { ...DEFAULT_SETTINGS }, events, celebratedStages: [], checkinDismissedFor: null };

eq('todayKey (fake clock)', todayKey(), '2026-07-20');

// classifyPouch spot checks
const oneAm = events.find((e) => e.ts === iso('2026-07-20T01:30:00'));
eq('1am tap dayKey', dayKeyFor(oneAm.ts), '2026-07-19');
eq('1am tap bucket', classifyPouch(state, oneAm).bucket, 'over-cap');
const earlyTap = events.find((e) => e.ts === iso('2026-07-19T07:50:00'));
const vEarly = classifyPouch(state, earlyTap);
eq('early tap bucket', vEarly.bucket, 'early');
eq('early tap delta', vEarly.deltaMin, -25);
eq('early tap preFirstSlot', vEarly.preFirstSlot, true);
const ctxTap = events.find((e) => e.ctx);
eq('ctx-stamped delta', classifyPouch(state, ctxTap).deltaMin, 45);
eq('baseline bucket', classifyPouch(state, events[0]).bucket, 'baseline');

// disciplineStats — hand totals: onTime 31 (18 slot-exact + 6 + 5 + 2), early 1, over 2
const disc = disciplineStats(state);
eq('disc.onTime', disc.onTime, 31);
eq('disc.early', disc.early, 1);
eq('disc.overCap', disc.overCap, 2);
eq('disc.preFirstSlot', disc.preFirstSlot, 1);
eq('disc.avgMinEarly', disc.avgMinEarly, 25);
eq('disc.avgMinHeld', disc.avgMinHeld, 171 / 31); // (36+85+50)/31
eq('disc.today.onTime', disc.today.onTime, 2);
eq('disc.today.early', disc.today.early, 0);
eq('disc.today.overCap', disc.today.overCap, 0);

// firstPouchTimes — 7 plan days; 255 = 8:15am, 230 = 7:50am, 300 = 9:00am
const fp = firstPouchTimes(state);
eq('firstPouch count', fp.length, 7);
eq('firstPouch day7', JSON.stringify([fp[0].dayNum, fp[0].minutesSince4am]), JSON.stringify([7, 255]));
eq('firstPouch day11', fp.find((r) => r.dayNum === 11).minutesSince4am, 260);
eq('firstPouch day12 (early)', fp.find((r) => r.dayNum === 12).minutesSince4am, 230);
eq('firstPouch day13', fp.find((r) => r.dayNum === 13).minutesSince4am, 300);

// gapStats — today: one 95m pair; 7d: 3720 min over 27 same-day pairs;
// longest ever: Jul 7 20:00 → Jul 14 08:15 = 156h15m; current: 12:00 − 10:35 = 85m
const gaps = gapStats(state);
eq('gaps.avgGapTodayMin', gaps.avgGapTodayMin, 95);
eq('gaps.avgGap7dMin', gaps.avgGap7dMin, 3720 / 27);
eq('gaps.longestGapMs', gaps.longestGapMs, 562500000);
eq('gaps.longestGapEndedAt', gaps.longestGapEndedAt, iso('2026-07-14T08:15:00'));
eq('gaps.currentGapMs', gaps.currentGapMs, 85 * 60000);
eq('fmtDuration(longest)', fmtDuration(562500000), '156h 15m');

// hourHistogram — baseline (Jul 7, 20:00) excluded → hour 20 empty
const hist = hourHistogram(state);
eq('hist hour 8 onTime', hist[8].onTime, 5);
eq('hist hour 10 onTime', hist[10].onTime, 7);
eq('hist hour 1 off (1am over-cap)', hist[1].off, 1);
eq('hist hour 7 off (early)', hist[7].off, 1);
eq('hist hour 23 off', hist[23].off, 1);
eq('hist hour 20 empty (baseline excluded)', hist[20].onTime + hist[20].off, 0);
eq('hist totals', JSON.stringify(hist.reduce((a, b) => [a[0] + b.onTime, a[1] + b.off], [0, 0])), JSON.stringify([31, 3]));

// checkinForDay — latest of the two Jul 19 check-ins wins
const c19 = checkinForDay(state, '2026-07-19');
eq('checkin latest-wins quality', c19.sleepQuality, 4);
eq('checkin latest-wins workout', c19.workout, false);

// correlationStats — poor {2d, avg 6}, ok {1d, 4}, good {3d, 16/3}; workout yes {3d, 5}, no {3d, 17/3}
const corr = correlationStats(state);
eq('corr.totalCheckins', corr.totalCheckins, 6);
eq('corr.sleep.poor', JSON.stringify(corr.sleep.poor), JSON.stringify({ days: 2, avgPouches: 6 }));
eq('corr.sleep.ok', JSON.stringify(corr.sleep.ok), JSON.stringify({ days: 1, avgPouches: 4 }));
eq('corr.sleep.good.days', corr.sleep.good.days, 3);
eq('corr.sleep.good.avg', corr.sleep.good.avgPouches, 16 / 3);
eq('corr.workout.yes.avg', corr.workout.yes.avgPouches, 5);
eq('corr.workout.no.avg', corr.workout.no.avgPouches, 17 / 3);

eq('timeSinceLastPouch', timeSinceLastPouch(state), 85 * 60000);

// markdownSummary — day-12 row carries the new columns; footers present
const md = markdownSummary(state, 7);
match('md day12 row', md, /\| 12 \| 2026-07-19 \| 6 \| 8 \| 1 \| 2 \| 7:50.AM \| 1 \| 72mg \| over \|/);
match('md discipline footer', md, /Discipline: 31 on-time · 1 early \(1 before first slot\) · 2 over-cap · avg held \+6m · avg early 25m/);
match('md longest gap footer', md, /Longest gap: 156h 15m \(incl\. sleep, ended 2026-07-14 8:15.AM\)/);
match('md checkin footer', md, /Check-ins \(7d\): 6 · avg sleep quality 3\.5\/5 · avg 7\.0h sleep · workouts 3\/6/);

// Regression (review finding B): stage-6 day, cap 2, first slot ~12:45.
// Three morning taps → 2 early (both pre-first-slot) + 1 over-cap (pre-first-
// slot flag true on classify, but NOT counted in disciplineStats — the stat
// renders as a subset of "early" and must never exceed it).
const s6state = {
  version: 1, settings: { ...DEFAULT_SETTINGS }, celebratedStages: [], checkinDismissedFor: null,
  events: [
    pouch('2026-08-28T08:00:00'), pouch('2026-08-28T08:30:00'), pouch('2026-08-28T09:00:00'),
  ],
};
const s6 = disciplineStats(s6state);
eq('s6 early', s6.early, 2);
eq('s6 overCap', s6.overCap, 1);
eq('s6 preFirstSlot (subset of early)', s6.preFirstSlot, 2);
const s6third = classifyPouch(s6state, s6state.events[2]);
eq('s6 over-cap tap keeps independent flag', s6third.preFirstSlot, true);

console.log(failures ? `\n${failures} FAILURES` : '\nALL MATH CHECKS PASSED');
process.exit(failures ? 1 : 0);
