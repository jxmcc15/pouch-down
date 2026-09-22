// The trophy case — every award that can exist, grouped by tier, nothing hidden.
//
// Three faces of the same thing:
//   <TrophyCase />                 the card in Stats
//   <TrophyCaseSheet onClose />    the same case in a bottom sheet
//   <TrophyTile onOpen />          the "7 of 24 trophies" tile for Today
//
// All three read their own data — no props carry state in, so a caller can drop
// any of them anywhere. Nothing here writes: no api calls at all, which is what
// makes it safe while a past, archived attempt is open for reading.
//
// Honesty rules this file obeys:
//   - `progress` is a clamped 0–0.99 fraction. Absolute counts are NOT
//     recoverable from it, so nothing here ever says "18 of 30 days". The ring
//     and, at most, a percentage derived straight from the fraction.
//   - A locked badge shows its title but never its body. Locked copy is a
//     preview of something reachable, not a scolding.
import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, X } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { awardsFor } from '../../awards.js';
import { plainMotion } from '../../motion.js';
import AnimatedNumber from '../AnimatedNumber.jsx';
import Badge from './Badge.jsx';
import { TIER_LABEL, TIER_RANK, TIER_COLOR, TIER_GLOW, TIER_STOPS } from './tiers.js';

const spring = { type: 'spring', damping: 24, stiffness: 180 };

// Snappier than the house spring on purpose: ~25 seals enter at once, and a
// slow one would still be settling long after the eye has moved on. Settles in
// about 0.31s, so with the capped delay below the whole entrance lands inside
// the 600ms budget.
const tileSpring = { type: 'spring', damping: 26, stiffness: 320 };

// 25 items at even 40ms each is a full second of waiting. Only the first ~10
// stagger; everything after joins the last wave. Worst case: 0.25s + 0.31s.
const tileDelay = (i) => Math.min(i, 10) * 0.025;

// Same date voice as the rest of the app (noon avoids the UTC-parse off-by-one).
// An award can be earned with no date — one kept because it was already
// celebrated, after the log that earned it is gone — so no date means no date,
// never "Invalid Date".
const fmtShort = (iso) => {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const colorOf = (tier) => TIER_COLOR[tier] ?? 'var(--fg-muted)';
const labelOf = (tier) => TIER_LABEL[tier] ?? tier;

// The hairline under a section header, tinted with that tier's own gradient
// stops so aurora reads as three colours and the metals read as one. Decorative
// only — the label beside it stays a flat, legible colour, because gradient
// text at 11px uppercase is a contrast problem and an invisible-text risk.
const ruleOf = (tier) => {
  const stops = TIER_STOPS[tier];
  if (!stops) return `linear-gradient(90deg, ${TIER_GLOW[tier] ?? 'var(--border)'}, transparent)`;
  return `linear-gradient(90deg, ${stops[0]}66, ${stops[1]}44, ${stops[2]}22, transparent)`;
};

// Earned first, oldest win first — then locked by how close they are, so the
// next reachable badge sits directly after the last one won.
function byReach(a, b) {
  if (a.earned !== b.earned) return a.earned ? -1 : 1;
  if (a.earned) return String(a.earnedOn).localeCompare(String(b.earnedOn));
  return b.progress - a.progress;
}

// Tier sections in rank order. Built from the tiers actually present rather
// than a fixed list, so an award carrying a tier this file has never heard of
// still gets a section instead of vanishing from the count.
function groupByTier(awards) {
  const tiers = [...new Set(awards.map((a) => a.tier))]
    .sort((x, y) => (TIER_RANK[x] ?? 99) - (TIER_RANK[y] ?? 99));
  return tiers.map((tier) => {
    const items = awards.filter((a) => a.tier === tier).sort(byReach);
    return { tier, items, earned: items.filter((a) => a.earned).length };
  });
}

function useAwards() {
  const { state, readOnly } = useApp();
  // awardsFor walks every plan day, so it runs once per state change, not once
  // per render — this card sits in a tab that re-renders on a 1s clock.
  const awards = useMemo(() => (state ? awardsFor(state) : []), [state]);
  const groups = useMemo(() => groupByTier(awards), [awards]);
  const earned = useMemo(() => awards.filter((a) => a.earned).length, [awards]);
  return { state, readOnly, awards, groups, earned, total: awards.length };
}

function useEscape(onClose, enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, enabled]);
}

/* ---------------------------------------------------------------- one seal */

