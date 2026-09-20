import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { streaks } from '../../store.js';
import { plainMotion } from '../../motion.js';
import AnimatedNumber from '../AnimatedNumber.jsx';

const spring = { type: 'spring', damping: 24, stiffness: 180 };
// Livelier than the house spring on purpose: this one only ever fires as a
// one-shot flourish on the flame, never on anything that has to settle calmly.
const pop = { type: 'spring', damping: 10, stiffness: 320 };

// The personal best is only worth saying when it's a real record you're under.
// "best 1" or "best 2" is noise, and "best 4" while you're on day 4 is a lie of
// emphasis — you're standing on it right now.
const BEST_WORTH_SAYING = 3;

// The streak is derived from every event in the attempt, so a malformed attempt
// could throw here. That must never be able to take the Today header down with
// it: a chip that hides is a small loss, a blank screen is the whole app.
function readStreak(state) {
  if (!state || !state.plan) return null;
  try {
    const { current, best } = streaks(state);
    return {
      current: Number.isFinite(current) ? current : 0,
      best: Number.isFinite(best) ? best : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Today header: flame + current streak, and the door to the trophy case.
 *
 * Tone rules this thing exists to hold:
 * - Zero is an invitation ("Start a streak today"), never a "0" and never a
 *   flame-out. A broken streak gets no animation, no colour change, no comment.
 *   The app already knows the day was hard; it doesn't need to say so.
 * - The only flourish is upward — a small pop when the number climbs.
 *
 * Reads its own data; the only prop is the callback that opens the sheet.
 */
export default function StreakChip({ onOpenTrophies }) {
  const app = useApp();
  const data = readStreak(app?.state);
  const current = data?.current ?? 0;
  const best = data?.best ?? 0;

  // Hooks stay above the early return so their order can never depend on
  // whether an attempt happens to be loaded this render.
  const [pulse, setPulse] = useState(0);
  const previous = useRef(current);

  useEffect(() => {
    const before = previous.current;
    previous.current = current;
    // Only ever on the way up, never on the way down — and never at all when
    // the user (or the headless verifier) has asked for stillness.
    if (current > before && !plainMotion()) setPulse((p) => p + 1);
  }, [current]);

  if (!data) return null;

  const live = current > 0;
  // Honest extra, dropped whenever it would crowd the row: only while a live
  // streak is genuinely under a record worth naming.
  const showBest = live && best >= BEST_WORTH_SAYING && current < best;

  const label = live
    ? `${current} day streak${showBest ? `, personal best ${best}` : ''}. Tap to open your trophy case.`
    : 'No streak going yet. Tap to open your trophy case.';

  // A chip nobody wired a sheet to is still true, it just isn't a control —
  // so it stops claiming to be a button.
  const tappable = typeof onOpenTrophies === 'function';
  const Wrapper = tappable ? motion.button : motion.div;
  const wrapperProps = tappable
    ? {
      type: 'button',
      onClick: () => onOpenTrophies(),
      whileTap: { scale: 0.96 },
      'aria-label': label,
    }
    : { 'aria-label': undefined };

  return (
    <Wrapper
      {...wrapperProps}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.06 }}
      style={{
        // The pill reads at 34px; the button around it is 44 so the thumb gets
        // a real target without a chunky badge under the stage name.
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 44,
        maxWidth: '100%',
        padding: '5px 0',
        marginTop: 2,
        background: 'none',
        border: 'none',
        textAlign: 'left',
      }}
    >
      <span
        className="chip"
        style={{
          minHeight: 34,
          padding: '0 13px',
          fontSize: 13,
          maxWidth: '100%',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderColor: live ? 'var(--border-strong)' : 'var(--border)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        <span
          style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
        >
          {/* The flourish, one shot per increment: an amber bloom behind the
              flame. It lives outside any clipped box so it can spill past the
              pill's edge, and it only exists at all when motion is welcome. */}
          {pulse > 0 && (
            <motion.span
              key={`glow-${pulse}`}
              aria-hidden="true"
              initial={{ opacity: 0.9, scale: 0.5 }}
              animate={{ opacity: 0, scale: 2.2 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              style={{
                position: 'absolute',
                inset: -6,
                borderRadius: '50%',
                background: 'radial-gradient(circle, var(--amber-glow) 0%, transparent 70%)',
                pointerEvents: 'none',
              }}
            />
          )}
          <motion.span
            key={`flame-${pulse}`}
            initial={pulse ? { scale: 1.45 } : false}
            animate={{ scale: 1 }}
            transition={pop}
            style={{ display: 'inline-flex' }}
          >
            <Flame
              size={15}
              color={live ? 'var(--amber)' : 'var(--fg-faint)'}
              aria-hidden="true"
            />
          </motion.span>
        </span>

        {/* mode="wait" so the two messages never overlap mid-swap. The live
            branch keeps one key for every non-zero streak, which is what lets
            AnimatedNumber stay mounted and actually spring 2 -> 3. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={live ? 'live' : 'zero'}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            style={{
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: 5,
              minWidth: 0,
              overflow: 'hidden',
            }}
          >
            {live ? (
              <>
                <span
                  className="num"
                  style={{ fontSize: 15, fontWeight: 800, color: 'var(--fg)', flexShrink: 0 }}
                >
                  <AnimatedNumber value={current} />
                </span>
                <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>day streak</span>
                {showBest && (
                  // First thing to give way if the column is ever tighter than
                  // we measured — the streak itself never clips.
                  <span
                    className="faint num"
                    style={{
                      fontSize: 12,
                      whiteSpace: 'nowrap',
                      minWidth: 0,
                      overflow: 'hidden',
                    }}
                  >
                    · best {best}
                  </span>
                )}
              </>
            ) : (
              <span style={{ whiteSpace: 'nowrap' }}>Start a streak today</span>
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </Wrapper>
  );
}
