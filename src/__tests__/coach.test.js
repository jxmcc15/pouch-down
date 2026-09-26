import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askCoach } from '../coach.js';
import { DEFAULT_SETTINGS, freshRoot, startAttempt, archiveActive, updateAttempt, attemptById } from '../root.js';
import { generatePlan } from '../planGenerator.js';
import { capForDay } from '../plan.js';
import { makeEvent } from '../store.js';

const mealTimes = DEFAULT_SETTINGS.mealTimes;
const pouchAt = (iso) => makeEvent('pouch', null, new Date(iso));

// What the coach would be told about this attempt right now.
async function systemFor(state) {
  let body;
  vi.stubGlobal('fetch', async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ text: 'ok' }] }) };
  });
  await askCoach(state, [{ role: 'user', text: 'How am I doing?' }], 'test-key');
  return body.system;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-21T17:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('coach prompt — facts come from the log, not the calendar', () => {
  it('a past attempt is described as of its last scored day, never as today', async () => {
    // 60 days from Jul 8 (quit day Sep 5), archived Sep 18, opened Sep 21.
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 60, startDate: '2026-07-08', mealTimes });
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-07T12:00:00Z' });
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [pouchAt('2026-07-08T14:00:00Z')] }));
    r = archiveActive(r, '2026-09-18T12:00:00Z');
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).not.toMatch(/nicotine-free/i);
    expect(system).not.toMatch(/day 76/);
    expect(system).not.toContain('2026-09-21');
    expect(system).toMatch(/past attempt/i);
    expect(system).toContain('2026-09-05, day 60 of 60');
  });

  it('past quit day on an active attempt: points at the log, claims nothing', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-01', mealTimes });
    const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-31T12:00:00Z' });
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).not.toMatch(/nicotine-free/i);
    expect(system).toMatch(/past quit day — check the log/i);
  });

  it('an unlogged today is unknown, not zero', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toContain('day 3 of 30');
    expect(system).not.toMatch(/Today[^\n]*: 0\//);
    expect(system).toMatch(/nothing logged yet/i);
  });

  it('a logged today reports used against the cap', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [pouchAt('2026-09-21T14:00:00Z'), pouchAt('2026-09-21T16:30:00Z')] }));
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toContain(`Today: 2 pouches used (cap ${capForDay(plan, 3)}), 0 cravings resisted`);
  });

  it('talks about "the user", never "your" — the coach is "you"', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toMatch(/the user/);
    expect(system).not.toMatch(/\byour\b/i);
    expect(system).not.toMatch(/if you went over/i);
    expect(system).not.toMatch(/james/i);
  });
});

// ── through the proxy ───────────────────────────────────────────────────────
//
// coach.js asks proxyConfig which transport to use, so proxy mode is exercised
// by replacing that one answer with a configured proxy and a stored token.
// Everything else — the body, the error mapping — is the real module. Both
// credentials here are obviously fake and no call leaves the process.
const PROXY = 'https://coach.example.workers.dev';
const DEVICE = 'pd-device-test-token';
const FAKE_KEY = 'sk-ant-test-not-a-real-key';

// token: '' stands for "a proxy is configured but this device hasn't been
// connected yet", which is the state that has to name the fix rather than fail.
async function coachVia({ proxy = PROXY, token = DEVICE } = {}) {
  vi.resetModules();
  vi.doMock('../proxyConfig.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, coachTransport: (apiKey) => actual.pickTransport({ proxy, token, apiKey }) };
  });
  const mod = await import('../coach.js');
  return mod.askCoach;
}

const anAttempt = () => {
  const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
  return attemptById(startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' }), 'a1');
};

const okReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: 'ok' }] }) });

describe('the coach through the proxy', () => {
  afterEach(() => {
    vi.doUnmock('../proxyConfig.js');
    vi.resetModules();
  });

  it('posts to the proxy with the device token and no key of any kind', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchSpy);
    const ask = await coachVia();
    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], FAKE_KEY)).resolves.toBe('ok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${PROXY}/v1/messages`);
    expect(url).not.toContain(DEVICE);
    expect(init.headers['x-pd-device']).toBe(DEVICE);
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['x-api-key']).toBeUndefined();
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
    expect(init.body).not.toContain(DEVICE);
    expect(init.body).not.toContain(FAKE_KEY);
  });

  it('sends exactly the body it sends today — the proxy changes the envelope, not the letter', async () => {
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(init.body); return okReply(); }));
    const state = anAttempt();
    const messages = [{ role: 'user', text: 'How am I doing?' }];
    await askCoach(state, messages, FAKE_KEY); // direct, with the session key
    const ask = await coachVia();
    await ask(state, messages, ''); // proxy, no key at all
    expect(bodies[1]).toBe(bodies[0]);
    expect(Object.keys(JSON.parse(bodies[1]))).toEqual(['model', 'max_tokens', 'system', 'messages']);
  });

  it('maps the proxy 401 to the device token, not to the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: { message: 'unknown device' } }),
    }));
    const ask = await coachVia();
    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], '')).rejects.toThrow('bad-device-token');
  });

  it('passes the proxy’s own message through for anything else', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => ({ error: { message: 'upstream refused' } }),
    }));
    const ask = await coachVia();
    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], '')).rejects.toThrow('upstream refused');
  });

  it('a configured proxy with no device token asks for the token, not for a key', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const ask = await coachVia({ token: '' });
    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], '')).rejects.toThrow('no-device-token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the key when a proxy is configured but this device has no token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchSpy);
    const ask = await coachVia({ token: '' });
    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], FAKE_KEY)).resolves.toBe('ok');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe(FAKE_KEY);
  });
});
