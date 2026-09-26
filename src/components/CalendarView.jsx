import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { useApp } from '../state.jsx';
import { statusForDay, pouchesForDay, dateForDayNumber, asOfDay } from '../store.js';
import { capForDay } from '../plan.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const fmtShort = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtLong = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

export default function CalendarView({ onFixDay = null }) {
  const { state, readOnly } = useApp();
  // Today for a live attempt; for a past one, the last day it can be judged,
  // so days after it ended show only their planned cap.
  const today = asOfDay(state);
  const { totalDays, startDate, quitDate } = state.plan;

  const cells = [];
  const firstDate = new Date(`${dateForDayNumber(state, 1)}T12:00:00`);
  for (let i = 0; i < firstDate.getDay(); i++) cells.push({ blank: true, key: `b${i}` });
  for (let n = 1; n <= totalDays; n++) {
    const d = dateForDayNumber(state, n);
    cells.push({ n, d, status: statusForDay(state, d), used: pouchesForDay(state, d), cap: capForDay(state.plan, n), key: d });
  }

  const tappable = (c) => !c.blank && !!onFixDay && !readOnly && c.status !== 'future' && c.status !== 'pre';

  const greens = cells.filter((c) => c.status === 'green').length;
  const yellows = cells.filter((c) => c.status === 'yellow').length;
  const nologs = cells.filter((c) => c.status === 'nolog').length;

  return (
    <div>
      <h2 style={{ fontSize: 20, margin: '4px 0 2px' }}>The {totalDays} days</h2>
      <p className="small muted" style={{ margin: '0 0 16px' }}>
        {fmtLong(startDate)} → {fmtLong(quitDate)} · Every logged day counts. Gray means no log.
      </p>

      <div className="cal-grid" style={{ marginBottom: 8 }}>
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="tiny faint" style={{ textAlign: 'center' }}>{w}</div>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((c, i) => {
          const Cell = tappable(c) ? motion.button : motion.div;
          return c.blank ? (
            <div key={c.key} />
          ) : (
            // A past or today cell opens "Fix this day"; future/pre cells and
            // the read-only viewer stay plain.
            <Cell
              {...(tappable(c) ? { type: 'button', onClick: () => onFixDay(c.d) } : {})}
              key={c.key}
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
              transition={{ type: 'spring', damping: 20, stiffness: 260, delay: i * 0.015 }}
              aria-label={`Day ${c.n}, ${fmtShort(c.d)}: ${c.status === 'nolog' ? 'no log' : `${c.used} of ${c.cap} pouches`}`}
            >
              {c.n === totalDays ? (
                <Star size={16} color="var(--accent-bright)" fill="var(--accent-bright)" />
              ) : (
                <span className="num">{c.n}</span>
              )}
              <span className="cap num">
                {c.status === 'nolog' ? 'no log' : (c.d <= today ? `${c.used}/${c.cap}` : c.cap)}
              </span>
            </Cell>
          );
        })}
      </div>

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
          <Star size={12} color="var(--accent-bright)" /> quit day
        </span>
      </div>
    </div>
  );
}
