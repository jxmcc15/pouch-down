// The unlock moment. Everything else in the awards system is derived and
// disposable — this is the one screen that writes to the record, because
// "which celebrations already played" is the only award fact ever stored.
//
// Two rules make that safe, and they are the whole reason this file is shaped
// the way it is:
//
//   1. THE BATCH IS A SNAPSHOT. `newlyEarned(state)` is a live derivation, and
//      marking an award celebrated changes `state`, which changes what
//      `newlyEarned` returns. Deriving the on-screen queue from it on every
//      render is re-entrant by construction — it can skip an award, steal one,
//      or refill itself forever. So a batch is captured ONCE into `batchRef`,
//      and while a batch is on screen nothing re-derives underneath it.
//   2. MARKING HAPPENS ONLY ON DISMISSAL, and every dismissal marks. The Nice
//      button, a tap on the backdrop, and Escape all run the same idempotent
//      path. An award that is shown and not marked replays on the next open,
//      forever; an award marked without being shown is gone, forever. The only
//      exception is the overflow described under MAX_PER_OPEN, which is marked
//      deliberately and never shown.
//
// `handledRef` backs rule 2 up in memory: `api.markAwardCelebrated` silently
// no-ops when storage is unreadable, so without it a failed write would replay
// the same celebration on every re-render for the rest of the session.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '../../state.jsx';
import { newlyEarned } from '../../awards.js';
import { todayKey } from '../../store.js';
import { tierBurst } from '../../confetti.js';
import { plainMotion } from '../../motion.js';
import Badge from './Badge.jsx';
import { TIER_COLOR, TIER_GLOW, TIER_LABEL, TIER_RANK } from './tiers.js';

// On the first open after awards ship, a long-running attempt can have a dozen
// badges already earned. Twelve overlays in a row is a chore, not a reward.
const MAX_PER_OPEN = 3;

// The badge spring has visually landed by here — the shimmer sweep and the
// confetti both hang off this beat.
const LAND_MS = 420;

// Which three, when more than three are waiting: rarest first. A backlog only
// happens once, and the badge it would hurt most to swallow in silence is the
// rarest one — so rarity decides who gets a moment, and a tie goes to whoever
// was earned first.
const byRarity = (a, b) =>
  TIER_RANK[b.tier] - TIER_RANK[a.tier] || String(a.earnedOn).localeCompare(String(b.earnedOn));

// ...and the chosen three then play in the opposite order, so a batch builds
// toward its rarest badge instead of opening on it and trailing off.
const byBuild = (a, b) =>
  TIER_RANK[a.tier] - TIER_RANK[b.tier] || String(a.earnedOn).localeCompare(String(b.earnedOn));

