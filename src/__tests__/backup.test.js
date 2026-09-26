import { describe, it, expect } from 'vitest';
import { fullBackup } from '../store.js';
import { KEY_V1, KEY_V2, loadRoot, freshStartRoot, rawStorageDump, redactSecrets, wellFormed } from '../root.js';
import { parseBackup } from '../ingest.js';

describe('fullBackup', () => {
  it('exports the whole root without the API key, without mutating it', () => {
    const root = { version: 2, device: { apiKey: 'sk-ant-SECRET' }, activeAttemptId: 'a2', attempts: [{ id: 'a1', events: [{ id: 'e1' }] }, { id: 'a2', events: [] }] };
    const out = fullBackup(root);
    expect(out).not.toContain('sk-ant-SECRET');
    const parsed = JSON.parse(out);
    expect(parsed).toMatchObject({ app: 'pouch-down', format: 2 });
    expect(parsed.root.attempts).toHaveLength(2);
    expect(parsed.root.device.apiKey).toBe('');
    expect(root.device.apiKey).toBe('sk-ant-SECRET');
  });

  it('strips the key even when device carries other fields', () => {
    const root = { version: 2, device: { apiKey: 'sk-ant-SECRET', theme: 'dark' }, activeAttemptId: null, attempts: [] };
    const out = fullBackup(root);
    expect(out).not.toContain('sk-ant-SECRET');
    const parsed = JSON.parse(out);
    expect(parsed.root.device).toEqual({ apiKey: '', theme: 'dark' });
  });

  it('does not throw when device is missing', () => {
    const root = { version: 2, activeAttemptId: null, attempts: [] };
    expect(() => fullBackup(root)).not.toThrow();
    const parsed = JSON.parse(fullBackup(root));
    expect(parsed.root.device).toEqual({ apiKey: '' });
  });
});

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const NOW = '2026-09-21T02:00:00.000Z';
const FAKE = 'sk-ant-api03-FAKE_test-KEY-0123456789';

describe('fullBackup carries what migration and Start fresh keep aside', () => {
  it('unreadable v1 entries ride along verbatim', () => {
    const bad = [null, { id: 'no-ts', type: 'pouch' }, { id: 'num', ts: 1720000000000 }];
    const v1 = { version: 1, settings: { apiKey: FAKE }, events: [{ id: 'e1', ts: '2026-07-08T11:42:07.123Z', type: 'pouch', trigger: null }, ...bad] };
    const { root } = loadRoot(mem({ [KEY_V1]: JSON.stringify(v1) }), NOW);
    const out = fullBackup(root);
    expect(JSON.parse(out).root.attempts[0].unreadableEvents).toEqual(bad);
    expect(out).not.toContain(FAKE);
  });
  it('the marker that attempt 1 is still sitting unread in v1 rides along', () => {
    expect(JSON.parse(fullBackup(freshStartRoot(mem({ [KEY_V1]: '{nope' }), NOW))).root.legacyV1).toBe('unread');
  });
});

