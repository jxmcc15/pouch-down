# Pouch Down — Stats Expansion Design

**Date:** 2026-07-09 · **Status:** Approved by James (structured review, one-approval gate passed)
**Scope:** v1 PWA only. This spec is the single source of truth for the build. Where it is
silent, follow the project CLAUDE.md domain rules and existing code idiom.

## Summary

Expand Pouch Down's tracking from daily counts to per-tap analytics: every pouch log gets a
visible timestamp and a classification (on-time / early / over-cap / pre-first-slot) with
signed time deltas; a morning health check-in (sleep + workout) enters via manual card or an
iOS Shortcut deep link; six new stats surfaces are added. Everything derives from the
event log — no backend, no new permissions, all on-device.

## Decisions made with James (do not relitigate)

| Decision | Choice |
|---|---|
| Timestamp log placement | **Both** — compact "Today's log" on Today tab + full history timeline in Stats |
| Buckets | On-time / Early, Over-cap, Pre-first-slot. **Not** night-owl. Signed deltas required: minutes early AND minutes held out past unlock |
| Extra capture | Time-derived everything + 1-tap mood chips. **No** location, **no** weather |
| Health data bridge | Manual morning check-in card **plus** optional iOS Shortcut deep-link import. HealthKit itself is unreachable from a PWA (v2 native app gets it) |
| Mood chip vocabulary | Reuse the six SOS triggers: `after-meal, coffee, driving, stress, boredom, social` — one taxonomy, merged stats |
| Tap-time feedback | **Feedback + gentle nudge** — toast states the fact warmly; exact copy below |
| Data model | **Hybrid snapshot** — stamp settings-dependent raw facts at log time; compute verdicts at read time; derive-fallback for pre-existing events |

## Data model

### Pouch event ctx stamp

`api.logPouch(trigger)` in `state.jsx` calls `pacingForNow(state)` **before** appending and
stamps the event:

```js
ctx: {
  nth,          // 1-based pouch index for that day at log time (used + 1)
  cap,          // capForDay at log time
  slotId,       // nextSlot?.id ?? null   (null = over cap, no slot left)
  slotLabel,    // nextSlot?.label ?? null
  slotAt,       // nextSlot?.at.toISOString() ?? null
  firstSlotAt,  // slots[0]?.at.toISOString() ?? null  (for pre-first-slot verdict)
}
```

Pre-plan (`mode: 'pre'`) and post-quit (`mode: 'post'`) have no slots: stamp
`{ nth, cap, slotId: null, slotAt: null, firstSlotAt: null }`.

### Classification (read-time, in store.js)

`classifyPouch(state, ev)` →
`{ bucket: 'baseline'|'on-time'|'early'|'over-cap', deltaMin: number|null, preFirstSlot: bool }`

- Day number `< 1` → `baseline` (excluded from discipline stats; honesty-only days).
- `nth > cap` → `over-cap`, `deltaMin: null`.
- Else `deltaMin = (ts − slotAt) / 60000` (signed; **negative = early**).
  `bucket = deltaMin < 0 ? 'early' : 'on-time'`.
- `preFirstSlot = ts < firstSlotAt` (flag independent of bucket; a subset of early in practice).
- **Fallback for events without `ctx`** (the first ~2 days of real logs): reconstruct the
  day's slots from the stage + *current* settings; `nth` = position among that day's pouch
  events sorted by ts. Accept the small settings-drift inaccuracy; never write the derived
  ctx back onto old events.

### Check-in event

```js
{ id, ts, type: 'checkin', sleepQuality?: 1–5, sleepScore?: number,
  sleepHours?: number, workout?: bool, source: 'manual'|'shortcut' }
```

Belongs to `dayKeyFor(ts)`. Append-only; **latest check-in per day wins at read time**.
Never edit or delete previous ones.

### Mood tagging — the completion-window exception

New `api.tagEvent(id, trigger)`: allowed **only** when `id` is the most recent event, it is a
pouch event, and `Date.now() − ev.ts ≤ 15s`. Sets `trigger` (overwrite within window OK).
This is sanctioned as *completing* the just-made log — same spirit as undo — and must be
documented in CLAUDE.md alongside the undo rule. No other event mutation, ever.

### Deep link import (App.jsx)

