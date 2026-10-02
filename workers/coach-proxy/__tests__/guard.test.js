// Every rule the proxy enforces, checked without a network or a Worker runtime.
// guard.js is pure on purpose so this file can be plain unit tests.
//
// Every token and key in here is obviously fake. Real ones live only as Worker
// secrets in James's Cloudflare account and are never written down anywhere.

import { describe, it, expect } from 'vitest';
import {
  allowedOrigin,
  tokenOk,
  checkBody,
  corsHeaders,
  LIMITS,
  TOOL_NAMES,
} from '../src/guard.js';

const ORIGINS = 'https://jxmcc15.github.io, http://localhost:5173';

// 24 bytes of hex is what `openssl rand -hex 24` prints. These two are the same
// length on purpose: a wrong token must not be refused just for its length.
const GOOD = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';
const WRONG_SAME_LENGTH = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f1';
const SECOND = 'abababababababababababababababababababababababab0';
const TOKENS = `${GOOD},${SECOND}`;

const MODEL = 'claude-haiku-4-5-20251001';
const byteLen = (text) => new TextEncoder().encode(text).length;

function validBody(over = {}) {
  return JSON.stringify({
    model: MODEL,
    max_tokens: 400,
    system: 'You are a warm, direct coach.',
    messages: [{ role: 'user', content: 'I want a pouch.' }],
    ...over,
  });
}

describe('allowedOrigin', () => {
  it('allows an origin that is on the list', () => {
    expect(allowedOrigin('https://jxmcc15.github.io', ORIGINS)).toBe(true);
    expect(allowedOrigin('http://localhost:5173', ORIGINS)).toBe(true);
  });

  it('refuses an origin that is not on the list', () => {
    expect(allowedOrigin('https://evil.example', ORIGINS)).toBe(false);
  });

  it('refuses a near miss — scheme, host and port all have to match', () => {
    expect(allowedOrigin('http://jxmcc15.github.io', ORIGINS)).toBe(false);
    expect(allowedOrigin('https://jxmcc15.github.io.evil.example', ORIGINS)).toBe(false);
    expect(allowedOrigin('https://jxmcc15.github.io/', ORIGINS)).toBe(false);
  });

  it('refuses a missing origin, and refuses everything when the list is empty', () => {
    expect(allowedOrigin(null, ORIGINS)).toBe(false);
    expect(allowedOrigin('', ORIGINS)).toBe(false);
    expect(allowedOrigin('https://jxmcc15.github.io', '')).toBe(false);
    expect(allowedOrigin('https://jxmcc15.github.io', undefined)).toBe(false);
  });
});

describe('tokenOk', () => {
  it('accepts a token that is on the list, in any position', () => {
    expect(tokenOk(GOOD, TOKENS)).toBe(true);
    expect(tokenOk(SECOND, TOKENS)).toBe(true);
  });

  it('refuses a missing token', () => {
    expect(tokenOk(null, TOKENS)).toBe(false);
    expect(tokenOk('', TOKENS)).toBe(false);
    expect(tokenOk(undefined, TOKENS)).toBe(false);
  });

  it('refuses a wrong token of exactly the same length', () => {
    expect(tokenOk(WRONG_SAME_LENGTH, TOKENS)).toBe(false);
  });

  it('refuses a prefix of a good token, and refuses a good token with extra on the end', () => {
    expect(tokenOk(GOOD.slice(0, -1), TOKENS)).toBe(false);
    expect(tokenOk(`${GOOD}0`, TOKENS)).toBe(false);
  });

  it('refuses everything when no tokens are configured', () => {
    expect(tokenOk(GOOD, '')).toBe(false);
    expect(tokenOk(GOOD, undefined)).toBe(false);
    expect(tokenOk('', '')).toBe(false);
  });

  it('tolerates spaces around the commas in the configured list', () => {
    expect(tokenOk(GOOD, ` ${GOOD} , ${SECOND} `)).toBe(true);
  });
});

describe('checkBody — the happy path', () => {
  it('passes a valid request through with its body intact', () => {
    const r = checkBody(validBody());
    expect(r.ok).toBe(true);
    expect(r.status).toBeUndefined();
    expect(r.body).toEqual({
      model: MODEL,
      max_tokens: 400,
      system: 'You are a warm, direct coach.',
      messages: [{ role: 'user', content: 'I want a pouch.' }],
    });
  });

  it('allows max_tokens exactly at the cap, and a body with no system prompt', () => {
    expect(checkBody(validBody({ max_tokens: LIMITS.maxTokens })).ok).toBe(true);
    const noSystem = JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const r = checkBody(noSystem);
    expect(r.ok).toBe(true);
    expect('system' in r.body).toBe(false);
  });

  it('allows a whole conversation, user and assistant turns alike', () => {
    const messages = [
      { role: 'user', content: 'rough morning' },
      { role: 'assistant', content: 'Cravings are waves.' },
      { role: 'user', content: 'ok' },
    ];
    expect(checkBody(validBody({ messages })).ok).toBe(true);
  });
});

