# Attempts, Onboarding, Honest Scoring, Money & Awards — Design

**Approved:** 2026-09-18 (James, in session) · **Ship by:** Sun 2026-09-20 6:00 PM CT (deploy freeze) · **Day 1 of attempt 2:** Mon 2026-09-21

## 1. Why

Attempt 1 (60 days, from 2026-07-08) did not hold. The app's share of the blame:

1. **Silence looked like success.** A day with no log scored as "on plan". The run ended with a long fake streak and fake money saved. Under-logging (implausibly low counts) came *before* missed days, and nothing noticed either.
2. **Nothing was editable.** Start date, baseline, stages, and even the user's name are hardcoded in `src/plan.js` and `src/coach.js`. The app can't be restarted, let alone shared.
3. **History depends on the phone's current time zone.** Days are bucketed with the device zone *at read time*; moving zones reshuffled the whole log.

James wants to restart without losing history, and to point the architecture at a future where other people enter their own starting data. Public launch is a future build — this design must not block it, and must not build it.

## 2. Scope

**In (by Sunday 6 PM):** attempts data model + v1 migration · plan generator · front door + setup walkthrough · read-only past-attempt viewer · honest scoring + backfill · rebuilt money model with AI price help · awards + streak badges with celebration animations · generalized coach prompt · backup export updated for v2.

**Out (own specs, week 1–2):** Firebase auth/sync and push reminders (live by 2026-09-27) · off-track detection incl. "too good to be true" counts (live by 2026-10-04, before the first cut on 2026-10-06) · restore-from-backup import · post-quit "still free" daily check-in (needed before quit day) · native app.

**Explicitly dropped:** Todoist bridge reminders.

## 3. Data model (v2)

New localStorage key **`pouch-down-v2`**. The v1 key `pouch-down-v1` is read once and **never written or deleted** — rollback is reverting the deploy.

```js
{
  version: 2,
  device: { apiKey: '' },          // never leaves the phone, never in a backup
  activeAttemptId: 'a2' | null,
  attempts: [{
    id: 'a1',                      // 'a' + ordinal
    status: 'archived' | 'active',
    createdAt, archivedAt,         // ISO; archivedAt null while active
    settings: { mealTimes, costPerTin, pouchesPerTin, wakeTime, sleepTime },
    plan: { generator, startDate, quitDate, totalDays, baseline: { pouchesPerDay, mg }, stages: [...] },
    events: [...],                 // append-only
    celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null,
  }],
}
```

**An attempt is deliberately a superset of the old v1 `state`** (`settings`, `events`, `celebratedStages`, `checkinDismissedFor`) plus `plan`. Every existing derivation in `store.js` keeps its `(state, …)` signature — `state` is now "the attempt being viewed" — and reads `state.plan` instead of importing constants. This keeps the refactor mechanical.

**Sharing later:** an attempt is self-contained and user-agnostic, so the future Firestore shape is `users/{uid}/attempts/{id}` with events as a subcollection. Nothing in an attempt names James.

### Events and time

Every new event is stamped at log time by `time.stampNow()`: `ts` (ISO UTC), `tzOffsetMin` (minutes east of UTC), `day` (the local 4am→4am day it counts toward). All bucketing uses `time.dayKeyOf(e)`; all wall-clock display uses `time.localHM(e)`. Migration stamps v1 events with `America/New_York`, the zone they were logged in.

Event types: `pouch`, `resisted`, `checkin` (unchanged), plus **`backfill`**: `{ type: 'backfill', day: <target day>, count: <int ≥ 0>, streak: 'keep' | 'break' }`. For a backfill, `day` is the day being filled in, not the day it was entered.

History rules are unchanged: append-only; undo of the just-logged event and the 15-second `tagEvent` are the only mutations. A backfill is a new event, not an edit.

## 4. Plan generator — `src/planGenerator.js` (built, tested)

`generatePlan({ pouchesPerDay, mg, strengths, lengthDays, startDate, mealTimes, sleepTime, pouchesPerTin })` → plan. Pure.

