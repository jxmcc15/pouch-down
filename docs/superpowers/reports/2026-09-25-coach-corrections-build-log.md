# Build log — coach honesty, day corrections, reasons, chats that come home

**Night of 2026-09-25 → 26** · branch `feat/coach-corrections` (worktree
`/Users/jxm/Projects/pouch-down-corrections`, off `feat/security-hardening` at
`837b337`) · **nothing pushed** · spec:
`docs/superpowers/specs/2026-09-25-coach-honesty-corrections-and-chats-design.md`

## What you asked, and what was actually wrong

You asked the coach to fix day 3 and to let you add reasons to past pouches.
It said yes both times and did nothing. The investigation found:

1. **The coach has no hands.** It is one API call: a system prompt plus your
   messages in, text out. No "tool use" (the API feature that lets a model call
   functions in the app), so it cannot touch the log. Nothing in the prompt
   said so, so a small model did the helpful-sounding thing and agreed.
2. **Your chats were never saved.** They lived in the sheet's React state and
   vanished when it closed. The API has no endpoint to fetch past
   conversations, so what you asked before tonight is gone.
3. **Both asks were real gaps in the app.** Backfill only fills an *unlogged*
   day; the mood tag only works for 15 seconds on the newest pouch. Day 3
   (Thu 2026-09-24) showed 4 pouches on a cap of 10 and read green; you used 10.

## What was built

**Fix this day** (Stats → History pencil, or Calendar → tap a day). One sheet:

- An unlogged past day gets the existing backfill form.
- A logged past day gets a stepper for the real total. It cannot go below the
  timed logs (those pouches happened), and it shows the verdict live: "10 of
  10 — on plan", or "11 of 10 — over, streak breaks; tomorrow's cap doesn't
  change".
- Every timed pouch is tappable for reasons: several chips plus a short note,
  any time after it was logged. Today's pouches too — the 15-second window is
  no longer the only chance.
- Nothing is edited. A correction is a new `correction` event; reasons are new
  `reason` events pointing at the pouch. Latest wins, history keeps every
  version. History shows "Corrected total: 10 (4 timed)".
- The six extra pouches on day 3 have no times, so they count toward the total
  and the money but are not scored early or on time. Day 3 becomes 10 of 10,
  still on plan; the tin math changes.

**Coach chats come home.** Each successful turn is saved on the attempt, so it
rides inside "Download full backup" untouched. `pouch-ingest` now writes
`Pouch Down/Coach Chats.md` beside the Live Log (every string escaped — a
chat can't smuggle a wikilink, a `%%` comment or a `#tag` into the vault), and
its summary and the watcher's "backup filed" message say how many chats are
new. The rule in `CLAUDE.md`: after ingest, Claude reads the note and brings
each request to you. The phone's data is only ever changed in the app.

**Honest coach.** The prompt now says what it can't do, points to Fix this day,
and — because chats are reviewed — asks for the specifics a reviewer needs.
The tagline reads "knows your plan & your log · can't change them". The
prompt is 2,938 characters with a full 7-day log; the proxy allows 16 KB.

## Gates (all run on the final commit)

| Gate | Result |
|---|---|
| `npm test` | 573 passed, 4 skipped (baseline 482 / 4) |
| `npm run lint` | 1 warning, the pre-existing one in `state.jsx` |
| `npm run build` | clean |
| `npm run e2e` | 6/6 walks, 0 console errors (new: `walk-fixday`) |
| `pouch-ingest --dry-run` on a synthetic backup | both notes render, `Coach chats: 2 (0 new)` |

## Your first taps after you pull the build

1. Merge `feat/coach-corrections` (after tonight's authorized push of the
   proxy work, since this branch sits on top of it) and push. Never let a
   session push this for you.
2. Open Stats → find Thu Sep 24 in History → pencil → set Actual total to 10 →
   Save total. The calendar cell and the Live Log update on the next backup.
3. Tap any pouch on that day and give it its reasons.

## What the reviewers caught (and why it matters)

- A reason could attach to a *resisted* event, changing its trigger. Fixed:
  reasons only apply to pouches.
- The sheet's number field clamped every keystroke, so typing "12" gave 40.
  Fixed: it clamps on blur and on save.
- Two crash paths on hostile stored data: a correction with an unparseable
  time, and a note stored as a number. Both guarded — the recovery screen is
  for unreadable storage, not for a sheet that could have checked.
- **The archived-attempt invariant.** Boot-time repair added `chats: []` to
  every attempt, which rewrote Attempt 1 on the next save. The backfill e2e
  walk's byte-identical check caught it. Fixed by making readers treat a
  missing list as empty. Lesson: a "harmless default" that touches stored
  data is a write.
- Chat text was the first free prose to reach the vault; `%%` and `#word` are
  live in Obsidian. `safeText` neutralises both now.

## How the night ran

Seven subagents: five implementers, four reviewers, one final reviewer, each
with a curated brief (they never inherit this session's context). The Task 1
data layer went first; the sheet and the ingest work ran in parallel on
disjoint files; the e2e walk and the coach prompt ran in parallel after. Four
agents stalled on the harness's stream watchdog and were resumed; two of those
fixes were finished by hand. Every review finding was fixed before the next
task started. Coordinator context stayed around 200k tokens; subagents used
roughly 850k between them.

## Open, deliberately

- No in-app view of past chats (YAGNI until the vault note proves the loop).
- The transcript loop is manual: ingest surfaces new chats, a Claude session
  triages them with you. A standing session that pings you on its own is a
  later step.
- Corrected pouches carry no times, so the discipline stats can't score them.
  If that matters, the sheet could ask "roughly when?" later.
- Firebase sync would give Claude a path *to* the phone; until then, all data
  changes are your taps.
