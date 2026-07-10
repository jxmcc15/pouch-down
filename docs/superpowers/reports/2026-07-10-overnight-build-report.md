# Overnight Build Report — Stats Expansion

**Built:** overnight July 9→10, 2026, on branch `feat/stats-expansion`, merged to local `main`.
**Status: ✅ complete and verified. Nothing pushed — your phone's app is untouched until you deploy.**

---

## What you'll see when you open the app

**Today tab** (new, top to bottom):
- A **morning check-in card** — five sleep dots, a "worked out" chip, an optional
  exact-numbers expander. Saves one `checkin` event; dismissable per day.
- The post-log toast is now a **verdict toast**: "Logged 9:42 AM · held out 23 min
  past the slot. That's the muscle." — with undo and six one-tap mood chips
  (same six triggers as SOS, tappable for 12 seconds after logging).
- A **Today's log card** — every event today with time · slot · verdict, plus a
  live "2h 14m since last pouch" ticker counting up every second.

**Stats tab** (six new sections between the money row and your triggers):
- **Slot discipline** — on-time / early / over-cap counts (today + all-time),
  average minutes held past unlock, average minutes early.
- **First pouch of the day** — one dot per day; the line climbing toward the
  dashed 12:30 line *is* your Stage 6 readiness forming.
- **Your rhythm** — 24-hour histogram, indigo = on-time, amber = early/over.
- **Space between pouches** — live current gap (the centerpiece), today vs
  7-day averages, longest ever ("incl. sleep" — honestly labeled).
- **Sleep, training & usage** — locked until 5 morning check-ins, then average
  pouches/day by sleep band and workout vs rest. Footnote on every render:
  small sample, correlation ≠ causation.
- **History** — every plan day, newest first, today expanded, full event rows.

**Settings** — a new "Apple Watch / Health import" section with the honest
HealthKit line, the Shortcut recipe, a copyable URL template, and a
"Simulate import" link that exercises the real parser.

**Coach & export** — the markdown log now carries Early/Over/First columns plus
discipline, longest-gap, and check-in footers, so the coach sees your pacing
truthfully; its prompt got one sentence telling it these buckets are honest
data, never shame material.

---

## The concepts this build runs on (the teaching section)

### 1. Event sourcing: the log is the truth, everything else is a recording of it

Your app never stores "5 on-time pouches today" anywhere. It stores the raw
events — `{ts, type: 'pouch'}` — and every number on every card is a **pure
function** run over that list at render time (`disciplineStats(state)`,
`gapStats(state)`, …). This is why **undo is trivial**: deleting one event and
re-running the functions makes every stat, chart, and streak correct again for
free. No cleanup code, no cache invalidation, no way for a stat to drift out
of sync with history. The trade-off is compute — we re-derive on every render —
but at your data size (a few hundred events over 60 days) that's microseconds.

### 2. Snapshot vs derive — the hybrid we chose, and why

The verdict "23 min past the slot" depends on *what the slot time was when you
tapped*. Slot times come from your meal-time settings — which you can change.
So: snapshot or derive?

- **Pure derive** (recompute slots from current settings): if you move lunch to
  1:00 next month, history silently rewrites itself. Your honest log lies.
- **Pure snapshot** (store the verdict string on the event): if we improve the
  verdict logic later, old events are stuck with old judgments.
- **The hybrid we shipped:** stamp the *raw facts* at log time (`ctx = {nth,
  cap, slotId, slotAt, firstSlotAt}` — things that depend on settings-at-that-
  moment) and compute the *verdict* at read time from those facts. Facts are
  frozen; judgment can improve. Your first ~2 days of events predate the stamp,
  so `classifyPouch` has a derive-fallback that reconstructs slots from current
  settings — a small accepted drift, and per the domain rule it never writes
  the reconstruction back onto the old events.

### 3. Deep links: the only door into a PWA

