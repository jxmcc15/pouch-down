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

describe('post-quit days are scored honestly (fix 1)', () => {
  it('a silent post-quit day is nolog; resisted-only is green; a pouch is yellow (cap 0)', () => {
    vi.setSystemTime(new Date('2026-12-25T17:00:00.000Z'));
    const s = attempt([ev('resisted', '2026-12-23'), ev('pouch', '2026-12-24')]);
    expect(S.statusForDay(s, '2026-12-22')).toBe('nolog'); // silent, past quit day (2026-12-19)
    expect(S.statusForDay(s, '2026-12-23')).toBe('green');
    expect(S.statusForDay(s, '2026-12-24')).toBe('yellow');
  });
});

describe('day math is pure calendar arithmetic, not device-zone Date math (fix 2)', () => {
  it('is correct across the US DST end transition', () => {
    const s = attempt([]);
    expect(S.dayNumberFor(s, '2026-11-02')).toBe(43);
    expect(S.dateForDayNumber(s, 43)).toBe('2026-11-02');
  });
  it('round-trips for a wide range of day numbers', () => {
    const s = attempt([]);
    for (let n = -5; n <= 400; n++) {
      expect(S.dayNumberFor(s, S.dateForDayNumber(s, n))).toBe(n);
    }
  });
});

describe('invalid backfill counts are ignored, not trusted (fix 3)', () => {
  it.each([-5, '2', NaN, 2.5])('count %p leaves the day unlogged with 0 pouches', (count) => {
    const s = attempt([ev('backfill', '2026-09-22', { count, streak: 'keep' })]);
    expect(S.isLogged(s, '2026-09-22')).toBe(false);
    expect(S.pouchesForDay(s, '2026-09-22')).toBe(0);
    expect(S.statusForDay(s, '2026-09-22')).toBe('nolog');
  });
  it('count 0 logs the day with 0 used, green', () => {
    const s = attempt([ev('backfill', '2026-09-22', { count: 0, streak: 'keep' })]);
    expect(S.isLogged(s, '2026-09-22')).toBe(true);
    expect(S.pouchesForDay(s, '2026-09-22')).toBe(0);
    expect(S.statusForDay(s, '2026-09-22')).toBe('green');
  });
  it('an invalid-count backfill contributes nothing to discipline stats', () => {
    const d = S.disciplineStats(attempt([ev('backfill', '2026-09-22', { count: -1, streak: 'keep' })]));
    expect(d.backfilled).toBe(0);
  });
  it('an invalid-count backfill\'s "break" flag does not break an otherwise-valid day', () => {
    const s = attempt([...pouches('2026-09-22', 8), ev('backfill', '2026-09-22', { count: -1, streak: 'break' })]);
    expect(S.dayCountsForStreak(s, '2026-09-22')).toBe(true);
  });
});

// Run `fn` with the device in another time zone, then put the zone back.
function inZone(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; }
}

describe('a verdict is read in the zone the pouch was logged in', () => {
  // Logged at 8:20 AM Eastern with no ctx (like the earliest v1 pouches), so
  // its slot times get rebuilt at read time. After-breakfast is 08:15.
  const e = { id: 'nx1', ts: '2026-09-22T12:20:00.000Z', tzOffsetMin: -240, day: '2026-09-22', type: 'pouch', trigger: null };
  it('is on time +5m whether you read it from New York or Chicago', () => {
    const s = attempt([e]);
    const ny = inZone('America/New_York', () => S.classifyPouch(s, e));
    const chi = inZone('America/Chicago', () => S.classifyPouch(s, e));
    expect(ny).toEqual({ bucket: 'on-time', deltaMin: 5, preFirstSlot: false });
    expect(chi).toEqual(ny);
  });
  it('so discipline stats do not change after a move either', () => {
    const s = attempt([e]);
    const chi = inZone('America/Chicago', () => S.disciplineStats(s));
    expect(chi).toMatchObject({ onTime: 1, early: 0, preFirstSlot: 0, avgMinHeld: 5 });
    expect(inZone('America/New_York', () => S.disciplineStats(s))).toEqual(chi);
  });
});