// The recovery screen's "Download what's stored" hands over the raw storage
// text. v1 is never rewritten and kept the key in settings.apiKey, so without
// this every recovery download would carry the key into an AirDropped file.
describe('rawStorageDump', () => {
  const v1 = JSON.stringify({ version: 1, settings: { costPerTin: 5, apiKey: FAKE }, events: [{ id: 'e1', ts: '2026-07-08T11:42:07.123Z', type: 'pouch', trigger: null }] });
  const v2 = JSON.stringify({ version: 2, device: { apiKey: FAKE }, activeAttemptId: null, attempts: [] });
  const dumpOf = (init) => JSON.parse(rawStorageDump(mem(init), NOW));
  const cases = {
    'parseable v1 + v2': { [KEY_V1]: v1, [KEY_V2]: v2 },
    'corrupt v2, parseable v1': { [KEY_V1]: v1, [KEY_V2]: `{garbage ${v2}` },
    'v2 truncated mid-key': { [KEY_V1]: v1, [KEY_V2]: v2.slice(0, v2.indexOf(FAKE) + 14) },
    'v1 truncated mid-key, no v2': { [KEY_V1]: v1.slice(0, v1.indexOf(FAKE) + 20) },
    'v1 truncated inside the prefix': { [KEY_V1]: v1.slice(0, v1.indexOf(FAKE) + 5) },
    'key pretty-printed with spaces': { [KEY_V1]: JSON.stringify(JSON.parse(v1), null, 2) },
    'a key pasted somewhere else entirely': { [KEY_V2]: `{"note":"${FAKE}"` },
    'a key that is not an Anthropic one': { [KEY_V1]: v1.replace(FAKE, 'my-own-secret-123') },
  };
  for (const [label, init] of Object.entries(cases)) {
    it(`${label}: no key in the output`, () => {
      const out = rawStorageDump(mem(init), NOW);
      expect(out).not.toContain('FAKE');
      expect(out).not.toContain('my-own-secret');
      expect(out).not.toContain(FAKE.slice(0, 12));
    });
  }

  it('blanks the value and changes nothing else, byte for byte', () => {
    const d = dumpOf({ [KEY_V1]: v1, [KEY_V2]: v2 });
    expect(d.keys[KEY_V1]).toBe(v1.replace(FAKE, ''));
    expect(d.keys[KEY_V2]).toBe(v2.replace(FAKE, ''));
  });

  it('a blob with no key in it passes through untouched, corrupt or not', () => {
    const raw = '{"version":2,"attempts":[{"id":"a1","events":[{"id":"e\\"1"';
    expect(dumpOf({ [KEY_V2]: raw }).keys[KEY_V2]).toBe(raw);
  });

  it('says in the header what was taken out', () => {
    expect(dumpOf({})).toEqual({ app: 'pouch-down', format: 'raw-storage', exportedAt: NOW, redacted: ['apiKey'], keys: { [KEY_V2]: null, [KEY_V1]: null } });
  });

  it('only reads: never writes, and blocked storage gives nulls instead of a crash', () => {
    const calls = [];
    expect(() => rawStorageDump({ getItem: (k) => { calls.push(k); return null; }, setItem: () => { throw new Error('must not write'); } }, NOW)).not.toThrow();
    expect(JSON.parse(rawStorageDump({ getItem: () => { throw new Error('SecurityError'); } }, NOW)).keys).toEqual({ [KEY_V2]: null, [KEY_V1]: null });
  });

  it('redactSecrets leaves non-strings alone and an escaped quote inside the key cannot end it early', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets('{"apiKey":"abc\\"def","x":1}')).toBe('{"apiKey":"","x":1}');
  });
});

// Coach chats live on the attempt, so the whole-root backup carries them with
// no change — and the key scan still covers every message.
describe('coach chats in the backup', () => {
  const chat = { id: 'c1', startedAt: '2026-09-24T01:00:00.000Z', day: '2026-09-23', messages: [
    { role: 'user', text: 'Can you fix day 3 for me?', ts: '2026-09-24T01:00:00.000Z' },
    { role: 'assistant', text: "I can't change the log. Stats → tap the day → Fix this day.", ts: '2026-09-24T01:00:03.000Z' },
  ] };
  const plan = { startDate: '2026-09-21', quitDate: '2026-12-19', totalDays: 90, baseline: { pouchesPerDay: 9, mg: 9 }, stages: [] };
  const root = { version: 2, device: { apiKey: '' }, activeAttemptId: 'a1', attempts: [{ id: 'a1', status: 'active', createdAt: NOW, archivedAt: null, settings: { mealTimes: {} }, plan, events: [], chats: [chat], celebratedStages: [], celebratedAwards: [] }] };

  it('round-trips through fullBackup → parseBackup and stays well formed', () => {
    const back = parseBackup(fullBackup(root));
    expect(back.root.attempts[0].chats).toEqual([chat]);
    expect(wellFormed(back.root)).toBe(true);
  });

  it('a message holding a key is refused by the whole-file scan', () => {
    const leaky = { ...root, attempts: [{ ...root.attempts[0], chats: [{ ...chat, messages: [{ ...chat.messages[0], text: `my key is ${FAKE}` }] }] }] };
    expect(() => parseBackup(fullBackup(leaky))).toThrow(/API key/);
  });
});
