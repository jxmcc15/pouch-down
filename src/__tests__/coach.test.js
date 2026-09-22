import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askCoach } from '../coach.js';
import { DEFAULT_SETTINGS, freshRoot, startAttempt, archiveActive, updateAttempt, attemptById } from '../root.js';
import { generatePlan } from '../planGenerator.js';
import { capForDay } from '../plan.js';
import { makeEvent } from '../store.js';

const mealTimes = DEFAULT_SETTINGS.mealTimes;
const pouchAt = (iso) => makeEvent('pouch', null, new Date(iso));

// What the coach would be told about this attempt right now.
async function systemFor(state) {
  let body;
  vi.stubGlobal('fetch', async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ text: 'ok' }] }) };
  });
  await askCoach(state, [{ role: 'user', text: 'How am I doing?' }], 'test-key');
  return body.system;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T17:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('coach prompt — facts come from the log, not the calendar', () => {
  it('a past attempt is described as of its last scored day, never as today', async () => {
    // 60 days from Jul 8 (quit day Sep 5), archived Sep 18, opened Sep 21.
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 60, startDate: '2026-07-08', mealTimes });
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-07T12:00:00Z' });
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [pouchAt('2026-07-08T14:00:00Z')] }));
    r = archiveActive(r, '2026-09-18T12:00:00Z');
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).not.toMatch(/nicotine-free/i);
    expect(system).not.toMatch(/day 76/);
    expect(system).not.toContain('2026-09-21');
    expect(system).toMatch(/past attempt/i);
    expect(system).toContain('2026-09-05, day 60 of 60');
  });

  it('past quit day on an active attempt: points at the log, claims nothing', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-01', mealTimes });
    const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-31T12:00:00Z' });
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).not.toMatch(/nicotine-free/i);
    expect(system).toMatch(/past quit day — check the log/i);
  });

  it('an unlogged today is unknown, not zero', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toContain('day 3 of 30');
    expect(system).not.toMatch(/Today[^\n]*: 0\//);
    expect(system).toMatch(/nothing logged yet/i);
  });

  it('a logged today reports used against the cap', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [pouchAt('2026-09-21T14:00:00Z'), pouchAt('2026-09-21T16:30:00Z')] }));
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toContain(`Today: 2 pouches used (cap ${capForDay(plan, 3)}), 0 cravings resisted`);
  });

  it('talks about "the user", never "your" — the coach is "you"', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toMatch(/the user/);
    expect(system).not.toMatch(/\byour\b/i);
    expect(system).not.toMatch(/if you went over/i);
    expect(system).not.toMatch(/james/i);
  });
});
