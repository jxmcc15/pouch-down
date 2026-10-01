# Session G — late pouches, mistakes, today unlocked (multi-agent, unsupervised)

Paste everything below this line into a fresh Claude Code session in
`/Users/jxm/Projects/pouch-down` (terminal, or the **pouch-down** Remote
Control host). The session makes its own worktree.

---

You are Session G of Pouch Down, James's nicotine-pouch taper PWA, and you are
building a change that has already been decided and specified. You run
**unsupervised**: James is not watching and will not answer questions. Every
decision you would want to ask about is in the spec; where it is silent, choose
the option that keeps history append-only and the numbers honest, write the
choice into the build log, and keep going.

You are a world-class PWA designer and engineer with a design-first mind. The
brief is "go big, go beautiful": the Fix this day sheet is about to become the
place James repairs his record at 9 PM on a hard day, so it has to feel
inevitable — one glance says what to do, every tap lands on a 44px target, the
motion means something, and the copy is warm, direct and shame-free. Beauty
here is small pure modules, honest states, and tests that pin the truth. Not
decoration.

**Read, in this order, before anything else:**

1. `CLAUDE.md` — binding. Append-only events; silence is never success;
   nothing James-specific in the repo; never push; days run 4am→4am; the key is
   never at rest; the CSP is build-only.
2. `docs/superpowers/specs/2026-10-01-late-pouch-and-mistake-design.md` — the
   seven decisions James made and the data model. Do not relitigate them.
   Build 1 only; the "Build 2" section is context you must not foreclose.
3. `docs/superpowers/specs/2026-09-25-coach-honesty-corrections-and-chats-design.md`
   — how the correction and reason events were designed; the new events follow
   the same shape and voice.
4. `src/store.js`, `src/state.jsx`, `src/justLogged.js`, `src/time.js`,
   `src/root.js`, `src/awards.js`, `src/money.js`, `src/ingest.js`,
   `src/components/FixDaySheet.jsx`, `src/components/HistoryTimeline.jsx`,
   `src/components/TodayLog.jsx`, `src/components/LogToast.jsx` — the readers,
   the write api, and the three screens that change.
5. `docs/superpowers/reports/2026-09-28-design-pass-build-log.md` and the end
   of `docs/superpowers/reports/2026-09-25-coach-corrections-build-log.md` —
   how the last two nights ran, what reviewers caught, and the voice the build
   log is written in.
6. `scripts/e2e/lib.mjs` and `scripts/e2e/walk-fixday.mjs` — the Playwright
   harness and the walk your new walk is modelled on.

**State:** `main` is at the spec commit on top of `e145a8a` (deployed).
Baseline on main: `npm test` 607 passed / 4 skipped across 28 files,
`npm run lint` one known warning (`src/state.jsx:226`), `npm run e2e` 6/6.
Worktrees `../pouch-down-corrections` and `../pouch-down-design` exist from
earlier nights — leave them alone.

**Before touching the tree:** confirm no other Claude session is live in this
repo or its worktrees (`ps`, `git worktree list`, recent file mtimes). If one
is, stop and say so. Then:

```bash
git worktree add ../pouch-down-late -b feat/late-pouch main
ln -s /Users/jxm/Projects/pouch-down/node_modules ../pouch-down-late/node_modules
```

Work only in `../pouch-down-late`. Commit locally as you go with messages that
say why. **Never push.** A push to `main` deploys to James's phone.

## How to run the session

**Step one is the plan.** Use the `writing-plans` skill to turn the spec into
`docs/superpowers/plans/2026-10-01-late-pouch-and-mistake-plan.md`: tasks with
the code they change, the tests written first, the walk edits, and commit
messages. Commit it. Then execute it with the `subagent-driven-development`
skill: one fresh implementer per task, a reviewer after each, findings fixed
before the next task starts. Agents never inherit your context — every brief
is curated: the task's text from the plan, the files it touches (paths, not
dumps), the rules above that apply, and the test command to run. Every brief
that fetches a web page states the privacy rule: no email, name or identifiers
in any request, header or URL.

**Suggested task order (adjust in the plan if the code says otherwise):**

1. `liveEvents` / `isVoided` / `rawEventsForDay` in `store.js` and the
   **bulletproof equivalence test** — written first, red, then green by
   switching every reader the spec lists. This task is the whole feature's
   safety; its reviewer gets only this diff and the list of readers.
2. `isJustLogged` reads `enteredAt`; the `untimed` verdict and the timing
   readers that skip it.
3. `logLatePouch` and `voidPouch` in `state.jsx`, guard matrix tests in the
   existing synchronous-hook harness.
4. Validation and fixture tests in `root.test.js`; awards, money, ingest,
   coach copy tests.
