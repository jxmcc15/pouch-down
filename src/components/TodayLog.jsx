// Compact "Today's log" card for the Today tab: today's events oldest→newest
// (newest last), each pouch stamped with time · slot · honest verdict, plus a
// live "since last pouch" gap ticker in the header. Read-only view of history.
import { motion } from 'framer-motion';
import { ShieldCheck, Moon } from 'lucide-react';
import { useApp } from '../state.jsx';
import {
  eventsForDay,
  todayKey,
  classifyPouch,
  timeSinceLastPouch,
  fmtTime,
  fmtDuration,
} from '../store.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Fixed-width leading column so dot rows and icon rows align their text start.
const lead = { width: 15, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 };

// Verdict label + color from a pouch's read-time classification. Early and
// over-cap are plain amber (never alarm-red); on-time / held-out is green.
function pouchVerdict(v) {
  if (v.bucket === 'over-cap') return { text: 'over cap', color: 'var(--amber)' };
  if (v.bucket === 'early') return { text: `${Math.abs(v.deltaMin)}m early`, color: 'var(--amber)' };
  if (v.bucket === 'baseline') return { text: 'baseline', color: 'var(--fg-muted)' };
  if (v.deltaMin >= 1) return { text: `on time +${v.deltaMin}m`, color: 'var(--green)' };
  return { text: 'on time', color: 'var(--green)' };
}

function LogRow({ state, ev }) {
  if (ev.type === 'resisted') {
    return (
      <div className="row small">
        <span style={lead}><ShieldCheck size={15} color="var(--green)" /></span>
        <div>
          <span className="num">{fmtTime(ev.ts)}</span>
          <span style={{ color: 'var(--green)' }}> · resisted</span>
          {ev.trigger && <span className="faint"> · {ev.trigger}</span>}
        </div>
      </div>
    );
  }

  if (ev.type === 'checkin') {
    return (
      <div className="row small">
        <span style={lead}><Moon size={15} color="var(--accent-bright)" /></span>
        <div>
          <span className="num">{fmtTime(ev.ts)}</span>
          <span className="muted"> · morning check-in</span>
        </div>
      </div>
    );
  }

  // pouch (default). classifyPouch derives ctx for old events that lack it;
  // the display slot label reads straight off the stamp, omitted when absent.
  const verdict = pouchVerdict(classifyPouch(state, ev));
  const slotLabel = ev.ctx?.slotLabel;
  return (
    <div className="row small">
      <span style={lead}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: verdict.color }} />
      </span>
      <div>
        <span className="num">{fmtTime(ev.ts)}</span>
        {slotLabel && <span className="muted"> · {slotLabel}</span>}
        <span style={{ color: verdict.color }}> · {verdict.text}</span>
        {ev.trigger && <span className="faint"> · {ev.trigger}</span>}
      </div>
    </div>
  );
}

export default function TodayLog() {
  const { state, tick } = useApp();

  // Filter returns a fresh array, so sorting in place never touches state.
  const events = eventsForDay(state, todayKey()).sort(
    (a, b) => new Date(a.ts) - new Date(b.ts), // ascending — newest lands last
  );
  const sinceMs = timeSinceLastPouch(state);

  return (
    <motion.div
      className="card"
      // data-tick consumes the 1s tick from state.jsx so the live gap stays current
      data-tick={tick}
      style={{ marginTop: 14 }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.12 }}
    >
      <div className="spread" style={{ marginBottom: 12 }}>
        <div className="tiny muted">Today's log</div>
        {sinceMs != null && (
          <div className="small muted num">{fmtDuration(sinceMs)} since last pouch</div>
        )}
      </div>

      {events.length === 0 ? (
        <div className="small muted">Nothing logged yet — today starts clean.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {events.map((ev) => (
            <LogRow key={ev.id} state={state} ev={ev} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
