import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { useApp } from '../state.jsx';
import { correlationStats } from '../store.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Exact copy strings kept together — the spec treats these as binding. Rendered
// as JS expressions so the ampersand/em-dash never touch JSX entity parsing.
const HEADING = 'Sleep, training & usage';
const UNLOCK_LINE = 'Check in 5 mornings to unlock this.';
const NO_WORKOUT = 'no workout data yet';
const FOOTNOTE = 'Small sample, correlation not causation — but patterns worth watching.';

// One correlation row: self-labeling band on the left, avg + sample on the
// right. Neutral colors on purpose — coloring these good/bad would imply
// causation the footnote explicitly disclaims.
function CorrelationRow({ label, cell }) {
  return (
    <div className="spread small">
      <span className="muted">{label}</span>
      <span className="num">
        {cell.avgPouches.toFixed(1)}/day · {cell.days}d
      </span>
    </div>
  );
}

export default function CorrelationCard() {
  const { state } = useApp();
  const { totalCheckins = 0, sleep = {}, workout = {} } = correlationStats(state);
  const locked = totalCheckins < 5;

  // Only render bands with real data. Guard `avgPouches != null` (not truthy)
  // so an honest 0.0/day still shows; guard `c &&` in case a cell is absent.
  const sleepRows = [
    ['poor sleep', sleep.poor],
    ['okay sleep', sleep.ok],
    ['good sleep', sleep.good],
  ].filter(([, c]) => c && c.days > 0 && c.avgPouches != null);

  const workoutRows = [
    ['workout days', workout.yes],
    ['rest days', workout.no],
  ].filter(([, c]) => c && c.days > 0 && c.avgPouches != null);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="tiny muted" style={{ marginBottom: 12 }}>{HEADING}</div>

      {locked ? (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <Lock size={16} style={{ color: 'var(--fg-muted)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div className="small">{UNLOCK_LINE}</div>
            <div className="small faint" style={{ marginTop: 3 }}>
              {totalCheckins}/5 so far
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sleepRows.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sleepRows.map(([label, cell]) => (
                <CorrelationRow key={label} label={label} cell={cell} />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workoutRows.length > 0 ? (
              workoutRows.map(([label, cell]) => (
                <CorrelationRow key={label} label={label} cell={cell} />
              ))
            ) : (
              <div className="small faint">{NO_WORKOUT}</div>
            )}
          </div>
        </div>
      )}

      <p className="small faint" style={{ margin: '14px 0 0' }}>{FOOTNOTE}</p>
    </motion.div>
  );
}