On boot, parse `?checkin=hours:7.4,workout:1,quality:4,score:82` (all fields optional).
Defensive parsing: NaN guards, clamp quality 1–5, hours 0–14, score 0–100. If today already
has a `source:'shortcut'` check-in, skip (idempotent re-opens). Append event, then
`history.replaceState` to strip the query. Must coexist with the existing `?static` param.

### State additions

`freshState()` gains `checkinDismissedFor: null` (dayKey string — hides the card for that
day). Schema version stays 1; all changes are additive and `loadState`'s spread handles them.

## Derived stats (exact definitions, store.js)

- **disciplineStats(state)** → totals across plan days + today's slice:
  `{ onTime, early, overCap, preFirstSlot, avgMinEarly, avgMinHeld, today: {…same counts…} }`
  `avgMinEarly` = mean |deltaMin| over early events; `avgMinHeld` = mean deltaMin over
  on-time events. Baseline-bucket events excluded everywhere.
- **firstPouchTimes(state)** → `[{ dayNum, date, minutesSince4am }]` — first pouch per
  dayKey (4am cutoff means a 1 AM pouch belongs to the *previous* day; grouping by dayKey
  handles this automatically). Y-axis in time-of-day; include a reference line at the
  current lunch meal time (the Stage 6 target).
- **gapStats(state)** →
  `{ avgGapTodayMin, avgGap7dMin, longestGapMs, longestGapEndedAt, currentGapMs }`.
  Average gaps use consecutive pouches **within the same dayKey** (excludes sleep).
  `longestGap` spans any two consecutive pouches ever — label it honestly ("incl. sleep").
  `currentGapMs = now − last pouch ts` (null if no pouches).
- **hourHistogram(state)** → 24 buckets by local hour, pouch events only, split into
  on-time vs early+over-cap series.
- **checkinForDay(state, dateStr)** → latest check-in that day, or null.
- **correlationStats(state)** → averages pouches/day on plan days that have a check-in:
  by sleep band (quality 1–2 poor / 3 ok / 4–5 good; if only `sleepHours`, band by
  <6.5 / 6.5–7.5 / >7.5) and by workout yes/no. Card renders only at ≥5 total check-ins.
- **timeSinceLastPouch(state)** → ms, driven live by the existing 1-second `tick`.

## Today tab

Order: header → tagline → **CheckinCard** (if no check-in today && not dismissed) → LogRing →
**LogToast** (upgraded) → PacingCard → **TodayLog** → existing stat-card row → SOS button.

- **LogToast.jsx** (extract the current inline toast): timestamp + verdict + nudge + undo,
  and the six trigger chips below. Window extended 6s → **12s**. Tapping a chip calls
  `tagEvent` and highlights the chip; undo still removes the event.
- **TodayLog.jsx**: card listing today's events newest-last — pouches
  (`9:42 AM · after breakfast · on time +23m`), resisted (shield icon), with the **live gap
  ticker** in the card header ("2h 14m since last pouch"). Empty state: one warm line.
- **CheckinCard.jsx**: five quality dots, workout toggle chip, collapsed "add exact numbers"
  expander (score, hours — reuse the settings number-input pattern), Save, and a subtle
  dismiss-for-today ×.

## Stats tab

Section order in StatsView: mg chart (existing) → money/avoided (existing) →
**DisciplineCard** → **FirstPouchChart** → **RhythmChart** → **GapsCard** →
**CorrelationCard** → TriggerBars (existing) → **HistoryTimeline**.

- **DisciplineCard.jsx**: on-time / early / over-cap counts (today + all-time),
  `of which N before the day's first slot` as a sub-line of early, avg minutes early, avg
  minutes held past unlock. Positives lead; over-cap is plain amber, never alarm-red.
- **FirstPouchChart.jsx**: SVG dot per day (MgChart conventions: viewBox 440-wide, PAD,
  `var(--fg-faint)` labels, framer path/dot animation, `overflowX: auto` wrapper), lunch
  reference line labeled "Stage 6 target".
- **RhythmChart.jsx**: 24-bar hour histogram, indigo on-time + amber early/over stack.
- **GapsCard.jsx**: avg gap today vs last 7 days, longest ever (+date, "incl. sleep"),
  current live gap.
- **CorrelationCard.jsx**: sleep bands × avg pouches, workout vs rest. Locked state below
  5 check-ins: "Check in 5 mornings to unlock this." Footnote always:
  "Small sample, correlation not causation — but patterns worth watching."
