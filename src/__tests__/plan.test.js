import { describe, it, expect } from 'vitest';
import { stageForDay, capForDay } from '../plan.js';
import { LEGACY_PLAN } from '../legacyPlan.js';

describe('plan helpers read from a plan object', () => {
  it('finds the stage for a day', () => {
    expect(stageForDay(LEGACY_PLAN, 0)).toBeNull();
    expect(stageForDay(LEGACY_PLAN, 1).name).toBe('Baseline hold');
    expect(stageForDay(LEGACY_PLAN, 11).name).toBe('First cut');
    expect(stageForDay(LEGACY_PLAN, 60).name).toBe('Quit day');
    expect(stageForDay(LEGACY_PLAN, 999).name).toBe('Quit day'); // post-quit
  });
  it('caps: pre-plan is unjudged, post-quit is zero', () => {
    expect(capForDay(LEGACY_PLAN, 0)).toBe(LEGACY_PLAN.baseline.pouchesPerDay + 1);
    expect(capForDay(LEGACY_PLAN, 1)).toBe(8);
    expect(capForDay(LEGACY_PLAN, 59)).toBe(1);
    expect(capForDay(LEGACY_PLAN, 61)).toBe(0);
  });
  it('legacy plan is self-contained data', () => {
    expect(LEGACY_PLAN).toMatchObject({ generator: 'legacy-60', startDate: '2026-07-08', quitDate: '2026-09-05', totalDays: 60, baseline: { pouchesPerDay: 9, mg: 9 } });
    expect(LEGACY_PLAN.stages).toHaveLength(8);
  });
});
