import { useState } from 'react';
import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import { missedDays, todayKey } from '../store.js';
import BackfillForm from './BackfillForm.jsx';

const spring = { type: 'spring', damping: 26, stiffness: 240 };

// Parsed at local noon so the weekday can't shift with the device's zone —
// new Date('2026-09-18') is UTC midnight, which renders as the 17th anywhere
// west of Greenwich. Same trick TodayView and store.js use.
const weekdayOf = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
const monthDayOf = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Silence is never success: an unlogged past day stays gray until the user
// says what happened. This card asks — one day at a time, newest first — and
// then gets out of the way. It never judges the answer.
export default function BackfillPrompt() {
  const { state, readOnly } = useApp();
  const [opened, setOpened] = useState(null); // { on: app day, days: ≤3 newest first }, fixed per day
  const [skipped, setSkipped] = useState([]); // hidden for this session only; still nolog

  // "On open, up to the 3 most recent" — so the list is taken when the prompt
  // opens and never topped up: answering or skipping one never pulls a 4th day
  // in behind it. But an open is also bounded by the app day. iOS resumes an
  // installed PWA from memory without remounting anything, so a list taken on
  // Tuesday would otherwise still be the list on Thursday — and Wednesday would
  // never be asked about. That silence is how attempt 1 faded. So a new app
  // day is a new open: the 1s tick re-renders this, the day key no longer
  // matches, and a fresh list is taken (skips reset with it, since they only
  // ever hid a day "for now"). Done during render, like the reset below, so
  // the first paint already has it.
  const live = state && !readOnly;
  const today = todayKey();
  if (live && (opened === null || opened.on !== today)) {
    setOpened({ on: today, days: missedDays(state).map((d) => d.day) });
    if (opened !== null) setSkipped([]);
  }

  // Each listed day is asked only while it is still eligible right now —
  // answered days are logged, and a day can age out of the window mid-open.
  const listed = live && opened?.on === today ? opened.days : [];
  const days = listed.length ? missedDays(state, { max: Infinity }).filter((d) => listed.includes(d.day)) : [];
  const target = days.find((d) => !skipped.includes(d.day)) || null;

  if (!target) return null;

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

      {/* key: each day starts fresh at its own cap, on the question step */}
      <BackfillForm
        key={target.day}
        day={target.day}
        cap={target.cap}
        onSkip={() => setSkipped((s) => [...s, target.day])}
      />
    </motion.div>
  );
}
