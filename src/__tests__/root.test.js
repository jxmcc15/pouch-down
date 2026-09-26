import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KEY_V1, KEY_V2, DEFAULT_SETTINGS, freshRoot, loadRoot, saveRoot, startAttempt, archiveActive, updateAttempt, attemptById, lastSettings, preserveCorruptV2, freshStartRoot, rawStorageDump, redactSecrets } from '../root.js';
import { generatePlan } from '../planGenerator.js';
import { getKey, setKey, clearKey } from '../sessionKey.js';
import { todayKey } from '../store.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), _m: m }; };
const NOW = '2026-09-20T18:00:00.000Z';
const V1 = JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-ant-TEST' }, events: [{ id: 'e1', ts: '2026-07-08T11:42:07.123Z', type: 'pouch', trigger: null }], celebratedStages: [1], checkinDismissedFor: null });
const attemptShape = (id) => ({ id, status: 'archived', createdAt: NOW, archivedAt: NOW, settings: DEFAULT_SETTINGS, plan: { generator: 'gen-1', startDate: '2026-09-21', quitDate: '2026-12-19', totalDays: 90, baseline: { pouchesPerDay: 9, mg: 9 }, stages: [] }, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null });
const plan = { generator: 'gen-1', startDate: '2026-09-21', quitDate: '2026-12-19', totalDays: 90, baseline: { pouchesPerDay: 9, mg: 9 }, stages: [] };

describe('loadRoot', () => {
  it('nothing stored → fresh root', () => expect(loadRoot(mem(), NOW)).toEqual({ root: freshRoot(), problem: null }));
  it('v1 only → migrates to one archived attempt', () => {
    const { root, problem } = loadRoot(mem({ [KEY_V1]: V1 }), NOW);
    expect(problem).toBeNull();
    expect(root.attempts.map((a) => [a.id, a.status])).toEqual([['a1', 'archived']]);
    // The key v1 froze comes out into the session, never back into storage.
    expect(root.device.apiKey).toBe('');
    expect(getKey()).toBe('sk-ant-TEST');
  });
  it('a key migrated out of v1 is never written to storage', () => {
    const s = mem({ [KEY_V1]: V1 });
    saveRoot(loadRoot(s, NOW).root, s);
    expect(s.getItem(KEY_V2)).not.toContain('sk-ant-TEST');
    expect(s.getItem(KEY_V1)).toBe(V1); // and v1 keeps its own copy, untouched
  });
  it('"Start fresh" from v1 leaves the key in the session, not on the root', () => {
    const root = freshStartRoot(mem({ [KEY_V1]: V1 }), NOW);
    expect(root.device.apiKey).toBe('');
    expect(getKey()).toBe('sk-ant-TEST');
  });
  it('NEVER touches the v1 key', () => {
    const s = mem({ [KEY_V1]: V1 });
    saveRoot(loadRoot(s, NOW).root, s);
    expect(s.getItem(KEY_V1)).toBe(V1);
    expect(JSON.parse(s.getItem(KEY_V2)).version).toBe(2);
  });
  it('v2 wins over v1 once it exists', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: JSON.stringify(startAttempt({ ...freshRoot(), attempts: [{ ...attemptShape('a8'), status: 'archived' }] }, { plan, settings: DEFAULT_SETTINGS, now: NOW })) });
    expect(loadRoot(s, NOW).root.activeAttemptId).toBe('a9');
  });
  it('corrupt v2 is reported, not papered over', () => {
    expect(loadRoot(mem({ [KEY_V2]: '{nope' }), NOW).problem).toBe('corrupt');
    expect(loadRoot(mem({ [KEY_V2]: '{"version":7}' }), NOW).problem).toBe('corrupt');
  });
  it('a v1 blob that will not migrate is reported', () => {
    expect(loadRoot(mem({ [KEY_V1]: '{nope' }), NOW).problem).toBe('migration-failed');
  });

  // The review's proof: any one of these used to fail the whole migration.
  for (const [label, bad] of [['missing ts', { id: 'x', type: 'pouch' }], ['garbage ts', { id: 'x', ts: 'not-a-date', type: 'pouch' }], ['numeric ts', { id: 'x', ts: 1720000000000, type: 'pouch' }], ['null entry', null], ['non-object entry', 42]]) {
    it(`one ${label} no longer sinks the migration`, () => {
      const v1 = JSON.parse(V1);
      v1.events.push(bad);
      const { root, problem } = loadRoot(mem({ [KEY_V1]: JSON.stringify(v1) }), NOW);
      expect(problem).toBeNull();
      expect(root.attempts[0].events.map((e) => e.id)).toEqual(['e1']);
      expect(root.attempts[0].unreadableEvents).toEqual([bad]);
    });
  }
});

