// Builds a taper plan from a person's starting point. Pure: same inputs, same
// plan. The shape mirrors the original hand-written 60-day plan — count first,
// then strength, interleaved; meals protected, floaters cut first — and fed
// that plan's inputs (9/day, 9mg, [6,3], 60 days) it reproduces it exactly.

const COUNT_RATIOS = [8 / 9, 6 / 9, 4 / 9, 2 / 9]; // share of baseline at each count step
const FINAL_MAIN_WEIGHT = 0.8; // the last main stage runs a little short (8 of 10 days)
export const MIN_LENGTH_DAYS = 30; // shorter than this and stages collapse to a day or two
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

const toMin = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const toHM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Daily counts to step through, strictly decreasing, never below 2 (1/day is
// its own "last one" stage).
export function countLadder(pouchesPerDay) {
  const out = [];
  for (const r of COUNT_RATIOS) {
    const c = Math.min(pouchesPerDay, Math.max(2, Math.round(pouchesPerDay * r)));
    if (!out.length || c < out[out.length - 1]) out.push(c);
  }
  return out;
}

// Strengths to step through: current first, then each lower one they can buy.
export function strengthLadder(mg, strengths = []) {
  return [mg, ...[...new Set(strengths)].filter((s) => s < mg).sort((a, b) => b - a)];
}

// Hold → first cut → then alternate strength drop / count cut until both
// ladders run out.
function mainSteps(counts, mgs) {
  const steps = [{ count: counts[0], mg: mgs[0], kind: 'hold' }];
  let ci = 0, si = 0;
  if (counts.length > 1) steps.push({ count: counts[++ci], mg: mgs[si], kind: 'cut' });
  let dropNext = true;
  while (ci < counts.length - 1 || si < mgs.length - 1) {
    const canDrop = si < mgs.length - 1, canCut = ci < counts.length - 1;
    if ((dropNext && canDrop) || !canCut) steps.push({ count: counts[ci], mg: mgs[++si], kind: 'drop' });
    else steps.push({ count: counts[++ci], mg: mgs[si], kind: 'cut' });
    dropNext = !dropNext;
  }
  return steps;
}

// Split the main days across stages by weight. Largest-remainder rounding so
// the days always sum exactly and no stage ever gets less than one day.
function stageDurations(n, mainDays) {
  const weights = Array.from({ length: n }, (_, i) => (i === n - 1 && n > 1 ? FINAL_MAIN_WEIGHT : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (mainDays * w) / total);
  const days = raw.map((r) => Math.max(1, Math.floor(r)));
  let left = mainDays - days.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) days[byRemainder[k % n][1]]++;
  for (; left < 0; left++) days[days.indexOf(Math.max(...days))]--;
  return days;
}

const MEALS = {
  breakfast: { id: 'after-breakfast', label: 'After breakfast', anchor: 'breakfast', offsetMin: 15 },
  lunch: { id: 'after-lunch', label: 'After lunch', anchor: 'lunch', offsetMin: 15 },
  dinner: { id: 'after-dinner', label: 'After dinner', anchor: 'dinner', offsetMin: 15 },
};

// Meal slots are protected: dinner outlasts lunch outlasts breakfast. Anything
// beyond three is a floater, placed evening → afternoon → morning first, then
// wherever the widest stretch is.
export function slotsFor(count, { mealTimes, sleepTime }) {
  if (count <= 0) return [];
  if (count === 1) return [MEALS.dinner];
  if (count === 2) return [MEALS.lunch, MEALS.dinner];
  const b = toMin(mealTimes.breakfast) + 15, l = toMin(mealTimes.lunch) + 15, d = toMin(mealTimes.dinner) + 15;
  const gaps = [
    { key: 'morning', label: 'Morning', start: b, end: l, n: 0 },
    { key: 'afternoon', label: 'Afternoon', start: l, end: d, n: 0 },
    { key: 'evening', label: 'Evening', start: d, end: Math.max(d + 60, toMin(sleepTime) - 60), n: 0 },
  ];
  let floaters = count - 3;
  for (const key of ['evening', 'afternoon', 'morning']) {
    if (floaters > 0) { gaps.find((g) => g.key === key).n++; floaters--; }
  }
  while (floaters-- > 0) {
    gaps.reduce((best, g) => ((g.end - g.start) / (g.n + 1) >= (best.end - best.start) / (best.n + 1) ? g : best)).n++;
  }
  const placed = [];
  for (const g of gaps) {
    for (let k = 1; k <= g.n; k++) {
      const at = Math.round((g.start + ((g.end - g.start) * k) / (g.n + 1)) / 15) * 15;
      placed.push({ id: `${g.key}-${k}`, label: g.n > 1 ? `${g.label} ${k}` : g.label, anchor: 'fixed', time: toHM(at), _at: at });
    }
  }
  const all = [
    { ...MEALS.breakfast, _at: b }, { ...MEALS.lunch, _at: l }, { ...MEALS.dinner, _at: d }, ...placed,
  ].sort((x, y) => x._at - y._at);
  return all.map(({ _at, ...s }) => s);
}

function nameAndTagline(step, cutIndex, dropIndex) {
  if (step.kind === 'hold') return ['Baseline hold', `Lock the ceiling at ${step.count}. No new habits, just a hard cap.`];
  if (step.kind === 'drop') return [`Strength drop ${ROMAN[dropIndex]}`, `Same slots, weaker pouch: ${step.mg}mg. Your routine stays put while the dose falls.`];
  if (step.count === 2) return ['Push the first back', 'After lunch and after dinner only. Mornings are yours again.'];
  if (step.count === 3) return ['Meals only', 'Three meals, three pouches. Every floater is gone.'];
  if (step.count === 4) return ['Meals only (+1)', 'Three meals plus one evening pouch. The floaters are nearly gone.'];
  return [cutIndex === 0 ? 'First cut' : `Cut to ${step.count}`, 'Drop the weakest floaters. Meals stay protected.'];
}

export function generatePlan({ pouchesPerDay, mg, strengths = [], lengthDays = 90, startDate, mealTimes, sleepTime = '23:00', pouchesPerTin = 20 }) {
  if (!(pouchesPerDay >= 2)) throw new Error('pouchesPerDay must be at least 2');
  if (!(lengthDays >= MIN_LENGTH_DAYS)) throw new Error(`lengthDays must be at least ${MIN_LENGTH_DAYS}`);
  const mgs = strengthLadder(mg, strengths);
  const steps = mainSteps(countLadder(pouchesPerDay), mgs);
  const lastOneDays = Math.max(1, Math.round(lengthDays / 60));
  const durations = stageDurations(steps.length, lengthDays - lastOneDays - 1);
  const rhythm = { mealTimes, sleepTime };

  const stages = [];
  let day = 1, cuts = 0, drops = 0;
  steps.forEach((step, i) => {
    const [name, tagline] = nameAndTagline(step, cuts, drops);
    if (step.kind === 'cut') cuts++;
    if (step.kind === 'drop') drops++;
    stages.push({ id: i + 1, name, kind: step.kind, days: [day, day + durations[i] - 1], pouchesPerDay: step.count, mg: step.mg, tagline, slots: slotsFor(step.count, rhythm) });
    day += durations[i];
  });
  const finalMg = mgs[mgs.length - 1];
  stages.push({ id: stages.length + 1, name: 'Last one', kind: 'last', days: [day, day + lastOneDays - 1], pouchesPerDay: 1, mg: finalMg, tagline: 'One pouch, after dinner. Say goodbye on your terms.', slots: slotsFor(1, rhythm) });
  day += lastOneDays;
  stages.push({ id: stages.length + 1, name: 'Quit day', kind: 'quit', days: [day, day], pouchesPerDay: 0, mg: 0, tagline: 'Zero. You already know how to do this.', slots: [] });

  // Shopping: before each strength drop, enough tins of the new strength to
  // cover every remaining day at that strength.
  for (const s of stages) {
    if (s.kind !== 'drop') continue;
    const pouches = stages.filter((t) => t.mg === s.mg).reduce((sum, t) => sum + t.pouchesPerDay * (t.days[1] - t.days[0] + 1), 0);
    s.shopBefore = { date: addDays(startDate, s.days[0] - 1), what: `~${Math.ceil(pouches / pouchesPerTin)} tins of ${s.mg}mg` };
  }

  return { generator: 'gen-1', startDate, quitDate: addDays(startDate, lengthDays - 1), totalDays: lengthDays, baseline: { pouchesPerDay, mg }, stages };
}
