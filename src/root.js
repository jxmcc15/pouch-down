// The v2 root: a list of self-contained attempts plus device-only secrets.
// The v1 key is read once for migration and never written — it is the rollback.

import { migrateV1, localDayOf } from './migrate.js';
import { LEGACY_PLAN } from './legacyPlan.js';
import { setKey } from './sessionKey.js';

export const KEY_V1 = 'pouch-down-v1';
export const KEY_V2 = 'pouch-down-v2';

// Set when a render crashes, read on the next boot. sessionStorage on purpose:
// per-tab, and it survives a reload — exactly the span of "the reload landed
// back on the same crash". It says nothing about the log, so losing it costs
// one extra reload and nothing else.
export const BOOT_CRASH_KEY = 'pouch-down-boot-crash';

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
const isStr = (x) => typeof x === 'string';
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// Safe to hand React as a child. An object or an array thrown into the DOM
// ("Objects are not valid as a React child") throws on the first render, and
// that crash comes back on every reload. null/undefined render as nothing,
// which the screens already expect from optional fields.
const renderable = (x) => x == null || isStr(x) || isNum(x) || typeof x === 'boolean';

// A slot: PlanView renders `slot.label.toLowerCase()`, and store.js reads
// `anchor` to pick a meal time (or `time` for a fixed slot).
const wellFormedSlot = (s) => isObj(s) && isStr(s.label) && renderable(s.id) && renderable(s.anchor) && renderable(s.time);

// A stage: stageForDay indexes `days[0]`/`days[1]`, capForDay returns
// `pouchesPerDay`, pacingForNow maps `slots`, PlanView prints name/tagline/mg.
const wellFormedStage = (s) => isObj(s)
  && Array.isArray(s.days) && isNum(s.days[0]) && isNum(s.days[1])
  && isNum(s.pouchesPerDay) && isNum(s.mg)
  && renderable(s.name) && renderable(s.tagline)
  && Array.isArray(s.slots) && s.slots.every(wellFormedSlot);

// A plan: every day number is derived from `startDate`, asOfDay compares
// `quitDate`, capForDay reaches into `baseline` before day 1, and `totalDays`
// bounds every loop over the plan. An empty `stages` is legitimate.
const wellFormedPlan = (p) => isObj(p)
  && isStr(p.startDate) && isStr(p.quitDate) && isNum(p.totalDays)
  && isObj(p.baseline) && isNum(p.baseline.pouchesPerDay) && isNum(p.baseline.mg)
  && Array.isArray(p.stages) && p.stages.every(wellFormedStage);

// Settings: every slot time is looked up on `mealTimes` by anchor name, and
// PlanView puts the three meal times straight into the DOM.
const wellFormedSettings = (s) => isObj(s) && isObj(s.mealTimes) && Object.values(s.mealTimes).every(renderable);

// An event: `type` routes the timeline, `ts` is parsed by every reader, `day`
// buckets it. Beyond those, the timeline prints whatever field the type carries
// — trigger, ctx.slotLabel, a check-in's numbers, a backfill's count — so every
// value on the event has to be renderable. `ctx` is the one nested object;
// `triggers` (a reason's set) the one list, and every member is printed as text.
function wellFormedEvent(e) {
  if (!isObj(e) || !isStr(e.type) || !isStr(e.ts)) return false;
  if (e.day !== undefined && !isStr(e.day)) return false;
  if (e.tzOffsetMin != null && !isNum(e.tzOffsetMin)) return false;
  for (const [k, v] of Object.entries(e)) {
    if (k === 'ctx') {
      if (v != null && !(isObj(v) && Object.values(v).every(renderable))) return false;
    } else if (k === 'triggers') {
      if (!(Array.isArray(v) && v.every(isStr))) return false;
    } else if (!renderable(v)) return false;
  }
  return true;
}

// A coach chat, as the ingest renders it into the vault: every field is text.
// Exported so the ingest can skip a bad chat instead of throwing on it.
const wellFormedMessage = (m) => isObj(m) && (m.role === 'user' || m.role === 'assistant') && isStr(m.text) && isStr(m.ts);
export const wellFormedChat = (c) => isObj(c) && isStr(c.id) && isStr(c.startedAt) && isStr(c.day)
  && Array.isArray(c.messages) && c.messages.every(wellFormedMessage);

// Enough shape that the app can render it without crashing. A v2 that parses
// but fails this is unreadable stored data like any other — the recovery
// screen, never a white screen. Only what the screens actually lean on is
// checked, and it is checked all the way down: an outer-shape-only pass let
// through roots (null `mealTimes`, a stage with no `slots`, an object
// `trigger`) that threw on the first render and reloaded back into the same
// crash, with no recovery screen and no way out but clearing storage by hand.
// Exported for the ingest pipeline, which validates a backup before filing it.
export function wellFormed(root) {
  return isObj(root) && root.version === 2 && Array.isArray(root.attempts)
    && root.attempts.every((a) => isObj(a) && wellFormedPlan(a.plan) && wellFormedSettings(a.settings)
      && Array.isArray(a.events) && a.events.every(wellFormedEvent)
      // absent is fine (attempts older than chats); present must be all good
      && (a.chats === undefined || (Array.isArray(a.chats) && a.chats.every(wellFormedChat))));
}

