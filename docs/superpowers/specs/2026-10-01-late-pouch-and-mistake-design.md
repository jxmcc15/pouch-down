# Late pouches, mistakes, and today unlocked

**Date:** 2026-10-01 · **Status:** approved by James (all recommendations) ·
**Builds:** this is build 1 of 2. Build 2 (the coach acting on James's behalf)
gets its own spec once this ships; its constraints are recorded at the end so
build 1 leaves room for it.

## Why

On 2026-10-01 James forgot to tap a pouch he had at 4:30 PM, out of boredom. He
asked the in-app coach to add it. The coach correctly said it could not. Then
he found the app could not do it accurately either: a tap now carries the
current time, and Fix this day refuses today ("corrections open tomorrow") and
can only raise a past day's total with no time and no reason. A forgotten pouch
with a time and a reason did not exist as an event.

He also wants to remove a pouch that was tapped by accident. The app's rule is
that nothing logged is ever rewritten and undo of the just-logged event is the
only deletion — a rule that came out of attempt 1, where the record quietly
stopped matching reality. This spec keeps that rule and still gives him the
outcome: the number is right, and the history shows what happened.

## Decisions James made (do not re-ask)

1. A forgotten pouch is logged **timed, with the time he picks**, and it
   behaves like a real tap in every chart. **"Unknown" is an accepted answer**:
   the pouch then counts toward the day, the cap, money and streak, but stays
   out of the timing charts, the same way backfilled pouches do today.
2. **Today is unlocked** for adding a pouch and marking a mistake. It is too hard
   to remember details the next day. The "Actual total" stepper stays
   past-days-only: with a timed add available, a bigger number is the blunt tool.
3. An accidental tap is handled by **Mark as mistake**, an append-only event,
   never a delete. It must be bulletproof: no reader anywhere may still count a
   voided pouch, and nothing that already loads may stop loading.
4. **Undo within the usual window is enough** for a wrong mark. No un-mark.
   Past the window, the fix is adding the pouch again with its original time.
5. A late pouch may land on **any day from plan day 1 through today**, including
   days past quit day (the coming "still free" check-in work must not be
   blocked). Not on pre-plan baseline days.
6. Mark as mistake lives **only inside Fix this day**, one door, where the
   confirm step lives. History and Today's log show the result, they do not
   offer the action.
7. Build order: **the app side first (this spec), the coach second.** The coach
   can only ever do what the app's own write API can do.

## Rules that bind this build

- Append-only: `undoEvent` and `tagEvent` remain the only mutations. Everything
  here appends. A void is a new event; the pouch it names is never touched.
- Silence is never success. A void on the only pouch of a day makes that day
  `nolog` again, not green.
- Read-only past attempts stay read-only: the api already no-ops; the UI hides
  the affordances when `readOnly`.
- Nothing James-specific in code or tests. Synthetic data only.
- Tests run pinned to America/Chicago; bucket by `dayKeyOf`, display by
  `fmtTime`. Never `ev.ts` in the reader's zone.
- Every string that comes out of a backup is escaped before it reaches a vault
  note (`safeText` in `src/ingest.js`).
- A celebrated award never un-earns. The latch in `awards.js` already exists;
  a test proves a void after a celebration leaves the award earned.

## The data model

### A late pouch

An ordinary `pouch` event with three extra fields. Nothing else in the app has
to learn a new type.

```js
// timed
{ id, type: 'pouch', ts: '2026-10-01T21:30:00.000Z', tzOffsetMin: -300, day: '2026-10-01',
  trigger: null, ctx: null, late: true, enteredAt: '2026-10-02T02:05:11.000Z' }

// time unknown
{ id, type: 'pouch', ts: '2026-10-02T02:05:11.000Z', tzOffsetMin: -300, day: '2026-10-01',
  trigger: null, ctx: null, late: true, timeKnown: false, enteredAt: '2026-10-02T02:05:11.000Z' }
```

- `ts` is the instant the pouch happened, in UTC, for a timed pouch. For an
  unknown-time pouch `ts` equals `enteredAt` and `timeKnown: false` says so.
  `day` is always the chosen app day, stamped explicitly, so `dayKeyOf` buckets
  it correctly in every zone.
- `enteredAt` is when the event was written. `isJustLogged` reads
  `ev.enteredAt ?? ev.ts`, so undo and the just-logged window work for a late
  pouch and for a void. `tagEvent` is unchanged (it only completes a live tap).
- `ctx` is `null`. `classifyPouch` already reconstructs a missing ctx at read
  time from the stage plus current settings (`deriveCtx`). That path is reused,
  not duplicated.
- Reasons ride on a separate `reason` event targeting the pouch id, written in
  the same state update when triggers or a note were given. `reasonFor` and
  `triggersFor` need no change.

### A void

```js
{ id, type: 'void', ts, tzOffsetMin, day: '2026-10-01', target: '<pouch id>', trigger: null }
```

`day` is the target pouch's day (so `rawEventsForDay` can show it beside its
pouch if ever needed). A void has no row of its own anywhere.

