import { dayKeyAt, localOffsetMin, offsetMinInZone } from './time.js';

// v1 had exactly one user, logging in Vermont. v1 events carry no zone, so the
// migration stamps them with the zone they were really logged in.
export const LEGACY_TZ = 'America/New_York';

// Judged on the data alone. offsetMinInZone is deliberately NOT wrapped in a
// try/catch: if the zone itself were missing on some browser, every event would
// fail the same way, and that must fail the migration loudly rather than file a
// whole history as "unreadable".
const stampable = (e) => !!e && typeof e === 'object' && !Array.isArray(e) && typeof e.ts === 'string' && Number.isFinite(Date.parse(e.ts));

// The local 4am→4am day an ISO instant falls on, in the zone this phone is in
// now — the reader's zone, not UTC. Null when the instant can't be read.
export function localDayOf(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? dayKeyAt(ms, localOffsetMin(new Date(ms))) : null;
}

const isPlainObject = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Adds each default the object doesn't have. Present keys keep their order and
// the missing ones go after, so an object with nothing missing comes back as
// the same bytes.
function fillAbsent(given, defaults) {
  const out = { ...given };
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(out, key)) out[key] = isPlainObject(value) ? { ...value } : value;
  }
  return out;
}

export function migrateV1(v1, { legacyPlan, now = new Date().toISOString(), defaults = {} }) {
  // v1 grew fields over its life (wake and sleep arrived late), so an early
  // export can be missing some, and the shape check then sends the boot to
  // recovery. Only an absent key is filled — a value the person set is never
  // replaced, not even one the shape check will refuse — and meal times are
  // filled key by key. Every caller passes `defaults: DEFAULT_SETTINGS` —
  // root.js (boot, Start fresh) and ingest.js (the vault's copy), so both build
  // the same attempt. It comes in as an option rather than an import because
  // root.js imports this module, and importing root.js back would make a cycle.
  // Without it nothing is filled. The key is stripped: it goes to the device.
  const { apiKey = '', ...given } = v1.settings ?? {};
  const settings = fillAbsent(given, defaults);
  if (isPlainObject(given.mealTimes) && isPlainObject(defaults.mealTimes)) settings.mealTimes = fillAbsent(given.mealTimes, defaults.mealTimes);
  // One bad entry used to throw and take the whole history down with it. Every
  // event that can be stamped migrates exactly as before; anything else is kept
  // verbatim beside the history, never inside it, so no derivation sees it.
  const events = [];
  const unreadableEvents = [];
  for (const e of v1.events ?? []) {
    if (!stampable(e)) {
      unreadableEvents.push(e);
      continue;
    }
    const ms = Date.parse(e.ts);
    const tzOffsetMin = offsetMinInZone(ms, LEGACY_TZ);
    events.push({ ...e, tzOffsetMin, day: dayKeyAt(ms, tzOffsetMin) });
  }
  const attempt = {
    id: 'a1', status: 'archived', createdAt: events[0]?.ts ?? now, archivedAt: now, archivedDay: localDayOf(now),
    settings, plan: legacyPlan, events,
    celebratedStages: Array.isArray(v1.celebratedStages) ? v1.celebratedStages : [], celebratedAwards: [], checkinDismissedFor: null,
  };
  // Only when there is something to keep, so a clean history carries no
  // extra field.
  if (unreadableEvents.length) attempt.unreadableEvents = unreadableEvents;
  return { version: 2, device: { apiKey }, activeAttemptId: null, attempts: [attempt] };
}
