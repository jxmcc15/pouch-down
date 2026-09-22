import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { migrateV1, LEGACY_TZ } from '../migrate.js';
import { LEGACY_PLAN } from '../legacyPlan.js';
import { dayKeyOf, localHM } from '../time.js';
import { todayKey } from '../store.js';

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

  it('stamps the archive day in the zone the phone is in when it archives', () => {
    expect(migrateV1(v1(), opts).attempts[0].archivedDay).toBe(todayKey(new Date(opts.now)));
  });

  it('an unreadable archive time leaves archivedDay null rather than throwing', () => {
    expect(migrateV1(v1(), { ...opts, now: 'garbage' }).attempts[0].archivedDay).toBeNull();
  });
});

// One bad entry used to throw inside offsetMinInZone and drop the WHOLE
// history into migration-failed. Now the readable events migrate exactly as
// before and the unreadable ones ride along verbatim, outside `events`.
describe('migrateV1 with entries it cannot read', () => {
  const BAD = [
    null,
    { id: 'no-ts', type: 'pouch' },
    { id: 'num-ts', ts: 1720000000000, type: 'pouch' },
    { id: 'garbage-ts', ts: 'not-a-date', type: 'pouch' },
    'a string',
    7,
    [1, 2],
  ];
  const withBad = () => {
    const s = v1();
    // interleave, so position can't be what makes an event readable
    s.events = [BAD[0], s.events[0], BAD[1], BAD[2], s.events[1], BAD[3], BAD[4], BAD[5], s.events[2], BAD[6]];
    return s;
  };

  it('migrates every readable event exactly as a clean history would', () => {
    const clean = migrateV1(v1(), opts).attempts[0];
    const messy = migrateV1(withBad(), opts).attempts[0];
    expect(messy.events).toEqual(clean.events);
    expect(messy.createdAt).toBe(clean.createdAt); // first READABLE event
  });

  it('keeps each unreadable entry verbatim, in order, outside events', () => {
    const a1 = migrateV1(withBad(), opts).attempts[0];
    expect(a1.unreadableEvents).toEqual(BAD);
    expect(a1.events.some((e) => BAD.includes(e))).toBe(false);
  });

  for (const [label, bad] of BAD.map((b) => [JSON.stringify(b), b])) {
    it(`one ${label} among good events does not throw`, () => {
      const s = v1();
      s.events.push(bad);
      const a1 = migrateV1(s, opts).attempts[0];
      expect(a1.events).toHaveLength(3);
      expect(a1.unreadableEvents).toEqual([bad]);
    });
  }

  it('a clean history gets no unreadableEvents field at all (byte-identical to before)', () => {
    expect(migrateV1(v1(), opts).attempts[0]).not.toHaveProperty('unreadableEvents');
  });

  it('does not mutate its input', () => {
    const input = withBad();
    const before = JSON.stringify(input);
    migrateV1(input, opts);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('a history with nothing readable still migrates, with every entry kept', () => {
    const a1 = migrateV1({ version: 1, events: [null, { id: 'x' }] }, opts).attempts[0];
    expect(a1.events).toEqual([]);
    expect(a1.unreadableEvents).toEqual([null, { id: 'x' }]);
    expect(a1.createdAt).toBe(opts.now);
  });

  it('celebratedStages that is not a list becomes an empty one', () => {
    expect(migrateV1({ ...v1(), celebratedStages: 'oops' }, opts).attempts[0].celebratedStages).toEqual([]);
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
