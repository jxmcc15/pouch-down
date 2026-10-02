import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { askCoach } from '../coach.js';
import { DEFAULT_SETTINGS, freshRoot, startAttempt, archiveActive, updateAttempt, attemptById } from '../root.js';
import { generatePlan } from '../planGenerator.js';
import { capForDay } from '../plan.js';
import { makeEvent } from '../store.js';
import { TOOL_NAMES } from '../coachTools.js';
import { toTurns } from '../coachActions.js';

const mealTimes = DEFAULT_SETTINGS.mealTimes;
const pouchAt = (iso) => makeEvent('pouch', null, new Date(iso));

// What the coach would be told about this attempt right now.
async function systemFor(state) {
  let body;
  vi.stubGlobal('fetch', async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  });
  await askCoach(state, [{ role: 'user', content: 'How am I doing?' }], 'test-key');
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

// ── what the coach can and can't do ─────────────────────────────────────────
//
// An active attempt's coach proposes; the user confirms every card. A past
// attempt's coach can only talk, and is told where the real fix lives. The
// prompt has to stay small enough that the proxy's body cap still leaves room
// for the conversation.
describe('coach prompt — honest about what it can do', () => {
  it('an active attempt: proposes, the user confirms, never claims a card is done', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toContain('you can propose these actions; the user confirms each on a card in the app, and nothing is saved until they do');
    expect(system).toContain("You can't change settings, the plan, or the attempt");
    expect(system).toContain('Fix this day');
    expect(system).not.toContain('cannot add, change, backfill or tag');
    for (const rule of [
      'Propose only what the user clearly asked for or clearly stated as a fact. A guess is a question, not a card.',
      'Never mark_mistake unless the user says a tap was an accident. Never add_late_pouch for a pouch already in the list.',
      'Give a day as YYYY-MM-DD and a time as HH:MM 24h on that day; "4:30" in the evening means 16:30; before 4 AM belongs to the previous app day (the app handles it — just name the day the user means). Use null when the user doesn\'t remember the time.',
      'fill_missed_day within cap: ask whether the streak keeps or breaks before proposing, unless the user said.',
      'At most 5 actions in a reply. Say in one short sentence what each card does; the card is the confirmation, so never claim it is done.',
      'After a tool result: one short line. "4:30 is in." / "That one didn\'t save — the app says it\'s already logged." Nothing is done until the result says saved.',
    ]) expect(system).toContain(rule);
    expect(system).not.toMatch(/\byour\b/i);
  });

  it('a past attempt keeps the read-only wording: cannot change anything, never claims a change', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 60, startDate: '2026-07-08', mealTimes });
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-07T12:00:00Z' });
    r = archiveActive(r, '2026-09-18T12:00:00Z');
    const system = await systemFor(attemptById(r, 'a1'));
    expect(system).toContain('cannot add, change, backfill or tag');
    expect(system).toContain('Never claim a change was made');
    expect(system).toContain("Fix this day (add a pouch you missed, with its time or 'unknown'; mark an accidental tap as a mistake; correct a past total; add reasons)");
    expect(system).not.toContain('Tool rules');
    expect(system).not.toMatch(/\byour\b/i);
  });

  it('a week of fully logged days keeps the system prompt under 10 KB and the body under 20 KB', async () => {
    // 30-day plan, day 1 = Sep 15, so today (Sep 21) is day 7 and the log
    // window holds seven days. Every day is as heavy as the data model allows:
    // ten tagged pouches, a reason on each, and a correction raising the total.
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-15', mealTimes });
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-14T12:00:00Z' });
    const days = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'];
    const TAGS = ['after-meal', 'coffee', 'driving', 'stress', 'boredom', 'social'];
    const events = [];
    days.forEach((day, i) => {
      // Sep 20 and today have 4 timed pouches corrected to 10; the rest have 10 corrected to 12.
      const light = day === '2026-09-20' || day === '2026-09-21';
      const timed = light ? 4 : 10;
      for (let k = 0; k < timed; k++) {
        // 13:00Z onward = 08:00 Chicago onward, 25 minutes apart, all on `day`.
        const at = new Date(Date.parse(`${day}T13:00:00Z`) + k * 25 * 60000);
        const p = makeEvent('pouch', TAGS[(i + k) % TAGS.length], at);
        events.push(p);
        const later = new Date(at.getTime() + 60000);
        events.push({ ...makeEvent('reason', null, later), day, target: p.id, triggers: [TAGS[k % TAGS.length], TAGS[(k + 2) % TAGS.length]], note: 'a note about why this one happened' });
      }
      events.push({ ...makeEvent('correction', null, new Date(`${day}T16:59:00Z`)), day, count: light ? 10 : 12 });
    });
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events }));
    let body;
    vi.stubGlobal('fetch', async (_url, init) => { body = init.body; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; });
    await askCoach(attemptById(r, 'a1'), [{ role: 'user', content: 'How am I doing?' }], 'test-key');
    const system = JSON.parse(body).system;
    expect(system.length).toBeLessThan(10000);
    expect(body.length).toBeLessThan(20000);
    expect(system).toMatch(/\| 2026-09-20 \| \d+ \| 10\* \(4\) \|/);
    expect(system).toContain(`Today: 10 pouches used (cap ${capForDay(plan, 7)})`);
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

const okReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) });

describe('the coach through the proxy', () => {
  afterEach(() => {
    vi.doUnmock('../proxyConfig.js');
    vi.resetModules();
  });

  it('posts to the proxy with the device token and no key of any kind', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchSpy);
    const ask = await coachVia();
    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], FAKE_KEY)).resolves.toMatchObject({ text: 'ok' });
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
    const turns = [{ role: 'user', content: 'How am I doing?' }];
    await askCoach(state, turns, FAKE_KEY); // direct, with the session key
    const ask = await coachVia();
    await ask(state, turns, ''); // proxy, no key at all
    expect(bodies[1]).toBe(bodies[0]);
    expect(Object.keys(JSON.parse(bodies[1]))).toEqual(['model', 'max_tokens', 'system', 'tools', 'messages']);
  });

  it('maps the proxy 401 to the device token, not to the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, json: async () => ({ error: { message: 'unknown device' } }),
    }));
    const ask = await coachVia();
    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], '')).rejects.toThrow('bad-device-token');
  });

  it('passes the proxy’s own message through for anything else', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => ({ error: { message: 'upstream refused' } }),
    }));
    const ask = await coachVia();
    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], '')).rejects.toThrow('upstream refused');
  });

  it('a configured proxy with no device token asks for the token, not for a key', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const ask = await coachVia({ token: '' });
    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], '')).rejects.toThrow('no-device-token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the key when a proxy is configured but this device has no token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okReply());
    vi.stubGlobal('fetch', fetchSpy);
    const ask = await coachVia({ token: '' });
    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], FAKE_KEY)).resolves.toMatchObject({ text: 'ok' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe(FAKE_KEY);
  });
});

