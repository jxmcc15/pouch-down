import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadRoot, saveRoot, attemptById, updateAttempt, startAttempt, archiveActive } from './root.js';
import { makeEvent, makeId, pouchCtxForNow, todayKey, isLogged, dayNumberFor, timedPouchesForDay } from './store.js';
import { dayKeyOf } from './time.js';
import { TRIGGERS } from './triggers.js';
import { UNDO_WINDOW_MS, TAG_WINDOW_MS, isJustLogged } from './justLogged.js';

const SAVE_ERROR = "Couldn't save to this phone. Keep the app open — it retries on your next change.";

const Ctx = createContext(null);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 140;
const CHAT_TEXT_MAX = 4000;

// A correction raises a logged past day's total. Never today (still being
// logged), never an unlogged day (silence stays silence), never below the
// pouches that were actually logged.
function correctionOk(a, { day, count }) {
  if (typeof day !== 'string' || !DAY_RE.test(day) || day >= todayKey()) return false;
  const n = dayNumberFor(a, day);
  return n >= 1 && n <= a.plan.totalDays && isLogged(a, day)
    && Number.isInteger(count) && count >= timedPouchesForDay(a, day);
}

// The reason event for a pouch in this attempt, or null if the input won't do.
function reasonFields(a, { target, triggers = [], note = '' }) {
  const pouch = a.events.find((e) => e.id === target && e.type === 'pouch');
  if (!pouch || !Array.isArray(triggers) || !triggers.every((t) => TRIGGERS.includes(t)) || typeof note !== 'string') return null;
  const set = [...new Set(triggers)];
  const text = note.trim().slice(0, NOTE_MAX);
  return set.length || text ? { day: dayKeyOf(pouch), target, triggers: set, note: text } : null;
}

// What's on screen, and may it change? Read-only = viewing an existing attempt,
// or the attempt that would be mutated isn't active. The render path and every
// mutation guard call this on the same state object, so the UI and the guard
// can never disagree — even for several api calls in one handler.
function view({ root, viewingId }) {
  // A viewingId that doesn't resolve must NOT fall through to the active
  // attempt: readOnly would silently drop to false and the next mutation would
  // land on the wrong attempt. No UI path can produce a bad id today — this is
  // what keeps that true. Unresolvable means no state, which boots the Front
  // door rather than an editable screen wearing a viewer's context.
  if (viewingId) return { state: attemptById(root, viewingId), readOnly: true };
  const state = attemptById(root, root.activeAttemptId);
  return { state, readOnly: !!state && state.status !== 'active' };
}

