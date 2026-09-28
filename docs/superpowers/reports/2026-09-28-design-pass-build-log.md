# Build log — the design pass: Settings, Stats, Calendar, Today, and three old debts

**Session F, 2026-09-28** · branch `feat/design-pass` (worktree
`~/Projects/pouch-down-design`, off `main` at `fa0f9ce`) · **nothing pushed** ·
spec: `docs/superpowers/specs/2026-09-28-design-pass-design.md` · plan:
`docs/superpowers/plans/2026-09-28-design-pass-plan.md`

You decided six things with Session E on the morning of the 28th, through the
brainstorming mockups. This night built them. No domain rule moved: events are
still append-only, a silent day is still gray, a past attempt is still judged
only as of its own end, the key is still never at rest, the CSP is still
build-only, and days still run 4am→4am.

## What you will see when you pull the build

**Settings** is six sections instead of one scroll. *Routine* has your meals
and, at last, wake and sleep — labelled for what they really do ("Used when a
plan is built … Your current plan's slots don't move"). *Money* is unchanged.
*Coach* is one row whose title **is** the status ("Not connected" / "Key held
for this session" / "Connected via your proxy") and opens the Coach connection
sheet, where the key and device-token fields moved verbatim. *Attempt* is one
row ("Attempt 2 · day N of 90 · 1 past attempt") that opens the Attempts
sheet: a summary card, the past-attempts list, and "End this attempt and start
over" inside a red **Danger zone** at the bottom, still with its confirm step.
*Your data* leads with the backup and now says when this phone last sent one.
*About* shows the build's short commit, so a screenshot from your phone can be
matched to a commit.

**Stats** opens on **Overview**: the descent chart, the two tiles, a
**trophy strip** (six seals and "+N more", one tap into the full case), then
Timing / Body / Triggers. The **History** segment is the day list with the
Fix-this-day pencils, one tap away instead of seven cards down; every row now
names its weekday. The Money card left Stats (it lives on Today).

**Calendar** is month blocks. Each has a header (September · days 1–9), its own
weekday row, and the **date** as the big number. A day you corrected wears a
small pencil, a backfilled day a rotate mark, and both are spoken to a screen
reader. The star still marks quit day.

**Today** is unchanged except that **SOS sits directly under the ring**, inside
the fold on a normal day.

## The three old debts, paid

1. **Display guards.** A slot label, trigger, note, stage name or meal time that
   had somehow become an object in storage used to throw inside React and take
   the tab down. `asText()` in `src/text.js` is the one guard; TodayLog,
   HistoryTimeline and PlanView print stored strings only through it. The test
   renders each component against a hostile fixture, and — after the reviewer
   pushed back — **every one of the fourteen guards has a test that fails
   without it** (the implementer deleted each guard in turn to prove it).
2. **Migration fills what an early v1 never had.** `migrate.js` now fills
   missing settings from `DEFAULT_SETTINGS`, meal times key by key. Only
   *absent* keys are filled: a present value, even `null`, is never replaced,
   and a complete v1 migrates byte-identical to before (a test compares the
   whole root as JSON). The plan wanted `migrate.js` to import the defaults
   from `root.js`; the implementer found that `root.js` imports `migrate.js`,
   so the defaults arrive as a `defaults` option that both callers pass — the
   boot path in `root.js` and the vault's `parseBackup` in `ingest.js`. A
   dedicated reviewer read only that diff and confirmed all six properties
   before it was committed.
3. **A notify-only Telegram bot** can now carry its own chat id: the ingest
   notifier reads `TELEGRAM_CHAT_ID` from the same env file as the token, so
   nothing else has to sit beside it. Precedence is `POUCH_TELEGRAM_CHAT` →
   the file → `access.json` as before. Nothing changes until you wire it (the
   recipe is below).

## Gates, all run on the final code commit `36e8b50`

| Gate | Result |
|---|---|
| `npm test` | **607 passed, 4 skipped** (28 files; baseline 573 / 4) |
| `npm run lint` | 1 warning, the pre-existing one in `src/state.jsx:226` |
| `npm run build` then `rm -rf dist/` | clean; `dist/` removed |
| `npm run e2e` | **6/6 walks, 1,068 checks, 0 failures, 0 console errors** (migration 190 · setup 157 · backfill 192 · awards 95 · recovery 381 · fixday 53) |
| After-screenshots at 390px | Today, Calendar, Stats Overview, Stats History, Settings, Coach connection, Attempts — seeded from your newest backup, **0 console errors**, read by Claude (kept in the session scratchpad, never the repo) |

**Before → after, from the same harness and the same backup:**

| Screen | Before | After |
|---|---|---|
| Stats (full page) | 4,041 px, the trophy case a third of it, History at the bottom | Overview **2,432 px** with a 6-seal strip; History its own **844 px** segment |
| Settings sheet | 1,155 px flat, "End this attempt" looked like any button | 1,347 px in six labelled sections; ending an attempt is behind the Attempts door, in a danger zone, with its confirm step |
| Calendar | 1,037 px, plan-day numbers, no dates | 1,384 px, four month blocks with dates in the cells |
| Today | SOS below the Money card | SOS under the ring, inside the first screen |

Settings got *taller*, on purpose: wake and sleep are new fields and each
section has a header. It reads as five short groups now, not one list.

## What the reviewers caught, and why it matters

Every task had an independent reviewer (Opus 5.5, fresh context, reading the
diff against the plan and the rules), and `migrate.js` had one of its own.
Findings that changed code:

- **Guards nobody could prove.** The first render-guard commit was correct but
  six of its guards could be deleted with no test failing. A guard without a
  failing test is a guard the next refactor removes. Fixed with hostile
  fixtures for every guarded value.
- **The plan's import cycle** (`root.js` ↔ `migrate.js`). Caught by the
  implementer, confirmed by me, solved with the `defaults` option. The lesson:
  a plan is a hypothesis about the code, and the code wins.
- **The plan's `{...DEFAULT_SETTINGS, ...given}`** would have reordered keys
  and broken the byte-identical guarantee for a complete v1, and its
  `given.mealTimes ?? {}` would have replaced a present `null`. The shipped
  `fillAbsent` adds only what is missing, in v1's own key order.
- **The notifier's regex** could cross a newline: a blank `TELEGRAM_CHAT_ID=`
  line would have read the *next* line as the chat id. One character (`\s*` →
  `[ \t]*`) and a test.
- **Escape with stacked sheets.** Settings has no Escape handler, so the plan's
  `stopPropagation` in a bubble-phase listener would not have stopped anything.
  The sub-sheets use a capture-phase listener instead, so Escape closes only
  the top sheet.
- **A duplicate label**: with a proxy configured the token field's label read
  "Coach connection" directly under a sheet titled "Coach connection". Renamed
  to "Through your proxy".
- **Five time fields, one rule.** Clearing a meal field used to save `''`,
  which the store silently reads as noon — a wrong time nobody chose. All five
  time inputs (meals, wake, sleep) now save only a real `HH:MM` and snap back
  otherwise.
- **The row's status was invisible to a screen reader** (the row's
  `aria-label` replaced its text). Fixed with `aria-describedby`, so the walks'
  selectors still match and the status is read out.
- **The trophy strip did not fit at 40 px seals** on a 375 px phone (six seals
  plus the count need ~318 px inside a ~297 px card). Seals are 36 px, the
  count wraps to two lines, and a narrower phone clips a seal, never the count.
- **A lint exception for a pure function** inside a `.jsx` file was the wrong
  trade; `stripPicks` moved to its own module, as the plan's own architecture
  line asks.
- **The plan's calendar test had the wrong cap** (`10`; the generator's first
  stage for a 10-a-day start is 9). Pinned to the truth. The plan's CSS
  selector for the first month header would have matched every header; fixed.
