// src/__tests__/ingest.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBackup, renderLiveLog } from '../ingest.js';
import { generatePlan } from '../planGenerator.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
const ev = (type, day, extra = {}) => ({ id: `${type}-${day}-${Math.random()}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const a2 = { id: 'a2', status: 'active', createdAt: '2026-09-21T12:00:00Z', archivedAt: null, settings, plan, events: [...Array.from({ length: 8 }, () => ev('pouch', '2026-09-21')), ev('backfill', '2026-09-23', { count: 7, streak: 'keep' })], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
const v2 = JSON.stringify({ app: 'pouch-down', format: 2, exportedAt: '2026-09-25T17:00:00.000Z', root: { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [a2] } });
const v1 = JSON.stringify({ app: 'pouch-down', exportedAt: '2026-09-19T02:01:37.910Z', plan: {}, state: { version: 1, settings: { ...settings, apiKey: '' }, events: [{ id: 'e1', ts: '2026-07-08T11:33:12.569Z', type: 'pouch', trigger: null }], celebratedStages: [], checkinDismissedFor: null } });

describe('parseBackup', () => {
  it('reads a v2 backup', () => expect(parseBackup(v2)).toMatchObject({ format: 2, exportedAt: '2026-09-25T17:00:00.000Z', root: { activeAttemptId: 'a2' } }));
  it('upgrades a v1 backup to a root with one archived attempt', () => {
    const b = parseBackup(v1);
    expect(b.format).toBe(1);
    expect(b.root.attempts.map((a) => [a.id, a.status])).toEqual([['a1', 'archived']]);
  });
  it('rejects anything that is not a Pouch Down backup', () => {
    expect(() => parseBackup('{"app":"other"}')).toThrow(/not a Pouch Down backup/);
    expect(() => parseBackup('nope')).toThrow();
  });
  it('refuses a file that still contains an API key', () => {
    expect(() => parseBackup(v2.replace('"apiKey":""', '"apiKey":"sk-ant-LEAK"'))).toThrow(/API key/);
  });
});

describe('renderLiveLog', () => {
  // Pin the clock: statuses and the 21-day window are relative to "today".
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T18:00:00.000Z')); });
  afterEach(() => vi.useRealTimers());
  const render = () => renderLiveLog(parseBackup(v2).root, { exportedAt: '2026-09-25T17:00:00.000Z', now: new Date() });

  it('is a valid vault note', () => {
    const md = render();
    expect(md.startsWith('---\ntitle: Pouch Down — Live Log\n')).toBe(true);
    expect(md).toMatch(/type: reference/);
    expect(md).toMatch(/project\/pouch-down/);
    expect(md).toMatch(/\[\[Pouch Down — Cessation System\]\]/);
  });
  it('never calls an unlogged day on plan', () => {
    const md = render();
    expect(md).toMatch(/\| 2 \| 2026-09-22 \|.*no log/);
    expect(md).toMatch(/\| 3 \| 2026-09-23 \|.*backfilled/);
    expect(md).not.toMatch(/2026-09-22.*on plan/);
  });
  it('states how fresh the data is', () => expect(render()).toMatch(/Data as of 2026-09-25/));
  it('warns when the backup is stale', () => {
    vi.setSystemTime(new Date('2026-10-05T18:00:00.000Z'));
    expect(render()).toMatch(/\[!warning\].*10 days old/);
  });
});
