import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AnimatedNumber from './AnimatedNumber.jsx';

const SIZE = 264;
const R = 118;
const CX = SIZE / 2;

// Segmented progress ring: one arc segment per pouch in today's cap.
// Filled segments = pouches used. Over-cap turns the ring amber.
function segmentPath(i, total) {
  const gapDeg = total > 1 ? 8 : 0.01;
  const segDeg = 360 / total - gapDeg;
  const start = -90 + (360 / total) * i + gapDeg / 2;
  const end = start + segDeg;
  const rad = (d) => (d * Math.PI) / 180;
  const x1 = CX + R * Math.cos(rad(start));
  const y1 = CX + R * Math.sin(rad(start));
  const x2 = CX + R * Math.cos(rad(end));
  const y2 = CX + R * Math.sin(rad(end));
  return `M ${x1} ${y1} A ${R} ${R} 0 ${segDeg > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

export default function LogRing({ used, cap, mg, onLog, disabled }) {
  const over = used > cap;
  const [pulse, setPulse] = useState(0);
  const segments = Math.max(cap, 1);

  const handleLog = () => {
    if (disabled) return;
    navigator.vibrate?.(30);
    setPulse((p) => p + 1);
    onLog();
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE }}>
        <motion.svg
          key={pulse}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          initial={pulse ? { scale: 1.035 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 220 }}
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden="true"
        >
          {Array.from({ length: segments }, (_, i) => (
            <path
              key={`bg-${i}`}
              d={segmentPath(i, segments)}
              stroke="rgba(255,255,255,0.09)"
              strokeWidth={10}
              strokeLinecap="round"
              fill="none"
            />
          ))}
          {Array.from({ length: Math.min(used, segments) }, (_, i) => (
            <motion.path
              key={`fill-${i}`}
              d={segmentPath(i, segments)}
              stroke={over ? 'var(--amber)' : 'var(--accent-bright)'}
              strokeWidth={10}
              strokeLinecap="round"
              fill="none"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ type: 'spring', damping: 22, stiffness: 120 }}
              style={{
                filter: `drop-shadow(0 0 8px ${over ? 'var(--amber-glow)' : 'var(--accent-glow)'})`,
              }}
            />
          ))}
        </motion.svg>

        <motion.button
          onClick={handleLog}
          whileTap={disabled ? {} : { scale: 0.94 }}
          transition={{ type: 'spring', damping: 18, stiffness: 320 }}
          aria-label={`Log a pouch. ${used} of ${cap} used today.`}
          style={{
            position: 'absolute',
            inset: 26,
            borderRadius: '50%',
            background: over
              ? 'radial-gradient(circle at 50% 30%, rgba(251,191,36,0.16), rgba(10,10,12,0.9))'
              : 'radial-gradient(circle at 50% 30%, rgba(94,106,210,0.22), rgba(10,10,12,0.9))',
            border: '1px solid var(--border-strong)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            boxShadow: over
              ? '0 0 40px var(--amber-glow), inset 0 1px 0 rgba(255,255,255,0.08)'
              : '0 0 40px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.08)',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }} className="num">
            <AnimatedNumber value={used} />
            <span style={{ color: 'var(--fg-faint)', fontWeight: 600, fontSize: 26 }}>/{cap}</span>
          </span>
          <span className="tiny" style={{ color: over ? 'var(--amber)' : 'var(--fg-muted)' }}>
            {disabled ? 'quit day — zero' : over ? `${used - cap} over cap` : 'tap to log pouch'}
          </span>
          {mg > 0 && (
            <span className="small faint num">{mg}mg each</span>
          )}
        </motion.button>

        <AnimatePresence>
          {over && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="small"
              style={{
                position: 'absolute',
                bottom: -6,
                left: 0,
                right: 0,
                textAlign: 'center',
                color: 'var(--amber)',
              }}
            >
              Logged honestly — tomorrow's target doesn't change.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
