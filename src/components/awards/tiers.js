// The tier vocabulary, kept out of Badge.jsx on purpose: a file that exports a
// component and also exports constants trips `react(only-export-components)`,
// and this repo holds a hard lint baseline of exactly two pre-existing warnings.
//
// bronze → silver → gold → aurora is the rarity ladder. Aurora is reserved for
// the two awards that mean the attempt worked, and its gradient is the app's own
// three accent colours — the same palette as the Aurora blobs behind everything.

export const TIERS = ['bronze', 'silver', 'gold', 'aurora'];
export const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', aurora: 'Aurora' };
export const TIER_RANK = { bronze: 0, silver: 1, gold: 2, aurora: 3 };

// One flat colour per tier, for callers that need a single value — a progress
// ring stroke, a label, a glow — rather than the full gradient.
export const TIER_COLOR = {
  bronze: '#c98a52',
  silver: '#d7dce5',
  gold: '#f6d067',
  aurora: '#7c88e8',
};

// Gradient stops for the seal face. Aurora gets three; the rest are two-stop
// metal, lit from the top-left.
export const TIER_STOPS = {
  bronze: ['#e0a66a', '#c98a52', '#8a5a32'],
  silver: ['#f2f4f8', '#d7dce5', '#8b93a3'],
  gold: ['#ffe9a3', '#f6d067', '#c08a1e'],
  aurora: ['#7c88e8', '#34d399', '#fbbf24'],
};

export const TIER_GLOW = {
  bronze: 'rgba(201, 138, 82, 0.30)',
  silver: 'rgba(215, 220, 229, 0.28)',
  gold: 'rgba(246, 208, 103, 0.32)',
  aurora: 'rgba(124, 136, 232, 0.38)',
};
