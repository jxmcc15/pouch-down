import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SESSION_KEY, getKey, setKey, clearKey, subscribe } from '../sessionKey.js';
import { generatePlan } from '../planGenerator.js';

// Obviously fake. A real key never appears in this repo, fixtures included.
const FAKE = 'sk-ant-test-not-a-real-key';

// The sheets are server-rendered with the app context mocked, the same way
// disciplineCard.test.js reads a card's markup without a DOM.
const app = vi.hoisted(() => ({ value: null }));
vi.mock('../state.jsx', () => ({ useApp: () => app.value }));

// No `window` stub: framer-motion decides at import time whether it is in a
// browser, and a fake one sends it down the DOM path with no DOM behind it.
const { default: SettingsSheet } = await import('../components/SettingsSheet.jsx');
const { default: CoachSheet } = await import('../components/CoachSheet.jsx');

// A stand-in for sessionStorage that records every call, so a test can prove
// what was touched as well as what came back.
const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  const calls = [];
  return {
    getItem: (k) => { calls.push(['get', k]); return m.get(k) ?? null; },
    setItem: (k, v) => { calls.push(['set', k, v]); m.set(k, String(v)); },
    removeItem: (k) => { calls.push(['remove', k]); m.delete(k); },
    _m: m,
    calls,
  };
};

const throwing = (name) => ({
  getItem: () => { throw new Error(name); },
  setItem: () => { throw new Error(name); },
  removeItem: () => { throw new Error(name); },
});

const put = (what) => Object.defineProperty(globalThis, 'sessionStorage', { value: what, configurable: true, writable: true });

beforeEach(() => {
  clearKey();
  delete globalThis.sessionStorage;
  delete globalThis.localStorage;
});

afterEach(() => {
  clearKey();
  delete globalThis.sessionStorage;
  delete globalThis.localStorage;
});

describe('sessionKey', () => {
  it('holds a key for the session and hands it back', () => {
    put(mem());
    setKey(FAKE);
    expect(getKey()).toBe(FAKE);
  });

  it('is empty until a key is set', () => {
    put(mem());
    expect(getKey()).toBe('');
  });

  it('tells subscribers the new value, and stops when they unsubscribe', () => {
    put(mem());
    const seen = [];
    const off = subscribe((k) => seen.push(k));
    setKey(FAKE);
    clearKey();
    off();
    setKey('sk-ant-test-after-unsubscribe');
    expect(seen).toEqual([FAKE, '']);
  });

  it('rides a reload through sessionStorage (per-tab, so a sibling page cannot read it)', async () => {
    const store = mem();
    put(store);
    setKey(FAKE);
    expect(store._m.get(SESSION_KEY)).toBe(FAKE);
    // A reload is a fresh module with the same sessionStorage behind it.
    vi.resetModules();
    const fresh = await import('../sessionKey.js');
    expect(fresh.getKey()).toBe(FAKE);
  });

  it('never writes to localStorage — not on set, not on clear, not on read', () => {
    put(mem());
    const local = mem();
    Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true, writable: true });
    setKey(FAKE);
    getKey();
    clearKey();
    expect(local.calls).toEqual([]);
    expect([...local._m.keys()]).toEqual([]);
  });

  it('clearKey empties memory and sessionStorage', () => {
    const store = mem();
    put(store);
    setKey(FAKE);
    clearKey();
    expect(getKey()).toBe('');
    expect(store._m.has(SESSION_KEY)).toBe(false);
  });

  it('setting an empty key clears the stored one rather than storing a blank', () => {
    const store = mem();
    put(store);
    setKey(FAKE);
    setKey('');
    expect(store._m.has(SESSION_KEY)).toBe(false);
    expect(getKey()).toBe('');
  });

  it('a sessionStorage that throws degrades to memory-only without throwing', () => {
    put(throwing('QuotaExceededError'));
    expect(() => setKey(FAKE)).not.toThrow();
    expect(getKey()).toBe(FAKE);
    expect(() => clearKey()).not.toThrow();
    expect(getKey()).toBe('');
  });

  it('no sessionStorage at all (headless, old runtime) is memory-only, not a crash', () => {
    expect(globalThis.sessionStorage).toBeUndefined();
    expect(() => setKey(FAKE)).not.toThrow();
    expect(getKey()).toBe(FAKE);
    expect(() => clearKey()).not.toThrow();
  });

  it('a blocked sessionStorage (touching the property throws) is memory-only, not a crash', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      get() { throw new Error('SecurityError'); },
      configurable: true,
    });
    expect(() => setKey(FAKE)).not.toThrow();
    expect(getKey()).toBe(FAKE);
    expect(() => clearKey()).not.toThrow();
    expect(getKey()).toBe('');
  });

  it('a non-string key is treated as no key', () => {
    put(mem());
    for (const value of [null, undefined, 42, { key: FAKE }]) {
      setKey(value);
      expect(getKey()).toBe('');
    }
  });
});