// A v2 that parses but is the wrong shape would render straight into a crash.
// It is unreadable stored data like any other: recovery screen, nothing written.
describe('loadRoot on a structurally broken v2', () => {
  const good = () => ({ version: 2, device: { apiKey: '' }, activeAttemptId: null, attempts: [attemptShape('a1')] });
  const broken = {
    'root is null': null,
    'root is a list': [],
    'version 3': { ...good(), version: 3 },
    'attempts missing': { ...good(), attempts: undefined },
    'an attempt is null': { ...good(), attempts: [null] },
    'attempt without plan': { ...good(), attempts: [{ ...attemptShape('a1'), plan: undefined }] },
    'attempt with a null plan': { ...good(), attempts: [{ ...attemptShape('a1'), plan: null }] },
    'plan without stages': { ...good(), attempts: [{ ...attemptShape('a1'), plan: { startDate: '2026-09-21' } }] },
    'attempt without settings': { ...good(), attempts: [{ ...attemptShape('a1'), settings: undefined }] },
    'events not a list': { ...good(), attempts: [{ ...attemptShape('a1'), events: {} }] },
    'a null event': { ...good(), attempts: [{ ...attemptShape('a1'), events: [null] }] },
  };
  for (const [label, value] of Object.entries(broken)) {
    it(`${label} → corrupt, and nothing is written`, () => {
      const calls = [];
      const raw = JSON.stringify(value);
      const s = { getItem: (k) => (k === KEY_V2 ? raw : null), setItem: (k) => calls.push(k) };
      expect(loadRoot(s, NOW).problem).toBe('corrupt');
      expect(calls).toEqual([]);
    });
  }

  it('a missing or broken device loads as an empty one (it holds nothing but the key)', () => {
    for (const device of [null, 'x', undefined]) {
      const { root, problem } = loadRoot(mem({ [KEY_V2]: JSON.stringify({ ...good(), device }) }), NOW);
      expect(problem).toBeNull();
      expect(root.device).toEqual({ apiKey: '' });
    }
  });

  it('a well-formed v2 still loads', () => {
    expect(loadRoot(mem({ [KEY_V2]: JSON.stringify(good()) }), NOW).problem).toBeNull();
  });

  it('missing celebration lists load as empty ones (they only record which celebrations played)', () => {
    const { celebratedStages, celebratedAwards, ...bare } = attemptShape('a1');
    void celebratedStages; void celebratedAwards;
    const { root, problem } = loadRoot(mem({ [KEY_V2]: JSON.stringify({ ...good(), attempts: [bare] }) }), NOW);
    expect(problem).toBeNull();
    expect(root.attempts[0]).toMatchObject({ celebratedStages: [], celebratedAwards: [] });
  });
});