const fmtDay = (day) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function AwardUnlock() {
  const { state, readOnly, problem, api } = useApp();
  const uid = useId();
  // Read once: `?static` can't change, and a mid-session reduced-motion flip
  // shouldn't retime a celebration that is already playing.
  const plain = useMemo(() => plainMotion(), []);

  const [batch, setBatch] = useState([]); // the snapshot, minus what's been dismissed
  const [batchSize, setBatchSize] = useState(0); // how big it was when captured
  const [lit, setLit] = useState(false); // the badge has landed: shimmer + confetti

  const batchRef = useRef([]); // mirrors `batch`, but true *now* rather than next render
  const handledRef = useRef(new Set()); // ids this session has marked (or tried to)
  const attemptRef = useRef(undefined); // which attempt the two refs above belong to
  const restoreRef = useRef(null); // what had focus before the overlay took it
  const niceRef = useRef(null);

  const current = batch[0] ?? null;
  const open = !!current;

  // The three guards, in one place. `readOnly` is the load-bearing one: it is
  // true while viewing an archived attempt, `newlyEarned` doesn't check it, and
  // `markAwardCelebrated` writes to the *active* attempt — so a celebration
  // shown over a past attempt could never record itself and would replay on
  // every open, forever. `!readOnly` also guarantees `state` IS the active
  // attempt, which is what makes reading `state` and writing through `api`
  // agree with each other.
  const live = !!state && !readOnly && !problem;

  // Re-derived every render, but only changes at the 4am cutoff: an app left
  // open overnight settles yesterday, which can earn a streak badge with no
  // event to trigger a re-read.
  const day = live ? todayKey() : null;

  const show = useCallback((next) => {
    batchRef.current = next;
    setBatch(next);
  }, []);

  const restoreFocus = useCallback(() => {
    const el = restoreRef.current;
    restoreRef.current = null;
    if (el && el !== document.body && el.isConnected && typeof el.focus === 'function') el.focus();
  }, []);

  // The one write path. Idempotent: a second Escape, or a backdrop tap landing
  // on the same frame as the button, finds the batch already advanced and does
  // nothing. Never called from mount, setup, or cleanup — only from a real
  // dismissal.
  const dismiss = useCallback(() => {
    const [cur, ...rest] = batchRef.current;
    if (!cur) return;
    handledRef.current.add(cur.id);
    api.markAwardCelebrated(cur.id);
    show(rest);
    if (!rest.length) restoreFocus();
  }, [api, show, restoreFocus]);

  // Intake. Runs when the attempt object changes (a log, a mark, a settings
  // edit) or the day rolls over — never on a bare re-render, and never while a
  // batch is on screen.
  useEffect(() => {
    const attemptId = live ? state.id : null;
    if (attemptRef.current !== attemptId) {
      // A different attempt — or the loss of the right to write to this one —
      // invalidates both the snapshot and everything remembered about it.
      attemptRef.current = attemptId;
      handledRef.current = new Set();
      if (batchRef.current.length) {
        show([]);
        setBatchSize(0);
        restoreFocus();
      }
    }
    if (!live) return;
    // Rule 1: a batch on screen is never re-derived. An award earned while
    // these are playing is picked up by the next intake, not folded into this
    // one — which is also what stops it being classed as overflow and marked
    // without ever being seen.
    if (batchRef.current.length) return;

    const pending = newlyEarned(state).filter((a) => !handledRef.current.has(a.id));
    if (!pending.length) return;

    const ranked = [...pending].sort(byRarity);
    const chosen = ranked.slice(0, MAX_PER_OPEN).sort(byBuild);
    // The one place an award is marked without being celebrated. These ids are
    // snapshotted here and now, from this batch, not recomputed later. They
    // still appear in the trophy case — they just don't each get an overlay.
    for (const a of ranked.slice(MAX_PER_OPEN)) {
      handledRef.current.add(a.id);
      api.markAwardCelebrated(a.id);
    }
    // Captured before the overlay renders, while focus is still wherever the
    // user left it.
    restoreRef.current = document.activeElement;
    setBatchSize(chosen.length);
    show(chosen);
  }, [live, state, day, api, show, restoreFocus]);

  // The beat where the badge lands: one shimmer sweep, one tier-scaled burst,
  // then stillness. Plain motion gets neither.
  useEffect(() => {
    setLit(false);
    if (!current || plain) return;
    const t = setTimeout(() => {
      setLit(true);
      tierBurst(current.tier);
    }, LAND_MS);
    return () => clearTimeout(t);
  }, [current?.id, current?.tier, plain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape dismisses (and marks). Tab has nowhere to go: one control, and the
  // app behind is inert for the duration.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        niceRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  // A stable callback ref, so it fires when a card mounts rather than on every
  // render — each award in the batch gets focus handed to its own button.
  const takeFocus = useCallback((node) => {
    niceRef.current = node;
    node?.focus();
  }, []);

  const tier = current?.tier ?? 'bronze';
  const glow = TIER_GLOW[tier] ?? TIER_GLOW.bronze;
  const accent = TIER_COLOR[tier] ?? TIER_COLOR.bronze;
  // Plain motion is a single fade with nothing staggered behind it.
  const beat = (seconds) => (plain ? 0 : seconds);
  const rise = (delay) => ({
    initial: plain ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: plain
      ? { duration: 0.18 }
      : { type: 'spring', stiffness: 300, damping: 28, delay },
  });

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key="award-unlock"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.13 } }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          // Dismissing (and marking) on a backdrop tap is deliberate: an
          // overlay you can tap past without it counting would replay on every
          // open. `e.target === e.currentTarget` keeps the Nice click from
          // bubbling up and taking a second award with it.
          onClick={(e) => {
            if (e.target === e.currentTarget) dismiss();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70, // sheets 50/51, SOS 60, this above all of it
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding:
              'calc(env(safe-area-inset-top) + 24px) calc(env(safe-area-inset-right) + 20px) calc(env(safe-area-inset-bottom) + 24px) calc(env(safe-area-inset-left) + 20px)',
            background: 'rgba(2, 2, 3, 0.72)',
            backdropFilter: 'blur(16px) saturate(120%)',
            WebkitBackdropFilter: 'blur(16px) saturate(120%)',
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={current.id}
              role="dialog"
              aria-modal="true"
              aria-labelledby={`${uid}-title`}
              aria-describedby={`${uid}-body`}
              initial={plain ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={plain ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.13 } }}
              transition={plain ? { duration: 0.18 } : { type: 'spring', stiffness: 280, damping: 26 }}
              style={{
                width: '100%',
                maxWidth: 344,
                textAlign: 'center',
                padding: '30px 22px 22px',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${glow}`,
                background: 'linear-gradient(180deg, rgba(20, 20, 26, 0.92), rgba(8, 8, 11, 0.95))',
                boxShadow: `0 0 64px ${glow}, 0 24px 60px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05)`,
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
              }}
            >
              {/* badge + its halo */}
              <div
                style={{
                  position: 'relative',
                  width: 132,
                  height: 132,
                  margin: '0 auto 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <motion.div
                  aria-hidden="true"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: plain ? 0.18 : 0.5, delay: beat(0.14) }}
                  style={{
                    position: 'absolute',
                    inset: -8,
                    borderRadius: '50%',
                    background: `radial-gradient(circle, ${glow} 0%, transparent 68%)`,
                  }}
                />
                <motion.div
                  initial={plain ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  // 260/14 lands with a little overshoot — the badge arrives
                  // like something set down, not something faded up.
                  transition={
                    plain
                      ? { duration: 0.18 }
                      : { type: 'spring', stiffness: 260, damping: 14, delay: 0.14 }
                  }
                  style={{ position: 'relative', lineHeight: 0 }}
                >
                  {/* Badge owns the sweep; it starts when this turns true, one
                      beat after the spring has landed. */}
                  <Badge award={current} size={116} shimmer={lit} showRing={false} />
                </motion.div>
              </div>

              <motion.p
                className="tiny"
                {...rise(beat(0.4))}
                style={{ margin: 0, color: accent, opacity: 0.9 }}
              >
                {TIER_LABEL[tier] ?? tier} · unlocked
              </motion.p>

              <motion.h2
                id={`${uid}-title`}
                {...rise(beat(0.46))}
                style={{ fontSize: 23, margin: '8px 0 0' }}
              >
                {current.title}
              </motion.h2>

              <motion.p
                id={`${uid}-body`}
                className="muted"
                {...rise(beat(0.54))}
                style={{ margin: '10px 0 0', fontSize: 14.5, lineHeight: 1.5 }}
              >
                {current.body}
              </motion.p>

              {/* Only worth saying when it isn't today — on the first open of a
                  backlog it's the difference between "just now" and "back in
                  September". */}
              {current.earnedOn && current.earnedOn !== day && (
                <motion.p className="tiny faint" {...rise(beat(0.58))} style={{ margin: '10px 0 0' }}>
                  earned {fmtDay(current.earnedOn)}
                </motion.p>
              )}

              <motion.div {...rise(beat(0.62))} style={{ marginTop: 22 }}>
                <motion.button
                  ref={takeFocus}
                  className="btn btn-accent"
                  style={{ width: '100%', minHeight: 48 }}
                  whileTap={plain ? undefined : { scale: 0.97 }}
                  onClick={dismiss}
                >
                  Nice
                </motion.button>
              </motion.div>

              {batchSize > 1 && (
                <motion.p
                  className="tiny faint"
                  {...rise(beat(0.66))}
                  style={{ margin: '12px 0 0' }}
                >
                  {batchSize - batch.length + 1} of {batchSize}
                </motion.p>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
