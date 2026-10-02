import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateProposal, takeProposals, outcomeResult, overflowResult, resultsFor, applyAction, toTurns,
  actionsOf, outcomesOf, renderOutcomes, REFUSED,
} from '../coachActions.js';
import { generatePlan } from '../planGenerator.js';
import { capForDay } from '../plan.js';
import { TOOLS } from '../coachTools.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
// 90 days from Mon 2026-09-28: Thu Oct 1 is Day 4, cap 8 (Baseline hold).
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-28', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });
const NOW = Date.parse('2026-10-01T21:12:00-05:00'); // Thu 9:12 PM CDT
const TODAY = '2026-10-01';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => vi.useRealTimers());

// 2:14 PM CDT today, and one voided pouch.
const P = ev('pouch', TODAY, { ts: '2026-10-01T19:14:00.000Z' });
const GONE = ev('pouch', TODAY, { ts: '2026-10-01T15:00:00.000Z' });
const S = attempt([P, GONE, { ...ev('void', TODAY), target: GONE.id }]);
const call = (name, input, id = 'toolu_1') => ({ id, name, input });
const check = (name, input, state = S) => validateProposal(state, call(name, input), NOW);
const reasonOf = (name, input, state) => {
  const r = check(name, input, state);
  expect(r.ok).toBe(false);
  return r.reason;
};

describe('validateProposal — what every tool must look like', () => {
  it('an unknown tool name, a missing id, a non-object input, an unknown key, a missing key', () => {
    expect(validateProposal(S, call('update_settings', {}), NOW)).toEqual({ ok: false, toolUseId: 'toolu_1', name: 'update_settings', reason: "the app doesn't have that action" });
    expect(validateProposal(S, { name: 'log_pouch_now', input: {} }, NOW).reason).toBe('the proposal came without an id');
    expect(reasonOf('log_pouch_now', 'coffee')).toBe("the proposal's details couldn't be read");
    expect(reasonOf('log_pouch_now', ['coffee'])).toBe("the proposal's details couldn't be read");
    expect(reasonOf('log_pouch_now', { trigger: 'coffee', ts: '2026-10-01T12:00:00Z' })).toBe("the proposal had a detail the app doesn't take");
    expect(reasonOf('add_late_pouch', { day: TODAY, time: '16:30', triggers: [] })).toBe('the note is missing');
  });
  it('a key that only looks like a property of every object is still unexpected', () => {
    expect(reasonOf('log_pouch_now', JSON.parse('{"__proto__":{"trigger":"coffee"}}'))).toBe("the proposal had a detail the app doesn't take");
    expect(reasonOf('log_pouch_now', { constructor: 'coffee' })).toBe("the proposal had a detail the app doesn't take");
    expect(reasonOf('log_pouch_now', null)).toBe("the proposal's details couldn't be read");
  });
  it('a past attempt proposes nothing', () => {
    expect(reasonOf('log_pouch_now', {}, { ...S, status: 'archived' })).toBe("a past attempt can't change");
  });
});

describe('log_pouch_now / log_resisted_now', () => {
  it('good, with and without a trigger (null counts as none)', () => {
    expect(check('log_pouch_now', { trigger: 'boredom' })).toEqual({ ok: true, action: {
      toolUseId: 'toolu_1', name: 'log_pouch_now', verb: 'logPouch', args: ['boredom'],
      summary: 'Log a pouch now · boredom', facts: 'stamped when you confirm',
    } });
    expect(check('log_pouch_now', {}).action.args).toEqual([null]);
    expect(check('log_resisted_now', { trigger: null }).action).toMatchObject({ verb: 'logResisted', args: [null], summary: 'Log a craving resisted' });
  });
  it('a trigger outside the list, or of the wrong type', () => {
    expect(reasonOf('log_pouch_now', { trigger: 'rage' })).toBe("that's not one of the app's reasons");
    expect(reasonOf('log_resisted_now', { trigger: 3 })).toBe("that's not one of the app's reasons");
  });
});