describe('checkBody — what it refuses', () => {
  it('refuses a body that is not JSON', () => {
    const r = checkBody('not json at all');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/JSON/i);
  });

  it('refuses JSON that is not an object', () => {
    expect(checkBody('[]').status).toBe(400);
    expect(checkBody('null').status).toBe(400);
    expect(checkBody('"hello"').status).toBe(400);
    expect(checkBody('').status).toBe(400);
  });

  it('refuses a model that is not the one allowed model', () => {
    const r = checkBody(validBody({ model: 'claude-opus-4-1-20250805' }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/model/i);
  });

  it('refuses a missing or non-string model', () => {
    expect(checkBody(validBody({ model: undefined })).status).toBe(400);
    expect(checkBody(validBody({ model: 7 })).status).toBe(400);
  });

  it('refuses max_tokens over the cap', () => {
    const r = checkBody(validBody({ max_tokens: LIMITS.maxTokens + 1 }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/max_tokens/);
  });

  it('refuses a max_tokens that is missing, zero, negative or not a whole number', () => {
    expect(checkBody(validBody({ max_tokens: undefined })).status).toBe(400);
    expect(checkBody(validBody({ max_tokens: 0 })).status).toBe(400);
    expect(checkBody(validBody({ max_tokens: -5 })).status).toBe(400);
    expect(checkBody(validBody({ max_tokens: 12.5 })).status).toBe(400);
    expect(checkBody(validBody({ max_tokens: '400' })).status).toBe(400);
  });

  it('refuses a field that is not one of the five allowed ones', () => {
    const r = checkBody(validBody({ temperature: 1 }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toBe("Request body has a field the app doesn't send.");
  });

  it('names no part of the input when it refuses a field — the caller wrote it', () => {
    const r = checkBody(validBody({ 'x-pd-device-echo': 1 }));
    expect(r.message).toBe("Request body has a field the app doesn't send.");
    const m = checkBody(validBody({ messages: [{ role: 'user', content: 'hi', 'x-pd-device-echo': 1 }] }));
    expect(m.message).toBe("A message has a field the app doesn't send.");
    expect(`${r.message}${m.message}`).not.toContain('echo');
  });

  it('refuses extra fields whatever they are called', () => {
    expect(checkBody(validBody({ stream: true })).status).toBe(400);
    expect(checkBody(validBody({ tool_choice: { type: 'any' } })).status).toBe(400);
    expect(checkBody(validBody({ metadata: { user_id: 'x' } })).status).toBe(400);
  });

  it('refuses a body over the size cap', () => {
    const big = JSON.stringify({
      model: MODEL,
      max_tokens: 100,
      messages: [{ role: 'user', content: 'x'.repeat(LIMITS.bodyBytes) }],
    });
    const r = checkBody(big);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/large/i);
  });

  it('refuses too many messages', () => {
    const messages = Array.from({ length: LIMITS.messages + 1 }, () => ({
      role: 'user',
      content: 'hi',
    }));
    const r = checkBody(validBody({ messages }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/messages/i);
  });

  it('refuses more total text than the character cap, even inside the size cap', () => {
    // Split across messages so no single one is suspicious, and check the cap
    // counts the whole conversation plus the system prompt.
    const each = 'y'.repeat(4000);
    const messages = Array.from({ length: 20 }, () => ({ role: 'user', content: each }));
    const r = checkBody(JSON.stringify({ model: MODEL, max_tokens: 100, messages }), {
      bodyBytes: 1024 * 1024,
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/long|characters/i);
  });

  it('refuses malformed messages', () => {
    expect(checkBody(validBody({ messages: [] })).status).toBe(400);
    expect(checkBody(validBody({ messages: 'hi' })).status).toBe(400);
    expect(checkBody(validBody({ messages: [{ role: 'system', content: 'x' }] })).status).toBe(400);
    expect(checkBody(validBody({ messages: [{ role: 'user' }] })).status).toBe(400);
    expect(checkBody(validBody({ messages: [{ role: 'user', content: 12 }] })).status).toBe(400);
    expect(checkBody(validBody({ messages: [{ role: 'user', content: '' }] })).status).toBe(400);
    expect(
      checkBody(validBody({ messages: [{ role: 'user', content: 'x', name: 'x' }] })).status,
    ).toBe(400);
  });

  it('refuses a system prompt that is not a string', () => {
    expect(checkBody(validBody({ system: 42 })).status).toBe(400);
    expect(checkBody(validBody({ system: [{ type: 'text', text: 'x' }] })).status).toBe(400);
  });

  it('never names the model allowlist in a way that leaks a secret', () => {
    // Belt and braces: no refusal message may contain anything token-shaped.
    const refusals = [
      checkBody('nope'),
      checkBody(validBody({ model: 'x' })),
      checkBody(validBody({ temperature: 1 })),
    ];
    for (const r of refusals) {
      expect(r.message).not.toContain(GOOD);
      expect(r.message).not.toMatch(/api[-_]?key/i);
    }
  });
});

describe('corsHeaders', () => {
  it('echoes the origin only when it is allowed', () => {
    const ok = corsHeaders('https://jxmcc15.github.io', ORIGINS);
    expect(ok['access-control-allow-origin']).toBe('https://jxmcc15.github.io');

    const nope = corsHeaders('https://evil.example', ORIGINS);
    expect(nope['access-control-allow-origin']).toBeUndefined();
  });

  it('names only the method and headers the app actually uses', () => {
    const h = corsHeaders('https://jxmcc15.github.io', ORIGINS);
    expect(h['access-control-allow-methods']).toBe('POST, OPTIONS');
    expect(h['access-control-allow-headers']).toBe('content-type, x-pd-device');
    expect(Number(h['access-control-max-age'])).toBeGreaterThan(0);
  });

  it('always varies on Origin, so a cache never serves one site another answer', () => {
    expect(corsHeaders('https://jxmcc15.github.io', ORIGINS).vary).toBe('Origin');
    expect(corsHeaders('https://evil.example', ORIGINS).vary).toBe('Origin');
    expect(corsHeaders(null, ORIGINS).vary).toBe('Origin');
  });

  it('never allows credentials', () => {
    for (const origin of ['https://jxmcc15.github.io', 'https://evil.example', null]) {
      expect(corsHeaders(origin, ORIGINS)['access-control-allow-credentials']).toBeUndefined();
    }
  });
});

describe('LIMITS', () => {
  it('is the one place the caps are written down', () => {
    expect(LIMITS.maxTokens).toBe(800);
    expect(LIMITS.bodyBytes).toBe(48 * 1024);
    expect(LIMITS.messages).toBe(40);
    expect(LIMITS.totalChars).toBe(60 * 1024);
    expect(LIMITS.models).toEqual([MODEL]);
    expect(LIMITS.fields).toEqual(['model', 'max_tokens', 'system', 'tools', 'messages']);
    expect(LIMITS).toMatchObject({ tools: 8, toolDescription: 1024, toolSchema: 4096, blocks: 12, toolInput: 2048, toolResult: 500 });
    expect(TOOL_NAMES).toEqual(['log_pouch_now', 'log_resisted_now', 'add_late_pouch', 'mark_mistake', 'add_reason', 'fill_missed_day', 'correct_day_total', 'log_checkin']);
  });
});

// ── the coach as app assistant (2026-10-02) ─────────────────────────────────
//
// The app now sends its eight tools, replays the coach's tool calls, and
// answers them with tool results. Every one of those is clamped here, and the
// bodies below are the app's exact shapes, written out as literals so this file
// runs on its own (coachProxyPin.test.js checks the app's REAL bodies).

const tool = (name, over = {}) => ({
  name,
  description: 'Propose logging a pouch the user is taking right now.',
  input_schema: { type: 'object', properties: { trigger: { type: 'string', enum: ['coffee', 'stress'] } }, required: [], additionalProperties: false },
  ...over,
});
const TOOLS = TOOL_NAMES.map((n) => tool(n));
const USE = { type: 'tool_use', id: 'toolu_01', name: 'add_late_pouch', input: { day: '2026-10-01', time: '16:30', triggers: ['boredom'], note: '' } };
const RESULT = { type: 'tool_result', tool_use_id: 'toolu_01', content: 'saved' };
const withTools = (messages, over = {}) => validBody({ max_tokens: 800, tools: TOOLS, messages, ...over });
const FIRST = [{ role: 'user', content: 'had one at 4:30 I forgot, boredom' }];
const PROPOSED = [...FIRST, { role: 'assistant', content: [{ type: 'text', text: "Here's that 4:30 one — confirm and it's in." }, USE] }];

describe('checkBody — the app\'s exact bodies', () => {
  it('text-only, as a chat with no actions sends it (tools offered, none called)', () => {
    expect(checkBody(withTools(FIRST)).ok).toBe(true);
  });
  it('the follow-up: the coach\'s tool call replayed, then a user turn of only tool results', () => {
    expect(checkBody(withTools([...PROPOSED, { role: 'user', content: [RESULT] }])).ok).toBe(true);
  });
  it('a typed turn that answers pending cards: results first, then the text; an error result too', () => {
    const skipped = { type: 'tool_result', tool_use_id: 'toolu_01', content: 'invalid: unknown action', is_error: true };
    expect(checkBody(withTools([...PROPOSED, { role: 'user', content: [skipped, { type: 'text', text: 'never mind' }] }])).ok).toBe(true);
  });
  it('a past attempt: no tools field at all', () => {
    expect(checkBody(validBody({ max_tokens: 800 })).ok).toBe(true);
  });
});

describe('checkBody — the new clamps', () => {
  it('max_tokens 800 passes, 801 does not', () => {
    expect(checkBody(withTools(FIRST, { max_tokens: 800 })).ok).toBe(true);
    expect(checkBody(withTools(FIRST, { max_tokens: 801 })).message).toBe('max_tokens must be 800 or less.');
  });
  it('a body of exactly 48 KB passes; one byte more does not', () => {
    const at = (n) => {
      const base = withTools([{ role: 'user', content: '' }]);
      return base.replace('"content":""', `"content":"${'x'.repeat(n - byteLen(base))}"`);
    };
    expect(byteLen(at(LIMITS.bodyBytes))).toBe(LIMITS.bodyBytes);
    expect(checkBody(at(LIMITS.bodyBytes)).ok).toBe(true);
    expect(checkBody(at(LIMITS.bodyBytes + 1)).message).toBe('Request body is too large.');
  });
  it('tools: an empty list, nine tools, a name the app lacks, a repeated name', () => {
    expect(checkBody(withTools(FIRST, { tools: [] })).message).toBe('tools must be a non-empty array.');
    expect(checkBody(withTools(FIRST, { tools: [...TOOLS, tool('log_pouch_now')] })).message).toBe('Too many tools — 8 at most.');
    expect(checkBody(withTools(FIRST, { tools: [tool('update_settings')] })).message).toBe('That tool is not allowed.');
    expect(checkBody(withTools(FIRST, { tools: [tool('mark_mistake'), tool('mark_mistake')] })).message).toBe('That tool is not allowed.');
  });
  it('tools: an extra key, a long description, a big or non-object schema', () => {
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { cache_control: { type: 'ephemeral' } })] })).status).toBe(400);
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { description: 'x'.repeat(1025) })] })).message).toBe('A tool description is missing or too long.');
    const big = { type: 'object', properties: { note: { type: 'string', description: 'x'.repeat(4096) } } };
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { input_schema: big })] })).message).toBe('A tool input_schema is missing or too large.');
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { input_schema: { type: 'string' } })] })).status).toBe(400);
  });
  it('a tool_use in a user message, or a tool_result in an assistant message', () => {
    expect(checkBody(withTools([{ role: 'user', content: [USE] }])).message).toBe('Only the assistant can call a tool.');
    expect(checkBody(withTools([...FIRST, { role: 'assistant', content: [RESULT] }])).message).toBe('Only the user can return a tool result.');
  });
  it('a tool_use naming a tool the app lacks, a big input, a non-object input, an extra key', () => {
    const asCoach = (b) => withTools([...FIRST, { role: 'assistant', content: [b] }]);
    expect(checkBody(asCoach({ ...USE, name: 'start_attempt' })).message).toBe('That tool is not allowed.');
    expect(checkBody(asCoach({ ...USE, input: { note: 'x'.repeat(2048) } })).message).toBe('A tool_use input is too large.');
    expect(checkBody(asCoach({ ...USE, input: 'log it' })).message).toBe('A tool_use input must be an object.');
    expect(checkBody(asCoach({ ...USE, cache_control: { type: 'ephemeral' } })).status).toBe(400);
  });
  it('a tool_result with long content, no content, a non-boolean is_error, an extra key', () => {
    const asUser = (b) => withTools([...PROPOSED, { role: 'user', content: [b] }]);
    expect(checkBody(asUser({ ...RESULT, content: 'x'.repeat(501) })).message).toBe('A tool_result content must be a short string.');
    expect(checkBody(asUser({ ...RESULT, content: '' })).status).toBe(400);
    expect(checkBody(asUser({ ...RESULT, content: [{ type: 'text', text: 'saved' }] })).status).toBe(400);
    expect(checkBody(asUser({ ...RESULT, is_error: 'yes' })).message).toBe('is_error must be true or false.');
    expect(checkBody(asUser({ ...RESULT, cache_control: {} })).status).toBe(400);
  });
  it('content blocks: 12 pass, 13 do not; none at all does not; an image or a bare string block does not', () => {
    const texts = (n) => Array.from({ length: n }, () => ({ type: 'text', text: 'ok' }));
    expect(checkBody(withTools([{ role: 'user', content: texts(12) }])).ok).toBe(true);
    expect(checkBody(withTools([{ role: 'user', content: texts(13) }])).message).toBe('A message holds 1 to 12 content blocks.');
    expect(checkBody(withTools([{ role: 'user', content: [] }])).status).toBe(400);
    expect(checkBody(withTools([{ role: 'user', content: [{ type: 'image', source: {} }] }])).message).toBe('That content block type is not allowed.');
    expect(checkBody(withTools([{ role: 'user', content: ['hi'] }])).message).toBe('Each content block must be an object.');
    expect(checkBody(withTools([{ role: 'user', content: [{ type: 'text', text: '' }] }])).status).toBe(400);
  });
  it('every block\'s text counts toward the character cap', () => {
    const r = checkBody(withTools([{ role: 'user', content: [{ type: 'text', text: 'y'.repeat(200) }] }]), { totalChars: 100 + 'You are a warm, direct coach.'.length });
    expect(r.message).toBe('The conversation is too long.');
  });
  it('every string of a tool call counts too — its id, its name and its input', () => {
    const msgs = [...FIRST, { role: 'assistant', content: [USE] }];
    const exact = 'You are a warm, direct coach.'.length + FIRST[0].content.length
      + USE.id.length + USE.name.length + JSON.stringify(USE.input).length;
    expect(checkBody(withTools(msgs), { totalChars: exact }).ok).toBe(true);
    expect(checkBody(withTools(msgs), { totalChars: exact - 1 }).message).toBe('The conversation is too long.');
  });
  it('an empty tool description is missing, not short', () => {
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { description: '' })] })).message).toBe('A tool description is missing or too long.');
  });
  // The app measures a replayed input the way JavaScript does (string length),
  // and replays anything up to TOOL_INPUT_MAX whole. Counting bytes here would
  // refuse a follow-up the app believes is fine: a note in accented letters.
  it('tool sizes are counted in characters, as the app counts them', () => {
    const accented = { ...USE, input: { note: 'é'.repeat(1500) } };
    expect(new TextEncoder().encode(JSON.stringify(accented.input)).length).toBeGreaterThan(LIMITS.toolInput);
    expect(checkBody(withTools([...FIRST, { role: 'assistant', content: [accented] }])).ok).toBe(true);
  });
  // Each cap is checked at the limit as well as one past it, so a `>` that
  // slipped to `>=` would show here.
  it('every tool size passes exactly at its cap', () => {
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { description: 'x'.repeat(LIMITS.toolDescription) })] })).ok).toBe(true);
    const schema = (n) => {
      const base = { type: 'object', properties: { note: { type: 'string', description: '' } } };
      base.properties.note.description = 'x'.repeat(n - JSON.stringify(base).length);
      return base;
    };
    expect(JSON.stringify(schema(LIMITS.toolSchema)).length).toBe(LIMITS.toolSchema);
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { input_schema: schema(LIMITS.toolSchema) })] })).ok).toBe(true);
    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { input_schema: schema(LIMITS.toolSchema + 1) })] })).message).toBe('A tool input_schema is missing or too large.');
    const input = (n) => ({ note: 'x'.repeat(n - JSON.stringify({ note: '' }).length) });
    const asCoach = (i) => withTools([...FIRST, { role: 'assistant', content: [{ ...USE, input: i }] }]);
    expect(JSON.stringify(input(LIMITS.toolInput)).length).toBe(LIMITS.toolInput);
    expect(checkBody(asCoach(input(LIMITS.toolInput))).ok).toBe(true);
    expect(checkBody(asCoach(input(LIMITS.toolInput + 1))).message).toBe('A tool_use input is too large.');
    const asUser = (c) => withTools([...PROPOSED, { role: 'user', content: [{ ...RESULT, content: c }] }]);
    expect(checkBody(asUser('x'.repeat(LIMITS.toolResult))).ok).toBe(true);
  });
});
