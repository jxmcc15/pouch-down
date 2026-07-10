import { motion } from 'framer-motion';
import { Undo2 } from 'lucide-react';
import { useApp } from '../state.jsx';
import { classifyPouch, fmtTime } from '../store.js';
import { TRIGGERS } from './SOSOverlay.jsx';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Warm, zero-shame verdict copy (spec's exact strings). Color is a plain status
// tint — never alarming: amber for early/over-cap, green for a held win, indigo
// for on-time, muted for baseline honesty days.
function verdictLine(bucket, deltaMin, time, slotTime) {
  if (bucket === 'baseline') {
    return {
      text: `Logged ${time} · baseline day — no caps yet, just honesty.`,
      color: 'var(--fg-muted)',
    };
  }
  if (bucket === 'over-cap') {
    return {
      text: `Logged ${time} · over today's cap — counted honestly. Tomorrow doesn't change.`,
      color: 'var(--amber)',
    };
  }
  if (bucket === 'early') {
    return {
      text: `Logged ${time} · ${Math.abs(deltaMin)} min early — slot opens ${slotTime}. Still counts, no sweat.`,
      color: 'var(--amber)',
    };
  }
  // on-time
  if (deltaMin != null && deltaMin >= 5) {
    return {
      text: `Logged ${time} · held out ${deltaMin} min past the slot. That's the muscle.`,
      color: 'var(--green)',
    };
  }
  return { text: `Logged ${time} · right on time.`, color: 'var(--accent-bright)' };
}

// Post-log toast: states the fact warmly, offers undo, and lets the just-made
// log be completed with a mood tag. Parent (TodayView) owns the 12s window and
// mounts/unmounts this inside <AnimatePresence>.
export default function LogToast({ eventId, onUndo }) {
  const { state, api } = useApp();

  // Event may have been undone mid-toast — render nothing rather than crash.
  const ev = state.events.find((e) => e.id === eventId);
  if (!ev || ev.type !== 'pouch') return null;

  const { bucket, deltaMin } = classifyPouch(state, ev);
  const time = fmtTime(ev.ts);
  // Prefer the stamped slot time; fall back to reconstructing it from the
  // signed delta so old ctx-less events (or any surprise) never blank out.
  const slotTime =
    ev.ctx?.slotAt != null
      ? fmtTime(ev.ctx.slotAt)
      : deltaMin != null
        ? fmtTime(new Date(ev.ts).getTime() - deltaMin * 60000)
        : '';
  const { text, color } = verdictLine(bucket, deltaMin, time, slotTime);

  const chipStyle = { minHeight: 36, padding: '6px 13px', fontSize: 13 };

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={spring}
      style={{ marginTop: 12, padding: '14px 16px' }}
    >
      <p style={{ margin: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.45, color }}>
        {text}
      </p>

      <div className="spread" style={{ marginTop: 10 }}>
        <motion.button
          className="chip"
          style={chipStyle}
          whileTap={{ scale: 0.94 }}
          onClick={() => {
            api.undoEvent(eventId);
            onUndo();
          }}
        >
          <Undo2 size={14} /> undo
        </motion.button>
        <span className="tiny faint">tag it · optional</span>
      </div>

      <div className="row" style={{ marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
        {TRIGGERS.map((t) => (
          <motion.button
            key={t}
            className={`chip ${ev.trigger === t ? 'selected' : ''}`}
            style={chipStyle}
            whileTap={{ scale: 0.94 }}
            onClick={() => api.tagEvent(eventId, t)}
          >
            {t}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
