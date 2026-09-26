import { Fragment, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, Moon, ChevronDown, PencilLine } from 'lucide-react';
import { useApp } from '../state.jsx';
import {
  eventsForDay, pouchesForDay, asOfDay, dayNumberFor, dateForDayNumber,
  statusForDay, fmtTime, triggersFor, reasonFor, timedPouchesForDay,
} from '../store.js';
import { capForDay } from '../plan.js';
import { pouchVerdict } from '../pouchVerdict.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };
// A gentle tween reads smoother than a spring on animated `height: auto`.
const collapse = { duration: 0.26, ease: [0.16, 1, 0.3, 1] };
const DEFAULT_VISIBLE = 14;

const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Trims float noise: 7 → "7", 7.4 → "7.4", 7.42 → "7.4".
const fmtHours = (h) => {
  const r = Math.round(h * 10) / 10;
  return Number.isInteger(r) ? `${r}` : r.toFixed(1);
};

// 8px status dot — green on-plan, amber over, gray no-log, accent outline for today.
function dotStyle(status) {
  const base = { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, display: 'block' };
  if (status === 'today-under' || status === 'today-over')
    return { ...base, background: 'transparent', border: '1.5px solid var(--accent-bright)', boxShadow: '0 0 6px var(--accent-glow)' };
  if (status === 'yellow') return { ...base, background: 'var(--amber)' };
  if (status === 'green') return { ...base, background: 'var(--green)' };
  if (status === 'nolog') return { ...base, background: 'var(--nolog)' };
  return { ...base, background: 'var(--fg-faint)' }; // pre/future — shouldn't reach a rendered section
}

// A single "a · b · c" line whose segments wrap gracefully at 375px.
function Line({ segs }) {
  return (
    <div
      className="small"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 7px', flex: 1, minWidth: 0 }}
    >
      {segs.map((s, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="faint" aria-hidden="true">·</span>}
          {s}
        </Fragment>
      ))}
    </div>
  );
}

function EventRow({ state, ev }) {
  let icon = null;
  let segs = null;

  if (ev.type === 'pouch') {
    const v = pouchVerdict(state, ev);
    icon = <span style={{ width: 8, height: 8, borderRadius: '50%', background: v.color, display: 'block', opacity: 0.85 }} />;
    segs = [
      <span key="t" className="muted num">{fmtTime(ev)}</span>,
      ...(ev.ctx?.slotLabel ? [<span key="s" className="muted">{ev.ctx.slotLabel}</span>] : []),
      <span key="v" style={{ color: v.color, fontWeight: 500 }}>{v.text}</span>,
      ...(triggersFor(state, ev).length ? [<span key="g" className="faint">{triggersFor(state, ev).join(', ')}</span>] : []),
      ...(reasonFor(state, ev)?.note ? [<span key="n" className="faint" style={{ fontStyle: 'italic' }}>{reasonFor(state, ev).note}</span>] : []),
    ];
  } else if (ev.type === 'resisted') {
    icon = <ShieldCheck size={15} color="var(--green)" />;
    segs = [
      <span key="t" className="muted num">{fmtTime(ev)}</span>,
      <span key="r" style={{ color: 'var(--green)', fontWeight: 500 }}>resisted</span>,
      ...(triggersFor(state, ev).length ? [<span key="g" className="faint">{triggersFor(state, ev).join(', ')}</span>] : []),
    ];
  } else if (ev.type === 'checkin') {
    icon = <Moon size={15} color="var(--accent-bright)" />;
    segs = [
      <span key="t" className="muted num">{fmtTime(ev)}</span>,
      <span key="c" className="muted">check-in</span>,
    ];
    if (ev.sleepQuality != null) segs.push(<span key="q" className="muted num">quality {ev.sleepQuality}/5</span>);
    if (ev.sleepHours != null) segs.push(<span key="h" className="muted num">{fmtHours(ev.sleepHours)}h sleep</span>);
    if (ev.workout === true) segs.push(<span key="w" className="muted">workout</span>);
  } else if (ev.type === 'backfill') {
    // Backfills carry a count but no timing — they were entered after the fact.
    const c = Number.isInteger(ev.count) && ev.count >= 0 ? ev.count : 0;
    icon = <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--fg-muted)', display: 'block', opacity: 0.85 }} />;
    segs = [
      <span key="c" className="muted">{c} {c === 1 ? 'pouch' : 'pouches'} backfilled</span>,
      <span key="n" className="faint">no timing</span>,
    ];
  } else if (ev.type === 'correction') {
    // The real total entered later. Timed count shown beside it so the log
    // stays readable: what was tapped vs. what it really was.
    const c = Number.isInteger(ev.count) && ev.count >= 0 ? ev.count : 0;
    icon = <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--fg-muted)', display: 'block', opacity: 0.85 }} />;
    segs = [
      <span key="c" className="muted num">Corrected total: {c} ({timedPouchesForDay(state, ev.day)} timed)</span>,
    ];
  } else {
    // `reason` events never render as lines — they show on their pouch via
    // triggersFor + the note. Unknown types: never crash.
    return null;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
      <span style={{ width: 16, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </span>
      <Line segs={segs} />
    </div>
  );
}

// Rows are built ONLY for expanded days: this only mounts inside the open
// <AnimatePresence> branch, so 60 collapsed sections never touch the event log.
function DayRows({ state, dateStr }) {
  const evs = [...eventsForDay(state, dateStr)].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  if (!evs.length) return <div className="tiny faint" style={{ padding: '2px 2px 12px' }}>nothing logged</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '2px 2px 12px' }}>
      {evs.map((ev) => <EventRow key={ev.id} state={state} ev={ev} />)}
    </div>
  );
}

