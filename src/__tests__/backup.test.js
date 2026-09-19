import { describe, it, expect } from 'vitest';
import { fullBackup } from '../store.js';

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
