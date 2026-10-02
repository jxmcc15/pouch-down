# The coach as app assistant — proposes, James confirms

**Date:** 2026-10-02 · **Status:** approved by James 2026-10-01 (scope in the late-pouch spec's "Build 2" section + four answers that night), built unsupervised the same night
**Branch:** `feat/coach-assistant` (worktree `../pouch-down-coach` off `main` at `55f3091`, the Session G merge)
**Builds on:** `2026-10-01-late-pouch-and-mistake-design.md` (Build 1) and `2026-09-25-coach-honesty-corrections-and-chats-design.md` (saved chats)

## The problem

The coach knows the plan and the log but can only *talk*. When James says "I had one at 4:30 I forgot to log" the coach has to send him to Calendar → tap the day → Fix this day → Add a pouch → time wheel → reason → Save. Six taps to record a sentence he already typed. Build 1 made every one of those taps one api method; this build lets the coach propose the method call and James confirm it with one tap — without the coach ever writing anything itself.

## What James decided

Recorded on 2026-10-01 in the Build 2 section of the late-pouch spec:

- **The coach only ever proposes.** Its reply carries a structured action (Claude tool use). The app validates it against a strict allowlist, never evaluates text, shows a card with the exact day, time and reason it would write, and James's tap calls the same api method the sheets use. Model output is untrusted input, like a backup file.
- **Never, even with a confirm card:** start or end an attempt, change the plan or quit date, change the device token or session key, touch the recovery path, or edit price and meal times.
- **The Worker changes with it:** `guard.js` learns `tools`, array content, `tool_result` blocks and a higher `max_tokens`, each clamped and tested, in the same change as the prompt.
- **The prompt gets the current local time**; the coach returns an app day and a wall-clock `HH:MM` (or null), never an instant. The app stamps the zone.
- **Saved chats record proposed and confirmed actions** so the vault shows what the coach did.

Answered the same night, after Session G shipped:

1. **Up to 5 cards per reply**, each with Confirm / Skip, plus **Confirm all** when there is more than one. A sixth proposal is refused and the coach is told to ask James to split it up.
2. **Automatic follow-up turn** once every card from a reply is resolved, so the coach can say "4:30 is in" — and can say honestly when a save was refused. One call per batch, not per card.
3. **Ship:** merge + push to main when `npm test`, lint, build, e2e and both outside reviews are green. One-time authorization for this branch.
4. **Fold in one Session G leftover:** reason chips 44px tall on the log toast and the SOS overlay, matching Fix this day. (The no-minutes late verdict and the "N marked" badge were declined.)

## Not in this build

- No editing of a card's values. A wrong proposal is skipped and corrected in chat; the coach re-proposes. (Keeps the card a receipt, not a form.)
- No streaming, no model change (Haiku 4.5 stays), no new settings, no new storage key.
- No Worker deployment. The proxy stays dormant (`COACH_PROXY` empty); the guard changes ship so the day it is deployed nothing else moves. Both transports post the identical body.
- No proposal of anything on the forbidden list — there is no tool for it, so the model cannot even name it.
- Nothing James-specific: triggers come from `triggers.js`, days and caps from the attempt.

## The eight verbs

One Claude tool per api method. Names are the model's vocabulary; `verb` is the api method the app calls. Every input field is required unless marked optional; an unknown field fails validation.

| Tool | Input | api | Card headline |
|---|---|---|---|
| `log_pouch_now` | `trigger?` ∈ TRIGGERS | `logPouch(trigger)` | Log a pouch now · *trigger* |
| `log_resisted_now` | `trigger?` | `logResisted(trigger)` | Log a craving resisted · *trigger* |
| `add_late_pouch` | `day` `YYYY-MM-DD`, `time` `HH:MM` or null, `triggers` ∈ TRIGGERS[] (≤6, unique), `note` ≤140 | `logLatePouch({ day, time, triggers, note })` | Add a pouch · Thu Oct 1 · 4:30 PM · boredom |
| `mark_mistake` | `pouch_id` from the list the prompt showed | `voidPouch(id)` | Mark as mistake · the 2:14 PM pouch on Thu Oct 1 |
| `add_reason` | `pouch_id`, `triggers`, `note` (at least one non-empty) | `logReason({ target, triggers, note })` | Add a reason · 2:14 PM pouch · stress |
| `fill_missed_day` | `day`, `count` int ≥0, `streak` `keep`/`break` | `logBackfill({ day, count, streak })` | Fill in Tue Sep 29 · 7 pouches · streak kept |
| `correct_day_total` | `day`, `count` int ≥0 | `logCorrection({ day, count })` | Correct Tue Sep 29 · total 9 |
| `log_checkin` | `sleep_hours?` 0–16 (one decimal), `sleep_quality?` 1–5 int, `workout?` bool (≥1 present) | `logCheckin({ sleepHours, sleepQuality, workout })` | Morning check-in · 6.5h · 3/5 · workout |

`fill_missed_day` mirrors `BackfillForm`: a count over the cap breaks the streak whatever the model said (the card shows "streak breaks: over cap"); within cap the model must have asked James which he wants — the prompt says so — and the card shows the choice.

`pouch_id` must be an id in the **live** (unvoided) pouch list of the active attempt for the last 7 app days, which is exactly the list the prompt shows. Anything else is invalid before it reaches a card.

## Architecture

Three new pure modules, one new component, one changed component, the Worker guard, the ingest. Nothing in scoring changes.

### `src/coachTools.js` — the vocabulary (pure, no React, no network)

- `TOOLS`: the eight Claude tool definitions (`name`, `description`, `input_schema` with `additionalProperties: false`), built from `TRIGGERS` so the enum can't drift.
- `TOOL_NAMES`, `MAX_PROPOSALS = 5`, `MAX_TOKENS = 800`.
- `livePouchesForPrompt(state, now)` → `[{ id, day, time: 'HH:MM' | null, trigger }]` for the last 7 app days from `liveEvents`, newest first, capped at 60 rows. Untimed pouches show `time: null`.
- `promptClock(now)` → `{ day, time: 'HH:MM', weekday }` from the app day (4am rule) and local wall clock.

### `src/coachActions.js` — the allowlist (pure)

- `validateProposal(state, { id, name, input }, now)` → `{ ok: true, action: { toolUseId, name, verb, args, summary } }` or `{ ok: false, toolUseId, name, reason }`. Strict: name ∈ TOOL_NAMES; input is a plain object with only the schema's keys; each field typed, enum'd, bounded; `day` a real calendar day, ≥ Day 1, ≤ today; `time` matches `TIME_RE` and `resolveLate` accepts it (not future, not a DST gap); `pouch_id` ∈ `livePouchesForPrompt`; note trimmed and ≤ 140; `count` integer 0–60; `sleep_hours` 0–16. `summary` is the card headline, built with `fmtHM` / weekday+month+day from the app day — never `ev.ts` in the reader's zone.
- `takeProposals(state, contentBlocks, now)` → `{ cards: [...first 5 validated or invalid], overflow: [tool_use ids past 5] }`. Order preserved.
- `outcomeResult(card)` → the `tool_result` block the coach gets back: `{ type: 'tool_result', tool_use_id, content: 'saved' | 'refused: <reason>' | 'skipped by the user' | 'invalid: <reason>', is_error?: true }`. Overflow gets `invalid: more than 5 actions in one reply — ask the user to split them up`.
- `applyAction(api, action)` → `{ outcome: 'saved', eventId } | { outcome: 'refused', reason }`: calls `api[verb](...args)`; a `null` return is `refused` ("the app wouldn't save it — it may already be logged, or the day isn't in this attempt"). This is the only place a verb is called, and the api's own guards run again inside it.

### `src/coach.js` — the request (changed)

- `askCoach(state, turns, apiKey, now)` posts `{ model, max_tokens: 800, system, tools: TOOLS, messages }`. `turns` is the conversation as content-block messages; text-only turns stay `content: string` so the body is unchanged for a chat with no actions.
- Returns `{ text, proposals: [{ id, name, input }], stopReason }` — every `text` block joined with a blank line, every `tool_use` block as a proposal, in order. `…` when both are empty.
- The system prompt gains **Now** (`promptClock`), the **live pouch list** (ids + times, "these ids are the only ones you may name"), and the **tool rules**:
  - Propose only what the user clearly asked for or clearly stated as a fact. A guess is a question, not a card.
  - Never `mark_mistake` unless the user says a tap was an accident. Never `add_late_pouch` for a pouch already in the list.
  - Give a day as `YYYY-MM-DD` and a time as `HH:MM` 24h on that day; "4:30" in the evening means 16:30; before 4 AM belongs to the previous app day (the app handles it — just name the day the user means). Use null when the user doesn't remember the time.
  - `fill_missed_day` within cap: ask whether the streak keeps or breaks before proposing, unless the user said.
  - At most 5 actions in a reply. Say in one short sentence what each card does; the card is the confirmation, so never claim it is done.
  - After a tool result: one short line. "4:30 is in." / "That one didn't save — the app says it's already logged." Nothing is done until the result says `saved`.
- The old "you cannot add, change…" paragraph becomes "you can propose these actions; the user confirms each on a card; you can't change settings, the plan, or the attempt".
- A past attempt (`status === 'archived'`) sends **no `tools`** — history is read-only; the prompt keeps the old wording there.

### `src/components/ActionCard.jsx` — the receipt (new)

A frosted card inside the chat stream, under the coach's text bubble, one per proposal:

- Icon per verb (lucide), headline = `summary`, a second faint line with the facts the app will write (day, time or "time unknown", triggers, note, streak), always from the validated `args`, never from model text.
- **Pending:** `Confirm` (accent, 44px) · `Skip` (ghost, 44px). When more than one card of a reply is pending, a `Confirm all` row sits above the first card.
- **Saved:** green check, "Saved", a `Undo` chip for 15 s when `eventId` is the just-logged event (the same `api.undoEvent` window; the chip disappears when the window closes). Undo marks the outcome `undone` on the card and in the follow-up result.
- **Refused:** amber, "Didn't save — <reason>". **Skipped:** muted, struck headline. **Invalid:** muted, "The coach proposed something the app can't do", reason in a faint line, no buttons.
- Motion: height spring like `ReasonEditor`; state changes crossfade; `?static` and reduced motion honoured.
- Buttons disabled while `busy`; a resolved card never offers a second confirm.

### `src/components/CoachSheet.jsx` — the flow (changed)

- Messages become `{ role, text, cards? }` for display; the API conversation is held separately as `turns` (content blocks), built by a pure `toTurns(messages)` in `coachActions.js` so the test can pin the exact body.
- **Send:** optimistic user bubble → `askCoach` → coach bubble + cards (via `takeProposals`). Save the turn (`appendChatTurn` with `actions`).
- **Resolve:** Confirm → `applyAction` → card state; Skip → `skipped`; Confirm all → confirm each pending card in order, stopping at the first refusal (the rest stay pending). When no card of the latest coach turn is pending → **follow-up:** a user turn whose content is only the `tool_result` blocks → `askCoach` → coach bubble (and cards, if any — a chain is capped at 3 automatic rounds; after that, pending cards resolve only when James types). Saved as a turn whose user text is the human rendering of the outcomes ("Confirmed: Add a pouch · 4:30 PM · boredom / Skipped: Mark as mistake …") with `outcomes`.
- **Typing while cards are pending** resolves them as `skipped` first; their `tool_result` blocks lead the next user turn's content, then the text.
- **Errors:** the coach bubble and cards from a failed follow-up roll back like today (the resolved card states stay — the events are saved). A failed save (`refused`) is a card state, never a thrown error.
- Header copy: "knows your plan & your log · proposes, you confirm". Quick chips gain "I forgot to log one" and "That last tap was a mistake".
- Read-only (past attempt): no cards ever render; `takeProposals` isn't called because no tools were sent.

### Saved chats (`state.jsx`, `root.js`, `ingest.js`)

```
chat.messages[i] = { role, text, ts,
  actions?:  [{ name, summary }],                            // on a coach message that proposed
  outcomes?: [{ name, summary, outcome, reason? }] }         // on the synthetic user message of a follow-up
```

- `appendChatTurn(chatId, { user, assistant, actions?, outcomes? })`: arrays validated (≤5, each field a bounded string, `outcome` ∈ saved/refused/skipped/invalid/undone), dropped when malformed, never a throw. The follow-up's `user` text is generated by the app (so it is never blank) — `renderOutcomes(outcomes)` in `coachActions.js`.
- `wellFormedChat`: absent arrays fine; present arrays must be well-formed. Tests for each branch.
- Ingest: under a coach message, one line per action `  - ↳ proposed: Add a pouch · Thu Oct 1 · 4:30 PM · boredom`; under the follow-up `  - ✓ saved: … / ✗ refused: … (reason) / – skipped: …`, all through `safeText`.

### The Worker (`workers/coach-proxy/src/guard.js`, `worker.js`)

Same change, same commit as the prompt. `LIMITS` becomes: `fields` + `tools`; `maxTokens 800`; `bodyBytes 48 KB` (the tool definitions and a 7-day pouch list are ~6 KB of a body that already held a 60k-char conversation — the old 16 KB was never consistent with `totalChars`); `tools ≤ 8`, names ∈ `TOOL_NAMES` (its own copy, pinned equal to the app's by a test in `src/__tests__`), each tool only `name`/`description`/`input_schema`, description ≤ 1 KB, `input_schema` ≤ 4 KB serialised; a message's `content` is a non-empty string **or** an array of 1–12 blocks: `text` (`text` string), `tool_use` (assistant only: `id`, `name` ∈ TOOL_NAMES, `input` object ≤ 2 KB serialised), `tool_result` (user only: `tool_use_id`, `content` string ≤ 500, optional boolean `is_error`); any other key or type refused; every string counted toward `totalChars`. Tests for each new refusal and for the exact body the app sends (fixture shared with `coach.test.js`).

### 44px chips

`LogToast.jsx` `chipStyle` and the SOS overlay's trigger chips get `minHeight: 44`, padding to match Fix this day's. Nothing else moves; `renderGuards` pins the height.

## Data flow, end to end

1. James: "had one at 4:30 I forgot, boredom".
2. Request: system (plan, log, Now 21:12 on 2026-10-01, pouch list), `tools`, messages.
3. Reply: text "Here's that 4:30 one — confirm and it's in." + `tool_use add_late_pouch { day: '2026-10-01', time: '16:30', triggers: ['boredom'], note: '' }`.
4. `takeProposals` validates; a card renders: **Add a pouch · Thu Oct 1 · 4:30 PM · boredom**.
5. Confirm → `api.logLatePouch(...)` (resolveLate stamps the zone) → `saved`, Undo chip for 15 s.
6. Follow-up: user turn `[tool_result saved]` → "4:30 is in." Saved chat: coach message with `actions`, synthetic user message "Confirmed: Add a pouch · Thu Oct 1 · 4:30 PM · boredom" with `outcomes`, coach "4:30 is in."
7. Backup → vault: Coach Chats shows the proposal and the outcome; Live Log shows the pouch.

## Security

- The model names actions; the app decides. Validation is an allowlist on names, keys, types, enums, bounds; ids must come from the list the app itself produced; the api's guards run again on Confirm. A model that returns `voidPouch` on a pouch of another attempt, a future day, an eleventh trigger, or a 5 KB note gets an `invalid` card and an `is_error` tool result — never an event.
- Nothing new is stored on the device. No key, no token movement. The direct and proxy bodies are identical and both are capped by the Worker's clamps (and by `max_tokens 800` on the direct path).
- A past attempt gets no tools. `readOnly` state can't produce a card.
- The outside red-team question for Gemini: can any sequence of proposals make a day read better than the log — e.g. void a real pouch then "fill" the day? (It can't: a void needs James's tap on a card that names the pouch's time; `fill_missed_day` is refused by `logBackfill` on a logged day; and both are events in the history the vault shows.)

## Tests (written first, each task)

- `coachTools.test.js`: eight tools, enums from TRIGGERS, `additionalProperties: false` everywhere; `livePouchesForPrompt` drops voided and older-than-7-days pouches, untimed show null, order and cap; `promptClock` at 03:59 vs 04:00.
- `coachActions.test.js`: the validation matrix per tool (good, each bad field, unknown key, wrong type, out-of-range, foreign id, future day, DST-gap time, past-quit day allowed for `add_late_pouch`), overflow at 6, `toTurns` exact shapes (string content for text-only turns; blocks otherwise; tool_results lead a typed turn), `applyAction` with a fake api returning id / null, `renderOutcomes`.
- `coach.test.js`: body has `tools` and `max_tokens 800` for an active attempt and no `tools` for an archived one; reply parsing (text + 2 tool_use, text-only, tool_use-only); the prompt names Now and the ids; the forbidden verbs are not words in the tools.
- `store.test.js` / `root.test.js`: `appendChatTurn` with actions/outcomes, malformed arrays dropped, `wellFormedChat` branches.
- `ingest.test.js`: action and outcome lines rendered and escaped.
- `guard.test.js`: every new clamp, the app's exact bodies accepted (text-only, with tools, follow-up with tool_results), `tool_use` in a user message refused, `tool_result` in an assistant message refused, 13 blocks refused, body at 48 KB + 1 refused.
- `renderGuards.test.js`: ActionCard states; chips ≥ 44px in toast and SOS.
- `scripts/e2e/walk-coach.mjs`: Playwright routes `api.anthropic.com/v1/messages` to scripted replies (no network, no key of value — the walk types a fake key into Settings); proves: proposal → card → Confirm → event appended with the right `day`/`tzOffsetMin` and `late: true` → follow-up request body carries the `tool_result` → coach line renders → reload keeps the event and the saved chat has `actions`/`outcomes` → Skip and Confirm all → an invalid proposal (foreign id) renders without a Confirm and writes nothing → typing while pending skips → past attempt sends no `tools`. Zero console errors.

## Gates

`npm test` green · `npm run lint` at the one known warning · `npm run build` clean then `rm -rf dist/` · `npm run e2e` 8/8 with zero console errors · the Worker's own `npm test` green · after-screenshots at 390px of the coach sheet with a pending card, with Confirm all, and with a saved + skipped pair, into the scratchpad · Sol (GPT-5.6) code review of `git diff main...HEAD` · Gemini design + security red-team on the sheet, the card and the validation module. Then merge + push (authorized 2026-10-01 for this branch).
