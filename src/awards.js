// src/awards.js
// Awards are derived at read time from the log, like everything else — nothing
// is stored except which unlock celebrations have already played. They reward
// showing up and telling the truth; slips are never punished, and a badge,
// once earned, never un-earns: earnings are first-reach over history, and
// anything a later tap on the same day could reverse (a streak, a clean day,
// money kept) only counts once that day is over. Some things still rewrite the
// past on purpose (a price fixed in Settings, an honest backfill of a bad day),
// so a badge whose celebration already played stays earned regardless.

import { asOfDay, dayNumberFor, dateForDayNumber, eventsForDay, isLogged, pouchesForDay, dayCountsForStreak, classifyPouch } from './store.js';
import { capForDay } from './plan.js';
import { dayKeyOf } from './time.js';
import { moneyCents } from './money.js';

const STREAKS = [[3, 'bronze'], [7, 'bronze'], [14, 'silver'], [30, 'gold'], [60, 'gold'], [90, 'aurora']];

// One row per plan day up to the as-of day. `settled` = the day is over (or the
// attempt is), so nothing logged later that day can change its verdict.
// `keptCents` is the running total from money.js's own computation (logged
// days only), so it always matches the Money card to the cent.
function dayFacts(state) {
  const asOf = asOfDay(state);
  const archived = state.status === 'archived';
  const endN = Math.min(dayNumberFor(state, asOf), state.plan.totalDays);
  const facts = [];
  let loggedDays = 0, usedOnLogged = 0;
  for (let n = 1; n <= endN; n++) {
    const day = dateForDayNumber(state, n);
    const evs = eventsForDay(state, day);
    const taps = evs.filter((e) => e.type === 'pouch');
    const logged = isLogged(state, day);
    const used = pouchesForDay(state, day);
    const settled = archived || day < asOf;
    if (logged) { loggedDays++; usedOnLogged += used; }
    const { keptCents } = moneyCents(state, loggedDays, usedOnLogged);
    facts.push({
      n, day, logged, keptCents, settled,
      live: taps.length > 0 || evs.some((e) => e.type === 'resisted'), // logged on the day itself, not backfilled later
      green: dayCountsForStreak(state, day),
      over: logged && used > capForDay(state.plan, n),
      allOnTime: settled && taps.length > 0 && !evs.some((e) => e.type === 'backfill') && taps.every((e) => classifyPouch(state, e).bucket === 'on-time'),
    });
  }
  return facts;
}

// First day a run of `pred`-true days reaches `len`, plus the best run seen.
function runTo(facts, pred, len) {
  let run = 0, best = 0;
  for (const f of facts) {
    run = pred(f) ? run + 1 : 0;
    if (run > best) best = run;
    if (run >= len) return { on: f.day, best: len };
  }
  return { on: null, best };
}

const firstDay = (facts, pred) => facts.find(pred)?.day ?? null;
const settledGreen = (f) => f.settled && f.green;

