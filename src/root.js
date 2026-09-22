// The v2 root: a list of self-contained attempts plus device-only secrets.
// The v1 key is read once for migration and never written — it is the rollback.

import { migrateV1, localDayOf } from './migrate.js';
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

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Enough shape that the app can render it without crashing. A v2 that parses
// but fails this is unreadable stored data like any other — the recovery
// screen, never a white screen. Only what every screen leans on is checked.
function wellFormed(root) {
  return isObj(root) && root.version === 2 && Array.isArray(root.attempts)
    && root.attempts.every((a) => isObj(a) && isObj(a.plan) && Array.isArray(a.plan.stages) && isObj(a.settings)
      && Array.isArray(a.events) && a.events.every(isObj));
}

// In memory only — loadRoot never writes. Repairs the things that can't hide
// any history: a missing device, missing celebration lists (they only record
// which celebrations already played), and an active id that doesn't lead to
// an active attempt. Left dangling, that id hides the Front door, makes
// startAttempt refuse, and gives Exit nothing to exit.
function settle(stored) {
  const root = { ...freshRoot(), ...stored };
  if (!isObj(root.device)) root.device = { apiKey: '' };
  root.attempts = root.attempts.map((a) => (Array.isArray(a.celebratedStages) && Array.isArray(a.celebratedAwards) ? a : {
    ...a,
    celebratedStages: Array.isArray(a.celebratedStages) ? a.celebratedStages : [],
    celebratedAwards: Array.isArray(a.celebratedAwards) ? a.celebratedAwards : [],
  }));
  if (root.activeAttemptId !== null && attemptById(root, root.activeAttemptId)?.status !== 'active') root.activeAttemptId = null;
  return root;
}

// The v1 blob as a v2 root, or null if it won't migrate. migrateV1 trusts its
// input; anything that isn't a v1 state (a plain object with an events array)
// would migrate to an empty attempt.
function migrateRawV1(raw, now) {
  try {
    const v1 = JSON.parse(raw);
    return isObj(v1) && Array.isArray(v1.events) ? migrateV1(v1, { legacyPlan: LEGACY_PLAN, now }) : null;
  } catch {
    return null;
  }
}

// → { root, problem: null | 'corrupt' | 'migration-failed' }. With a problem the
// returned root is a placeholder: the caller must NOT save it over what's stored.
// Only null means "nothing stored" — an empty string is stored data we can't read.
export function loadRoot(storage = localStorage, now = new Date().toISOString()) {
  const rawV2 = storage.getItem(KEY_V2);
  if (rawV2 !== null) {
    let stored;
    try {
      stored = JSON.parse(rawV2);
    } catch { /* unreadable: stays undefined */ }
    return wellFormed(stored) ? { root: settle(stored), problem: null } : { root: freshRoot(), problem: 'corrupt' };
  }
  const rawV1 = storage.getItem(KEY_V1);
  if (rawV1 !== null) {
    const root = migrateRawV1(rawV1, now);
    return root ? { root, problem: null } : { root: freshRoot(), problem: 'migration-failed' };
  }
  return { root: freshRoot(), problem: null };
}

// Events the migration couldn't read, kept verbatim on their attempt (outside
// `events`) so the UI can say how many there are.
export const unreadableCount = (root) => root.attempts.reduce((n, a) => n + (a.unreadableEvents?.length ?? 0), 0);

// What "Start fresh" begins from. Once v2 exists v1 is never read again, so an
// empty root here would make attempt 1 vanish for good. Readable v1 → attempt 1
// comes back, archived, exactly as a first boot would build it. Unreadable v1 →
// empty, but marked, so a later version knows attempt 1 is still sitting in v1.
// Reads only; the caller saves.
export function freshStartRoot(storage = localStorage, now = new Date().toISOString()) {
  const rawV1 = storage.getItem(KEY_V1);
  if (rawV1 === null) return freshRoot();
  return migrateRawV1(rawV1, now) ?? { ...freshRoot(), legacyV1: 'unread' };
}

export function saveRoot(root, storage = localStorage) {
  storage.setItem(KEY_V2, JSON.stringify(root));
}