iOS will not let a web app read HealthKit — that's a hard platform wall (the
v2 native app gets the real API). But anything on your phone *can open a URL*,
and the app owns everything after the `?`. So the Shortcut "sends data" by
opening `…/?checkin=hours:7.4,workout:1`, and `App.jsx` parses it on boot like
a tiny, hostile-input API endpoint: `Number()` + `isFinite` guards, clamps
(quality 1–5, hours 0–14, score 0–100), unknown keys ignored, an idempotency
rule (one shortcut check-in per day, so re-opening the link can't duplicate),
and `history.replaceState` strips the param afterward so a refresh is clean.
Treating a URL parameter as untrusted input is the same discipline as
validating an API request body — same concept, smaller door.

### 4. Hand-rolled SVG charts

No chart library — both new charts are ~150 lines of SVG following MgChart's
conventions. The core trick is one coordinate mapping each way:
`x(day)` spreads days 1–60 across a 440-wide viewBox; `y(minutesSince4am)`
maps time-of-day to pixels, **inverted so later = higher** (holding out longer
should read as climbing). The histogram's stacking uses a paint trick: the
amber bar is drawn at *full stack height* and the indigo on-time bar is painted
over its bottom — the visible amber is exactly the early/over count, and both
segments animate up from the baseline perfectly flush. A library would be
~40 KB to do the same job with less control over the motion.

### 5. How the agents were orchestrated (and why that shape)

- **Foundation first, inline:** the store math, state APIs, and deep link were
  built and committed in the main session *before* any agent started — that
  froze the interface everyone else depends on.
- **One agent per new file, nine in parallel:** each Opus agent (max reasoning)
  owned exactly one component file — no shared-file edits, so no merge
  conflicts, and a bug in one file can't be caused by another agent.
- **Adversarial review by fresh eyes:** four *different* Opus agents, each with
  a single suspicious lens (lifecycle races, 4am-cutoff semantics, chart math,
  spec fidelity), read the diff cold with instructions to report only
  concrete input→wrong-output defects. Builders defend their code; strangers
  attack it. It worked — see the findings table below.
- **Verification split into math and pixels:** a Node harness with a mocked
  clock proved the math (you can't fake "day 13" in a real browser), and the
  live dev server proved rendering, interactions, and the deep link.

### 6. Testing with a mocked clock

Every aggregate depends on "today", and days flip at 4 AM. So the harness
replaces the global `Date` with a fake pinned to **July 20, 12:00** (plan day
13) before importing the store, then feeds it a fixture where I computed every
expected number by hand *before* running (early = 25 min, week-average gap =
3720/27 min, longest gap = 156h 15m…). 52 assertions, all traceable to the
fixture. If a future change breaks the 4am rule or the classification, the
harness screams. It's saved next to this report —
`docs/superpowers/reports/2026-07-10-math-harness.mjs` — run it anytime with
`node docs/superpowers/reports/2026-07-10-math-harness.mjs`.

---

## What each new stat will actually tell you

- **Slot discipline** measures the *gap between craving and clock*. "Avg held
  +Xm" is your delay muscle growing — the single number that predicts quit-day
  success. Early minutes shrinking week over week means the same thing.
- **First pouch of the day** is your wake-up wiring made visible. Stage 6
  (days 51–58) asks you to hold until after lunch; this chart shows the line
  drifting toward that dashed 12:30 target *months before you're asked to* —
  or not, which is also worth knowing early.
- **Your rhythm** separates structural hours (meals — protected by the plan)
  from impulsive ones. Amber clusters at, say, 9–10 PM tell you exactly where
  the next stage-down will pinch, so you can plan something for that hour.
- **Space between pouches** is the honest version of "cutting down": if caps
  are dropping but gaps aren't stretching, you're front-loading the day. The
  live ticker is deliberately the biggest number on the card — "3h 40m clean
  right now" is a streak you can defend in the moment.
- **Sleep, training & usage** tests your hunches with your own data. If bad
  sleep really does add 2 pouches/day, that's a lever (protect sleep) no
  willpower advice can give you. The card refuses to speak until 5 check-ins
  and always carries the small-sample caveat — no fake science.
- **History** is the product: the complete, never-rewritten ledger. On a bad
  day, scroll back and watch how many good days absorb it.

---

## Every judgment call made without you (and the rejected alternative)

The spec was excellent; where it was silent, these calls were made. Anything
you dislike is a small, isolated change — say the word.

**Data semantics (mine):**
1. **Rhythm histogram excludes baseline-day (pre-July-8) pouches.** They carry
   no verdict, and the chart's two series are on-time vs early/over.
   *Rejected:* counting them as "on-time" — would fabricate discipline data.
2. **Correlation averages exclude today; today still counts toward the 5-check-in
   unlock.** At 9 AM today has 1 pouch — including it would claim "good sleep →
   1 pouch/day". *Rejected:* including today — flattering but wrong until 4 AM.
3. **Deep-link idempotency checks for ANY shortcut check-in today,** not just
   the latest. Otherwise: shortcut at 8:30 → manual at 9:00 → re-opening the
   shortcut link would append a *second* shortcut that overrides your manual
   entry (latest wins). *Rejected:* the naive "is the latest one a shortcut?"
4. **A garbage deep link (`?checkin=abc`) appends nothing** but still strips the
   param. *Rejected:* recording a partial/empty check-in.
5. **Markdown footers render only when there's data** — an empty log exports
   clean. *Rejected:* always-on footers full of zeros.

**Design & UX (the component agents' calls, reviewed by me):**
6. **Verdict colors:** green for held-out wins, indigo for plain on-time, amber
   for early *and* over-cap (never red), muted for baseline. The toast also
   got one invented microcopy string: "tag it · optional".
7. **Undo sits on its own row, away from the trigger chips** — a finger
   reaching for "after-meal" can't accidentally delete the log.
8. **CheckinCard omits invalid numbers instead of clamping them** (typing 25
   hours saves no hours field rather than a fake 14). The deep link *does*
   clamp, per spec — a watch sending 14.2h is rounding noise; a human typing
   25 is a mistake.
9. **"rough → great" labels** under the sleep dots; Save stays disabled until
   you've actually answered something, so an empty check-in can't exist.
10. **GapsCard's live gap is the 34px centerpiece; longest-ever renders green**
    ("a genuine win"), with "incl. sleep" always attached — no stat theater.
11. **Correlation rows are colorless on purpose** — coloring "rest days" amber
    would imply causation the footnote explicitly disclaims.
12. **TodayLog's ticker is global, not today-scoped:** first thing in the
    morning it honestly shows the gap running since last night's final pouch.
13. **History uses a gentle tween (not a spring) for the accordion** — springs
    overshoot on `height: auto` — and computes a day's rows only when that day
    is open, so 60 collapsed sections cost nothing.
14. **Pre-plan days (July 7 and earlier) don't appear in History** — the spec
    scopes it to "Day n" plan sections. Your July 7 baseline logs still count
    in TodayLog-that-day, money math, and nowhere dishonest. Flagged in review;
    kept per spec.
15. **`sleepScore` is captured but not displayed anywhere yet** — spec says
    collect it; the v2 native app is where it earns its screen space.

**Verification pivot (mine, the biggest one):**
16. The spec's plan said "verify the correlation card unlocked with correct
    averages" — but the plan is 2 real days old, so an unlocked card cannot
    legitimately exist in the browser yet. *What I did instead:* proved the
    unlocked math in the clock-mocked Node harness (6 check-ins across 6 plan
    days, all bands hand-computed), and in the browser verified the locked
    state ("1/5 so far"), the unlock threshold, and single-day averages via
    future-dated check-ins. Stronger than the original plan, honest about the
    calendar. *Rejected:* seeding fake past dates before the plan started —
    correlationStats correctly refuses pre-plan days, and defeating that
    filter would have verified a lie.

---

## The adversarial review: what fresh eyes caught

Four independent Opus reviewers, instructed to refute the build. All four
findings were real; all four are fixed and re-verified.

| # | Severity | Found by | The bug | The fix |
|---|---|---|---|---|
| 1 | **Medium — data integrity** | 2 reviewers independently | Saving a sleep-only check-in silently recorded `workout: false` — every "didn't think about it" morning would pad the *rest days* correlation bucket with fabricated data, uncorrectable under the never-rewrite rule | Untouched toggle now saves *no* workout field (matches the deep-link path's semantics) |
| 2 | **Medium — impossible number** | charts reviewer | `preFirstSlot` counted over-cap taps too, but the card renders it as "of which N before the first slot" *under early* — a stage-6 morning slip could show "early 2 · of which **3**…" | The counter is now a true subset of early; the classification flag itself stays independent per spec |
| 3 | Low — spec deviation | time-semantics reviewer | "Today expanded" in History was frozen at mount: keep Stats open across 4 AM and the *wrong* day sits expanded | Default-open now tracks the live day number; your taps become overrides |
| 4 | Low-medium — silent no-op | lifecycle reviewer | Log a pouch → save your check-in mid-toast → tap a mood chip: `tagEvent` correctly refuses (the pouch is no longer the newest event) but the chip *looked* tappable and gave zero feedback | Chips now disappear the moment they can no longer work; undo stays |

Finding 1 is the reason this review pass exists: two reviewers converged on it
from different lenses, the builder agent had even *built* the distinguishing
flag (`workoutTouched`) and then didn't use it in the payload. Plausible code,
wrong data — exactly what survives casual review.

Also verified clean by the reviewers, byte-for-byte or by hand: all five toast
copy strings, both tab orders, the StrictMode double-effect safety of the deep
link, the 1:30 AM → previous-day path through all six consumers, DST
non-applicability (no US transition inside Jul 8–Sep 5), and that `plan.js`,
the slip policy, undo semantics, and API-key handling are untouched.

---

## Verification evidence (the "done" gate, per spec)

1. **`npm run lint`** — clean (only the 2 pre-existing fast-refresh notes).
   **`npm run build`** — succeeds, PWA precache builds.
2. **Math harness — 52/52 assertions** over a hand-computed fixture on a mocked
   clock (plan day 13): classification incl. the 1:30 AM cross-cutoff tap
   (lands on the previous day, over-cap), pre-first-slot flag, discipline
   totals/averages (avg held 171/31 min), first-pouch minutes, gap averages
   (3720/27 min), longest gap 156h 15m, histogram totals, latest-check-in-wins,
   correlation bands incl. hours-only fallback, markdown columns + all three
   footers, plus the stage-6 regression from review finding 2.
3. **Browser, seeded fixture (375×812 mobile):** every on-screen number matched
   the hand computation — discipline 5/2/1 with "of which 1 before the day's
   first slot", 117m held / 28m early, gaps 2h 0m / 3h 32m / 10h 0m "ended
   Jul 8" (the 1:30 AM tap attributed correctly), 2 first-pouch dots, 8 rhythm
   bars, correlation locked "1/5 so far", trigger bars, history rows exact.
4. **Deep link:** `?checkin=hours:7.4,workout:1,quality:4,score:82` → event
   created with exact values, URL stripped, `?static` preserved, second open
   → no duplicate. Clamp test: `hours:99,quality:9,score:999,workout:abc` →
   `{14, 5, 100}`, workout skipped, bogus keys ignored.
5. **Interactions:** live toast said "held out 459 min past the slot" — exactly
   10:39 PM minus the 3:00 PM slot; mood chip wrote the trigger and
   highlighted; undo removed the event and every stat re-derived; check-in
   save/dismiss/hide flows all exact; both review fixes re-verified live
   (sleep-only save has no `workout` key; chips vanish when a newer event lands).
6. **Fresh state:** cleared storage → every card shows its warm empty state,
   zero console errors.
7. **Mobile viewport:** no horizontal scroll anywhere, all cards legible.

Zero console errors or warnings across the entire verification session.

---

## Try this in 2 minutes (tomorrow morning, coffee in hand)

1. `cd ~/Projects/pouch-down && git log --oneline -5` — see the four commits.
2. `npm run dev` → open `http://localhost:5173` (or your usual dev flow).
3. Tap a sleep dot, tap **Save check-in** — the card slides away; open
   **Stats** and find your check-in in History.
4. Tap the ring to log a pouch (undo after if it's not real!) — read your
   verdict, tap a mood chip, then hit **undo** and watch every number heal.
5. Open **Stats** — your real July 8–9 data is already drawing the first two
   dots of the first-pouch chart.
6. Settings → **Simulate import** — watch a fake 7.4h night arrive through the
   same code path your watch will use.
7. Happy? `git push` — GitHub Pages deploys `main` to your phone automatically.

### The iOS Shortcut (5 minutes, once)

1. **Shortcuts** app → **Automation** tab → **+** → **Time of Day** → 8:30 AM,
   Daily → **Run Immediately** (no "Ask Before Running").
2. Add action **Find Health Samples** → Type: **Sleep**, sorted latest,
   limited to last night.
3. Add action **Calculate Statistics** → **Duration** of the samples, in
   **hours**.
4. Add action **URL** →
   `https://jxmcc15.github.io/pouch-down/?checkin=hours:` then tap the
   variable token for the duration result right after `hours:`.
5. Add action **Open URLs**. Done — every morning the PWA opens once, swallows
   the number, cleans its URL, and the check-in card is pre-answered. Add
   `,workout:1` manually on gym days, or keep using the card's chip.
   (The URL template is also copyable from Settings in the app.)

---

## Ledger

- **Commits on `main` (local only):** foundation `9ae8dcf` → components +
  integration `55ce371` → review fixes `3b7abea` → this report.
- **Files:** 9 new components; `store.js`, `state.jsx`, `App.jsx`, `coach.js`,
  `TodayView`, `StatsView`, `SettingsSheet`, `CLAUDE.md` modified; harness +
  report in `docs/superpowers/reports/`.
- **Not done, on purpose:** no push/deploy (your rule), no pre-plan days in
  History (spec), `sleepScore` display (v2), `fmtDuration` of a negative gap
  shows "-1m" only under backward device-clock skew (reviewer-classified
  unreachable in-app; left unguarded to keep the diff minimal).
- **Agents used:** 9 builders + 4 adversarial reviewers, all Opus 4.8 at max
  reasoning, orchestrated around a frozen foundation interface.
