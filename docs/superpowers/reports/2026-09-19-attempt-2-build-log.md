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

---

## Session B — interface (Sun 2026-09-20, morning)

Coordinator + six parallel agents (B1–B6), per `docs/superpowers/plans/session-B-prompt.md`.
Ran Sunday morning, not Saturday afternoon — the schedule slipped a day, so B,
B2 and C all land inside the same day as the 6 PM freeze.

### Up-front answers from James

1. **AI price help: he tests it for real**, with his own key, on his phone. So
   B3 ships complete and no live API call was made from this session.
2. **Contact sheet of every setup screen: yes.** Telegram's MCP server dropped
   mid-session, so it went via Claude Code's file-send instead.
3. **Take the two extras Session A left behind:** render `saveError` as a
   toast, and stop the undo chip lying. Both done.
4. **Setup is escapable, but the Back control must be small and
   insignificant** — quiet ghost text, still a 44×44 tap target, hidden on
   screen 1 on a true first run.
5. **Sol review budget refreshed: up to 6 calls.** One was spent; it earned
   its cost (below).
6. **Build the walkthrough exactly as spec'd.**

### Progress

| Task | Status | Commit |
|---|---|---|
| B1 boot routing, Front door, Recovery screen, `saveError` toast | ✅ | `f2abc6b` |
| B3 `priceHelp.js` + sheet (15 tests) | ✅ | `f2abc6b` |
| B4 `ReadOnlyBanner` + `ReadOnlySummaryCard` | ✅ | `f2abc6b` |
| B5 `BackfillPrompt` | ✅ | `f2abc6b` |
| B7 Settings → Attempts; settings disabled while read-only | ✅ | `f2abc6b` |
| B2 `SetupFlow` + `steps` + `PlanPreview` (8 screens) | ✅ | `77ad07b` |
| B6 `MoneyCard`, wired into Today + Stats | ✅ | `77ad07b` |
| Sol review fixes (read-only guard, corrupt-storage rescue) | ✅ | `b1f2153` |
| Meal-time overflow on a 390px phone | ✅ | `5fe2f6e` |

### Exit gate — PASSED

- `npm test` → **162 passed, 1 skipped** (12 files; 158 + 4 added for the
  corrupt-storage rescue). `npm run lint` → exactly the 2 baseline warnings.
  `npm run build` → OK. Math harness → ALL MATH CHECKS PASSED.
- Headless Chromium, iPhone viewport (390×844), synthetic v1 seed, `?static`:
  Front door → Attempt 1 read-only → Exit → Start new → all 8 setup screens →
  Begin → Today. **ALL CHECKS PASSED**, zero console errors.
- Definition of done met exactly: 9/day · 9 mg · [6, 3] · 90 days ·
  2026-09-21 → **8 stages, first cut Oct 6, quit day Sat Dec 19**; Begin
  creates `a2`; **`pouch-down-v1` byte-identical** across the whole walk.

### Three bugs the walk caught that tests did not

All three were found by *looking*, not by an assertion — worth remembering when
Session C decides how much to trust a green suite.

1. **Attempt 1 showed "Nicotine-free — 15.5 days" in green.** `TodayView`'s
   `postQuit` branch ran before the read-only one, so opening the attempt that
   *didn't hold* rendered a clock that counts elapsed calendar time and asks
   for no evidence at all. This is exactly the silence-as-success failure the
   rebuild exists to kill, on the one screen James would open to look back.
   Read-only now returns the honest summary first.
2. **The undo chip lied.** `undoEvent` only removes the most recent event, but
   the chip stayed visible after a newer event landed and still dismissed the
   toast — so it looked like the pouch had been removed when nothing changed.
   Undo is now hidden once the event is no longer last, alongside the tag chips.
3. **Dinner was clipped off the right edge at 390px.** Three `<input
   type="time">` in one non-wrapping flex row overflow an iPhone; the value was
   cut mid-digit and the picker icon sat off-screen, in setup screen 6 *and* in
   Settings. Both are 2-column grids now. Nothing throws when content overflows,
   so no test would ever have caught this.

### Outside review (GPT-5.6 Sol) — 1 call of 6

Boot router, mutation guards and the read-only ordering. Code and synthetic
rules only; no personal data sent.

- ✅ Accepted: an unresolvable `viewingId` fell through to the **active**
  attempt in `view()`, dropping `readOnly` to false — a mutation would have
  landed on the wrong attempt while the UI wore a viewer's context. Not
  reachable through any current UI path; the fix is what keeps that true.
- ✅ Accepted: "Start fresh" clears `problem`, which is the only thing stopping
  the save effect writing over unreadable v2 data. `preserveCorruptV2` copies
  it aside first (never v1, never over an earlier rescue, and a full quota
  skips the copy rather than failing the recovery). 4 tests.
- ❌ Rejected for this session: `RecoveryTimeline` still derives "Nicotine-free
  — N days" from elapsed time for an **active** post-quit attempt. Sol is right
  that it is the same class as bug 1 above, but the fix is the post-quit "still
  free" check-in, already specced and due before quit day. Attempt 2 cannot
  reach that screen until 2026-12-19. **Session C should not try to fix this;
  it should confirm the 2026-12-12 deadline is real.**
- ✅ Verified rather than asserted: the only `setItem` in app code is
  `root.js` with `KEY_V2` hard-coded, there is no `removeItem` or `clear`
  anywhere in `src/`, and `KEY_V1` is only ever read. The rollback is
  structurally safe, not safe by convention.

### Decisions made without James

- **Two interface stubs were written before dispatch** (`SetupFlow`,
  `PriceHelpSheet`) so all six agents could run at once instead of in three
  waves — B1 imports B2's file and B2 imports B3's. The stubs fixed the prop
  contracts; the owning agent replaced each wholesale. This is what bought back
  the lost day.
- **Agents were told not to run `npm run build` or start a dev server** —
  six concurrent builds race on `dist/` and dev servers collide on ports. The
  coordinator ran every build and every browser check.
- **`claude-haiku-4-5-20251001` kept** in `priceHelp.js`. The `claude-api`
  skill says never to append date suffixes, but this exact id is what
  `coach.js` has used in production since July. A comment records the one-line
  fallback (`claude-haiku-4-5`) in case James's live test returns
  model-not-found.
- **MoneyCard replaced the flat "saved" tile on Today and in Stats.** A bare
  figure cannot carry "counted on N logged days", which is the sentence that
  makes the number honest. Stats keeps the forward projection as its own tile,
  relabelled "if you follow the plan".
