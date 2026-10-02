// The app and the proxy are two programs that must agree on one contract: the
// tool names, the token cap, and the exact bodies the app sends. The Worker
// ships on its own, so it keeps its own copy of each — pinned here to the
// app's, with the REAL bodies askCoach builds run through the Worker's guard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOOLS, TOOL_NAMES, MAX_TOKENS, RESULT_MAX, TOOL_INPUT_MAX, NOTE_MAX, MAX_PROPOSALS, livePouchesForPrompt } from '../coachTools.js';
import { askCoach } from '../coach.js';
import { takeProposals, toTurns, resultsFor } from '../coachActions.js';
import { TOOL_NAMES as WORKER_TOOL_NAMES, LIMITS, checkBody } from '../../workers/coach-proxy/src/guard.js';
import { DEFAULT_SETTINGS, freshRoot, startAttempt, updateAttempt, archiveActive, attemptById } from '../root.js';
import { generatePlan } from '../planGenerator.js';
import { makeEvent } from '../store.js';

const mealTimes = DEFAULT_SETTINGS.mealTimes;
const NOW = Date.parse('2026-09-21T17:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const attemptWith = (startDate, events) => {
  const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate, mealTimes });
  let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: `${startDate}T00:00:00Z` });
  r = updateAttempt(r, 'a1', (a) => ({ ...a, events }));
  return attemptById(r, 'a1');
};
const active = () => attemptWith('2026-09-19', [makeEvent('pouch', null, new Date('2026-09-21T14:00:00Z'))]);

// Every body askCoach posts, as the raw string the Worker would receive.
function captureBodies() {
  const bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  }));
  return bodies;
}

const bytes = (text) => new TextEncoder().encode(text).length;
// The Worker's character count, the same sum checkBody makes: the system
// prompt, string contents, text blocks, and each block's counted fields.
function chars(raw) {
  const body = JSON.parse(raw);
  let n = body.system?.length ?? 0;
  for (const m of body.messages) {
    if (typeof m.content === 'string') { n += m.content.length; continue; }
    for (const b of m.content) {
      if (b.type === 'text') n += b.text.length;
      else if (b.type === 'tool_use') n += b.id.length + b.name.length + JSON.stringify(b.input).length;
      else n += b.tool_use_id.length + b.content.length;
    }
  }
  return n;
}

