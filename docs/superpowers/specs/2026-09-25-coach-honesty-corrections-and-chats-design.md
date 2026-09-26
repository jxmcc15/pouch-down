# Coach honesty, day corrections, reasons, and chats that come home

**Date:** 2026-09-25 · **Status:** approved by James 2026-09-25, built unsupervised the same night
**Branch:** `feat/coach-corrections` (worktree off `feat/security-hardening` at `837b337`)

## Why

The in-app coach is a plain chat: system prompt + messages → text. It has no path
to the log, and nothing in its prompt says so. Asked to "fix day 3" or "add a
reason to yesterday's pouches", Claude Haiku agreed and described changes it
could not make. James lost trust in the coach and had no way to do either thing
himself: backfill only fills an *unlogged* day, and the mood tag is a 15-second
window on the most recent pouch.

The trigger: a recent day in the active attempt was under-logged — a few
timed taps, a real total well above them — and the app scored it green.

Three builds, one spec, built in the order 2 → 3 → 1.

## Non-goals

- No tool use for the coach. The app's own buttons are the hands.
- No in-place edits of any event. Every change is a new event.
- No in-app chat history view. The sheet stays "fresh each time".
- No Mac→phone path. Claude reads chats; James makes data changes in the app.
- No new notification channel. The watcher keeps the one it has.
- No model change (the Worker pins Haiku 4.5 and `max_tokens` 400).

## Rules that bind every build

- Append-only: `undoEvent` and `tagEvent` remain the only mutations. Everything
  here appends.
- Silence is never success. A correction never makes an unlogged day logged.
- Read-only past attempts stay read-only: the api already no-ops; the UI hides
  the affordances when `readOnly`.
- Nothing James-specific in code or tests. Synthetic data only.
- Every string that comes out of a backup is escaped (`safeText`) before it
  reaches a vault note.
- Tests run pinned to America/Chicago; bucket by `dayKeyOf`, display by
  `fmtTime`.

---

## Build 2 — Fix this day

### Two new event types

Both are made with `makeEvent(type)` so they carry `id`, `ts`, `day`,
`tzOffsetMin`, then have their fields set. Both pass `wellFormedEvent`; the
`triggers` array is the one new special case (see Validation).

**`correction`** — the real total for a day that *is* logged.

```js
{ id, type: 'correction', ts, tzOffsetMin, day: '2026-09-10', count: 10 }
```

- `day` is the day being corrected (as backfill does), so `eventsForDay(day)`
  finds it. `ts` is when it was entered.
- One or many per day; the latest by `ts` wins (`correctionForDay`).

**`reason`** — why a pouch happened, set any time after it was logged.

```js
{ id, type: 'reason', ts, tzOffsetMin, day: '2026-09-10', target: '<pouch id>', triggers: ['stress', 'coffee'], note: 'late meeting' }
```

- `target` is a pouch event id in the same attempt. `day` is `dayKeyOf(target)`,
  so it buckets with its pouch.
- `triggers` is an array of distinct values from `TRIGGERS`; `note` is a string,
  may be empty, ≤ 140 chars after trim. At least one of the two is non-empty.
- Latest reason per target wins (`reasonFor`). Editing writes a new event with
  the full set — the earlier one stays in history.

### Read rules (store.js)

- `timedPouchesForDay(state, day)`: pouch events + backfill counts (today's
  `pouchesForDay` body).
- `correctionForDay(state, day)` → latest correction event or `null`.
- `pouchesForDay(state, day)` → `max(timed, correction?.count ?? 0)`. `max`, not
  the correction alone: hostile stored data can't lower a real count.
- `isLogged` is unchanged. A correction on an unlogged day (only reachable
  through hostile data) counts nothing and logs nothing.
- `reasonFor(state, ev)` → latest reason event with `target === ev.id`, or `null`.
- `triggersFor(state, ev)` → `reasonFor(...)?.triggers ?? (ev.trigger ? [ev.trigger] : [])`.
  Every place that reads `.trigger` for counting or display uses this instead:
  `markdownSummary` (store.js), `ingest.js` top triggers, `StatsView` trigger
  card, `TodayLog`, `HistoryTimeline`. Resisted events keep working (no reason
  targets them; `triggersFor` falls through to `ev.trigger`).
- `statusForDay`, `streaks`, money, awards, the coach's `liveData` all read
  `pouchesForDay` and change nothing — a corrected 4 → 10 on a cap-10 day stays
  on plan; 4 → 11 turns yellow. A celebrated award never un-earns (existing
  rule).
- `classifyPouch`/`disciplineStats` only see timed pouches. Corrected pouches
  have no times: counted, not scored.
- `markdownSummary` shows the corrected total in `Used` with a trailing `*`, and
  a legend line `* corrected total (timed logs in parentheses)` only when a
  corrected day is in range: `10* (4)`.
- `TRIGGERS` moves from `SOSOverlay.jsx` to `src/triggers.js` (data, not UI);
  `SOSOverlay` and `LogToast` import it from there.

### Write rules (state.jsx api)

