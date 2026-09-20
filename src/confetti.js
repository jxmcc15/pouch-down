import confetti from 'canvas-confetti';
import { plainMotion } from './motion.js';
import { TIER_STOPS } from './components/awards/tiers.js';

// Every burst in this file asks `plainMotion()` first. That used to be a local
// `prefers-reduced-motion` check, which meant `?static` still got confetti and
// the headless screenshots came back with paper all over them.

export function celebrate() {
  if (plainMotion()) return;
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 38,
    origin: { y: 0.7 },
    colors: ['#5e6ad2', '#7c88e8', '#34d399', '#ededef'],
    disableForReducedMotion: true,
  });
}

export function smallWin() {
  if (plainMotion()) return;
  confetti({
    particleCount: 28,
    spread: 55,
    startVelocity: 26,
    scalar: 0.8,
    origin: { y: 0.75 },
    colors: ['#34d399', '#7c88e8'],
    disableForReducedMotion: true,
  });
}

// Rarity you can feel without reading the tier name: bronze is a small puff,
// aurora fills the screen and comes back for a second wave. Colours come from
// the seal itself (tiers.js) so the paper matches the badge that just landed,
// warmed with a little of the app palette. Aurora is left alone — its three
// stops already are the app palette.
const BURSTS = {
  bronze: { particleCount: 30, spread: 46, startVelocity: 30, scalar: 0.85, ticks: 160, colors: [...TIER_STOPS.bronze, '#ededef'] },
  silver: { particleCount: 55, spread: 62, startVelocity: 34, scalar: 0.9, ticks: 180, colors: [...TIER_STOPS.silver, '#7c88e8'] },
  gold: { particleCount: 90, spread: 82, startVelocity: 40, scalar: 1, ticks: 200, colors: [...TIER_STOPS.gold, '#5e6ad2', '#ededef'] },
  aurora: { particleCount: 160, spread: 115, startVelocity: 48, scalar: 1.05, ticks: 260, colors: [...TIER_STOPS.aurora] },
};

// Fired from behind the unlock overlay's badge, which sits above centre.
const ORIGIN = { x: 0.5, y: 0.46 };

export function tierBurst(tier) {
  if (plainMotion()) return;
  const spec = BURSTS[tier] ?? BURSTS.bronze;
  confetti({ ...spec, origin: ORIGIN, disableForReducedMotion: true });
  if (tier !== 'aurora') return;
  // The rarest tier only exists twice in the whole catalog. Two wings arrive
  // from the sides once the first wave has started to fall, so the moment
  // keeps going a beat longer than any other unlock does.
  setTimeout(() => {
    for (const [x, angle] of [[0.1, 58], [0.9, 122]]) {
      confetti({
        ...spec,
        particleCount: 60,
        spread: 70,
        angle,
        origin: { x, y: 0.62 },
        disableForReducedMotion: true,
      });
    }
  }, 260);
}
