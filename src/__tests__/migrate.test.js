import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { migrateV1, LEGACY_TZ } from '../migrate.js';
import { LEGACY_PLAN } from '../legacyPlan.js';
import { dayKeyOf, localHM } from '../time.js';

const v1 = () => ({
  version: 1,
  settings: { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, apiKey: 'sk-ant-TEST', wakeTime: '07:00', sleepTime: '23:00' },
  events: [
    { id: 'e1', ts: '2026-07-08T11:33:12.569Z', type: 'pouch', trigger: 'stress' },
    { id: 'e2', ts: '2026-07-10T07:30:00.000Z', type: 'pouch', trigger: null, ctx: { nth: 9, cap: 8 } }, // 3:30am EDT → Jul 9
    { id: 'e3', ts: '2026-07-10T12:53:31.428Z', type: 'checkin', trigger: null, source: 'manual', sleepQuality: 3 },
  ],
  celebratedStages: [1, 2],
  checkinDismissedFor: '2026-07-10',
});
const opts = { legacyPlan: LEGACY_PLAN, now: '2026-09-20T00:00:00.000Z' };

describe('migrateV1', () => {
  it('turns the v1 state into one archived attempt with no active attempt', () => {
    const root = migrateV1(v1(), opts);
    expect(root.version).toBe(2);
    expect(root.activeAttemptId).toBeNull();
    expect(root.attempts).toHaveLength(1);
    expect(root.attempts[0]).toMatchObject({ id: 'a1', status: 'archived', archivedAt: opts.now, createdAt: '2026-07-08T11:33:12.569Z', plan: LEGACY_PLAN, celebratedStages: [1, 2], celebratedAwards: [] });
  });

  it('keeps every event and every original field untouched', () => {
    const input = v1();
    const out = migrateV1(input, opts).attempts[0].events;
    expect(out).toHaveLength(input.events.length);
    input.events.forEach((e, i) => expect(out[i]).toMatchObject(e));
  });

  it('does not mutate its input', () => {
    const input = v1();
    const before = JSON.stringify(input);
    migrateV1(input, opts);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('stamps events with the zone they were really logged in', () => {
    const [e1, e2] = migrateV1(v1(), opts).attempts[0].events;
    expect(LEGACY_TZ).toBe('America/New_York');
    expect(e1).toMatchObject({ tzOffsetMin: -240, day: '2026-07-08' });
    expect(e2.day).toBe('2026-07-09'); // before the 4am cutoff
  });

  it('moves the API key to the device and out of the attempt', () => {
    const root = migrateV1(v1(), opts);
    expect(root.device.apiKey).toBe('sk-ant-TEST');
    expect(root.attempts[0].settings).not.toHaveProperty('apiKey');
    expect(root.attempts[0].settings.pouchesPerTin).toBe(20);
  });

  it('survives an empty v1 state', () => {
    const root = migrateV1({ version: 1 }, opts);
    expect(root.attempts[0].events).toEqual([]);
    expect(root.device.apiKey).toBe('');
  });
});

// The real thing. The backup and its expected numbers are personal data and
// live outside this (public) repo; point POUCH_BACKUP_DIR at the folder.
const dir = process.env.POUCH_BACKUP_DIR;
const real = dir && fs.existsSync(`${dir}/Attempt 1 — 2026-07-08 Backup.json`);
describe.skipIf(!real)('migrateV1 against the real attempt-1 backup', () => {
  const load = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8'));
  it('matches the expected counts, whatever zone this machine is in', () => {
    const backup = load('Attempt 1 — 2026-07-08 Backup.json');
    const want = load('Attempt 1 — Expected.json');
    const a1 = migrateV1(backup.state, opts).attempts[0];
    expect(a1.events).toHaveLength(want.totalEvents);
    const start = Date.parse(`${a1.plan.startDate}T12:00:00Z`);
    const weekly = Array(want.weeklyPouches.length).fill(0);
    for (const e of a1.events) if (e.type === 'pouch') weekly[Math.floor((Date.parse(`${dayKeyOf(e)}T12:00:00Z`) - start) / 86400000 / 7)]++;
    expect(weekly).toEqual(want.weeklyPouches);
    const first = a1.events.filter((e) => e.type === 'pouch' && e.day === want.spotCheck.day).sort((a, b) => a.ts.localeCompare(b.ts))[0];
    expect(localHM(first)).toEqual(want.spotCheck.firstPouchHM);
  });
});
