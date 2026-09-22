// src/__tests__/priceHelp.test.js
// No live calls, ever: parsePriceReply is pure, and the two priceFromText
// tests stub global fetch. No real API key appears anywhere in here.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parsePriceReply, priceFromText } from '../priceHelp.js';

const good = '{"pricePerTin": 4.80, "pouchesPerTin": 20, "explanation": "$23.99 + tax ÷ 5 tins"}';

describe('parsePriceReply reads the model back', () => {
  it('takes clean JSON', () => {
    expect(parsePriceReply(good)).toEqual({
      pricePerTin: 4.8,
      pouchesPerTin: 20,
      explanation: '$23.99 + tax ÷ 5 tins',
    });
  });

  it('digs the object out of surrounding prose', () => {
    expect(parsePriceReply(`Sure — here you go:\n${good}\nHope that helps.`).pricePerTin).toBe(4.8);
  });

  it('digs the object out of a code fence', () => {
    expect(parsePriceReply('```json\n' + good + '\n```').pouchesPerTin).toBe(20);
  });

  it('rounds the price to cents', () => {
    expect(parsePriceReply('{"pricePerTin": 4.799999, "pouchesPerTin": 20}').pricePerTin).toBe(4.8);
  });

  it('rounds a fractional pouch count and survives a missing explanation', () => {
    const r = parsePriceReply('{"pricePerTin": 5, "pouchesPerTin": 19.6}');
    expect(r.pouchesPerTin).toBe(20);
    expect(r.explanation).toBe('');
  });

  it('accepts a number handed back as a string', () => {
    expect(parsePriceReply('{"pricePerTin": "6.25", "pouchesPerTin": "15"}')).toMatchObject({
      pricePerTin: 6.25,
      pouchesPerTin: 15,
    });
  });
});

describe('parsePriceReply refuses to guess', () => {
  it('passes the model’s own sentence through as unclear:', () => {
    expect(() => parsePriceReply('{"error": "How many tins were in the pack?"}')).toThrow(
      'unclear:How many tins were in the pack?',
    );
  });

  it('calls prose with no JSON at all unreadable', () => {
    expect(() => parsePriceReply('I have no idea what you mean.')).toThrow('unreadable');
    expect(() => parsePriceReply('')).toThrow('unreadable');
  });

  // The braces match, so the regex is happy and JSON.parse is not: this must
  // still be a plain 'unreadable', never a raw SyntaxError.
  it('calls broken JSON inside braces unreadable, not a SyntaxError', () => {
    const broken = '{"pricePerTin": 4.80, "pouchesPerTin": }';
    expect(() => parsePriceReply(broken)).toThrow('unreadable');
    let caught;
    try {
      parsePriceReply(broken);
    } catch (e) {
      caught = e;
    }
    expect(caught).not.toBeInstanceOf(SyntaxError);
    expect(caught.message).toBe('unreadable');
  });

  it('rejects a price outside the plausible range', () => {
    expect(() => parsePriceReply('{"pricePerTin": 0, "pouchesPerTin": 20}')).toThrow('unreadable');
    expect(() => parsePriceReply('{"pricePerTin": -3, "pouchesPerTin": 20}')).toThrow('unreadable');
    expect(() => parsePriceReply('{"pricePerTin": 2400, "pouchesPerTin": 20}')).toThrow('unreadable');
    expect(() => parsePriceReply('{"pricePerTin": "about five bucks", "pouchesPerTin": 20}')).toThrow('unreadable');
  });

  it('rejects a pouch count outside the plausible range', () => {
    expect(() => parsePriceReply('{"pricePerTin": 5, "pouchesPerTin": 0}')).toThrow('unreadable');
    expect(() => parsePriceReply('{"pricePerTin": 5, "pouchesPerTin": 400}')).toThrow('unreadable');
    expect(() => parsePriceReply('{"pricePerTin": 5}')).toThrow('unreadable');
  });
});

describe('priceFromText error taxonomy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws no-key before it ever reaches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(priceFromText('a 5-pack for $24', '   ')).rejects.toThrow('no-key');
    await expect(priceFromText('a 5-pack for $24', undefined)).rejects.toThrow('no-key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps 401 to bad-key and other failures to api', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(priceFromText('x', 'test-key-not-real')).rejects.toThrow('bad-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(priceFromText('x', 'test-key-not-real')).rejects.toThrow('api');
  });

  it('sends the key only in the header, and parses the reply', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: good }] }),
    });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(priceFromText('a 5-pack for $23.99 plus tax', ' test-key-not-real ')).resolves.toEqual({
      pricePerTin: 4.8,
      pouchesPerTin: 20,
      explanation: '$23.99 + tax ÷ 5 tins',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(url).not.toContain('test-key-not-real');
    expect(init.headers['x-api-key']).toBe('test-key-not-real'); // trimmed
    expect(init.body).not.toContain('test-key-not-real');
  });

  it('turns an empty or unusable reply body into unreadable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
    await expect(priceFromText('x', 'test-key-not-real')).rejects.toThrow('unreadable');
  });
});
