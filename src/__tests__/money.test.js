// src/__tests__/money.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generatePlan } from '../planGenerator.js';
import { moneyStats } from '../money.js';
import { markdownSummary } from '../store.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const pouches = (day, n) => Array.from({ length: n }, () => ev('pouch', day));
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T17:00:00.000Z')); }); // day 5, noon CT
afterEach(() => vi.useRealTimers());

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
  it('an archived attempt stops counting at its as-of day', () => {
    const s = attempt([...pouches('2026-09-21', 8), ...pouches('2026-09-24', 8)], {
      status: 'archived',
      archivedAt: '2026-09-22T18:00:00.000Z',
    });
    const m = moneyStats(s);
    expect(m.loggedDays).toBe(1);
  });
});

describe('markdownSummary Kept line', () => {
  it('renders Kept: $X.XX when kept is passed', () => {
    const out = markdownSummary(attempt([]), 7, 1.5);
    expect(out).toContain('Kept: $1.50');
  });
  it('omits the Kept line when kept is not passed', () => {
    const out = markdownSummary(attempt([]));
    expect(out).not.toContain('Kept');
  });
});

describe('money is counted in whole cents', () => {
  it('keptCents is an integer and kept is exactly keptCents / 100', () => {
    const s = attempt([...pouches('2026-09-21', 4), ...pouches('2026-09-22', 4)], { settings: { ...settings, costPerTin: 6.25, pouchesPerTin: 15 } });
    const m = moneyStats(s);
    expect(Number.isInteger(m.keptCents)).toBe(true);
    expect(m.keptCents).toBe(417); // old pace 750¢ − spent 333¢
    expect(m.kept).toBe(4.17);
    expect(m.oldPace).toBe(7.5);
    expect(m.spent).toBe(3.33);
  });
  it('the $6.41 / 20-tin case lands on the cent the card shows', () => {
    vi.setSystemTime(new Date('2026-10-04T17:00:00Z'));
    const days = Array.from({ length: 13 }, (_, i) => new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10)); // days 1-13
    const m = moneyStats(attempt(days.flatMap((d) => pouches(d, 3)), { settings: { ...settings, costPerTin: 6.41, pouchesPerTin: 20 } }));
    expect(m).toMatchObject({ oldPace: 37.5, spent: 12.5, kept: 25, keptCents: 2500 });
  });
});
