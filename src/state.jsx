import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadRoot, saveRoot, attemptById, updateAttempt, startAttempt, archiveActive } from './root.js';
import { makeEvent, pouchCtxForNow, todayKey, isLogged, dayNumberFor } from './store.js';
import { UNDO_WINDOW_MS, TAG_WINDOW_MS, isJustLogged } from './justLogged.js';

const SAVE_ERROR = "Couldn't save to this phone. Keep the app open — it retries on your next change.";

const Ctx = createContext(null);

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
  }, []);

  return (
    <Ctx.Provider value={{ root, state, readOnly, problem, saveError, device: root.device, api, tick }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  return useContext(Ctx);
}
