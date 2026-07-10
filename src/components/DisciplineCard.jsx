import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import { disciplineStats } from '../store.js';
import AnimatedNumber from './AnimatedNumber.jsx';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// One discipline bucket: big all-time count on the left, label + today's slice
// + optional sub-line on the right. On-time leads (largest, green); early and
// over-cap are the same plain amber — a fact to see, never an alarm.
function Stat({ value, today, label, color, size, weight = 700, sub = null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
      <div style={{ fontSize: size, fontWeight: weight, color, lineHeight: 1, minWidth: 56, textAlign: 'right' }}>
        <AnimatedNumber value={value} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="small muted num" style={{ marginTop: 1 }}>· {today} today</div>
        {sub}
      </div>
    </div>
  );
}

export default function DisciplineCard() {
  const { state } = useApp();
  const d = disciplineStats(state);
  const total = d.onTime + d.early + d.overCap;
  const showAvgs = d.avgMinHeld != null || d.avgMinEarly != null;

  return (
    <motion.div
      className="card"
      style={{ marginTop: 14 }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="tiny muted" style={{ marginBottom: 14 }}>Slot discipline</div>

      {total === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Log a few pouches and this fills in with how you're pacing.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Stat
              value={d.onTime}
              today={d.today.onTime}
              label="on time"
              color="var(--green)"
              size={32}
              weight={800}
            />
            <Stat
              value={d.early}
              today={d.today.early}
              label="early"
              color="var(--amber)"
              size={24}
              sub={
                d.preFirstSlot > 0 ? (
                  <div className="small faint" style={{ marginTop: 2 }}>
                    of which {d.preFirstSlot} before the day&apos;s first slot
                  </div>
                ) : null
              }
            />
            <Stat
              value={d.overCap}
              today={d.today.overCap}
              label="over cap"
              color="var(--amber)"
              size={24}
            />
          </div>

          {showAvgs && (
            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {d.avgMinHeld != null && (
                <div className="small muted">
                  held out an average of{' '}
                  <span className="num" style={{ color: 'var(--green)', fontWeight: 600 }}>
                    {Math.round(d.avgMinHeld)}m
                  </span>{' '}
                  past unlock
                </div>
              )}
              {d.avgMinEarly != null && (
                <div className="small muted">
                  average{' '}
                  <span className="num" style={{ color: 'var(--amber)', fontWeight: 600 }}>
                    {Math.round(d.avgMinEarly)}m
                  </span>{' '}
                  early when early
                </div>
              )}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