- **Counts** step down by the original proportions (8/9, 6/9, 4/9, 2/9 of baseline; deduped, never below 2), then a "Last one" stage at 1/day, then quit day.
- **Strengths** = current, then each lower strength the user can buy. Count cuts and strength drops interleave: hold → cut → drop → cut → drop → cut…
- **Durations** split by weight (final main stage 0.8) with largest-remainder rounding; "Last one" = `round(length/60)` days, min 1. Minimum plan 30 days; minimum baseline 2/day.
- **Slots:** meals protected (dinner outlasts lunch outlasts breakfast); floaters placed evening → afternoon → morning, then widest stretch; times rounded to 15 min.
- **Shopping:** each strength drop gets `shopBefore` = tins needed for all remaining days at that strength.

**Golden test:** inputs 9/day, 9 mg, [6, 3], 60 days reproduce the hand-written plan exactly. Attempt 1 keeps the frozen original (`src/legacyPlan.js`).

## 5. App flow

```
boot → loadRoot()
  no v2, v1 present  → migrateV1 → save v2 → Front door
  no data at all     → Welcome → Setup
  active attempt     → app (as today)
  no active attempt  → Front door
```

**Front door:** "Start a new attempt" / "View a past attempt" (list: dates, length, days logged). Also reachable from Settings → **Attempts** ("View past attempts", "End this attempt and start over" → confirm → archives the active attempt → Front door).

**Setup walkthrough** — one question per screen, progress dots, Back always available, nothing saved until **Begin**:

| # | Screen | Input | Default |
|---|---|---|---|
| 1 | How many pouches a day, right now? | stepper, min 2 | — |
| 2 | What strength? | chips 2 3 4 6 8 9 12 15 mg | — |
| 3 | Which lower strengths can you buy? | multi-select chips below current | all |
| 4 | How long do you want to take? | chips 60 / 90 / 120 + custom (≥30) | 90 |
| 5 | When is Day 1? | date | tomorrow |
| 6 | Your daily rhythm | breakfast, lunch, dinner, wake, sleep | last attempt's |
| 7 | What do you really pay? | price per tin, pouches per tin, **AI help** | last attempt's |
| 8 | Your plan | stage list with dates, caps, strengths, shopping, quit date | Back / **Begin** |

A Day 1 in the future puts the app in the existing `pre` mode (logging allowed, not judged).

**Read-only viewer:** a past attempt opens in the normal shell with a banner ("Viewing Attempt 1 · Jul 8 – Sep 5 · Exit"). Log ring, SOS, check-in, and settings edits are hidden; every mutating `api` call no-ops while `readOnly`. Awards show but never celebrate.

## 6. Honest scoring

A day is **logged** if it has ≥1 `pouch` or `resisted` event, or a `backfill`. `used(day)` = pouch events + backfill count.

Statuses: `future` · `pre` · `green` (logged, ≤ cap) · `yellow` (logged, > cap) · **`nolog`** (past, in-plan, not logged — gray, never green) · `today-under` · `today-over`.

**Streak** = consecutive `green` days ending yesterday, plus today if today is logged and under cap. `nolog` and `yellow` break it. A `backfill` with `streak: 'break'` breaks it even when under cap.

**Backfill prompt:** on open, up to the 3 most recent `nolog` days (newest first) within the last 7 days. "No log for Tuesday. How many?" → stepper → **Skip** / **Save**. If the count is over cap the streak breaks as usual, no question. If it is within cap the user chooses — **"Keep my streak"** or **"Break it here"** — copy: *"Your call. The app only knows what you tell it."* One backfill per day; skipped days stay `nolog` and re-prompt until they age out.

Backfilled pouches carry no timing, so discipline stats count them in their own `backfilled` bucket, outside on-time/early.

## 7. Money — `src/money.js`

Old model credited a full baseline day of savings for every unlogged day. New model counts **logged days only**:

- `perPouch = costPerTin / pouchesPerTin`
- `oldPace` = Σ logged days `baseline × perPouch` · `spent` = Σ `used × perPouch` · `kept = oldPace − spent` (may be negative — shown honestly as "over your old pace")
- `afterQuit = { perMonth, perYear }` = baseline × perPouch × 30 / × 365

Card copy: **"Old pace $X · You spent $Y · Kept $Z"**, then "Quit for good: ~$N a month back." plus "based on N logged days".