describe('late meal times never crash logging', () => {
  const lateAttempt = (perDay, dinner, events) => {
    const late = { ...settings, mealTimes: { ...settings.mealTimes, dinner } };
    const p = generatePlan({ pouchesPerDay: perDay, mg: 6, strengths: [], lengthDays: 30, startDate: '2026-09-21', ...late });
    return attempt(events, { settings: late, plan: p });
  };
  it('a 23:45 dinner unlocks at midnight, on the same 4am→4am day', () => inZone('America/Chicago', () => {
    vi.setSystemTime(new Date('2026-09-22T05:10:00.000Z')); // 12:10 AM Tue — still Monday, day 1
    const s = lateAttempt(4, '23:45', pouches('2026-09-21', 2));
    // after dinner at 24:00, then the evening floater at 24:30 (12:30 AM Tue)
    expect(S.pacingForNow(s).slots.map((x) => x.at.toISOString()).slice(2)).toEqual(['2026-09-22T05:00:00.000Z', '2026-09-22T05:30:00.000Z']);
    const ctx = S.pouchCtxForNow(s);
    expect(ctx).toMatchObject({ nth: 3, cap: 4, slotId: 'after-dinner', slotAt: '2026-09-22T05:00:00.000Z' });
    const onTime = { ...S.makeEvent('pouch'), ctx };
    expect(onTime.day).toBe('2026-09-21');
    expect(S.classifyPouch(s, onTime)).toEqual({ bucket: 'on-time', deltaMin: 10, preFirstSlot: false });
    const early = { ...onTime, id: 'early', ts: '2026-09-22T04:50:00.000Z' }; // 11:50 PM
    expect(S.classifyPouch(s, early)).toMatchObject({ bucket: 'early', deltaMin: -10 });
  }));
  it('a floater past midnight (23:30 dinner, 4/day → 24:15) resolves too', () => inZone('America/Chicago', () => {
    vi.setSystemTime(new Date('2026-09-22T04:00:00.000Z')); // 11 PM Monday
    const s = lateAttempt(4, '23:30', pouches('2026-09-21', 3));
    const pacing = S.pacingForNow(s);
    expect(pacing.slots.every((x) => Number.isFinite(x.at.getTime()))).toBe(true);
    expect(pacing.nextSlot.at.toISOString()).toBe('2026-09-22T05:15:00.000Z'); // 12:15 AM Tue
    expect(pacing.unlocked).toBe(false);
    expect(() => S.pouchCtxForNow(s)).not.toThrow();
    // an old pouch with no ctx rebuilds the same slot in its own zone
    const bare = { id: 'bare', ts: '2026-09-22T05:20:00.000Z', tzOffsetMin: -300, day: '2026-09-21', type: 'pouch', trigger: null };
    expect(S.classifyPouch({ ...s, events: [...s.events, bare] }, bare)).toMatchObject({ bucket: 'on-time', deltaMin: 5 });
  }));
});

describe('asOfDay for an archived attempt', () => {
  // Archived at 4:30 AM Eastern on the 23rd: the 23rd where you were, but still
  // the 22nd if the phone is now in Chicago and re-reads archivedAt.
  const archived = attempt(pouches('2026-09-21', 8), { status: 'archived', archivedAt: '2026-09-23T08:30:00.000Z', archivedDay: '2026-09-23' });
  it('uses the archivedDay stamped at archive time', () => {
    expect(inZone('America/Chicago', () => S.asOfDay(archived))).toBe('2026-09-23');
  });
  it('falls back to archivedAt for attempts archived before archivedDay existed', () => {
    const { archivedDay: _, ...older } = archived;
    expect(inZone('America/New_York', () => S.asOfDay(older))).toBe('2026-09-23');
  });
  it('is still capped at the quit date', () => {
    expect(S.asOfDay({ ...archived, archivedDay: '2027-01-15' })).toBe(plan.quitDate);
  });
});

describe('the "since last pouch" clock only runs on a live attempt', () => {
  it('is null for an archived attempt, live otherwise', () => {
    const events = pouches('2026-09-22', 2);
    const past = attempt(events, { status: 'archived', archivedAt: '2026-09-23T18:00:00.000Z', archivedDay: '2026-09-23' });
    expect(S.gapStats(past).currentGapMs).toBeNull();
    expect(S.gapStats(attempt(events)).currentGapMs).toBe(3 * 86400000);
  });
});

describe('an over-cap today breaks the streak the moment it happens', () => {
  it('current is 0 immediately, best keeps the run', () => {
    const s = attempt([...['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'].flatMap((d) => pouches(d, 8)), ...pouches('2026-09-25', 9)]);
    expect(S.statusForDay(s, '2026-09-25')).toBe('today-over');
    expect(S.streaks(s)).toEqual({ current: 0, best: 4 });
  });
});