- **The spoken "corrected" mark broke one exact-match check** in the fixday
  walk. The check was made *stricter* — it now proves the mark is spoken — and
  the calendar commit waited for the Stats lane's commit to the same walk file
  so each commit carried only its own change.
- **The viewer's History segment was never swept for live-clock language** once
  History moved behind a tab. The migration walk now clicks the tab and runs
  the sweep there too (186 checks, up from 184).
- **SOS entered 50 ms after the card below it.** One number.
- **Attempts' Done closed Settings too** (Sol; see below). Two exits now, and
  the walk proves the return.

## Sol's whole-branch review (GPT-5.6, one call, the diff pasted)

Sol saw the code diff only (one line naming you in a test comment was
scrubbed first), never the vault. It reported two findings and eight things it
checked and found sound: `migrate.js` fills only absent settings and rewrites
no events; no-log days are never promoted; archived attempts use `asOfDay`;
`asText` rejects every unsafe React child; the notifier's precedence; the key
stays session-only; the CSP stays build-time; the other walk edits weaken no
assertion.

**Accepted — High.** The Attempts sheet's Done, X and backdrop closed
*Settings too*, because the plan gave it `closeAll` as its only exit and
called that acceptable. Sol was right that it is inconsistent with the Coach
sheet one row above, and that the migration walk had been written to
accommodate it rather than assert the return. Fixed in `a2c5655`: the sheet
now has two exits — `onClose` (X, Done, backdrop, Escape) returns to Settings;
`onLeave` (choosing a past attempt, ending the attempt) leaves Settings. The
walk now asserts that Settings is still there after the Attempts sheet's Done
(migration walk 184 → 190 checks).

**Accepted as hardening — Medium.** Sol said `stopPropagation` in the
sub-sheet's Escape handler would not stop another `keydown` listener on the
same `window`. That is true for listeners in the *same phase*; ours is a
capture-phase listener, and stopping propagation there does skip the bubble
pass, so the Task 5 reviewer's reasoning held. `stopImmediatePropagation` also
covers any future capture listener on `window`, at the cost of one word, so
it went in with the same commit.