describe('add_late_pouch', () => {
  const good = { day: TODAY, time: '16:30', triggers: ['boredom'], note: '' };
  it('good: the card reads the day and the time in the app\'s words', () => {
    expect(check('add_late_pouch', good).action).toEqual({
      toolUseId: 'toolu_1', name: 'add_late_pouch', verb: 'logLatePouch', args: [{ day: TODAY, time: '16:30', triggers: ['boredom'], note: '' }],
      summary: 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom', facts: 'added later', note: '',
    });
  });
  it('time null is "time unknown"; the note is trimmed', () => {
    const a = check('add_late_pouch', { ...good, time: null, triggers: [], note: '  after the meeting ' }).action;
    expect(a.args).toEqual([{ day: TODAY, time: null, triggers: [], note: 'after the meeting' }]);
    expect(a.summary).toBe('Add a pouch · Thu Oct 1 · time unknown');
    expect(a.facts).toBe('no reason · added later');
    expect(a.note).toBe('after the meeting');
  });
  it('a note never writes into the card\'s facts, and may not carry control or direction characters', () => {
    const fake = 'x” · streak kept · “y';
    const a = check('add_late_pouch', { ...good, note: fake }).action;
    expect(a.facts).toBe('added later');
    expect(a.note).toBe(fake);
    for (const c of ['\u0000', '\n', '\u001f', '\u007f', '\u202a', '\u202e', '\u2066', '\u2069']) {
      expect(reasonOf('add_late_pouch', { ...good, note: `ok${c}ok` })).toBe("the note has characters the app can't show");
      expect(reasonOf('add_reason', { pouch_id: P.id, triggers: ['stress'], note: `ok${c}ok` })).toBe("the note has characters the app can't show");
    }
  });
  it('a day past quit day is allowed (the still-free check-in must not be blocked)', () => {
    // 30 days from Aug 30: quit day is Sep 28, so Sep 30 is Day 32.
    const done = attempt([], { plan: generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-30', mealTimes: settings.mealTimes }) });
    expect(check('add_late_pouch', { ...good, day: '2026-09-30' }, done).ok).toBe(true);
  });
  it.each([
    ['a day that is not a date', { day: 'yesterday' }, "that day isn't on the calendar"],
    ['a day the calendar lacks', { day: '2026-09-31' }, "that day isn't on the calendar"],
    ['a pre-plan day', { day: '2026-09-27' }, 'that day is before the plan started'],
    ['a future day', { day: '2026-10-02' }, 'that day is after today'],
    ['a time later than now', { time: '22:30' }, "that time hasn't happened yet"],
    ['a time not HH:MM', { time: '4:30' }, "that time isn't a time of day"],
    ['a time of the wrong type', { time: 1630 }, "that time isn't a time of day"],
    ['triggers not a list', { triggers: 'boredom' }, "the reasons didn't come as a list"],
    ['an unknown trigger', { triggers: ['rage'] }, "that's not one of the app's reasons"],
    ['a trigger twice', { triggers: ['stress', 'stress'] }, 'a reason appears twice'],
    ['seven triggers', { triggers: ['after-meal', 'coffee', 'driving', 'stress', 'boredom', 'social', 'coffee'] }, 'more reasons than the app has'],
    ['a note of 141 characters', { note: 'x'.repeat(141) }, 'the note is too long — 140 characters at most'],
    ['a 5 KB note', { note: 'x'.repeat(5000) }, 'the note is too long — 140 characters at most'],
    ['a note that is not text', { note: 7 }, "the note isn't text"],
  ])('%s', (_, patch, reason) => {
    expect(reasonOf('add_late_pouch', { ...good, ...patch })).toBe(reason);
  });
  it('a time the spring-forward jump skipped is refused, not quietly moved', () => {
    // 2026-03-08 02:30 never happened in Chicago. Clock a day later so it is past.
    vi.setSystemTime(new Date('2026-03-09T18:00:00Z'));
    const spring = attempt([], { plan: generatePlan({ pouchesPerDay: 9, mg: 9, lengthDays: 30, startDate: '2026-03-01', mealTimes: settings.mealTimes }) });
    // App day Mar 7 + 02:30 lands on calendar Mar 8 at 2:30 AM: the gap.
    expect(validateProposal(spring, call('add_late_pouch', { ...good, day: '2026-03-07', time: '02:30' }), Date.parse('2026-03-09T18:00:00Z')).reason)
      .toBe("that time didn't happen on that day (the clocks changed)");
  });
});

describe('mark_mistake / add_reason — only ids the prompt showed', () => {
  it('good', () => {
    expect(check('mark_mistake', { pouch_id: P.id }).action).toEqual({
      toolUseId: 'toolu_1', name: 'mark_mistake', verb: 'voidPouch', args: [P.id],
      summary: 'Mark as mistake · the 2:14 PM pouch on Thu Oct 1', facts: 'stops counting · stays in your history',
    });
    expect(check('add_reason', { pouch_id: P.id, triggers: ['stress'], note: '' }).action).toMatchObject({
      verb: 'logReason', args: [{ target: P.id, triggers: ['stress'], note: '' }], summary: 'Add a reason · 2:14 PM pouch · stress',
    });
    const noted = check('add_reason', { pouch_id: P.id, triggers: [], note: ' late call ' }).action;
    expect(noted.summary).toBe('Add a reason · 2:14 PM pouch · a note');
    expect(noted.facts).toBe('Thu Oct 1');
    expect(noted.note).toBe('late call');
  });
  it('a foreign id, a voided pouch, a pouch older than 7 days, a pouch of another attempt', () => {
    const old = ev('pouch', '2026-09-24', { ts: '2026-09-24T15:00:00.000Z' });
    const s = attempt([P, old], { plan: generatePlan({ pouchesPerDay: 9, mg: 9, lengthDays: 90, startDate: '2026-09-21', mealTimes: settings.mealTimes }) });
    expect(reasonOf('mark_mistake', { pouch_id: 'not-a-real-id' })).toBe("that pouch isn't one from the last 7 days");
    expect(reasonOf('mark_mistake', { pouch_id: GONE.id })).toBe("that pouch isn't one from the last 7 days");
    expect(reasonOf('mark_mistake', { pouch_id: old.id }, s)).toBe("that pouch isn't one from the last 7 days");
    expect(reasonOf('add_reason', { pouch_id: 'a1-pouch', triggers: ['stress'], note: '' })).toBe("that pouch isn't one from the last 7 days");
  });
  it('a reason with neither triggers nor a note', () => {
    expect(reasonOf('add_reason', { pouch_id: P.id, triggers: [], note: '   ' })).toBe('a reason needs at least one trigger or a note');
    expect(reasonOf('add_reason', { pouch_id: P.id, triggers: [], note: '' })).toBe('a reason needs at least one trigger or a note');
  });
});

describe('fill_missed_day — BackfillForm\'s streak rule', () => {
  const cap = capForDay(plan, 2); // Tue Sep 29 = Day 2
  it('within cap the model\'s choice stands, and the card says it', () => {
    expect(check('fill_missed_day', { day: '2026-09-29', count: 7, streak: 'keep' }).action).toEqual({
      toolUseId: 'toolu_1', name: 'fill_missed_day', verb: 'logBackfill', args: [{ day: '2026-09-29', count: 7, streak: 'keep' }],
      summary: 'Fill in Tue Sep 29 · 7 pouches · streak kept', facts: 'entered later',
    });
    expect(check('fill_missed_day', { day: '2026-09-29', count: 1, streak: 'break' }).action.summary).toBe('Fill in Tue Sep 29 · 1 pouch · streak breaks');
  });
  it('over cap the streak breaks whatever the model said', () => {
    const a = check('fill_missed_day', { day: '2026-09-29', count: cap + 1, streak: 'keep' }).action;
    expect(a.args[0].streak).toBe('break');
    expect(a.summary).toBe(`Fill in Tue Sep 29 · ${cap + 1} pouches · streak breaks: over cap`);
    expect(a.facts).toBe('streak breaks: over cap · entered later');
  });
  it.each([
    ['a negative count', { count: -1 }, 'the count has to be a whole number from 0 to 60'],
    ['a fractional count', { count: 2.5 }, 'the count has to be a whole number from 0 to 60'],
    ['a count over 60', { count: 61 }, 'the count has to be a whole number from 0 to 60'],
    ['a count as text', { count: '7' }, 'the count has to be a whole number from 0 to 60'],
    ['a streak word outside the two', { streak: 'maybe' }, 'the streak has to be kept or broken'],
    ['a future day', { day: '2026-10-05' }, 'that day is after today'],
    ['today, still being logged', { day: TODAY }, "that day isn't over yet"],
    ['a logged day', { day: '2026-09-30' }, 'that day is already logged'],
  ])('%s', (_, patch, reason) => {
    const logged = attempt([...S.events, ev('pouch', '2026-09-30')]);
    expect(reasonOf('fill_missed_day', { day: '2026-09-29', count: 7, streak: 'keep', ...patch }, logged)).toBe(reason);
  });
  it('a day after the plan ends', () => {
    const done = attempt([], { plan: generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-30', mealTimes: settings.mealTimes }) });
    expect(reasonOf('fill_missed_day', { day: '2026-09-30', count: 0, streak: 'keep' }, done)).toBe('that day is after the plan ends');
  });
  it('a day whose pouches were all marked as mistakes cannot be filled green', () => {
    // Over cap with ten pouches, then each one marked a mistake: the day reads
    // as no log, and a fill of 0 would make it green and part of the streak.
    const taps = Array.from({ length: 10 }, (_, i) => ev('pouch', '2026-09-29', { ts: `2026-09-29T${14 + (i % 8)}:0${i % 10}:00.000Z` }));
    const voided = attempt([...taps, ...taps.map((t) => ({ ...ev('void', '2026-09-29'), target: t.id }))]);
    const { cards } = takeProposals(voided, [call('fill_missed_day', { day: '2026-09-29', count: 0, streak: 'keep' })], NOW);
    expect(cards).toEqual([{ toolUseId: 'toolu_1', name: 'fill_missed_day', status: 'invalid', reason: 'that day has pouches on it, some marked as mistakes — fill it in from Calendar if it needs fixing' }]);
    expect(check('fill_missed_day', { day: '2026-09-29', count: 0, streak: 'keep' }).ok).toBe(true);
  });
});

describe('correct_day_total', () => {
  // Sep 29 has three logged pouches; Sep 30 has none.
  const L = attempt([...S.events, ...['14', '15', '16'].map((h) => ev('pouch', '2026-09-29', { ts: `2026-09-29T${h}:00:00.000Z` }))]);
  const check = (name, input) => validateProposal(L, call(name, input), NOW);
  const reasonOf = (name, input, state = L) => {
    const r = validateProposal(state, call(name, input), NOW);
    expect(r.ok).toBe(false);
    return r.reason;
  };
  it.each([
    ['today, still being logged', { day: TODAY, count: 9 }, "that day isn't over yet"],
    ['an unlogged day', { day: '2026-09-30', count: 9 }, 'that day has no log to correct'],
    ['below the pouches already logged', { day: '2026-09-29', count: 2 }, "that's below what the day already shows — lower it from Calendar if it's wrong"],
  ])('%s', (_, input, reason) => {
    expect(reasonOf('correct_day_total', input)).toBe(reason);
  });
  it('never below what the day already shows, a correction included', () => {
    // Two pouches, corrected up to 12 (over cap 8): a coach "correction" to 3
    // would pull the day under cap and turn it green.
    const taps = ['14', '15'].map((h) => ev('pouch', '2026-09-29', { ts: `2026-09-29T${h}:00:00.000Z` }));
    const up = attempt([...taps, ev('correction', '2026-09-29', { ts: '2026-09-30T15:00:00.000Z', count: 12 })]);
    expect(capForDay(plan, 2)).toBe(8);
    expect(reasonOf('correct_day_total', { day: '2026-09-29', count: 3 }, up)).toBe("that's below what the day already shows — lower it from Calendar if it's wrong");
    expect(reasonOf('correct_day_total', { day: '2026-09-29', count: 11 }, up)).toBe("that's below what the day already shows — lower it from Calendar if it's wrong");
    expect(validateProposal(up, call('correct_day_total', { day: '2026-09-29', count: 12 }), NOW).ok).toBe(true);
    expect(validateProposal(up, call('correct_day_total', { day: '2026-09-29', count: 14 }), NOW).ok).toBe(true);
  });
  it('a day after the plan ends', () => {
    const done = attempt([ev('pouch', '2026-09-30')], { plan: generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-30', mealTimes: settings.mealTimes }) });
    expect(reasonOf('correct_day_total', { day: '2026-09-30', count: 4 }, done)).toBe('that day is after the plan ends');
  });
  it('good, and the bounds', () => {
    expect(check('correct_day_total', { day: '2026-09-29', count: 3 }).ok).toBe(true);
    expect(check('correct_day_total', { day: '2026-09-29', count: 9 }).action).toMatchObject({ verb: 'logCorrection', args: [{ day: '2026-09-29', count: 9 }], summary: 'Correct Tue Sep 29 · total 9', facts: 'the logged pouches stay' });
    expect(reasonOf('correct_day_total', { day: '2026-09-29', count: 61 })).toBe('the count has to be a whole number from 0 to 60');
    expect(reasonOf('correct_day_total', { day: '2026-09-27', count: 3 })).toBe('that day is before the plan started');
  });
});

describe('log_checkin', () => {
  it('good: only the answers given reach the api', () => {
    expect(check('log_checkin', { sleep_hours: 6.5, sleep_quality: 3, workout: true }).action).toMatchObject({
      verb: 'logCheckin', args: [{ sleepHours: 6.5, sleepQuality: 3, workout: true }], summary: 'Morning check-in · 6.5h · 3/5 · workout', facts: 'for today',
    });
    expect(check('log_checkin', { workout: false }).action).toMatchObject({ args: [{ workout: false }], summary: 'Morning check-in · no workout' });
  });
  it('sleep in whole hours or tenths, nothing finer', () => {
    expect(check('log_checkin', { sleep_hours: 7 }).action).toMatchObject({ args: [{ sleepHours: 7 }], summary: 'Morning check-in · 7h' });
    expect(check('log_checkin', { sleep_hours: 0 }).action.args).toEqual([{ sleepHours: 0 }]);
    expect(check('log_checkin', { sleep_hours: 16 }).action.args).toEqual([{ sleepHours: 16 }]);
    expect(reasonOf('log_checkin', { sleep_hours: 7.25 })).toBe('sleep hours need to be 0 to 16, one decimal at most');
    expect(reasonOf('log_checkin', { sleep_hours: -0.5 })).toBe('sleep hours need to be 0 to 16, one decimal at most');
    expect(reasonOf('log_checkin', { sleep_hours: NaN })).toBe('sleep hours need to be 0 to 16, one decimal at most');
  });
  it.each([
    ['nothing answered', {}, 'a check-in needs at least one answer'],
    ['all null', { sleep_hours: null, sleep_quality: null, workout: null }, 'a check-in needs at least one answer'],
    ['17 hours', { sleep_hours: 17 }, 'sleep hours need to be 0 to 16, one decimal at most'],
    ['hundredths', { sleep_hours: 6.55 }, 'sleep hours need to be 0 to 16, one decimal at most'],
    ['hours as text', { sleep_hours: '7' }, 'sleep hours need to be 0 to 16, one decimal at most'],
    ['quality 6', { sleep_quality: 6 }, 'sleep quality has to be a whole number from 1 to 5'],
    ['quality 2.5', { sleep_quality: 2.5 }, 'sleep quality has to be a whole number from 1 to 5'],
    ['workout as text', { workout: 'yes' }, 'the workout answer has to be yes or no'],
  ])('%s', (_, input, reason) => {
    expect(reasonOf('log_checkin', input)).toBe(reason);
  });
});

describe('takeProposals', () => {
  it('keeps the order, cards the first five, and lists the rest as overflow', () => {
    const six = Array.from({ length: 6 }, (_, i) => call('log_resisted_now', {}, `toolu_${i}`));
    const { cards, overflow } = takeProposals(S, six, NOW);
    expect(cards.map((c) => c.toolUseId)).toEqual(['toolu_0', 'toolu_1', 'toolu_2', 'toolu_3', 'toolu_4']);
    expect(cards.every((c) => c.status === 'pending')).toBe(true);
    expect(overflow).toEqual(['toolu_5']);
  });
  it('an invalid proposal is a card with a reason and no action', () => {
    const { cards } = takeProposals(S, [call('mark_mistake', { pouch_id: 'nope' }, 'toolu_x'), call('log_pouch_now', {}, 'toolu_y')], NOW);
    expect(cards[0]).toEqual({ toolUseId: 'toolu_x', name: 'mark_mistake', status: 'invalid', reason: "that pouch isn't one from the last 7 days" });
    expect(cards[1]).toMatchObject({ toolUseId: 'toolu_y', status: 'pending', action: { verb: 'logPouch' } });
  });
  it('the same pouch marked twice is one card and one invalid; two pouches now are two cards', () => {
    const { cards } = takeProposals(S, [
      call('mark_mistake', { pouch_id: P.id }, 'a'), call('mark_mistake', { pouch_id: P.id }, 'b'),
      call('log_pouch_now', {}, 'c'), call('log_pouch_now', {}, 'd'),
    ], NOW);
    expect(cards.map((c) => c.status)).toEqual(['pending', 'invalid', 'pending', 'pending']);
    expect(cards[1].reason).toBe('the same action twice in one reply');
  });
  it('no proposals, or something that is not a list, is no cards', () => {
    expect(takeProposals(S, [], NOW)).toEqual({ cards: [], overflow: [] });
    expect(takeProposals(S, undefined, NOW)).toEqual({ cards: [], overflow: [] });
  });
});

describe('outcomeResult — what the coach is told', () => {
  const card = (status, extra = {}) => ({ toolUseId: 'toolu_1', name: 'add_late_pouch', status, ...extra });
  it('one tool_result per outcome; refused and invalid are errors', () => {
    expect(outcomeResult(card('saved', { eventId: 'e1' }))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' });
    expect(outcomeResult(card('undone'))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved, then undone by the user' });
    expect(outcomeResult(card('skipped'))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'skipped by the user' });
    expect(outcomeResult(card('pending'))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'skipped by the user' });
    expect(outcomeResult(card('refused', { reason: REFUSED }))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: `refused: ${REFUSED}`, is_error: true });
    expect(outcomeResult(card('invalid', { reason: "the app doesn't have that action" }))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: "invalid: the app doesn't have that action", is_error: true });
  });
  it('overflow is told to split; resultsFor answers every tool_use, cards first', () => {
    expect(overflowResult('toolu_6')).toEqual({ type: 'tool_result', tool_use_id: 'toolu_6', content: 'invalid: more than 5 actions in one reply — ask the user to split them up', is_error: true });
    const m = { cards: [card('saved'), { ...card('skipped'), toolUseId: 'toolu_2' }], overflow: ['toolu_6'] };
    expect(resultsFor(m).map((r) => r.tool_use_id)).toEqual(['toolu_1', 'toolu_2', 'toolu_6']);
  });
});

describe('applyAction — the one place a verb is called', () => {
  const action = { verb: 'logLatePouch', args: [{ day: TODAY, time: '16:30', triggers: [], note: '' }] };
  it('calls the api method with the validated args; an id is saved', () => {
    const api = { logLatePouch: vi.fn(() => 'e42') };
    expect(applyAction(api, action)).toEqual({ outcome: 'saved', eventId: 'e42' });
    expect(api.logLatePouch).toHaveBeenCalledWith({ day: TODAY, time: '16:30', triggers: [], note: '' });
  });
  it('null from the api is refused, with the reason the coach and the card show', () => {
    expect(applyAction({ logLatePouch: () => null }, action)).toEqual({ outcome: 'refused', reason: REFUSED });
  });
  it('a verb outside the allowlist is never called, even if the api has it', () => {
    const api = { startFresh: vi.fn(() => 'x'), updateSettings: vi.fn(() => 'x') };
    expect(applyAction(api, { verb: 'startFresh', args: [] }).outcome).toBe('refused');
    expect(applyAction(api, { verb: 'updateSettings', args: [{}] }).outcome).toBe('refused');
    expect(api.startFresh).not.toHaveBeenCalled();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });
  it('args that are not a list never reach the api', () => {
    const api = { logPouch: vi.fn(() => 'x') };
    expect(applyAction(api, { verb: 'logPouch', args: 'x' })).toEqual({ outcome: 'refused', reason: REFUSED });
    expect(api.logPouch).not.toHaveBeenCalled();
  });
  it('an api method that throws is a refused card, not a crash in the sheet', () => {
    expect(applyAction({ logLatePouch: () => { throw new Error('storage full'); } }, action)).toEqual({ outcome: 'refused', reason: REFUSED });
  });
});

describe('toTurns — the exact conversation the API gets', () => {
  const proposals = [{ id: 'toolu_1', name: 'add_late_pouch', input: { day: TODAY, time: '16:30', triggers: ['boredom'], note: '' } }];
  const results = [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' }];
  it('text-only turns stay strings', () => {
    expect(toTurns([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hey.' }])).toEqual([
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hey.' },
    ]);
  });
  it('a coach turn that proposed is text + tool_use blocks; the follow-up is only tool_results', () => {
    expect(toTurns([
      { role: 'user', text: 'had one at 4:30' },
      { role: 'assistant', text: 'Confirm and it\'s in.', proposals, cards: [] },
      { role: 'user', text: 'Confirmed: …', results, auto: true },
    ])).toEqual([
      { role: 'user', content: 'had one at 4:30' },
      { role: 'assistant', content: [{ type: 'text', text: 'Confirm and it\'s in.' }, { type: 'tool_use', id: 'toolu_1', name: 'add_late_pouch', input: proposals[0].input }] },
      { role: 'user', content: results },
    ]);
  });
  it('a coach turn with no words is tool_use blocks alone', () => {
    expect(toTurns([{ role: 'assistant', text: '', proposals }])[0].content.map((b) => b.type)).toEqual(['tool_use']);
  });
  it('a typed turn that answers pending cards leads with the tool_results, then the text', () => {
    const skipped = [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'skipped by the user' }];
    expect(toTurns([{ role: 'user', text: 'never mind', results: skipped }])).toEqual([
      { role: 'user', content: [...skipped, { type: 'text', text: 'never mind' }] },
    ]);
  });
  it('a tool name the app does not have is never replayed, and neither is its result', () => {
    // The proxy refuses any request that names a tool outside its list, so
    // replaying an invented name would refuse every later turn of this chat.
    const mixed = [...proposals, { id: 'toolu_2', name: 'update_settings', input: {} }];
    const answered = [...results, { type: 'tool_result', tool_use_id: 'toolu_2', content: "invalid: the app doesn't have that action", is_error: true }];
    expect(toTurns([
      { role: 'assistant', text: 'Two things.', proposals: mixed },
      { role: 'user', text: 'Confirmed: …', results: answered, auto: true },
    ])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Two things.' }, { type: 'tool_use', id: 'toolu_1', name: 'add_late_pouch', input: proposals[0].input }] },
      { role: 'user', content: results },
    ]);
  });
  it('when nothing is left to replay, the coach turn is an ellipsis and the answer is its words', () => {
    const only = [{ id: 'toolu_2', name: 'drop_table', input: {} }];
    const answered = [{ type: 'tool_result', tool_use_id: 'toolu_2', content: "invalid: the app doesn't have that action", is_error: true }];
    expect(toTurns([
      { role: 'assistant', text: '', proposals: only },
      { role: 'user', text: "Couldn't be done: An action the app doesn't have (the app doesn't have that action)", results: answered, auto: true },
      { role: 'assistant', text: 'Got it.' },
      { role: 'user', text: 'ok', results: answered },
    ])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: '…' }] },
      { role: 'user', content: "Couldn't be done: An action the app doesn't have (the app doesn't have that action)" },
      { role: 'assistant', content: 'Got it.' },
      { role: 'user', content: 'ok' },
    ]);
  });
  it('a typed answer whose only results were dropped is its text alone', () => {
    const only = [{ id: 'toolu_2', name: 'drop_table', input: {} }];
    const answered = [{ type: 'tool_result', tool_use_id: 'toolu_2', content: "invalid: the app doesn't have that action", is_error: true }];
    expect(toTurns([{ role: 'assistant', text: 'Hm.', proposals: only }, { role: 'user', text: 'never mind', results: answered }])).toEqual([
      { role: 'assistant', content: [{ type: 'text', text: 'Hm.' }] },
      { role: 'user', content: 'never mind' },
    ]);
  });
  it('a runaway tool input is replayed empty, so the proxy never refuses the history', () => {
    const big = [{ id: 'toolu_9', name: 'add_late_pouch', input: { note: 'x'.repeat(5000) } }];
    expect(toTurns([{ role: 'assistant', text: 'ok', proposals: big }])[0].content[1].input).toEqual({});
  });
});