- **MoneyCard is 2+1, not three columns** (B6's call, accepted): three
  currency figures across 390px leaves ~95px each, and `$1,234.56` does not fit.
- **The walk script drives screen 3 explicitly.** Its default is *every* chip
  below the current strength, so the acceptance case [6, 3] means unticking
  8, 4 and 2 — otherwise the plan is an 11-stage ladder with the first cut on
  Oct 1. Both B2 and the coordinator hit this independently.
- **`view()` is not unit-tested in isolation** — it is module-private in
  `state.jsx`, and exporting it risks adding a third lint warning to a
  2-warning baseline. It is covered by the headless walk.

### For Session B2 and C

- **`TodayView` already has a streak tile** (flame + count) in the footer row.
  B2's `StreakChip` must replace it, not sit beside it.
- `scripts/e2e/seed-v1.mjs` is a synthetic 60-day attempt (36 logged days, a
  best streak of 10, `kept` $22.00, and a deliberate silent tail). Reuse it —
  never the real backup. `scripts/e2e/walk-setup.mjs` is the pattern for C1's
  remaining flows; it takes `--out`, `--port` and `--keep`.
- The walk kills its preview server by PID, not `pkill -f vite` (Session A's
  noted hazard).
- `openSettings` is now plumbed from `App.jsx` into every tab view, so any
  card can deep-link into Settings.
- **Unverified by machine, worth James's eyes:** the AI price help has never
  made a live call. He is testing it himself.

### Handoff — Session B → B2 (written 2026-09-20, ~11:00 AM)

**State:** branch `feat/attempt-2`, working tree clean, HEAD `00904d3`. Five
Session B commits, **nothing pushed** — `main` is still the v1 app on James's
phone. Session B's exit gate passed; B2 may start immediately.

**Done:** B1–B7 all complete and wired. Boot routing, Front door, Recovery
screen, 8-screen setup + plan preview, AI price help, read-only viewer,
backfill prompt, money card, Settings → Attempts.

**Next (Session B2 — awards UI):** `StreakChip`, `TrophyCase`, `AwardUnlock`.
Launch with the one-liner from the vault schedule note. The awards *logic*
(`src/awards.js`) shipped in Session A and is fully tested — B2 is UI only.

**Five things B2 must know:**

1. **`TodayView` already renders a streak tile** (flame + count) in the footer
   row, left of "resisted today". `StreakChip` replaces it — do not add a
   second streak display.
2. **Never play an unlock overlay while `readOnly`.** `newlyEarned` does not
   check it and `markAwardCelebrated` no-ops on an archived attempt, so a
   celebration would replay on every open of Attempt 1, forever. (Carried
   forward from Session A; still true.)
3. `TodayView` now returns early on `readOnly` before `postQuit` — put any new
   Today surface *after* that guard or it will render over a past attempt.
4. Reuse `scripts/e2e/seed-v1.mjs` and copy `scripts/e2e/walk-setup.mjs` for
   the award-unlock flow (C1 flow 4). Synthetic data only. Kill servers by PID.
5. Label streak-badge progress in **finished** days — today is not settled yet.

**Then Session C (QA and ship).** Deploy freeze is today 6:00 PM CT. Nothing in
Session B was cut; the full B scope shipped.

**Open, deliberately not fixed:** `RecoveryTimeline` derives "Nicotine-free —
N days" from elapsed time for an *active* post-quit attempt. Same class as the
read-only bug fixed here, but unreachable until 2026-12-19 and already specced
as the post-quit "still free" check-in (due 2026-12-12). C should confirm that
deadline, not fix it now.

**Unverified by machine:** the AI price help has never made a live API call —
James tests it himself with his own key.

---

## Session B2 — awards UI (Sun 2026-09-20, 11:03 AM → 11:50 AM CT)

**Shipped: the whole B2 scope. Nothing cut.** `StreakChip`, `TrophyCase`
(+ sheet + Today tile), `AwardUnlock`, and the circular-seal `Badge` every one
of them renders. The awards *logic* was untouched — `src/awards.js` shipped in
Session A and still has not changed a line. This session was interface only.

**Gate:** 162 tests / 1 skipped (12 files), lint at exactly the 2 pre-existing
warnings, build clean, math harness ALL CHECKS PASSED. New end-to-end walk
`scripts/e2e/walk-awards.mjs`: **66 checks, all green**, 5 browser contexts at
390×844@2x, zero console/page errors, `pouch-down-v1` byte-identical in every
context.

### How it ran

Four agents in parallel, one file each, against two interface contracts written
before dispatch (`src/motion.js`, a `Badge.jsx` stub) — the same trick that
bought Session B a day. No agent ever waited on another. A fifth agent wrote and
ran the e2e walk afterwards. Coordinator did all wiring (`App.jsx`,
`TodayView.jsx`, `StatsView.jsx`, `index.css`) and every build, browser check
and commit.

### Decisions made without James

- **`src/components/awards/` subdirectory** rather than five more files flat in
  `components/`. Follows the existing `onboarding/` precedent. Reversible.
- **`src/motion.js`** — one `plainMotion()` predicate answering "should this
  moment be plain?" for both `prefers-reduced-motion` and `?static`. It replaced
  a local check in `confetti.js` that only knew about the former.
- **`tiers.js` split out of `Badge.jsx`.** Found by running the linter, not by
  reading: a file exporting a component *and* constants trips
  `react(only-export-components)`, and the stub alone added 5 warnings against a
  baseline of 2. Three agents were messaged mid-flight to re-point their imports.
- **The trophy sheet is mounted in `App.jsx`, not inside `TodayView`**, reached
  by an `openTrophies` prop beside the existing `openSettings`. `.sheet` is
  `position: fixed`, and a fixed element inside the tab wrapper anchors to
  Framer's transform on that wrapper rather than to the viewport.
- **`TrophyTile` took the streak tile's old slot** in Today's footer row, so the
  row stays two-up and the case has a second door.
- **Which 3 celebrate when more are pending:** rarest tier first (a backlogged
  aurora is the one it would hurt to swallow silently), then replayed in
  ascending order so a batch builds toward its rarest badge.
- **`line-height: inherit` added to the global `button` reset.** Wider blast
  radius than a targeted fix, but it completes a trio the reset already had
  (`font-family`, `font-size`) and prevents the same bug recurring. Verified by
  re-running the full walk: no layout shifted anywhere else.

### Two pre-existing bugs fixed on the way past

1. **`?static` still fired confetti.** `confetti.js` checked only
   `prefers-reduced-motion`, so every headless screenshot run came back speckled
   with paper. Now behind `plainMotion()`.
2. **Today's two tiles were 5.8px out of line — and had been.** First guess
   (`.card + .card` margin leaking across a `.row`) was real but was *not* the
   cause; the walk measured computed margin at 0 after that fix and the offset
   survived. Actual cause: the UA's `line-height: normal` does not inherit, so a
   `.card` that is a `<button>` set its text tighter than a `.card` that is a
   `<div>` — 36→29px number, 118.5→107px tile. Both fixes kept.

### Surprises worth carrying forward

- **`Waves` no longer exists in lucide v1.23** (it is `WavesHorizontal`). Every
  icon name in `Badge.jsx` was checked against the `.d.ts` before import — a
  wrong name is a build break, not a lint warning.
- **React 19's `useId()` returns punctuation** (`«r0»`), which is not valid
  inside `url(#…)`. `Badge.jsx` strips non-alphanumerics. The unique-id rule is
  load-bearing: a scratch harness that rendered each badge in its own React tree
  restarted `useId` and every badge inherited badge #1's gradient — all 24 went
  bronze.
- **Badge bugs are invisible to unit tests.** The rim gradient vector ended
  outside the disc, so aurora's third stop never painted and it silently lost
  its amber. Caught only by rasterizing the SVG and looking at it.
- **The e2e harness lied once.** Playwright's `addInitScript` re-runs on *every*
  navigation, so it re-seeded storage on reload, wiped `celebratedAwards`, and
  faked a replay failure. Gated on a sentinel. Worth remembering for Session C —
  a reload assertion is only as honest as its seeding.

### Outside review

GPT-5.6 Sol reviewed the celebration-queue design before the code existed
(synthetic excerpt of the state API only — no vault data, no personal numbers)
and returned 12 ranked failure modes. **Accepted and verified in the
implementation:** snapshot the batch by id rather than deriving it live;
never persist from mount/setup/cleanup; guard `readOnly` inside every effect,
not just the render path; keep an in-memory handled-set because
`markAwardCelebrated` silently no-ops; re-arm off a set of ids, not a boolean;
`e.target === e.currentTarget` on the backdrop so a Nice click cannot bubble and
steal the next award. **Rejected, with reason:** its warning that a `forEach` of
overflow marks would overwrite each other — `setRoot` in `state.jsx` is a
functional updater, so the writes compose. Verified in the code before
dismissing it.

One coordinator finding was **wrong and withdrawn**: a mid-edit read of
`confetti.js` showed `tierBurst` calling an undefined `quiet()`. The agent had
already fixed it; re-grepping the file confirmed `plainMotion()`. Worth the
30 seconds it cost to check rather than "fix" working code.

### For Session C

- `scripts/e2e/walk-awards.mjs` takes `--out`, `--port`, `--keep` and `--dry`
  (prints the fixture without launching a browser). It builds its v2 fixture
  from `planGenerator.js` and computes the expected unlock batch from
  `awards.js` using the same comparators as `AwardUnlock.jsx`, so it asserts the
  UI against the domain rather than against a hardcoded guess. Add it to the C1
  suite.
- **The trophy case is a long card.** Silver holds 12 of 24 awards — three grid
  rows — and the whole case runs ~7 rows in Stats. That is James's explicit
  "grouped by tier, everything visible" call, not an oversight. If it feels long
  on the real phone, the fix is a per-tier collapse, not a redesign.
- Nothing in B2 is deferred. Awards are derived from the log, so had this been
  cut, nothing would have been lost — but it was not cut.

---

## Session C — QA and ship (Mon 2026-09-21, 7:30 PM CT → part 2 from 9:20 PM CT)

**Ran a day late.** Session C was scheduled for Sun midday before the 6:00 PM
freeze. It started Monday evening, which was meant to be Day 1.

### Up-front answers from James

1. **Day 1 moves to Tue 2026-09-22.** Setup refuses past dates by design
   (backdating leaves unlogged days), and Monday was half over. The
   `tomorrow` default already lands there. That puts quit day on Sun
   2026-12-20 and the first cut on Wed 2026-10-07. Stage 1 holds at baseline,
   so the lost day costs nothing. The 9/27 (Firebase) and 10/4 (off-track)
   deadlines stay, and 10/4 is still before the first cut.
2. **No cuts. Keep building until it is excellent.** The 3 PM checkpoint and
   its cut order are retired for this session. The quality bar is the gate,
   not the clock. The token ceilings still apply: past ~300k the coordinator
   writes a handoff rather than cutting scope.
3. **Deploy-workflow Actions bump is deferred.** It is prepared on its own
   branch (`chore/actions-node24`, based on `main`) and merged only after the
   release is confirmed on the phone, so a first-push failure can only be the
   app and never the pipeline.
4. **No logs since Friday's backup**, so the vault backup is current for the
   C2 dry run.
5. **Merge gate:** the coordinator stops and asks before merging (James's
   standing instruction for this session), with a push notification and the
   chime. Never pushes.

### How it ran

Four waves, never two agents on one file. **Wave 1:** the shared E2E
harness, seven adversarial reviewers (one lens each), and the deferred
Actions bump, all in parallel. **Wave 2:** seven fix agents with disjoint file
ownership, plus three E2E flows run against a frozen snapshot build so
in-flight edits couldn't break them. **Wave 3:** the last two flows, on a
second snapshot taken after the fixes. **Wave 4:** two-stage review (spec
compliance, then code quality). Three reviewers were cut off mid-run by API
overload (HTTP 529) and resumed from their transcripts, so nothing was lost.
Every finding was re-run by the coordinator from the reviewer's own proof
script before it was accepted.

### C3 — adversarial review: what broke, what held

Seven lenses. The six from the plan, plus **honest scoring / backfill /
streak / money**, added because the backfill UI was built after Sol last
reviewed scoring. Nothing lost real data and no path rewrote history. What the
lenses did find:

- **The API key could leave the phone** through the recovery screen's
  "Download what's stored". It dumped the raw v1 key, which still holds the
  key in its old settings and is never rewritten. The dump now blanks every
  `apiKey` and masks `sk-ant-` on the raw text.
- **The past attempt told comfortable lies from the clock.** For attempt 1,
  the coach was told "you are nicotine-free", "N days since last pouch"
  ticked live, Plan marked all 8 stages done with weeks of days unlogged, and
  "pouches not used" counted silent days as a full baseline avoided. That
  last one was also true on `main`. Every read-side view now judges through
  `asOfDay` and counts logged days only.
- **Times were an hour off when read from Chicago.** History used the
  reader's zone, and early v1 verdicts flipped from on-time to "55m early".
  Both now use the zone the event was logged in.
- **Two crash paths and one brick.** A dinner at 23:45 threw inside
  `logPouch`. A malformed root white-screened on every boot with no error
  boundary. And "Start fresh" after a failed migration orphaned attempt 1 for
  good. All three fixed. The migration is also tolerant now: one bad entry is
  set aside instead of failing the whole history.
- **A badge could be taken back** (a price edit or an honest backfill
  rewrites the past), and a re-earn would never celebrate. Awards now latch
  once celebrated. Money is computed once in integer cents, so the card and
  the $25 badge can't disagree by a fraction of a cent.
- **pouch-ingest scored backups by the Mac's clock**, so a 1.5-day-old
  backup told the Live Log and Telegram "current 0" for a real streak.
  It now scores as of the export.
- ~25 copy fixes (tone lens). The first screen James sees tonight had a
  sentence missing half its words.

Full accepted / rejected / deferred list with reasons: **Decisions made
without James** and **Outside review**, below.

### Exit gate (C1–C4) — PASSED, Mon 2026-09-21 late evening

- `npm test`: 277 passed / 1 skipped. With `POUCH_BACKUP_DIR`: 278/278 (the
  real-backup migration test runs and passes). The suite is pinned to
  America/Chicago, and `zones.test.js` sweeps four zones.
- `npm run lint`: exactly the 2 baseline warnings. `npm run build`: clean.
  Math harness: ALL MATH CHECKS PASSED. `npm audit`: 0 vulnerabilities.
- **`npm run e2e`: 5/5 walks, 1,002 checks, 0 failures, 0 console errors.**
  migration 180 · setup 157 · backfill 192 · awards 92 · recovery 381. Each
  walk was proven able to fail (planted bugs or pre-fix snapshots).
- **C2 real-data dry run: 28/28** (real v1 backup, Chicago zone, both pinned
  and at real now). Front door; Attempt 1 listed Jul 8 – Sep 5; every event
  migrated; weekly totals equal the golden file; no live streak or clock;
  spot-check time shown in Eastern as logged; v1 byte-identical. Before the
  fixes it was 26/28, and the 2 failures were exactly the bugs the review
  predicted. The script is local-only and never committed.
- Deferred Actions bump: branch `chore/actions-node24` @ `baa90da` (based on
  `main`). Merge it only after the release is confirmed on the phone.

### Decisions made without James

Reversible defaults taken mid-run. Each is one line to undo.

**Harness and process**

- **All E2E flows pin the browser clock.** `walk-setup.mjs` typed
  `2026-09-21` as Day 1 against the real clock. After 4 AM Tue 9/22 that date
  counts as passed, and the walk would fail for a reason unrelated to the app.
- **E2E flows run in `America/Chicago`**, the phone's real zone since the
  move. The migration stamps v1 events in New York, so viewing them in
  Chicago is the realistic case. `walk-setup.mjs` ran in New York.
- **A shared `scripts/e2e/lib.mjs` is written first** (contract-first, the
  trick from B and B2), so the five flows share one server/seeding/clock
  harness instead of five copies. Seeding is sentinel-gated: B2 found that an
  ungated `addInitScript` re-seeds on every reload, which makes reload
  assertions lie.
- **The harness pins `Date` only, never Playwright's `clock.install`.** The
  awards walk found that a faked `performance.now` survives reloads and
  stalls Framer's exit animations by about 20 s. Every walk was re-run on the
  new harness.
- **Fix agents ran against frozen snapshot builds** (a detached worktree per
  wave), so the E2E walks could run while fixes were still landing. Both
  worktrees were removed at the end.
- **A seventh review lens was added:** honest scoring / backfill / streak /
  money. It is load-bearing, and the backfill UI was built after Sol last
  reviewed scoring.
- **Review ran at batch level, in two stages** (spec compliance over the
  whole fix diff against the accepted-findings list, then code quality)
  instead of per agent, to fit the coordinator budget.
- **Subagent effort:** the Agent tool has no per-agent effort switch and
  there are no custom agent definitions, so every agent inherits this
  session's setting.

**Product calls the findings forced** (the spec was silent, or its literal
reading was judged wrong)

- **An over-cap day drops the current streak to 0 at once.** The spec's
  literal reading would show yesterday's run until midnight. A number the
  user already knows is broken is a fake number. Pinned with a test.
  Reversible; told to James.
- **A celebrated award never un-earns.** A price edit or an honest over-cap
  backfill can rewrite the past and take a badge back, and a re-earn would
  never celebrate again. Now `earned = derived || celebrated`. Only
  celebrated awards latch; an award that never played can honestly re-lock.
- **Event awards wait for the undo window** before celebrating, so a badge
  can't play for a pouch that is then undone.
- **Undo has an age bound in the api itself**, not only in the toast's timer
  (iOS suspends timers on lock, so undo used to work 1.5 h later). The toast
  also hides when it ticks past `until`. Undo of a `resisted` stays allowed:
  the rule is "the just-logged event", not "pouches only".
- **Tagging rejects a negative age** (clock set back) beyond 5 s of skew.
- **The backfill prompt snapshots its list when it opens**: "on open, up to
  3" per spec. Answering three in one open used to surface a fourth. A tab
  switch remounts Today and counts as a new open, which is how Skip already
  behaved.
- **A "Break it here" day stays green on the calendar.** The day status is
  the day's truth (within cap); the streak chip carries the choice.
- **Backfill is capped at the attempt's last day** (`dayNum ≤ totalDays`).
- **Money is one integer-cents function** shared by the card and the $25
  badge, so they can't disagree by a fraction of a cent.
- **Read-only views judge through `asOfDay(state)`** and count logged days
  only: Plan stages, Stats "pouches not used", the mg chart, History's range,
  the coach's context, and "since last pouch" all stop reading the clock.
  The Stats one was also wrong on `main`.
- **History and verdicts use the zone the event was logged in.** The
  earliest v1 events, logged before `ctx` existed, rebuild their slot times
  from the event's own `tzOffsetMin`; the archive day is stamped at archive
  time.
- **Settings' "Simulate import" is gated behind `?dev`.** It writes a
  permanent fake check-in to the active attempt, which overrides a real one;
  it stays reachable for Shortcut testing.
- **The recovery dump redacts the key**: every `apiKey` value and any
  `sk-ant-` token in the raw text, with "redacted" noted in the file header.
  The raw v1 slot still holds the key forever (v1 is never rewritten).
- **The migration is tolerant.** One unreadable v1 entry used to fail the
  whole history and leave zero attempts. Now it is set aside verbatim in
  `attempt.unreadableEvents` and the rest migrates; the Front door and the
  read-only banner say so. `false` (nothing set aside) and `null` (unknown)
  are distinct; readers default with `?? []`; a numeric `ts` counts as
  unreadable; zone errors are not swallowed.
- **"Start fresh" after a failed migration tells the truth.** It used to say
  it wrote over a copy while orphaning attempt 1 for good. It now requires
  the download when the rescue copy fails (quota) and leaves v1
  re-importable.
- **The root is validated on load** (a dangling or archived
  `activeAttemptId`, a malformed root), and a top-level `ErrorBoundary` with
  a way out replaces the white screen.
- **A dinner slot at or after 23:45 no longer throws** inside `logPouch`
  (the "24:15" slot).
- **`pouch-ingest` scores as of `exportedAt`**, via a `Date` subclass swapped
  in for one synchronous call. The clean fix is a `now` parameter on the
  store functions; that goes to the Firebase spec.
- **The past-attempt viewer hides "· 0 today"** on the discipline card and
  no longer says "This is your first attempt" in Settings.
- **Backfill button copy stays as James wrote it in the spec** ("Keep my
  streak / Break it here"); the tone lens's "Count it / Don't count it" is
  offered as an optional tweak. PriceHelp keeps the spec's "explain where to
  add a key", now true during setup as well.
- **Plan taglines drop the word "floaters"** for plain language. The golden
  test compares days/count/mg/name only; `LEGACY_PLAN` is untouched.
- **The coach's model id stays the spec's dated `claude-haiku-4-5-20251001`.**
- **`App.jsx` exports `CheckinDeepLink` and `AppContent`** for tests (no
  lint warning).
- **The Actions bump keeps `node-version: 22`** (supported to Apr 2027; 24
  is advisable later): checkout v4→v5, setup-node v4→v5, configure-pages
  v5→v6, upload-pages-artifact v3→v5 (hidden files excluded; `dist` has
  none), deploy-pages v4→v5.

**Rejected findings, with reasons**

- **`tagEvent` overwrites an SOS-set trigger within 15 s** (append-only
  lens). A correction inside the window is "completing the log"; the rule
  says "set"; nothing is rewritten after the window closes.
- **The migration stamps every v1 event in New York** (raised by three
  lenses). Attempt 1 was verified entirely Eastern during the 9/18 rescue,
  the archive is "true Eastern time", and the move came after Sep 5.
- **"Keep my streak / Break it here" is leading copy** (tone lens). It is
  spec-approved copy James wrote; the buttons name the decision.

### Outside review

Four calls to GPT-5.6 Sol (`ask-chatgpt`), with synthetic fixtures and
curated excerpts only; Gemini was not needed. Sol is a reviewer, not an
authority: every claim below was checked against the code and tests first.

- **Scoring / backfill (lens 7):** 3 claims, all rejected on inspection.
  `logBackfill` already requires `keep` or `break`; the "unused id return"
  did not hold; two backfills on one day would need the first to be invalid.
- **Time zones (lens 3):** 9 claims. 6 accepted, each mapping onto one of
  the lens's own findings (History's reader-zone times, the ctx-less slot
  rebuild, ingest scoring at the Mac's clock, the 24:15 crash, `dayKeyFor(e.ts)`
  in App.jsx, unpinned tests). 1 partly accepted: pre-4 AM slots on a DST day,
  where the mechanism is real but unreachable with sane meal times. 1
  rejected: the 1:30 AM repeated hour has no reachable slot. "The migration is
  correct" accepted as a confirmation.
- **Migration (lens 1):** 12 claims. 6 accepted and folded into the M1–M6
  fixes. 5 rejected: the app killed before a save (React 19 saves
  synchronously after the tap, same as v1); in-memory on failure (that is the
  spec); concurrent first boot (the two-writers deferral); "overwrite day"
  (v1 had no day concept); a stuck recovery screen (reload). One observation,
  that the migration drops `checkinDismissedFor`, accepted as harmless.
- **Unreadable-events design (FX-A):** accepted the `false`/`null`
  distinction, `?? []` readers, not swallowing zone errors, and numeric `ts`
  as unreadable. Rejected a strict ISO-only check (the contract is exactly
  what the app writes today), storing the raw v1 blob inside v2 (doubles
  quota and carries the key; kept as a follow-up idea), and cross-tab /
  double-tap concerns (the write is idempotent).

### Deferred

Each item names where it goes.

- **Two writers.** Last-writer-wins across two tabs, same as v1; the iPhone
  PWA is one context. → The Firebase sync spec (live by Sun 9/27) must solve
  concurrent writers.
- **A `now` parameter on the store functions.** Ingest pins `Date` as a
  workaround. → Firebase spec.
- **Post-quit logging.** After quit day, Today renders only the recovery
  timeline: no backfill, a clean quit day is unloggable except via SOS,
  `day-zero` can't be earned, and the nicotine-free clock is time-based.
  Taken now: the log ring on quit day and a "Since quit day" header.
  → The post-quit "still free" spec, before Sun 12/20. It must make quit day
  loggable as zero, keep slips and backfill working after quit day, make
  `day-zero` earnable, and base "since quit day" on logs.
- **A mistaken over-cap backfill can't be undone** (the stepper's max is
  `MAX_PER_DAY`, 40). → Public launch.
