// src/__tests__/awards.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePlan } from '../planGenerator.js';
import { LEGACY_PLAN } from '../legacyPlan.js';
import { moneyStats } from '../money.js';
import { awardsFor, newlyEarned } from '../awards.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const pouches = (day, n) => Array.from({ length: n }, () => ev('pouch', day));
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T17:00:00.000Z')); }); // day 5, noon CT
afterEach(() => vi.useRealTimers());

const get = (s, id) => awardsFor(s).find((a) => a.id === id);
const days = (from, n) => Array.from({ length: n }, (_, i) => { const d = new Date(`${from}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });

describe('awards catalog (plan contract)', () => {
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
});

describe('awards stay honest (coordinator additions)', () => {
  it('kept agrees with moneyStats on a mixed attempt', () => {
    // green, over, nolog, backfill, then today logged
    const s = attempt([...pouches('2026-09-21', 8), ...pouches('2026-09-22', 12), ev('backfill', '2026-09-24', { count: 5, streak: 'keep' }), ...pouches('2026-09-25', 3)]);
    const { kept } = moneyStats(s);
    expect(kept).toBeCloseTo(2.0);
    expect(get(s, 'kept-25').progress * 25).toBeCloseTo(kept);
  });
  it('an archived attempt is judged only up to its as-of day', () => {
    const s = attempt([
      ...pouches('2026-09-21', 8), ev('resisted', '2026-09-21'), ...pouches('2026-09-22', 8),
      ...pouches('2026-09-23', 8), ...pouches('2026-09-24', 12), ev('resisted', '2026-09-24'),
    ], { status: 'archived', archivedAt: '2026-09-22T18:00:00.000Z', celebratedAwards: ['showed-up'] });
    expect(get(s, 'streak-3')).toMatchObject({ earned: false, progress: 2 / 3 }); // the 23rd is after the end
    expect(get(s, 'honest-yellow').earned).toBe(false);
    expect(get(s, 'rode-it-out-10').progress).toBe(0.1);
    expect(get(s, 'showed-up')).toMatchObject({ earned: true, earnedOn: '2026-09-21' });
    const fresh = newlyEarned(s);
    expect(fresh.map((a) => a.id)).toContain('rode-it-out');
    expect(fresh.map((a) => a.id)).not.toContain('showed-up'); // already celebrated
    expect(fresh.every((a) => a.earned)).toBe(true);
  });
  it('a stage award never shows earned-level progress before the stage is over', () => {
    vi.setSystemTime(new Date('2026-10-02T17:00:00Z')); // day 12, inside stage 1 (days 1-15)
    const s = attempt(days('2026-09-21', 11).flatMap((d) => pouches(d, 8))); // 11/15 logged: share > 0.7, but stage isn't finished
    const a = get(s, 'stage-1');
    expect(a.earned).toBe(false);
    expect(a.progress).toBeLessThan(1);
  });
  it('every award progress is a finite number in [0, 1], for an empty attempt and a mixed one', () => {
    const mixed = attempt([
      ...pouches('2026-09-21', 8), ...pouches('2026-09-22', 12), ev('resisted', '2026-09-23'),
      ev('backfill', '2026-09-24', { count: 5, streak: 'keep' }), ...pouches('2026-09-25', 3),
    ]);
    for (const s of [attempt([]), mixed]) {
      for (const a of awardsFor(s)) {
        expect(Number.isFinite(a.progress)).toBe(true);
        expect(a.progress).toBeGreaterThanOrEqual(0);
        expect(a.progress).toBeLessThanOrEqual(1);
      }
    }
  });
  it('a nolog day never earns or extends a streak badge', () => {
    const s = attempt([...pouches('2026-09-21', 8), ...pouches('2026-09-22', 8), ...pouches('2026-09-24', 8)]);
    expect(get(s, 'streak-3')).toMatchObject({ earned: false, progress: 2 / 3 });
  });
  it('day-zero needs the quit day logged at zero', () => {
    vi.setSystemTime(new Date('2026-12-20T17:00:00Z')); // the day after quit day (2026-12-19)
    expect(get(attempt([]), 'day-zero').earned).toBe(false);
    expect(get(attempt([ev('resisted', '2026-12-19')]), 'day-zero')).toMatchObject({ earned: true, earnedOn: '2026-12-19' });
    expect(get(attempt([ev('pouch', '2026-12-19')]), 'day-zero').earned).toBe(false);
  });
});

describe('awards never un-earn', () => {
  it('a day still in progress cannot earn a streak — a same-day slip must not take a badge back', () => {
    vi.setSystemTime(new Date('2026-09-23T17:00:00Z'));
    const events = [...pouches('2026-09-21', 8), ...pouches('2026-09-22', 8), ...pouches('2026-09-23', 3)];
    expect(get(attempt(events), 'streak-3')).toMatchObject({ earned: false, progress: 2 / 3 });
    vi.setSystemTime(new Date('2026-09-24T17:00:00Z'));
    expect(get(attempt(events), 'streak-3')).toMatchObject({ earned: true, earnedOn: '2026-09-23' });
  });
  it('quit day earns day-zero only once it is over', () => {
    vi.setSystemTime(new Date('2026-12-19T17:00:00Z'));
    expect(get(attempt([ev('resisted', '2026-12-19')]), 'day-zero').earned).toBe(false);
  });
  it('came-back survives backfilling the missed day', () => {
    const s = attempt([...pouches('2026-09-21', 8), ...pouches('2026-09-23', 8), ev('backfill', '2026-09-22', { count: 6, streak: 'keep' })]);
    expect(get(s, 'came-back')).toMatchObject({ earned: true, earnedOn: '2026-09-23' });
  });
});

describe('other awards', () => {
  const tap = (day, at, slotAt) => ev('pouch', day, { ts: `${day}T${at}:00.000Z`, ctx: { nth: 1, cap: 8, slotAt: `${day}T${slotAt}:00.000Z`, firstSlotAt: `${day}T${slotAt}:00.000Z` } });
  it('on-the-clock: a finished day with every pouch at or after its slot', () => {
    expect(get(attempt([tap('2026-09-22', '15:00', '16:00')]), 'on-the-clock').earned).toBe(false); // an hour early
    expect(get(attempt([tap('2026-09-22', '17:00', '16:00')]), 'on-the-clock')).toMatchObject({ earned: true, earnedOn: '2026-09-22' });
    // A correction adds pouches with no time, and an untimed pouch can't be on time.
    expect(get(attempt([tap('2026-09-22', '17:00', '16:00'), ev('correction', '2026-09-22', { count: 3 })]), 'on-the-clock').earned).toBe(false);
  });
  it('showed-up and rode-it-out count logs from before Day 1', () => {
    const s = attempt([ev('resisted', '2026-09-20')]);
    expect(get(s, 'showed-up').earnedOn).toBe('2026-09-20');
    expect(get(s, 'rode-it-out').earnedOn).toBe('2026-09-20');
  });
  it('stage awards are keyed by stage id, generator and legacy alike, quit day excluded', () => {
    for (const p of [plan, LEGACY_PLAN]) {
      const ids = awardsFor(attempt([], { plan: p })).filter((a) => a.id.startsWith('stage-')).map((a) => a.id);
      expect(ids).toEqual(p.stages.filter((s) => s.pouchesPerDay > 0).map((s) => `stage-${s.id}`));
    }
  });
});

describe('an award you were shown stays earned', () => {
  // 29 days × 4 kept × $0.25 = $29 — kept-25 earned and already celebrated
  const earnedAttempt = (events, over = {}) => attempt(events, { celebratedAwards: ['kept-25'], ...over });
  const logged = () => days('2026-09-21', 29).flatMap((d) => pouches(d, 5));
  beforeEach(() => vi.setSystemTime(new Date('2026-10-20T17:00:00Z')));

  it('lowering the tin price in Settings does not take kept-25 back', () => {
    const s = earnedAttempt(logged(), { settings: { ...settings, costPerTin: 4 } }); // now $23.20
    expect(moneyStats(s).kept).toBeCloseTo(23.2);
    expect(get(s, 'kept-25')).toMatchObject({ earned: true, earnedOn: null, progress: 1 });
    expect(newlyEarned(s).map((a) => a.id)).not.toContain('kept-25');
    // never celebrated → nothing to latch; it honestly reads as locked
    expect(get({ ...s, celebratedAwards: [] }, 'kept-25')).toMatchObject({ earned: false, earnedOn: null });
  });
  it('honestly backfilling an over-cap day does not take kept-25 back', () => {
    // day 23 missed: $25 is first reached on day 26, $28 by now
    const events = logged().filter((e) => e.day !== '2026-10-13');
    expect(get(earnedAttempt(events), 'kept-25')).toMatchObject({ earned: true, earnedOn: '2026-10-16' });
    // then you tell the truth about day 23 — 25 pouches, −$4 — and $25 is never reached
    const s = earnedAttempt([...events, ev('backfill', '2026-10-13', { count: 25, streak: 'break' })]);
    expect(moneyStats(s).kept).toBeCloseTo(24);
    expect(get(s, 'kept-25')).toMatchObject({ earned: true, earnedOn: null, progress: 1 });
    expect(newlyEarned(s).map((a) => a.id)).not.toContain('kept-25');
  });
  it('a latched award that is also derived keeps its real date', () => {
    const s = earnedAttempt(logged());
    expect(get(s, 'kept-25')).toMatchObject({ earned: true, earnedOn: '2026-10-15', progress: 1 });
  });
});

describe('kept-25 and the Money card read the same cents', () => {
  it('$6.25 / 15-tin, 4 a day for 12 days: exactly $25.00, and the badge is earned', () => {
    vi.setSystemTime(new Date('2026-10-03T17:00:00Z')); // day 13, days 1-12 over
    const s = attempt(days('2026-09-21', 12).flatMap((d) => pouches(d, 4)), { settings: { ...settings, costPerTin: 6.25, pouchesPerTin: 15 } });
    expect(moneyStats(s).kept).toBe(25);
    expect(get(s, 'kept-25')).toMatchObject({ earned: true, earnedOn: '2026-10-02' });
  });
  it('$6.41 / 20-tin: raw 24.999 shows as $25.00, so the badge is earned too', () => {
    vi.setSystemTime(new Date('2026-10-04T17:00:00Z')); // day 14, days 1-13 over
    const s = attempt(days('2026-09-21', 13).flatMap((d) => pouches(d, 3)), { settings: { ...settings, costPerTin: 6.41, pouchesPerTin: 20 } });
    const m = moneyStats(s);
    expect(m.kept).toBe(25);
    expect(m.oldPace - m.spent).toBe(m.kept); // the card's three figures add up
    expect(get(s, 'kept-25')).toMatchObject({ earned: true, earnedOn: '2026-10-03' });
  });
});
