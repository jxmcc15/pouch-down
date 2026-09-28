import { describe, it, expect } from 'vitest';
import { monthsFor } from '../calendarMonths.js';
import { generatePlan } from '../planGenerator.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, sleepTime: '23:00', pouchesPerTin: 20 };
const plan = generatePlan({ pouchesPerDay: 10, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-22', ...settings });
const ev = (id, day, type, extra = {}) => ({ id, ts: `${day}T15:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const state = {
  id: 'a2', status: 'active', archivedAt: null, settings, plan, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null,
  events: [
    ev('p1', '2026-09-22', 'pouch'), ev('c1', '2026-09-22', 'correction', { day: '2026-09-22', count: 3 }),
    ev('b1', '2026-09-23', 'backfill', { day: '2026-09-23', count: 2, streak: 'keep' }),
  ],
};

describe('monthsFor', () => {
  const months = monthsFor(state);
  it('splits a Sep 22 → Dec 20 plan into four months with the right plan-day ranges', () => {
    expect(months.map((m) => [m.label, ...m.dayRange])).toEqual([
      ['September', 1, 9], ['October', 10, 40], ['November', 41, 70], ['December', 71, 90],
    ]);
  });
  it('each month leads with blanks for the weekday its first plan day falls on', () => {
    expect(months[0].lead).toBe(2); // Tue Sep 22
    expect(months[1].lead).toBe(4); // Thu Oct 1
  });
  it('cells carry the day of month, status, count, cap, and the marks', () => {
    const [d1, d2] = months[0].cells;
    // 10/day holds at 9 for the first stage (the count ladder's first rung).
    expect(d1).toMatchObject({ n: 1, d: '2026-09-22', dom: 22, cap: 9, corrected: true, backfilled: false });
    expect(d2).toMatchObject({ n: 2, d: '2026-09-23', dom: 23, corrected: false, backfilled: true });
  });
  it('labels a month with its year only when the plan crosses into a new one', () => {
    const late = { ...state, plan: generatePlan({ pouchesPerDay: 10, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-11-20', ...settings }) };
    expect(monthsFor(late).map((m) => m.label)).toEqual(['November', 'December', 'January 2027', 'February 2027']);
  });
});