export function AppStateProvider({ children }) {
  // root, problem, and viewingId live in ONE state object so each api updater
  // sees the latest of all three (a render-time ref would lag within a tick).
  const [app, setApp] = useState(() => ({ ...loadRoot(), viewingId: null }));
  const { root, problem } = app;
  const { state, readOnly } = view(app);
  const [saveError, setSaveError] = useState(null); // null, or a short message for the toast
  const [tick, setTick] = useState(0); // re-render clock for countdowns
  // The last rendered app, for api methods whose return value depends on the
  // log (null = refused). The updater re-checks against the queued state, which
  // is the real guard; this only lags for two calls inside one tick.
  // A state box, not useRef: the api tests stub React with the hooks this
  // provider uses, and a box that is never set behaves the same as a ref.
  const [latest] = useState(() => ({ current: null }));
  latest.current = app;

  // Never save over stored data we could not read. A failed write (quota) keeps
  // state in memory and surfaces a toast; the next successful save clears it.
  useEffect(() => {
    if (problem) return;
    try {
      saveRoot(root);
      setSaveError(null);
    } catch (err) {
      console.error('pouch-down: save failed', err);
      setSaveError(SAVE_ERROR);
    }
  }, [root, problem]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const api = useMemo(() => {
    // Every mutation goes through here: nothing while storage is unreadable,
    // nothing while read-only (viewing a past attempt).
    const setRoot = (fn) => setApp((cur) => (cur.problem || view(cur).readOnly ? cur : { ...cur, root: fn(cur.root) }));
    // Log mutations touch the active attempt only.
    const onActive = (fn) => setRoot((r) => (r.activeAttemptId ? updateAttempt(r, r.activeAttemptId, fn) : r));
    const append = (ev) => onActive((a) => ({ ...a, events: [...a.events, ev] }));
    // The active attempt as last rendered, or null when nothing may change.
    const editable = () => {
      const cur = latest.current;
      if (!cur || cur.problem) return null;
      const { state: a, readOnly } = view(cur);
      return a && !readOnly && a.id === cur.root.activeAttemptId ? a : null;
    };
    return {
      logPouch(trigger = null) {
        const ev = makeEvent('pouch', trigger);
        // ctx snapshots slot/cap/nth at log time, computed against the
        // pre-append attempt; verdicts derive at read time.
        onActive((a) => ({ ...a, events: [...a.events, { ...ev, ctx: pouchCtxForNow(a) }] }));
        return ev.id;
      },
      logResisted(trigger = null) { const ev = makeEvent('resisted', trigger); append(ev); return ev.id; },
      // Always 'manual': the app is the only way to write a check-in now that the
      // URL entry point is gone. Check-ins stored as 'shortcut' still read and
      // score exactly as they did — history is append-only.
      logCheckin({ sleepQuality, sleepScore, sleepHours, workout } = {}) {
        const ev = { ...makeEvent('checkin'), source: 'manual' };
        if (sleepQuality != null) ev.sleepQuality = sleepQuality;
        if (sleepScore != null) ev.sleepScore = sleepScore;
        if (sleepHours != null) ev.sleepHours = sleepHours;
        if (typeof workout === 'boolean') ev.workout = workout;
        append(ev);
        return ev.id;
      },
      // Fills in a past day that has no log. `day` is the day being filled, not
      // today. One backfill per day; bad input is a no-op (returns null).
      logBackfill({ day, count, streak } = {}) {
        const valid = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < todayKey()
          && Number.isInteger(count) && count >= 0
          && (streak === 'keep' || streak === 'break');
        if (!valid) return null;
        const ev = { ...makeEvent('backfill'), day, count, streak };
        // Only an unlogged, in-plan day may be filled — a day already logged (pouch/
        // resisted/backfill), before the plan starts, or after its last day is a
        // no-op here too, even though the UI only offers eligible days; the id is
        // still returned (see comment above).
        onActive((a) => {
          const n = dayNumberFor(a, day);
          return isLogged(a, day) || n < 1 || n > a.plan.totalDays ? a : { ...a, events: [...a.events, ev] };
        });
        return ev.id;
      },
      // The real total for a logged past day, entered later. Appends; the latest
      // correction for a day wins at read time. Bad input → null, no-op.
      logCorrection({ day, count } = {}) {
        const a = editable();
        if (!a || !correctionOk(a, { day, count })) return null;
        const ev = { ...makeEvent('correction'), day, count };
        onActive((cur) => (correctionOk(cur, { day, count }) ? { ...cur, events: [...cur.events, ev] } : cur));
        return ev.id;
      },
      // Why a pouch happened, any time after it was logged — how a missed tag
      // gets filled in. A new event with the full set; the pouch is never
      // touched. Bad input → null, no-op.
      logReason(input = {}) {
        const a = editable();
        const fields = a && reasonFields(a, input);
        if (!fields) return null;
        const ev = { ...makeEvent('reason'), ...fields };
        onActive((cur) => (reasonFields(cur, input) ? { ...cur, events: [...cur.events, ev] } : cur));
        return ev.id;
      },
      // One coach exchange, saved on the active attempt (not an event: nothing
      // scores it). Appends to chat `chatId`, or starts a chat when that id isn't
      // there. → the chat id, or null (bad turn, read-only, unreadable storage).
      appendChatTurn(chatId, { user, assistant } = {}) {
        const a = editable();
        if (!a || typeof user !== 'string' || typeof assistant !== 'string') return null;
        if (user.trim() === '' || assistant.trim() === '') return null; // a blank turn is nothing to keep
        const now = new Date();
        const ts = now.toISOString();
        const messages = [
          { role: 'user', text: user.trim().slice(0, CHAT_TEXT_MAX), ts },
          { role: 'assistant', text: assistant.trim().slice(0, CHAT_TEXT_MAX), ts },
        ];
        const has = (x) => (x.chats ?? []).some((c) => c.id === chatId);
        const id = chatId != null && has(a) ? chatId : makeId(now);
        onActive((cur) => {
          const list = cur.chats ?? [];
          return list.some((c) => c.id === id)
            ? { ...cur, chats: list.map((c) => (c.id === id ? { ...c, messages: [...c.messages, ...messages] } : c)) }
            : { ...cur, chats: [...list, { id, startedAt: ts, day: todayKey(now), messages }] };
        });
        return id;
      },
      // The one sanctioned mutation besides undo: completing the just-made log
      // with a mood tag. Only the most recent event, only a pouch, only ≤15s old
      // (and not stamped in the future — a clock set back makes the age a lie).
      tagEvent(id, trigger) {
        onActive((a) => {
          const last = a.events[a.events.length - 1];
          if (!last || last.id !== id || last.type !== 'pouch') return a;
          if (!isJustLogged(last, TAG_WINDOW_MS)) return a;
          return { ...a, events: [...a.events.slice(0, -1), { ...last, trigger }] };
        });
      },
      // The only deletion: undo of the just-logged event — the most recent one,
      // still inside the undo window. The window is checked here, not trusted to
      // the toast's timer, which iOS pauses while the phone is locked.
      undoEvent(id) {
        onActive((a) => {
          const last = a.events[a.events.length - 1];
          return last && last.id === id && isJustLogged(last, UNDO_WINDOW_MS) ? { ...a, events: a.events.slice(0, -1) } : a;
        });
      },
      dismissCheckinToday() { onActive((a) => ({ ...a, checkinDismissedFor: todayKey() })); },
      updateSettings(patch) { onActive((a) => ({ ...a, settings: { ...a.settings, ...patch } })); },
      markStageCelebrated(id) { onActive((a) => (a.celebratedStages.includes(id) ? a : { ...a, celebratedStages: [...a.celebratedStages, id] })); },
      markAwardCelebrated(id) { onActive((a) => (a.celebratedAwards.includes(id) ? a : { ...a, celebratedAwards: [...a.celebratedAwards, id] })); },
      updateDevice(patch) { setRoot((r) => ({ ...r, device: { ...r.device, ...patch } })); },
      // root.startAttempt throws if one is already active; a throw inside a
      // state updater would take the whole app down, so no-op instead.
      startAttempt({ plan, settings }) { setRoot((r) => (r.activeAttemptId ? r : startAttempt(r, { plan, settings }))); },
      archiveActive() { setRoot((r) => archiveActive(r)); },
      viewAttempt(id) { setApp((cur) => ({ ...cur, viewingId: id })); },
      exitViewing() { setApp((cur) => (cur.viewingId === null ? cur : { ...cur, viewingId: null })); },
      // Recovery screen only: abandon unreadable storage and begin clean. A no-op
      // unless storage really is unreadable — it must never wipe readable data.
      // `root` comes from freshStartRoot(): attempt 1 rebuilt from v1 when it
      // can be, else an empty root marked legacyV1:'unread'. Never a bare reset.
      startFresh(root) { setApp((cur) => (cur.problem && root ? { root, problem: null, viewingId: null } : cur)); },
    };
  }, [latest]); // latest is one box for the provider's life: the api is still built once

  return (
    <Ctx.Provider value={{ root, state, readOnly, problem, saveError, device: root.device, api, tick }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  return useContext(Ctx);
}
