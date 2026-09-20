import { motion } from 'framer-motion';
import { Eye, CalendarCheck, Flame, PiggyBank } from 'lucide-react';
import { useApp } from '../state.jsx';
import { streaks } from '../store.js';
import { moneyStats } from '../money.js';

// The read-only viewer's two pieces, both for an archived attempt:
//   <ReadOnlyBanner />      the sticky "you're looking at the past" bar
//   <ReadOnlySummaryCard /> what TodayView shows where the live controls were
//
// Mount the banner ABOVE .app-shell (a sibling, not inside it) — it carries its
// own safe-area padding and goes full width, so nesting it inside the shell
// would inset the notch twice. Sticky, not fixed: it takes up layout space, so
// nothing starts life hidden underneath it.
//
// Neither component mutates anything: `exitViewing` is the only api call here.

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Parsed at noon so the printed date can't slide a day with the device's zone
// (the same trick store.js uses for day math).
const fmtShort = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const yearOf = (dateStr) => dateStr.slice(0, 4);

// "Jul 8 – Sep 5", plus the year once it stops being obvious (an attempt that
// straddles New Year, or any attempt from a year that isn't this one).
function fmtRange(start, end) {
  const showYear = yearOf(start) !== yearOf(end) || yearOf(end) !== String(new Date().getFullYear());
  return `${fmtShort(start)} – ${fmtShort(end)}${showYear ? `, ${yearOf(end)}` : ''}`;
}

// Ids are 'a' + ordinal ('a1', 'a2', …) — same parse root.js uses. Anything
// else and we just don't claim a number.
function attemptLabel(id) {
  const n = Number(String(id ?? '').slice(1));
  return Number.isInteger(n) && n > 0 ? `Attempt ${n}` : 'a past attempt';
}

export default function ReadOnlyBanner() {
  const { state, api } = useApp();
  if (!state) return null;

  return (
    <motion.div
      initial={{ y: -14, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={spring}
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 30, // under the bottom nav's 40, well under sheets (50+)
        background: 'linear-gradient(180deg, rgba(40, 30, 6, 0.94), rgba(10, 10, 12, 0.90))',
        borderBottom: '1px solid rgba(251, 191, 36, 0.32)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        padding: 'calc(env(safe-area-inset-top) + 10px) max(env(safe-area-inset-right), 20px) 10px max(env(safe-area-inset-left), 20px)',
      }}
    >
      <div className="spread" style={{ maxWidth: 480, margin: '0 auto' }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <Eye size={17} color="var(--amber)" aria-hidden="true" style={{ flexShrink: 0 }} />
          {/* the word "read-only" carries the meaning — the amber is only support */}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 15,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Viewing {attemptLabel(state.id)}
            </div>
            <div className="small num" style={{ color: 'var(--amber)' }}>
              {fmtRange(state.plan.startDate, state.plan.quitDate)} · read-only
            </div>
          </div>
        </div>

        <motion.button
          className="btn btn-ghost"
          onClick={() => api.exitViewing()}
          whileTap={{ scale: 0.96 }}
          aria-label="Exit read-only view"
          style={{
            minHeight: 44,
            padding: '0 16px',
            fontSize: 15,
            flexShrink: 0,
            color: 'var(--fg)',
            borderColor: 'rgba(251, 191, 36, 0.35)',
          }}
        >
          Exit
        </motion.button>
      </div>
    </motion.div>
  );
}

// One figure in the summary row.
function Figure({ icon, value, label, color }) {
  return (
    <div className="card" style={{ flex: 1, textAlign: 'center' }}>
      {icon}
      <div className="num" style={{ fontSize: 22, fontWeight: 800, color: color ?? 'var(--fg)' }}>
        {value}
      </div>
      <div className="tiny faint">{label}</div>
    </div>
  );
}

// Stands in for the log ring, SOS, check-in and backfill prompt while an old
// attempt is open. A record, not a verdict: no grades, no totals that silence
// could have inflated.
export function ReadOnlySummaryCard() {
  const { state } = useApp();
  if (!state) return null;

  const { loggedDays, kept } = moneyStats(state);
  const { best } = streaks(state); // an archived attempt's *current* streak means nothing
  const over = kept < 0;

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="tiny muted">What this attempt recorded</div>

      {loggedDays === 0 ? (
        <p className="small muted" style={{ margin: '12px 0 0' }}>
          No days here were logged, so there's nothing to total up. The days are
          still in the calendar, marked as no log.
        </p>
      ) : (
        <>
          <div className="row" style={{ gap: 12, marginTop: 14 }}>
            <Figure
              icon={<CalendarCheck size={17} color="var(--accent-bright)" style={{ marginBottom: 4 }} />}
              value={loggedDays}
              label="days logged"
            />
            <Figure
              icon={<Flame size={17} color={best > 0 ? 'var(--amber)' : 'var(--fg-faint)'} style={{ marginBottom: 4 }} />}
              value={best}
              label="best streak"
            />
            {/* kept can go negative — that's more spent than the old pace, said
                plainly in amber and never dressed up as a loss or a lecture */}
            <Figure
              icon={<PiggyBank size={17} color={over ? 'var(--amber)' : 'var(--green)'} style={{ marginBottom: 4 }} />}
              value={`$${Math.abs(kept).toFixed(2)}`}
              label={over ? 'over your old pace' : 'kept vs old pace'}
              color={over ? 'var(--amber)' : 'var(--green)'}
            />
          </div>

          <p className="small faint" style={{ margin: '12px 0 0' }}>
            Counted over the {loggedDays === 1 ? 'one day' : `${loggedDays} days`} you
            logged. Days without a log aren't in these numbers — nobody knows what
            happened on them.
          </p>
        </>
      )}

      <p className="small faint" style={{ margin: '8px 0 0' }}>
        Nothing here can be logged or changed. Exit at the top to get back to your
        current attempt.
      </p>
    </motion.div>
  );
}
