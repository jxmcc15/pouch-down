import { motion } from 'framer-motion';
import { ChevronRight, Plus } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { dateForDayNumber, isLogged } from '../../store.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

const fmtDate = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// 'a3' → 3, matching how root.js mints ids. Falls back to list position if an
// id ever isn't that shape, so a row never reads "Attempt NaN".
function attemptNumber(attempt, i) {
  const n = Number(String(attempt.id).slice(1));
  return Number.isFinite(n) && n > 0 ? n : i + 1;
}

// Plan days the user actually told the app something about — same "silence is
// never success" rule the calendar and the streak use, so the number here can
// never flatter a quiet stretch.
function daysLogged(attempt) {
  let n = 0;
  for (let i = 1; i <= attempt.plan.totalDays; i++) {
    if (isLogged(attempt, dateForDayNumber(attempt, i))) n++;
  }
  return n;
}

// Shown when nothing is running: no active attempt, but history exists. Start
// another one, or open a past one read-only.
export default function FrontDoor({ onStart }) {
  const { root, api } = useApp();
  // Newest first; the ordinal comes from the original position, not this one.
  const past = root.attempts.map((a, i) => ({ a, n: attemptNumber(a, i) })).reverse();

  return (
    <div className="app-shell">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        style={{ paddingTop: 30, paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)' }}
      >
        <div className="row" style={{ gap: 10 }}>
          <div
            aria-hidden="true"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent), #43389f)',
              boxShadow: '0 0 18px var(--accent-glow)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 17,
              fontWeight: 800,
              color: '#fff',
            }}
          >
            ↓
          </div>
          <h1 style={{ fontSize: 26 }}>Pouch Down</h1>
        </div>

        <p className="muted" style={{ margin: '14px 0 0', fontSize: 15, lineHeight: 1.5 }}>
          Nothing is running right now. Start when you're ready — everything you
          logged before stays exactly as you left it.
        </p>

        <motion.button
          className="btn btn-accent"
          style={{ width: '100%', marginTop: 22 }}
          whileTap={{ scale: 0.98 }}
          onClick={onStart}
        >
          <Plus size={18} aria-hidden="true" /> Start a new attempt
        </motion.button>

        <p className="tiny muted" style={{ margin: '30px 0 10px' }}>Past attempts</p>

        {past.length === 0 ? (
          <p className="small faint" style={{ margin: 0 }}>None yet.</p>
        ) : (
          past.map(({ a, n }, i) => (
            <motion.button
              key={a.id}
              className="card"
              onClick={() => api.viewAttempt(a.id)}
              whileTap={{ scale: 0.98 }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: 0.04 * i }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '14px 16px',
                minHeight: 64,
              }}
            >
              <div className="spread">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>Attempt {n}</div>
                  <div className="small muted num" style={{ marginTop: 3 }}>
                    {fmtDate(a.plan.startDate)} – {fmtDate(a.plan.quitDate)} ·{' '}
                    {a.plan.totalDays} days · {daysLogged(a)} logged
                  </div>
                </div>
                <ChevronRight
                  size={18}
                  aria-hidden="true"
                  style={{ color: 'var(--fg-faint)', flexShrink: 0 }}
                />
              </div>
            </motion.button>
          ))
        )}

        <p className="small faint" style={{ margin: '14px 0 0' }}>
          Opening one is read-only. Nothing in it can change.
        </p>
      </motion.div>
    </div>
  );
}
