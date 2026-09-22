// Drives the REAL api updaters in state.jsx and the real app-shell components
// in App.jsx, in Node, with no DOM. React's hooks are swapped for a tiny
// synchronous runtime: state setters apply functional updaters in call order,
// which is what React's queue does for functional updates, and effects run
// right after the render that scheduled them.
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
const { UNDO_WINDOW_MS, TAG_WINDOW_MS } = await import('../justLogged.js');
const { CheckinDeepLink, AppContent } = await import('../App.jsx');
const { KEY_V2, DEFAULT_SETTINGS, freshRoot, startAttempt, archiveActive, updateAttempt } = await import('../root.js');
const { generatePlan } = await import('../planGenerator.js');
const { todayKey } = await import('../store.js');
const { localOffsetMin, dayKeyAt } = await import('../time.js');

// 30-day plan: day 1 = 2026-09-01, quit day (day 30) = 2026-09-30.
const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-01', mealTimes: DEFAULT_SETTINGS.mealTimes });
const T0 = Date.parse('2026-09-24T15:00:00Z');

let store;
const at = (ms) => vi.setSystemTime(new Date(ms));
const app = () => fake.render(AppStateProvider, { children: null }).props.value;
const seed = (root) => store.set(KEY_V2, JSON.stringify(root));
const withActive = () => startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-08-31T12:00:00Z' });
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

describe('undoEvent — only the just-logged event', () => {
  beforeEach(() => seed(withActive()));

  it('the window covers the 12 s toast and stays within 15 s', () => {
    expect(UNDO_WINDOW_MS).toBeGreaterThanOrEqual(12000);
    expect(UNDO_WINDOW_MS).toBeLessThanOrEqual(15000);
  });

  it('undoes a pouch logged moments ago', () => {
    const id = app().api.logPouch();
    at(T0 + 10000);
    app().api.undoEvent(id);
    expect(events()).toHaveLength(0);
  });

  it('undoes a just-logged resisted too — the rule is "just logged", not "pouch"', () => {
    const id = app().api.logResisted('stress');
    at(T0 + 5000);
    app().api.undoEvent(id);
    expect(events()).toHaveLength(0);
  });

  it('refuses once the window has passed (the toast outlived a locked phone)', () => {
    const id = app().api.logPouch();
    at(T0 + UNDO_WINDOW_MS + 1);
    app().api.undoEvent(id);
    expect(events().map((e) => e.id)).toEqual([id]);
    at(T0 + 90 * 60000);
    app().api.undoEvent(id);
    expect(events().map((e) => e.id)).toEqual([id]);
  });

  it('refuses when the clock was set back after logging', () => {
    const id = app().api.logPouch();
    at(T0 - 60000);
    app().api.undoEvent(id);
    expect(events().map((e) => e.id)).toEqual([id]);
  });

  it('tolerates a few seconds of clock jitter', () => {
    const id = app().api.logPouch();
    at(T0 - 3000);
    app().api.undoEvent(id);
    expect(events()).toHaveLength(0);
  });
});

describe('tagEvent — completing the just-made log', () => {
  beforeEach(() => seed(withActive()));

  it('tags a pouch logged moments ago', () => {
    const id = app().api.logPouch();
    at(T0 + 5000);
    app().api.tagEvent(id, 'coffee');
    expect(events()[0].trigger).toBe('coffee');
  });

  it('refuses after the window', () => {
    const id = app().api.logPouch();
    at(T0 + TAG_WINDOW_MS + 1);
    app().api.tagEvent(id, 'coffee');
    expect(events()[0].trigger).toBeNull();
  });

  it('refuses when the clock was set back after logging', () => {
    const id = app().api.logPouch();
    at(T0 - 60 * 60000);
    app().api.tagEvent(id, 'driving');
    expect(events()[0].trigger).toBeNull();
  });
});

describe('logBackfill — in-plan days only', () => {
  beforeEach(() => { seed(withActive()); at(Date.parse('2026-10-05T15:00:00Z')); });

  it('rejects a day after the plan’s last day', () => {
    app().api.logBackfill({ day: '2026-10-01', count: 0, streak: 'keep' }); // day 31 of 30
    expect(events()).toHaveLength(0);
  });

  it('still accepts the last day itself', () => {
    app().api.logBackfill({ day: '2026-09-30', count: 0, streak: 'keep' }); // quit day
    expect(events().map((e) => e.day)).toEqual(['2026-09-30']);
  });
});

// ---- App shell ----------------------------------------------------------------

function setUrl(search) {
  const loc = { pathname: '/pouch-down/', search };
  const history = {
    replaceState: vi.fn((_s, _t, url) => { const q = url.indexOf('?'); loc.search = q < 0 ? '' : url.slice(q); }),
  };
  vi.stubGlobal('window', { location: loc, history });
  return loc;
}
function openLink() {
  fake.provide(app());
  fake.render(CheckinDeepLink);
}
const checkins = () => events().filter((e) => e.type === 'checkin');

describe('?checkin= deep link', () => {
  it('records one shortcut check-in and strips the param', () => {
    seed(withActive());
    const loc = setUrl('?static&checkin=hours:7.4,workout:1');
    openLink();
    expect(checkins()).toMatchObject([{ source: 'shortcut', sleepHours: 7.4, workout: true }]);
    const left = new URLSearchParams(loc.search);
    expect([left.has('checkin'), left.has('static')]).toEqual([false, true]);
  });

  it('with no active attempt: strips the param anyway and records nothing', () => {
    const loc = setUrl('?checkin=hours:7');
    openLink();
    expect(loc.search).toBe('');
    expect(app().root.attempts).toHaveLength(0);
  });

  it('dedupes on the day the check-in was stamped with, not today’s zone', () => {
    // A shortcut check-in stamped today, but logged somewhere so far away that
    // reading its timestamp in this device's zone lands on another day. The
    // offset is exaggerated so the test holds in any device zone.
    const ts = T0 - 28 * 3600000;
    const tzOffsetMin = localOffsetMin(new Date(T0)) + 28 * 60;
    const today = todayKey();
    expect(dayKeyAt(ts, tzOffsetMin)).toBe(today);
    const prior = { id: 'c1', type: 'checkin', trigger: null, source: 'shortcut', sleepHours: 6, ts: new Date(ts).toISOString(), tzOffsetMin, day: today };
    seed(updateAttempt(withActive(), 'a1', (a) => ({ ...a, events: [prior] })));
    setUrl('?checkin=hours:7');
    openLink();
    expect(checkins().map((e) => e.id)).toEqual(['c1']);
  });
});

function findAll(node, pred, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (!node || typeof node !== 'object' || !node.props) return out;
  if (pred(node.props)) out.push(node);
  findAll(node.props.children, pred, out);
  return out;
}
const coachButtons = () => {
  fake.provide(app());
  return findAll(fake.render(AppContent), (p) => p['aria-label'] === 'AI coach');
};

describe('coach button', () => {
  beforeEach(() => {
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-08-31T12:00:00Z' });
    r = archiveActive(r, '2026-09-10T12:00:00Z');
    seed(startAttempt(r, { plan: { ...plan }, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-11T12:00:00Z' }));
  });

  it('shows on the active attempt', () => {
    expect(coachButtons()).toHaveLength(1);
  });

  it('is hidden while viewing a past attempt read-only', () => {
    app().api.viewAttempt('a1');
    expect(app().readOnly).toBe(true);
    expect(coachButtons()).toHaveLength(0);
  });
});
