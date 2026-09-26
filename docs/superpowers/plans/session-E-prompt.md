# Session E — design pass: Settings, Stats, Calendar (+ the three deferred fixes)

Paste everything below this line into a fresh Claude Code session in
`/Users/jxm/Projects/pouch-down`.

---

You are starting Session E of Pouch Down, James's nicotine-pouch taper PWA. Read
`CLAUDE.md` in full first — its rules are binding (append-only events, silence is
never success, nothing James-specific in the repo, never push without James, days
run 4am→4am, the API key is never at rest, the CSP is build-only). Then read the
end of `docs/superpowers/reports/2026-09-19-attempt-2-build-log.md` (Session D and
the proxy handoff) and `docs/superpowers/reports/2026-09-25-coach-corrections-build-log.md`
so you know what shipped on 2026-09-26: the Fix-this-day sheet, correction/reason
events, coach chats filed by `pouch-ingest`, the honest coach prompt, and the
coach proxy Worker (built, dormant until `COACH_PROXY` is filled in).

`main` is deployed and clean at `768bb52`. Work on a new branch
`feat/design-pass` in a worktree (`git worktree add ../pouch-down-design -b
feat/design-pass main`; symlink `node_modules`). Commit locally as you go with
messages that explain the why. **Do not push** — James pushes, or says in this
session that you may.

## Why this session exists

Session D decided a design-first pass on Settings and never got to it. Screens
captured on 2026-09-26 at 390px show the real problems:

- **Settings** is one flat scroll: meal times, tin cost, API key, attempts,
  export, all at equal weight, no grouping, and "End this attempt and start
  over" looks like any other button. Wake and sleep times exist in
  `DEFAULT_SETTINGS` but have no field. The device-token section only appears
  once a proxy is configured, and the sheet has no idea of "state" (connected /
  not connected).
- **Stats** is a 7,760px page. The full trophy case sits inline although a
  trophies sheet already exists; the Money card is duplicated from Today; and
  History — where the new "Fix this day" pencil lives — is at the very bottom,
  under seven cards.
- **Calendar** cells show the plan-day number large and the date nowhere. James
  thinks in dates ("Thursday", "Sep 24"), not day numbers. Corrected days have no
  visible mark.
- **Today** is strong; leave it alone except one thing: the SOS button is below
  the Money card, off-screen. A craving shouldn't need a scroll.

## Method — this is a design pass, so design first

1. Load the `ui-ux-pro-max` skill (it has the mobile patterns and the review
   checklist) and the `brainstorming` skill. Explore the code before proposing
   anything: `src/components/SettingsSheet.jsx`, `StatsView.jsx`, `CalendarView.jsx`,
   `HistoryTimeline.jsx`, `TodayView.jsx`, `App.jsx`, `index.css`, `motion.js`.
2. Ask James questions in batches of 2–3, one batch at a time. The ones that
   matter most: whether Stats should split into two tabs (Stats / History) or
   use a segment control inside one tab; whether Settings rows should open
   sub-sheets or stay inline sections; whether the calendar should show dates
   in the cells or month headers with day-of-month.
3. Present a structured review: every file, what changes, and mockups where a
   picture helps (ASCII in the terminal is fine, or the brainstorming visual
   companion if James accepts it). One approval, then execute the whole batch.

## Design constraints (do not relitigate)

- Modern Dark Cinema stays: deep gradient + aurora, frosted cards, Inter (served
  from `src/fonts/`), indigo `#5e6ad2`, green `#34d399`, amber `#fbbf24`. No new
  dependencies. Phone-first at 390px, 44px tap targets, `MotionConfig
  reducedMotion="user"` respected, and `?static` must still kill animation or
  the e2e walks break.
- Every existing e2e selector and text keeps working, or the walk is updated
  in the same commit with the reason in the message. Read `scripts/e2e/lib.mjs`
  and every `walk-*.mjs` before touching a label.
- Tone: warm, direct, zero shame. "End this attempt" is a destructive action:
  separate it visually, keep its confirm step, never make it one tap.
- Nothing in Settings may persist an API key. The device token is a preference,
  not a secret; the key field stays a password field filled from a manager.

## Scope, in order

1. **Settings.** Grouped sections with headers — Routine (meals, wake, sleep),
   Money (tin cost, pouches per tin, "work it out"), Coach (one status line:
   connected via proxy / key held this session / not connected, plus the one
   action that fixes it), Attempt (current attempt summary, past attempts,
   end attempt as a danger zone), Your data (backup, copy log, last backup
   date if known), About (build + a one-line privacy statement). Shorter
   scroll; consider sub-sheets for Coach and Attempts.
2. **Stats.** Trophy case becomes a compact strip that opens the existing
   sheet. Money card leaves Stats (it lives on Today). History moves to the top
   or its own tab — James's call in the questions. Charts grouped so the page
   reads as sections, not a pile.
3. **Calendar.** Dates visible, month boundaries visible, a small mark on
   corrected and backfilled days, the tap target unchanged.
4. **Today.** SOS reachable without scrolling; nothing else.
5. **The three deferred fixes** from Session D, each its own commit with tests:
   `String()` guards where `TodayLog`, `HistoryTimeline` and `PlanView` render
   stored values; filling `DEFAULT_SETTINGS` gaps in `migrate.js` (the most
   load-bearing code in the app — dispatch a separate reviewer for it); and
   pointing the ingest notifier at a notify-only Telegram bot via
   `POUCH_TELEGRAM_ENV` (read `scripts/notify-telegram.mjs` first; James
   supplies the bot, never paste a token into a chat).

Not in scope: the coach proxy deploy (James runs `wrangler` himself — see
`workers/coach-proxy/README.md`), Firebase sync, off-track detection, the
post-quit check-in. Mention them in the report only if this pass touches
something they will need.

## Gates before you report

`npm test` green · `npm run lint` at its baseline (one warning in `state.jsx`) ·
`npm run build` clean, then delete `dist/` (its presence flips the CSP tests) ·
`npm run e2e` 6/6 with zero console errors · fresh screenshots of every changed
screen at 390px, read by you, before and after, saved outside the repo.

## Report

Write `docs/superpowers/reports/2026-09-2X-design-pass-build-log.md`: what
changed and why, what the reviewers caught, the gates with numbers, and a short
"for the next session" list. Educational tone — James is learning by reading
these. Commit it. Then give James the merge command and stop.