- **HistoryTimeline.jsx**: newest-first day sections (Day n · date · used/cap · status dot);
  today expanded, rest collapsed; rows show time · slot · verdict (+delta) · trigger;
  resisted and check-in rows included. Render last 14 days, "Show all" button for the rest.

## Settings

New "Apple Watch / Health import" section in SettingsSheet: one honest line that iOS blocks
web apps from HealthKit, then the numbered Shortcut recipe (Shortcuts app → Automation →
daily 8:30 AM → Find Health Samples where Type is Sleep → Calculate duration → Open URL) with
the copyable URL template `https://jxmcc15.github.io/pouch-down/?checkin=hours:[Duration]`
and a "simulate import" test link that exercises the parser locally.

## Coach & export

`markdownSummary()` gains columns `Early | Over | First` per day plus footer lines:
discipline totals, avg held/early, longest gap, and a 7-day check-in summary. One added
sentence in `coach.js`'s system prompt: early = before the pacing slot unlocked; buckets are
honest data — reference them without shame. No other coach changes.

## Exact copy (tone: warm, direct, zero shame)

- Early: `Logged {time} · {X} min early — slot opens {slotTime}. Still counts, no sweat.`
- On-time (≥5 min held): `Logged {time} · held out {X} min past the slot. That's the muscle.`
- On-time (<5 min): `Logged {time} · right on time.`
- Over-cap: `Logged {time} · over today's cap — counted honestly. Tomorrow doesn't change.`
- Baseline: `Logged {time} · baseline day — no caps yet, just honesty.`

## Edge cases

- Over-cap tap: `nextSlot` is null → slot fields null; verdict from `nth > cap`.
- Quit day: ring already disabled; post-quit pouch (shouldn't happen) = over-cap vs cap 0.
- 1 AM tap: dayKey grouping puts it on the previous day everywhere (first-pouch, gaps, logs).
- Undo: all stats are derived, so they recompute for free. TodayLog must not crash when the
  undone event vanishes mid-toast.
- Multiple check-ins/day: latest wins at read; shortcut import skips if one exists.
- Fresh state: every new card needs a sane empty state; the app must render with zero events.
- `?static` and `?checkin=` may appear together.
- Reduced motion: inherited from `MotionConfig reducedMotion="user"` — no extra work, but no
  animation-dependent information.

## Verification plan (gate for "done")

1. `npm run lint` clean; `npm run build` succeeds.
2. `preview_start` (`pouch-down-dev`, port 5199). Seed localStorage via `preview_eval` with a
   hand-computed fixture: early tap, on-time tap, over-cap tap, pre-first-slot tap, a 1 AM
   cross-cutoff tap, resisted events, tagged triggers, and 6 check-ins spanning 6 days
   (mixed quality/workout). Reload with `?static`.
3. Assert exact expected numbers (computed by hand when designing the fixture) via
   `preview_snapshot` / `preview_inspect`: discipline counts and averages, first-pouch dots,
   gap figures, histogram totals, correlation card unlocked with correct averages.
4. Deep link: load with `?checkin=hours:7.4,workout:1` → check-in appears, URL stripped,
   second load doesn't duplicate.
5. Interactions: log → toast copy correct per bucket → chip tag lands in TriggerBars →
   undo removes everything. Check-in card save + dismiss + hidden-when-done.
6. Fresh-state run (cleared storage): all empty states render, nothing crashes.
7. `preview_resize` mobile (375×812) — no horizontal scroll, cards legible.

## File batch (approved)

**Modify:** `src/store.js`, `src/state.jsx`, `src/App.jsx`, `src/components/TodayView.jsx`,
`src/components/StatsView.jsx`, `src/components/SettingsSheet.jsx`, `CLAUDE.md` (record the
checkin event type, the tagEvent completion-window exception, and the push-main-auto-deploys
warning).
**New:** `src/components/LogToast.jsx`, `TodayLog.jsx`, `CheckinCard.jsx`,
`DisciplineCard.jsx`, `FirstPouchChart.jsx`, `RhythmChart.jsx`, `GapsCard.jsx`,
`CorrelationCard.jsx`, `HistoryTimeline.jsx`.

## Out of scope / do not touch

Location, weather, push notifications, `plan.js` (taper semantics are sacred), the slip
policy, undo semantics beyond the documented tagEvent exception, the 4 AM cutoff, the API-key
handling, and **any push or deploy** (pushing `main` auto-deploys to the live PWA on
James's phone via `.github/workflows/deploy.yml`).
