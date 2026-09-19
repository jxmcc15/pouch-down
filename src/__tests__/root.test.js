import { describe, it, expect } from 'vitest';
import { KEY_V1, KEY_V2, DEFAULT_SETTINGS, freshRoot, loadRoot, saveRoot, startAttempt, archiveActive, updateAttempt, attemptById, lastSettings } from '../root.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), _m: m }; };
const NOW = '2026-09-20T18:00:00.000Z';
const V1 = JSON.stringify({ version: 1, settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-ant-TEST' }, events: [{ id: 'e1', ts: '2026-07-08T11:33:12.569Z', type: 'pouch', trigger: null }], celebratedStages: [1], checkinDismissedFor: null });
const plan = { generator: 'gen-1', startDate: '2026-09-21', quitDate: '2026-12-19', totalDays: 90, baseline: { pouchesPerDay: 9, mg: 9 }, stages: [] };

describe('loadRoot', () => {
  it('nothing stored → fresh root', () => expect(loadRoot(mem(), NOW)).toEqual({ root: freshRoot(), problem: null }));
  it('v1 only → migrates to one archived attempt', () => {
    const { root, problem } = loadRoot(mem({ [KEY_V1]: V1 }), NOW);
    expect(problem).toBeNull();
    expect(root.attempts.map((a) => [a.id, a.status])).toEqual([['a1', 'archived']]);
    expect(root.device.apiKey).toBe('sk-ant-TEST');
  });
  it('NEVER touches the v1 key', () => {
    const s = mem({ [KEY_V1]: V1 });
    saveRoot(loadRoot(s, NOW).root, s);
    expect(s.getItem(KEY_V1)).toBe(V1);
    expect(JSON.parse(s.getItem(KEY_V2)).version).toBe(2);
  });
  it('v2 wins over v1 once it exists', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: JSON.stringify({ ...freshRoot(), activeAttemptId: 'a9' }) });
    expect(loadRoot(s, NOW).root.activeAttemptId).toBe('a9');
  });
  it('corrupt v2 is reported, not papered over', () => {
    expect(loadRoot(mem({ [KEY_V2]: '{nope' }), NOW).problem).toBe('corrupt');
    expect(loadRoot(mem({ [KEY_V2]: '{"version":7}' }), NOW).problem).toBe('corrupt');
  });
  it('a v1 blob that will not migrate is reported', () => {
    expect(loadRoot(mem({ [KEY_V1]: '{nope' }), NOW).problem).toBe('migration-failed');
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