`logCorrection({ day, count })` → id or `null`. Valid iff: `day` is
`YYYY-MM-DD` and `< todayKey()`; day number is within `1..plan.totalDays`;
`isLogged(a, day)`; `count` is an integer `>= timedPouchesForDay(a, day)`.
Otherwise a no-op that returns `null`.

`logReason({ target, triggers, note })` → id or `null`. Valid iff: `target` is
the id of a pouch event in the active attempt; `triggers` is an array whose
every member is in `TRIGGERS` (deduped); `note` is a string (trimmed to 140);
`triggers.length > 0 || note !== ''`. The event's `day` is the target's
`dayKeyOf`. Today's pouches are allowed — this is how a missed 15-second tag
gets its reason.

Both append through `onActive`; both are no-ops while read-only or while
storage is unreadable, like every other mutation.

### Validation (root.js)

`wellFormedEvent` gains one clause: a key named `triggers` may be an array
whose members are all strings. Everything else stays renderable-only. Tests
cover: array of strings passes; array with an object fails; `triggers` as an
object fails.

### The sheet — `FixDaySheet.jsx`

Mounted in `App.jsx`'s sheet slot like coach/settings/trophies:
`sheet = { kind: 'fix', day }`. Opened from two places, both hidden when
`readOnly` or when the day is `future`/`pre`:

1. **Calendar** (`CalendarView`): tap a day cell.
2. **History timeline** (`HistoryTimeline` on Stats): tap a day heading.

Layout (Modern Dark Cinema, frosted sheet, Framer springs, `?static` honoured):

- **Header:** `Fix this day` · `Day 3 · Wed, Sep 24` · status pill (on plan /
  over / no log) · cap.
- **Unlogged past day:** the backfill form. The count + keep/break form is
  extracted from `BackfillPrompt` into `BackfillForm` so both use one component
  and one `api.logBackfill` call. `BackfillPrompt` keeps its behaviour and
  copy.
