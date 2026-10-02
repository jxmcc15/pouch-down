// pouchVerdict's on-time wording: minutes under an hour, hours past it.
import { describe, it, expect, vi } from 'vitest';

const verdict = vi.hoisted(() => ({ current: null }));
vi.mock('../store.js', async (importOriginal) => ({
  ...(await importOriginal()),
  classifyPouch: () => verdict.current,
}));

const { pouchVerdict } = await import('../pouchVerdict.js');
const onTime = (deltaMin) => {
  verdict.current = { bucket: 'on-time', deltaMin };
  return pouchVerdict({}, {}).text;
};

describe('pouchVerdict — on-time delta', () => {
  it('reads minutes under an hour and hours past it', () => {
    expect(onTime(0)).toBe('on time');
    expect(onTime(5)).toBe('on time +5m');
    expect(onTime(59)).toBe('on time +59m');
    expect(onTime(60)).toBe('on time +1h 0m');
    expect(onTime(315)).toBe('on time +5h 15m');
  });
});
