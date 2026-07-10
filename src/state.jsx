import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadState, saveState, makeEvent, pouchCtxForNow, todayKey } from './store.js';

// Mood tags may only *complete* the just-made log — same spirit as undo.
const TAG_WINDOW_MS = 15000;

const Ctx = createContext(null);

export function AppStateProvider({ children }) {
  const [state, setState] = useState(loadState);
  const [tick, setTick] = useState(0); // re-render clock for countdowns

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const api = useMemo(
    () => ({
      logPouch(trigger = null) {
        const ev = makeEvent('pouch', trigger);
        // ctx snapshots settings-dependent facts (slot, cap, nth) at log time,
        // computed against the pre-append state; verdicts derive at read time.
        setState((s) => ({ ...s, events: [...s.events, { ...ev, ctx: pouchCtxForNow(s) }] }));
        return ev.id;
      },
      logResisted(trigger = null) {
        const ev = makeEvent('resisted', trigger);
        setState((s) => ({ ...s, events: [...s.events, ev] }));
        return ev.id;
      },
      logCheckin({ sleepQuality, sleepScore, sleepHours, workout, source = 'manual' } = {}) {
        const ev = { ...makeEvent('checkin'), source };
        if (sleepQuality != null) ev.sleepQuality = sleepQuality;
        if (sleepScore != null) ev.sleepScore = sleepScore;
        if (sleepHours != null) ev.sleepHours = sleepHours;
        if (typeof workout === 'boolean') ev.workout = workout;
        setState((s) => ({ ...s, events: [...s.events, ev] }));
        return ev.id;
      },
      // The one sanctioned mutation besides undo: completing the just-made log
      // with a mood tag. Only the most recent event, only a pouch, only ≤15s old.
      tagEvent(id, trigger) {
        setState((s) => {
          const last = s.events[s.events.length - 1];
          if (!last || last.id !== id || last.type !== 'pouch') return s;
          if (Date.now() - new Date(last.ts).getTime() > TAG_WINDOW_MS) return s;
          return { ...s, events: [...s.events.slice(0, -1), { ...last, trigger }] };
        });
      },
      undoEvent(id) {
        setState((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }));
      },
      dismissCheckinToday() {
        setState((s) => ({ ...s, checkinDismissedFor: todayKey() }));
      },
      updateSettings(patch) {
        setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
      },
      markStageCelebrated(stageId) {
        setState((s) =>
          s.celebratedStages.includes(stageId)
            ? s
            : { ...s, celebratedStages: [...s.celebratedStages, stageId] }
        );
      },
    }),
    []
  );

  return <Ctx.Provider value={{ state, api, tick }}>{children}</Ctx.Provider>;
}

export function useApp() {
  return useContext(Ctx);
}