- **Logged day (past):** "Timed logs: 4" · a stepper `Actual total` starting at
  `pouchesForDay` (so an existing correction shows), minimum = timed count,
  with a live verdict line ("10 of 10 — on plan" / "11 of 10 — over, streak
  breaks; tomorrow's cap doesn't change"). `Save` → `api.logCorrection`. When a
  correction already exists: "Corrected 2026-09-25 · was 4".
- **Today:** the stepper is hidden with one line: "Today is still being
  logged — corrections open tomorrow." Pouches below are still tappable.
- **Pouches on the day:** list (time · slot label · verdict · current
  triggers/note), each tappable → inline reason editor: six chips
  (multi-select, `chip`/`selected` styling from `LogToast`), one short text
  input (`maxLength=140`, placeholder "anything else?"), `Save`. Save →
  `api.logReason`; editor closes; list reflects `triggersFor`.
- **Read-only attempt:** never opens (affordances hidden).
- Copy: warm, direct, zero shame ("Filling this in keeps the log honest — it's
  the log that gets you to quit day, not the streak.").

`HistoryTimeline` renders a `correction` event as its own line: `Corrected
total: 10 (4 timed)`; `reason` events don't render as lines — they show on
their pouch through `triggersFor` (plus the note, faint).

### Tests

- `store.test.js`: correction math (none / one / latest-wins / below timed
  ignored), `triggersFor` (no reason → legacy trigger; reason → its set; latest
  reason wins), `markdownSummary` marker + legend.
- `state-guards.test.js` (or a new `corrections.test.js` using the same
  harness): every invalid `logCorrection`/`logReason` input is a no-op
  returning `null`; valid calls append exactly one event with the right shape.
- `root.test.js`: `wellFormedEvent` triggers clause.
- `coach.test.js`: a corrected day reads `10* (4)` in the log the coach sees;
  `Today`/`That day` line uses the corrected count.
- E2E: one new Playwright walk `scripts/e2e/fixday.mjs` in the existing
  harness (pinned clock, seeded once): seed yesterday with 4 pouches; open
  Stats → tap yesterday → correct to 10 → tap a pouch → pick two chips + note →
  Save; reload; assert the corrected total, the chips, and the calendar colour.
  Register it in `run-all.mjs`.

---

## Build 3 — Coach chats come home

### Storage

On the attempt, next to `events`:

```js
attempt.chats = [{ id, startedAt, day, messages: [{ role: 'user' | 'assistant', text, ts }] }]
```

- `startAttempt` creates `chats: []`; `settle` adds `[]` when missing (like the
  celebration lists). Migration of attempt 1 leaves it absent → `settle` fills.
- Not events: nothing in scoring reads them.
- `api.appendChatTurn(chatId, { user, assistant })` → appends both messages
  (each `text` trimmed to 4000 chars) with `ts = now`; creates the chat when
  `chatId` is not found (`id` from `makeEvent`-style id, `startedAt = now`,
  `day = todayKey()`). Only the active attempt. Returns the chat id.
- `CoachSheet` holds `chatId` in a ref (`null` until the first reply). After a
  successful `askCoach`, it calls `appendChatTurn(chatId, { user, assistant })`
  and stores the returned id. Failed requests store nothing (the sheet already
  rolls the optimistic message back). No system prompt is ever stored.

### Validation (root.js)

`wellFormedChat`: object with string `id`, string `startedAt`, string `day`,
array `messages` where every message has `role` in `('user','assistant')`,
string `text`, string `ts`. `wellFormed` accepts an attempt whose `chats` is
absent or an array of well-formed chats; a present non-array or a malformed
chat fails, like a malformed event does. Tests for each branch.

### Backup

`fullBackup` serialises the whole root, so chats ride along with no change.
`backup.test.js` asserts a chat round-trips and that no message text is ever
the key (the existing `sk-ant-` scan in `parseBackup` still applies to the
whole file).

### Ingest (`src/ingest.js` + `scripts/ingest-backup.mjs`)

- `chatsOf(root)` → `[{ attempt, chat }]`, active attempt first, then by
  `createdAt` descending; within an attempt newest chat first. Only chats that
  pass `wellFormedChat` are rendered; the rest are counted in a one-line
  footer ("1 chat couldn't be read").
- `renderCoachChats(root, { exportedAt, now })` → the note. Frontmatter:
  `title: Pouch Down — Coach Chats`, `type: reference`, tags
  `health/cessation`, `project/pouch-down`, `coach-chats`, `aliases`,
  `created`/`updated` (Mac local date), `data_as_of`, `generated_by:
  pouch-ingest`. Body: a one-paragraph header (regenerated every run — edits
  are overwritten; link `[[Pouch Down — Cessation System]]` and
  `[[Pouch Down — Live Log]]`), then per attempt `## Attempt a2 — active`, per
  chat `### Day 4 — Fri Sep 25, 8:12 PM` (day number from the attempt's plan,
  time via the export-pinned formatting already used for the Live Log), then
  messages as `- **You:** …` / `- **Coach:** …`. Every text goes through
  `safeText(text, 2000)`. Chats with zero messages are skipped.
- `ingest()` writes `Coach Chats.md` next to the Live Log from the newest
  backup, only when the rendered text changed, same pattern as the Live Log.
  `result.coachChats = { path, changed, total, fresh }`. `fresh` = ids of
  chats in the newest backup that were not in the previously newest archived
  backup (snapshot `newestArchived` *before* step 2 files anything; zero when
  there was no previous backup or no candidates).
- `summaryLines` gains a fourth line: `Coach chats: 5 (2 new)` — omitted when
  the newest backup has none.
- `ingestedText` (notify-telegram.mjs) appends ` · 2 new coach chats` when
  `fresh > 0`. No new message kind, no new channel.
- Tests in `ingest.test.js`/`notify.test.js`: rendering (escaping of a message
  containing `[[`, backticks and a `|`), skipping malformed chats, fresh-count
  math with and without a previous backup, the summary and notify lines.

### The rule (project `CLAUDE.md`, Related section)

> After `pouch-ingest`, read `Pouch Down/Coach Chats.md`. Any new chat that
> asks for a change or a feature is a request: bring each one to James with a
> proposed next step. Claude cannot change the phone's data — corrections and
> reasons are made in the app (tap the day on Calendar, or the pencil beside it in Stats).

---

## Build 1 — Honest coach

### Prompt

`systemPrompt()` gains a paragraph after the coaching-style paragraph (kept
under 600 characters; "the user", never "your"):

> What you can and can't do: you can talk about the plan and the log; you
> cannot add, change, backfill or tag anything, and you cannot see or change
> settings. If the user asks for a change, say plainly that you can't make it
> and point to the path in the app: tap the day on Calendar, or the pencil
> beside it in Stats → Fix this day (correct a total, add reasons to a pouch). This conversation is saved
> with the user's data and reviewed later, so for anything the app can't do
> yet, ask for the specifics a reviewer needs — which day, what count, which
> pouch — and confirm you've noted it. Never claim a change was made.

### Tests (`coach.test.js`)

- The prompt contains `cannot add, change, backfill or tag` and `Never claim a
  change was made`; still no `\byour\b`.
- Size guard: an attempt with 7 fully logged days (10 pouches each with
  triggers, a correction, a reason) produces a `system` string under 8 KB, so
  the Worker's 16 KB body cap leaves room for the messages.

### Sheet copy

The tagline `knows your plan & your log` becomes `knows your plan & your log ·
can't change them`. No other `CoachSheet` copy changes (the proxy session owns
the new no-token/no-key states).

---

## Order, gates, and hand-back

1. Build 2 (data layer → api → sheet → e2e), 2. Build 3 (storage → ingest →
   docs), 3. Build 1 (prompt + tagline).
2. Gates before the branch is handed to James: `npm test` green, `npm run
   lint` at baseline, `npm run build` clean, `npm run e2e` all walks green with
   zero console errors, `pouch-ingest --dry-run` from the worktree against a
   synthetic `POUCH_BACKUP_DIR` renders both notes.
3. Never push. `main` auto-deploys to the phone. The branch is left for James
   with a morning report (`docs/superpowers/reports/`), and the day-3 fix is
   his first tap after he pulls the build.
