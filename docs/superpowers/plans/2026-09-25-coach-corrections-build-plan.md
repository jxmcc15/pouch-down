# Build plan — coach honesty, day corrections, reasons, chats

Spec: `docs/superpowers/specs/2026-09-25-coach-honesty-corrections-and-chats-design.md`
(the spec is the contract; this plan only maps it to tasks).
Worktree: `/Users/jxm/Projects/pouch-down-corrections`, branch `feat/coach-corrections`.
Baseline: 23 test files, 482 passing, 4 skipped. `node_modules` is a symlink to
the main checkout. Never push.

Execution: subagent per task, one reviewer per task (spec compliance first,
then code quality, in one pass), coordinator commits parallel tasks by explicit
path. Tasks 2 and 3 touch disjoint files and run in parallel; so do 4 and 5.

## Task 1 — Data layer (sequential; everything else depends on it)

Files: `src/triggers.js` (new), `src/store.js`, `src/root.js`, `src/state.jsx`,
`src/components/SOSOverlay.jsx`, `src/components/LogToast.jsx` (import move
only), `src/ingest.js` (top-triggers loop → `triggersFor`), `src/components/StatsView.jsx`
(trigger counts → `triggersFor`), `src/components/TodayLog.jsx` and
`src/components/HistoryTimeline.jsx` (display `triggersFor(...).join(', ')`
instead of `ev.trigger` — display only, no layout work here).

Spec sections: Build 2 "Two new event types", "Read rules", "Write rules",
"Validation"; Build 3 "Storage" (attempt.chats, `appendChatTurn`, `settle`,
`startAttempt`) and "Validation" (`wellFormedChat`).

Tests: `store.test.js`, `root.test.js`, new `corrections.test.js` (api
guards, using the harness in `state-guards.test.js`), `backup.test.js` (chat
round-trip), `migrate.test.js` unchanged and green.

## Task 2 — Fix this day sheet (parallel with 3)

Files: `src/components/FixDaySheet.jsx` (new), `src/components/BackfillForm.jsx`
(extracted from `BackfillPrompt.jsx`), `src/components/BackfillPrompt.jsx`,
`src/components/CalendarView.jsx`, `src/components/HistoryTimeline.jsx`
(day-heading tap + correction line + reason note), `src/App.jsx` (sheet slot
`{ kind: 'fix', day }`), `src/index.css` only if a new class is needed.

Spec section: Build 2 "The sheet". Design system: CLAUDE.md "Modern Dark
Cinema"; copy tone: warm, direct, zero shame. `disciplineCard.test.js` shows
how components are rendered in tests here if a render test is wanted; the e2e
walk (Task 4) is the primary UI proof.

## Task 3 — Chats come home (parallel with 2)

Files: `src/components/CoachSheet.jsx` (chatId ref + `appendChatTurn` after a
successful reply — nothing else in that file), `src/ingest.js`
(`chatsOf`, `renderCoachChats`), `scripts/ingest-backup.mjs` (previous-newest
snapshot, `Coach Chats.md`, `result.coachChats`, `summaryLines`),
`scripts/notify-telegram.mjs` (`ingestedText` suffix), `CLAUDE.md` (Related
rule), tests `ingest.test.js`, `notify.test.js`, `ingestTrust.test.js` green.

Spec sections: Build 3 "Storage" (sheet half only), "Backup", "Ingest", "The rule".

## Task 4 — E2E walk (after 2; parallel with 5)

Files: `scripts/e2e/fixday.mjs` (new), `scripts/e2e/run-all.mjs`. Read
`scripts/e2e/lib.mjs` and `backfill.mjs` first for the harness (pinned clock,
seed once per context, private build, `?static`). Spec: Build 2 "Tests" → E2E.
Update the CLAUDE.md E2E line from five walks to six.

## Task 5 — Honest coach (after 3; parallel with 4)

Files: `src/coach.js` (prompt paragraph; stale header comment fixed by the
proxy session already — check), `src/components/CoachSheet.jsx` (tagline
only), `src/__tests__/coach.test.js`. Spec: Build 1.

## Task 6 — Gates, final review, report

`npm test`, `npm run lint`, `npm run build`, `npm run e2e` (six walks, zero
console errors), `POUCH_BACKUP_DIR=<tmp> POUCH_SEARCH_DIRS=<tmp/in> node
scripts/ingest-backup.mjs --dry-run` with a synthetic backup that has chats and
a correction. Final reviewer over the whole branch diff. Morning report in
`docs/superpowers/reports/2026-09-25-coach-corrections-build-log.md`. Vault
note + memory pointer. Branch left for James; never pushed.
