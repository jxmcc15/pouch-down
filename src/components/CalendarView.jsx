import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { useApp } from '../state.jsx';
import { statusForDay, pouchesForDay, dateForDayNumber, todayKey } from '../store.js';
import { capForDay, TOTAL_DAYS, START_DATE, QUIT_DATE } from '../plan.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const fmtLong = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

export default function CalendarView() {
  const { state } = useApp();
  const today = todayKey();

  const cells = [];
  const firstDate = new Date(`${dateForDayNumber(1)}T12:00:00`);
  for (let i = 0; i < firstDate.getDay(); i++) cells.push({ blank: true, key: `b${i}` });
  for (let n = 1; n <= TOTAL_DAYS; n++) {
    const d = dateForDayNumber(n);
    cells.push({ n, d, status: statusForDay(state, d), used: pouchesForDay(state, d), cap: capForDay(n), key: d });
  }

  const greens = cells.filter((c) => c.status === 'green').length;
  const yellows = cells.filter((c) => c.status === 'yellow').length;

  return (
    <div>
      <h2 style={{ fontSize: 20, margin: '4px 0 2px' }}>The {TOTAL_DAYS} days</h2>
      <p className="small muted" style={{ margin: '0 0 16px' }}>
        {fmtLong(START_DATE)} → {fmtLong(QUIT_DATE)} · don't break the chain
      </p>

      <div className="cal-grid" style={{ marginBottom: 8 }}>
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="tiny faint" style={{ textAlign: 'center' }}>{w}</div>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((c, i) =>
          c.blank ? (
            <div key={c.key} />
          ) : (
            <motion.div
              key={c.key}
              className={[
                'cal-cell',
                c.status === 'green' && 'cal-green',
                c.status === 'yellow' && 'cal-yellow',
                (c.status === 'today-under' || c.status === 'today-over') && 'cal-today',
                c.status === 'future' && 'cal-future',
              ].filter(Boolean).join(' ')}
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 20, stiffness: 260, delay: i * 0.015 }}
              aria-label={`Day ${c.n}: ${c.used} of ${c.cap} pouches`}
            >
              {c.n === TOTAL_DAYS ? (
                <Star size={16} color="var(--accent-bright)" fill="var(--accent-bright)" />
              ) : (
                <span className="num">{c.n}</span>
              )}
              <span className="cap num">
                {c.d <= today ? `${c.used}/${c.cap}` : c.cap}
              </span>
            </motion.div>
          )
        )}
      </div>

      <div className="row" style={{ marginTop: 18, justifyContent: 'center', gap: 18 }}>
        <span className="row small muted" style={{ gap: 6 }}>
          <span className="slot-dot" style={{ background: 'var(--green)', borderColor: 'var(--green)' }} />
          on plan ({greens})
        </span>
        <span className="row small muted" style={{ gap: 6 }}>
          <span className="slot-dot" style={{ background: 'var(--amber)', borderColor: 'var(--amber)' }} />
          over ({yellows})
        </span>
        <span className="row small muted" style={{ gap: 6 }}>
          <Star size={12} color="var(--accent-bright)" /> quit day
        </span>
      </div>
    </div>
  );
}
