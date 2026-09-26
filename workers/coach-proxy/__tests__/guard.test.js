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
} from '../src/guard.js';

const ORIGINS = 'https://jxmcc15.github.io, http://localhost:5173';

// 24 bytes of hex is what `openssl rand -hex 24` prints. These two are the same
// length on purpose: a wrong token must not be refused just for its length.
const GOOD = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0';
const WRONG_SAME_LENGTH = 'f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f1';
const SECOND = 'abababababababababababababababababababababababab0';
const TOKENS = `${GOOD},${SECOND}`;

const MODEL = 'claude-haiku-4-5-20251001';

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

  it('refuses a field that is not one of the four allowed ones', () => {
    const r = checkBody(validBody({ temperature: 1 }));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.message).toMatch(/field/i);
  });

  it('refuses extra fields whatever they are called', () => {
    expect(checkBody(validBody({ stream: true })).status).toBe(400);
    expect(checkBody(validBody({ tools: [] })).status).toBe(400);
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
    expect(LIMITS.maxTokens).toBe(400);
    expect(LIMITS.bodyBytes).toBe(16 * 1024);
    expect(LIMITS.messages).toBe(40);
    expect(LIMITS.totalChars).toBe(60 * 1024);
    expect(LIMITS.models).toEqual([MODEL]);
    expect(LIMITS.fields).toEqual(['model', 'max_tokens', 'system', 'messages']);
  });
});
