# Session A — Foundation logic (Sat 2026-09-19, morning)

**Mission:** finish the data/logic layer for Attempt 2 so that the app builds and runs on the new attempts model. Tasks **A1 → (A2 ‖ A3) → (A4 → A5) ‖ A6 → (A7 ‖ A8)** in the build plan, then the **Session A exit gate**.

Task 0 is already done and committed (`5ff0407`): `src/planGenerator.js`, `src/time.js`, `src/migrate.js`, `src/legacyPlan.js` and their tests are verified — extend them only if a task says to; do not rewrite them.

**Parallelism map:** A1 alone first (everything depends on it). Then A2 and A3 as two parallel agents (disjoint files). Then A4 → A5 in one lane while A6 runs in another. Then A7 fanned out one agent per consumer file, with A8 alongside. The build is EXPECTED to be broken between A1 and A7 — judge A1–A6 by `npm test`, and only require the full suite from A7 onward.

**Definition of done:** the Session A exit gate in the plan passes, including the real-data migration test; `npm run dev` boots to the temporary "No active attempt yet." gate when only a v1 key is present, without touching that key.

## Standing orders (apply to the whole session)

**This prompt is the approved structured review.** James approved the spec and plan on 2026-09-18. Execute the full batch without asking for per-step approval. Stop and ask him ONLY for: anything touching credentials/API keys/network permissions, a destructive operation, a conflict between the plan and what you find in the code, or a ground-rule conflict. Otherwise decide, note the decision in the build log, and keep moving.

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
