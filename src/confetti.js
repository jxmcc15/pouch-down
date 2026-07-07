import confetti from 'canvas-confetti';

const reduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function celebrate() {
  if (reduced()) return;
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
  if (reduced()) return;
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