describe('the saved chat\'s record', () => {
  const cards = [
    { toolUseId: 'a', name: 'add_late_pouch', status: 'saved', action: { summary: 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom' } },
    { toolUseId: 'b', name: 'mark_mistake', status: 'skipped', action: { summary: 'Mark as mistake · the 2:14 PM pouch on Thu Oct 1' } },
    { toolUseId: 'c', name: 'fill_missed_day', status: 'refused', reason: REFUSED, action: { summary: 'Fill in Tue Sep 29 · 7 pouches · streak kept' } },
    { toolUseId: 'd', name: 'drop_table', status: 'invalid', reason: "the app doesn't have that action" },
    { toolUseId: 'e', name: 'log_checkin', status: 'pending', action: { summary: 'Morning check-in · 6.5h' } },
  ];
  it('actionsOf names each proposal in the app\'s words; an unknown tool is "unknown"', () => {
    expect(actionsOf(cards).map((a) => a.name)).toEqual(['add_late_pouch', 'mark_mistake', 'fill_missed_day', 'unknown', 'log_checkin']);
    expect(actionsOf(cards)[3].summary).toBe("An action the app doesn't have");
  });
  it('a tool named like a property of every object is still unknown, in words', () => {
    const odd = [{ toolUseId: 'z', name: 'constructor', status: 'invalid', reason: "the app doesn't have that action" }];
    expect(actionsOf(odd)).toEqual([{ name: 'unknown', summary: "An action the app doesn't have" }]);
  });
  it('outcomesOf: a still-pending card counts as skipped; reasons ride only on refused and invalid', () => {
    expect(outcomesOf(cards).map((o) => [o.outcome, o.reason ?? null])).toEqual([
      ['saved', null], ['skipped', null], ['refused', REFUSED], ['invalid', "the app doesn't have that action"], ['skipped', null],
    ]);
  });
  it('renderOutcomes reads as one line', () => {
    expect(renderOutcomes(outcomesOf(cards.slice(0, 3)))).toBe(
      `Confirmed: Add a pouch · Thu Oct 1 · 4:30 PM · boredom / Skipped: Mark as mistake · the 2:14 PM pouch on Thu Oct 1 / Didn't save: Fill in Tue Sep 29 · 7 pouches · streak kept (${REFUSED})`,
    );
  });
});

describe('every reason a card can show is in a person\'s words', () => {
  it('no underscores, no code words, and no reason opens on a schema field name', () => {
    const fields = new Set(TOOLS.flatMap((t) => Object.keys(t.input_schema.properties)));
    const L = attempt([...S.events, ev('pouch', '2026-09-29', { ts: '2026-09-29T15:00:00.000Z' })]);
    const done = attempt([], { plan: generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-30', mealTimes: settings.mealTimes }) });
    const tap = ev('pouch', '2026-09-29');
    const voided = attempt([tap, { ...ev('void', '2026-09-29'), target: tap.id }]);
    const late = { day: TODAY, time: '16:30', triggers: [], note: '' };
    const runs = [
      [S, { name: 'log_pouch_now', input: {} }],
      [S, call('drop_table', {})],
      [{ ...S, status: 'archived' }, call('log_pouch_now', {})],
      [S, call('log_pouch_now', [])],
      [S, call('log_pouch_now', { ts: 1 })],
      [S, call('log_pouch_now', { trigger: 'rage' })],
      ...['day', 'time', 'triggers', 'note'].map((k) => [S, call('add_late_pouch', Object.fromEntries(Object.entries(late).filter(([f]) => f !== k)))]),
      [S, call('mark_mistake', {})], [S, call('fill_missed_day', { day: '2026-09-29', count: 1 })],
      [S, call('add_late_pouch', { ...late, day: 'x' })],
      [S, call('add_late_pouch', { ...late, day: '2026-09-01' })],
      [S, call('add_late_pouch', { ...late, day: '2026-10-09' })],
      [S, call('add_late_pouch', { ...late, triggers: 'stress' })],
      [S, call('add_late_pouch', { ...late, triggers: ['after-meal', 'coffee', 'driving', 'stress', 'boredom', 'social', 'coffee'] })],
      [S, call('add_late_pouch', { ...late, triggers: ['rage'] })],
      [S, call('add_late_pouch', { ...late, triggers: ['stress', 'stress'] })],
      [S, call('add_late_pouch', { ...late, note: 1 })],
      [S, call('add_late_pouch', { ...late, note: 'x'.repeat(141) })],
      [S, call('add_late_pouch', { ...late, note: 'a\nb' })],
      [S, call('add_late_pouch', { ...late, time: 1630 })],
      [S, call('add_late_pouch', { ...late, time: '23:59' })],
      [S, call('mark_mistake', { pouch_id: 'nope' })],
      [S, call('add_reason', { pouch_id: P.id, triggers: [], note: '' })],
      [S, call('fill_missed_day', { day: '2026-09-29', count: 1, streak: 'maybe' })],
      [S, call('fill_missed_day', { day: '2026-09-29', count: -1, streak: 'keep' })],
      [S, call('fill_missed_day', { day: TODAY, count: 1, streak: 'keep' })],
      [done, call('fill_missed_day', { day: '2026-09-30', count: 1, streak: 'keep' })],
      [L, call('fill_missed_day', { day: '2026-09-29', count: 1, streak: 'keep' })],
      [voided, call('fill_missed_day', { day: '2026-09-29', count: 0, streak: 'keep' })],
      [S, call('correct_day_total', { day: '2026-09-29', count: 5 })],
      [L, call('correct_day_total', { day: '2026-09-29', count: 0 })],
      [S, call('log_checkin', {})],
      [S, call('log_checkin', { sleep_hours: 6.55 })],
      [S, call('log_checkin', { sleep_quality: 9 })],
      [S, call('log_checkin', { workout: 'yes' })],
    ];
    const reasons = new Set(runs.map(([state, p]) => validateProposal(state, p, NOW)).filter((r) => !r.ok).map((r) => r.reason));
    // Every run a different reason, except the two unknown triggers, which share one.
    expect(reasons.size).toBe(runs.length - 1);
    for (const r of reasons) {
      expect(r).not.toMatch(/_|HH:MM|\bnull\b|\btrue\b|\bfalse\b|Day 1/);
      expect(fields.has(r.split(' ')[0])).toBe(false);
    }
  });
});
