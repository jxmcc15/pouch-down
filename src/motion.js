// One question, asked the same way everywhere: should this moment be plain?
//
// Two very different reasons land on the same answer. `prefers-reduced-motion`
// is the user telling the system that motion costs them something, and `?static`
// is the headless verifier freezing every animation at its final frame so a
// screenshot is deterministic. Neither wants confetti.
//
// Framer already handles both for declarative animation (`MotionConfig
// reducedMotion="user"` in App.jsx, `MotionGlobalConfig.skipAnimations` in
// main.jsx). This is for the imperative flourishes Framer never sees —
// canvas-confetti, shimmer sweeps, timed celebration beats — which would
// otherwise fire straight through a reduced-motion preference.
export function plainMotion() {
  if (typeof window === 'undefined') return true; // SSR/tests: never flourish
  try {
    if (new URLSearchParams(window.location.search).has('static')) return true;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true; // a browser that can't answer gets the calm version
  }
}