// The outer shape check let a root through that no screen could render: a null
// `mealTimes` (every slot time is read off it), a stage with no `slots`, an
// event whose `trigger` is an object (React throws on an object child). Each one
// threw on the first render, landed on the crash screen, and reloaded straight
// back into the same crash — the recovery screen was never offered. They are
// unreadable stored data like any other: recovery, and nothing written.
describe('loadRoot on a v2 that parses and passes the outer shape but cannot render', () => {
  const slot = () => ({ id: 'after-lunch', label: 'After lunch', anchor: 'lunch', offsetMin: 15 });
  const stage = () => ({ id: 1, name: 'Baseline hold', days: [1, 10], pouchesPerDay: 8, mg: 9, tagline: 'Lock the ceiling at 8.', slots: [slot()] });
  const fullPlan = () => ({ generator: 'gen-1', startDate: '2026-09-21', quitDate: '2026-12-19', totalDays: 90, baseline: { pouchesPerDay: 9, mg: 9 }, stages: [stage()] });
  const renderable = () => ({
    ...attemptShape('a1'),
    plan: fullPlan(),
    events: [
      { id: 'e1', ts: '2026-09-21T17:42:07.123Z', tzOffsetMin: -300, day: '2026-09-21', type: 'pouch', trigger: 'coffee', ctx: { nth: 1, cap: 8, slotId: 'after-lunch', slotLabel: 'After lunch', slotAt: '2026-09-21T17:45:00.000Z', firstSlotAt: '2026-09-21T13:15:00.000Z' } },
      { id: 'e2', ts: '2026-09-21T23:10:00.000Z', tzOffsetMin: -300, day: '2026-09-21', type: 'checkin', trigger: null, sleepHours: 7.5, sleepQuality: 4, workout: true, source: 'manual' },
      { id: 'e3', ts: '2026-09-22T14:00:00.000Z', tzOffsetMin: -300, day: '2026-09-22', type: 'backfill', trigger: null, count: 5, streak: 'keep' },
    ],
  });
  const rootWith = (attempt) => ({ version: 2, device: { apiKey: '' }, activeAttemptId: null, attempts: [attempt] });

  const breakIt = {
    // settings: every slot time is looked up on mealTimes, and PlanView puts
    // the three meal times straight into the DOM.
    'settings.mealTimes is null': (a) => { a.settings = { ...a.settings, mealTimes: null }; },
    'settings.mealTimes is a string': (a) => { a.settings = { ...a.settings, mealTimes: '08:00' }; },
    'a meal time is an object': (a) => { a.settings = { ...a.settings, mealTimes: { ...a.settings.mealTimes, lunch: { h: 12 } } }; },
    // plan: capForDay reads baseline, stageForDay reads days[0]/days[1],
    // pacingForNow maps stage.slots, PlanView renders name/tagline/mg.
    'plan has no baseline': (a) => { delete a.plan.baseline; },
    'plan baseline is null': (a) => { a.plan.baseline = null; },
    'baseline pouchesPerDay is not a number': (a) => { a.plan.baseline.pouchesPerDay = '9'; },
    'plan totalDays is not a number': (a) => { a.plan.totalDays = '90'; },
    'plan startDate is not a string': (a) => { a.plan.startDate = 20260921; },
    'plan quitDate is missing': (a) => { delete a.plan.quitDate; },
    'a stage is null': (a) => { a.plan.stages[0] = null; },
    'a stage has no slots': (a) => { delete a.plan.stages[0].slots; },
    'a stage slots is not a list': (a) => { a.plan.stages[0].slots = {}; },
    'a stage has no days': (a) => { delete a.plan.stages[0].days; },
    'a stage days has one bound': (a) => { a.plan.stages[0].days = [1]; },
    'a stage pouchesPerDay is not a number': (a) => { a.plan.stages[0].pouchesPerDay = null; },
    'a stage name is an object': (a) => { a.plan.stages[0].name = { n: 'Baseline' }; },
    'a slot is null': (a) => { a.plan.stages[0].slots[0] = null; },
    'a slot has no label': (a) => { delete a.plan.stages[0].slots[0].label; },
    'a slot label is an object': (a) => { a.plan.stages[0].slots[0].label = { text: 'After lunch' }; },
    // events: the timeline puts trigger, ctx.slotLabel and the check-in numbers
    // straight into the DOM, and every reader parses ts / buckets by day.
    'an event type is not a string': (a) => { a.events[0].type = { t: 'pouch' }; },
    'an event has no ts': (a) => { delete a.events[0].ts; },
    'an event ts is a number': (a) => { a.events[0].ts = 1758480127123; },
    'an event trigger is an object': (a) => { a.events[0].trigger = { name: 'coffee' }; },
    'an event trigger is a list': (a) => { a.events[0].trigger = ['coffee']; },
    'an event day is an object': (a) => { a.events[0].day = { d: '2026-09-21' }; },
    'an event tzOffsetMin is a string': (a) => { a.events[0].tzOffsetMin = '-300'; },
    'an event ctx is a list': (a) => { a.events[0].ctx = ['nope']; },
    'an event ctx slotLabel is an object': (a) => { a.events[0].ctx.slotLabel = { l: 'After lunch' }; },
    'a check-in sleepQuality is an object': (a) => { a.events[1].sleepQuality = { q: 4 }; },
    'a backfill count is an object': (a) => { a.events[2].count = { n: 5 }; },
  };

  for (const [label, wreck] of Object.entries(breakIt)) {
    it(`${label} → corrupt, nothing written, v1 untouched`, () => {
      const attempt = renderable();
      wreck(attempt);
      const s = mem({ [KEY_V1]: V1, [KEY_V2]: JSON.stringify(rootWith(attempt)) });
      const writes = [];
      const raw = s.getItem(KEY_V2);
      const guarded = { getItem: (k) => s.getItem(k), setItem: (k, v) => writes.push([k, v]) };
      expect(loadRoot(guarded, NOW).problem).toBe('corrupt');
      expect(writes).toEqual([]);
      expect(s.getItem(KEY_V1)).toBe(V1);
      expect(s.getItem(KEY_V2)).toBe(raw);
    });
  }

  it('the renderable root itself still loads cleanly', () => {
    expect(loadRoot(mem({ [KEY_V2]: JSON.stringify(rootWith(renderable())) }), NOW).problem).toBeNull();
  });

  it('a plan with no stages yet is still legitimate', () => {
    const a = renderable();
    a.plan.stages = [];
    expect(loadRoot(mem({ [KEY_V2]: JSON.stringify(rootWith(a)) }), NOW).problem).toBeNull();
  });

  it('an attempt with no events yet is still legitimate', () => {
    const a = renderable();
    a.events = [];
    expect(loadRoot(mem({ [KEY_V2]: JSON.stringify(rootWith(a)) }), NOW).problem).toBeNull();
  });

  // The deeper check also tightens what the ingest pipeline accepts, so the one
  // root that must never be rejected is the real one: attempt 1, migrated out
  // of v1 with its frozen legacy plan, saved, and read back.
  it('attempt 1 migrated out of v1 survives a save/load round trip', () => {
    const s = mem({ [KEY_V1]: V1 });
    const first = loadRoot(s, NOW);
    expect(first.problem).toBeNull();
    saveRoot(first.root, s);
    expect(loadRoot(s, NOW).problem).toBeNull();
    expect(s.getItem(KEY_V1)).toBe(V1);
  });

  // The other legitimate shape: a plan the generator built for a new attempt.
  it('a freshly generated plan and settings load cleanly', () => {
    const genPlan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [9, 6, 3], lengthDays: 90, startDate: '2026-09-22', mealTimes: DEFAULT_SETTINGS.mealTimes, sleepTime: DEFAULT_SETTINGS.sleepTime });
    const root = startAttempt(freshRoot(), { plan: genPlan, settings: DEFAULT_SETTINGS, now: NOW });
    expect(loadRoot(mem({ [KEY_V2]: JSON.stringify(root) }), NOW).problem).toBeNull();
  });
});

