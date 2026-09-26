import { classifyPouch } from './store.js';

// Verdict text + color for a pouch, always via classifyPouch (which reconstructs
// missing ctx for pre-stamp events). Colors: on-time green, early/over-cap amber,
// baseline muted — over-cap stays plain amber, never alarm-red.
export function pouchVerdict(state, ev) {
  const v = classifyPouch(state, ev);
  if (v.bucket === 'early') return { text: `${Math.abs(v.deltaMin ?? 0)}m early`, color: 'var(--amber)' };
  if (v.bucket === 'over-cap') return { text: 'over cap', color: 'var(--amber)' };
  if (v.bucket === 'baseline') return { text: 'baseline', color: 'var(--fg-muted)' };
  // ≥1 matches TodayLog: a 0-minute delta reads "on time", not "on time +0m"
  return { text: v.deltaMin >= 1 ? `on time +${v.deltaMin}m` : 'on time', color: 'var(--green)' };
}

