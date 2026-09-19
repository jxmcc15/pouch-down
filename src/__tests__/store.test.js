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
