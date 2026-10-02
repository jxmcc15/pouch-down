# Build log — the coach proposes, James confirms (2026-10-01 → 02)

**Branch:** `feat/coach-assistant` (worktree `../pouch-down-coach` off `main` at `55f3091`, the Session G merge) · **Spec:** `docs/superpowers/specs/2026-10-02-coach-assistant-design.md` · **Plan:** `docs/superpowers/plans/2026-10-02-coach-assistant-plan.md` · 29 commits, 24 code files, +3,534 / −123 lines outside `docs/`.

Written for James, who learns by reading these. The first section is the
story; the rest is the evidence.

## What changed, in one breath

Before tonight the coach could only *talk*: "I had one at 4:30" got you a
paragraph and a pointer to Calendar → Fix this day → six taps. Now the coach's
reply can carry a **proposal** — one of eight things the app can log — and the
app draws it as a **card** with the exact day, time and reason it would write.
Your tap calls the same api method the sheets use. The coach then **hears how
it went** ("4:30 is in" / "that one didn't save") in an automatic follow-up
turn, and the saved chat records every proposal and its outcome so the vault
shows what the coach did. The coach never writes anything itself. A past
attempt is sent no tools at all.

The eight verbs: log a pouch now, log a craving resisted now, add a late pouch
(with a time or "unknown"), mark a pouch as a mistake, add a reason, fill a
missed day, correct a day's total, log a morning check-in. There is no verb for
anything on the forbidden list (attempts, plan, quit date, price, meals, token,
key, recovery), so the model cannot even name it.

Also folded in, from Session G's leftovers: the log toast's reason chips are
44px tall like Fix this day's (the SOS chips already were).

## Concepts worth learning

**Model output is untrusted input.** The coach's reply is JSON the model wrote.
We treat it exactly like a backup file someone AirDropped: nothing is
evaluated, nothing is trusted. `src/coachActions.js` is an *allowlist* — it
names the eight tools, the keys each may carry, the type, enum and bounds of
every field, and it refuses anything else, including an unknown key, a
`__proto__` key, a pouch id the app never showed the coach, a day that isn't
on the calendar, a time the spring-forward clock skipped, a note with a bidi
control character. What survives becomes a card drawn **only from validated
values** — the model's words never reach the card, the note is quoted on its
own labelled line so it can't impersonate an app fact, and the model's tool
name is never shown. Then your tap calls the api, whose own guards run a
second time. Two gates, both the app's.

**Tool use is a protocol, not magic.** The Claude API's "tool use" is a shape:
the request lists tools (name + JSON Schema), the reply carries `tool_use`
blocks (`id`, `name`, `input`), and the very next user message *must* answer
every id with a `tool_result` block, results first, before any text. Get one
rule wrong and the API refuses the whole call. So `toTurns` (pure, tested)
builds every conversation we send, and a pin test captures the app's real
request bodies through a stubbed `fetch` and runs them through the Worker's
guard. The follow-up turn — the coach hearing "saved" — is just the
`tool_result` message with no text; the coach's reply to it is its
acknowledgement.

**Async React state will bite you twice.** A reviewer found that with
`AnimatePresence mode="wait"` the *old* Confirm button stays mounted and
clickable for the ~0.3 s exit spring, and its `onClick` closes over stale
state. Double-tap: two pouches. Two fixes, both needed: the card's footer asks
Framer `useIsPresent()` and refuses taps while leaving; the sheet never applies
from a closure — a tap only *enqueues* the card id, and an effect applies it
from committed state, only if it is still `pending`, through a functional
update (`moveCard(cur, id, fromStatus, patch)`). Confirm all applies one card
per render for the same reason: each save must see what the previous one
wrote.

**Tighter where the model could nudge.** The app's own forms let you lower a
correction or fill a day after marking its pouches as mistakes — that's your
honesty, in your hands. The coach's allowlist is deliberately stricter than
the forms: a day whose raw events ever held a pouch can't be filled as missed
from a card; a correction from a card can never lower what the day already
shows; a mistake is never part of Confirm all. The manual path stays yours.

**One clock.** The system prompt now says *Now: Thu 2026-10-01, 21:12* and
lists the live pouches of the last 7 app days with their ids and stamped
wall-clock times, so "4:30 today" resolves to a day and an `HH:MM`, never a
raw timestamp. A reviewer caught that an early version had *two* clocks (the
log lines read the system clock, the Now line read an argument) — with an
explicit `now` the prompt could contradict itself. Dropped the argument.

## Decisions made alone (the spec was silent or wrong)

