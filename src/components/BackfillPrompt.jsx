import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { useApp } from '../state.jsx';
import { missedDays } from '../store.js';

const spring = { type: 'spring', damping: 26, stiffness: 240 };
const MAX_COUNT = 40;

// Parsed at local noon so the weekday can't shift with the device's zone —
// new Date('2026-09-18') is UTC midnight, which renders as the 17th anywhere
// west of Greenwich. Same trick TodayView and store.js use.
const weekdayOf = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
const monthDayOf = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// api.logBackfill silently returns null for a non-integer or out-of-range
// count, so every path into `count` goes through this.
const clamp = (n) => Math.min(MAX_COUNT, Math.max(0, Math.round(n)));

// Silence is never success: an unlogged past day stays gray until the user
// says what happened. This card asks — one day at a time, newest first — and
// then gets out of the way. It never judges the answer.
export default function BackfillPrompt() {
  const { state, readOnly, api } = useApp();
  const [opened, setOpened] = useState(null); // this open's days (≤3, newest first), fixed once
  const [skipped, setSkipped] = useState([]); // hidden for this session only; still nolog
  const [asked, setAsked] = useState(null); // which day the stepper below belongs to
  const [count, setCount] = useState(0);
  const [fork, setFork] = useState(false); // showing the keep/break choice

  // "On open, up to the 3 most recent" — so the list is taken once, when the
  // prompt opens, and never topped up: answering or skipping one never pulls a
  // 4th day in behind it. The next open (a fresh mount) takes a fresh list.
  // Done during render, like the reset below, so the first paint already has it.
  const live = state && !readOnly;
  if (live && opened === null) setOpened(missedDays(state).map((d) => d.day));

  // Each listed day is asked only while it is still eligible right now —
  // answered days are logged, and a day can age out of the window mid-open.
  const days = live && opened ? missedDays(state, { max: Infinity }).filter((d) => opened.includes(d.day)) : [];
  const target = days.find((d) => !skipped.includes(d.day)) || null;

  // Each day starts fresh at its own cap, on the question step. Done during
  // render (not an effect) so the first paint of a new day is already correct.
  if (target && asked !== target.day) {
    setAsked(target.day);
    setCount(clamp(target.cap));
    setFork(false);
  }

  if (!target) return null;

  // Functional updates so a rapid tap streak can't race past the bounds.
  const step = (delta) => {
    setCount((c) => clamp(c + delta));
    setFork(false); // changing the answer un-answers the fork
  };

  const commit = (choice) => {
    const n = clamp(count);
    // Over cap breaks the streak whatever was chosen — the store derives it
    // that way too, so don't write an event that disagrees with itself.
    api.logBackfill({ day: target.day, count: n, streak: n > target.cap ? 'break' : choice });
    setFork(false); // the day is logged now, so it drops out; the next listed one asks itself
  };

  const save = () => {
    // Over cap is not a question — the streak breaks either way. Within cap,
    // it's the user's call, and that fork is the confirmation: no second one.
    if (clamp(count) > target.cap) commit('break');
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
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={spring}
    >
      <div className="spread">
        <span className="tiny muted">Unlogged day</span>
        <span className="small faint">{monthDayOf(target.day)}</span>
      </div>

      <div style={{ marginTop: 14, fontSize: 15, fontWeight: 500 }}>
        No log for {weekdayOf(target.day)}. How many did you have?
      </div>

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
                <motion.button
                  className="btn btn-ghost"
                  onClick={() => setSkipped((s) => [...s, target.day])}
                  whileTap={{ scale: 0.98 }}
                  style={{ flex: 1 }}
                >
                  Skip
                </motion.button>
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
    </motion.div>
  );
}
