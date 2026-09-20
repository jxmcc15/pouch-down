import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import {
  dateForDayNumber, mgForDay, todayKey, dayNumberFor,
  pouchesForDay, plannedMgForDay,
} from '../store.js';
import { moneyStats } from '../money.js';
import { TRIGGERS } from './SOSOverlay.jsx';
import AnimatedNumber from './AnimatedNumber.jsx';
import DisciplineCard from './DisciplineCard.jsx';
import FirstPouchChart from './FirstPouchChart.jsx';
import RhythmChart from './RhythmChart.jsx';
import GapsCard from './GapsCard.jsx';
import CorrelationCard from './CorrelationCard.jsx';
import HistoryTimeline from './HistoryTimeline.jsx';
import MoneyCard from './MoneyCard.jsx';
import TrophyCase from './awards/TrophyCase.jsx';

const W = 440;
const H = 180;
const PAD = { l: 30, r: 10, t: 14, b: 22 };

function x(day, totalDays) {
  return PAD.l + ((day - 1) / (totalDays - 1)) * (W - PAD.l - PAD.r);
}

const fmtShort = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
function y(mg, maxMg) {
  return PAD.t + (1 - mg / maxMg) * (H - PAD.t - PAD.b);
}

// Planned descent (staircase) vs actual daily mg. The staircase falling off
// a cliff is the motivational core of the stats tab.
function MgChart({ state }) {
  const { totalDays, startDate, quitDate } = state.plan;
  const maxMg = 90;
  const todayN = Math.min(dayNumberFor(state, todayKey()), totalDays);

  const plannedPts = [];
  for (let n = 1; n <= totalDays; n++) plannedPts.push(`${x(n, totalDays)},${y(plannedMgForDay(state, n), maxMg)}`);
  const plannedPath = `M ${plannedPts.join(' L ')}`;

  let actualPath = null;
  if (todayN >= 1) {
    const pts = [];
    for (let n = 1; n <= todayN; n++) {
      const d = dateForDayNumber(state, n);
      pts.push(`${x(n, totalDays)},${y(mgForDay(state, d), maxMg)}`);
    }
    actualPath = `M ${pts.join(' L ')}`;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto' }}
        role="img"
        aria-label="Daily nicotine milligrams: planned taper versus actual"
      >
        {[0, 30, 60, 90].map((mg) => (
          <g key={mg}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(mg, maxMg)} y2={y(mg, maxMg)} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.l - 6} y={y(mg, maxMg) + 3} fontSize="9" fill="var(--fg-faint)" textAnchor="end" className="num">
              {mg}
            </text>
          </g>
        ))}
        <motion.path
          d={plannedPath}
          fill="none"
          stroke="rgba(138,143,152,0.55)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
        {actualPath && (
          <motion.path
            d={actualPath}
            fill="none"
            stroke="var(--accent-bright)"
            strokeWidth="2.5"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
            style={{ filter: 'drop-shadow(0 0 6px var(--accent-glow))' }}
          />
        )}
        <text x={x(1, totalDays)} y={H - 6} fontSize="9" fill="var(--fg-faint)">{fmtShort(startDate)}</text>
        <text x={x(totalDays, totalDays)} y={H - 6} fontSize="9" fill="var(--fg-faint)" textAnchor="end">{fmtShort(quitDate)}</text>
      </svg>
      <div className="row small muted" style={{ gap: 16, justifyContent: 'center' }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 14, borderTop: '2px dashed var(--fg-muted)' }} /> plan
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 14, borderTop: '2.5px solid var(--accent-bright)' }} /> you
        </span>
      </div>
    </div>
  );
}

