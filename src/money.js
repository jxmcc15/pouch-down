// What the taper is worth, counted over logged days only — an unlogged day
// saves nothing, because nobody knows what happened on it.

import { asOfDay, dayNumberFor, dateForDayNumber, isLogged, pouchesForDay } from './store.js';

// `pouches` pouches at the tin price, in whole cents. The tin price is taken
// to the cent (it's entered and AI-rounded that way) so the arithmetic is on
// integers with one rounding at the end, instead of a float sum that can land
// on 24.999999.
function centsFor(settings, pouches) {
  const tinCents = Math.round(settings.costPerTin * 100);
  if (!(settings.pouchesPerTin > 0) || !Number.isFinite(tinCents)) return 0;
  return Math.round((pouches * tinCents) / settings.pouchesPerTin);
}

// The one kept computation, in integer cents: `loggedDays` days at the old
// pace against `used` pouches. The Money card and the $25/$100 badges both
// read it, so a badge can never sit locked at 99% while the card says $25.00.
// kept = oldPace − spent exactly, so the card's three figures always add up.
export function moneyCents(state, loggedDays, used) {
  const oldPaceCents = centsFor(state.settings, loggedDays * state.plan.baseline.pouchesPerDay);
  const spentCents = centsFor(state.settings, used);
  return { oldPaceCents, spentCents, keptCents: oldPaceCents - spentCents };
}

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
  const { oldPaceCents, spentCents, keptCents } = moneyCents(state, loggedDays, used);
  return {
    perPouch,
    loggedDays,
    oldPace: oldPaceCents / 100,
    spent: spentCents / 100,
    kept: keptCents / 100,
    keptCents,
    afterQuit: { perMonth: base * perPouch * 30, perYear: base * perPouch * 365 },
  };
}