### The live list — the one rule that makes this bulletproof

`store.js` gains:

```js
// Events that count. A pouch named by a void is dropped; everything else passes.
// Memoized on the events array (a new array per append, like reasonsOf).
export function liveEvents(state)
export function isVoided(state, ev)      // → boolean, for the screens that draw struck rows
export function rawEventsForDay(state, dateStr)   // today's eventsForDay, renamed
export function eventsForDay(state, dateStr)      // now filters liveEvents
```

**Every reader that computes a number walks `liveEvents` or `eventsForDay`.**
The raw list is read only by: `rawEventsForDay` callers that draw struck rows
(`FixDaySheet` pouch list, `HistoryTimeline` day rows, `TodayLog`), `reasonsOf`
(a reason for a voided pouch is harmless and must still index), `LogToast`
(it looks up the just-logged event by id and checks "is last"), and the write
guards in `state.jsx`.

Readers to switch from `state.events` to `liveEvents(state)`:
`disciplineStats`, `firstPouchTimes`, `gapStats`, `hourHistogram`,
`timeSinceLastPouch`, `markdownSummary`'s trigger tally, `checkinForDay` and
`checkinStats` (harmless either way; switch for uniformity), `awards.js`
`eventDays` and `resisted`, `ingest.js`'s trigger tally, `StatsView.jsx`
(trigger tally at ~148, resisted total at ~262), `GapsCard.jsx` `noPouches`,
`awards/AwardUnlock.jsx` (~165). `eventsForDay` callers get the live list for
free: `timedPouchesForDay`, `pouchesForDay`, `isLogged`, `resistedForDay`,
`correctionForDay`, `statusForDay`, `deriveCtx`, `pacingForNow`, awards
`dayFacts`, money, ingest `dayRow`, calendar.

### Untimed pouches and the timing readers

A pouch with `timeKnown === false` counts everywhere a count is taken and is
skipped everywhere a clock is read:

- `classifyPouch` returns `{ bucket: 'untimed', deltaMin: null, preFirstSlot: false }`
  for it. `pouchVerdict` renders it as "time unknown" in the muted color.
- `disciplineStats` adds it to the existing `backfilled` ("no timing") bucket.
- `firstPouchTimes`, `gapStats`, `hourHistogram`, `timeSinceLastPouch`,
  `markdownSummary`'s first-pouch column and `ingest.js` `dayRow`'s first-pouch
  cell skip it.
- `awards.js` `allOnTime` becomes false for the day automatically (an untimed
  pouch is not `'on-time'`), which is correct: an untimed pouch can't be on time.

### Verdict drift, accepted and written down

