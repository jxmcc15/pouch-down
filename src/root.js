// The v2 root: a list of self-contained attempts plus device-only secrets.
// The v1 key is read once for migration and never written — it is the rollback.

import { migrateV1 } from './migrate.js';
import { LEGACY_PLAN } from './legacyPlan.js';

export const KEY_V1 = 'pouch-down-v1';
export const KEY_V2 = 'pouch-down-v2';

export const DEFAULT_SETTINGS = {
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  costPerTin: 5,
  pouchesPerTin: 20,
  wakeTime: '07:00',
  sleepTime: '23:00',
};

export function freshRoot() {
  return { version: 2, device: { apiKey: '' }, activeAttemptId: null, attempts: [] };
}

// → { root, problem: null | 'corrupt' | 'migration-failed' }. With a problem the
// returned root is a placeholder: the caller must NOT save it over what's stored.
export function loadRoot(storage = localStorage, now = new Date().toISOString()) {
  const rawV2 = storage.getItem(KEY_V2);
  if (rawV2) {
    try {
      const root = JSON.parse(rawV2);
      if (root?.version === 2 && Array.isArray(root.attempts)) return { root: { ...freshRoot(), ...root }, problem: null };
    } catch { /* fall through */ }
    return { root: freshRoot(), problem: 'corrupt' };
  }
  const rawV1 = storage.getItem(KEY_V1);
  if (rawV1) {
    try {
      return { root: migrateV1(JSON.parse(rawV1), { legacyPlan: LEGACY_PLAN, now }), problem: null };
    } catch {
      return { root: freshRoot(), problem: 'migration-failed' };
    }
  }
  return { root: freshRoot(), problem: null };
}

export function saveRoot(root, storage = localStorage) {
  storage.setItem(KEY_V2, JSON.stringify(root));
}

export const attemptById = (root, id) => root.attempts.find((a) => a.id === id) ?? null;

export function updateAttempt(root, id, fn) {
  return { ...root, attempts: root.attempts.map((a) => (a.id === id ? fn(a) : a)) };
}

// 'a' + next ordinal — max-based, so ids stay unique even if the list has gaps.
function nextAttemptId(root) {
  const maxOrdinal = root.attempts.reduce((max, a) => {
    const n = Number(String(a.id).slice(1));
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `a${maxOrdinal + 1}`;
}

export function startAttempt(root, { plan, settings, now = new Date().toISOString() }) {
  if (root.activeAttemptId) throw new Error('an attempt is already active');
  const id = nextAttemptId(root);
  const attempt = { id, status: 'active', createdAt: now, archivedAt: null, settings, plan, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
  return { ...root, activeAttemptId: id, attempts: [...root.attempts, attempt] };
}

export function archiveActive(root, now = new Date().toISOString()) {
  if (!root.activeAttemptId) return root;
  const next = updateAttempt(root, root.activeAttemptId, (a) => ({ ...a, status: 'archived', archivedAt: now }));
  return { ...next, activeAttemptId: null };
}

export function lastSettings(root) {
  const last = root.attempts[root.attempts.length - 1];
  return last ? { ...DEFAULT_SETTINGS, ...last.settings } : { ...DEFAULT_SETTINGS };
}
