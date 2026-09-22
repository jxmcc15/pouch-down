import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import { firstPouchTimes } from '../store.js';

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

function x(day, totalDays) {
  return PAD.l + ((day - 1) / (totalDays - 1)) * (W - PAD.l - PAD.r);
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

function Graph({ points, target, totalDays, startDate, quitDate }) {
  const linePath =
    points.length > 1
      ? `M ${points.map((p) => `${x(p.dayNum, totalDays)},${y(p.minutesSince4am)}`).join(' L ')}`
      : null;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto' }}
        role="img"
        aria-label={`Time of day of each day's first pouch across your ${totalDays}-day plan`}
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

        {/* the meal your plan first pushes the day's first pouch back to */}
        {target && (
          <g>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(target.min)}
              y2={y(target.min)}
              stroke="var(--amber)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.5"
            />
            <text
              x={PAD.l + 2}
              y={y(target.min) - 4}
              fontSize="9"
              fill="var(--amber)"
              opacity="0.85"
            >
              Stage {target.stageId} target
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
            cx={x(p.dayNum, totalDays)}
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
        <text x={x(1, totalDays)} y={H - 6} fontSize="9" fill="var(--fg-faint)">{fmtShort(startDate)}</text>
        <text x={x(totalDays, totalDays)} y={H - 6} fontSize="9" fill="var(--fg-faint)" textAnchor="end">{fmtShort(quitDate)}</text>
      </svg>
    </div>
  );
}

// The reference line comes from the plan: the first stage whose first pouch
// waits until lunch or dinner, drawn at that meal's time (e.g. lunch "12:30"
// → 12*60+30−240 = 510). No such stage, or a missing/garbled meal time, just
// drops the line — never a crash, never a made-up target.
function firstPouchTarget(state) {
  const stage = (state.plan?.stages || []).find((s) => {
    const a = s.slots?.[0]?.anchor;
    return a === 'lunch' || a === 'dinner';
  });
  if (!stage) return null;
  const hm = state.settings?.mealTimes?.[stage.slots[0].anchor];
  const [h, m] = typeof hm === 'string' ? hm.split(':').map(Number) : [];
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return { stageId: stage.id, min: h * 60 + m - DAY_START_MIN };
}

export default function FirstPouchChart() {
  const { state } = useApp();
  const points = firstPouchTimes(state);
  const target = firstPouchTarget(state);
  const live = state.status !== 'archived';

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
          {live
            ? "Nothing logged yet — this will track what time your first pouch lands each day, and you'll watch it drift later as you hold out longer."
            : 'No pouches were logged in this attempt.'}
        </p>
      ) : (
        <Graph
          points={points}
          target={target}
          totalDays={state.plan.totalDays}
          startDate={state.plan.startDate}
          quitDate={state.plan.quitDate}
        />
      )}
    </motion.div>
  );
}
