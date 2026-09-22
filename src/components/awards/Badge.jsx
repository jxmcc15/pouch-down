// The circular seal — one SVG, no image assets, safe to render ~25 at once.
//
// Anatomy, outside in: an earned badge's glow (a radial gradient, never a blur
// filter — 25 feGaussianBlurs would melt a phone), the notched rim carrying the
// tier gradient, a progress groove cut into that rim on a locked badge, the
// recessed inner plate, and the mark. One circle the whole way down: the
// progress ring rides in the rim rather than floating outside it, so a locked
// badge and an earned badge are the same object in two states.
//
// Locked is dimmed, not dead. The rim keeps its tier hue (muted toward pewter),
// the mark stays legible, and the groove shows how far along it is — a locked
// badge is a preview of something reachable. Earned adds saturation and glow.
// The earned/locked difference is luminance and structure, never hue alone, and
// the aria-label says which one it is out loud.
import { useEffect, useId, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Award, CalendarCheck, Clock, Eye, Flag, RotateCcw, ShieldCheck, TrendingDown } from 'lucide-react';
import { TIER_STOPS, TIER_COLOR, TIER_GLOW } from './tiers.js';
import { plainMotion } from '../../motion.js';

// ---- geometry (viewBox units; everything scales from one 0 0 100 100 box) ----
const R_EDGE = 43; // outer silhouette
const R_PLATE = 34.6; // recessed face the mark sits on
const R_RING = 40.4; // progress groove, cut into the rim
const W_RING = 3.4;
const C_RING = 2 * Math.PI * R_RING;
const NOTCH_IN = 36.1;
const NOTCH_OUT = 41.4;

// ---- colour helpers ----
const HEX = /^#([0-9a-f]{6})$/i;
function mix(hex, toward, t) {
  const a = HEX.exec(hex);
  const b = HEX.exec(toward);
  if (!a || !b) return hex;
  const av = parseInt(a[1], 16);
  const bv = parseInt(b[1], 16);
  const ch = (shift) => Math.round((((av >> shift) & 255) * (1 - t)) + (((bv >> shift) & 255) * t));
  return `#${(((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0).toString(16).slice(1)}`;
}
const muted = (hex) => mix(hex, '#565a63', 0.52); // unlit metal: hue survives, shine doesn't
const lifted = (hex) => mix(hex, '#ffffff', 0.32); // the mark catches more light than the rim

// ---- the reeded rim ----
// Radial grooves, computed once at module load and shared by every instance: a
// dark line with a lighter line just off it reads as a chiselled notch, and the
// notches are what make a flat gradient look like metal. Fewer of them on small
// badges so the reeding stays grooves instead of turning into moiré.
function notchPath(n, shift) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const angle = (((i + shift) / n) * Math.PI * 2) - (Math.PI / 2);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    d += `M${(50 + NOTCH_IN * c).toFixed(2)} ${(50 + NOTCH_IN * s).toFixed(2)}`;
    d += `L${(50 + NOTCH_OUT * c).toFixed(2)} ${(50 + NOTCH_OUT * s).toFixed(2)}`;
  }
  return d;
}
const NOTCHES = {
  small: { dark: notchPath(18, 0), light: notchPath(18, 0.34) },
  large: { dark: notchPath(28, 0), light: notchPath(28, 0.34) },
};

// ---- the mark ----
// A numeral wherever the award has one: "7", "$25", "10" survive 44px, where a
// line icon turns to mush. Everything else gets a lucide glyph, reusing the
// app's existing vocabulary where it has one (ShieldCheck is already "resisted"
// in TodayLog, CalendarCheck is already "days logged" in the read-only banner).
const ICON_FOR = {
  'showed-up': Flag, // you planted something
  'full-week': CalendarCheck,
  'honest-yellow': Eye, // you looked straight at a day that went over
  'came-back': RotateCcw,
  'rode-it-out': ShieldCheck,
  'on-the-clock': Clock,
  'first-cut': TrendingDown, // the step down, not a pair of scissors
};
const NUMBERED = [
  [/^streak-(\d+)$/, (m) => m[1]],
  [/^stage-(\d+)$/, (m) => m[1]],
  [/^kept-(\d+)$/, (m) => `$${m[1]}`],
  [/^rode-it-out-(\d+)$/, (m) => m[1]],
  [/-(\d+)$/, (m) => m[1]], // unknown but numbered — show the number rather than nothing
];

