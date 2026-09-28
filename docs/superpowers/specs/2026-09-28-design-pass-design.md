# Design pass — Settings, Stats, Calendar, Today (+ three deferred fixes)

**Session E** · branch `feat/design-pass` (worktree `~/Projects/pouch-down-design`,
off `main` at `fa0f9ce`) · decided with James on 2026-09-28 through the
brainstorming visual companion (mockups in `.superpowers/brainstorm/`).

This is a design pass. No domain rule changes: events stay append-only, silence
is never success, nothing James-specific enters the repo, the key is never at
rest, the CSP stays build-only, days run 4am→4am. Modern Dark Cinema stays, no
new dependencies, 390px first, 44px targets, `reducedMotion="user"` and
`?static` respected.

## Decisions James made (with the option he chose)

| Question | Choice | Why |
|---|---|---|
| Stats: where does History live? | **Segment control inside Stats** (Overview / History) | Nav stays at four; History is one tap from the charts and vice versa; nothing new at the bottom of the screen. |
| Settings: one sheet or a hub? | **Hybrid** — inline for Routine, Money, Your data, About; **sub-sheets for Coach and Attempt** | Meals and price are touched often (one tap); the coach connection and past attempts are rare, and the end-attempt danger zone belongs behind its own door. |
| Calendar dates | **Month sections** — a header per month, date large in the cell, plan-day range in the header | James thinks "Thursday, Sep 24", not "day 3". Month edges become obvious. |
| Wake and sleep in Settings | **Add the fields, labelled honestly** | Meals are live; sleep is read once when a plan is built; wake by nothing yet. The helper text says exactly that, and setup's copy is corrected to match. |
| SOS on Today | **Move the button up, directly under the ring** | Inside the fold on a normal day, no floating layer. Accepted cost: a check-in morning pushes it below the fold. |
| Telegram notifier | **Self-contained env file for a notify-only bot** | The notifier reads the chat id from the same file, so nothing else lives beside it. James makes the bot and the file; Claude never touches the plist or a token. |

## 1 · Settings (`src/components/SettingsSheet.jsx` + two new sub-sheets)