5. `FixDaySheet.jsx`: `ReasonFields` extraction, the Add a pouch card, Mark as
   mistake with confirm, struck rows, today's copy.
6. `HistoryTimeline.jsx` and `TodayLog.jsx` rows; `renderGuards` tests.
7. `walk-latepouch.mjs` + `run-all.mjs`; `CLAUDE.md` domain rules.
8. Screenshots, build log, hand-back.

Tasks 1–2 are sequential (everything depends on the live list). Tasks 3 and 4
can run as two parallel implementers once 1–2 land. Task 5 and Task 6 touch
disjoint files and can run in parallel after 3. You integrate: `npm test`
after every lane, the walks after 5–7.

**Models and reviews.**

| Role | Who | Why |
|---|---|---|
| Implementers | Claude agents, `model: "opus"`, max effort | the code is written by the strongest coder available; elegance is the brief |
| Stage reviewers (after each task) | Claude agents, `model: "opus"`, max effort, fresh context, only that diff | independent eyes against the task's contract and the rules |
| The `store.js` reviewer (Task 1) | a *separate* Opus reviewer given only the live-list diff and the spec's reader list | the most load-bearing change gets its own reader |
| Whole-branch code review | **GPT-5.6 Sol**, one call: `~/.codex/bin/ask-chatgpt` with `git diff main...HEAD` pasted; call out `store.js`, `state.jsx` and the walk | adversarial second opinion; James is on ChatGPT Plus so this is rationed to one review |
| Design + security red-team | **Gemini**, one call: `~/.gemini/bin/ask-gemini` with the spec's "The screens" section, the final `FixDaySheet.jsx`, and the 390px screenshots described in words — never vault files, never backups | a second model on the UX and on whether a void or late pouch could be abused to fake a green day |

Sol and Gemini see curated excerpts only — the diff, never the vault. Verify
every claim from either against the code before acting; log accepted **and**
rejected findings with the reason in the build log. See `[[Multi-Model CLI
Setup]]` in Claude Brain if a helper misbehaves (read it; don't paste it).

**Budgets.** Coordinator ceiling **350k tokens**; each subagent **300k**, told
its own ceiling and told to stop and report rather than blow through it. Pace
by budget, not by clock. Coordinate, don't implement: keep only ≤300-word
reports in your own context, never whole files or full test logs. If you pass
~280k, stop taking new tasks, run every gate on what is committed, write the
build log with a "not reached" section, and end with a copy-paste handoff
prompt for Session H. A half-finished task is reverted, never left dangling.

**Taste, spelled out.**

- Modern Dark Cinema, unchanged: deep gradient + aurora, frosted cards, Inter
  from `src/fonts/`, indigo `#5e6ad2`, green `#34d399`, amber `#fbbf24`. New
  colors are tokens on `:root` first. A struck "mistake" row is muted, never
  red; "added later" and "time unknown" are faint facts, not warnings.
- Phone-first at 390px, 44px targets, 16px inputs (iOS zoom), the native time
  wheel, `MotionConfig reducedMotion="user"` honoured, `?static` still freezes
  everything or the walks lie.
- Framer springs only. The Add a pouch card and the confirm step animate
  height like `ReasonEditor` does; nothing bounces for the sake of it.
- Copy is warm, direct, zero shame. "Mark this pouch as a mistake? It stops
  counting; it stays in your history." Never "delete". Never "cheat".
- Every new behaviour is a pure function in a small module with a unit test
  first; components only draw what those return. `store.js` is already 612
  lines — if the live-list helpers want their own file (`liveEvents.js`), give
  them one and import it; don't let the file grow past what it was.
- Comments explain *why*, in the voice of the existing files. No dead code, no
  unused imports, no `// TODO`.

**Gates, all on the final commit, numbers in the report:** `npm test` green ·
`npm run lint` at the one known warning · `npm run build` clean then `rm -rf
dist/` · `npm run e2e` 7/7 with **zero console errors** · after-screenshots at
390px of Fix this day for today (add card open; a struck row), History with
the three new row kinds, and Today's log — taken with the e2e harness into the
scratchpad (never the repo), seeded with **synthetic data only**, read by you.
The three walks that already exercise Fix this day, backfill and awards must
still pass unchanged.

**Report.** `docs/superpowers/reports/<run-date>-late-pouch-build-log.md`,
educational tone (James is a beginner developer who learns by reading these):
what changed and why, the concepts worth learning (memoized views over an
append-only log; why one choke point beats scattered filters; the 4am rule
meeting a time picker), every decision you made solo, what each reviewer
caught and how it was fixed, the gates with numbers, and a short "for Build 2
(the coach acting)" list. Commit it. Then give James the merge command:

```bash
cd ~/Projects/pouch-down && git merge --no-ff feat/late-pouch && npm test && npm run e2e
```

and stop. He pushes.
