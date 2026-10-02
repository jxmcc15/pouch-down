# Build log — late pouches, mistakes, and today unlocked

**Session G, 2026-10-01** · branch `feat/late-pouch` (worktree
`~/Projects/pouch-down-late`, off `main` at `b89f29a`) · **nothing pushed** ·
spec: `docs/superpowers/specs/2026-10-01-late-pouch-and-mistake-design.md` ·
plan: `docs/superpowers/plans/2026-10-01-late-pouch-and-mistake-plan.md`

On the afternoon of the 1st you had a pouch at 4:30 PM out of boredom and
forgot to tap it. The coach couldn't add it, and neither could the app: a tap
carries the current time, and Fix this day refused today. This night built the
seven things you decided that evening. No domain rule moved: events are still
append-only, a silent day is still gray, undo and the mood tag are still the
only mutations, and days still run 4am→4am. The sheet just learned two more
kinds of truth to append.

## What you will see when you pull the build

**Fix this day opens for today.** The "corrections open tomorrow" line is gone.
Today's header reads *"Today's total comes from the log — add one you missed
below."* The Actual-total stepper still waits for tomorrow (it is the blunt
tool; with a timed add available there is no reason to reach for it today).

**Add a pouch.** A card with a plus: *Add a pouch · one you missed, with its
time.* Tap it and it grows (the same spring the reason editor uses) into the
phone's native time wheel — defaulting to the current minute today, noon on a
past day — a chip for *I don't remember the time*, the same reason chips and
note you already know, and a line that says exactly what will be written:
*"Thu, Sep 24 · 4:30 PM"*. Pick a time that hasn't happened yet and the line
says *"— that's later than now"* and Save stays off. Pick 1:30 AM and it adds
*"counts toward Sep 24 (days run to 4 AM)"*, because that is where the pouch
goes. Save, and the card collapses to **Added · Undo** for twelve seconds.

**Mark as mistake.** Tap any pouch row, and above Cancel / Save reasons there
is now *Mark as mistake*. It asks once — *"Mark this pouch as a mistake? It
stops counting; it stays in your history."* — then *Keep it* or *Confirm*.
Confirm, and the row is struck through, muted, ending in *mistake*, with
**Marked · Undo** beside it for twelve seconds. The pouch is still there. It
just doesn't count.

**History and Today's log** draw the same three facts: a struck row that ends
in *mistake*, a faint *added later* on a remembered pouch, and *time unknown*
where the clock would be. The day header's `3/8` is the live count; the
struck row is history.

**The coach** now names the real path: *tap the day on Calendar, or the pencil
beside it in Stats → Fix this day (add a pouch you missed, with its time or
'unknown'; mark an accidental tap as a mistake; correct a past total; add
reasons).* It still cannot do any of it itself. That is Build 2.

## What changed underneath, and why

### One live list (`src/liveEvents.js`)

Before this night every reader walked `state.events`. Making a mistake "stop
counting" by adding an `if (voided) continue` to each of them would have
meant seventeen places to get right and seventeen places for the next feature
to forget. Instead there is one function, `liveEvents(state)`, that returns
the events that count — every event except a pouch named by a `void` — and
`eventsForDay` filters it. Every reader that computes a number now walks one
of those two. The raw list survives in exactly four places, each for a reason
the comment states: `rawEventsForDay` (the screens that draw a struck row),
`reasonsOf` (a reason for a voided pouch must still index), `LogToast` (it
looks up the just-logged event by id), and the write guards in `state.jsx`
(a void must find the pouch it names, voided or not).

The list is **memoized on the events array**: every append makes a new array,
so the cache clears exactly when it should and never otherwise. A screen with
sixty day rows filters once.

### The equivalence test (`src/__tests__/liveEvents.test.js`)

This is the feature's safety, and the thing worth learning from. It builds a
synthetic week — eight pouches on day 1, ten (over cap) on day 2 with varied
hours and triggers, a reasoned pouch on day 3, a check-in and seven pouches on
day 4, two on day 5 — and for *every* pouch P asserts that state A (P logged,
then voided) reads **byte-identical** to state B (P never logged) through
twenty-two readers: per-day counts and statuses, streaks, discipline, first
pouch times, gaps, the hour histogram, pacing, correlations, missed days, the
markdown export, money, awards, the calendar months, and the vault's Live Log.
A reader that forgets the live list fails here, by name. Both the implementer
and the reviewer then **mutation-tested** it: they put each switched reader
back to the raw list one at a time, and the test caught every reader that
could differ (eventsForDay, disciplineStats, gapStats, hourHistogram, the two
trigger tallies, firstPouchTimes, timeSinceLastPouch). The three it could not
catch — `correlationStats`, awards' `eventDays` and `resisted` — only ever
read check-ins and resisted logs, which a void never touches; they were
switched for uniformity.

