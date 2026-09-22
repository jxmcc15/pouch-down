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

## Session C — QA and ship (Mon 2026-09-21, 7:30 PM CT → )

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

### Decisions made without James

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
- **A seventh review lens was added:** honest scoring / backfill / streak /
  money. It is load-bearing, and the backfill UI was built after Sol last
  reviewed scoring.
- **Subagent effort:** the Agent tool has no per-agent effort switch and
  there are no custom agent definitions, so every agent inherits this
  session's setting.
