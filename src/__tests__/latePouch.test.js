// latePouch.js on its own, then logLatePouch and voidPouch driven through the
// REAL updaters in state.jsx, in Node, with no DOM. The hook runtime is copied
// from corrections.test.js (a shared helper can't host vi.mock): setters apply
// functional updaters in call order, which is what React's queue does, and
// effects run right after their render.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fake = vi.hoisted(() => {
  // Some components read the URL at import time; give them a blank page.
  globalThis.window ??= { location: { pathname: '/', search: '' }, history: { replaceState() {} } };
  let comps = new Map();
  let cur = null;
  let ctxValue = null;
  return {
    reset() { comps = new Map(); ctxValue = null; },
    provide(v) { ctxValue = v; },
    render(Comp, props = {}) {
      if (!comps.has(Comp)) comps.set(Comp, { slots: [], deps: [] });
      const rec = comps.get(Comp);
      const prev = cur;
      const frame = { rec, i: 0, effects: [] };
      cur = frame;
      let out;
      try { out = Comp(props); } finally { cur = prev; }
      for (const [i, fn, deps] of frame.effects) {
        const p = rec.deps[i];
        if (!p || !deps || deps.some((d, k) => d !== p[k])) { rec.deps[i] = deps; fn(); }
      }
      return out;
    },
    useState(init) {
      const { rec } = cur; const i = cur.i++;
      if (!(i in rec.slots)) rec.slots[i] = typeof init === 'function' ? init() : init;
      return [rec.slots[i], (v) => { rec.slots[i] = typeof v === 'function' ? v(rec.slots[i]) : v; }];
    },
    useMemo(fn) { const { rec } = cur; const i = cur.i++; if (!(i in rec.slots)) rec.slots[i] = fn(); return rec.slots[i]; },
    useEffect(fn, deps) { cur.effects.push([cur.i++, fn, deps]); },
    useContext() { return ctxValue; },
  };
});

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal()),
  useState: fake.useState,
  useMemo: fake.useMemo,
  useEffect: fake.useEffect,
  useContext: fake.useContext,
}));

const { AppStateProvider } = await import('../state.jsx');
const { KEY_V2, DEFAULT_SETTINGS, freshRoot, startAttempt, archiveActive, updateAttempt } = await import('../root.js');
const { generatePlan } = await import('../planGenerator.js');
const { pouchesForDay, triggersFor, isVoided, statusForDay } = await import('../store.js');
const { lateInstant, resolveLate, fmtHM } = await import('../latePouch.js');
const { dayKeyAt } = await import('../time.js');

// 30-day plan: day 1 = 2026-09-01. "Now" is 2026-09-24 10am CT (day 24).
const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-01', mealTimes: DEFAULT_SETTINGS.mealTimes });
const T0 = Date.parse('2026-09-24T15:00:00Z');
const Y = '2026-09-23';