Nothing was rejected outright; both findings were verified against the code
before acting.

## The Telegram recipe (you run this; Claude never touches a token, a chat id, or your plist)

The notifier borrows the conversational bot's token today. A notify-only bot
means disabling the plugin never silences backup alerts, and the token that
can *talk* to you is not the one sitting in a launchd environment. Steps:

1. In Telegram, open **@BotFather** → `/newbot` → follow the prompts → copy the
   token it gives you. Never paste it into a chat with Claude.
2. Open a chat with your new bot and send it any message (a bot cannot message
   you until you have messaged it).
3. In a browser: `https://api.telegram.org/bot<TOKEN>/getUpdates` — find
   `"chat":{"id":…}` in the JSON. That number is your chat id.
4. Create the file, readable only by you:
   ```bash
   mkdir -p ~/.config/pouch-ingest
   umask 077
   printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' '<TOKEN>' '<CHAT_ID>' > ~/.config/pouch-ingest/telegram.env
   chmod 600 ~/.config/pouch-ingest/telegram.env
   ```
5. In `~/Library/LaunchAgents/com.jxm.pouch-ingest.plist`, inside the
   `EnvironmentVariables` dict, add:
   ```xml
   <key>POUCH_TELEGRAM_ENV</key>
   <string>/Users/jxm/.config/pouch-ingest/telegram.env</string>
   ```
6. Reload the agent:
   ```bash
   launchctl bootout gui/$(id -u)/com.jxm.pouch-ingest
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jxm.pouch-ingest.plist
   ```
7. AirDrop a backup. The new bot should speak; if it does not, the macOS
   notification fallback still fires and the watcher log says why.

## How the night ran

Twenty-one agent runs in all: ten implementers (one of them called back for
Sol's fixes), ten stage reviewers (one per task, plus the dedicated
`migrate.js` reader), and Sol once. Every brief was curated
— the task's plan lines, the files it owned, the rules that applied — and no
agent inherited this session's context. Tasks 1–4 ran as four parallel
implementers on disjoint files; then Settings (5 → 6) and Stats (7 → 8) ran as
two lanes; Calendar and Today followed. Because the e2e harness binds fixed
ports, agents were told to check for another running walk before starting
one, and to edit shared walk files only with targeted edits; two commits to
the same walk file landed cleanly that way. Every review finding was fixed
before the next task in its lane started. Twenty minutes in, the harness's
safety classifier went down and every non-read action was refused for a
while; nothing was lost, and the agents were briefed to retry.

Coordinator context stayed near 200k tokens; subagents used roughly 1.7M
between them.

## Known and deliberate

- **An early v1 without a price now gets the default tin price** (\$5 / 20)
  after migration, where it used to show \$0. Only a v1 phone booting for the
  first time or a v1 backup through `ingest` is affected; the plan asked for
  the defaults, and you can correct the price in Settings.
- **A v1 whose `mealTimes` is present but broken** (`null`, a string) still
  reaches recovery on its *second* boot — the v1 path in `loadRoot` never runs
  `wellFormed` on the migrated root. Pre-existing, not a regression; the fix
  belongs in `loadRoot`, not in the migration.
- **The trophy strip's `aria-label` replaces its content**, so a screen reader
  hears "Trophy case: N of M earned. Open the trophy case." and not the intro
  line. A deliberate choice; the full case is one tap away.
- **Calendar cells are ~43 px wide at 390 px** (seven columns in the gutter).
  Pre-existing; just under the 44 px target.
- **The segment pill briefly veils the Overview label** (about 0.3 s) when
  sliding to History. Cosmetic.
- **A check-in morning or a backfill prompt pushes SOS below the fold.** The
  spec accepted the first; the second is the same cost.
- Commit trailers on two commits name Opus 5.5 rather than Fable 5.1: the
  implementer agents used their own harness's attribution. History is
  truthful either way — Opus wrote that code.

## For the next session

1. **`loadRoot` should run `wellFormed` over a freshly migrated v1 root** and
   fall through to recovery on the first boot, not the second.
2. **Firebase sync + push reminders** (spec due, live by 2026-09-27 — now
   late) · **off-track detection incl. implausibly-low counts** (before the
   first cut, Wed 10/7) · the **post-quit "still free" check-in**.
3. **The coach proxy deploy** (`COACH_PROXY` + a rebuild, together).
4. Making the evening slots follow the sleep setting live is plan logic and its
   own spec; the Settings copy already says the current plan's slots don't move.

## Your first taps after the merge

```bash
cd ~/Projects/pouch-down && git merge --no-ff feat/design-pass && npm test && npm run e2e
```

Then push. Open Settings and look at the six sections; open Stats and tap
History; open Calendar and find today by its date.