- **The visible Undo window is 12 s**, like the toast and Fix this day, while
  the api still accepts 15 s — the chip must close before the api would refuse
  so a tap never lands on a closed window. Spec said 15.
- **Worker tool sizes are counted in characters**, not bytes, to match what
  the app measures (`JSON.stringify(x).length`); `bodyBytes` (48 KB) stays the
  hard byte bound. Otherwise an accented note could pass the app and be refused
  by the Worker, bricking the follow-up.
- **An unknown tool name is dropped from the replay** together with its result
  (the live turn still answers it as invalid). Without this, one invented name
  would make the Worker refuse every later request in that chat.
- **The four "now" verbs return `null` when they write nothing.** `logBackfill`
  used to hand back an id for a logged or out-of-plan day while silently
  writing nothing; the spec's "refused by `logBackfill`" was false until
  tonight. A card can now say "Didn't save" honestly.
- **An Undo after the follow-up went out is told in one more plain-text turn**
  ("Undone: Add a pouch · …"), saved with an `undone` outcome. Otherwise the
  coach and the vault would record "saved" for a pouch that no longer exists.
- **The card's second line says only what the headline doesn't** — the first
  screenshots showed "Add a pouch · Thu Oct 1 · 4:30 PM · boredom" over "Thu
  Oct 1 · 4:30 PM · boredom · added later". Now the second line is the
  consequence: "added later", "stops counting · stays in your history",
  "stamped when you confirm".
- **Every reason a card shows is in a person's words** ("that pouch isn't one
  from the last 7 days"), with a test that no reason contains an underscore or
  a schema field name.
- **Header subtitle** is "knows your log · proposes, you confirm" — the longer
  line wrapped with "confirm" alone on line 2 at 390px (measured: 285px against
  266px of room).
- Lanes ran in **one worktree on disjoint files**, staging by explicit path,
  rather than the plan's per-lane worktrees.

## What the reviewers caught

Every task had a fresh Opus stage reviewer (spec compliance, then quality) who
was told not to trust the implementer's report. Several mutation-tested the
code — broke it on purpose in a scratch copy to see which tests noticed.

| Task | Found | Fixed |
|---|---|---|
| 1 coachTools | Tests couldn't tell `localHM` from `ev.ts` (every fixture was Chicago); no test pinned the numeric bounds (changing note 140→200 passed) | Eastern-stamped pouch (→ 09:30); bounds table test |
| 5 saved chats | The updater-side `backfillOk` guard had no test — removing it passed all 750 | Probe test with no render between two calls (fails 1/52 without the guard) |
| 4a Worker | Refusals echoed a user-supplied key; no at-cap tests (`>`→`>=` passed); comment order | Fixed-text refusals; at-limit cases; comment. **Rejected:** a 64-char cap on `tool_use.id` — stricter than the API's own format, could refuse a legal replay |
| 2 validator (security red-team) | **Void every pouch on a day → `nolog` → fill with 0 → green.** Also: cards that always refuse (fill today, correct an unlogged day…); a note like `x” · streak kept · “y` faking facts; `applyAction` throwing | Fill refused for any day whose raw events hold a pouch; api state guards mirrored; control/bidi chars refused + note on its own line; throws → refused |
| 6 ActionCard | **A fading Confirm could save twice**; tool name never asserted absent; URL-like notes clipped; 44 vs 48px buttons | `useIsPresent` footer; test; `overflowWrap: anywhere`; `.btn` 48 kept |
| 3 coach.js | Two clocks in one prompt | One clock |
| 7 CoachSheet | Enter between a write and the next render marked a **saved** pouch `skipped`; a failed typed turn at the chain cap fired an unasked follow-up; "Couldn't reach the coach" right after a save | Send waits for the queue; rollback restores the cap; "Saved — the coach couldn't answer just now." |