// The sheets are where the change shows: a password field a manager can fill,
// and copy that is honest about how long the key is kept.
describe('the sheets read the session key, not the stored root', () => {
  const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
  const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
  const attempt = { id: 'a1', status: 'active', createdAt: '2026-09-21T12:00:00.000Z', archivedAt: null, settings, plan, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
  // A key planted on the root: if the field ever renders this, the key is
  // coming from storage again.
  const PLANTED = 'sk-ant-test-planted-on-the-root';
  const settingsApp = () => ({
    state: attempt,
    root: { version: 2, device: { apiKey: PLANTED }, activeAttemptId: 'a1', attempts: [attempt] },
    device: { apiKey: PLANTED },
    api: { updateSettings() {}, updateDevice() { throw new Error('the key must never be written to the root'); }, viewAttempt() {}, archiveActive() {} },
    readOnly: false,
  });

  const settingsMarkup = () => { app.value = settingsApp(); return renderToStaticMarkup(createElement(SettingsSheet, { onClose() {} })); };
  const coachMarkup = () => { app.value = { state: attempt }; return renderToStaticMarkup(createElement(CoachSheet, { onClose() {}, openSettings() {} })); };

  beforeEach(() => { clearKey(); delete globalThis.sessionStorage; });
  afterEach(() => { clearKey(); app.value = null; });

  it('the key field is a password field a password manager can fill', () => {
    // Attribute case is the renderer's business (HTML parses them either way),
    // so the markup is compared lowercased.
    const html = settingsMarkup().toLowerCase();
    for (const attr of ['type="password"', 'autocomplete="current-password"', 'name="anthropic-api-key"', 'spellcheck="false"', 'autocapitalize="none"']) {
      expect(html, attr).toContain(attr);
    }
  });

  it('the helper text says the key is kept for this session only, and that a manager can fill it', () => {
    const html = settingsMarkup();
    expect(html).toContain('Kept for this session only, never saved on this phone');
    expect(html).toContain('password manager can fill it back in');
    expect(html).toContain('console.anthropic.com');
    expect(html).not.toContain("Stored only in this phone's browser storage");
  });

  it('the field shows the session key and never the one on the root', () => {
    setKey(FAKE);
    const html = settingsMarkup();
    expect(html).toContain(`value="${FAKE}"`);
    expect(html).not.toContain(PLANTED);
  });

  it('with no key in the session the field is empty', () => {
    expect(settingsMarkup()).not.toContain(PLANTED);
    expect(settingsMarkup()).toContain('value=""');
  });

  it("the coach's no-key state still works, and says the key is kept for the session", () => {
    const html = coachMarkup();
    expect(html).toContain('Open Settings');
    expect(html).toContain('kept for this session only');
    expect(html).not.toContain('Talk to your coach');
  });

  it('the coach opens for chat once the session has a key', () => {
    setKey(FAKE);
    const html = coachMarkup();
    expect(html).toContain('Talk to your coach');
    expect(html).not.toContain('Open Settings');
    expect(html).not.toContain(FAKE); // the key is never on screen in the coach
  });

  it('no sheet reads the key off the root any more', () => {
    for (const file of ['src/components/SettingsSheet.jsx', 'src/components/CoachSheet.jsx', 'src/components/onboarding/PriceHelpSheet.jsx']) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/device\.apiKey/);
    }
  });
});
