# Session C — QA and ship (Sun 2026-09-20, midday → 6:00 PM CT freeze)

**Mission:** prove Attempt 2 is safe to put on James's phone, then hand him a release. Tasks **C1–C5** in the build plan. This app is load-bearing for a real health goal: **a broken app on Day 1 is worse than a missing feature.** When in doubt, cut scope, not corners.

**Parallelism map:** C1's five E2E flows → five parallel agents (one script each under `scripts/e2e/`). C2 (real-data dry run) you run yourself — it reads personal data from `/Users/jxm/jxm-vault/Pouch Down`; its script lives in your scratchpad and is NEVER committed. C3 → fan out six independent review agents (use the `requesting-code-review` skill), one lens each: data loss / migration safety · append-only violations · time-zone correctness · read-only leaks (any way at all to mutate a past attempt) · API-key exposure · copy tone (shame, guilt, toxic positivity). Each must try to BREAK the claim, not confirm it. Verify every finding yourself before fixing; log rejected findings with the reason. C4 housekeeping after fixes. Use the `verification-before-completion` skill before you claim anything passes.

**3:00 PM CT checkpoint:** if anything in C1–C3 is still red, cut in the order the plan gives (AI price help → Trophy case polish → Settings→Attempts) — never the migration, scoring, or setup flow.

**Ship (C5):** all checks + all E2E green → `git checkout main && git merge --no-ff feat/attempt-2` locally. **Do NOT push.** Then give James this checklist, verbatim, and wait:
1. `! cd ~/Projects/pouch-down && git push` — then tell Claude, who watches the deploy with `gh run watch`.
2. On the phone: open Pouch Down, close it fully, reopen (twice if needed) until the **Front door** appears.
3. Tap **View a past attempt → Attempt 1**. Check: banner says read-only, dates Jul 8 – Sep 5, no fake streak, days after mid-August show "no log". Exit.
4. Settings → **Download full backup** → AirDrop to the Mac (this is the first v2 backup). Tell Claude; Claude verifies it contains attempt a1 with every event and no API key, files it in the vault as `Pouch Down/Backup 2026-09-20 (v2).json`, commits with a `claude:` message.
5. **Start a new attempt** and walk through setup. Day 1 = Mon Sep 21.
If the Front door does not appear or Attempt 1 looks wrong: STOP, do not start setup — the v1 data is untouched and the previous deploy can be restored by reverting the merge.

**After ship:** update `CLAUDE.md` (attempts model, honest scoring, the sacred v1 key, awards derived, no personal data in repo), write the release section of the build log, and draft (do not build) a one-paragraph kickoff for the next spec: **Firebase sync + push reminders, live by Sun 2026-09-27**, and **off-track detection incl. "too good to be true" counts, live by Sun 2026-10-04 — before the first cut on Tue 2026-10-06**, which is where attempt 1 cracked.

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