// An active id that doesn't resolve to an active attempt would leave the app
// on a screen it can't leave: no Front door, startAttempt refusing, Exit inert.
describe('loadRoot with a dangling activeAttemptId', () => {
  const stored = (activeAttemptId) => JSON.stringify({ version: 2, device: { apiKey: '' }, activeAttemptId, attempts: [attemptShape('a1')] });
  it('an id with no attempt behind it is treated as none, without writing', () => {
    const calls = [];
    const raw = stored('a9');
    const s = { getItem: (k) => (k === KEY_V2 ? raw : null), setItem: (k) => calls.push(k) };
    const { root, problem } = loadRoot(s, NOW);
    expect(problem).toBeNull();
    expect(root.activeAttemptId).toBeNull();
    expect(calls).toEqual([]);
    expect(startAttempt(root, { plan, settings: DEFAULT_SETTINGS, now: NOW }).activeAttemptId).toBe('a2');
  });
  it('an id pointing at an archived attempt is treated as none, and that attempt is left as it was', () => {
    const { root } = loadRoot(mem({ [KEY_V2]: stored('a1') }), NOW);
    expect(root.activeAttemptId).toBeNull();
    expect(root.attempts[0]).toEqual(attemptShape('a1'));
  });
  it('an id pointing at the active attempt is kept', () => {
    const r = startAttempt({ ...freshRoot(), attempts: [attemptShape('a1')] }, { plan, settings: DEFAULT_SETTINGS, now: NOW });
    expect(loadRoot(mem({ [KEY_V2]: JSON.stringify(r) }), NOW).root.activeAttemptId).toBe('a2');
  });
});