function TrophyButton({ award, index, onOpen }) {
  const on = award.earned ? fmtShort(award.earnedOn) : null;
  return (
    <motion.button
      type="button"
      onClick={() => onOpen(award)}
      aria-label={
        award.earned
          ? `${award.title} — earned${on ? ` ${on}` : ''}`
          : `${award.title} — locked`
      }
      initial={{ opacity: 0, scale: 0.84, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ ...tileSpring, delay: tileDelay(index) }}
      whileTap={{ scale: 0.92 }}
      style={{
        // The seal is 56px but the tap target is the whole cell — ~70px wide
        // and ~86px tall on a 390px phone, comfortably past 44×44.
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        minWidth: 0,
        minHeight: 44,
        padding: '2px 0 0',
        background: 'none',
      }}
    >
      <Badge award={award} size={56} showRing />
      {/* Fixed two-line box so every row of the grid sits on the same
          baseline no matter how long the titles are. */}
      <span
        style={{
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
          overflow: 'hidden',
          height: 24,
          maxWidth: '100%',
          overflowWrap: 'anywhere',
          fontSize: 10,
          lineHeight: '12px',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          textAlign: 'center',
          color: award.earned ? 'var(--fg)' : 'var(--fg-muted)',
        }}
      >
        {award.title}
      </span>
    </motion.button>
  );
}

/* ------------------------------------------------- the grid, tier by tier */

