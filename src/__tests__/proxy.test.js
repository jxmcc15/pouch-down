// How the coach reaches Claude: through a proxy this person owns, or — when no
// proxy is configured — straight to the API with the session key, exactly as
// before. The interesting half of this file is the *choice*, because getting it
// wrong either breaks the coach or sends a key somewhere it doesn't belong.
//
// Nothing here touches the network, and every credential is obviously fake:
// 'pd-device-test-token' and 'sk-ant-test-not-a-real-key'. A real key or token
// never appears in this repo, fixtures included.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePlan } from '../planGenerator.js';
import {
  COACH_PROXY,
  DEVICE_TOKEN_KEY,
  MESSAGES_PATH,
  ANTHROPIC_MESSAGES_URL,
  hasProxy,
  proxyUrl,
  proxyOrigin,
  getDeviceToken,
  setDeviceToken,
  clearDeviceToken,
  subscribe,
  pickTransport,
  coachTransport,
  authErrorFor,
} from '../proxyConfig.js';

const TOKEN = 'pd-device-test-token';
const KEY = 'sk-ant-test-not-a-real-key';
const PROXY = 'https://coach.example.workers.dev';

// A stand-in for localStorage that records every call, so a test can prove what
// was touched as well as what came back. Same shape as sessionKey.test.js uses.
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

const put = (name, what) =>
  Object.defineProperty(globalThis, name, { value: what, configurable: true, writable: true });

