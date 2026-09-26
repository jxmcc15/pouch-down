// The correction, reason and chat api, driven through the REAL updaters in
// state.jsx, in Node, with no DOM. Same tiny synchronous hook runtime as
// state-guards.test.js: setters apply functional updaters in call order, which
// is what React's queue does, and effects run right after their render.
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
const { pouchesForDay, triggersFor } = await import('../store.js');

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
const chats = () => app().state.chats;

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

describe('logCorrection — the real total for a logged past day', () => {
  let four;
  beforeEach(() => {
    four = [1, 2, 3, 4].map(() => ev('pouch', Y));
    seed(withEvents([...four, ev('resisted', '2026-09-22'), ev('checkin', '2026-09-21')]));
  });

  it('appends exactly one correction event with the right shape', () => {
    const id = app().api.logCorrection({ day: Y, count: 10 });
    expect(typeof id).toBe('string');
    const added = events().slice(4 + 2);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ id, type: 'correction', day: Y, count: 10 });
    expect(typeof added[0].ts).toBe('string');
    expect(typeof added[0].tzOffsetMin).toBe('number');
    expect(pouchesForDay(app().state, Y)).toBe(10);
  });

  it('a count equal to the timed count is allowed; a resisted-only day can be corrected', () => {
    expect(app().api.logCorrection({ day: Y, count: 4 })).not.toBeNull();
    expect(app().api.logCorrection({ day: '2026-09-22', count: 3 })).not.toBeNull();
    expect(events().filter((e) => e.type === 'correction')).toHaveLength(2);
  });

  it.each([
    ['no input', undefined],
    ['day not a string', { day: 20260923, count: 10 }],
    ['day badly formatted', { day: '2026-9-23', count: 10 }],
    ['today', { day: '2026-09-24', count: 10 }],
    ['the future', { day: '2026-09-25', count: 10 }],
    ['before the plan', { day: '2026-08-31', count: 10 }],
    ['an unlogged day', { day: '2026-09-20', count: 10 }],
    ['a check-in-only day (not logged)', { day: '2026-09-21', count: 10 }],
    ['count below the timed count', { day: Y, count: 3 }],
    ['count negative', { day: Y, count: -1 }],
    ['count fractional', { day: Y, count: 10.5 }],
    ['count a string', { day: Y, count: '10' }],
  ])('%s → null, nothing appended', (_, input) => {
    const before = events().length;
    expect(app().api.logCorrection(input)).toBeNull();
    expect(events()).toHaveLength(before);
  });
});

describe('logReason — why a pouch happened, any time after', () => {
  let p;
  beforeEach(() => {
    p = ev('pouch', Y, { trigger: 'coffee' });
    seed(withEvents([p, ev('resisted', Y, { trigger: 'stress' })]));
  });

  it('appends one reason on the pouch\'s day, triggers deduped, note trimmed to 140', () => {
    const id = app().api.logReason({ target: p.id, triggers: ['stress', 'coffee', 'stress'], note: `  ${'x'.repeat(200)}  ` });
    expect(typeof id).toBe('string');
    const r = events()[2];
    expect(events()).toHaveLength(3);
    expect(r).toMatchObject({ id, type: 'reason', target: p.id, day: Y, triggers: ['stress', 'coffee'] });
    expect(r.note).toBe('x'.repeat(140));
    expect(triggersFor(app().state, p)).toEqual(['stress', 'coffee']);
  });

  it('a note alone is enough; so are triggers alone', () => {
    expect(app().api.logReason({ target: p.id, note: 'late meeting' })).not.toBeNull();
    expect(app().api.logReason({ target: p.id, triggers: ['boredom'] })).not.toBeNull();
    expect(events().filter((e) => e.type === 'reason').map((e) => [e.triggers, e.note])).toEqual([[[], 'late meeting'], [['boredom'], '']]);
  });

  it('today\'s pouch can take a reason once the tag window has passed', () => {
    const id = app().api.logPouch();
    at(T0 + 60 * 60000);
    expect(app().api.logReason({ target: id, triggers: ['driving'] })).not.toBeNull();
    expect(events().at(-1)).toMatchObject({ type: 'reason', target: id, day: '2026-09-24' });
  });

  it.each([
    ['no input', () => undefined],
    ['unknown target', () => ({ target: 'nope', triggers: ['stress'] })],
    ['target is a resisted event', () => ({ target: 's_resisted', triggers: ['stress'] })],
    ['triggers not an array', () => ({ target: p.id, triggers: 'stress' })],
    ['a trigger not on the list', () => ({ target: p.id, triggers: ['stress', 'rage'] })],
    ['note not a string', () => ({ target: p.id, triggers: ['stress'], note: 5 })],
    ['nothing to say', () => ({ target: p.id, triggers: [], note: '   ' })],
  ])('%s → null, nothing appended', (_, input) => {
    const resisted = events()[1].id;
    const arg = input();
    if (arg && arg.target === 's_resisted') arg.target = resisted;
    const before = events().length;
    expect(app().api.logReason(arg)).toBeNull();
    expect(events()).toHaveLength(before);
  });
});

