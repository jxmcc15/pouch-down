import { dayKeyAt, offsetMinInZone } from './time.js';

// v1 had exactly one user, logging in Vermont. v1 events carry no zone, so the
// migration stamps them with the zone they were really logged in.
export const LEGACY_TZ = 'America/New_York';

export function migrateV1(v1, { legacyPlan, now = new Date().toISOString() }) {
  const { apiKey = '', ...settings } = v1.settings ?? {};
  const events = (v1.events ?? []).map((e) => {
    const ms = Date.parse(e.ts);
    const tzOffsetMin = offsetMinInZone(ms, LEGACY_TZ);
    return { ...e, tzOffsetMin, day: dayKeyAt(ms, tzOffsetMin) };
  });
  return {
    version: 2,
    device: { apiKey },
    activeAttemptId: null,
    attempts: [{
      id: 'a1', status: 'archived', createdAt: events[0]?.ts ?? now, archivedAt: now,
      settings, plan: legacyPlan, events,
      celebratedStages: v1.celebratedStages ?? [], celebratedAwards: [], checkinDismissedFor: null,
    }],
  };
}