### A late pouch is an ordinary pouch (`src/latePouch.js`, `state.jsx`)

Nothing in the app learned a new pouch type. A remembered pouch is a `pouch`
event with three extra fields: `late: true`, `enteredAt` (when it was
written), and, when you didn't remember, `timeKnown: false`. Its `ts` is the
instant it happened; its `day` is stamped explicitly so it buckets correctly
in every zone.

**The 4am rule meeting a time picker** is the subtle part. You pick "1:30 AM"
on app day Sep 24. That instant is on calendar date Sep 25, because the day
runs to 4 AM. `lateInstant(day, time)` builds the instant in the phone's
current zone — the clock you are reading when you pick the time — adds a
calendar day when the hour is before the cutoff, and stamps `tzOffsetMin`
from that instant. The reviewer checked every minute of six days around the
two DST changes: `dayKeyAt(ms, tzOffsetMin)` equals the chosen day in every
case. The one oddity is the non-existent 2:00–2:59 AM on the spring-forward
night, which stores as 3:xx — right day, display one hour off. Both the api
and the sheet call the same `resolveLate`, so "later than now" means the same
thing on screen and in the guard.

**An untimed pouch counts everywhere and is clocked nowhere.** `classifyPouch`
gives it a bucket of its own, `'untimed'`, so every timing reader —
discipline, first-pouch times, gaps, the hour histogram, the "since last
pouch" ticker, the export's First column — skips it, while every count keeps
it. "On the clock" can't be earned on such a day, which is right: an untimed
pouch can't be on time.

**Reason before pouch.** When you give a remembered pouch its reason, two
events land in one state update: the reason first, then the pouch. So the
pouch is the newest event, and undo — which only ever removes the newest —
takes the pouch alone. The orphaned reason is harmless; nothing looks it up.

**`isJustLogged` reads `enteredAt ?? ts`.** A pouch from 4:30 PM written at
9 PM is "just logged" at 9 PM. That one line is what makes undo work for a
late pouch. It also opened a door the reviewer caught: `tagEvent` could have
stamped a mood tag on a late pouch within fifteen seconds. It now refuses a
late pouch — its reasons ride on its reason event.

### A void never touches the pouch

`voidPouch(id)` appends `{ type: 'void', target: id, day: <the pouch's day> }`
and nothing else. The guard refuses an unknown id, a resisted event, a pouch
already voided, and anything while read-only. It runs twice — once against
the last-rendered attempt for the return value, once inside the updater
against the queued state — exactly as corrections and reasons do, and a test
calls it twice in one tick to prove only one void is written. A void on the
only pouch of a day makes the day `nolog` again. Gray, not green. Silence is
never success, even silence you made on purpose.

### The screens