// Never blank, never a crash: an id nobody planned for lands on a generic medal.
function markFor(id) {
  if (typeof id !== 'string') return { Icon: Award };
  if (ICON_FOR[id]) return { Icon: ICON_FOR[id] };
  if (id === 'day-zero') return { text: '0' };
  for (const [re, pick] of NUMBERED) {
    const m = re.exec(id);
    if (m) return { text: pick(m) };
  }
  return { Icon: Award };
}

const FONT_SIZE = [36, 36, 30, 26, 21]; // by glyph count: "7" … "$100"

/**
 * The circular seal.
 *
 * @param {object}  award    an entry from awardsFor(): { id, tier, title, body, earned, earnedOn, progress }
 * @param {number}  size     px; the full square the svg occupies, progress ring included
 * @param {boolean} shimmer  play one shimmer sweep across the face, then stop
 * @param {boolean} showRing draw the progress ring on a locked badge
 */
export default function Badge({ award, size = 72, shimmer = false, showRing = true }) {
  // Gradient ids must be unique — ~25 of these share a document and colliding
  // ids silently cross-wire the paint. Strip React's punctuation so the id is
  // safe inside url(#…) on every browser.
  const uid = `b${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const plain = useMemo(() => plainMotion(), []);

  // One sweep, ever: the effect can only re-arm if `shimmer` itself flips, and
  // the sweep clears its own flag when it lands.
  const [sweeping, setSweeping] = useState(false);
  useEffect(() => {
    if (shimmer && !plain) setSweeping(true);
  }, [shimmer, plain]);

  const a = award ?? {};
  const tier = TIER_STOPS[a.tier] ? a.tier : 'bronze';
  const earned = !!a.earned;
  const progress = Math.max(0, Math.min(1, Number(a.progress) || 0));
  const title = a.title || 'Award';

  const base = TIER_STOPS[tier];
  const stops = earned ? base : base.map(muted);
  const accent = TIER_COLOR[tier] ?? '#8a8f98';
  const glow = TIER_GLOW[tier] ?? 'rgba(255,255,255,0.22)';
  const notches = size < 56 ? NOTCHES.small : NOTCHES.large;
  const drift = earned && tier === 'aurora' && !plain;

  const { text, Icon } = markFor(a.id);
  const markPaint = earned ? `url(#${uid}-mark)` : 'rgba(255,255,255,0.60)';
  const pct = Math.round(progress * 100);
  const label = earned
    ? `${title} — earned`
    : showRing && pct > 0
      ? `${title} — locked, ${pct}% of the way there`
      : `${title} — locked`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label}
      style={{ display: 'block', flex: '0 0 auto' }}
    >
      <defs>
        {/* Lit from the top-left. Aurora's three stops are the app's own accent
            colours, so an aurora seal is a coin cut from the background.
            The vector runs corner to corner of the disc itself (50 ± 43/√2): run
            it any longer and the final stop lands outside the circle, which
            quietly costs aurora its amber. */}
        <linearGradient id={`${uid}-rim`} gradientUnits="userSpaceOnUse" x1="20" y1="18" x2="80" y2="82">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset={tier === 'aurora' ? '0.5' : '0.46'} stopColor={stops[1]} />
          <stop offset="1" stopColor={stops[2]} />
        </linearGradient>

        {/* The specular roll across the metal: highlight, body shadow, edge glint. */}
        <linearGradient id={`${uid}-sheen`} gradientUnits="userSpaceOnUse" x1="22" y1="6" x2="78" y2="94">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="0.2" stopColor="#ffffff" stopOpacity="0.07" />
          <stop offset="0.46" stopColor="#000000" stopOpacity="0.1" />
          <stop offset="0.66" stopColor="#000000" stopOpacity="0.24" />
          <stop offset="0.88" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.02" />
        </linearGradient>

        <radialGradient id={`${uid}-plate`} gradientUnits="userSpaceOnUse" cx="50" cy="34" r="46">
          <stop offset="0" stopColor="#1b1b23" />
          <stop offset="1" stopColor="#08080b" />
        </radialGradient>

        <linearGradient id={`${uid}-mark`} gradientUnits="userSpaceOnUse" x1="50" y1="30" x2="50" y2="70">
          <stop offset="0" stopColor={lifted(base[0])} />
          <stop offset="1" stopColor={base[1]} />
        </linearGradient>

        {earned && (
          <radialGradient id={`${uid}-glow`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="50">
            <stop offset="0.8" stopColor={glow} stopOpacity="0" />
            <stop offset="0.895" stopColor={glow} stopOpacity="1" />
            <stop offset="1" stopColor={glow} stopOpacity="0" />
          </radialGradient>
        )}

        {sweeping && (
          <>
            <clipPath id={`${uid}-clip`}>
              <circle cx="50" cy="50" r={R_EDGE} />
            </clipPath>
            <linearGradient id={`${uid}-shim`} gradientUnits="userSpaceOnUse" x1="36" y1="0" x2="64" y2="0">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="0.42" stopColor="#ffffff" stopOpacity="0.28" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.46" />
              <stop offset="0.58" stopColor="#ffffff" stopOpacity="0.28" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </>
        )}
      </defs>

      {earned && <circle cx="50" cy="50" r="50" fill={`url(#${uid}-glow)`} />}

      <g opacity={earned ? 1 : 0.92}>
        {/* Aurora, earned, motion allowed: the gradient drifts. The disc is a
            circle, so rotating it moves only the colour — an 8s easeInOut
            wander, the same motion language as the Aurora blobs behind the app,
            never a fast loop begging to be looked at. */}
        <motion.g
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={drift ? { rotate: [0, 20, 0, -20, 0] } : undefined}
          transition={drift ? { duration: 8, repeat: Infinity, ease: 'easeInOut' } : undefined}
        >
          <circle cx="50" cy="50" r={R_EDGE} fill={`url(#${uid}-rim)`} />
        </motion.g>

        {/* Aurora is light, not metal — the specular shadow that gives bronze,
            silver and gold their roll would swallow its amber stop, so it gets
            a lighter pass of the same sheen. */}
        <circle
          cx="50"
          cy="50"
          r={R_EDGE}
          fill={`url(#${uid}-sheen)`}
          opacity={earned ? (tier === 'aurora' ? 0.6 : 1) : 0.62}
        />

        <path d={notches.dark} fill="none" stroke="#000000" strokeOpacity="0.28" strokeWidth="1" />
        <path d={notches.light} fill="none" stroke="#ffffff" strokeOpacity="0.14" strokeWidth="0.6" />

        {/* Edge and seam: a dark line inside the silhouette, and a shadow where
            the plate seats into the rim. Both hide the ends of the notches. */}
        <circle cx="50" cy="50" r="42.55" fill="none" stroke="#000000" strokeOpacity="0.35" strokeWidth="0.9" />
        <circle cx="50" cy="50" r={R_PLATE} fill={`url(#${uid}-plate)`} />
        <circle cx="50" cy="50" r={R_PLATE} fill="none" stroke="#000000" strokeOpacity="0.5" strokeWidth="1.8" />
        <circle cx="50" cy="50" r="31.8" fill="none" stroke="#ffffff" strokeOpacity="0.07" strokeWidth="0.7" />

        {text ? (
          <text
            x="50"
            y="50"
            dy="0.36em"
            textAnchor="middle"
            fontSize={FONT_SIZE[Math.min(text.length, 4)]}
            fontWeight="800"
            fill={markPaint}
            style={{
              fontFamily: "var(--font, 'Inter', system-ui, sans-serif)",
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.03em',
            }}
          >
            {text}
          </text>
        ) : (
          <Icon x="31" y="31" size={38} strokeWidth={2} color={earned ? lifted(base[0]) : 'rgba(255,255,255,0.60)'} />
        )}

        {/* The groove. Locked only: on an earned badge the rim is unbroken. */}
        {!earned && showRing && (
          <g transform="rotate(-90 50 50)">
            <circle cx="50" cy="50" r={R_RING} fill="none" stroke="#000000" strokeOpacity="0.46" strokeWidth={W_RING + 1.2} />
            <circle cx="50" cy="50" r={R_RING} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={W_RING} />
            {/* Guarded: a round-capped zero-length arc renders as a stray dot. */}
            {progress > 0 && (
              <circle
                cx="50"
                cy="50"
                r={R_RING}
                fill="none"
                stroke={accent}
                strokeWidth={W_RING}
                strokeLinecap="round"
                strokeDasharray={`${(C_RING * progress).toFixed(2)} ${C_RING.toFixed(2)}`}
              />
            )}
          </g>
        )}

        {sweeping && (
          <g clipPath={`url(#${uid}-clip)`}>
            <motion.g
              initial={{ x: -80 }}
              animate={{ x: 80 }}
              transition={{ duration: 0.9, ease: 'easeOut' }}
              onAnimationComplete={() => setSweeping(false)}
            >
              <rect x="36" y="-28" width="28" height="156" transform="rotate(-20 50 50)" fill={`url(#${uid}-shim)`} />
            </motion.g>
          </g>
        )}
      </g>
    </svg>
  );
}
