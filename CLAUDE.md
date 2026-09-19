# Pouch Down — Project Context

James's 60-day nicotine pouch cessation tracker. Built 2026-07-07; extended
from 30 to 60 days on 2026-07-08. The taper runs July 8 → September 5, 2026
(quit day). This app is load-bearing for a real
health goal — treat changes with care.

## ⚠️ Attempt 2 build in flight (2026-09-18 → 2026-09-20)

Attempt 1 didn't hold (logging faded after the first cut). James restarts
**Mon 2026-09-21** on a 90-day plan he sets up himself in-app. The rebuild —
attempts model, plan generator, onboarding, honest scoring, money, awards —
lives on branch **`feat/attempt-2`**; `main` is still the v1 app until the
Sunday merge. **Deploy freeze: Sun 2026-09-20 6:00 PM CT.**

- Spec: `docs/superpowers/specs/2026-09-18-attempts-and-onboarding-design.md`
- Plan: `docs/superpowers/plans/2026-09-18-attempt-2-build-plan.md`
- Session prompts: `docs/superpowers/plans/session-{A,B,B2,C}-prompt.md`
- Build log: `docs/superpowers/reports/2026-09-19-attempt-2-build-log.md`

Rules added by this build (they outlive it):

- **The `pouch-down-v1` localStorage key is sacred** — read once for
  migration, never written, never deleted. It is the rollback.
- **Silence is never success.** A day with no pouch/resisted/backfill event
  is `nolog` (gray) — never green, never in the streak, never in money saved.
- **No personal usage data in this repo — it's public.** James's backups and
  golden numbers live in the vault (`/Users/jxm/jxm-vault/Pouch Down/`);
  real-data tests read `POUCH_BACKUP_DIR` and skip without it.
- **Nothing James-specific is hardcoded.** Plans are data on the attempt
  (`planGenerator.js`); the end goal is other people entering their own
  starting point. Public launch is a future build — don't block it, don't
  build it.
- **Events are stamped with local day + UTC offset at log time** (`time.js`)
  so history never reshuffles when the phone changes time zone.
- Awards, streaks, money, and statuses are **derived at read time**; only
  "which celebrations already played" is stored.
- Next specs (not started): Firebase sync + push reminders (live by
  2026-09-27), off-track detection incl. implausibly-low counts (live by
  2026-10-04 — the first cut is 2026-10-06, where attempt 1 cracked).

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
  just-logged event is the only allowed deletion, and `api.tagEvent` is the
  only allowed mutation: it may set the mood trigger on the *most recent*
  pouch event within 15 seconds of logging — "completing" the log, same
  spirit as undo. Nothing else, ever.
- **Event types**: `pouch` (carries a `ctx` snapshot of slot/cap/nth facts
  stamped at log time; verdicts always derive at read time via
  `classifyPouch`), `resisted`, and `checkin` (morning sleep/workout;
  append-only, latest check-in per day wins at read time; `source:
  'manual' | 'shortcut'`, shortcut arriving via the `?checkin=` deep link
  parsed in App.jsx).
- **NEVER push without James**: pushing `main` auto-deploys to the live PWA
  on his phone (`.github/workflows/deploy.yml`). Commit locally; he pushes.
- **Days run 4am→4am** (`DAY_CUTOFF_HOURS` in store.js) so late nights count
  against the right day.
- **The AI coach** (`src/coach.js`) calls the Claude API directly from the
  browser; the key lives in localStorage settings only. NEVER commit a key,
  and never move it into the repo or build.
- Honesty tone throughout: warm, direct, zero shame, zero toxic positivity.

## Related

- **Before reviewing James's data, run `pouch-ingest`** and read `Pouch Down/Live Log.md` in the vault — never ask him to paste an export.
- Vault plan note: `/Users/jxm/jxm-vault/Topics/Nicotine Cessation — 60-Day Plan.md`
- Todoist project "Pouch Down" holds the reminder scaffold (meal check-ins,
  stage flips, shopping deadlines).
- v2 idea (agreed with James): native SwiftUI app via Xcode 26.3 agentic
  coding — widgets, Live Activities, local notifications — reusing plan.js
  logic. PWA data migrates via the markdown/JSON export.
