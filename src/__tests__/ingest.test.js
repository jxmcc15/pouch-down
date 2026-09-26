// src/__tests__/ingest.test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseBackup, renderLiveLog } from '../ingest.js';
import { ingest } from '../../scripts/ingest-backup.mjs';
import { generatePlan } from '../planGenerator.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
const ev = (type, day, extra = {}) => ({ id: `${type}-${day}-${Math.random()}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const a2 = { id: 'a2', status: 'active', createdAt: '2026-09-21T12:00:00Z', archivedAt: null, settings, plan, events: [...Array.from({ length: 8 }, () => ev('pouch', '2026-09-21')), ev('backfill', '2026-09-23', { count: 7, streak: 'keep' })], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
const v2 = JSON.stringify({ app: 'pouch-down', format: 2, exportedAt: '2026-09-25T17:00:00.000Z', root: { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [a2] } });
const v1 = JSON.stringify({ app: 'pouch-down', exportedAt: '2026-09-19T02:14:52.406Z', plan: {}, state: { version: 1, settings: { ...settings, apiKey: '' }, events: [{ id: 'e1', ts: '2026-07-08T11:42:07.123Z', type: 'pouch', trigger: null }], celebratedStages: [], checkinDismissedFor: null } });

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
  it('lists an award that stays earned after the log stopped supporting it, without a date', () => {
    // Celebrated once, so it never un-earns — but nothing in this log reaches a 7-day streak.
    const root = { ...parseBackup(v2).root, attempts: [{ ...a2, celebratedAwards: ['showed-up', 'streak-7'] }] };
    const md = renderLiveLog(root, { exportedAt: '2026-09-25T17:00:00.000Z', now: new Date() });
    expect(md).toMatch(/\*\*Awards earned:\*\* .*Showed up \(2026-09-21\)/);
    expect(md).toMatch(/\*\*Awards earned:\*\* .*7-day streak(,|$)/m);
    expect(md).not.toMatch(/null/);
  });
});

// A backup is scored as of the moment the phone exported it. Scoring it by the
// Mac's clock turns every day since into an unlogged one and zeroes a real streak.
describe('scored as of the export, not the Mac clock', () => {
  // One pouch a day, 9/21–9/28 — eight green days.
  const eightDays = Array.from({ length: 8 }, (_, i) => ev('pouch', `2026-09-${21 + i}`));
  const root = { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [{ ...a2, events: eightDays }] };
  // Ingested Wed 9/30 9 AM CDT.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T14:00:00.000Z')); });
  afterEach(() => vi.useRealTimers());

  it('keeps a real streak whole when the backup is a day and a half old', () => {
    const md = renderLiveLog(root, { exportedAt: '2026-09-29T03:00:00.000Z', now: new Date() }); // Mon 9/28 10 PM CDT
    expect(md).not.toMatch(/\[!warning\]/);
    expect(md).toMatch(/\*\*Streak:\*\* current 8 · best 8/);
    expect(md).toMatch(/day 8 of 90/);
    expect(md).toMatch(/\| 8 \| 2026-09-28 \|.*\| on plan so far \|/); // the export day was still going
    expect(md).toMatch(/\| 9 \| 2026-09-29 \|.*\| not in backup \|/);
    expect(md).toMatch(/\| 10 \| 2026-09-30 \|.*\| not in backup \|/);
  });
  it('reads an export day with nothing logged yet as in progress, not a break', () => {
    const md = renderLiveLog(root, { exportedAt: '2026-09-29T14:00:00.000Z', now: new Date() }); // Tue 9/29 9 AM CDT
    expect(md).toMatch(/\*\*Streak:\*\* current 8 · best 8/);
    expect(md).toMatch(/\| 9 \| 2026-09-29 \|.*\| no log yet \|/);
    expect(md).toMatch(/\| 10 \| 2026-09-30 \|.*\| not in backup \|/);
  });
  it('gives the script (and so the Telegram ping) the same streak', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pouch-ingest-'));
    try {
      const search = path.join(tmp, 'Downloads');
      fs.mkdirSync(search);
      fs.writeFileSync(path.join(search, 'pouch-down-backup-1.json'), JSON.stringify({ app: 'pouch-down', format: 2, exportedAt: '2026-09-29T03:00:00.000Z', root }));
      // The provenance the pipeline asks ~/Downloads for is injected here: a temp
      // file has no extended attributes, and no test should ask macOS about one.
      // What the pipeline trusts is covered in ingestTrust.test.js.
      const r = ingest({ backupDir: path.join(tmp, 'Pouch Down'), searchDirs: [search], now: new Date(), log: () => {}, provenance: () => 'sharingd' });
      expect(r.newest).toMatchObject({ ageDays: 1, stale: false, streak: { current: 8, best: 8 } });
      expect(fs.readFileSync(r.liveLog.path, 'utf8')).toMatch(/\*\*Streak:\*\* current 8 · best 8/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('leaves the real clock alone afterwards', () => {
    renderLiveLog(root, { exportedAt: '2026-09-29T03:00:00.000Z', now: new Date() });
    expect(new Date().toISOString()).toBe('2026-09-30T14:00:00.000Z');
  });
});
