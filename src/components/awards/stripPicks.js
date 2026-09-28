// Which seals the Stats strip shows. Its own module so the choice is pure,
// testable without React, and TrophyCase.jsx exports only components.
import { TIER_RANK } from './tiers.js';

// Earned: newest first, and on the same day the bigger tier first — that's the
// news. An award kept with no date (see fmtShort in TrophyCase.jsx) sorts
// after every dated one.
function byNewest(x, y) {
  const d = String(y.earnedOn ?? '').localeCompare(String(x.earnedOn ?? ''));
  return d || (TIER_RANK[y.tier] ?? -1) - (TIER_RANK[x.tier] ?? -1);
}

// Locked: closest first, and at equal distance the lower tier first — it's the
// one actually within reach. Junk progress reads as none rather than NaN, which
// would make the sort order depend on where the junk happened to sit.
const reach = (a) => Number(a.progress) || 0;
function byClosest(x, y) {
  return reach(y) - reach(x) || (TIER_RANK[x.tier] ?? 99) - (TIER_RANK[y.tier] ?? 99);
}

// The handful of seals worth a glance on Stats: what you've earned, then the
// locked ones you're closest to. Pure, so the choice is testable; the sheet
// shows everything. Anything still tied keeps awardsFor's catalog order (the
// sort is stable), so the same state always draws the same strip.
export function stripPicks(awards, max = 6) {
  const earned = awards.filter((a) => a.earned).sort(byNewest);
  const locked = awards.filter((a) => !a.earned).sort(byClosest);
  const all = [...earned, ...locked];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
