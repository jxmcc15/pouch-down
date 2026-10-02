// src/__tests__/liveEvents.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePlan } from '../planGenerator.js';
import * as S from '../store.js';
import { liveEvents, isVoided, pouchFlags } from '../liveEvents.js';
import { moneyStats } from '../money.js';
import { awardsFor } from '../awards.js';
import { monthsFor } from '../calendarMonths.js';
import { renderLiveLog } from '../ingest.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const pouches = (day, n) => Array.from({ length: n }, () => ev('pouch', day));
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });

// a void of pouch `p`, entered now (ts), filed under the pouch's day
const voidOf = (p, ts = '2026-09-25T17:00:00.000Z') => ({ id: `v${++seq}`, ts, tzOffsetMin: -300, day: p.day, type: 'void', target: p.id, trigger: null });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T17:00:00.000Z')); }); // day 5, noon CT
afterEach(() => vi.useRealTimers());

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
    months: monthsFor(s),
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