export function awardsFor(state) {
  const asOf = asOfDay(state);
  const facts = dayFacts(state);
  const celebrated = state.celebratedAwards ?? [];
  const out = [];
  // Unearned progress is clamped below 1 so a badge never LOOKS earned before it
  // is (a stage share or money-kept fraction can otherwise round up to exactly
  // 1 while still unearned); NaN (e.g. a 0-length divisor) becomes 0.
  // Latched: already celebrated but no longer derivable (see the top). It
  // stays earned; `earnedOn` is null because the history no longer says when.
  const add = (id, tier, title, body, earnedOn, progress = 0) => {
    const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(0.99, progress)) : 0;
    const earned = earnedOn != null || celebrated.includes(id);
    out.push({ id, tier, title, body, earned, earnedOn: earnedOn ?? null, progress: earned ? 1 : clamped });
  };

  // "First log of the attempt" — a log before Day 1 counts too.
  const eventDays = [...new Set(state.events.map(dayKeyOf))].filter((d) => d <= asOf).sort();
  add('showed-up', 'bronze', 'Showed up', 'Your first log. Everything else is built on this.', eventDays.find((d) => isLogged(state, d)) ?? null);

  for (const [len, tier] of STREAKS) {
    if (len > state.plan.totalDays) continue;
    const r = runTo(facts, settledGreen, len);
    add(`streak-${len}`, tier, `${len}-day streak`, `${len} days in a row, logged and on plan.`, r.on, r.best / len);
  }

  const week = runTo(facts, (f) => f.logged, 7);
  add('full-week', 'silver', 'Full week logged', 'Seven straight days of telling the app the truth — on plan or not.', week.on, week.best / 7);

  add('honest-yellow', 'silver', 'Honest yellow', 'You logged a day you went over. A true yellow beats a fake green.', firstDay(facts, (f) => f.over));

  // The gap is a day with nothing logged on it at the time, so backfilling the
  // missed day afterwards (which the app asks for) doesn't erase the comeback.
  const back = facts.find((f, i) => i > 0 && f.logged && !facts[i - 1].live && facts.slice(0, i - 1).some((p) => p.logged));
  add('came-back', 'silver', 'Came back', 'You missed a day and logged the next one. That is the whole skill.', back?.day ?? null);

  // Cravings count wherever they happen — before Day 1 and after quit day too.
  const resisted = state.events.filter((e) => e.type === 'resisted' && dayKeyOf(e) <= asOf).map(dayKeyOf).sort();
  add('rode-it-out', 'bronze', 'Rode it out', 'A craving came and went without a pouch.', resisted[0] ?? null, resisted.length);
  add('rode-it-out-10', 'gold', 'Ten waves', 'Ten cravings ridden out. They pass whether you feed them or not.', resisted[9] ?? null, resisted.length / 10);

  add('on-the-clock', 'gold', 'On the clock', 'A full day with every pouch at or after its slot. Not one early.', firstDay(facts, (f) => f.allOnTime));

  // Generated plans mark their cuts; the legacy plan predates `kind`, so there
  // the first cut is the first stage with a lower count than the start.
  const stages = state.plan.stages;
  const cut = stages.some((s) => s.kind)
    ? stages.find((s) => s.kind === 'cut')
    : stages.find((s) => s.pouchesPerDay > 0 && s.pouchesPerDay < stages[0].pouchesPerDay);
  if (cut && cut.days[0] + 6 <= state.plan.totalDays) {
    let run = 0; // consecutive settled green days starting AT the cut
    for (const f of facts.filter((x) => x.n >= cut.days[0])) {
      if (!settledGreen(f) || run === 7) break;
      run++;
    }
    add('first-cut', 'gold', 'Survived the first cut', 'Seven on-plan days straight from the first step down — the hardest stretch.', run === 7 ? dateForDayNumber(state, cut.days[0] + 6) : null, run / 7);
  }

  for (const s of stages) {
    if (s.pouchesPerDay === 0) continue; // quit day has its own award
    const span = facts.filter((f) => f.n >= s.days[0] && f.n <= s.days[1]);
    const length = s.days[1] - s.days[0] + 1;
    const finished = span.length === length && span.at(-1).settled;
    const share = span.filter((f) => f.logged).length / length;
    add(`stage-${s.id}`, 'silver', `${s.name} — cleared`, `You logged your way through ${s.name}.`, finished && share >= 0.7 ? span.at(-1).day : null, share / 0.7);
  }

  const keptNow = facts.at(-1)?.keptCents ?? 0; // equals moneyStats(state).keptCents
  for (const [amt, tier] of [[25, 'silver'], [100, 'gold']]) {
    add(`kept-${amt}`, tier, `$${amt} kept`, `$${amt} that stayed in your pocket, counted on logged days only.`, firstDay(facts, (f) => f.settled && f.keptCents >= amt * 100), keptNow / (amt * 100));
  }

  const quit = stages.at(-1);
  const q = facts.find((f) => f.n === quit.days[0]);
  add('day-zero', 'aurora', 'Day zero', 'Quit day, logged, at zero.', q && q.settled && q.logged && pouchesForDay(state, q.day) === 0 ? q.day : null);

  return out;
}

// Earned but not yet celebrated. Pure: callers decide whether to celebrate
// (a read-only past attempt never should). Latched awards are celebrated by
// definition, so they never come back through here.
export const newlyEarned = (state) => awardsFor(state).filter((a) => a.earned && !(state.celebratedAwards ?? []).includes(a.id));