describe('the Worker and the app agree', () => {
  it('on the tool names (same set, same order) and the caps', () => {
    expect(new Set(WORKER_TOOL_NAMES)).toEqual(new Set(TOOL_NAMES));
    expect(WORKER_TOOL_NAMES).toEqual(TOOL_NAMES);
    expect(LIMITS.maxTokens).toBe(MAX_TOKENS);
    expect(LIMITS.tools).toBeGreaterThanOrEqual(TOOLS.length);
    expect(LIMITS.toolResult).toBe(RESULT_MAX);
    expect(LIMITS.toolInput).toBe(TOOL_INPUT_MAX);
  });

  it('every tool the app sends fits the Worker\'s per-tool clamps (characters, as the Worker counts)', () => {
    for (const t of TOOLS) {
      const schema = JSON.stringify(t.input_schema).length;
      expect(t.description.length, `${t.name} description: ${t.description.length} of ${LIMITS.toolDescription} chars, margin ${LIMITS.toolDescription - t.description.length}`)
        .toBeLessThanOrEqual(LIMITS.toolDescription);
      expect(schema, `${t.name} input_schema: ${schema} of ${LIMITS.toolSchema} chars, margin ${LIMITS.toolSchema - schema}`)
        .toBeLessThanOrEqual(LIMITS.toolSchema);
    }
  });

  it('the app\'s real bodies pass checkBody: first turn, follow-up, typed-while-pending, past attempt', async () => {
    const bodies = captureBodies();
    const state = active();
    const pouchId = state.events[0].id;
    const proposals = [
      { id: 'toolu_01', name: 'add_late_pouch', input: { day: '2026-09-21', time: '08:30', triggers: ['boredom'], note: '' } },
      { id: 'toolu_02', name: 'mark_mistake', input: { pouch_id: 'not-a-real-id' } },
      { id: 'toolu_03', name: 'add_reason', input: { pouch_id: pouchId, triggers: ['stress'], note: '' } },
    ];
    const { cards, overflow } = takeProposals(state, proposals, NOW);
    const coach = { role: 'assistant', text: 'Three cards.', proposals, cards, overflow };
    const user = { role: 'user', text: 'had one at 8:30, boredom' };

    await askCoach(state, toTurns([user]), 'test-key');
    const saved = { ...coach, cards: cards.map((c) => (c.status === 'pending' ? { ...c, status: 'saved', eventId: 'e1' } : c)) };
    await askCoach(state, toTurns([user, saved, { role: 'user', text: 'Confirmed: …', results: resultsFor(saved), auto: true }]), 'test-key');
    const skipped = { ...coach, cards: cards.map((c) => (c.status === 'pending' ? { ...c, status: 'skipped' } : c)) };
    await askCoach(state, toTurns([user, skipped, { role: 'user', text: 'never mind', results: resultsFor(skipped) }]), 'test-key');
    const r = archiveActive(startAttempt(freshRoot(), { plan: state.plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' }), '2026-09-20T12:00:00Z');
    await askCoach(attemptById(r, 'a1'), toTurns([user]), 'test-key');

    expect(bodies).toHaveLength(4);
    for (const raw of bodies) expect(checkBody(raw)).toMatchObject({ ok: true });
    expect(JSON.parse(bodies[1]).messages[1].content.map((b) => b.type)).toEqual(['text', 'tool_use', 'tool_use', 'tool_use']);
    expect(JSON.parse(bodies[1]).messages[2].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'tool_result']);
    expect(JSON.parse(bodies[2]).messages[2].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'tool_result', 'text']);
    expect(JSON.parse(bodies[2]).messages[2].content.slice(0, 3).filter((b) => b.content === 'skipped by the user')).toHaveLength(2);
    expect('tools' in JSON.parse(bodies[0])).toBe(true);
    expect('tools' in JSON.parse(bodies[3])).toBe(false);
  });

  it('the worst realistic body fits: 60 pouch rows, 40 messages, five tool calls with full notes', async () => {
    const bodies = captureBodies();
    // 60 pouches with reasons across the last seven app days: the prompt's cap.
    const events = Array.from({ length: 60 }, (_, i) => {
      const at = new Date(Date.parse('2026-09-15T12:00:00Z') + i * 2.4 * 3600000);
      return makeEvent('pouch', 'stress', at);
    });
    const state = attemptWith('2026-09-15', events);
    expect(livePouchesForPrompt(state, NOW)).toHaveLength(60);

    const note = 'n'.repeat(NOTE_MAX);
    const proposals = Array.from({ length: MAX_PROPOSALS }, (_, i) => ({
      id: `toolu_01ABCDEFGHJKLMNPQRSTUV${i}`,
      name: 'add_reason',
      input: { pouch_id: events[59 - i].id, triggers: ['stress', 'boredom', 'coffee'], note },
    }));
    const { cards, overflow } = takeProposals(state, proposals, NOW);
    expect(cards.map((c) => c.status)).toEqual(Array(MAX_PROPOSALS).fill('pending'));
    const said = (role, i) => ({ role, text: `${role} ${i}: ${'a few hundred characters of talk. '.repeat(9)}`.slice(0, 300) });

    // 38 plain turns, then the coach's five proposals, then a typed answer.
    const messages = Array.from({ length: 38 }, (_, i) => said(i % 2 ? 'assistant' : 'user', i));
    const coach = { role: 'assistant', text: said('assistant', 38).text, proposals, cards, overflow };
    messages.push(coach, { role: 'user', text: said('user', 39).text, results: resultsFor(coach) });
    await askCoach(state, toTurns(messages), 'test-key');

    const [raw] = bodies;
    const body = JSON.parse(raw);
    expect(body.messages).toHaveLength(LIMITS.messages);
    expect(body.messages[38].content.filter((b) => b.type === 'tool_use')).toHaveLength(MAX_PROPOSALS);
    const size = bytes(raw);
    const n = chars(raw);
    expect(size, `body ${size} of ${LIMITS.bodyBytes} bytes, margin ${LIMITS.bodyBytes - size}`).toBeLessThanOrEqual(LIMITS.bodyBytes);
    expect(n, `conversation ${n} of ${LIMITS.totalChars} chars, margin ${LIMITS.totalChars - n}`).toBeLessThanOrEqual(LIMITS.totalChars);
    expect(checkBody(raw)).toMatchObject({ ok: true });
  });
});
