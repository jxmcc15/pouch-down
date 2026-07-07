import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { loadState, saveState, makeEvent } from './store.js';

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
        setState((s) => ({ ...s, events: [...s.events, ev] }));
        return ev.id;
      },
      logResisted(trigger = null) {
        const ev = makeEvent('resisted', trigger);
        setState((s) => ({ ...s, events: [...s.events, ev] }));
        return ev.id;
      },
      undoEvent(id) {
        setState((s) => ({ ...s, events: s.events.filter((e) => e.id !== id) }));
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