Each tapped pouch carries a snapshot of its ordinal and slot from log time.
Adding a 4:30 PM pouch between two taps does not renumber the later tap, so on
that day two pouches may read as the same ordinal and one per-pouch verdict can
be off by one slot. Day totals, the cap check, the streak, money and awards are
computed from counts and stay right. This is the same accepted drift the app
already has for pre-stamp events; it is noted in the Fix this day copy ("added
later") and in `CLAUDE.md`, not hidden.

## Write rules (`state.jsx` api)

```js
// → pouch id, or null (refused). Appends a pouch and, when triggers/note were
// given, a reason targeting it — one state update, two events.
logLatePouch({ day, time, triggers = [], note = '' })
//   day   'YYYY-MM-DD' (app day); dayNumberFor ≥ 1; day ≤ todayKey()
//   time  'HH:MM' (24h wall clock in the phone's current zone) or null (= unknown)
//         The 4am rule: 00:00–03:59 on app day D is calendar date D+1 at that time.
//         The instant must not be in the future (Date.now() + CLOCK_SKEW_MS).
//   triggers/note: same validation as logReason (TRIGGERS, NOTE_MAX, dedupe)
//   A past day that is `nolog` becomes logged by this pouch — a remembered
//   pouch is a log. (BackfillPrompt stops offering that day; that is correct.)

// → void id, or null. Refuses unless `id` names a pouch of the active attempt
// that is not already voided. Read-only attempts no-op like every mutation.
voidPouch(id)
```

The guard runs twice, as `logCorrection` and `logReason` do: against the last
rendered attempt for the return value, and again inside the updater against
the queued state.

`isJustLogged(ev, window, now)` in `justLogged.js` uses `ev.enteredAt ?? ev.ts`.
`undoEvent` is otherwise unchanged: the newest event, inside the window. That
covers a late pouch (its reason event, if any, is appended *before* the pouch
in the same update so the pouch is the newest and undo removes only it —
**decision: order the two events reason-then-pouch**; a reason whose target
no longer exists is already harmless) and a void.

`appendChatTurn`, `tagEvent`, settings, attempts: untouched.

## Validation (`root.js`)

No change to `wellFormedEvent`: `late`, `timeKnown` are booleans, `enteredAt`
and `target` are strings, all `renderable`. Tests prove (a) both new shapes
pass, (b) every existing fixture still passes, (c) a void with a non-string
target is still well-formed as stored data (it just never matches a pouch).

## The screens

### `FixDaySheet.jsx`

- The "corrections open tomorrow" line goes. Today's header copy reads: "Today's
  total comes from the log — add one you missed below."
- **Add a pouch** card, shown whenever the sheet opens for a day with plan
  number ≥ 1 and ≤ today (so also on `nolog` days, under the backfill card):
  - a native `<input type="time">` defaulting to the current minute (today) or
    12:00 (past day), 16px font, 44px tall;
  - a toggle chip "I don't remember the time" that disables the time field;
  - the trigger chips and the note field, reused from `ReasonEditor` (extract
    the chip row + note into a small `ReasonFields` component both use);
  - a resolved line above Save: "Wed Oct 1 · 4:30 PM" or "Wed Oct 1 · time
    unknown", and for a future time today, "that's later than now" with Save
    disabled;
  - Save → `api.logLatePouch`; on success the card collapses to "Added · Undo"
    for the undo window (the api decides; the button hides at 12 s like the
    toast), then resets. On `null`: the existing `SaveFailed` line.
- The pouch list reads `rawEventsForDay`. A voided row is struck through
  (`textDecoration: line-through`, muted), ends with "mistake", and does not
  open the editor. A late row carries "added later"; an untimed row shows
  "time unknown" where the clock would be.
- `ReasonEditor` gains **Mark as mistake** (ghost button, left of Cancel). First
  tap turns it into "Mark this pouch as a mistake? It stops counting; it stays in
  your history." with Confirm / Keep it. Confirm → `api.voidPouch(ev.id)`; the
  editor closes and the row shows "Marked · Undo" for the window.
- The "Actual total" stepper keeps its current rule (logged past days only).

### `HistoryTimeline.jsx` and `TodayLog.jsx`

Rows read `rawEventsForDay`. Pouch rows: voided → struck, "mistake"; late →
"added later" segment; untimed → "time unknown" replaces the clock. `void`
events return `null` like `reason`. Day headers (`used/cap`) already read the
live count. The "since last pouch" ticker reads `timeSinceLastPouch`, which
is live and skips untimed pouches.

### `coach.js`

Only the "What you can and can't do" paragraph changes: the path now reads
"tap the day on Calendar, or the pencil beside it in Stats → Fix this day (add a
pouch you missed, with its time or 'unknown'; mark an accidental tap as a
mistake; correct a past total; add reasons)". `coach.test.js` pins the new copy.

### `CLAUDE.md`

Domain rules: add `late`/`timeKnown`/`enteredAt` on pouch events and the `void`
event; add the rule "**Counts come only from `liveEvents`/`eventsForDay`.** Raw
events are for drawing struck rows and for the write guards, nothing else."
Note the accepted verdict drift. Undo and `tagEvent` are still the only
mutations.

## Tests