describe('attempt lifecycle', () => {
  it('starts, updates immutably, archives, and numbers attempts', () => {
    const r0 = loadRoot(mem({ [KEY_V1]: V1 }), NOW).root;
    const r1 = startAttempt(r0, { plan, settings: DEFAULT_SETTINGS, now: NOW });
    expect(r1.activeAttemptId).toBe('a2');
    expect(attemptById(r1, 'a2')).toMatchObject({ status: 'active', archivedAt: null, events: [], plan });
    expect(r0.attempts).toHaveLength(1); // not mutated
    const r2 = updateAttempt(r1, 'a2', (a) => ({ ...a, events: [...a.events, { id: 'x' }] }));
    expect(attemptById(r2, 'a2').events).toHaveLength(1);
    expect(attemptById(r1, 'a2').events).toHaveLength(0);
    const r3 = archiveActive(r2, '2026-12-20T00:00:00.000Z');
    expect(r3.activeAttemptId).toBeNull();
    expect(attemptById(r3, 'a2')).toMatchObject({ status: 'archived', archivedAt: '2026-12-20T00:00:00.000Z' });
  });
  // archivedAt is UTC; an evening archive in the Americas is already tomorrow
  // there. The local 4am→4am day is what the reader means by "the day it ended".
  it('archiving stamps the local day it happened on', () => {
    const r1 = startAttempt(freshRoot(), { plan, settings: DEFAULT_SETTINGS, now: NOW });
    const at = '2026-12-20T02:30:00.000Z';
    expect(attemptById(archiveActive(r1, at), 'a1').archivedDay).toBe(todayKey(new Date(at)));
  });
  it('archiveActive never re-archives an attempt that is already archived', () => {
    const r = { ...freshRoot(), activeAttemptId: 'a1', attempts: [attemptShape('a1')] };
    const out = archiveActive(r, '2026-12-20T00:00:00.000Z');
    expect(out.activeAttemptId).toBeNull();
    expect(out.attempts[0]).toEqual(attemptShape('a1'));
  });
  it('refuses a second active attempt', () => {
    const r1 = startAttempt(freshRoot(), { plan, settings: DEFAULT_SETTINGS, now: NOW });
    expect(() => startAttempt(r1, { plan, settings: DEFAULT_SETTINGS, now: NOW })).toThrow();
  });
  it('lastSettings carries over from the most recent attempt', () => {
    expect(lastSettings(freshRoot())).toEqual(DEFAULT_SETTINGS);
    const r = loadRoot(mem({ [KEY_V1]: V1.replace('"costPerTin":5', '"costPerTin":6.5') }), NOW).root;
    expect(lastSettings(r).costPerTin).toBe(6.5);
  });
});

