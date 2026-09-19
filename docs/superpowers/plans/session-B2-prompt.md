# Session B2 — Awards & streak UI (Sun 2026-09-20, morning)

**Mission:** James called streak badges and awards "a must, with excellent animations and UI/UX feel." Build **StreakChip**, **TrophyCase**, and the **AwardUnlock** celebration overlay — section "SESSION B2" of the build plan. The logic (`src/awards.js`: `awardsFor`, `newlyEarned`; `streaks` in `store.js`) already exists and is tested — this session is pure interface craft.

**Precondition:** Session B's exit gate passed.

**Skills:** load `ui-ux-pro-max` FIRST and use it for the badge visual language, the unlock choreography, and the locked-state treatment. Badges are drawn in CSS/SVG (tier gradients: bronze, silver, gold, aurora) — no image assets. Reuse `confetti.js`, `AnimatedNumber`, Framer springs.

**Parallelism map:** three agents, three files — `StreakChip.jsx`, `TrophyCase.jsx`, `AwardUnlock.jsx`. You wire them into `TodayView.jsx`, `StatsView.jsx`, `App.jsx` yourself.

**The bar:** the unlock moment should feel earned — backdrop blur in, badge springs 0.6→1 with slight overshoot, one shimmer sweep, tier-scaled confetti, then stillness. Queue multiple unlocks; cap at 3 celebrations on first open and silently mark the rest celebrated; never celebrate while viewing a past attempt; `?static` and reduced-motion get a plain fade. Zero shame: no "streak lost" animation, ever — a broken streak just shows "Start a streak today".

**Verify like a user:** seed 3 green days → the "3-day streak" unlock plays → dismiss → reload → it does NOT replay. Record frames/screenshots of the unlock at 3 points in the animation and look at them. Check Trophy case in both an active attempt and read-only Attempt 1.

**Time box:** this session must end by ~11:30 AM CT so Session C has the afternoon. Awards are derived from the log, so anything unpolished can ship Tuesday with nothing lost — say what you deferred.

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
