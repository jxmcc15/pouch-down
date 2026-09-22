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

export function migrateV1(v1, { legacyPlan, now = new Date().toISOString() }) {
  const { apiKey = '', ...settings } = v1.settings ?? {};
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