- **The bulletproof test (`store.test.js`).** Build one synthetic attempt. For
  every exported reader that returns a number or a list — `pouchesForDay`,
  `timedPouchesForDay`, `isLogged`, `statusForDay`, `currentStreak`/`streaks`,
  `disciplineStats`, `firstPouchTimes`, `gapStats`, `hourHistogram`,
  `timeSinceLastPouch`, `markdownSummary`, `pacingForNow`, `moneyStats`,
  `awardsFor`, `calendarMonths`, ingest's `renderLiveLog` — assert that state
  **A** (pouch P logged, then voided) equals state **B** (P never logged), for
  every day in the fixture. A reader that forgets the live list fails here.
- `corrections.test.js` (or a new `latePouch.test.js` in the same harness):
  the `logLatePouch` guard matrix — bad day string, pre-plan day, future day,
  future time today, 4am rule (01:30 on app day D stamps calendar D+1 and
  `dayKeyOf` still returns D), unknown time (`timeKnown: false`, `ts ===
  enteredAt`, `day` chosen), reasons produce a second event ordered before the
  pouch, undo removes only the pouch, read-only attempt refuses. `voidPouch`:
  unknown id, a resisted id, an already-voided id, undo of the void inside the
  window, refusal outside it.
- `justLogged` tests: `enteredAt` wins over `ts`; missing `enteredAt` falls back.
- `awards.test.js`: a celebrated award survives a void that un-derives it; a
  day with an untimed pouch is never `allOnTime`; `day-zero` unaffected.
- `money.test.js`: a void lowers kept money exactly like the pouch never being
  logged; an untimed pouch costs the same as a tap.
- `root.test.js`: new shapes well-formed; all existing fixtures unchanged.
- `ingest.test.js`: Live Log drops a voided pouch from `used`, shows `—` for
  first-pouch on an untimed-only day, and a day whose only pouch is voided reads
  `no log`.
- `coach.test.js`: the new path copy.
- `renderGuards.test.js`: a voided row, a late row, and an untimed row with
  malformed fields (`late: 'yes'`, `enteredAt: {}`) render without throwing.
- **Playwright walk `walk-latepouch.mjs`** on the pinned clock: Day 3, 9 PM.
  Open Fix this day for today from the Calendar; add a 4:30 PM pouch with
  "boredom"; the resolved line reads "4:30 PM"; save; reload (no re-seed);
  History shows the row with "added later" and "boredom", the count rose by one,
  and the Money card dropped by one pouch. Then open the pencil in Stats for
  today, mark a *different* pouch as a mistake, confirm; reload; the count is
  back down, the row is struck with "mistake", the Today ring agrees, and
  storage is byte-identical to the seed except exactly three appended events
  (reason, pouch, void). `run-all.mjs` runs it as the seventh walk.

## Gates (final commit)

`npm test` green · `npm run lint` at the one known warning · `npm run build`
clean then `rm -rf dist/` · `npm run e2e` 7/7 with zero console errors ·
after-screenshots at 390px of Fix this day (today, with the add card open and
with a struck row), History with the three new row kinds, and Today's log —
taken with the e2e harness into the scratchpad, never the repo, read by the
coordinator.

## Build 2 — what this build must not foreclose (recorded, not built)

James wants the coach to be a **full app assistant**: anything the app can log,
the coach can propose. Constraints agreed on 2026-10-01:

- **The coach only ever proposes.** Its reply carries a structured action (tool
  use). The app validates it against a strict allowlist (action names, fields,
  enums, lengths), never evaluates text, shows a card with the exact day, time
  and reason it would write, and James's tap calls the same api methods the
  sheets use. Model output is untrusted input, like a backup file.
- **Never, even with a confirm card:** start or end an attempt, change the plan
  or quit date (slip policy), change the device token or session key, touch the
  recovery path, or edit price and meal times in the first cut.
- **The Worker changes with it:** `guard.js` must learn a `tools` field, array
  message content, tool_result blocks, and a higher `max_tokens`, each clamped
  and tested, shipped in the same change as the prompt.
- **The prompt gets the current local time** so "4:30 today" resolves; the coach
  returns a day and a wall-clock `HH:MM` (or null), never a raw timestamp. The
  app stamps the zone.
- **Saved chats record proposed and confirmed actions**, so the vault shows what
  the coach did.

Build 1 makes all of this cheap: every coach action is one existing api method.