// Day corrections: the real total for a logged past day, entered later. Day 2
// (2026-09-22) has a cap of 8 in this plan.
describe('corrections', () => {
  const D = '2026-09-22';
  const corr = (count, ts = `${D}T23:00:00.000Z`, day = D) => ({ ...ev('correction', day), ts, count });

  it('no correction: pouchesForDay is the timed count', () => {
    const s = attempt(pouches(D, 4));
    expect(S.correctionForDay(s, D)).toBeNull();
    expect(S.timedPouchesForDay(s, D)).toBe(4);
    expect(S.pouchesForDay(s, D)).toBe(4);
  });
  it('one correction raises the total and keeps the timed count', () => {
    const s = attempt([...pouches(D, 4), corr(8)]);
    expect(S.timedPouchesForDay(s, D)).toBe(4);
    expect(S.pouchesForDay(s, D)).toBe(8);
    expect(S.statusForDay(s, D)).toBe('green');
  });
  it('a correction over the cap turns the day yellow and breaks the streak', () => {
    const s = attempt([...pouches(D, 4), corr(9)]);
    expect(S.statusForDay(s, D)).toBe('yellow');
    expect(S.dayCountsForStreak(s, D)).toBe(false);
  });
  it('the latest correction by ts wins, wherever it sits in the array', () => {
    const s = attempt([...pouches(D, 4), corr(10, '2026-09-24T01:00:00.000Z'), corr(7, '2026-09-23T01:00:00.000Z')]);
    expect(S.correctionForDay(s, D).count).toBe(10);
    expect(S.pouchesForDay(s, D)).toBe(10);
  });
  it('a correction below the timed count never lowers it', () => {
    const s = attempt([...pouches(D, 6), corr(2)]);
    expect(S.pouchesForDay(s, D)).toBe(6);
  });
  it('a correction with a bad count is ignored', () => {
    for (const count of [-1, '12', 2.5, null]) {
      const s = attempt([...pouches(D, 4), corr(count)]);
      expect(S.correctionForDay(s, D)).toBeNull();
      expect(S.pouchesForDay(s, D)).toBe(4);
    }
  });
  it('a correction on an unlogged day counts nothing and logs nothing', () => {
    const s = attempt([corr(8)]);
    expect(S.isLogged(s, D)).toBe(false);
    expect(S.pouchesForDay(s, D)).toBe(0);
    expect(S.statusForDay(s, D)).toBe('nolog');
  });
  it('corrected pouches are counted, not scored', () => {
    const s = attempt([...pouches(D, 4), corr(12)]);
    const d = S.disciplineStats(s);
    expect(d.onTime + d.early + d.overCap).toBe(4);
  });
});

describe('reasons and triggersFor', () => {
  const D = '2026-09-22';
  const reason = (target, triggers, ts = `${D}T23:00:00.000Z`, note = '') => ({ ...ev('reason', D), ts, target, triggers, note });

  it('no reason: falls back to the legacy trigger, or nothing', () => {
    const p = ev('pouch', D, { trigger: 'coffee' });
    const q = ev('pouch', D);
    const s = attempt([p, q]);
    expect(S.reasonFor(s, p)).toBeNull();
    expect(S.triggersFor(s, p)).toEqual(['coffee']);
    expect(S.triggersFor(s, q)).toEqual([]);
  });
  it('a reason replaces the legacy trigger with its own set', () => {
    const p = ev('pouch', D, { trigger: 'coffee' });
    const r = reason(p.id, ['stress', 'driving'], undefined, 'late meeting');
    const s = attempt([p, r]);
    expect(S.reasonFor(s, p)).toBe(r);
    expect(S.triggersFor(s, p)).toEqual(['stress', 'driving']);
  });
  it('the latest reason per target wins; earlier ones stay in history', () => {
    const p = ev('pouch', D);
    const s = attempt([p, reason(p.id, ['boredom'], '2026-09-24T01:00:00.000Z'), reason(p.id, ['stress'], '2026-09-23T01:00:00.000Z')]);
    expect(S.triggersFor(s, p)).toEqual(['boredom']);
    expect(s.events.filter((e) => e.type === 'reason')).toHaveLength(2);
  });
  it('a reason for one pouch does not touch another; resisted keeps its trigger', () => {
    const p = ev('pouch', D);
    const q = ev('pouch', D);
    const r = ev('resisted', D, { trigger: 'social' });
    const s = attempt([p, q, r, reason(p.id, ['stress'])]);
    expect(S.triggersFor(s, q)).toEqual([]);
    expect(S.triggersFor(s, r)).toEqual(['social']);
  });
  it('a note-only reason clears the legacy trigger to an empty set', () => {
    const p = ev('pouch', D, { trigger: 'coffee' });
    const s = attempt([p, reason(p.id, [], undefined, 'just habit')]);
    expect(S.triggersFor(s, p)).toEqual([]);
  });
  it('the reason is found again after an append (no stale cache)', () => {
    const p = ev('pouch', D);
    const s1 = attempt([p]);
    expect(S.triggersFor(s1, p)).toEqual([]);
    const s2 = { ...s1, events: [...s1.events, reason(p.id, ['coffee'])] };
    expect(S.triggersFor(s2, p)).toEqual(['coffee']);
  });
});

describe('markdownSummary with corrections and reasons', () => {
  it('marks a corrected day as total* (timed) and adds the legend', () => {
    const p = pouches('2026-09-22', 4);
    const s = attempt([...p, { ...ev('correction', '2026-09-22'), count: 10 }, { ...ev('reason', '2026-09-22'), target: p[0].id, triggers: ['stress', 'coffee'], note: '' }]);
    const out = S.markdownSummary(s);
    expect(out).toMatch(/\| 2 \| 2026-09-22 \| 8 \| 10\* \(4\) \|/);
    expect(out).toContain('* corrected total (timed logs in parentheses)');
    expect(out).toMatch(/Triggers: .*stress \(1\)/);
    expect(out).toMatch(/coffee \(1\)/);
  });
  it('no corrected day in range: no marker, no legend', () => {
    const out = S.markdownSummary(attempt(pouches('2026-09-22', 4)));
    expect(out).toMatch(/\| 2 \| 2026-09-22 \| 8 \| 4 \|/);
    expect(out).not.toContain('corrected total');
  });
});
