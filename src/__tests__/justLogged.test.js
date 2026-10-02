import { describe, it, expect } from 'vitest';
import { isJustLogged, enteredAtOf, UNDO_WINDOW_MS, CLOCK_SKEW_MS } from '../justLogged.js';

const NOW = Date.parse('2026-10-02T02:05:11.000Z');

describe('enteredAtOf', () => {
  it('prefers enteredAt and falls back to ts', () => {
    expect(enteredAtOf({ ts: 'a', enteredAt: 'b' })).toBe('b');
    expect(enteredAtOf({ ts: 'a' })).toBe('a');
  });
});

describe('isJustLogged reads when the event was WRITTEN, not when it happened', () => {
  it('a late pouch from hours ago is just-logged by its enteredAt', () => {
    const ev = { ts: '2026-10-01T21:30:00.000Z', enteredAt: new Date(NOW - 3000).toISOString() };
    expect(isJustLogged(ev, UNDO_WINDOW_MS, NOW)).toBe(true);
  });
  it('without enteredAt the ts rules, as before', () => {
    expect(isJustLogged({ ts: new Date(NOW - 3000).toISOString() }, UNDO_WINDOW_MS, NOW)).toBe(true);
    expect(isJustLogged({ ts: new Date(NOW - UNDO_WINDOW_MS - 1).toISOString() }, UNDO_WINDOW_MS, NOW)).toBe(false);
  });
  it('an enteredAt in the future (clock set back) is not just-logged; a bad one fails', () => {
    expect(isJustLogged({ ts: 'x', enteredAt: new Date(NOW + CLOCK_SKEW_MS + 1).toISOString() }, UNDO_WINDOW_MS, NOW)).toBe(false);
    expect(isJustLogged({ ts: 'x', enteredAt: 'garbage' }, UNDO_WINDOW_MS, NOW)).toBe(false);
  });
});
