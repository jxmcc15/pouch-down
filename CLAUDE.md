# Pouch Down — Project Context

James's 60-day nicotine pouch cessation tracker. Built 2026-07-07; extended
from 30 to 60 days on 2026-07-08. The taper runs July 8 → September 5, 2026
(quit day). This app is load-bearing for a real
health goal — treat changes with care.

## Attempts model (v2 — built 2026-09-18 → 2026-09-21)

Attempt 1 (Jul 8 → Sep 5) didn't hold: logging faded after the first cut, and
the app scored the silence as success. v2 rebuilt the app around **attempts**:
the root (`pouch-down-v2`) holds a list of self-contained attempts, each =
settings + plan + append-only events. Attempt 1 is migrated in, archived and
read-only. James sets up attempt 2 himself in-app; planned Day 1 is **Tue
2026-09-22** (setup refuses past dates), which puts the first cut on Wed 10/7
and quit day on Sun 12/20. History of the build: `docs/superpowers/` (spec,
plan, session prompts, and the build log in `reports/`). Released to the
phone 2026-09-21 (merge `23e2f3e`).

Rules (they outlive the build):

- **The `pouch-down-v1` localStorage key is sacred** — read once for
  migration, never written, never deleted. It is the rollback. A v1 entry the
  migration can't read is kept verbatim in `attempt.unreadableEvents`, never
  dropped.
- **Silence is never success.** A day with no pouch/resisted/backfill event
  is `nolog` (gray) — never green, never in a streak, never in money, never
  "pouches not used". Past attempts are judged only through `asOfDay(state)`
  (their own end), never through today's clock: no live gap clock, no
  "nicotine-free N days" from elapsed time, no stage marked "done" by date.
- **No personal usage data in this repo — it's public.** James's backups and
  golden numbers live in the vault (`/Users/jxm/jxm-vault/Pouch Down/`);
  real-data tests read `POUCH_BACKUP_DIR` and skip without it.
- **Nothing James-specific is hardcoded.** Plans are data on the attempt
  (`planGenerator.js`); `legacyPlan.js` is attempt 1's frozen plan. The end
  goal is other people entering their own starting point. Public launch is a
  future build — don't block it, don't build it.
- **Events are stamped with local day + UTC offset at log time** (`time.js`)
  so history never reshuffles when the phone changes zone. Bucket with
  `dayKeyOf(e)`, display with `fmtTime(ev)`/`localHM(e)`, never `ev.ts` in
  the reader's zone. Tests run pinned to America/Chicago; `zones.test.js`
  proves the derivations agree in four zones.
- Awards, streaks, money, and statuses are **derived at read time**; only
  "which celebrations already played" is stored. A celebrated award never
  un-earns (price edits and honest backfills can rewrite the past). Money is
  computed once, in integer cents (`money.js` `moneyCents`).
- **The recovery dump and every backup blank `apiKey`** — v1 still holds the
  old key in its settings, forever. Revoking the key at console.anthropic.com
  is the only real kill switch.
- **E2E**: `npm run e2e` runs the five Playwright walks in `scripts/e2e/`
  (migration, setup, backfill, awards, recovery) on one private build.
  `lib.mjs` is the harness: clocks are pinned (`phoneContext({ now })`),
  seeding runs once per context (a re-seed on reload makes reload checks lie),
  and nothing builds into the repo's `dist/`. Synthetic data only.
- Next specs: Firebase sync + push reminders (live by 2026-09-27) · off-track
  detection incl. implausibly-low counts (live by 2026-10-04, before the first
  cut) · **post-quit "still free" check-in before quit day** — it must make
  quit day loggable as zero, keep slips and backfill working after quit day,
  make `day-zero` earnable, and base "since quit day" on logs.

## What it is

Phone-first PWA (iPhone, installed from Safari), deployed to GitHub Pages
(`jxmcc15/pouch-down` → https://jxmcc15.github.io/pouch-down/). Vanilla
Vite + React + Framer Motion, no backend, no TypeScript. All user data is
on-device localStorage (`pouch-down-v2` root; `pouch-down-v1` kept as the
rollback), event-sourced.

## Design system

"Modern Dark Cinema": deep gradient background + aurora blobs, frosted-glass
cards, Inter, indigo accent `#5e6ad2`, green `#34d399` / amber `#fbbf24`
status colors. All motion is Framer springs; `MotionConfig reducedMotion="user"`;
`?static` URL param kills animations for headless testing.

## Domain rules (do not break)

- **The plan is data** on each attempt, made by `src/planGenerator.js` (pure;
  the golden test reproduces attempt 1's hand-written plan) — hybrid taper
  (count first, then strength), meal-anchored slots. `src/plan.js` holds plan
  helpers + static content. James's meals
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
  parsed in App.jsx), and `backfill` (`{ day, count, streak: 'keep' |
  'break' }` for a missed day, entered later; `day` is the day filled in; one
  per day; a new event, never an edit). Undo and `tagEvent` windows are
  enforced by the api itself (`src/justLogged.js`), not only by the toast.
- **NEVER push without James**: pushing `main` auto-deploys to the live PWA
  on his phone (`.github/workflows/deploy.yml`). Commit locally; he pushes.
- **Days run 4am→4am** (`DAY_CUTOFF_HOURS` in time.js) so late nights count
  against the right day.
- **The AI coach** (`src/coach.js`) calls the Claude API directly from the
  browser (so does `src/priceHelp.js`); the key lives only in `device.apiKey`
  in the v2 root and is blanked from every backup and dump. NEVER commit a
  key, and never move it into the repo or build.
- Honesty tone throughout: warm, direct, zero shame, zero toxic positivity.

## Related

- **Before reviewing James's data, run `pouch-ingest`** and read `Pouch Down/Live Log.md` in the vault — never ask him to paste an export.
- Vault plan note: `/Users/jxm/jxm-vault/Topics/Nicotine Cessation — 60-Day Plan.md`
- Todoist project "Pouch Down" holds the reminder scaffold (meal check-ins,
  stage flips, shopping deadlines).
- v2 idea (agreed with James): native SwiftUI app via Xcode 26.3 agentic
  coding — widgets, Live Activities, local notifications — reusing plan.js
  logic. PWA data migrates via the markdown/JSON export.
