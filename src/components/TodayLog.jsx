// Compact "Today's log" card for the Today tab: today's events oldest→newest
// (newest last), each pouch stamped with time · slot · honest verdict, plus a
// live "since last pouch" gap ticker in the header. Read-only view of history.
import { motion } from 'framer-motion';
import { ShieldCheck, Moon } from 'lucide-react';
import { useApp } from '../state.jsx';
import {
  rawEventsForDay,
  todayKey,
  timeSinceLastPouch,
  fmtTime,
  fmtDuration,
  triggersFor,
  pouchFlags,
} from '../store.js';
import { pouchVerdict } from '../pouchVerdict.js';
import { asText } from '../text.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Fixed-width leading column so dot rows and icon rows align their text start.
const lead = { width: 15, display: 'inline-flex', justifyContent: 'center', flexShrink: 0 };

function LogRow({ state, ev }) {
  const tags = triggersFor(state, ev).map(asText).filter(Boolean);
  if (ev.type === 'resisted') {
    return (
      <div className="row small">
        <span style={lead}><ShieldCheck size={15} color="var(--green)" /></span>
        <div>
          <span className="num">{fmtTime(ev)}</span>
          <span style={{ color: 'var(--green)' }}> · resisted</span>
          {tags.length > 0 && <span className="faint"> · {tags.join(', ')}</span>}
        </div>
      </div>
    );
  }

  if (ev.type === 'checkin') {
    return (
      <div className="row small">
        <span style={lead}><Moon size={15} color="var(--accent-bright)" /></span>
        <div>
          <span className="num">{fmtTime(ev)}</span>
          <span className="muted"> · morning check-in</span>
        </div>
      </div>
    );
  }

  // Corrections, reasons and voids aren't pouches; they show through the pouch
  // they belong to (a reason's tags, a void's strike), never as rows of their own.
  if (ev.type !== 'pouch') return null;

  // pouch. pouchVerdict goes through classifyPouch, which derives ctx for old
  // events that lack it; the slot label reads straight off the stamp, omitted
  // when absent. A mistake stays on the page: its text muted, not faint, so it
  // stays readable under the strike; the strike and the faint "mistake" tag
  // carry the meaning. Never red.
  const { voided, late, untimed } = pouchFlags(state, ev);
  const verdict = pouchVerdict(state, ev);
  const slotLabel = asText(ev.ctx?.slotLabel);
  const dot = voided ? 'var(--fg-faint)' : verdict.color;
  const struck = voided ? { color: 'var(--fg-muted)', textDecoration: 'line-through' } : undefined;
  return (
    <div className="row small">
      <span style={lead}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot }} />
      </span>
      <div>
        {/* An untimed pouch's ts is when it was entered, so "time unknown"
            stands in for the clock — and is its whole verdict, drawn once. */}
        <span className="num" style={struck}>{untimed ? 'time unknown' : fmtTime(ev)}</span>
        {slotLabel && <span className="muted" style={struck}> · {slotLabel}</span>}
        {!untimed && <span style={{ color: verdict.color, ...struck }}> · {verdict.text}</span>}
        {late && <span className="faint"> · added later</span>}
        {voided && <span className="faint"> · mistake</span>}
        {tags.length > 0 && <span className="faint"> · {tags.join(', ')}</span>}
      </div>
    </div>
  );
}

export default function TodayLog() {
  const { state, tick } = useApp();

  // Filter returns a fresh array, so sorting in place never touches state. The
  // raw list, so a pouch marked as a mistake still shows — struck — today.
  const events = rawEventsForDay(state, todayKey()).sort(
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
        <div className="small muted">Nothing logged yet today.</div>
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