// In memory only — loadRoot never writes. Repairs the things that can't hide
// any history: a missing device, an API key inherited from when the key was
// kept on the device, missing celebration lists (they only record which
// celebrations already played), and an active id that doesn't lead to an
// active attempt. Not a missing chat list: every reader treats absent as
// empty, and filling it in would rewrite an archived attempt on the next save
// (attempt 1 must stay byte-identical to what the migration produced). Left dangling, that id hides the Front door, makes
// startAttempt refuse, and gives Exit nothing to exit.
//
// The key no longer lives in storage (sessionKey.js): an inherited one is
// handed to the session and comes back blank here, so the app's next ordinary
// save is what persists the blank. Nothing is written from this function, and a
// root with no key never clears a key typed in during this session.
function settle(stored) {
  const root = takeInheritedKey({ ...freshRoot(), ...stored });
  root.attempts = root.attempts.map((a) => (Array.isArray(a.celebratedStages) && Array.isArray(a.celebratedAwards) ? a : {
    ...a,
    celebratedStages: Array.isArray(a.celebratedStages) ? a.celebratedStages : [],
    celebratedAwards: Array.isArray(a.celebratedAwards) ? a.celebratedAwards : [],
  }));
  if (root.activeAttemptId !== null && attemptById(root, root.activeAttemptId)?.status !== 'active') root.activeAttemptId = null;
  return root;
}

// Hands any key found on a root to the session and returns the root with the
// slot blank, so no path can persist a key again. Used on every root that comes
// out of storage: a stored v2 (settle), and a v1 blob migrated on this boot —
// v1 still holds the original key for good, and this is where it stops being
// copied forward. Reads only; the caller decides whether to save.
function takeInheritedKey(root) {
  if (!isObj(root.device)) return { ...root, device: { apiKey: '' } };
  const inherited = typeof root.device.apiKey === 'string' ? root.device.apiKey : '';
  if (inherited.trim()) setKey(inherited);
  return root.device.apiKey === '' ? root : { ...root, device: { ...root.device, apiKey: '' } };
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
    return root ? { root: takeInheritedKey(root), problem: null } : { root: freshRoot(), problem: 'migration-failed' };
  }
  return { root: freshRoot(), problem: null };
}

// What "Start fresh" begins from. Once v2 exists v1 is never read again, so an
// empty root here would make attempt 1 vanish for good. Readable v1 → attempt 1
// comes back, archived, exactly as a first boot would build it. Unreadable v1 →
// empty, but marked, so a later version knows attempt 1 is still sitting in v1.
// Reads only; the caller saves.
export function freshStartRoot(storage = localStorage, now = new Date().toISOString()) {
  const rawV1 = storage.getItem(KEY_V1);
  if (rawV1 === null) return freshRoot();
  const migrated = migrateRawV1(rawV1, now);
  return migrated ? takeInheritedKey(migrated) : { ...freshRoot(), legacyV1: 'unread' };
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
//
// Each blob is redacted on the way in, and the finished text is redacted once
// more on the way out. The second pass is what covers the dump's own fields —
// anything not read out of storage never met the first one — so a key-shaped
// string is masked whichever field it ended up in.
export function rawStorageDump(storage, now = new Date().toISOString()) {
  const read = (key) => {
    try {
      return redactSecrets((storage ?? localStorage).getItem(key));
    } catch {
      return null; // storage can be blocked outright; say so rather than crash
    }
  };
  return redactSecrets(JSON.stringify(
    {
      app: 'pouch-down',
      format: 'raw-storage',
      exportedAt: now,
      redacted: ['apiKey'],
      keys: { [KEY_V2]: read(KEY_V2), [KEY_V1]: read(KEY_V1) },
    },
    null,
    2
  ));
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

// ---- the boot-crash marker --------------------------------------------------
// A crash that comes out of the stored data itself crashed again the instant the
// user reloaded: same boot, same render, same crash screen, and the only way out
// was clearing storage by hand. The marker is how the second boot in a row knows
// to offer the way out instead of the same dead end.
//
// Every touch is guarded twice, like sessionKey.js: reaching the property can
// throw on its own (Safari with site data blocked) and so can each method
// (private mode, full quota). The crash screen's whole job is to work when
// nothing else does, so a blocked storage costs the marker, never the screen.
function sessionStore() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function bootCrashSeen() {
  try {
    return !!sessionStore()?.getItem(BOOT_CRASH_KEY);
  } catch {
    return false;
  }
}

export function markBootCrash() {
  try {
    sessionStore()?.setItem(BOOT_CRASH_KEY, '1');
  } catch { /* no marker this time: one more reload, not a crash */ }
}

export function clearBootCrash() {
  try {
    sessionStore()?.removeItem(BOOT_CRASH_KEY);
  } catch { /* nothing to do about it, and nothing depends on it */ }
}

// The recovery path taken from the crash screen once reloading has stopped
// helping: copy what's stored aside, rebuild from v1, save that. The same order
// and the same functions the recovery screen uses — v1 is the rollback, so it is
// read and never written and never deleted.
//
// → 'started' (the caller reloads) · 'rescue-failed' (the copy aside didn't
// land, so nothing has been written: ask again with force once the user holds a
// download) · 'failed' (storage would not give or take anything).
export function startFreshFromCrash(storage, now = new Date().toISOString(), { force = false } = {}) {
  if (preserveCorruptV2(storage, now) === false && !force) return 'rescue-failed';
  let root;
  try {
    root = freshStartRoot(storage, now);
  } catch {
    return 'failed';
  }
  try {
    saveRoot(root, storage ?? localStorage);
  } catch {
    return 'failed';
  }
  clearBootCrash();
  return 'started';
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
  const attempt = { id, status: 'active', createdAt: now, archivedAt: null, settings, plan, events: [], chats: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
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
