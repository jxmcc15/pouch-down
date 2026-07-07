import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { smallWin } from '../confetti.js';

export const TRIGGERS = ['after-meal', 'coffee', 'driving', 'stress', 'boredom', 'social'];

const SOS_SECONDS = 600; // the 10-minute rule

// Full-screen craving intervention. Phases: pick trigger → breathe out the
// 10 minutes → decide honestly. Closing early logs nothing.
export default function SOSOverlay({ onClose, onResisted, onUsed }) {
  const [phase, setPhase] = useState('trigger'); // trigger | breathe | decide
  const [trigger, setTrigger] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(SOS_SECONDS);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (phase !== 'breathe') return;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          setPhase('decide');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <motion.div
      className="sos-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-label="Craving SOS"
    >
      <button
        onClick={onClose}
        aria-label="Close without logging"
        style={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 16px)',
          right: 20,
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--fg-muted)',
        }}
      >
        <X size={20} />
      </button>

      <AnimatePresence mode="wait">
        {phase === 'trigger' && (
          <motion.div
            key="trigger"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', damping: 24, stiffness: 200 }}
            style={{ maxWidth: 340 }}
          >
            <h2 style={{ fontSize: 26 }}>Craving. Okay.</h2>
            <p className="muted" style={{ margin: '10px 0 24px' }}>
              What kicked it off? Then we ride out ten minutes together — most
              cravings die in three.
            </p>
            <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
              {TRIGGERS.map((t) => (
                <motion.button
                  key={t}
                  className={`chip ${trigger === t ? 'selected' : ''}`}
                  onClick={() => setTrigger(t)}
                  whileTap={{ scale: 0.94 }}
                >
                  {t}
                </motion.button>
              ))}
            </div>
            <motion.button
              className="btn btn-accent"
              style={{ marginTop: 28, width: '100%' }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setPhase('breathe')}
            >
              Start the 10 minutes
            </motion.button>
          </motion.div>
        )}

        {phase === 'breathe' && (
          <motion.div
            key="breathe"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
          >
            <div style={{ position: 'relative', width: 220, height: 220, margin: '0 0 18px' }}>
              <motion.div
                animate={
                  reduced
                    ? {}
                    : { scale: [1, 1.28, 1.28, 1], opacity: [0.7, 1, 1, 0.7] }
                }
                transition={{ duration: 11, times: [0, 0.36, 0.55, 1], repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute',
                  inset: 30,
                  borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(94,106,210,0.35), rgba(94,106,210,0.06))',
                  border: '1px solid rgba(124,136,232,0.5)',
                  boxShadow: '0 0 60px var(--accent-glow)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <span className="num" style={{ fontSize: 40, fontWeight: 800 }}>
                  {mm}:{ss}
                </span>
                {!reduced && (
                  <motion.span
                    className="tiny muted"
                    animate={{ opacity: [1, 1, 1, 1] }}
                  >
                    breathe with the circle
                  </motion.span>
                )}
              </div>
            </div>
            <p className="small muted" style={{ maxWidth: 300, margin: 0 }}>
              In for 4 as it grows · hold · out for 6 as it shrinks. The urge is
              a wave — it peaks, then it passes.
            </p>
            <motion.button
              className="btn btn-green"
              style={{ marginTop: 22, width: 280 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                smallWin();
                onResisted(trigger);
              }}
            >
              I rode it out — log the win
            </motion.button>
            <button
              className="btn btn-ghost small"
              style={{ width: 280 }}
              onClick={() => setPhase('decide')}
            >
              Skip to decision
            </button>
          </motion.div>
        )}

        {phase === 'decide' && (
          <motion.div
            key="decide"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            style={{ maxWidth: 340, width: '100%' }}
          >
            <h2 style={{ fontSize: 24 }}>
              {secondsLeft === 0 ? 'Ten minutes. You made it.' : 'Your call.'}
            </h2>
            <p className="muted" style={{ margin: '10px 0 24px' }}>
              Either answer is honest data. The streak only lies if you do.
            </p>
            <motion.button
              className="btn btn-green"
              style={{ width: '100%' }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                smallWin();
                onResisted(trigger);
              }}
            >
              I rode it out — log the win
            </motion.button>
            <motion.button
              className="btn btn-ghost"
              style={{ width: '100%', marginTop: 12 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => onUsed(trigger)}
            >
              I used one — log it honestly
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
