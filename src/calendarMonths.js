// The plan's days, grouped by calendar month for the Calendar tab. Pure: it
// reads the attempt and returns plain data, so the grouping is testable and
// the component only draws.
import { dateForDayNumber, statusForDay, pouchesForDay, correctionForDay, eventsForDay } from './store.js';
import { capForDay } from './plan.js';

const at = (iso) => new Date(`${iso}T12:00:00`); // noon: the date can't drift with the zone

export function monthsFor(state) {
  const { totalDays } = state.plan;
  const startYear = at(dateForDayNumber(state, 1)).getFullYear();
  const months = [];
  for (let n = 1; n <= totalDays; n++) {
    const d = dateForDayNumber(state, n);
    const date = at(d);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    let month = months.at(-1);
    if (!month || month.key !== key) {
      const name = date.toLocaleDateString('en-US', { month: 'long' });
      month = {
        key,
        label: date.getFullYear() === startYear ? name : `${name} ${date.getFullYear()}`,
        dayRange: [n, n],
        lead: date.getDay(), // blanks before the first plan day of this month
        cells: [],
      };
      months.push(month);
    }
    month.dayRange[1] = n;
    month.cells.push({
      n, d, dom: date.getDate(),
      status: statusForDay(state, d),
      used: pouchesForDay(state, d),
      cap: capForDay(state.plan, n),
      corrected: correctionForDay(state, d) != null,
      backfilled: eventsForDay(state, d).some((e) => e.type === 'backfill'),
    });
  }
  return months;
}