// Extra guard tests (coordinator-requested): protect James's data specifically.
describe('data-safety guards', () => {
  it('saveRoot never calls setItem with KEY_V1, and root.js never calls removeItem', () => {
    const calls = [];
    const s = { getItem: () => null, setItem: (k) => calls.push(k) && undefined };
    saveRoot(freshRoot(), s);
    expect(calls).not.toContain(KEY_V1);
    expect(s.removeItem).toBeUndefined();
  });

  it('a v2 root whose attempts is not an array is corrupt', () => {
    const s = mem({ [KEY_V2]: JSON.stringify({ version: 2, device: { apiKey: '' }, activeAttemptId: null, attempts: 'nope' }) });
    expect(loadRoot(s, NOW).problem).toBe('corrupt');
  });

  it('loadRoot on a corrupt v2 does not write anything to storage', () => {
    const setItemCalls = [];
    const s = { getItem: (k) => (k === KEY_V2 ? '{nope' : null), setItem: (k) => setItemCalls.push(k) };
    loadRoot(s, NOW);
    expect(setItemCalls).toEqual([]);
  });

  // An empty string is something stored, not nothing stored — only null means
  // the key is absent. Otherwise the app would save a fresh root over it.
  it('an empty stored v2 is corrupt, and nothing is written', () => {
    const setItemCalls = [];
    const s = { getItem: (k) => (k === KEY_V2 ? '' : null), setItem: (k) => setItemCalls.push(k) };
    expect(loadRoot(s, NOW).problem).toBe('corrupt');
    expect(setItemCalls).toEqual([]);
  });

  it('an empty stored v2 is corrupt even when a good v1 exists (v1 is not re-migrated over it)', () => {
    expect(loadRoot(mem({ [KEY_V1]: V1, [KEY_V2]: '' }), NOW).problem).toBe('corrupt');
  });

  it('an empty stored v1 (no v2) is a failed migration, not a fresh start', () => {
    expect(loadRoot(mem({ [KEY_V1]: '' }), NOW).problem).toBe('migration-failed');
  });

  it('a v1 blob that parses but is not a v1 state (no events array) is a failed migration, and nothing is written', () => {
    for (const raw of ['5', 'null', '[]', '{"version":1}']) {
      const setItemCalls = [];
      const s = { getItem: (k) => (k === KEY_V1 ? raw : null), setItem: (k) => setItemCalls.push(k) };
      expect(loadRoot(s, NOW).problem, raw).toBe('migration-failed');
      expect(setItemCalls, raw).toEqual([]);
    }
  });

  it('startAttempt numbering stays unique even if attempts were somehow not sequential', () => {
    const root = { ...freshRoot(), attempts: [
      { id: 'a1', status: 'archived', createdAt: NOW, archivedAt: NOW, settings: DEFAULT_SETTINGS, plan, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null },
      { id: 'a3', status: 'archived', createdAt: NOW, archivedAt: NOW, settings: DEFAULT_SETTINGS, plan, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null },
    ] };
    const r1 = startAttempt(root, { plan, settings: DEFAULT_SETTINGS, now: NOW });
    expect(r1.attempts.map((a) => a.id)).toEqual(['a1', 'a3', 'a4']);
  });
});

// "Start fresh" is the only path that ends with unreadable v2 data being
// overwritten, so the rescue copy is the last line of defence before a
// corrupt-storage bug turns into a lost history.
describe('preserveCorruptV2', () => {
  it('copies the unreadable v2 value aside and leaves v1 and v2 untouched', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: '{corrupt' });
    const key = preserveCorruptV2(s, NOW);
    expect(key).toBe('pouch-down-v2-corrupt-2026-09-20-18-00-00');
    expect(s.getItem(key)).toBe('{corrupt');
    expect(s.getItem(KEY_V2)).toBe('{corrupt');
    expect(s.getItem(KEY_V1)).toBe(V1);
  });

  it('never overwrites an earlier rescue from the same second', () => {
    const s = mem({ [KEY_V2]: 'second attempt' });
    s.setItem('pouch-down-v2-corrupt-2026-09-20-18-00-00', 'first rescue');
    preserveCorruptV2(s, NOW);
    expect(s.getItem('pouch-down-v2-corrupt-2026-09-20-18-00-00')).toBe('first rescue');
  });

  it('nothing stored under v2 → nothing written', () => {
    const calls = [];
    const s = { getItem: () => null, setItem: (k) => calls.push(k) };
    expect(preserveCorruptV2(s, NOW)).toBeNull();
    expect(calls).toEqual([]);
  });

  // A full quota used to return null — the same as "nothing to copy" — so Start
  // fresh carried on and wrote over the only copy. Now it says it failed.
  it('a throwing storage (full quota) reports failure without throwing', () => {
    // Only v2 has data, so the rescue key really is absent and setItem is reached.
    const s = { getItem: (k) => (k === KEY_V2 ? 'data' : null), setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; } };
    expect(() => preserveCorruptV2(s, NOW)).not.toThrow();
    expect(preserveCorruptV2(s, NOW)).toBe(false);
  });

  it('a write that silently does not land is a failure too', () => {
    const s = { getItem: (k) => (k === KEY_V2 ? 'data' : null), setItem: () => {} };
    expect(preserveCorruptV2(s, NOW)).toBe(false);
  });

  it('a blocked storage (getItem throws) reports failure', () => {
    const s = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} };
    expect(preserveCorruptV2(s, NOW)).toBe(false);
  });

  it('a different value under the same second lands beside the earlier rescue, not nowhere', () => {
    const s = mem({ [KEY_V2]: 'second attempt', 'pouch-down-v2-corrupt-2026-09-20-18-00-00': 'first rescue' });
    const key = preserveCorruptV2(s, NOW);
    expect(key).toBe('pouch-down-v2-corrupt-2026-09-20-18-00-00-2');
    expect(s.getItem(key)).toBe('second attempt');
    expect(s.getItem('pouch-down-v2-corrupt-2026-09-20-18-00-00')).toBe('first rescue');
  });

  it('the same value twice is one rescue, not two', () => {
    const s = mem({ [KEY_V2]: '{corrupt' });
    expect(preserveCorruptV2(s, NOW)).toBe(preserveCorruptV2(s, NOW));
    expect([...s._m.keys()].filter((k) => k.includes('-corrupt-'))).toHaveLength(1);
  });
});

