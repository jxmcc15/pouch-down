# Pouch Down

A 60-day nicotine pouch taper tracker (July 8 – September 5, 2026). Personal
PWA — installs to an iPhone home screen, works offline, all data stays
on-device in localStorage.

**Live:** https://jxmcc15.github.io/pouch-down/

## Stack

Vite + React + Framer Motion + vite-plugin-pwa. No backend. The optional AI
coach calls the Claude API directly from the browser with a key you enter in
Settings (stored on-device only, never in this repo).

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
```

Append `?static` to the URL to disable all animations (used for headless UI
testing).

## Deploy

Push to `main` — GitHub Actions builds and deploys to Pages automatically.

## Update the plan

The entire taper schedule lives in `src/plan.js` (stages, slots, shopping
deadlines, recovery milestones). The store (`src/store.js`) is event-sourced:
logged events are never rewritten, everything else is derived.
