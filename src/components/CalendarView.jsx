import { motion } from 'framer-motion';
import { PencilLine, RotateCcw, Star } from 'lucide-react';
import { useApp } from '../state.jsx';
import { asOfDay } from '../store.js';
import { monthsFor } from '../calendarMonths.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const fmtShort = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtLong = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

// Entrance stagger: plan day n waits (n - 1) steps, capped so a long plan's
// last month doesn't sit invisible for a second. ?static still freezes it.
const STAGGER_CAP = 40;
const STAGGER_STEP = 0.012;

export default function CalendarView({ onFixDay = null }) {
  const { state, readOnly } = useApp();
  // Today for a live attempt; for a past one, the last day it can be judged,
  // so days after it ended show only their planned cap.
  const today = asOfDay(state);
  const { totalDays, startDate, quitDate } = state.plan;

  const months = monthsFor(state);
  const all = months.flatMap((m) => m.cells);

  const tappable = (c) => !!onFixDay && !readOnly && c.status !== 'future' && c.status !== 'pre';

  const greens = all.filter((c) => c.status === 'green').length;
  const yellows = all.filter((c) => c.status === 'yellow').length;
  const nologs = all.filter((c) => c.status === 'nolog').length;

  return (
    <div>
      <h2 style={{ fontSize: 20, margin: '4px 0 2px' }}>The {totalDays} days</h2>
      <p className="small muted" style={{ margin: '0 0 16px' }}>
        {fmtLong(startDate)} → {fmtLong(quitDate)} · Every logged day counts. Gray means no log.
      </p>

      {months.map((m) => (
        <section key={m.key} className="cal-section" aria-label={`${m.label}, days ${m.dayRange[0]} to ${m.dayRange[1]}`}>
          <div className="cal-month">
            <b>{m.label}</b>
            <span className="tiny faint num">days {m.dayRange[0]}–{m.dayRange[1]}</span>
          </div>
          <div className="cal-grid" style={{ marginBottom: 8 }} aria-hidden="true">
            {WEEKDAYS.map((w, k) => (
              <div key={k} className="tiny faint" style={{ textAlign: 'center' }}>{w}</div>
            ))}
          </div>
          <div className="cal-grid">
            {Array.from({ length: m.lead }, (_, k) => <div key={`b${k}`} />)}
            {m.cells.map((c) => {
              const Cell = tappable(c) ? motion.button : motion.div;
              const marks = [c.corrected && 'corrected', c.backfilled && 'backfilled'].filter(Boolean);
              return (
                // A past or today cell opens "Fix this day"; future/pre cells and
                // the read-only viewer stay plain.
                <Cell
                  {...(tappable(c) ? { type: 'button', onClick: () => onFixDay(c.d) } : {})}
                  key={c.d}
                  className={[
                    'cal-cell',
                    c.status === 'green' && 'cal-green',
                    c.status === 'yellow' && 'cal-yellow',
                    c.status === 'nolog' && 'cal-nolog',
                    (c.status === 'today-under' || c.status === 'today-over') && 'cal-today',
                    c.status === 'future' && 'cal-future',
                  ].filter(Boolean).join(' ')}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', damping: 20, stiffness: 260, delay: Math.min(c.n - 1, STAGGER_CAP) * STAGGER_STEP }}
                  aria-label={`Day ${c.n}, ${fmtShort(c.d)}: ${c.status === 'nolog' ? 'no log' : `${c.used} of ${c.cap} pouches`}${marks.length ? `, ${marks.join(', ')}` : ''}`}
                >
                  {c.n === totalDays ? (
                    <Star size={16} color="var(--accent-bright)" fill="var(--accent-bright)" />
                  ) : (
                    <span className="num">{c.dom}</span>
                  )}
                  <span className="cap num">
                    {c.status === 'nolog' ? 'no log' : (c.d <= today ? `${c.used}/${c.cap}` : c.cap)}
                  </span>
                  {/* One mark per cell; a correction outranks a backfill. Both are in the label. */}
                  {c.corrected && <span className="mark" aria-hidden="true"><PencilLine size={9} /></span>}
                  {!c.corrected && c.backfilled && <span className="mark" aria-hidden="true"><RotateCcw size={9} /></span>}
                </Cell>
              );
            })}
          </div>
        </section>
      ))}

      <div className="row" style={{ marginTop: 18, justifyContent: 'center', gap: '8px 18px', flexWrap: 'wrap' }}>
        <span className="row small muted" style={{ gap: 6 }}>
          <span className="slot-dot" style={{ background: 'var(--green)', borderColor: 'var(--green)' }} />
          on plan ({greens})
        </span>
        <span className="row small muted" style={{ gap: 6 }}>
          <span className="slot-dot" style={{ background: 'var(--amber)', borderColor: 'var(--amber)' }} />
          over ({yellows})
        </span>
        <span className="row small muted" style={{ gap: 6 }}>
          <span className="slot-dot" style={{ background: 'var(--nolog)', borderColor: 'var(--nolog)' }} />
          no log ({nologs})
        </span>
        <span className="row small muted" style={{ gap: 6 }}>
          <PencilLine size={12} /> corrected
        </span>
        <span className="row small muted" style={{ gap: 6 }}>
          <RotateCcw size={12} /> backfilled
        </span>
        <span className="row small muted" style={{ gap: 6 }}>
          <Star size={12} color="var(--accent-bright)" /> quit day
        </span>
      </div>
    </div>
  );
}
