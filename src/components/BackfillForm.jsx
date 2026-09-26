import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { useApp } from '../state.jsx';

const spring = { type: 'spring', damping: 26, stiffness: 240 };
export const MAX_COUNT = 40;

// api.logBackfill silently returns null for a non-integer or out-of-range
// count, so every path into `count` goes through this.
const clamp = (n) => Math.min(MAX_COUNT, Math.max(0, Math.round(n)));

// The count + keep/break form for one unlogged past day. Shared by the
// backfill prompt on Today and the "Fix this day" sheet, so there is one
// `api.logBackfill` call in the app. Mount it with `key={day}`: each day starts
// fresh at its own cap, on the question step.
export default function BackfillForm({ day, cap, onSkip = null }) {
  const { api } = useApp();
  const [count, setCount] = useState(() => clamp(cap));
  const [fork, setFork] = useState(false); // showing the keep/break choice

  // Functional updates so a rapid tap streak can't race past the bounds.
  const step = (delta) => {
    setCount((c) => clamp(c + delta));
    setFork(false); // changing the answer un-answers the fork
  };

  const commit = (choice) => {
    const n = clamp(count);
    // Over cap breaks the streak whatever was chosen — the store derives it
    // that way too, so don't write an event that disagrees with itself.
    api.logBackfill({ day, count: n, streak: n > cap ? 'break' : choice });
    setFork(false); // the day is logged now; whoever mounted this moves on
  };

  const save = () => {
    // Over cap is not a question — the streak breaks either way. Within cap,
    // it's the user's call, and that fork is the confirmation: no second one.
    if (clamp(count) > cap) commit('break');
    else setFork(true);
  };

  const stepBtn = (delta, label, Icon) => {
    const disabled = delta < 0 ? count <= 0 : count >= MAX_COUNT;
    return (
      <motion.button
        className="btn"
        onClick={() => step(delta)}
        disabled={disabled}
        aria-label={label}
        whileTap={disabled ? undefined : { scale: 0.94 }}
        style={{
          flex: '0 0 auto',
          width: 56,
          minHeight: 48,
          padding: 0,
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        <Icon size={20} />
      </motion.button>
    );
  };

  return (
    <>
      <div className="row" style={{ gap: 12, marginTop: 14 }}>
        {stepBtn(-1, 'One fewer pouch', Minus)}
        <div role="status" aria-live="polite" style={{ flex: 1, textAlign: 'center' }}>
          {/* tabular figures so the number doesn't jitter while stepping */}
          <div className="num" style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.1 }}>
            {count}
          </div>
          <div className="small faint" style={{ marginTop: 2 }}>
            {count === 1 ? 'pouch' : 'pouches'}
          </div>
        </div>
        {stepBtn(1, 'One more pouch', Plus)}
      </div>

      <p className="small faint" style={{ margin: '12px 0 0' }}>
        Starts at that day&rsquo;s cap. Change it to whatever it was.
      </p>

      <div style={{ marginTop: 16 }}>
        <AnimatePresence initial={false} mode="wait">
          {fork ? (
            <motion.div
              key="fork"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              style={{ overflow: 'hidden' }}
            >
              <p className="small muted" style={{ margin: '0 0 12px' }}>
                Your call. The app only knows what you tell it.
              </p>
              {/* Both options are legitimate and styled identically — neither
                  is the reward and neither is the punishment. */}
              <div className="row" style={{ gap: 10 }}>
                <motion.button
                  className="btn"
                  onClick={() => commit('keep')}
                  whileTap={{ scale: 0.98 }}
                  style={{ flex: 1, padding: '0 12px', fontSize: 15, whiteSpace: 'nowrap' }}
                >
                  Keep my streak
                </motion.button>
                <motion.button
                  className="btn"
                  onClick={() => commit('break')}
                  whileTap={{ scale: 0.98 }}
                  style={{ flex: 1, padding: '0 12px', fontSize: 15, whiteSpace: 'nowrap' }}
                >
                  Break it here
                </motion.button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="ask"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              style={{ overflow: 'hidden' }}
            >
              <div className="row" style={{ gap: 10 }}>
                {onSkip && (
                  <motion.button
                    className="btn btn-ghost"
                    onClick={onSkip}
                    whileTap={{ scale: 0.98 }}
                    style={{ flex: 1 }}
                  >
                    Skip
                  </motion.button>
                )}
                <motion.button
                  className="btn btn-accent"
                  onClick={save}
                  whileTap={{ scale: 0.98 }}
                  style={{ flex: 1 }}
                >
                  Save
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