function TierSection({ group, offset, onOpen }) {
  return (
    <section style={{ marginTop: 16 }}>
      <div className="spread" style={{ marginBottom: 2 }}>
        <span className="tiny" style={{ color: colorOf(group.tier) }}>{labelOf(group.tier)}</span>
        <span className="tiny faint num">{group.earned} of {group.items.length}</span>
      </div>
      <div
        style={{
          height: 1,
          marginBottom: 12,
          background: ruleOf(group.tier),
        }}
      />
      <div
        style={{
          display: 'grid',
          // min(66px, 100%) keeps the track from ever outgrowing its container:
          // four columns at 314px (the real width inside .app-shell + .card on a
          // 390px phone) → 4 × 66 + 3 × 12 = 300. No horizontal scroll.
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(66px, 100%), 1fr))',
          gap: 12,
        }}
      >
        {group.items.map((award, i) => (
          <TrophyButton key={award.id} award={award} index={offset + i} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function CaseBody({ groups, onOpen }) {
  let offset = 0;
  return (
    <>
      {groups.map((group) => {
        const at = offset;
        offset += group.items.length;
        return <TierSection key={group.tier} group={group} offset={at} onOpen={onOpen} />;
      })}
    </>
  );
}

/* --------------------------------------------------------- detail sheet */

// One badge, large. Earned: the body it was hiding, plus the date when there is
// one. Locked: the ring and "Keep going to reveal" — or, on a past attempt
// that can't go anywhere now, a plain "Not earned". No invented counts, ever.
function TrophyDetailSheet({ award, onClose, escapes = true, readOnly = false }) {
  useEscape(onClose, escapes);
  const plain = plainMotion();
  const on = award.earned ? fmtShort(award.earnedOn) : null;
  // Straight off the 0–0.99 fraction. Below 1% there is nothing honest to
  // round to, so the ring speaks for itself.
  const pct = Math.round(award.progress * 100);

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        style={{ zIndex: 52 }} /* above the case sheet, so that dims too */
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        style={{ zIndex: 53, textAlign: 'center' }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        /* No aria-modal: like every other sheet in this app, focus is not
           trapped or moved, and claiming modality would strand a screen
           reader outside an ignored region. */
        aria-label={award.title}
      >
        <div className="sheet-handle" />
        <motion.div
          style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}
          initial={{ scale: 0.86, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spring}
        >
          <Badge award={award} size={120} shimmer={award.earned && !plain} showRing />
        </motion.div>

        <div className="tiny" style={{ color: colorOf(award.tier), marginTop: 14 }}>
          {labelOf(award.tier)}
        </div>
        <h3 style={{ fontSize: 20, marginTop: 4 }}>{award.title}</h3>

        {award.earned ? (
          <>
            <p className="small muted" style={{ margin: '10px auto 0', maxWidth: 300 }}>
              {award.body}
            </p>
            <p className="small faint num" style={{ margin: '12px 0 0' }}>
              {on ? `Earned ${on}` : 'Earned'}
            </p>
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: '10px auto 0', maxWidth: 300 }}>
              {readOnly ? 'Not earned' : 'Keep going to reveal'}
            </p>
            {pct >= 1 && (
              <p className="small faint num" style={{ margin: '12px 0 0' }}>
                {readOnly ? `Got about ${pct}% of the way` : `About ${pct}% of the way`}
              </p>
            )}
          </>
        )}

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>
          Close
        </button>
      </motion.div>
    </>
  );
}

/* ------------------------------------------------------------ the card */

// Day 1 is nearly all locked, and that must not read as a wall of failure —
// hence one warm, non-cheerleading line before the grid.
function introLine(earned, total, readOnly) {
  if (readOnly) return 'What this attempt earned. It stands as it is.';
  if (earned === 0) return 'None yet. The first one lands on your first log — the other ' + (total - 1) + ' are still ahead of you.';
  if (earned === total) return 'Every one of them. Nothing left locked.';
  return 'Earned by showing up and logging honestly. The dim ones are simply the ones you have not reached yet.';
}

export default function TrophyCase() {
  const { state, readOnly, groups, earned, total } = useAwards();
  const [detail, setDetail] = useState(null);
  if (!state) return null;

  return (
    <>
      <motion.div
        className="card"
        style={{ marginTop: 14 }}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
      >
        <div className="spread">
          <span className="tiny muted">Trophy case</span>
          <span className="tiny faint num">{earned} of {total}</span>
        </div>
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          {introLine(earned, total, readOnly)}
        </p>
        <CaseBody groups={groups} onOpen={setDetail} />
      </motion.div>

      <AnimatePresence>
        {detail && (
          <TrophyDetailSheet key={detail.id} award={detail} readOnly={readOnly} onClose={() => setDetail(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

/* ----------------------------------------------------------- the sheet */

export function TrophyCaseSheet({ onClose }) {
  const { state, readOnly, groups, earned, total } = useAwards();
  const [detail, setDetail] = useState(null);
  // One Escape handler for this tree: it peels the detail sheet off first, and
  // only closes the case once nothing is stacked on top of it.
  useEscape(() => (detail ? setDetail(null) : onClose?.()));

  if (!state) return null;

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        aria-label="Trophy case"
      >
        <div className="sheet-handle" />
        <div className="spread">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16 }}>Trophy case</h3>
            <p className="small faint num" style={{ margin: '2px 0 0' }}>{earned} of {total} earned</p>
          </div>
          <motion.button
            type="button"
            aria-label="Close trophy case"
            onClick={onClose}
            whileTap={{ scale: 0.92 }}
            className="row"
            style={{
              minWidth: 44,
              minHeight: 44,
              justifyContent: 'flex-end',
              padding: '0 0 0 12px',
              margin: '-11px -2px -11px 0',
              background: 'none',
              color: 'var(--fg-muted)',
            }}
          >
            <X size={18} />
          </motion.button>
        </div>
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          {introLine(earned, total, readOnly)}
        </p>

        <CaseBody groups={groups} onOpen={setDetail} />

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>
          Done
        </button>
      </motion.div>

      <AnimatePresence>
        {detail && (
          <TrophyDetailSheet
            key={detail.id}
            award={detail}
            readOnly={readOnly}
            onClose={() => setDetail(null)}
            escapes={false} /* the case above owns Escape for this tree */
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------ the tile */

// Sized and shaped like the streak / resisted tiles it sits beside: icon, one
// big number, one tiny label. `flex: 1` + `minWidth: 0` so it survives being
// the third card in that row on a 390px phone.
export function TrophyTile({ onOpen }) {
  const { state, earned, total } = useAwards();
  if (!state) return null;

  return (
    <motion.button
      type="button"
      className="card"
      onClick={onOpen}
      aria-label={`${earned} of ${total} trophies earned. Open the trophy case.`}
      whileTap={{ scale: 0.98 }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring, delay: 0.1 }}
      style={{ flex: 1, minWidth: 0, display: 'block', textAlign: 'center' }}
    >
      <Trophy
        size={18}
        color={earned > 0 ? 'var(--amber)' : 'var(--fg-faint)'}
        style={{ marginBottom: 4 }}
      />
      <div style={{ fontSize: 24, fontWeight: 800 }} className="num">
        <AnimatedNumber value={earned} />
      </div>
      <div className="tiny faint num">of {total} trophies</div>
    </motion.button>
  );
}