`FixDaySheet.jsx` grew an `AddPouchCard` and a confirm step in `ReasonEditor`;
the chip row and note moved into `ReasonFields.jsx` so the two can never
drift. The pouch list reads raw events, asks `pouchFlags(state, ev)` for the
three facts, and draws them. `HistoryTimeline` and `TodayLog` do the same.
`TodayLog` also dropped its private copy of the verdict helper for the shared
`pouchVerdict.js` (the copy printed "NaNm early" on a null delta; the shared
one doesn't).

## Decisions I made alone (the spec was silent or the code disagreed)

1. **`AwardUnlock.jsx` stays on the raw list.** The spec listed it among the
   readers to switch. It reads the *newest* event to wait out the undo window
   before an unlock overlay can cover the undo chip — and after a mark, the
   newest event is the void. It now also waits for a void (`UNDOABLE` gained
   `'void'`), because a void can newly earn an award (a yellow day turning
   green) while **Marked · Undo** is still on screen.
2. **The live list is its own module.** `store.js` was 612 lines; it is 623,
   the extra being the re-export, `rawEventsForDay`, and the comment that says
   a count must never come from it.
3. **`pouchFlags` is the one place the three row facts are read**, with strict
   booleans: `late: 'yes'` is not late, `timeKnown: 0` is not untimed. The
   hostile-data test renders both.
4. **The Add card is collapsed by default**, a 48px row with a plus. Open, it
   is the whole form. On a hard night the sheet still fits on one screen.
5. **"Counts toward Sep 24 (days run to 4 AM)"** appears only for 00:00–03:59.
   A small true sentence beats a surprise tomorrow.
6. **Mark as mistake sits on its own row** above Cancel / Save reasons. Three
   buttons do not fit in 310px at a 44px height; the implementer measured.
7. **Struck text is muted, not faint.** `--fg-faint` is 2.8:1 on the card and a
   13px line-through is hard to read. The strike and the word *mistake* carry
   the meaning; the text stays readable; only the dot and the tag are faint.
   Never red.
8. **An untimed row shows "time unknown" once**, as the clock, and skips the
   verdict segment that would have repeated it.
9. **Undo chips hide when the event is no longer the newest**, matching the
   toast: `undoEvent` would do nothing, so the chip must not promise it.
10. **A time that doesn't exist is refused, not shifted.** On the spring-forward
    night `new Date` turns 2:30 AM into 3:30. `lateInstant` now notices the
    hour moved and returns null; the sheet says *"that time didn’t exist —
    clocks went forward"*. A wrong hour on the right day was Sol's finding; a
    refusal is more honest than a silent shift.
11. **The plan's day regex accepted `2026-09-31`.** `Date` rolls that into
    October silently. The implementer added `isCalendarDay`; a remembered pouch
    can no longer land on a day that does not exist. My plan had this hole.

## What each reviewer caught

Every task had its own fresh-context Opus reviewer who saw only that diff.

- **Task 1 (live list):** approved. Noted that the component-level switches
  (StatsView, GapsCard) sit outside the equivalence test, and that a hostile
  void carrying a `trigger` would reach the trigger tally (the api writes
  `null`). Both noted, neither changed.
- **Task 2 (enteredAt, untimed):** approved. Asked for a `disciplineStats.today`
  proof and a `pouchVerdict` pin — both landed in later tasks. Confirmed the
  untimed pouch's effect on `deriveCtx` ordering is the drift the spec accepts.
- **Task 3 (api):** approved; the `tagEvent` hole above, fixed; a same-tick
  double-void test, added; one `DAY_RE` instead of two.
- **Task 4 (pins):** approved after mutation-testing every pin on a scratch
  copy. Asked for the missing day-zero case (a quit day whose only tap is
  voided must not earn it) and for the whole coach sentence to be pinned. Both
  done. The implementer had already rewritten the plan's day-zero test, which
  could not have failed.
- **Task 5 (sheet):** changes required — `role="listitem"` without a
  `role="list"` parent is invalid ARIA. Fixed: the rows sit in a list, every
  row is an item, the "marked as a mistake" label rides on the item. Reason
  chips were 36px tall (a pre-existing override, now in two places): 44.
- **Task 6 (rows):** approved; the contrast decision above.
- **Task 7 (walk):** no app bugs. The walk author flagged that the remembered
  4:30 PM pouch reads *on time +225m*, then *+315m* after the mark. That label
  means "held past the slot"; the slot it is measured against comes from
  `deriveCtx`, which numbers ctx-less pouches by time of day, so voiding an
  earlier pouch moves it down a slot. Honest by the app's definition, and the
  drift the spec accepts — but see "for you to decide" below.

### Outside reviews

Both outside models saw curated text only — the diff (grepped for `@` and your
name first: no hits), the spec's screens section, the final sheet source, and
the screenshots *described in words*. Never a vault file, never a backup,
never a PNG. A fresh agent ran each call and verified every claim against the
code before I read it.

**Sol (GPT-5.6, one `ask-chatgpt` call, the whole diff minus docs):** seven
findings, five accepted, two rejected.

- *Accepted, Important:* two quick taps on **Save pouch** could write two
  pouches. The card's closing animation keeps the button mounted for a beat,
  and `latePouchOk` has no duplicate check. Fixed with a once-per-open guard
  (commit `2230d49`).
- *Accepted, Minor:* a time that does not exist on the spring-forward night
  (1:30 AM is fine; 2:30 AM on 2026-03-08 is not) was stored as 3:30. Now
  refused, with the line *"that time didn’t exist — clocks went forward"*, and
  a DST test.
- *Accepted, Minor (walk):* an unexpected award overlay after Save or Confirm
  is now a failed check, not a note; and the walk checks the streak chip after
  the mark.
- *Rejected:* that `voidPouch` / `logLatePouch` could report success for a
  write the updater refused. Only two calls inside one tick can split the two
  guards, no UI does that, and undo on a missing id is a no-op — the same
  known lag `logCorrection` has had since September.

**Gemini (one `ask-gemini` call, no search):** ten findings, two accepted.

- *Accepted, wording:* **on time +315m** in green on a remembered 4:30 PM
  pouch. The number is honest (minutes past the slot, and waiting longer is
  the goal), but it now reads **+5h 15m**.
- *Accepted as a trust question, not changed:* marking past pouches as
  mistakes can turn a yellow day green, rebuild a streak and earn an award,
  because `voidable` has no age limit. Your decisions 3 and 5 allow exactly
  this; the tool trusts you the way backfill does. Gemini's proposals (a
  "N marked as mistakes" count on the day header, or an age limit) are in
  "for you to decide".