**AI price help** (setup screen 7 and Settings): free text — "5-pack at the gas station for $23.99 plus tax" — → Claude (existing on-device key, `claude-haiku-4-5-20251001`) returns `{ pricePerTin, pouchesPerTin, explanation }` as JSON → shown for confirmation → **Use these**. No key: the button explains where to add one. Any failure: "Couldn't work that out — enter it by hand." The future public build proxies this through a backend; the call is isolated in `src/priceHelp.js` so only that file changes.

## 8. Awards — `src/awards.js`

Pure `awardsFor(attempt)` → `[{ id, tier, title, body, earned, earnedOn, progress }]`, derived at read time like everything else (nothing to lose if UI ships late). `celebratedAwards` records which unlocks have played. Based on *best* streak so badges never un-earn. Zero shame: honesty is rewarded, slips are not punished.

| id | tier | Earned when |
|---|---|---|
| `showed-up` | bronze | first log of the attempt |
| `streak-3` / `-7` / `-14` / `-30` / `-60` / `-90` | bronze→aurora | best streak reaches N |
| `full-week` | silver | 7 consecutive logged days, on plan or not |
| `honest-yellow` | silver | logged an over-cap day ("a true yellow beats a fake green") |
| `came-back` | silver | logged or backfilled the day after a `nolog` day |
| `rode-it-out` / `rode-it-out-10` | bronze / gold | 1 / 10 cravings resisted |
| `on-the-clock` | gold | a full day with every pouch on time |
| `first-cut` | gold | 7 green days in a row starting at the first cut |
| `stage-N` | silver | stage N ended with ≥70% of its days logged |
| `kept-25` / `kept-100` | silver / gold | `kept` reaches $25 / $100 |
| `day-zero` | aurora | quit day reached and logged |

**UI:** streak chip on Today (flame + count, springs on change) · **Trophy case** card in Stats (grid; locked badges dimmed with progress ring) · **unlock overlay**: badge springs in, shimmer sweep, tier-scaled confetti via existing `confetti.js`, queued when several unlock at once, tap to dismiss. Honors `MotionConfig reducedMotion="user"` and `?static`. Design system unchanged ("Modern Dark Cinema").

## 9. Other changes

- **Coach:** system prompt built from `state.plan`; "James" → "you"/"the user"; key read from `device.apiKey`.
- **Backup:** `fullBackup(root)` exports the whole v2 root with `device.apiKey` blanked.
- **Markdown export:** iterates day 1 → `min(today, totalDays)`; `nolog` days say "no log".
- **`plan.js`:** reduced to plan helpers taking a plan (`stageForDay(plan, n)`, `capForDay(plan, n)`) and static content (`RECOVERY_MILESTONES`, `WITHDRAWAL_NOTES`). The old constants are deleted so stale imports fail the build.

## 10. Error handling

Corrupt v2 JSON → do **not** overwrite; show a recovery screen offering "Download what's stored" and "Start fresh". Migration throws → stay on v1 data read-only and surface the error; never save a partial root. Generator rejects invalid inputs; the setup UI prevents them. Storage write failure (quota) → toast, state stays in memory.

## 11. Testing

vitest for all pure logic (generator golden + property sweep, time, migration incl. the real backup via `POUCH_BACKUP_DIR`, scoring, money, awards). Playwright scripts (`scripts/e2e/`, `playwright-core@1.59.1`, cached Chromium) for: v1→v2 migration on boot, full setup walkthrough, read-only viewer, backfill keep/break, award unlock. Existing math harness must still pass.

## 12. Acceptance (Sunday)

1. With the real v1 data, the app boots to the Front door; Attempt 1 opens read-only with every event intact and **no** fake streak.
2. `pouch-down-v1` is byte-identical before and after.
3. James completes setup himself and sees a 90-day plan: first cut day 16, quit day 2026-12-19 (given a 2026-09-21 start).
4. An unlogged past day is gray, excluded from streak and money.
5. Backfill asks keep/break when within cap.
6. At least one award unlock plays its celebration.
7. `npm test`, `npm run lint`, `npm run build`, and the math harness pass.
