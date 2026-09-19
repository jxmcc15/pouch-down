import { describe, it, expect } from 'vitest';
import { generatePlan, countLadder, strengthLadder, slotsFor, MIN_LENGTH_DAYS } from '../planGenerator.js';
import { LEGACY_PLAN } from '../legacyPlan.js';

const rhythm = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, sleepTime: '23:00' };
const make = (over = {}) => generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...rhythm, ...over });

describe('golden: the original inputs reproduce the hand-written 60-day plan', () => {
  const g = make({ lengthDays: 60, startDate: LEGACY_PLAN.startDate });

  it('has the same stages, days, counts, strengths and names', () => {
    const shape = (s) => ({ days: s.days, pouchesPerDay: s.pouchesPerDay, mg: s.mg, name: s.name });
    expect(g.stages.map(shape)).toEqual(LEGACY_PLAN.stages.map(shape));
  });

  it('has the same shopping deadlines', () => {
    const shop = (p) => p.stages.filter((s) => s.shopBefore).map((s) => [s.id, s.shopBefore.date, s.shopBefore.what]);
    expect(shop(g)).toEqual(shop(LEGACY_PLAN));
  });

  it('has the same quit date and baseline', () => {
    expect(g.quitDate).toBe(LEGACY_PLAN.quitDate);
    expect(g.baseline).toEqual(LEGACY_PLAN.baseline);
  });
});

describe('90-day plan, same proportions', () => {
  const p = make();
  it('scales stage lengths 15,15,15,15,15,12,2,1', () => {
    expect(p.stages.map((s) => s.days[1] - s.days[0] + 1)).toEqual([15, 15, 15, 15, 15, 12, 2, 1]);
  });
  it('puts the first cut on day 16 and quit day on day 90', () => {
    expect(p.stages[1].days[0]).toBe(16);
    expect(p.stages.at(-1).days).toEqual([90, 90]);
    expect(p.quitDate).toBe('2026-12-19');
  });
});

describe('slots: meals protected, floaters cut first', () => {
  const ids = (n) => slotsFor(n, rhythm).map((s) => s.id);
  it('1/day is after dinner', () => expect(ids(1)).toEqual(['after-dinner']));
  it('2/day is lunch + dinner', () => expect(ids(2)).toEqual(['after-lunch', 'after-dinner']));
  it('3/day is the three meals', () => expect(ids(3)).toEqual(['after-breakfast', 'after-lunch', 'after-dinner']));
  it('4/day adds an evening floater first', () => expect(ids(4)).toEqual(['after-breakfast', 'after-lunch', 'after-dinner', 'evening-1']));
  it('slots come out in time order with unique ids', () => {
    const s = slotsFor(12, rhythm);
    expect(new Set(s.map((x) => x.id)).size).toBe(12);
    expect(s.filter((x) => x.anchor !== 'fixed').map((x) => x.id)).toEqual(['after-breakfast', 'after-lunch', 'after-dinner']);
  });
});

describe('ladders', () => {
  it('counts step down by the original proportions', () => {
    expect(countLadder(9)).toEqual([8, 6, 4, 2]);
    expect(countLadder(12)).toEqual([11, 8, 5, 3]);
    expect(countLadder(4)).toEqual([4, 3, 2]);
    expect(countLadder(2)).toEqual([2]);
  });
  it('strengths ignore anything not below the current one', () => {
    expect(strengthLadder(6, [9, 3, 3])).toEqual([6, 3]);
    expect(strengthLadder(3, [])).toEqual([3]);
  });
});

describe('every sane input yields a valid plan', () => {
  it('is contiguous, never increases, ends 1 then 0, and fills every slot', () => {
    for (const ppd of [2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 20, 30])
      for (const [mg, strengths] of [[3, []], [6, [3]], [9, [6, 3]], [15, [12, 9, 6, 3]], [8, [4, 2]], [6, [9, 3]]])
        for (const lengthDays of [30, 31, 45, 59, 60, 61, 75, 89, 90, 91, 100, 120, 180, 365]) {
          const p = make({ pouchesPerDay: ppd, mg, strengths, lengthDays });
          const label = `${ppd}/day ${mg}mg [${strengths}] ${lengthDays}d`;
          let prevEnd = 0, prevCount = Infinity, prevMg = Infinity;
          for (const s of p.stages) {
            expect(s.days[0], label).toBe(prevEnd + 1);
            expect(s.days[1], label).toBeGreaterThanOrEqual(s.days[0]);
            expect(s.pouchesPerDay, label).toBeLessThanOrEqual(Math.min(prevCount, ppd));
            if (s.kind !== 'quit') expect(s.mg, label).toBeLessThanOrEqual(prevMg);
            expect(s.slots.length, label).toBe(s.pouchesPerDay);
            expect(new Set(s.slots.map((x) => x.id)).size, label).toBe(s.slots.length);
            prevEnd = s.days[1]; prevCount = s.pouchesPerDay; if (s.kind !== 'quit') prevMg = s.mg;
          }
          expect(prevEnd, label).toBe(lengthDays);
          expect(p.stages.at(-2).pouchesPerDay, label).toBe(1);
          expect(p.stages.at(-1).pouchesPerDay, label).toBe(0);
        }
  });

  it('rejects inputs it cannot plan for', () => {
    expect(() => make({ pouchesPerDay: 1 })).toThrow();
    expect(() => make({ lengthDays: MIN_LENGTH_DAYS - 1 })).toThrow();
  });
});
