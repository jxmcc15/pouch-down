# Attempt 2 — Build Log

Running log for the Attempt 2 build (`feat/attempt-2`). One dated section per session. No personal usage numbers here — this repo is public.

## Session A — foundation logic (started Fri 2026-09-18, late evening)

Coordinator + one subagent per task, per `docs/superpowers/plans/session-A-prompt.md`.

### Up-front answers from James

1. **Auto-ingest watcher (A9 step 7): don't skip it.** When it needs James's attention, message him on Telegram (or push) instead of failing silently. Built as: launchd agent `com.jxm.pouch-ingest` + Telegram messages via his existing bot (token read at run time from the Telegram plugin's own config, never copied into this repo).
2. **iCloud Drive `PouchDown` folder:** yes — created.
3. **Run `pouch-ingest` for real at the end:** yes, and commit what it writes in the vault.
4. **`playwright-core@1.59.1` as a devDependency:** yes — added (exact pin); cached Chromium 147 launches.

Calls made by the coordinator (no objection from James): catch storage-write failures instead of crashing (`saveError` for Session B to toast); neutral wording in the Live Log (no hardcoded name); dedupe backups by SHA-256 across the whole `Pouch Down/` vault folder.

### Progress

| Task | Status | Commit | Tests after |
|---|---|---|---|
| A1 `plan.js` helpers; legacy plan frozen as data | ✅ stages/plan/recovery content verified byte-identical to before | `20face9` | 28 |
| — `playwright-core@1.59.1` devDep | ✅ | `e80968c` | — |
| A3 `root.js` v2 storage | ✅ + max-ordinal attempt ids, data-safety tests | `3080586` | — |
| A2 `store.js` honest scoring | ✅ all 16 plan tests; passes under UTC/LA/NY/Tokyo | `0f78cd5` | 57 |
| A6 `state.jsx` provider | ✅ + save failures surface as `saveError`; undo limited to the most recent event; backfill input validation | `6ccd846` | 57 |
| A4 `money.js` | ✅ + archived-attempt and `Kept:` export tests | `5aafabc` | 65 |
| — store hardening (Sol call 1) | ✅ | `6ce791f` | 78 |
| — persistence hardening (Sol call 2) | ✅ + garbage v1 JSON (`5`, `null`, `[]`, no events) → `migration-failed` | `23fef23` | 104 |
| A5 `awards.js` | ✅ 22 tests (12 plan + 10 added) | `9cc9c86` | 104 |
| A8 backup on v2 | ✅ | `ad2c450` | 104 |
| — awards/backfill hardening (Sol call 3) | ✅ | `2a05360` | 114 |
| A9 `pouch-ingest` command + Live Log | ✅ real run done: the Downloads backup was byte-identical to the vault's attempt-1 backup → recognised as a duplicate, original moved to `Backups/_ingested/`; Live Log written (vault commit `0fff841`) | `fc27b70` | 114 (+1 real-data) |
| A9 step 7 — watcher + Telegram | ✅ launchd `com.jxm.pouch-ingest` loaded (WatchPaths: Downloads + iCloud/PouchDown; daily 09:00). macOS privacy check: node **can** read both folders under launchd, so nothing to grant. One "watcher is on" Telegram message delivered (HTTP 200). Also fixed a false daily "stale" nudge (hand-filed backups weren't counted). Coordinator widened token redaction to bare tokens. | `e411424` | 143 (+1 real-data) |
| A7 consumers (5 lanes) | ✅ build green; math harness unchanged (zero assertion lines touched) | `c39bc61` | 104 (+1 real-data = 105) |

### Decisions made without James

- **A7 ran as 5 lanes, not one agent per file**: Today (App + Today components), Stats core (Stats/Calendar/History + `index.css`), Stats cards, Plan + Coach, math harness. Every lane owned a separate set of files, and one lane per area kept the coordinator's context small. `SettingsSheet.jsx` went to A8, since both tasks edit it.
- **A2 ‖ A6 and A5 ‖ A7 ran early.** They touch different files, and the plan fixes the APIs they call.
- **Awards count settled days only** (A5 agent's call, accepted): a streak/money/first-cut badge unlocks once the day is over, so a later slip the same day can never revoke a badge that already played. The flame count on Today still includes today. "Came back" is judged on days logged at the time, so backfilling the missed day doesn't erase it. Pre-Day-1 logs count toward "Showed up".
- **Pre-plan Today card derived from the plan.** It hardcoded "Day 1 is Wednesday, July 8" and the July 9mg/6mg dates, which would have been wrong on Sunday evening after setup. Now it uses `plan.startDate` and the first lower-strength stage.
- **Coach prompt** now tells the model that "no log" days are unknown, not successes.
- **`pouch-ingest` details** (A9 agent, accepted): days after the backup's export day read **"not in backup"**, so a stale file can't pass for unlogged days; today reads "no log yet" / "… so far". `parseBackup` also refuses unknown formats, a missing `exportedAt`, and any non-empty `apiKey`, and never echoes JSON parse errors (they can quote file contents). Unreadable folders (macOS privacy) are recorded as `blocked` instead of crashing. The Live Log re-renders on every run so the staleness warning stays current. Frontmatter uses vault style (block lists, `aliases`, `updated`, `generated_by`).
- **Skipped a Sol review of `pouch-ingest`.** Its only destructive-looking operations are an exclusive-create copy and a same-volume `rename`, and the coordinator read both. Sol calls were spent on scoring, persistence and awards instead (3 of ~6).
- The boot-check agent stopped its dev server with `pkill -f vite`, which would also stop any other Vite dev server running on this Mac at that moment. Noted for James; future agents should kill by PID.
- `npm audit` reports 7 findings (6 high, 1 moderate), all in pre-existing build tooling (`sharp`, `postcss`, `browserslist`, …), none from `playwright-core`. Left alone — out of scope for this build.

### Outside review (GPT-5.6 Sol / Gemini)

Code and synthetic rules only; no personal data sent.

**Call 1 — scoring (`store.js` status/streak/missedDays/day math):**
- ✅ Accepted: silent days *after* quit day scored `green` (the `nolog` check was limited to `n ≤ totalDays`). Streaks/money weren't affected (capped at totalDays), but it breaks "silence is never success". Fixed → `nolog`.
- ✅ Accepted as hardening: `dayNumberFor`/`dateForDayNumber` did calendar math through device-zone `Date`s + elapsed ms. Sol's failing case (Samoa skipping 2011-12-30) is exotic, but pure UTC-midnight arithmetic removes the device-zone dependence for free. Fixed.
- ✅ Accepted: a malformed backfill `count` (negative, string, NaN) was trusted by scoring. The API validates on write (A6); reads now ignore an invalid backfill entirely — unknown is never success.
- No finding on streak/missed-day windows.

**Call 2 — persistence (`root.js` + `state.jsx`):**
- ✅ Accepted: an empty stored string (`""`) under either key skipped the corruption check (`if (raw)`), so the app would save a fresh root over it. Now `!== null` → reported as corrupt / migration-failed.
- ✅ Accepted: the read-only guard read a ref written during render, so `exitViewing(); startAttempt()` in one handler dropped the start and `viewAttempt(); logPouch()` could append. The A6 agent had flagged the first half independently. Fixed by keeping `viewingId` in the same state as the root and deciding read-only inside each updater.
- ✅ Accepted: `startFresh()` bypassed every guard ("recovery screen only" was just a comment). Now a no-op unless storage is actually unreadable.
- No finding on StrictMode double-invocation, effect ordering, the 1 s tick, or rapid taps.

**Call 3 — awards (`awards.js`):**
- ✅ Accepted: `logBackfill` would accept a backfill for a day that already had logs. The UI only offers unlogged days, but the API didn't enforce it, and it was the one route by which a streak/day-zero badge could un-earn. Now refused, atomically, for logged days and pre-start days.
- ✅ Accepted: unearned badges could show a full progress ring (stage ≥70% logged but not finished; money progress includes the unsettled today). Unearned progress is now capped below 1; NaN → 0.
- ❌ Rejected: "showed-up / full-week / honest-yellow / came-back earn on unsettled days." Deliberate. These can only grow within a day; the only thing that can revoke them is undo of the just-logged event, which means "that didn't happen".
- ❌ Rejected: "false came-back when the missed day was backfilled." Sol's case needs a same-day backfill, which the API forbids (backfills are for past days only). Backfilling a missed day and logging the next day *is* coming back.
- ❌ Rejected: "a second `break` backfill un-earns a streak." The API allows one backfill per day (and now only on unlogged days).
- ❌ Rejected: "NaN baseline → NaN progress." The generator rejects invalid baselines; NaN progress is clamped to 0 anyway.
- Already known/accepted: a large backfill can pull `kept` back under a `kept-N` threshold.

### Surprises

- **Old undo could delete any event by id.** CLAUDE.md allows only undo of the just-logged event. A6 restricts it to the most recent event of the active attempt.
- **Legacy pouches without a `ctx` snapshot** (early attempt-1 events) derive their slot times in the phone's *current* zone, so their early/on-time verdicts can shift by an hour when viewed from another zone. This predates the build, only affects attempt 1's discipline stats, and events with `ctx` are unaffected. Left for Session C to judge.

### Exit gate — PASSED (Fri 2026-09-18, late night)

- `npm test` → **143 passed, 1 skipped** (11 files; target ≥ 70). With `POUCH_BACKUP_DIR` → **144 passed** (real-data migration included).
- `npm run lint` → exactly the 2 baseline warnings. `npm run build` → OK. Math harness → ALL MATH CHECKS PASSED, with zero assertion lines changed.
- Headless Chromium on `npm run dev`, synthetic data only:
  - v1-only boots to "No active attempt yet."; `pouch-down-v1` stays byte-identical across two reloads; v2 holds `a1` archived with every event; no re-migration.
  - Corrupt v2 shows "Storage problem: corrupt" and is left untouched.
  - An active attempt renders all tabs with zero console errors; silent days show gray "no log".
  - The pre-plan card shows the right weekday/date from the plan.
- Outside review: 3 Sol calls (scoring, persistence, awards). 9 findings accepted and fixed, 4 rejected with reasons (above). Gemini wasn't needed; nothing was disputed.

### The watcher (for James)

- **What it does:** an AirDropped or iCloud-saved backup is filed in the vault within seconds, the Live Log is regenerated, and a Telegram message confirms it. It also nudges once a day (after 9 AM) when the newest backup is more than 3 days old, and messages you if macOS ever blocks it or it hits an error. Every message type is deduped.
- **Turn it off:** `launchctl bootout gui/$(id -u)/com.jxm.pouch-ingest && rm ~/Library/LaunchAgents/com.jxm.pouch-ingest.plist`
- **Log:** `~/Library/Logs/pouch-ingest.log`. State (dedupe timestamps): `~/.local/state/pouch-ingest/`.
- **Caveats:**
  - It runs whatever is checked out in `~/Projects/pouch-down`. If a branch without `scripts/ingest-backup.mjs` is checked out, it fails with only a log line. After Sunday's merge, `main` has it.
  - An nvm upgrade that removes node v24.14.1 needs a one-line edit to `~/.local/bin/pouch-ingest`.
  - The daily run rewrites `Live Log.md` in the vault. Obsidian Git's auto-commit picks it up.

### For Session B (and B2/C)

- **"Begin" must call `api.exitViewing()` first** if a past attempt is open. It works in the same handler now (the guard is atomic), but while viewing, `startAttempt` no-ops by design.
- **Undo toast:** `undoEvent` only removes the most recent event. If anything was logged after the toast's event, undo is a silent no-op, but `LogToast` still reports success. B could check the result or hide Undo once the event is no longer last.
- **`saveError`** (from `useApp()`) is non-null after a failed write. Render it as a toast (spec §10).
- **`problem`** is `'corrupt'` or `'migration-failed'`. The recovery screen (B1) must offer "Download what's stored" (the raw strings) before `api.startFresh()`, which is a no-op unless there's a problem.
- **Awards UI (B2):** never play unlock overlays while `readOnly` (`newlyEarned` doesn't check it, and `markAwardCelebrated` no-ops on archived attempts, so they'd replay). Label streak-badge progress as full days (today isn't settled yet).
- **Known edge:** a backfill above the old baseline lowers `kept` for a past stretch, which could move a `kept-N` badge back under its threshold. Rare; accepted.
- **Deploy-day edge (C5):** if the old v1 app is still cached on the phone after the new one has migrated, anything logged in the old app goes to `pouch-down-v1` only. It isn't lost (v1 is never deleted), but v2 won't see it. Open the app twice after deploy and confirm the Front door shows before logging.
- `gapStats` now returns `longestGapEnd` (the event) alongside `longestGapEndedAt`. `disciplineStats` has `backfilled`. `fmtTime` prefers an event.
