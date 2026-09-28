import { describe, it, expect, beforeEach } from 'vitest';
import { getLastBackup, setLastBackup, subscribe, LAST_BACKUP_KEY } from '../lastBackup.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('lastBackup', () => {
  beforeEach(() => { globalThis.localStorage = mem(); setLastBackup(''); });
  it('is empty until a backup goes out', () => { expect(getLastBackup()).toBe(''); });
  it('remembers the app-day of the last backup and tells subscribers', () => {
    const seen = [];
    const off = subscribe((d) => seen.push(d));
    setLastBackup('2026-09-25');
    expect(getLastBackup()).toBe('2026-09-25');
    expect(globalThis.localStorage.getItem(LAST_BACKUP_KEY)).toBe('2026-09-25');
    expect(seen).toEqual(['2026-09-25']);
    off();
  });
  it('only ever stores a YYYY-MM-DD day, never anything else', () => {
    setLastBackup('not a day');
    expect(getLastBackup()).toBe('');
  });
  it('survives storage being unavailable', () => {
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
    expect(() => setLastBackup('2026-09-25')).not.toThrow();
    expect(getLastBackup()).toBe('2026-09-25');
  });
});