- *Rejected, verified:* the Add row not reading as primary (it is the first
  full-width card); chips under 44px (`.chip` sets 44); "mistake" as shaming
  (your word, decision 3); an untimed pouch letting a correction go below the
  real count (`timedPouchesForDay` counts untimed pouches); one added pouch
  turning a no-log day green (an explicit log, the same trust as backfill);
  the 4am rule misfiling 2:30 AM (you pick the app day; the line says where
  it counts); the confirm being bypassable (`voidPouch` is only called behind
  it; a coach would need its own confirm card — noted for Build 2).

## Gates, all on the final code commit `2230d49`

One commit follows it, `e907d0f`, which changes a single comment line (the
reviewer of the fix commit caught it); `npm test` and `npm run lint` were
re-run on it with the same result.

| Gate | Result |
|---|---|
| `npm test` | **699 passed, 4 skipped** (32 files; baseline 607 / 4) |
| `npm run lint` | 1 warning, the pre-existing one, now at `src/state.jsx:280` |
| `npm run build` then `rm -rf dist/` | clean; `dist/` removed |
| `npm run e2e` | **7/7 walks, 1,140 checks, 0 failures, 0 console errors** in 196 s (migration 190 · setup 157 · backfill 192 · awards 95 · recovery 381 · fixday 53 · **latepouch 72**); fixday, backfill and awards pass unchanged |
| After-screenshots at 390px | Fix this day for today with the Add card open · a struck row with Marked · Undo · History with the three row kinds · Today's log and the Money card — taken by the walk into the session scratchpad, never the repo, synthetic data only, read by me |

## For you to decide, not tonight

- **The "+315m" on a remembered pouch.** A late pouch gets a slot by its order
  in the day, and "on time +Nm" is measured from that slot. It is true, but on
  a 4:30 PM pouch it reads odd. Options: late pouches show plain *on time* /
  *early* with no minutes, or no verdict at all beyond *added later*. Your call;
  it is a one-line change in `pouchVerdict.js`.
- **Should a mistake have an age limit, or should a day say how many?**
  Today you can mark any pouch of the attempt, and a struck row only shows
  when the day is expanded. A small "1 marked" beside a day's `3/8` in
  History and on the Calendar cell would make the trust visible. One sentence
  from you decides it.
- **Reason chips are now 44px tall** on the sheet. The toast and SOS chips are
  still 36px. If the taller chips feel right, the others could follow.
- The editor closes instantly when a row becomes struck (no exit spring), and
  the resolved line re-announces to a screen reader on every time edit. Both
  cosmetic.

## For Build 2 (the coach acting)

Build 1 made every coach action one existing api method. What Build 2 needs:

1. `logLatePouch({ day, time, triggers, note })` and `voidPouch(id)` are the
   only two new verbs; both return `null` when refused, so a confirm card can
   say "that didn't save" honestly.
2. The coach must return an app day and a wall-clock `HH:MM` (or `null`),
   never an instant; the app calls `resolveLate` and stamps the zone. Give
   the prompt the current local time and the app day so "4:30 today" resolves.
3. A proposed void must name a pouch **id** the app showed the coach; the
   allowlist validator should reject any id not in the live attempt.
4. The Worker's `guard.js` must learn `tools`, array content, `tool_result`
   blocks and a higher `max_tokens`, clamped and tested, in the same change
   as the prompt.
5. `tagEvent` now refuses late pouches; the coach never needs it.
6. Saved chats should record proposed and confirmed actions, so the vault
   shows what the coach did.

## How the night ran

Eighteen agent runs: eight implementers (four of them called back for
review fixes), eight stage reviewers, two outside-review runners. Every brief
was curated — the task's plan lines, the files it owned, the rules that
applied, its own 300k ceiling — and no agent inherited this session's context.
Tasks 1 → 2 ran in sequence (everything depends on the live list); 3 and 4 ran
as two parallel implementers on disjoint files, then 5 and 6 the same way,
each staging only its own files by path; the walk ran last. Every review
finding was fixed before its lane's next task started. One plan mistake
(`2026-09-31`) was caught by an implementer, and two plan tests that could not
have failed were rewritten by implementers before any reviewer saw them.

Coordinator context stayed near 210k tokens; subagents used roughly 1.7M
between them.

## Your first taps after the merge

```bash
cd ~/Projects/pouch-down && git merge --no-ff feat/late-pouch && npm test && npm run e2e
```

Then push. Open Calendar, tap today, and add the pouch you forgot on the 1st
with its time and *boredom*. Then open Stats → History and look at the row.
