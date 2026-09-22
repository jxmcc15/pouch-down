// src/__tests__/zones.test.js
// The same history has to read the same wherever the phone is. Every event is
// stamped with the day and UTC offset it was logged under (time.js), so moving
// from Chicago to New York, Auckland or UTC must not reshuffle one day, streak
// or cent. The suite runs pinned to Chicago (vite.config.js); these tests step
// out of it on purpose. Node re-reads process.env.TZ whenever it is assigned,
// so each zone is set at runtime and the previous one restored afterwards.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generatePlan } from '../planGenerator.js';
import { stampNow, dayKeyOf, localHM } from '../time.js';
import * as S from '../store.js';
import { moneyStats } from '../money.js';

const HOME = 'America/Chicago';
const ZONES = ['America/New_York', HOME, 'Pacific/Auckland', 'UTC'];

function inZone(tz, fn) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    // assigning undefined would set the string "undefined", a zone of its own
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

// A wall-clock moment in whatever zone is current (month is 1-based here).
const local = (mo, d, h, mi = 0) => new Date(2026, mo - 1, d, h, mi);

afterEach(() => vi.useRealTimers());

describe('the zone switch is real', () => {
  it('the suite itself runs on Central time', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(HOME);
    expect(new Date('2026-09-25T17:00:00Z').getHours()).toBe(12);
  });
  it('setting TZ at runtime moves the wall clock, and restoring it moves it back', () => {
    const hours = ZONES.map((tz) => inZone(tz, () => new Date('2026-09-25T17:00:00Z').getHours()));
    expect(hours).toEqual([13, 12, 5, 17]);
    expect(new Date('2026-09-25T17:00:00Z').getHours()).toBe(12);
  });
});

describe('stamping: the 4am cutoff is local wherever you are', () => {
  it('2:30am counts toward yesterday and 4:00am starts today, in every zone', () => {
    for (const tz of ZONES) {
      const [late, early] = inZone(tz, () => [stampNow(local(9, 23, 2, 30)), stampNow(local(9, 23, 4, 0))]);
      expect({ tz, late: late.day, early: early.day }).toEqual({ tz, late: '2026-09-22', early: '2026-09-23' });
      expect(inZone(tz, () => late.tzOffsetMin === -local(9, 23, 2, 30).getTimezoneOffset())).toBe(true);
    }
  });
});

// Logged in Chicago, 9/21–9/27, read at noon on 9/27 wherever the phone is now.
// (9/27 is also the day New Zealand springs forward.)
const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const logged = (type, when, extra = {}) => ({ id: `z${++seq}`, ...inZone(HOME, () => stampNow(when())), type, trigger: null, ...extra });
const events = [
  ...Array.from({ length: 8 }, (_, i) => logged('pouch', () => local(9, 21, 8 + i))), // d1: 8 = cap
  logged('pouch', () => local(9, 22, 13)),
  logged('pouch', () => local(9, 22, 23, 30)),
  logged('pouch', () => local(9, 23, 2, 30)), // before 4am — still the 22nd
  logged('resisted', () => local(9, 23, 15)), // d3: resisted only
  // d4, 9/24: nothing
  ...Array.from({ length: 9 }, (_, i) => logged('pouch', () => local(9, 25, 8 + i))), // d5: over cap
  { ...logged('backfill', () => local(9, 27, 9)), day: '2026-09-26', count: 4, streak: 'keep' }, // d6
  logged('pouch', () => local(9, 27, 8)),
  logged('pouch', () => local(9, 27, 10, 30)),
];
const attempt = { id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
const DAYS = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'];

function readAt(tz, state) {
  return inZone(tz, () => {
    vi.useFakeTimers();
    vi.setSystemTime(local(9, 27, 12));
    try {
      return {
        today: S.todayKey(),
        asOf: S.asOfDay(state),
        eventDays: state.events.map(dayKeyOf),
        wallClock: state.events.map((e) => { const { h, m } = localHM(e); return `${h}:${m}`; }),
        firstTimes: state.events.filter((e) => e.type === 'pouch').map(S.fmtTime),
        status: DAYS.map((d) => S.statusForDay(state, d)),
        used: DAYS.map((d) => S.pouchesForDay(state, d)),
        streaks: S.streaks(state),
        money: moneyStats(state),
      };
    } finally {
      vi.useRealTimers();
    }
  });
}

describe('reading the same history from another zone', () => {
  it('scores it exactly as Chicago does', () => {
    const home = readAt(HOME, attempt);
    expect(home.status).toEqual(['pre', 'green', 'green', 'green', 'nolog', 'yellow', 'green', 'today-under', 'future']);
    expect(home.used).toEqual([0, 8, 3, 0, 0, 9, 4, 2, 0]);
    expect(home.streaks).toEqual({ current: 2, best: 3 });
    expect(home.money).toMatchObject({ loggedDays: 6, spent: 26 * 0.25 });
    for (const tz of ZONES) expect({ tz, ...readAt(tz, attempt) }).toEqual({ tz, ...home });
  });
  it('an archived attempt ends on the day it was archived where it was archived', () => {
    // Archived 10:30pm CDT on 9/23 — already 9/24 in Auckland. The day is
    // stamped at archive time (archivedDay), so no zone can move the end.
    const archived = { ...attempt, events: events.filter((e) => e.day <= '2026-09-23'), status: 'archived', archivedAt: '2026-09-24T03:30:00.000Z', archivedDay: '2026-09-23' };
    const home = readAt(HOME, archived);
    expect(home.asOf).toBe('2026-09-23');
    expect(home.streaks).toEqual({ current: 3, best: 3 });
    for (const tz of ZONES) expect({ tz, ...readAt(tz, archived) }).toEqual({ tz, ...home });
  });
});