export default function HistoryTimeline({ onFixDay = null }) {
  const { state, readOnly } = useApp();
  // Live attempt: today. Past attempt: the last day it can be judged, so the
  // list stops where the attempt did.
  const live = state.status !== 'archived';
  const todayN = dayNumberFor(state, asOfDay(state));
  // Today defaults open against the LIVE day number (correct across the 4am
  // rollover); explicit taps are stored as overrides on top of that default.
  // A past attempt has no today, so nothing opens by itself.
  const [overrides, setOverrides] = useState({});
  const [showAll, setShowAll] = useState(false);

  const isOpen = (n) => overrides[n] ?? (live && n === todayN);
  const toggle = (n) => setOverrides((prev) => ({ ...prev, [n]: !isOpen(n) }));

  // Before day 1 there is no plan history to show yet.
  if (todayN < 1) {
    return (
      <motion.div
        className="card"
        style={{ marginTop: 14 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.2 }}
      >
        <div className="tiny muted" style={{ marginBottom: 8 }}>History</div>
        <p className="small muted" style={{ margin: 0 }}>
          {live
            ? 'Your history starts on day 1 — every pouch, resisted craving, and check-in lands here.'
            : 'This attempt ended before day 1, so there’s no history to show.'}
        </p>
      </motion.div>
    );
  }

  const lastDay = Math.min(todayN, state.plan.totalDays);
  const days = [];
  for (let n = lastDay; n >= 1; n--) days.push(n); // newest-first
  const visibleDays = showAll ? days : days.slice(0, DEFAULT_VISIBLE);

  return (
    <motion.div
      className="card"
      style={{ marginTop: 14 }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.2 }}
    >
      <div className="tiny muted" style={{ marginBottom: 6 }}>History</div>

      {visibleDays.map((n, idx) => {
        const dateStr = dateForDayNumber(state, n);
        const used = pouchesForDay(state, dateStr);
        const cap = capForDay(state.plan, n);
        const status = statusForDay(state, dateStr);
        const open = isOpen(n);
        return (
          <div key={n} className="row" style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border)', gap: 0, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <button
              type="button"
              onClick={() => toggle(n)}
              className="spread"
              aria-expanded={open}
              style={{ flex: 1, minWidth: 0, background: 'transparent', padding: '12px 2px', minHeight: 44, textAlign: 'left' }}
            >
              <span className="row" style={{ gap: 9, minWidth: 0 }}>
                <span style={dotStyle(status)} />
                <span className="small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ fontWeight: 600 }}>Day {n}</span>
                  <span className="muted">{` · ${fmtShort(dateStr)} · `}</span>
                  {status === 'nolog' ? (
                    <span className="num" style={{ color: 'var(--fg-faint)' }}>no log</span>
                  ) : (
                    <span className="num" style={{ color: used > cap ? 'var(--amber)' : 'var(--fg-muted)' }}>{used}/{cap}</span>
                  )}
                </span>
              </span>
              <motion.span
                initial={false}
                animate={{ rotate: open ? 180 : 0 }}
                transition={collapse}
                style={{ display: 'inline-flex', flexShrink: 0 }}
              >
                <ChevronDown size={16} color="var(--fg-faint)" />
              </motion.span>
            </button>
            {/* Fix this day — hidden in the viewer; pre/future never reach a section. */}
            {onFixDay && !readOnly && status !== 'future' && status !== 'pre' && (
              <button
                type="button"
                onClick={() => onFixDay(dateStr)}
                aria-label={`Fix Day ${n}, ${fmtShort(dateStr)}`}
                style={{ width: 44, minHeight: 44, flexShrink: 0, background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <PencilLine size={15} color="var(--fg-faint)" />
              </button>
            )}

            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={collapse}
                  style={{ overflow: 'hidden', flexBasis: '100%' }}
                >
                  <DayRows state={state} dateStr={dateStr} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {!showAll && days.length > DEFAULT_VISIBLE && (
        <button
          type="button"
          className="btn btn-ghost"
          style={{ width: '100%', marginTop: 12 }}
          onClick={() => setShowAll(true)}
        >
          Show all {days.length} days
        </button>
      )}
    </motion.div>
  );
}
