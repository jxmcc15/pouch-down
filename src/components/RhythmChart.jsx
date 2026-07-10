import { motion } from 'framer-motion';
import { useApp } from '../state.jsx';
import { hourHistogram } from '../store.js';

// SVG follows MgChart conventions: 440-wide viewBox, PAD, faint labels, an
// overflowX-auto wrapper so a phone never scrolls the page body sideways.
const W = 440;
const H = 150;
const PAD = { l: 8, r: 8, t: 12, b: 20 };
const INNER_W = W - PAD.l - PAD.r;
const SLOT_W = INNER_W / 24;
const BAR_W = SLOT_W * 0.62;
const BASELINE = H - PAD.b; // y where every bar sits
const INNER_H = BASELINE - PAD.t; // pixels available for the tallest stack

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Only four ticks so 24 bars stay uncluttered on a 375px screen.
const X_LABELS = [
  { hour: 0, text: '12a' },
  { hour: 6, text: '6a' },
  { hour: 12, text: '12p' },
  { hour: 18, text: '6p' },
];

const barX = (hour) => PAD.l + hour * SLOT_W + (SLOT_W - BAR_W) / 2;
const slotCenter = (hour) => PAD.l + hour * SLOT_W + SLOT_W / 2;

export default function RhythmChart() {
  const { state } = useApp();
  const buckets = hourHistogram(state); // always 24 entries, even at zero events
  const maxTotal = Math.max(1, ...buckets.map((b) => b.onTime + b.off));
  const totalPouches = buckets.reduce((sum, b) => sum + b.onTime + b.off, 0);

  const h = (v) => (v / maxTotal) * INNER_H; // linear so segments stay flush

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
    >
      <div className="tiny muted" style={{ marginBottom: 10 }}>Your rhythm</div>

      {totalPouches === 0 ? (
        <p className="small faint" style={{ margin: 0 }}>
          Once you&rsquo;ve logged a few pouches, the hours you reach for one show
          up here — no judgment, just the shape of your day.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <svg
              viewBox={`0 0 ${W} ${H}`}
              style={{ width: '100%', height: 'auto' }}
              role="img"
              aria-label="Pouches by hour of day: on-time in indigo, early or over cap in amber"
            >
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={BASELINE}
                y2={BASELINE}
                stroke="rgba(255,255,255,0.06)"
              />
              {buckets.map((b) => {
                const onH = h(b.onTime);
                const stackH = h(b.onTime + b.off);
                const x = barX(b.hour);
                // Amber is drawn full-height and the indigo on-time bar is
                // painted over its bottom, so both scale up from the shared
                // baseline and stay perfectly flush through the animation.
                return (
                  <g key={b.hour}>
                    {b.off > 0 && (
                      <motion.rect
                        x={x}
                        y={BASELINE - stackH}
                        width={BAR_W}
                        height={stackH}
                        rx={2}
                        fill="var(--amber)"
                        style={{ originY: 1 }}
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ ...spring, delay: b.hour * 0.015 }}
                      />
                    )}
                    {b.onTime > 0 && (
                      <motion.rect
                        x={x}
                        y={BASELINE - onH}
                        width={BAR_W}
                        height={onH}
                        rx={b.off > 0 ? 0 : 2}
                        fill="var(--accent-bright)"
                        style={{ originY: 1 }}
                        initial={{ scaleY: 0 }}
                        animate={{ scaleY: 1 }}
                        transition={{ ...spring, delay: b.hour * 0.015 }}
                      />
                    )}
                  </g>
                );
              })}
              {X_LABELS.map((l) => (
                <text
                  key={l.hour}
                  x={slotCenter(l.hour)}
                  y={H - 6}
                  fontSize="9"
                  fill="var(--fg-faint)"
                  textAnchor="middle"
                >
                  {l.text}
                </text>
              ))}
            </svg>
          </div>

          <div
            className="row small muted"
            style={{ gap: 16, justifyContent: 'center', marginTop: 4 }}
          >
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--accent-bright)' }} />
              on time
            </span>
            <span className="row" style={{ gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--amber)' }} />
              early or over
            </span>
          </div>
        </>
      )}
    </motion.div>
  );
}