- **A stale service worker could keep the v1 page logging after the
  migration** (suspected, not reproduced). → Phone checklist: don't log
  until the Front door appears.
- **The key lives in the v1 slot forever.** Clearing it in Settings clears
  v2 only; v1 is never rewritten. → Tell James: revoking it at
  console.anthropic.com is the only kill switch.
- **The morning check-in card shows all day**, including at 02:30 (still
  the previous app day). v1 behaviour, left. → Tell James.
- **The Actions bump** waits on `chore/actions-node24` @ `baa90da` (based on
  `main`). → Merge after the release is confirmed on the phone. On its first
  run expect no Node 20 warnings, one npm cache miss, and an artifact holding
  `index.html`, `sw.js`, the manifest, and the workbox files.
- **Small follow-ups:** one `isLive(state)` helper (seven-plus spellings
  today, all agreeing; `timeSinceLastPouch` in TodayLog is the same class);
  de-duplicate share → clipboard → file (Settings lacks the file fallback);
  the recovery dump can't tell blocked storage from absent storage; the
  optional copy tweak "Count it / Don't count it".

### Handoff — Session C, part 1 → part 2 (written Mon 2026-09-21, late)

**Why a handoff:** James hit his usage limit. Everything up to the merge
question is done and committed; only paperwork and the ship remain.

