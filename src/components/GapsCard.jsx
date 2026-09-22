import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import { gapStats, fmtDuration, fmtTime } from '../store.js';
import { dayKeyOf } from '../time.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// dayKey ("2026-07-03") → "Jul 3". Noon anchor avoids any TZ date-flip.
const fmtShortDate = (dateStr) =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Null-safe duration: missing data shows an em dash so the label still reads.
const dur = (ms) => (ms == null ? '—' : fmtDuration(ms));
const fromMin = (min) => (min == null ? null : min * 60000);

export default function GapsCard() {
  const { state, tick } = useApp();
  const { avgGapTodayMin, avgGap7dMin, longestGapMs, longestGapEnd, currentGapMs } = gapStats(state);

  // A past attempt has no "now": no live clock, no per-second heartbeat, and
  // no "today" averages. (currentGapMs may be a number or null for a past
  // attempt depending on the store version; either way it isn't shown.)
  const live = state.status !== 'archived';
  const noPouches = !state.events.some((e) => e.type === 'pouch');
  const showClock = live && currentGapMs != null;
  const hasLongest = longestGapMs != null && longestGapEnd != null;

  // Longest stretch ever — a genuine win, so it reads green.
  const longest = (
    <div className="spread">
      <div>
        <div className="tiny faint">{live ? 'longest gap ever' : 'longest gap'}</div>
        {hasLongest && (
          <div className="small faint" style={{ marginTop: 3 }}>
            incl. sleep · ended {fmtShortDate(dayKeyOf(longestGapEnd))} {fmtTime(longestGapEnd)}
          </div>
        )}
      </div>
      <div className="num" style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {dur(longestGapMs)}
      </div>
    </div>
  );

  // currentGapMs is (now − last pouch), recomputed by gapStats on every render.
  // `tick` from useApp() bumps once a second; rendering it as data-tick keeps
  // that heartbeat a live dependency so the figure below keeps counting up —
  // only while the clock is on screen.
  return (
    <motion.div
      className="card"
      data-tick={showClock ? tick : undefined}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="tiny muted" style={{ marginBottom: 14 }}>Space between pouches</div>

      {live ? (
        <>
          {/* Live centerpiece: time since the last pouch, counting up every second. */}
          <div style={{ textAlign: 'center', paddingBottom: 16 }}>
            <div
              className="num"
              style={{ fontSize: 34, fontWeight: 800, color: 'var(--accent-bright)', lineHeight: 1.1 }}
            >
              {dur(showClock ? currentGapMs : null)}
            </div>
            <div className="tiny faint" style={{ marginTop: 5 }}>since last pouch</div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            {/* Two same-day averages (sleep excluded), split by a hairline. */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
                <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{dur(fromMin(avgGapTodayMin))}</div>
                <div className="tiny faint" style={{ marginTop: 3 }}>avg · today</div>
              </div>
              <div style={{ width: 1, background: 'var(--border)' }} />
              <div style={{ flex: 1, textAlign: 'center', padding: '0 4px' }}>
                <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>{dur(fromMin(avgGap7dMin))}</div>
                <div className="tiny faint" style={{ marginTop: 3 }}>avg · 7 days</div>
              </div>
            </div>

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>{longest}</div>
          </div>
        </>
      ) : (
        // A past attempt: the averages count back from today, so only the
        // longest gap still means something.
        longest
      )}

      {noPouches && (
        <div className="small muted" style={{ marginTop: 14, textAlign: 'center' }}>
          {live
            ? 'Log your first pouch to start the clock — the gaps grow from there.'
            : 'No pouches were logged in this attempt.'}
        </div>
      )}
    </motion.div>
  );
}