let store;
let seq = 0;
const at = (ms) => vi.setSystemTime(new Date(ms));
const app = () => fake.render(AppStateProvider, { children: null }).props.value;
const seed = (root) => store.set(KEY_V2, JSON.stringify(root));
const ev = (type, day, extra = {}) => ({ id: `s${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const withEvents = (evs) => {
  const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-08-31T12:00:00Z' });
  return updateAttempt(r, r.activeAttemptId, (a) => ({ ...a, events: evs }));
};
const events = () => app().state.events;

beforeEach(() => {
  fake.reset();
  store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  vi.useFakeTimers();
  at(T0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('lateInstant — the 4am rule meets a time picker (America/Chicago)', () => {
  it('an afternoon time is that calendar date', () => {
    const r = lateInstant('2026-09-23', '16:30');
    expect(new Date(r.ms).toISOString()).toBe('2026-09-23T21:30:00.000Z');
    expect(r.tzOffsetMin).toBe(-300);
    expect(r.nextCalendarDay).toBe(false);
    expect(dayKeyAt(r.ms, r.tzOffsetMin)).toBe('2026-09-23');
  });
  it('01:30 on app day D is calendar D+1, and dayKeyAt still says D', () => {
    const r = lateInstant('2026-09-23', '01:30');
    expect(new Date(r.ms).toISOString()).toBe('2026-09-24T06:30:00.000Z');
    expect(r.nextCalendarDay).toBe(true);
    expect(dayKeyAt(r.ms, r.tzOffsetMin)).toBe('2026-09-23');
  });
  it('03:59 is still D; 04:00 is D itself', () => {
    expect(dayKeyAt(lateInstant('2026-09-23', '03:59').ms, -300)).toBe('2026-09-23');
    expect(new Date(lateInstant('2026-09-23', '04:00').ms).toISOString()).toBe('2026-09-23T09:00:00.000Z');
  });
  it('the 4am rule rolls over a month end', () => {
    expect(new Date(lateInstant('2026-09-30', '02:00').ms).toISOString()).toBe('2026-10-01T07:00:00.000Z');
  });
  it('refuses malformed input', () => {
    for (const [d, t] of [['2026-9-23', '12:00'], ['2026-09-23', '24:00'], ['2026-09-23', '7:00'], ['2026-09-23', null], [null, '12:00'], ['2026-09-23', '12:60']]) expect(lateInstant(d, t)).toBeNull();
  });
  it('refuses a day the calendar does not have (Date would roll it over)', () => {
    for (const d of ['2026-09-31', '2026-02-29', '2026-13-01', '2026-00-10', '0026-09-23']) expect(lateInstant(d, '12:00')).toBeNull();
  });
});

describe('resolveLate', () => {
  const now = Date.parse('2026-09-24T15:00:00Z'); // 10:00 CDT
  it('a time later than now on today is future', () => {
    expect(resolveLate({ day: '2026-09-24', time: '10:30', now }).future).toBe(true);
    expect(resolveLate({ day: '2026-09-24', time: '09:30', now }).future).toBe(false);
  });
  it('a few seconds ahead is clock skew, not the future', () => {
    expect(resolveLate({ day: '2026-09-24', time: '10:00', now: now - 4000 }).future).toBe(false);
  });
  it('unknown time resolves to now, never future', () => {
    expect(resolveLate({ day: '2026-09-23', time: null, now })).toEqual({ ok: true, ms: now, tzOffsetMin: -300, future: false, nextCalendarDay: false });
  });
  it('malformed is not ok', () => {
    expect(resolveLate({ day: '2026-09-23', time: 'noon', now }).ok).toBe(false);
    expect(resolveLate({ day: 'yesterday', time: null, now }).ok).toBe(false);
    expect(resolveLate({ day: '2026-09-31', time: null, now }).ok).toBe(false);
  });
});

describe('fmtHM', () => {
  it('reads like a clock', () => {
    expect(fmtHM('16:30')).toBe('4:30 PM'); expect(fmtHM('00:05')).toBe('12:05 AM'); expect(fmtHM('12:00')).toBe('12:00 PM'); expect(fmtHM('x')).toBe('');
  });
});

describe('api.logLatePouch', () => {
  const p = (day, extra = {}) => ev('pouch', day, extra);
  beforeEach(() => seed(withEvents([p(Y), p(Y)])));

  it('appends a timed pouch stamped with the chosen day and time, ctx null, late, enteredAt now', () => {
    const id = app().api.logLatePouch({ day: Y, time: '16:30' });
    expect(id).toEqual(expect.any(String));
    const last = events().at(-1);
    expect(last).toMatchObject({ id, type: 'pouch', day: Y, ts: '2026-09-23T21:30:00.000Z', tzOffsetMin: -300, ctx: null, late: true, enteredAt: new Date(T0).toISOString(), trigger: null });
    expect(last.timeKnown).toBeUndefined();
    expect(pouchesForDay(app().state, Y)).toBe(3);
  });
  it('the 4am rule: 01:30 on app day D stamps calendar D+1 and still buckets on D', () => {
    app().api.logLatePouch({ day: Y, time: '01:30' });
    const last = events().at(-1);
    expect(last.ts).toBe('2026-09-24T06:30:00.000Z');
    expect(last.day).toBe(Y);
    expect(pouchesForDay(app().state, Y)).toBe(3);
    expect(pouchesForDay(app().state, '2026-09-24')).toBe(0);
  });
  it('unknown time: ts === enteredAt, timeKnown false, day as chosen', () => {
    app().api.logLatePouch({ day: Y, time: null });
    const last = events().at(-1);
    expect(last).toMatchObject({ day: Y, timeKnown: false, late: true, ts: new Date(T0).toISOString(), enteredAt: new Date(T0).toISOString() });
  });
  it('reasons produce a second event ordered BEFORE the pouch, targeting it', () => {
    const id = app().api.logLatePouch({ day: Y, time: '16:30', triggers: ['boredom', 'boredom'], note: '  late meeting  ' });
    const [reason, pouch] = events().slice(-2);
    expect(pouch.id).toBe(id);
    expect(reason).toMatchObject({ type: 'reason', target: id, day: Y, triggers: ['boredom'], note: 'late meeting' });
    expect(triggersFor(app().state, pouch)).toEqual(['boredom']);
  });
  it('no reason event when triggers and note are empty', () => {
    const before = events().length;
    app().api.logLatePouch({ day: Y, time: '16:30' });
    expect(events().length).toBe(before + 1);
  });
  it('undo removes only the pouch; the reason stays, harmless', () => {
    const id = app().api.logLatePouch({ day: Y, time: '16:30', triggers: ['stress'] });
    app().api.undoEvent(id);
    expect(events().at(-1).type).toBe('reason');
    expect(pouchesForDay(app().state, Y)).toBe(2);
  });
  it('today is allowed; a past time today is fine; a future time today is refused', () => {
    expect(app().api.logLatePouch({ day: '2026-09-24', time: '09:30' })).toEqual(expect.any(String));
    expect(app().api.logLatePouch({ day: '2026-09-24', time: '10:30' })).toBeNull();
  });
  it('a nolog past day becomes logged by a remembered pouch', () => {
    const D = '2026-09-20';
    expect(statusForDay(app().state, D)).toBe('nolog');
    app().api.logLatePouch({ day: D, time: null });
    expect(statusForDay(app().state, D)).toBe('green');
  });
  it('refuses: bad day string, pre-plan day, future day, bad time, bad triggers, non-string note', () => {
    const before = events().length;
    for (const input of [
      { day: 'yesterday', time: '12:00' }, { day: '2026-08-31', time: '12:00' }, { day: '2026-09-25', time: '12:00' },
      { day: Y, time: '7:00' }, { day: Y, time: 'noon' }, { day: Y, time: '12:00', triggers: ['rage'] }, { day: Y, time: '12:00', note: 7 },
    ]) expect(app().api.logLatePouch(input)).toBeNull();
    expect(events().length).toBe(before);
  });
  it('a day past quit day is allowed (the still-free check-in must not be blocked)', () => {
    at(Date.parse('2026-10-05T15:00:00Z')); // day 35 of a 30-day plan
    expect(app().api.logLatePouch({ day: '2026-10-02', time: null })).toEqual(expect.any(String));
  });
  it('refuses a day the calendar does not have, even with the time unknown', () => {
    at(Date.parse('2026-10-05T15:00:00Z')); // so '2026-09-31' sorts before today
    const before = events().length;
    expect(app().api.logLatePouch({ day: '2026-09-31', time: null })).toBeNull();
    expect(events().length).toBe(before);
  });
  it('read-only attempt refuses', () => {
    seed(archiveActive(withEvents([p(Y)])));
    expect(app().api.logLatePouch({ day: Y, time: '12:00' })).toBeNull();
  });
});

describe('api.voidPouch', () => {
  const p1 = ev('pouch', Y), p2 = ev('pouch', Y), r1 = ev('resisted', Y);
  beforeEach(() => seed(withEvents([p1, p2, r1])));

  it('appends a void naming the pouch, filed under the pouch day; the pouch stops counting', () => {
    const id = app().api.voidPouch(p1.id);
    const last = events().at(-1);
    expect(last).toMatchObject({ id, type: 'void', target: p1.id, day: Y, tzOffsetMin: -300, trigger: null });
    expect(events().find((e) => e.id === p1.id)).toEqual(p1); // untouched
    expect(isVoided(app().state, p1)).toBe(true);
    expect(pouchesForDay(app().state, Y)).toBe(1);
  });
  it('refuses an unknown id, a resisted id, and an already-voided id', () => {
    expect(app().api.voidPouch('nope')).toBeNull();
    expect(app().api.voidPouch(r1.id)).toBeNull();
    expect(app().api.voidPouch(p1.id)).toEqual(expect.any(String));
    expect(app().api.voidPouch(p1.id)).toBeNull();
    expect(events().filter((e) => e.type === 'void')).toHaveLength(1);
  });
  it('undo inside the window removes the void; outside it, the void stays', () => {
    const v = app().api.voidPouch(p1.id);
    app().api.undoEvent(v);
    expect(isVoided(app().state, p1)).toBe(false);
    const v2 = app().api.voidPouch(p1.id);
    at(T0 + 16000);
    app().api.undoEvent(v2);
    expect(isVoided(app().state, p1)).toBe(true);
  });
  it('voiding the only pouch of a day makes it nolog, not green', () => {
    const D = '2026-09-22';
    const only = ev('pouch', D);
    seed(withEvents([only]));
    app().api.voidPouch(only.id);
    expect(statusForDay(app().state, D)).toBe('nolog');
  });
  it('read-only attempt refuses', () => {
    seed(archiveActive(withEvents([p1])));
    expect(app().api.voidPouch(p1.id)).toBeNull();
  });
});