**State:** branch `feat/attempt-2`, working tree clean, **nothing pushed**.
`main` is still the v1 app on the phone. Scratch snapshot worktrees removed.

**Next session does, in order:**
1. Tick the plan: add a "Session C exit gate" block under Task C5 in
   `docs/superpowers/plans/2026-09-18-attempt-2-build-plan.md`, with C1–C4
   ticked (numbers above). Add the "Decisions made without James" / "Outside
   review" / "Deferred" sections to this log, from the raw coordinator notes
   below. Commit.
2. Vault: tick Session C in `/Users/jxm/jxm-vault/Pouch Down/Attempt 2 —
   Build Schedule.md` and add a 3-line status under it. Update frontmatter
   `day_one` → 2026-09-22 and `quit_day` → 2026-12-20. Commit ONLY that file
   in the vault repo with a `claude:` message; never `git add -A`, never push.
3. Push notification + `afplay /System/Library/Sounds/Glass.aiff`, then
   **ask James before merging** (his standing instruction for Session C).
4. On his yes: `git checkout main && git merge --no-ff feat/attempt-2`.
   **Never push.** Give him the phone checklist from `session-C-prompt.md`,
   with these corrections:
   - (step 1) Don't log anything until the Front door appears.
   - (step 3) The Front door shows a **"Past attempts" list**; there is no
     "View a past attempt" button. Tap **Attempt 1** there.
   - (step 4) The backup files as `Pouch Down/Backup <real date> (v2).json`.
   - (step 5) Day 1 = **Tue Sep 22** (the default); preview shows first cut
     Wed Oct 7, quit day Sun Dec 20.
   After he pushes: `gh run watch`, verify his v2 backup (attempt a1 with
   every event, no key), file it, then write the release section and the
   one-paragraph kickoff for the next spec (below). Merge
   `chore/actions-node24` only after the phone checks out.