// ── tools: the request and the reply ────────────────────────────────────────
//
// The body is the contract with both transports and with the proxy's clamps;
// the reply is untrusted, so parsing only sorts it into words and proposals.
describe('the coach request carries tools; the reply splits into words and proposals', () => {
  const capture = (reply) => {
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => reply }; }));
    return bodies;
  };
  const withPouches = () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [pouchAt('2026-09-21T14:00:00Z'), pouchAt('2026-09-20T19:30:00Z')] }));
    return attemptById(r, 'a1');
  };

  it('an active attempt: tools = the eight, max_tokens 800, messages exactly as given', async () => {
    const bodies = capture({ content: [{ type: 'text', text: 'ok' }] });
    const turns = [{ role: 'user', content: 'hi' }];
    await askCoach(withPouches(), turns, 'test-key');
    expect(bodies[0].max_tokens).toBe(800);
    expect(bodies[0].tools.map((t) => t.name)).toEqual(TOOL_NAMES);
    expect(bodies[0].messages).toEqual(turns);
  });

  it('a replayed chat goes out exactly as toTurns built it — an unknown tool and its result already gone', async () => {
    const bodies = capture({ content: [{ type: 'text', text: 'ok' }] });
    const input = { day: '2026-09-21', time: '08:30', triggers: [], note: '' };
    const turns = toTurns([
      { role: 'user', text: 'had one at 8:30' },
      { role: 'assistant', text: 'Confirm and it\'s in.', proposals: [{ id: 'toolu_1', name: 'add_late_pouch', input }, { id: 'toolu_2', name: 'set_quit_date', input: {} }] },
      { role: 'user', text: 'Confirmed: …', auto: true, results: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' },
        { type: 'tool_result', tool_use_id: 'toolu_2', content: 'invalid: not a tool', is_error: true },
      ] },
    ]);
    await askCoach(withPouches(), turns, 'test-key');
    expect(bodies[0].messages).toEqual([
      { role: 'user', content: 'had one at 8:30' },
      { role: 'assistant', content: [{ type: 'text', text: 'Confirm and it\'s in.' }, { type: 'tool_use', id: 'toolu_1', name: 'add_late_pouch', input }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' }] },
    ]);
  });

  it('a past attempt: no tools at all, and a stray tool_use in the reply is dropped', async () => {
    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 60, startDate: '2026-07-08', mealTimes });
    const r = archiveActive(startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-07T12:00:00Z' }), '2026-09-18T12:00:00Z');
    const bodies = capture({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'toolu_1', name: 'log_pouch_now', input: {} }] });
    const out = await askCoach(attemptById(r, 'a1'), [{ role: 'user', content: 'hi' }], 'test-key');
    expect('tools' in bodies[0]).toBe(false);
    expect(Object.keys(bodies[0])).toEqual(['model', 'max_tokens', 'system', 'messages']);
    expect(out).toEqual({ text: 'ok', proposals: [], stopReason: null });
  });

  it('text + two tool_use blocks: words joined, proposals in order, stop reason kept', async () => {
    capture({ stop_reason: 'tool_use', content: [
      { type: 'text', text: 'Here are both.' },
      { type: 'tool_use', id: 'toolu_1', name: 'add_late_pouch', input: { day: '2026-09-21', time: '08:30', triggers: [], note: '' } },
      { type: 'text', text: '  Confirm and they are in. ' },
      { type: 'tool_use', id: 'toolu_2', name: 'log_resisted_now', input: { trigger: 'stress' } },
    ] });
    expect(await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'test-key')).toEqual({
      text: 'Here are both.\n\nConfirm and they are in.',
      proposals: [
        { id: 'toolu_1', name: 'add_late_pouch', input: { day: '2026-09-21', time: '08:30', triggers: [], note: '' } },
        { id: 'toolu_2', name: 'log_resisted_now', input: { trigger: 'stress' } },
      ],
      stopReason: 'tool_use',
    });
  });

  it('text only, tool_use only, and nothing at all', async () => {
    capture({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Steady.' }] });
    expect(await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k')).toEqual({ text: 'Steady.', proposals: [], stopReason: 'end_turn' });
    capture({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'log_pouch_now', input: {} }] });
    expect(await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k')).toMatchObject({ text: '', proposals: [{ id: 'toolu_1' }] });
    capture({ content: [] });
    expect((await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k')).text).toBe('…');
  });

  it('the prompt names Now and every id the coach may point at', async () => {
    const state = withPouches();
    const ids = state.events.map((e) => e.id);
    const system = await systemFor(state);
    expect(system).toContain('Now: Mon 2026-09-21, 12:00 on the user\'s clock.');
    expect(system).toContain('These ids are the only ones you may name in a tool:');
    expect(system).toContain(`- ${ids[0]} · 2026-09-21 · 09:00 · no trigger`);
    expect(system).toContain(`- ${ids[1]} · 2026-09-20 · 14:30 · no trigger`);
  });

  it('no tool names a forbidden action', async () => {
    const bodies = capture({ content: [{ type: 'text', text: 'ok' }] });
    await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k');
    for (const t of bodies[0].tools) expect(t.name).not.toMatch(/attempt|plan|quit|setting|token|key|recover|price|meal/);
  });
});