// Every stored blob is redacted on the way in, but the dump has fields of its
// own that never went through that pass. The redactor runs once more over the
// finished text, so a key-shaped string is masked whichever field held it.
describe('rawStorageDump redacts the whole finished dump, not only the stored blobs', () => {
  const noStorage = { getItem: () => null };

  it('a key-shaped string in a field that is not a stored blob is masked too', () => {
    const out = rawStorageDump(noStorage, `${NOW}-sk-ant-leaked-from-somewhere-else`);
    expect(out).not.toContain('sk-ant-leaked');
    expect(out).toContain('sk-ant-REDACTED');
  });

  it('the finished dump is already its own redacted form', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: '{"note":"sk-ant-pasted-here"' });
    const out = rawStorageDump(s, NOW);
    expect(redactSecrets(out)).toBe(out);
    expect(out).not.toContain('sk-ant-TEST');
    expect(out).not.toContain('sk-ant-pasted');
  });

  it('it still only reads: the redaction pass writes nothing and cannot throw', () => {
    const s = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('must not write'); } };
    expect(() => rawStorageDump(s, NOW)).not.toThrow();
    expect(JSON.parse(rawStorageDump(s, NOW)).keys).toEqual({ [KEY_V2]: null, [KEY_V1]: null });
  });
});

// What "Start fresh" builds. Before, it was always an empty root — and since
// v1 is never read once v2 exists, attempt 1 vanished from the app for good.
describe('freshStartRoot', () => {
  const noWrites = (init) => { const s = mem(init); s.setItem = () => { throw new Error('freshStartRoot must not write'); }; return s; };
  it('corrupt v2 + readable v1 → attempt 1 comes back, archived, with nothing active', () => {
    const root = freshStartRoot(noWrites({ [KEY_V1]: V1, [KEY_V2]: '{corrupt' }), NOW);
    expect(root.activeAttemptId).toBeNull();
    expect(root.attempts.map((a) => [a.id, a.status])).toEqual([['a1', 'archived']]);
    expect(root.attempts[0].events.map((e) => e.id)).toEqual(['e1']);
    expect(root).toEqual(loadRoot(mem({ [KEY_V1]: V1 }), NOW).root); // same as a first boot would build
    expect(root).not.toHaveProperty('legacyV1');
  });
  it('v1 that cannot be migrated → empty root that remembers attempt 1 is still sitting in v1', () => {
    for (const raw of ['{nope', '', '5', '{"version":1}']) {
      expect(freshStartRoot(noWrites({ [KEY_V1]: raw }), NOW), raw).toEqual({ ...freshRoot(), legacyV1: 'unread' });
    }
  });
  it('no v1 at all → a plain empty root', () => {
    expect(freshStartRoot(noWrites({ [KEY_V2]: '{corrupt' }), NOW)).toEqual(freshRoot());
  });
  it('the fresh root loads cleanly next boot, and v1 is still byte-for-byte', () => {
    const s = mem({ [KEY_V1]: '{nope' });
    saveRoot(freshStartRoot(s, NOW), s);
    const { root, problem } = loadRoot(s, NOW);
    expect(problem).toBeNull();
    expect(root.legacyV1).toBe('unread');
    expect(s.getItem(KEY_V1)).toBe('{nope');
  });
});

