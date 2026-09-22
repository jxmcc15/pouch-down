# Session A — Foundation logic (Sat 2026-09-19, morning)

**Mission:** finish the data/logic layer for Attempt 2 so that the app builds and runs on the new attempts model. Tasks **A1 → (A2 ‖ A3) → (A4 → A5) ‖ A6 → (A7 ‖ A8) → A9** in the build plan, then the **Session A exit gate**. This is the first big build — the foundation everything else stands on.

Task 0 is already done and committed (`5ff0407`): `src/planGenerator.js`, `src/time.js`, `src/migrate.js`, `src/legacyPlan.js` and their tests are verified — extend them only if a task says to; do not rewrite them.

**Parallelism map:** A1 alone first (everything depends on it). Then A2 and A3 as two parallel agents (disjoint files). Then A4 → A5 in one lane while A6 runs in another. Then A7 fanned out one agent per consumer file, with A8 alongside. A9 (`pouch-ingest` — so James never has to paste or upload his data again) is an independent lane: start it as soon as A8 settles the backup format. The build is EXPECTED to be broken between A1 and A7 — judge A1–A6 by `npm test`, and only require the full suite from A7 onward.

**Questions you almost certainly need to ask up front** (add your own after reading the code): (1) A9 step 7 — may you install the `com.jxm.pouch-ingest` launchd watcher (persistent config; may need him to grant a macOS privacy permission), or ship the `pouch-ingest` command only? Recommended default: command only tonight, watcher later. (2) May you create the iCloud Drive folder `PouchDown` for the Save-to-Files route? Default: yes. (3) Anything in the spec you found ambiguous once you read the real code.

**Definition of done:** the Session A exit gate in the plan passes, including the real-data migration test; `npm run dev` boots to the temporary "No active attempt yet." gate when only a v1 key is present, without touching that key.

## Standing orders (apply to the whole session)

**This prompt is the approved structured review.** James approved the spec and plan on 2026-09-18. Do not ask for per-step approval.

**Lead with questions, then go dark.** James wants this to run unsupervised for as long as possible. So BEFORE dispatching anything: read the docs below, inspect the code you will touch, and think the whole session through for decisions only James can make — credentials/API keys, macOS permissions, persistent system config (launchd agents, anything in `~/Library`), product judgment calls the spec leaves open, anything irreversible. Ask them ALL in ONE numbered batch at the very start, each with your recommended default so he can answer "defaults" in one word. (This deliberately overrides his usual 2–3-questions-at-a-time rule for this session — he asked for it.) After he answers, run to the exit gate without checking in. If a new question comes up mid-run: if the default path is reversible, take it and record it under **Decisions made without James** in the build log; if it is not reversible, park that task, keep going on everything else, and raise it in your final summary. Never sit idle waiting.

**Token ceilings (James's limits): coordinator ≤ 350k tokens of context, every subagent ≤ 250k.** These are self-policed — no switch enforces them. So: you coordinate, you do not implement. Delegate reading, editing and debugging to subagents and keep only their reports; never paste whole files or full test logs into your own context (tail them, ~20 lines). Scope each subagent to ONE task, the files it owns, and only the plan section it needs — hand it the task text verbatim, not the whole plan. Tell each subagent its 250k ceiling, and to stop and return a ≤300-word report (done / not done / files touched / test result / surprises) rather than push past it; split any task that looks too big for one agent before dispatching it. Watch your own usage: at ~300k stop dispatching, write a **Handoff** section in the build log (done / in flight / next / gotchas), commit, and tell James to relaunch this same prompt — plan checkboxes plus the build log make every session resumable.

**Outside review, when it earns its cost.** For load-bearing logic (migration, root persistence, scoring/streaks, anything that could lose or misreport his data) get an independent second opinion from **GPT-5.6 Sol**: `~/.codex/bin/ask-chatgpt "<your question + a curated code excerpt>"`. It runs sandboxed and sees only what you paste. For a second independent reviewer on a disputed point use `~/.gemini/bin/ask-gemini "<…>" --pro`. Paste code and SYNTHETIC fixtures only — never James's real data, his numbers, or anything from the vault. They are reviewers, not authorities: verify every claim against the code and tests before acting, and log accepted AND rejected findings with the reason. Skip it for mechanical refactors and copy. Budget: about six calls a session (Sol draws on his ChatGPT Pro 5-hour window). Lanes and setup: `/Users/jxm/jxm-vault/Claude Brain/Multi-Model CLI Setup.md`.

**Read first, in this order:** `CLAUDE.md` → `docs/superpowers/specs/2026-09-18-attempts-and-onboarding-design.md` → `docs/superpowers/plans/2026-09-18-attempt-2-build-plan.md` (especially **Ground rules**) → the latest section of `docs/superpowers/reports/2026-09-19-attempt-2-build-log.md` if it exists.

**Hard rules:** NEVER `git push` (pushing main deploys to James's phone). Never write or delete the `pouch-down-v1` localStorage key. History is append-only. No personal usage data in this public repo. Never commit an API key. Work only on branch `feat/attempt-2`.

**How to work — James has explicitly asked for multi-agent execution:** you are the COORDINATOR. Use the `subagent-driven-development` skill, and `dispatching-parallel-agents` to fan out agents wherever the plan marks tasks as parallel (‖) or gives agents separate file ownership. Give every agent: the task text verbatim from the plan, the ground rules, the exact files it owns, and the definition of done. Agents do TDD where the plan provides tests — the tests are the contract; if code and test disagree, fix the code. After each agent reports, YOU review its diff, run the full check suite, and commit. Do not let two agents edit the same file at the same time.

**Full check suite (run after every task and before every commit):**
`npm test && npm run lint && npm run build && node docs/superpowers/reports/2026-07-10-math-harness.mjs`
Lint baseline is exactly 2 pre-existing warnings. Real-data check when relevant: `POUCH_BACKUP_DIR="/Users/jxm/jxm-vault/Pouch Down" npm test`.

**Keep writing while you coordinate:**
1. Append a dated section to `docs/superpowers/reports/2026-09-19-attempt-2-build-log.md` as you go — what shipped, test counts, decisions you made and why, anything deferred, surprises. No personal usage numbers.
2. Tick the matching checkboxes in the plan file.
3. At the end, tick this session's tasks in the vault note `/Users/jxm/jxm-vault/Pouch Down/Attempt 2 — Build Schedule.md` and add a 3-line status under it; commit ONLY that file in the vault repo with a message starting `claude:` (never `git add -A` there, never push).

**Deadline discipline:** deploy freeze is Sun 2026-09-20 6:00 PM CT; Day 1 is Mon 2026-09-21. If you are running long, protect in this order: migration safety → honest scoring → setup flow → read-only viewer → backfill → money → awards UI → AI price help. Say clearly what you cut.

**Finish with:** a plain-language summary for James (he is a beginner developer — use the real terms, then explain them), the diff stat, test results, what the next session should know, and play `afplay /System/Library/Sounds/Glass.aiff`.