beforeEach(() => {
  clearDeviceToken();
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

afterEach(() => {
  clearDeviceToken();
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

describe('what ships in the repo', () => {
  it('has no proxy configured, so the session key is still the only path', () => {
    expect(COACH_PROXY).toBe('');
    expect(hasProxy()).toBe(false);
    expect(proxyUrl()).toBe('');
    expect(proxyOrigin()).toBe('');
  });

  it('names the device token key and the messages path', () => {
    expect(DEVICE_TOKEN_KEY).toBe('pouch-down-device-token');
    expect(MESSAGES_PATH).toBe('/v1/messages');
    expect(ANTHROPIC_MESSAGES_URL).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('proxyUrl and proxyOrigin', () => {
  it('joins the base and the path with exactly one slash between them', () => {
    expect(proxyUrl(MESSAGES_PATH, PROXY)).toBe(`${PROXY}/v1/messages`);
    expect(proxyUrl(MESSAGES_PATH, `${PROXY}/`)).toBe(`${PROXY}/v1/messages`);
    expect(proxyUrl('v1/messages', PROXY)).toBe(`${PROXY}/v1/messages`);
  });

  it('is empty with no base, so a missing proxy can never become a relative call', () => {
    expect(proxyUrl(MESSAGES_PATH, '')).toBe('');
    expect(proxyUrl(MESSAGES_PATH, '   ')).toBe('');
  });

  it('gives the bare origin for the CSP, dropping any path', () => {
    expect(proxyOrigin(PROXY)).toBe(PROXY);
    expect(proxyOrigin(`${PROXY}/v1/messages`)).toBe(PROXY);
  });

  it('gives nothing for an unparseable base, so the CSP widens for nothing', () => {
    expect(proxyOrigin('not a url')).toBe('');
    expect(proxyOrigin('')).toBe('');
  });
});

describe('the device token lives in localStorage on purpose', () => {
  it('is entered once per device and read back after a reload', () => {
    const local = mem();
    put('localStorage', local);
    setDeviceToken(TOKEN);
    expect(getDeviceToken()).toBe(TOKEN);
    expect(local._m.get(DEVICE_TOKEN_KEY)).toBe(TOKEN);
  });

  it('is empty until one is pasted', () => {
    put('localStorage', mem());
    expect(getDeviceToken()).toBe('');
  });

  it('trims what was pasted, because a copy usually brings whitespace', () => {
    put('localStorage', mem());
    setDeviceToken(`  ${TOKEN}\n`);
    expect(getDeviceToken()).toBe(TOKEN);
  });

  it('clearing removes the entry rather than storing a blank', () => {
    const local = mem();
    put('localStorage', local);
    setDeviceToken(TOKEN);
    clearDeviceToken();
    expect(getDeviceToken()).toBe('');
    expect(local._m.has(DEVICE_TOKEN_KEY)).toBe(false);
    setDeviceToken(TOKEN);
    setDeviceToken('   ');
    expect(local._m.has(DEVICE_TOKEN_KEY)).toBe(false);
  });

  it('tells subscribers the new value, and stops when they unsubscribe', () => {
    put('localStorage', mem());
    const seen = [];
    const off = subscribe((t) => seen.push(t));
    setDeviceToken(TOKEN);
    clearDeviceToken();
    off();
    setDeviceToken('pd-device-test-after-unsubscribe');
    expect(seen).toEqual([TOKEN, '']);
  });

  it('a non-string token is no token at all', () => {
    put('localStorage', mem());
    for (const value of [null, undefined, 42, { token: TOKEN }]) {
      setDeviceToken(value);
      expect(getDeviceToken()).toBe('');
    }
  });

  it('never touches sessionStorage — that belongs to the key', () => {
    put('localStorage', mem());
    const session = mem();
    put('sessionStorage', session);
    setDeviceToken(TOKEN);
    getDeviceToken();
    clearDeviceToken();
    expect(session.calls).toEqual([]);
  });
});

describe('a blocked or broken localStorage degrades, never throws', () => {
  it('a localStorage that throws on every call still holds the token for this session', () => {
    put('localStorage', throwing('QuotaExceededError'));
    expect(() => setDeviceToken(TOKEN)).not.toThrow();
    expect(getDeviceToken()).toBe(TOKEN);
    expect(() => clearDeviceToken()).not.toThrow();
    expect(getDeviceToken()).toBe('');
  });

  it('no localStorage at all (headless, old runtime) is memory-only, not a crash', () => {
    expect(globalThis.localStorage).toBeUndefined();
    expect(() => setDeviceToken(TOKEN)).not.toThrow();
    expect(getDeviceToken()).toBe(TOKEN);
    expect(() => clearDeviceToken()).not.toThrow();
  });

  it('a blocked localStorage (touching the property throws) is memory-only, not a crash', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() { throw new Error('SecurityError'); },
      configurable: true,
    });
    expect(() => setDeviceToken(TOKEN)).not.toThrow();
    expect(getDeviceToken()).toBe(TOKEN);
    expect(() => clearDeviceToken()).not.toThrow();
    expect(getDeviceToken()).toBe('');
  });
});

// The four combinations, spelled out. This is the whole decision: which of the
// two credentials leaves the phone, and which one never does.
describe('the transport choice', () => {
  it('no proxy, no token: the direct call with the session key', () => {
    const t = pickTransport({ proxy: '', token: '', apiKey: KEY });
    expect(t.mode).toBe('direct');
    expect(t.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(t.headers['x-api-key']).toBe(KEY);
  });

  it('no proxy, a token stored: still direct — a token means nothing without a proxy', () => {
    const t = pickTransport({ proxy: '', token: TOKEN, apiKey: KEY });
    expect(t.mode).toBe('direct');
    expect(t.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(t.headers['x-pd-device']).toBeUndefined();
    expect(JSON.stringify(t)).not.toContain(TOKEN);
  });

  it('a proxy and a token: the proxy, and no key is needed at all', () => {
    const t = pickTransport({ proxy: PROXY, token: TOKEN, apiKey: '' });
    expect(t.mode).toBe('proxy');
    expect(t.url).toBe(`${PROXY}/v1/messages`);
    expect(t.headers['x-pd-device']).toBe(TOKEN);
  });

  it('a proxy and a token beats a key that also happens to be around', () => {
    const t = pickTransport({ proxy: PROXY, token: TOKEN, apiKey: KEY });
    expect(t.mode).toBe('proxy');
    expect(JSON.stringify(t)).not.toContain(KEY);
  });

  it('a proxy, no token, no key: no-device-token, so a sheet can name what to paste', () => {
    expect(() => pickTransport({ proxy: PROXY, token: '', apiKey: '' })).toThrow('no-device-token');
    expect(() => pickTransport({ proxy: PROXY, token: '   ', apiKey: '  ' })).toThrow('no-device-token');
  });

  it('a proxy, no token, but a key on this device: the direct fallback still works', () => {
    const t = pickTransport({ proxy: PROXY, token: '', apiKey: KEY });
    expect(t.mode).toBe('direct');
    expect(t.url).toBe(ANTHROPIC_MESSAGES_URL);
  });

  it('no proxy and no key: no-key, exactly as before', () => {
    expect(() => pickTransport({ proxy: '', token: '', apiKey: '' })).toThrow('no-key');
    expect(() => pickTransport({ proxy: '', token: '', apiKey: '   ' })).toThrow('no-key');
    expect(() => pickTransport()).toThrow('no-key');
  });
});

describe('what each request carries', () => {
  it('the proxy request carries x-pd-device and no key header of any kind', () => {
    const { headers } = pickTransport({ proxy: PROXY, token: TOKEN, apiKey: KEY });
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-pd-device']).toBe(TOKEN);
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['anthropic-version']).toBeUndefined();
    expect(headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });

  it('the key appears nowhere in a proxy request — not a header, not the URL', () => {
    const t = pickTransport({ proxy: PROXY, token: TOKEN, apiKey: KEY });
    expect(JSON.stringify(t)).not.toContain(KEY);
  });

  it('the device token travels in a header, never in the URL', () => {
    const t = pickTransport({ proxy: PROXY, token: TOKEN, apiKey: '' });
    expect(t.url).not.toContain(TOKEN);
    expect(t.url).toBe(`${PROXY}${MESSAGES_PATH}`);
  });

  it('the fallback request carries the key and no device header', () => {
    const { headers, url } = pickTransport({ proxy: '', token: TOKEN, apiKey: ` ${KEY} ` });
    expect(headers['x-api-key']).toBe(KEY); // trimmed
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(headers['x-pd-device']).toBeUndefined();
    expect(url).not.toContain(KEY);
  });

  it('a 401 means the device token on the proxy and the key on the direct call', () => {
    expect(authErrorFor('proxy')).toBe('bad-device-token');
    expect(authErrorFor('direct')).toBe('bad-key');
  });
});

// coachTransport is the wired version: the same rules, reading the constant and
// this device's stored token. While COACH_PROXY is empty it is always direct.
describe('coachTransport, as the callers use it', () => {
  it('is the direct call while no proxy is configured — token stored or not', () => {
    put('localStorage', mem());
    expect(coachTransport(KEY).mode).toBe('direct');
    setDeviceToken(TOKEN);
    const t = coachTransport(KEY);
    expect(t.mode).toBe('direct');
    expect(t.headers['x-pd-device']).toBeUndefined();
  });

  it('still throws no-key with no proxy and no key', () => {
    put('localStorage', mem());
    expect(() => coachTransport('')).toThrow('no-key');
  });
});

// ── the sheets, with a proxy configured ─────────────────────────────────────
//
// The no-proxy sheets are pinned in sessionKey.test.js; this is the other state.
// They are server-rendered with the app context mocked, the same way
// disciplineCard.test.js reads a card's markup without a DOM. COACH_PROXY is a
// constant (vite.config.js imports the same one for the CSP), so "a proxy is
// configured" is set up by loading the sheets again with that one answer
// replaced — the markup and the copy are the real thing.
const app = vi.hoisted(() => ({ value: null }));
vi.mock('../state.jsx', () => ({ useApp: () => app.value }));

const SETTINGS = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const PLAN = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...SETTINGS });
const ATTEMPT = { id: 'a1', status: 'active', createdAt: '2026-09-21T12:00:00.000Z', archivedAt: null, settings: SETTINGS, plan: PLAN, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };

async function sheetsWithProxy(token) {
  vi.resetModules();
  vi.doMock('../proxyConfig.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, COACH_PROXY: PROXY, hasProxy: () => true, getDeviceToken: () => token };
  });
  const { default: SettingsSheet } = await import('../components/SettingsSheet.jsx');
  const { default: CoachSheet } = await import('../components/CoachSheet.jsx');
  return {
    settings: () => {
      app.value = {
        state: ATTEMPT,
        root: { version: 2, device: { apiKey: '' }, activeAttemptId: 'a1', attempts: [ATTEMPT] },
        device: { apiKey: '' },
        api: { updateSettings() {}, updateDevice() { throw new Error('nothing here writes the root'); }, viewAttempt() {}, archiveActive() {} },
        readOnly: false,
      };
      return renderToStaticMarkup(createElement(SettingsSheet, { onClose() {} }));
    },
    coach: () => {
      app.value = { state: ATTEMPT };
      return renderToStaticMarkup(createElement(CoachSheet, { onClose() {}, openSettings() {} }));
    },
  };
}

describe('Settings with a proxy configured', () => {
  afterEach(() => {
    app.value = null;
    vi.doUnmock('../proxyConfig.js');
    vi.resetModules();
  });

  it('offers a device token field nothing will try to autofill as a password', async () => {
    const html = (await sheetsWithProxy('')).settings().toLowerCase();
    for (const attr of ['id="device-token"', 'type="password"', 'autocomplete="off"', 'spellcheck="false"', 'autocapitalize="none"']) {
      expect(html, attr).toContain(attr);
    }
  });

  it('says once per device, not once per session', async () => {
    const html = (await sheetsWithProxy('')).settings();
    expect(html).toContain('Coach connection');
    expect(html).toContain('Entered once per device, not once per session');
    expect(html).toContain('no API key has to live on');
    // Nothing is connected yet, so it must not claim it is.
    expect(html).not.toContain('This device is connected');
  });

  it('shows a connected state once a token is stored, and how to change it', async () => {
    const html = (await sheetsWithProxy(TOKEN)).settings();
    expect(html).toContain('This device is connected');
    expect(html).toContain('clear the field to disconnect this device');
  });

  it('keeps the session key as a labelled fallback, which is what works today', async () => {
    const html = (await sheetsWithProxy(TOKEN)).settings();
    expect(html).toContain('use my own key on this device instead');
    expect(html).toContain('name="anthropic-api-key"');
    expect(html).toContain('Kept for this session only, never saved on this phone');
  });
});

describe('the coach sheet with a proxy configured', () => {
  afterEach(() => {
    app.value = null;
    vi.doUnmock('../proxyConfig.js');
    vi.resetModules();
  });

  it('asks for the device token, not for a key, when this device has none', async () => {
    const html = (await sheetsWithProxy('')).coach();
    expect(html).toContain('Open Settings');
    expect(html).toContain('token in Settings once'); // apostrophes are entities in static markup
    expect(html).toContain('Once per device, not once per session');
    expect(html).not.toContain('your own Claude API key');
    expect(html).not.toContain('Talk to your coach');
  });

  it('opens for chat on the device token alone — no key anywhere', async () => {
    const html = (await sheetsWithProxy(TOKEN)).coach();
    expect(html).toContain('Talk to your coach');
    expect(html).not.toContain('Open Settings');
    expect(html).not.toContain(TOKEN); // the token is never on screen in the coach
  });
});