// "Start fresh" is the one path that ends with unreadable v2 data being written
// over, so copy it aside first — it is the only thing standing between a
// corrupt-storage bug and a lost history. Never touches v1 (the real rollback)
// and never overwrites an earlier rescue.
// → the rescue key (the bytes are there — checked by reading them back), null
// when there's no v2 to rescue, or false when the copy couldn't be made (full
// quota, blocked storage). false must stop Start fresh: carrying on would write
// over the only copy.
export function preserveCorruptV2(storage, now = new Date().toISOString()) {
  try {
    const s = storage ?? localStorage;
    const raw = s.getItem(KEY_V2);
    if (raw === null) return null;
    const base = `${KEY_V2}-corrupt-${now.slice(0, 19).replace(/[:T]/g, '-')}`;
    // Same second, different bytes: land beside the earlier rescue, not nowhere.
    for (let n = 1; n <= 20; n++) {
      const key = n === 1 ? base : `${base}-${n}`;
      const there = s.getItem(key);
      if (there === raw) return key;
      if (there !== null) continue;
      s.setItem(key, raw);
      return s.getItem(key) === raw ? key : false;
    }
    return false;
  } catch {
    return false;
  }
}

// The API key never leaves the phone — not even in the raw dump, and v1 (never
// rewritten) still holds it in settings. Works on the raw text so it also
// covers blobs that no longer parse: every "apiKey" value is blanked, up to
// the end of the text if it was cut off mid-key, and anything shaped like an
// Anthropic key is masked wherever it sits. Nothing else changes.
export function redactSecrets(raw) {
  if (typeof raw !== 'string') return raw;
  return raw
    .replace(/("apiKey"\s*:\s*")(?:[^"\\]|\\.?)*("|$)/g, '$1$2')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-REDACTED');
}

// Exactly what is in storage, as strings — no parsing, no repair, nothing
// dropped but the key. Either key may be missing (null), which is itself worth
// knowing. Reading is all this does to storage.
export function rawStorageDump(storage, now = new Date().toISOString()) {
  const read = (key) => {
    try {
      return redactSecrets((storage ?? localStorage).getItem(key));
    } catch {
      return null; // storage can be blocked outright; say so rather than crash
    }
  };
  return JSON.stringify(
    {
      app: 'pouch-down',
      format: 'raw-storage',
      exportedAt: now,
      redacted: ['apiKey'],
      keys: { [KEY_V2]: read(KEY_V2), [KEY_V1]: read(KEY_V1) },
    },
    null,
    2
  );
}

// "Download what's stored", shared by the recovery screen and the crash screen
// so there is one route out to trust. Same order as the Settings backup: share
// sheet first (installed iOS web apps can't reliably download), then the
// clipboard, then a plain file. → 'shared' | 'copied' | 'downloaded', or null
// when the share sheet was dismissed.
export async function sendRawStorage(name) {
  const json = rawStorageDump();
  const file = [
    new File([json], `${name}.json`, { type: 'application/json' }),
    new File([json], `${name}.txt`, { type: 'text/plain' }),
  ].find((f) => navigator.canShare?.({ files: [f] }));
  if (file) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return null; // share sheet dismissed
    }
  }
  try {
    await navigator.clipboard.writeText(json);
    return 'copied';
  } catch {
    // clipboard can fail outside secure contexts — fall through to the file
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  URL.revokeObjectURL(url);
  return 'downloaded';
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

// archivedAt is UTC; an evening archive in the Americas is already tomorrow
// there. archivedDay is the local 4am→4am day it happened on, in the zone the
// phone was in. Only an active attempt is archived — an already-archived one
// keeps the dates it ended on.
export function archiveActive(root, now = new Date().toISOString()) {
  if (!root.activeAttemptId) return root;
  const next = updateAttempt(root, root.activeAttemptId, (a) => (a.status === 'active' ? { ...a, status: 'archived', archivedAt: now, archivedDay: localDayOf(now) } : a));
  return { ...next, activeAttemptId: null };
}

export function lastSettings(root) {
  const last = root.attempts[root.attempts.length - 1];
  return last ? { ...DEFAULT_SETTINGS, ...last.settings } : { ...DEFAULT_SETTINGS };
}
