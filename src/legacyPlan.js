// The original hand-written 60-day plan, frozen as data. It is attempt 1's
// plan forever, and the golden reference the generator must reproduce.

import { STAGES, START_DATE, QUIT_DATE, TOTAL_DAYS, BASELINE } from './plan.js';

export const LEGACY_PLAN = {
  generator: 'legacy-60',
  startDate: START_DATE,
  quitDate: QUIT_DATE,
  totalDays: TOTAL_DAYS,
  baseline: { ...BASELINE },
  stages: STAGES,
};
