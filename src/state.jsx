import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadRoot, saveRoot, freshRoot, attemptById, updateAttempt, startAttempt, archiveActive } from './root.js';
import { makeEvent, pouchCtxForNow, todayKey } from './store.js';

// Mood tags may only *complete* the just-made log — same spirit as undo.
const TAG_WINDOW_MS = 15000;

const SAVE_ERROR = "Couldn't save to this phone. Keep the app open — it retries on your next change.";

const Ctx = createContext(null);

// What's on screen, and may it change? Read-only = viewing an existing attempt,
// or the attempt that would be mutated isn't active. The render path and every
// mutation guard call this on the same state object, so the UI and the guard
// can never disagree — even for several api calls in one handler.
function view({ root, viewingId }) {
  const viewing = viewingId ? attemptById(root, viewingId) : null;
  const state = viewing ?? attemptById(root, root.activeAttemptId);
  return { state, readOnly: !!viewing || (!!state && state.status !== 'active') };
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
      logCheckin({ sleepQuality, sleepScore, sleepHours, workout, source = 'manual' } = {}) {
        const ev = { ...makeEvent('checkin'), source };
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
        onActive((a) => (a.events.some((e) => e.type === 'backfill' && e.day === day) ? a : { ...a, events: [...a.events, ev] }));
        return ev.id;
      },
      // The one sanctioned mutation besides undo: completing the just-made log
      // with a mood tag. Only the most recent event, only a pouch, only ≤15s old.
      tagEvent(id, trigger) {
        onActive((a) => {
          const last = a.events[a.events.length - 1];
          if (!last || last.id !== id || last.type !== 'pouch') return a;
          if (Date.now() - new Date(last.ts).getTime() > TAG_WINDOW_MS) return a;
          return { ...a, events: [...a.events.slice(0, -1), { ...last, trigger }] };
        });
      },
      // The only deletion: undo of the just-logged event (the most recent one).
      undoEvent(id) {
        onActive((a) => {
          const last = a.events[a.events.length - 1];
          return last && last.id === id ? { ...a, events: a.events.slice(0, -1) } : a;
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
      startFresh() { setApp((cur) => (cur.problem ? { root: freshRoot(), problem: null, viewingId: null } : cur)); },
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