// The API key used to live in storage under the v2 root. It doesn't need to be
// at rest — a password manager can fill it on demand — so a root that arrives
// carrying one hands it to the session and comes back blank. loadRoot still
// writes nothing; the blank is persisted by the app's next ordinary save.
describe('an inherited API key moves into the session, never back to storage', () => {
  const FAKE = 'sk-ant-test-not-a-real-key';
  const withKey = () => JSON.stringify({ version: 2, device: { apiKey: FAKE }, activeAttemptId: null, attempts: [attemptShape('a1')] });

  beforeEach(() => { clearKey(); delete globalThis.sessionStorage; });
  afterEach(() => { clearKey(); delete globalThis.sessionStorage; });

  it('loadRoot hands the key to the session and returns a blank one, writing nothing', () => {
    const calls = [];
    const raw = withKey();
    const s = { getItem: (k) => (k === KEY_V2 ? raw : null), setItem: (k) => calls.push(k) };
    const { root, problem } = loadRoot(s, NOW);
    expect(problem).toBeNull();
    expect(root.device.apiKey).toBe('');
    expect(getKey()).toBe(FAKE);
    expect(calls).toEqual([]);
  });

  it('the next ordinary save stores the blank, and v1 is byte-identical before and after', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: withKey() });
    const v1Before = s.getItem(KEY_V1);
    const { root } = loadRoot(s, NOW);
    saveRoot(root, s);
    expect(JSON.parse(s.getItem(KEY_V2)).device.apiKey).toBe('');
    expect(s.getItem(KEY_V1)).toBe(v1Before);
    expect(s.getItem(KEY_V1)).toBe(V1);
  });

  // The whole point: after a save there is no value anywhere in storage that
  // contains the key — not the root it was inherited from, not one typed in.
  it('no value under any storage key contains the key after a save', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: withKey() });
    const { root } = loadRoot(s, NOW);
    saveRoot(root, s);
    setKey(FAKE); // and a key typed in by hand this session
    saveRoot(loadRoot(s, NOW).root, s);
    for (const [key, value] of s._m) expect(value, key).not.toContain(FAKE);
  });

  it('a stored root with no key leaves a key typed in this session alone', () => {
    const s = mem({ [KEY_V2]: JSON.stringify({ version: 2, device: { apiKey: '' }, activeAttemptId: null, attempts: [attemptShape('a1')] }) });
    setKey(FAKE);
    expect(loadRoot(s, NOW).root.device.apiKey).toBe('');
    expect(getKey()).toBe(FAKE);
  });

  it('a blank-but-whitespace stored key is no key at all', () => {
    const s = mem({ [KEY_V2]: JSON.stringify({ version: 2, device: { apiKey: '   ' }, activeAttemptId: null, attempts: [attemptShape('a1')] }) });
    expect(loadRoot(s, NOW).root.device.apiKey).toBe('');
    expect(getKey()).toBe('');
  });

  it('a non-string stored key is dropped rather than carried anywhere', () => {
    for (const apiKey of [42, { k: FAKE }, ['x'], null]) {
      clearKey();
      const s = mem({ [KEY_V2]: JSON.stringify({ version: 2, device: { apiKey }, activeAttemptId: null, attempts: [attemptShape('a1')] }) });
      expect(loadRoot(s, NOW).root.device.apiKey, String(apiKey)).toBe('');
      expect(getKey(), String(apiKey)).toBe('');
    }
  });

  it('a device that is not an object still loads, and nothing leaks into the session', () => {
    const s = mem({ [KEY_V2]: JSON.stringify({ version: 2, device: FAKE, activeAttemptId: null, attempts: [attemptShape('a1')] }) });
    const { root, problem } = loadRoot(s, NOW);
    expect(problem).toBeNull();
    expect(root.device).toEqual({ apiKey: '' });
    expect(getKey()).toBe('');
  });
});