describe('appendChatTurn — coach chats saved with the attempt', () => {
  beforeEach(() => seed(withEvents([])));

  it('a fresh attempt starts with no chats', () => expect(chats()).toEqual([]));

  it('the first turn creates a chat and returns its id; the next appends to it', () => {
    const id = app().api.appendChatTurn(null, { user: 'how am I doing?', assistant: 'Steady so far.' });
    expect(typeof id).toBe('string');
    expect(chats()).toHaveLength(1);
    expect(chats()[0]).toMatchObject({ id, startedAt: new Date(T0).toISOString(), day: '2026-09-24' });
    expect(chats()[0].messages).toEqual([
      { role: 'user', text: 'how am I doing?', ts: new Date(T0).toISOString() },
      { role: 'assistant', text: 'Steady so far.', ts: new Date(T0).toISOString() },
    ]);
    at(T0 + 60000);
    expect(app().api.appendChatTurn(id, { user: 'and tomorrow?', assistant: 'Same cap.' })).toBe(id);
    expect(chats()).toHaveLength(1);
    expect(chats()[0].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(chats()[0].messages[2].ts).toBe(new Date(T0 + 60000).toISOString());
  });

  it('an unknown chat id starts a new chat', () => {
    const a = app().api.appendChatTurn(null, { user: 'hi', assistant: 'hello' });
    const b = app().api.appendChatTurn('gone', { user: 'hi again', assistant: 'hello again' });
    expect(b).not.toBe(a);
    expect(b).not.toBe('gone');
    expect(chats().map((c) => c.id)).toEqual([a, b]);
  });

  it('texts are trimmed to 4000 characters', () => {
    app().api.appendChatTurn(null, { user: 'u'.repeat(5000), assistant: ' a ' });
    expect(chats()[0].messages[0].text).toHaveLength(4000);
    expect(chats()[0].messages[1].text).toBe('a');
  });

  it.each([
    ['no turn', undefined],
    ['user not a string', { user: 5, assistant: 'x' }],
    ['assistant missing', { user: 'x' }],
  ])('%s → null, nothing stored', (_, turn) => {
    expect(app().api.appendChatTurn(null, turn)).toBeNull();
    expect(chats()).toEqual([]);
  });

  it('writes nothing to events', () => {
    app().api.appendChatTurn(null, { user: 'hi', assistant: 'hello' });
    expect(events()).toEqual([]);
  });
});

describe('read-only and unreadable storage: every new mutation is a no-op returning null', () => {
  it('while viewing a past attempt', () => {
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-08-31T12:00:00Z' });
    const p = ev('pouch', Y);
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [p] }));
    r = archiveActive(r, '2026-09-24T12:00:00Z');
    seed(r);
    app().api.viewAttempt('a1');
    expect(app().readOnly).toBe(true);
    expect(app().api.logCorrection({ day: Y, count: 9 })).toBeNull();
    expect(app().api.logReason({ target: p.id, triggers: ['stress'] })).toBeNull();
    expect(app().api.appendChatTurn(null, { user: 'hi', assistant: 'hello' })).toBeNull();
    expect(app().state.events).toHaveLength(1);
    expect(app().state.chats).toEqual([]);
  });

  it('while storage is unreadable', () => {
    store.set(KEY_V2, '{not json');
    expect(app().problem).toBe('corrupt');
    expect(app().api.logCorrection({ day: Y, count: 9 })).toBeNull();
    expect(app().api.appendChatTurn(null, { user: 'hi', assistant: 'hello' })).toBeNull();
    expect(store.get(KEY_V2)).toBe('{not json');
  });

  it('a pouch in another (archived) attempt is not a valid target', () => {
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-08-31T12:00:00Z' });
    const old = ev('pouch', Y);
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [old] }));
    r = archiveActive(r, '2026-09-24T12:00:00Z');
    seed(startAttempt(r, { plan: { ...plan }, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-24T13:00:00Z' }));
    expect(app().api.logReason({ target: old.id, triggers: ['stress'] })).toBeNull();
    expect(app().state.events).toEqual([]);
  });
});
