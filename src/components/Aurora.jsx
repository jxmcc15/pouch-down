import { motion, useReducedMotion } from 'framer-motion';

// Slow-drifting ambient light blobs behind everything. Transform-only
// animation (GPU) — the screen feels alive without moving content.
const BLOBS = [
  { size: 340, color: 'rgba(94, 106, 210, 0.11)', x: '-15%', y: '-8%', dx: 50, dy: 34, dur: 26 },
  { size: 280, color: 'rgba(124, 76, 210, 0.09)', x: '65%', y: '15%', dx: -42, dy: 48, dur: 32 },
  { size: 300, color: 'rgba(52, 211, 153, 0.05)', x: '25%', y: '68%', dx: 38, dy: -44, dur: 38 },
];

export default function Aurora() {
  const reduced = useReducedMotion();
  return (
    <div className="app-bg" aria-hidden="true">
      {BLOBS.map((b, i) => (
        <motion.div
          key={i}
          className="blob"
          style={{ width: b.size, height: b.size, background: b.color, left: b.x, top: b.y }}
          animate={
            reduced
              ? {}
              : { x: [0, b.dx, 0, -b.dx, 0], y: [0, b.dy, 0, -b.dy, 0] }
          }
          transition={{ duration: b.dur, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}
