import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import { firstPouchTimes } from '../store.js';
import { TOTAL_DAYS, START_DATE, QUIT_DATE } from '../plan.js';

// Same drawing box + padding as MgChart so the two charts read as a set.
const W = 440;
const H = 180;
const PAD = { l: 30, r: 10, t: 14, b: 22 };

// Y axis is time-of-day, measured in minutes since the 4am day cutoff, so it
// speaks the same units as firstPouchTimes().minutesSince4am. Fixed window
// 6:00 AM (120) → 8:00 PM (960); values outside get clamped in.
const DAY_START_MIN = 240; // 4:00 AM in minutes past midnight
const Y_MIN = 120; // 6:00 AM
const Y_MAX = 960; // 8:00 PM
const Y_TICKS = [120, 300, 480, 660, 840]; // 6a, 9a, 12p, 3p, 6p

function x(day) {
  return PAD.l + ((day - 1) / (TOTAL_DAYS - 1)) * (W - PAD.l - PAD.r);
}

// Later in the day plots HIGHER — holding out longer makes the line climb.
// That upward drift is the whole motivational read of this chart.
function y(minSince4am) {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, minSince4am));
  return PAD.t + (1 - (clamped - Y_MIN) / (Y_MAX - Y_MIN)) * (H - PAD.t - PAD.b);
}

const fmtShort = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// minutes-since-4am → clock label like "6a" / "12p" / "3p".
function clockLabel(minSince4am) {
  const totalMin = (((minSince4am + DAY_START_MIN) % 1440) + 1440) % 1440;
  const h24 = Math.floor(totalMin / 60);
  const suffix = h24 < 12 ? 'a' : 'p';
  const h12 = h24 % 12 || 12;
  return `${h12}${suffix}`;
}

const spring = { type: 'spring', damping: 24, stiffness: 180 };

function Graph({ points, lunchMin }) {
  const linePath =
    points.length > 1
      ? `M ${points.map((p) => `${x(p.dayNum)},${y(p.minutesSince4am)}`).join(' L ')}`
      : null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto' }}
        role="img"
        aria-label="Time of day of each day's first pouch across the 60-day plan"
      >
        {/* time-of-day gridlines + labels */}
        {Y_TICKS.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.l - 6} y={y(t) + 3} fontSize="9" fill="var(--fg-faint)" textAnchor="end">
              {clockLabel(t)}
            </text>
          </g>
        ))}

        {/* current lunch meal time — the Stage 6 target James is tapering toward */}
        {lunchMin != null && (
          <g>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(lunchMin)}
              y2={y(lunchMin)}
              stroke="var(--amber)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.5"
            />
            <text
              x={PAD.l + 2}
              y={y(lunchMin) - 4}
              fontSize="9"
              fill="var(--amber)"
              opacity="0.85"
            >
              Stage 6 target
            </text>
          </g>
        )}

        {/* thin trend line through the dots */}
        {linePath && (
          <motion.path
            d={linePath}
            fill="none"
            stroke="var(--accent-bright)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          />
        )}

        {/* one dot per logged day */}
        {points.map((p, i) => (
          <motion.circle
            key={p.date}
            cx={x(p.dayNum)}
            cy={y(p.minutesSince4am)}
            r={3}
            fill="var(--accent-bright)"
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...spring, delay: 0.25 + Math.min(i, 40) * 0.02 }}
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          />
        ))}

        {/* plan start / quit-day anchors, matching MgChart */}
        <text x={x(1)} y={H - 6} fontSize="9" fill="var(--fg-faint)">{fmtShort(START_DATE)}</text>
        <text x={x(TOTAL_DAYS)} y={H - 6} fontSize="9" fill="var(--fg-faint)" textAnchor="end">{fmtShort(QUIT_DATE)}</text>
      </svg>
    </div>
  );
}

export default function FirstPouchChart() {
  const { state } = useApp();
  const points = firstPouchTimes(state);

  // Reference line at the current lunch time (e.g. "12:30" → 12*60+30−240 = 510).
  // Guard the parse so a missing/garbled setting just drops the line, never crashes.
  const lunch = state.settings?.mealTimes?.lunch || '12:30';
  const [lh, lm] = lunch.split(':').map(Number);
  const lunchMin =
    Number.isFinite(lh) && Number.isFinite(lm) ? lh * 60 + lm - DAY_START_MIN : null;

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="tiny muted" style={{ marginBottom: 8 }}>First pouch of the day</div>
      {points.length === 0 ? (
        <p className="small faint" style={{ margin: 0 }}>
          Nothing logged yet — this will track what time your first pouch lands
          each day, and you'll watch it drift later as you hold out longer.
        </p>
      ) : (
        <Graph points={points} lunchMin={lunchMin} />
      )}
    </motion.div>
  );
}
