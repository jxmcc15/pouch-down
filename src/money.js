// What the taper is worth, counted over logged days only — an unlogged day
// saves nothing, because nobody knows what happened on it.

import { asOfDay, dayNumberFor, dateForDayNumber, isLogged, pouchesForDay } from './store.js';

export function moneyStats(state) {
  const { costPerTin, pouchesPerTin } = state.settings;
  const perPouch = pouchesPerTin > 0 ? costPerTin / pouchesPerTin : 0;
  const base = state.plan.baseline.pouchesPerDay;
  const endN = Math.min(dayNumberFor(state, asOfDay(state)), state.plan.totalDays);
  let loggedDays = 0, used = 0;
  for (let i = 1; i <= endN; i++) {
    const d = dateForDayNumber(state, i);
    if (!isLogged(state, d)) continue;
    loggedDays++;
    used += pouchesForDay(state, d);
  }
  const oldPace = loggedDays * base * perPouch;
  const spent = used * perPouch;
  return {
    perPouch,
    loggedDays,
    oldPace,
    spent,
    kept: oldPace - spent,
    afterQuit: { perMonth: base * perPouch * 30, perYear: base * perPouch * 365 },
  };
}