**Sol (GPT-5.6, one call, 124 KB curated diff, no identifiers)** — ten
findings, each verified by our runner before anything moved. *Accepted:* a
**lower correction from a card turns an over-cap day green** (2 pouches +
earlier correction to 12, cap 8 → `count: 3` passes → green; now floored at
the day's current total); **Undo after the follow-up is never reported**
(fixed, above); a false comment. *Rejected with reasons:* late pouch after
quit day (by design — the coming "still free" check-in); correction below a
backfill (`timedPouchesForDay` already counts them); duplicate or missing
`tool_use` ids (the API mints them; the guard refuses an empty one anyway);
guard not checking conversation structure (upstream answers 400 with no
generation — cost still bounded); StrictMode double follow-up (effects re-run
only on mount, with no messages); setState after unmount (React 19 no-op, and
saving a reply that arrived is intended). *Noted:* `wellFormedEvent` checks
`ts` is a string, not a date — pre-existing, affects only within-day order.

**Gemini (3.7 Flash, one call, 59 KB: spec sections, the three files in full,
the six screenshots described in words)** — *Accepted:* **one tap could void
five pouches** via Confirm all (two rounds took a 10-pouch day to green 0) →
mistakes never join Confirm all; **Confirm all could approve cards you hadn't
scrolled to** → the row sits under the last card, labelled "Confirm all (2)";
the subtitle orphan; a label on the note line ("your note"). The lower-
correction gap, independently. *Rejected:* "time-unknown pouches aren't
counted by the correction floor" (they are — probe refused); writing outside
the active attempt (status check, the id list, `dayNumberFor ≥ 1`). *Taste,
by design:* Undo only on the newest save (the api can only undo the
just-logged event); typing skips pending cards (your decision; the coach can
re-propose).

## Known limits, for the next build

- A chat of ~20 replies at the 800-token cap would pass the Worker's 61,440
  character bound and be refused with "The conversation is too long." (an
  honest error; chats are fresh each opening; the prompt asks for 2–4
  sentences). Candidate: the sheet trims the oldest turns past a budget.
- Overflow proposals (a sixth card) are answered to the coach but not recorded
  in the saved chat (it holds at most five actions).
- A reply that lands after the sheet closes is still saved to the chat
  (pre-existing).
- The Worker is still dormant (`COACH_PROXY` empty). The guard changes shipped
  tonight so the day you deploy it nothing else moves; the direct session-key
  path is what the phone uses now, with the same body.

## Gates on the final commit (`0da2e82`)

| Gate | Result |
|---|---|
| `npm test` | 36 files, **877 passed**, 4 skipped (baseline 699) |
| `npm run lint` | the one known warning (`src/state.jsx:317`, only-export-components) |
| `npm run build` | clean, then `rm -rf dist/` |
| `npm audit --omit=dev` | 0 vulnerabilities |
| key scan | only the deliberate fake in `walk-recovery.mjs` |
| `npm run e2e` | **8/8 walks in 204.8 s — 1,247 checks, 0 console errors** (migration 190 · setup 157 · backfill 192 · awards 95 · recovery 381 · fixday 53 · latepouch 72 · coach 107) |

The coach walk pins the clock to Thu 2026-10-01, 9:12 PM Chicago, routes
`api.anthropic.com` to scripted replies (no network; the fake key is
`walk-fake-key-not-real` and the walk checks it never reaches localStorage),
and proves: proposal → card → Confirm → one `late: true` pouch with the right
day, zone and `enteredAt` → the follow-up's user turn leads with
`tool_result: saved` → the acknowledgement renders → reload keeps the event
and the saved chat holds `actions` and `outcomes`; Confirm all (2) saves the
two others and leaves the mistake pending, which its own Confirm then voids;
Skip; six proposals (a foreign id invalid, the sixth never drawn, typing
"never mind" skips the rest and the results lead the typed turn); a refused
card (Undo the 5:00 PM pouch, then confirm "mark it"); an Undo after the
follow-up produces a plain "Undone: …" turn; the archived viewer has no coach
button; all ten recorded bodies pass the Worker's `checkBody`.

Six 390px screenshots were taken into the scratchpad (never the repo) and
read by the coordinator: pending card, saved card, Confirm all (2) with a
skipped mistake above and "mistakes need their own tap" below, saved +
skipped pair, invalid card, the viewer without a coach.

## How the night ran

Twenty-six agent runs: ten implementers (seven called back for review fixes,
some three times), eight stage reviewers, two outside-review runners, one plan
writer — who, unasked, built the whole plan in a scratch copy first and ran
every gate on it, so the plan's code was real before any implementer saw it.
Windows: {1, 4a, 5} → {2, 6} → {3, 8, reviews} → {4b, 7} → 9 → outside reviews
→ fixes → walk → gates. Every brief was curated — the task's plan lines by
range, the files it owned, the shared rules file, its own 300k ceiling — and
no agent inherited this session's context. Every review finding was fixed
before its lane's next task started; every outside-review claim was reproduced
or rejected with a reason before anything changed. Coordinator context stayed
near 200k tokens; subagents used roughly 2.9M between them.

## Shipped

Merged into `main` and pushed on James's one-time authorization for this
branch (given 2026-10-01 with the four front-loaded answers), after every
gate and both outside reviews came back green.

Your first taps: open the coach, type "had one at 4:30 I forgot, boredom",
and watch the card. Confirm it. Then open Stats → History and look at the row,
and tonight's Coach Chats note in the vault after the next backup.