function TriggerBars({ state }) {
  const counts = {};
  TRIGGERS.forEach((t) => (counts[t] = { used: 0, resisted: 0 }));
  state.events.forEach((e) => {
    if (!e.trigger || !counts[e.trigger]) return;
    if (e.type === 'pouch') counts[e.trigger].used++;
    else counts[e.trigger].resisted++;
  });
  const rows = Object.entries(counts)
    .map(([t, c]) => ({ t, ...c, total: c.used + c.resisted }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  const max = Math.max(...rows.map((r) => r.total), 1);

  if (!rows.length) {
    return (
      <p className="small muted" style={{ margin: 0 }}>
        No trigger data yet — tag cravings in SOS mode and this fills in with
        what actually sets you off.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={r.t}>
          <div className="spread small" style={{ marginBottom: 4 }}>
            <span className="muted">{r.t}</span>
            <span className="faint num">
              {r.resisted > 0 && <span style={{ color: 'var(--green)' }}>{r.resisted} beat · </span>}
              {r.used} used
            </span>
          </div>
          <div style={{ display: 'flex', gap: 2, height: 8, borderRadius: 4, overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.used / max) * 100}%` }}
              transition={{ type: 'spring', damping: 26, stiffness: 140, delay: i * 0.06 }}
              style={{ background: 'var(--amber)', borderRadius: 4, opacity: 0.85 }}
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(r.resisted / max) * 100}%` }}
              transition={{ type: 'spring', damping: 26, stiffness: 140, delay: i * 0.06 + 0.05 }}
              style={{ background: 'var(--green)', borderRadius: 4 }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function StatsView({ openSettings }) {
  const { state } = useApp();
  const { totalDays, baseline, quitDate } = state.plan;
  const money = moneyStats(state);
  const saved = money.kept;
  const perPouch = money.perPouch;
  const todayN = dayNumberFor(state, todayKey());

  // Projection: money saved by quit day if the rest of the plan is followed.
  let projected = saved;
  for (let n = Math.max(todayN + 1, 1); n <= totalDays; n++) {
    projected += (baseline.pouchesPerDay * baseline.mg - plannedMgForDay(state, n)) / baseline.mg * perPouch;
  }

  let avoided = 0;
  const resistedTotal = state.events.filter((e) => e.type === 'resisted').length;
  for (let n = 1; n <= Math.min(todayN, totalDays); n++) {
    const d = dateForDayNumber(state, n);
    if (d <= todayKey()) avoided += Math.max(0, baseline.pouchesPerDay - pouchesForDay(state, d));
  }

  const spring = { type: 'spring', damping: 24, stiffness: 180 };

  return (
    <div>
      <h2 style={{ fontSize: 20, margin: '4px 0 14px' }}>The story so far</h2>

      <motion.div className="card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="tiny muted" style={{ marginBottom: 8 }}>Daily nicotine (mg)</div>
        <MgChart state={state} />
      </motion.div>

      <div style={{ marginTop: 14 }}>
        <MoneyCard onOpenSettings={openSettings} />
      </div>

      <motion.div
        className="row"
        style={{ marginTop: 14, gap: 14 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.08 }}
      >
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 800 }} className="num">
            ${projected.toFixed(0)}
          </div>
          <div className="tiny faint">by {fmtShort(quitDate)}</div>
          <div className="small muted" style={{ marginTop: 4 }}>
            if you follow the plan
          </div>
        </div>
        <div className="card" style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 800 }} className="num">
            <AnimatedNumber value={avoided} />
          </div>
          <div className="tiny faint">pouches not used</div>
          <div className="small muted num" style={{ marginTop: 4 }}>
            {resistedTotal} cravings beaten
          </div>
        </div>
      </motion.div>

      <TrophyCase />

      <DisciplineCard />
      <FirstPouchChart />
      <RhythmChart />
      <GapsCard />
      <CorrelationCard />

      <motion.div
        className="card"
        style={{ marginTop: 14 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring, delay: 0.16 }}
      >
        <div className="tiny muted" style={{ marginBottom: 12 }}>Your triggers</div>
        <TriggerBars state={state} />
      </motion.div>

      <HistoryTimeline />
    </div>
  );
}