**Main sheet, top to bottom.** Section headers are `.tiny` in the accent
colour with a hairline under them (the trophy case's tier-header pattern).

- **Routine** — meal grid as today (2 columns), then a wake / sleep row (the
  same time inputs setup uses). Helper under the meals is unchanged. Helper
  under wake/sleep: *"Used when a plan is built — sleep sets where the evening
  pouches land, and your next attempt starts from these. Your current plan's
  slots don't move."* Both write through `api.updateSettings` like the meals.
- **Money** — cost per tin, pouches per tin, "Not sure? Work it out". Unchanged.
- **Coach** — one row (a 52px button, chevron on the right) whose title is the
  status and whose subtitle is the one action that fixes it:
  - `proxy` → "Connected via your proxy" / "nothing to enter next time"
  - `key` → "Key held for this session" / "cleared when the tab closes"
  - `none` → "Not connected" / "add a key, or a device token if you run a proxy"
  Status is a pure function `coachStatus({ proxyOn, hasToken, hasKey })` in
  `src/proxyConfig.js` (tested) so the sheet and the row can never disagree.
  The row opens **CoachConnectSheet**: the existing device-token block (only
  when a proxy is configured) and the existing API-key block, verbatim — same
  ids, names, labels, `type="password"`, helper copy, disabled in the viewer.
  The coach's own "Open Settings" button opens Settings *with this sub-sheet
  already open* (`openSettings('coach')`).
- **Attempt** — one row: live: "Attempt 2 · day 4 of 90" / "1 past attempt";
  viewer: "Viewing Attempt 1 · read-only" / "exit at the top to get back". It
  opens **AttemptsSheet**: a summary card for the current attempt (dates,
  stage, days logged of days so far), the past-attempts list (the same
  `Attempt N` buttons, same markup), and — live only — a **Danger zone** at the
  bottom: red header, red-bordered "End this attempt and start over", the
  existing confirm card with "End attempt" / "Keep going". Never one tap.
- **Your data** — "Download full backup" (primary, `.btn`), "Copy full log as
  Markdown" (ghost), and a line under them: *"Last backup from this phone: Sep
  25"* or *"No backup from this phone yet."* The date is a device preference
  (`src/lastBackup.js`, its own localStorage key, mirrors the device-token
  pattern: get / set / subscribe; set only after a share or copy succeeds).
  It is not part of the root, so no backup or dump changes.
- **About** — one muted line: `build <short sha>` (a Vite `define` filled from
  `git rev-parse --short HEAD` at build time, `dev` otherwise) and the privacy
  sentence that today sits under the title: "Your log stays on this phone
  unless you ask the coach." The title loses the sentence.
- **Done** stays at the bottom.

**Sub-sheets** mount inside SettingsSheet the way `TrophyDetailSheet` mounts
inside the case: backdrop z 52, sheet z 53, spring in from the bottom, their
own Done, Escape closes the top-most one. Nothing in either persists a key.

## 2 · Stats (`src/components/StatsView.jsx`, `awards/TrophyCase.jsx`)

- Under "The story so far", a **segment control** (`role="tablist"`, two
  `role="tab"` buttons, `aria-selected`, the pill slides with a `layoutId`):
  **Overview** (default) and **History**.
- **Overview**, in this order, grouped under `.tiny` accent section headers:
  1. Daily nicotine chart card + the two number tiles (projection / logged
     days, pouches not used). Unchanged.
  2. **TrophyStrip** (new export in `TrophyCase.jsx`): one card, header
     "Trophy case · 2 of 27 ›", then a single row of seals — every earned award
     (newest first) followed by the next-closest locked ones until six seals
     are showing, then "+N more" — and the existing intro line. The whole card
     is a button that opens the existing `TrophyCaseSheet` through
     `openTrophies` (already threaded from `App.jsx`). The inline full case
     leaves Stats.
  3. **Timing** — DisciplineCard, FirstPouchChart, RhythmChart, GapsCard.
  4. **Body** — CorrelationCard.
  5. **Triggers** — the trigger bars card.
  The Money card leaves Stats (it lives on Today; the projection tile is not
  the money card).
- **History** — `HistoryTimeline`, unchanged in behaviour. Row text gains the
  weekday: "Day 4 · Thu Sep 25 · 8/10" (still starts with `Day N`, still ends
  with the count, so the walks' anchors hold).

## 3 · Calendar (`src/components/CalendarView.jsx`, `src/calendarMonths.js`)

- `monthsFor(state)` (pure, tested): the plan's days grouped by calendar
  month → `[{ label: 'September', dayRange: [1, 9], cells: [...] }]`, each
  month with its own leading blanks. Cells carry `n`, `d`, `status`, `used`,
  `cap`, `dom` (day of month), and two flags from the log: `corrected`
  (`correctionForDay` non-null) and `backfilled` (a backfill event that day).
- Each month renders a header row (**September** left, *days 1–9* right), the
  S–S weekday row, and its grid. Cell content: the **day of month** large (the
  star still replaces it on quit day), the count line beneath exactly as now
  (`8/10`, `no log`, or the cap for future days). A corrected day shows a tiny
  pencil in the top-right corner; a backfilled day a tiny rotate-ccw icon.
  Both glyphs are also spoken: the aria-label becomes
  `Day 4, Sep 25: 8 of 10 pouches, corrected`.
- Classes, tap target, the `onFixDay` door, the walks' `[aria-label^="Day "]`
  contract, and the text `used/cap` all stay.
- Legend gains "✎ corrected" and "↺ backfilled".

## 4 · Today (`src/components/TodayView.jsx`)

The SOS button moves from under the Money card to directly under the log ring,
before the pacing card. Same element, same label, same colours. Nothing else.

## 5 · Deferred fixes (each its own commit, each with tests)

1. **`String()` guards.** `TodayLog`, `HistoryTimeline`, `PlanView` wrap
   every stored value they print (slot labels, triggers, notes, stage names,
   taglines) so an object or array in storage renders as text instead of
   throwing "Objects are not valid as a React child". Tests render each
   component with `react-dom/server`'s `renderToString` (no new dependency)
   against hostile fixtures.
2. **`migrate.js` fills `DEFAULT_SETTINGS` gaps.** `settings` becomes
   `{ ...DEFAULT_SETTINGS, ...v1.settings, mealTimes: { ...DEFAULT_SETTINGS.mealTimes, ...v1.settings.mealTimes } }`
   with `apiKey` still stripped. Only *missing* keys are filled; a present
   value is never replaced. The golden migration test and a new "v1 without
   sleep/wake / without a meal" test pin it. A separate reviewer agent reads
   the diff before it is committed, per the brief.
3. **Notify-only Telegram bot.** `telegramConfig` reads `TELEGRAM_CHAT_ID`
   from the env file when `POUCH_TELEGRAM_CHAT` is unset, before falling back
   to `access.json`. Tests in `notify.test.js`. The build log carries the
   recipe James runs himself (BotFather → message the bot → chat id → write
   `~/.config/pouch-ingest/telegram.env` → one `POUCH_TELEGRAM_ENV` line in
   the plist → reload). Until then nothing changes.

## Files

| File | Change |
|---|---|
| `src/components/SettingsSheet.jsx` | Rebuilt as the grouped sheet above; hosts the two sub-sheets |
| `src/components/settings/CoachConnectSheet.jsx` | new — the token + key blocks moved here |
| `src/components/settings/AttemptsSheet.jsx` | new — current summary, past list, danger zone |
| `src/lastBackup.js` | new — last-backup-date preference |
| `src/proxyConfig.js` | `coachStatus()` pure helper |
| `src/components/StatsView.jsx` | segment control, sections, TrophyStrip, Money card removed |
| `src/components/awards/TrophyCase.jsx` | `TrophyStrip` export; the inline `TrophyCase` card is no longer used by Stats (kept exported) |
| `src/components/HistoryTimeline.jsx` | weekday in the row; `String()` guards |
| `src/calendarMonths.js` | new — `monthsFor(state)` |
| `src/components/CalendarView.jsx` | month sections, dates, marks, legend |
| `src/components/TodayView.jsx` | SOS moved under the ring |
| `src/components/TodayLog.jsx`, `PlanView.jsx` | `String()` guards |
| `src/components/CoachSheet.jsx` | "Open Settings" → `openSettings('coach')` |
| `src/components/onboarding/steps.jsx` | setup helper copy: "you can change meal times later in Settings; sleep is used when a plan is built" |
| `src/App.jsx` | `openSettings(sub)` carries the sub-sheet to open |
| `src/migrate.js` | fill `DEFAULT_SETTINGS` gaps |
| `scripts/notify-telegram.mjs` | chat id from the env file |
| `src/index.css` | section header, segment control, settings row, danger zone, calendar month header, cell marks |
| `vite.config.js` | `define: { __BUILD__ }` |
| `.gitignore` | `.superpowers/` |
| `src/__tests__/…` | `calendarMonths`, `coachStatus`, `trophyStrip`, `renderGuards`, migrate additions, notify additions |
| `scripts/e2e/walk-awards.mjs` | the Stats check becomes: strip card present with "N of M", tapping it opens the case sheet, tier sections checked *in the sheet* |
| `scripts/e2e/walk-migration.mjs` | Stats: click the History segment before the History checks; Settings: open the Coach row before checking the key field is disabled |
| `scripts/e2e/walk-fixday.mjs` | click the History segment before the pencil |
| `scripts/e2e/walk-backfill.mjs` | open the Attempt row before choosing Attempt 1 |
| `docs/superpowers/reports/2026-09-28-design-pass-build-log.md` | the report |

Each walk edit is in the same commit as the UI change that needs it, with the
reason in the message.

## Testing and gates

`npm test` green · lint at the one baseline warning · `npm run build` clean and
`dist/` deleted after · `npm run e2e` 6/6 with zero console errors · before
and after screenshots of Today, Calendar, Stats (both segments), Settings (and
both sub-sheets) at 390px, read by Claude, kept outside the repo.

## Out of scope, on purpose

Making the evening slots follow the sleep setting live (plan logic — its own
spec), the coach proxy deploy, Firebase sync, off-track detection, the
post-quit check-in, and any in-app view of past chats.
