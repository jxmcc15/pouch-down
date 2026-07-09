# Pouch Down — Project Context

James's 60-day nicotine pouch cessation tracker. Built 2026-07-07; extended
from 30 to 60 days on 2026-07-08. The taper runs July 8 → September 5, 2026
(quit day). This app is load-bearing for a real
health goal — treat changes with care.

## What it is

Phone-first PWA (iPhone, installed from Safari), deployed to GitHub Pages
(`jxmcc15/pouch-down` → https://jxmcc15.github.io/pouch-down/). Vanilla
Vite + React + Framer Motion, no backend, no TypeScript. All user data is
on-device localStorage (`pouch-down-v1` key), event-sourced.

## Design system

"Modern Dark Cinema": deep gradient background + aurora blobs, frosted-glass
cards, Inter, indigo accent `#5e6ad2`, green `#34d399` / amber `#fbbf24`
status colors. All motion is Framer springs; `MotionConfig reducedMotion="user"`;
`?static` URL param kills animations for headless testing.

## Domain rules (do not break)

- **The plan is data**: `src/plan.js` is the single source of truth — hybrid
  taper (count first, then strength), meal-anchored slots. James's meals
  anchor his usage; meal slots are protected, floaters get cut first.
- **Slip policy is "absorb and continue"**: an over-cap day breaks the streak
  and shows amber, but never changes tomorrow's cap or the quit date. Don't
  add guilt mechanics.
- **Never rewrite logged events** — history is the product. Undo of the
  just-logged event is the only allowed deletion.
- **Days run 4am→4am** (`DAY_CUTOFF_HOURS` in store.js) so late nights count
  against the right day.
- **The AI coach** (`src/coach.js`) calls the Claude API directly from the
  browser; the key lives in localStorage settings only. NEVER commit a key,
  and never move it into the repo or build.
- Honesty tone throughout: warm, direct, zero shame, zero toxic positivity.

## Related

- Vault plan note: `/Users/jxm/jxm-vault/Topics/Nicotine Cessation — 60-Day Plan.md`
- Todoist project "Pouch Down" holds the reminder scaffold (meal check-ins,
  stage flips, shopping deadlines).
- v2 idea (agreed with James): native SwiftUI app via Xcode 26.3 agentic
  coding — widgets, Live Activities, local notifications — reusing plan.js
  logic. PWA data migrates via the markdown/JSON export.