5. Final summary for James (beginner-friendly), the diff stat, and the chime.

**Tell James (things only he can decide or should know):**
- Clearing the key in Settings leaves it in the old v1 slot forever. The
  only real kill switch is revoking it at console.anthropic.com.
- An over-cap today drops the streak to 0 at once (the spec's literal reading
  would keep yesterday's run until midnight). This is reversible.
- The first stage is 8/day on a 9/day baseline, the same as attempt 1's
  hand-written plan (the generator's 8/9 step).
- A "Break it here" day still shows green on the calendar, because the day
  itself was within cap; the streak chip carries the choice.
- The backfill copy ("Keep my streak / Break it here") was kept as he wrote
  it in the spec. The tone review suggested "Count it / Don't count it" as an
  optional tweak.
- The morning check-in card shows all day, including evenings (v1 behaviour).

**Next-spec kickoff inputs:**
- Firebase sync + push reminders, live by Sun 9/27. It must solve two
  writers (last-writer-wins today) and should give store.js a `now`
  parameter (ingest pins Date as a workaround).
- Off-track detection incl. "too good to be true" counts, live by Sun 10/4,
  before the first cut on **Wed 10/7**.
- Post-quit "still free" check-in before quit day (**Sun 12/20**). It must
  make quit day loggable as zero, keep slips and backfill working after quit
  day, make `day-zero` earnable, and base "since quit day" on logs.
- Small follow-ups: one `isLive(state)` helper (7+ spellings, all agree
  today); de-duplicate share→clipboard→file (Settings lacks the file
  fallback); the recovery dump can't tell blocked storage from absent.

**Gotchas:**
- Walks must never build into `dist/` (lib's `buildApp` refuses).
- `seedV1()` gives new ids per call, so call it once.
- Playwright's `clock.install` stalls Framer after reloads; lib pins `Date`
  only.
- The C2 script lives in the old session's scratchpad
  (`/private/tmp/claude-501/-Users-jxm-Projects-pouch-down/c5f78fc1-93c2-4509-98a7-1eec9d06ab5a/scratchpad/c2-realdata.mjs`).
  If /tmp was cleared, rewrite it from the Task C2 text. Never commit it.

### Release — Attempt 2 shipped (Mon 2026-09-21, late evening)

**Merge:** `23e2f3e`, `feat/attempt-2` → `main` with `--no-ff`. The merge tree
is byte-identical to the branch tip `c94e973`. Local `main` equalled
`origin/main` at the last successful deploy (`0cd6db2`) before the merge, so
nothing was overtaken. The manifest's identity (id, start_url, scope) is
unchanged from the last deploy; only its description changed, so the
installed PWA keeps its identity and its data.

**Pre-push gate, on the merged `main`:** `npm test` 277 passed / 1 skipped ·
lint at the 2 baseline warnings · build clean · math harness passed ·
lockfile in sync with `package.json` (CI runs `npm ci`) · local Node 24 vs
CI Node 22, same lockfile · `npm run e2e` 5/5 walks, 1,002 checks, 0 failures, 0 console errors (migration 180 · setup 157 · backfill 192 · awards 92 · recovery 381), run on the merge commit itself · outside first-boot review
via GPT-5.6 Sol: no blockers, one call. Premise correction accepted: `src/` never imports
`virtual:pwa-register`, so the registration is a bare `register()` with no reload on
takeover; the phone runs v1 for one more launch and v2 boots on the launch after,
migrating any interim v1 logs then. Six non-blocking findings go to follow-ups: run the
migration output through `wellFormed` before the first save; `saveError` does not gate
logging (the non-dismissible toast is the mitigation, and the root is ~300 KB against a
~5 MB quota); a one-launch blank window while Pages swaps the tree (relaunch fixes it,
nothing written); `LEGACY_TZ` is New York by decision; a stale well-formed v2 root would
hide v1 (never deployed); no committed test renders the Front door on the real blob (the
local C2 dry run covers it). Rejected: two simultaneous first boots or v1 logging after
the snapshot (one document, partitioned storage); id collisions (needs the same
millisecond); `setItem` read-back (generic WebKit, same as v1).

**Push, authorized by James in this session** ("get this pushed whenever it
is safe"): `git push origin main` at 9:50 PM CT (`0cd6db2..23e2f3e`); deploy run
35680915800 watched with `gh run watch`, green in 45 s (`npm ci`, build, upload,
deploy-pages) on the unchanged workflow. Live verification after the deploy: the live `index.html` references exactly the local build's hashed
bundle and stylesheet, the live manifest carries the new description, the live `sw.js`
precaches the new bundle, and `smoke-live.mjs` (scratchpad only; synthetic v1 in a
private headless profile, America/Chicago, clock pinned) passed 30/30 on the live URL
with 0 console errors: Front door on first load, v2 written once, service worker
registered and controlling after reload with scope `/pouch-down/`, Attempt 1 listed and
read-only with no unlock overlay, Exit, v1 byte-identical, one attempt with no key, a
second reload migrates nothing.

**Phone:** checklist handed to James at 9:53 PM CT. A v2 backup AirDropped from the
phone was filed by `pouch-ingest` at 6:56 AM Tue 2026-09-22 and verified: format 2,
`device.apiKey` blank, no key string in the file, attempt a1 archived with every event
of the v1 backup and none missing, plan dates intact. Only the new build can write a
v2 backup, so the migration ran on the real phone. No active attempt in that export
yet; setup still to run (Day 1 = Tue 2026-09-22). `chore/actions-node24` stays parked
until James says the phone checks out.

**Security audit (Tue 2026-09-22, morning):** six adversarial lenses plus a two-model
panel over the app, pipeline, ingest tooling and privacy. The app itself held; the
findings are about what surrounds it. The report is private, in the vault
(`Pouch Down/Security Audit 2026-09-22.md`), because it lists weaknesses of a public
app; nothing was changed in the repo, the vault tooling, `~/Library`, or GitHub
settings.

### Next spec — kickoff (draft; not built)

Attempt 2 starts Tue 2026-09-22, and attempt 1 cracked at the first cut, not
at the start. So the next build is the net, and it has dates. **By Sun
2026-09-27: Firebase sync + push reminders.** Sync must solve two writers
(today is last-writer-wins, same as v1; the iPhone PWA is one context, and
Firebase makes it two) and should give the store functions a `now`
parameter so `pouch-ingest` stops pinning `Date`. Reminders are real push,
not in-app: meal check-ins, the missed-day nudge, the stage flip. **By Sun
2026-10-04, before the first cut on Wed 2026-10-07: off-track detection.**
Two signals: missed days (the backfill prompt already knows them; this is
the reach-out side) and counts that are too good to be true, such as a day
logged far under the cap during the baseline hold or a long run with no
resisted events, which get a warm "is this right?" rather than a badge.
Both must respect the rules that outlived the build: silence is never
success, no guilt mechanics, history is append-only, nothing James-specific
is hardcoded. **Before Sun 2026-12-20: the post-quit "still free" check-in**,
which must make quit day loggable as zero, keep slips and backfill working
after quit day, make `day-zero` earnable, and base "since quit day" on logs.
Small follow-ups ride along: one `isLive(state)` helper, a de-duplicated
share → clipboard → file path, and a recovery dump that can tell blocked
storage from absent. Spec first (brainstorming, then writing-plans), then a
session prompt shaped like C's.

## Session D — security hardening (Thu 2026-09-25, evening)

Worked the private review of the Attempt 2 release into decisions James made
and fixes built on `feat/security-hardening`. The review itself stays in the
vault, because it describes weaknesses of a public app; this section says what
was hardened, never how anything could be abused. Seven commits, 33 files,
+2318 / −251. Nothing pushed.

### Up-front answers from James

- **Keep all six Remote Control hosts, and keep auto mode.** Picking a project
  from the phone is worth real risk to him; tighten around it instead. Rules
  mirror the desktop — one set for both, no phone-specific restrictions.
- **No allow-list trim**, for the same reason. Added three **ask** rules
  instead (`git push`, `gh auth`, `curl`), which beat allow rules, so nothing
  lost capability and the deploy path always stops for a tap.
- **Terminal sessions stop publishing themselves to the phone**
  (`remoteControlAtStartup: false`), and the keep-awake agent is off: he sleeps
  the Mac deliberately and wants "asleep = no remote access" as a boundary he
  can see.
- **Separate GitHub identity: yes, by fine-grained token, later** — both his
  accounts sit in this Mac's keyring, so the powerful token has to leave the
  Mac for the separation to be real. A separate macOS user was rejected because
  it would need its own Claude subscription.
- **The sandbox is wanted but deferred** — it is the only real fence rather
  than a speed bump, and it needs a session of testing.
- **The API key is never at rest on the phone**, filled from a password manager
  instead. A proxy holding it server-side (Cloudflare Worker) is the agreed end
  state, deferred to the Firebase work. Browser-side encryption was rejected.
- **No Shortcut, no `?checkin=` deep link** — removed rather than hardened.
- **AirDrop only** is how backups travel, so that is what `~/Downloads` trusts.
- **Timestamp literals replaced in the working tree; history not rewritten.**

### What was built

- **Ingest trusts sources, not filenames.** iCloud by location; `~/Downloads`
  only for files macOS says arrived by AirDrop. Size cap before the read, a
  refusal for an export time ahead of the clock, and the app's own `wellFormed`
  before anything is filed or rendered from. Every backup-derived string passes
  through `safeText` before it reaches a vault note, headings included.
  **Refusals are reported** — summary, watcher log, and Telegram — because a
  file James believed he sent, silently ignored, is the same shape as scoring
  silence as success.
- **A Content Security Policy, injected at build only** (dev needs inline
  script and a websocket), pinned by `csp.test.js`. Inter is served from
  `src/fonts/` as two variable `woff2` files, which closed `style-src` and
  `font-src` to `'self'` and removed the service worker's third-party runtime
  cache. No npm dependency added.
- **The key stopped living on the device** (`src/sessionKey.js`): held for the
  session, carried across a reload in `sessionStorage` (per-tab), filled from a
  password manager into a password field. Every root that comes out of storage
  hands an inherited key to the session and comes back blank — including one
  migrated from v1 on this boot, which was the last path that could persist one.
  `pouch-down-v1` is still read-only, so rotating the key in the console remains
  the only way to retire the copy frozen there.
- **Hostile stored data can no longer brick the app.** `wellFormed` now checks
  what the readers actually index into, all the way down; a root that passes but
  cannot render lands on recovery instead of a crash that reloads into itself.
  `ErrorBoundary` remembers a boot crash and offers the existing recovery path
  on a second one. `rawStorageDump` redacts its finished output.
- **Housekeeping:** Dependabot for Actions and npm, the five actions pinned to
  the exact commits their floating majors already point at (each verified
  against its tag), eight real timestamps replaced with invented ones.

### Three bugs the hardening found that nothing had noticed

1. **A parseable-but-unreadable backup crashed the whole ingest run** (exit 1,
   nothing rendered), and it was archived first, so every later run re-selected
   it and the Live Log stayed frozen until the file was deleted by hand.
2. **A refusal was completely silent** — the CLI said "nothing new" and the
   watcher log printed nothing at all.
3. **Settings advertised a Shortcut URL** that the deep-link removal had just
   made inert, with a copy button. Copying it would have silently done nothing.

### Verified

`npm test` **407 passed / 1 skipped** (345 before the last package; 277 at the
session's start) · with `POUCH_BACKUP_DIR` set, 407 passed / 0 skipped · lint at
the 2 baseline warnings · build clean · math harness passed · **`npm run e2e`
5/5 walks, 1,002 checks, 0 failures, 0 console errors** (migration 180 · setup
157 · backfill 192 · awards 92 · recovery 381) — a CSP violation surfaces as a
console error, so the walks are the real gate on the policy.

**Proved against reality, not just fixtures:** the tightened `wellFormed` was
run over every v2 root in the vault (6 pass, 0 rejected), and at 7:35 PM James
AirDropped a fresh backup mid-session. The watcher runs straight out of the
working tree, so tonight's code filed it: quarantine agent `sharingd`, filed,
original moved aside, Live Log regenerated, nothing refused. The one
irregularity was a Telegram send failing (`fetch failed`) with the macOS
notification fallback doing its job — first occurrence in the whole log.

### Deferred, with reasons

- **Component-level `String()` guards** in `TodayLog`, `HistoryTimeline` and
  `PlanView`. `wellFormed` now gates every route that reaches them, so these are
  belt to existing braces; display code is the wrong thing to change late with
  no failing test driving it.
- **The v1→v2 migration path is still not gated by `wellFormed`**, on purpose:
  gating it could turn attempt 1 into `migration-failed`, which must never
  happen. A v1 missing a settings field would now land on recovery on the next
  boot rather than crashing. The clean fix is filling `DEFAULT_SETTINGS` gaps in
  `migrate.js`.
- **One literal recovery component** for both the crash screen and the recovery
  screen: `RecoveryScreen` calls `useApp()` and `ErrorBoundary` is mounted
  outside the provider, so sharing it means moving the boundary inside.
- **A notify-only Telegram bot** (the notifier still borrows the conversational
  bot's token; disabling the plugin does not affect sending), **the
  fine-grained token**, **sandbox testing**, and **the Cloudflare Worker proxy**.
- **A custom domain** stays blocked behind an import path: storage does not
  follow a change of web address, and backups are export-only today.

### For the next session

Nothing here changed a domain rule. The plan, the scoring, the event shape and
the append-only guarantee are untouched, and `pouch-down-v1` was never written.
The branch is unmerged and unpushed; James merges and pushes.

### Handoff — Session D → the coach-proxy session (written Thu 2026-09-25, evening)

**Why there is another session:** the key is off the device but James has to enter it
once per session, and he won't accept that — correctly. So the key leaves the phone
entirely: a Cloudflare Worker he owns holds it, and the app authenticates with a
low-value device token pasted once per device. Zero per-session friction, and the key
stops being reachable from anything running on the shared web origin.

**The contract both halves are built to** (do not redesign it): `POST
<proxy>/v1/messages`, `content-type: application/json`, header `x-pd-device: <token>`,
body exactly what the app sends today (`{ model, max_tokens, system, messages }`).
Success is the Claude API's JSON unchanged; errors are `{ error: { message } }` with 401
(device token), 403 (origin), 400 (rejected body), 502 (upstream). The Worker holds
`ANTHROPIC_API_KEY` as a secret, allowlists `claude-haiku-4-5-20251001` only, caps
`max_tokens` at 400 and the body at 16 KB, compares the token timing-safely, and rejects
any body field outside those four. The session-key fallback must keep working whenever
`COACH_PROXY` is empty.

**State at handoff:** `workers/coach-proxy/` built (Worker, pure `guard.js`, tests, and a
beginner-level README that is James's deploy script). The app-side wiring
(`src/proxyConfig.js`, `coach.js`, `priceHelp.js`, the three sheets, the CSP
`connect-src`) was still mid-edit — **check `git status` and the suite before trusting
it, and rebuild rather than patch around anything half-done.**

**Decisions already made, so the session need not ask:**
- **Worker address: the one thing to ask James**, at the keyboard. Build against the
  placeholder in `src/proxyConfig.js` and do everything else first. He runs
  `wrangler login`, `secret put` and `deploy`; Claude never sees a key or a token and
  never asks him to paste one into a chat.
- **Push authorized for that session only:** merge and push once *every* gate is green
  (suite, lint at the 2 baseline warnings, build, math harness, e2e 5/5 with zero console
  errors run on the merge commit, then live verification). Any gate red → do not push.
  The standing never-push rule is unchanged everywhere else.
- **A design-first pass on Settings**, which has grown into one long scroll. Inside
  Modern Dark Cinema, no new dependencies, phone-first at 390px, 44px targets, reduced
  motion respected, and `?static` must still disable animation or the walks break.
- **Three deferred items to finish:** the `String()` guards in `TodayLog`,
  `HistoryTimeline` and `PlanView`; filling `DEFAULT_SETTINGS` gaps in `migrate.js` (the
  most load-bearing code in the app — give it its own outside review); and pointing the
  ingest notifier at a notify-only Telegram bot through `POUCH_TELEGRAM_ENV`.

**Pending from a parallel session (`pouch-down-0d`):** a capability-boundary paragraph in
`systemPrompt()` plus a `coach.test.js` case, to diagnose the coach over-promising. It is
holding until this branch's `coach.js` is committed, lands **after** the push, and only
with James's go-ahead. It keeps the same four request fields, the same model and
`max_tokens: 400`, and will verify the total body against the Worker's 16 KB cap with the
7-day log at its largest. The stale comment at the top of `coach.js` belongs to this
session, not that one.

### Session D, part 2 — the coach proxy (Thu 2026-09-25, late evening)

Built after James rejected per-session key entry, which was the right call: a
security fix that costs a daily tax gets switched off eventually. So the key
leaves the phone instead of moving around on it. Both halves are **built,
tested and dormant** — nothing changes for the user until `COACH_PROXY` in
`src/proxyConfig.js` is filled in and a rebuild ships.

- **`workers/coach-proxy/`** — a Cloudflare Worker holding `ANTHROPIC_API_KEY`
  as a secret. Every decision is a pure function in `guard.js`: an origin
  allowlist, a timing-safe device-token compare (fixed-work, no early exit), and
  clamps that bound what a stolen token could cost — one model, `max_tokens`
  400, a 16 KB body, 40 messages, and no body field outside the four the app
  sends. `README.md` is James's deploy script, written for a beginner: he runs
  `wrangler login`, `secret put` and `deploy` himself, and no secret is ever in
  the repo, in a chat, or in Claude's hands.
- **The app** picks its transport at call time (`proxyConfig.js`): the proxy
  when one is configured *and* this device holds a token, otherwise the
  session-key path, which keeps working and stays the labelled fallback. The
  request body is byte-identical either way. The CSP imports the same constant,
  so `connect-src` widens only when a proxy is set; with it empty the shipped
  policy is unchanged, asserted by diffing the built HTML.

**Gates:** `npm test` **485 passed / 1 skipped** (the Worker's 32 guard tests
are now inside `npm test` — `vite.config.js`'s `test.include` gained
`workers/**`, because a gate nobody remembers to run is not a gate) · lint at
the 2 baseline warnings · build clean · math harness passed · **`npm run e2e`
5/5, 1,002 checks, 0 console errors**.

**Known, deliberate, and worth reading before the deploy:**
1. **Filling `COACH_PROXY` in without shipping a rebuild is a silent CSP block.**
   The policy is baked into the HTML at build time. Change the constant and
   deploy together.
2. **Every upstream error becomes a 502**, so the app cannot tell a rate limit
   from an overload and Anthropic's `retry-after` is lost. Kept generic because
   passing the upstream body through leaks account and request detail, and
   because 401 is already spent on the device token. The clean fix is a
   machine-readable `error.code` — **the first follow-up when the proxy goes
   live.**
3. **A request with no `Origin` header is refused.** Fine for a browser; a
   Shortcut or a future native client would have to send one.
4. **`max_tokens` 400 is exactly what the coach sends**, so there is no
   headroom: bumping the coach means bumping `LIMITS.maxTokens` in the same
   change or the proxy refuses it.
5. **`api.anthropic.com` stays in `connect-src`** while the key fallback exists.
   Dropping the fallback and the host is a deliberate second step, once the
   Worker has proven itself.
6. **The device token is invisible to backups** because the dump reads the two
   root keys by name. True by accident rather than design — decide it on purpose
   if a future dump ever enumerates storage.
