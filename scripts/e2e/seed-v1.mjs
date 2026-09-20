// Synthetic v1 storage for end-to-end runs. Every number here is invented.
// James's real data lives in the vault and NEVER enters this repo — it is public.
//
// The shape mirrors the legacy 60-day attempt (2026-07-08 → 2026-09-05) and
// deliberately reproduces the failure pattern the rebuild exists to fix: a solid
// logged fortnight, then thinning, then silence. That way the Front door, the
// read-only viewer and honest scoring all get something realistic to chew on.

const START = '2026-07-08';
const DAYS = 60;

// v1 events carry no zone; the migration stamps them America/New_York. July–Sept
// there is EDT (UTC-4), so local 09:00 is 13:00Z. Days run 4am→4am.
const EDT_OFFSET_H = 4;

const iso = (dayIndex, localHour, localMin = 0) => {
  const base = Date.UTC(2026, 6, 8) + dayIndex * 86400000;
  return new Date(base + (localHour + EDT_OFFSET_H) * 3600000 + localMin * 60000).toISOString();
};

// How many pouches each day gets. Index 0 = day 1. Zero means a silent day —
// which must render gray "no log", never green.
const COUNTS = [
  8, 8, 7, 8, 8, 8, 7, 8, 8, 7, 8, 9, 8, 8, // days 1–14: logged, mostly at cap
  6, 7, 6, 6, 7, 6, 6, 8, 6, 6, 7, 6, 6, 6, // days 15–28: the first cut, holding
  0, 5, 5, 0, 6, 5, 0, 0, 5, 4, 0, 0, 0, 4, // days 29–42: thinning out
  0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, // days 43–56: gone quiet
  0, 0, 0, 0,                               // days 57–60
];

let n = 0;
const ev = (type, dayIndex, hour, min, extra = {}) => ({
  id: `synthetic-${++n}`,
  ts: iso(dayIndex, hour, min),
  type,
  trigger: null,
  ...extra,
});

export function seedV1() {
  const events = [];
  for (let d = 0; d < DAYS; d++) {
    const count = COUNTS[d] ?? 0;
    // Spread the day's pouches from mid-morning to evening.
    for (let i = 0; i < count; i++) {
      const hour = 9 + Math.floor((i * 11) / Math.max(count, 1));
      events.push(ev('pouch', d, hour, (i * 17) % 60, { trigger: i === 0 ? 'routine' : null }));
    }
    // A couple of resisted cravings and a check-in, early on while logging held.
    if (d === 3 || d === 11) events.push(ev('resisted', d, 15, 20, { trigger: 'stress' }));
    if (d === 1 || d === 9) {
      events.push(ev('checkin', d, 7, 45, { source: 'manual', sleepQuality: 3, workout: d === 9 }));
    }
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));

  return {
    settings: {
      mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
      costPerTin: 5,
      pouchesPerTin: 20,
      wakeTime: '07:00',
      sleepTime: '23:00',
      apiKey: '', // never a real key, not even a fake-looking one
    },
    events,
    celebratedStages: [1, 2],
    checkinDismissedFor: null,
  };
}

export const seedV1String = () => JSON.stringify(seedV1());

export const summary = () => {
  const logged = COUNTS.filter((c) => c > 0).length;
  return { start: START, totalDays: DAYS, loggedDays: logged, silentDays: DAYS - logged };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(summary()));
}
