# The coach as app assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coach can propose the same writes Fix this day makes — a pouch now, a craving resisted, a remembered pouch with its time, a mistake, a reason, a missed day, a corrected total, a check-in — as cards in the chat; James's tap on Confirm calls the same api method the sheets call, the coach hears how each card ended in one follow-up turn, and the saved chat records every proposal and outcome. The model never writes anything itself.

**Architecture:** Two new pure modules carry all the logic. `src/coachTools.js` is the vocabulary: the eight Claude tool definitions (built from `TRIGGERS`), the caps, the live pouch list the prompt prints (`livePouchesForPrompt`) and the prompt's clock (`promptClock`). `src/coachActions.js` is the allowlist: `validateProposal` turns one `tool_use` into an action (exact keys, types, enums, bounds, days the attempt has, ids only from the prompt's own list) or a reason; `takeProposals` makes a reply's cards; `applyAction` is the one place a verb is ever called; `outcomeResult`/`resultsFor` are what the coach is told; `toTurns` builds the Messages API conversation from the sheet's messages. `src/coach.js` sends `tools` (never for a past attempt) and splits the reply into words and proposals. `src/components/ActionCard.jsx` is a pure-props receipt; `CoachSheet.jsx` owns the card states, Confirm all (one card per render), the automatic follow-up (capped at 3 in a row) and skip-on-typing. The Worker's guard learns tools and content blocks in the same change, pinned to the app by a test that runs the app's real bodies through `checkBody`.

**Tech Stack:** Vite + React 19 + Framer Motion, vanilla JS (no TypeScript), lucide-react, Vitest (Node, `TZ=America/Chicago`, `include: ['src/**/*.test.js', 'workers/**/*.test.js']`), Playwright-core walks in `scripts/e2e/`.

**Spec:** `docs/superpowers/specs/2026-10-02-coach-assistant-design.md` — every section is decided; do not re-ask.

**Rules that bind every task** (from CLAUDE.md and the spec): model output is untrusted input — nothing evaluates it, nothing writes without James's tap; append-only — `undoEvent` and `tagEvent` stay the only mutations; silence is never success; nothing James-specific in code or tests, synthetic data only, no real-looking key in anything new (the walk's fake key never starts with `sk-ant-`; `parseBackup` refuses any backup containing that prefix); bucket by `dayKeyOf`, display by `fmtTime`/`localHM`/`fmtHM`, never `ev.ts` in the reader's zone; tests run pinned to America/Chicago; never push (the one exception is Task 10's coordinator merge + push, authorized once for this branch); never touch the repo's `dist/` (walks build into their own folder); no web fetches, and nothing ever sends a name, email or identifier of James anywhere; comments explain *why* in the voice of the existing files; no dead code, no unused imports, no `// TODO`. Lint gate: `npm run lint` prints exactly the one known warning (`src/state.jsx` only-export-components) — the plugin also runs `react-hooks(exhaustive-deps)`, which is why the sheet's effects list every dependency and keep their helpers at module level.

**Baseline** (this worktree at `6427788`): `npm test` → 32 files, 699 passed, 4 skipped. `npm run e2e` → 7 walks.

**How to read the code blocks:** a ```` ```js ````/```` ```jsx ```` block under "Create" or "Write the whole file" is the complete file. A ```` ```diff ```` block is a unified diff against this worktree at `6427788` — every one was checked with `git apply --check`; save it to a file outside the repo and `git apply` it, or make the same edit by hand. Diffs within one task touch disjoint files, so their order inside a task doesn't matter.

---

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/coachTools.js` (new) | `TOOLS`, `TOOL_NAMES`, caps (`MAX_PROPOSALS`, `MAX_TOKENS`, `NOTE_MAX`, `COUNT_MAX`, `TOOL_INPUT_MAX`, `RESULT_MAX`), `livePouchesForPrompt`, `promptClock`, `fmtAppDay` | 1 |
| `src/__tests__/coachTools.test.js` (new) | the vocabulary, the pouch list, the 4am clock | 1 |
| `src/coachActions.js` (new) | `validateProposal`, `takeProposals`, `outcomeResult`, `overflowResult`, `resultsFor`, `applyAction`, `toTurns`, `actionsOf`, `outcomesOf`, `renderOutcomes`, `REFUSED` | 2 |
| `src/__tests__/coachActions.test.js` (new) | the validation matrix, overflow, results, `applyAction`, `toTurns` shapes, the saved record | 2 |
| `src/coach.js` | `askCoach(state, turns, apiKey, now)` sends `tools` + `max_tokens 800`; prompt gains Now, the pouch list, the tool rules; reply → `{ text, proposals, stopReason }` | 3 |
| `src/__tests__/coach.test.js` | body with/without tools, reply parsing, prompt pins (existing tests move to the new signature) | 3 |
| `workers/coach-proxy/src/guard.js` | `TOOL_NAMES`, new `LIMITS`, tools + content-block validation | 4 |
| `workers/coach-proxy/__tests__/guard.test.js` | every new clamp; the app's body shapes as literals | 4 |
| `src/__tests__/coachProxyPin.test.js` (new) | Worker `TOOL_NAMES`/`LIMITS` pinned to the app; the app's REAL bodies pass `checkBody` | 4 |
| `workers/coach-proxy/README.md` | limits table, status table, how the tests run | 4 |
| `src/root.js` | `CHAT_OUTCOMES`, `wellFormedChatAction`, `wellFormedChatOutcome`; `wellFormedMessage` accepts `actions`/`outcomes` | 5 |
| `src/state.jsx` | `appendChatTurn` with `actions`/`outcomes`; `logBackfill` checks before it writes (`backfillOk`); `logPouch`/`logResisted`/`logCheckin` return null when nothing may change | 5 |
| `src/ingest.js` | Coach Chats renders proposal and outcome lines | 5 |
| `src/__tests__/corrections.test.js`, `src/__tests__/root.test.js`, `src/__tests__/ingest.test.js` | the saved record, the api's honest nulls, the shape gate, the vault lines | 5 |
| `src/components/ActionCard.jsx` (new) | the card: pending / saved (+ Undo) / refused / skipped / undone / invalid | 6 |
| `src/__tests__/renderGuards.test.js` | ActionCard states, 44px; chips 44px in toast and SOS | 6, 8 |
| `src/components/CoachSheet.jsx` | turns, send, cards, Confirm all, follow-up, skip-on-typing, header copy, two quick chips | 7 |
| `src/components/LogToast.jsx`, `src/components/SOSOverlay.jsx` | 44px chips | 8 |
| `scripts/e2e/walk-coach.mjs` (new), `scripts/e2e/run-all.mjs` | the eighth walk, routed fake API | 9 |
| `CLAUDE.md` | domain rules for the assistant | 10 |
| `docs/superpowers/reports/2026-10-02-coach-assistant-build-log.md` (new, coordinator) | the report | 10 |

`vite.config.js` does **not** change: the CSP's `connect-src` already allows `https://api.anthropic.com` (and the proxy origin when one is configured); nothing in this build loads or calls anything new.

## Lanes

| Lane | Tasks | Can start | Waits for |
|---|---|---|---|
| A | 1 → 2 → 3 | now | — (each waits for the one before) |
| B | 4 (Steps 1–6) | now | — |
| B | 4 (Steps 7–9, the pin test) | after 3 | Tasks 1–3 (imports `coachTools`, `coachActions`, `coach`) |
| C | 5 | now | — |
| D | 6 | after 2 | Task 2 (the action shape; ActionCard imports nothing from it) |
| E | 8 | after 6 | Task 6 (both edit `renderGuards.test.js`'s imports) |
| — | 7 | after 3, 5, 6 | `askCoach`'s new shape, the api's honest nulls, `ActionCard` |
| — | 9 | after 7 (and 8) | the sheet |
| — | 10 | after 9 | everything |

Parallel windows: {1, 4a, 5} → {2, 4a, 5} → {3, 6} → {4b, 8} → 7 → 9 → 10. Each lane works in its own worktree off `feat/coach-assistant` and the coordinator merges in task order; the only shared file across parallel tasks is `renderGuards.test.js` (6 then 8, sequenced above).

---

## The Messages API shapes this build relies on

Written once here; every task's code follows them.

- **Request:** `{ model, max_tokens, system, tools?, messages }`. `tools` is `[{ name, description, input_schema }]`, `input_schema` a JSON Schema object. The app sends `tools` only for an active attempt; a past attempt's body has no `tools` key at all.
- **Response:** `content` is a list of blocks: `{ type: 'text', text }` and `{ type: 'tool_use', id, name, input }` (`id` like `toolu_…`, `input` an object). `stop_reason` is `'tool_use'` when the reply ends on tool calls (`'end_turn'`, `'max_tokens'` otherwise).
- **Answering:** the very next user message must contain one `{ type: 'tool_result', tool_use_id, content, is_error? }` block for **every** `tool_use` id of the assistant turn before it, and those blocks come **first** in that message's `content` array, before any `text` block. `content` here is a string; `is_error: true` marks a result the model must not report as done.
- **Replaying:** an assistant turn that contained `tool_use` is sent back in the history as a content array — its `text` block (omitted when the words were empty; the API refuses an empty text block) followed by its `tool_use` blocks, unchanged. A turn with no tool use stays `content: string`, so a chat with no actions sends exactly the body it sent before this build (plus `tools`).

## The api methods a card calls (verified in `src/state.jsx`)

| Verb | Returns | Refuses (→ `null`) — after Task 5 |
|---|---|---|
| `logPouch(trigger)` | event id | nothing editable (past attempt on screen, unreadable storage). Before Task 5 it returned an id even then. |
| `logResisted(trigger)` | event id | same as `logPouch` |
| `logLatePouch({ day, time, triggers, note })` | pouch id | `latePouchOk`: bad/unreal day, day after today, before Day 1, bad/future/DST-gap time, bad triggers or note; not editable |
| `voidPouch(id)` | void id | `voidable`: not a pouch of this attempt, already voided; not editable |
| `logReason({ target, triggers, note })` | reason id | `reasonFields`: target not a pouch here, bad triggers/note, both empty; not editable |
| `logBackfill({ day, count, streak })` | backfill id | `backfillOk` (new): bad input, today or later, outside Day 1…totalDays, day already logged; not editable. Before Task 5 it returned an id for a logged or out-of-plan day while the updater silently wrote nothing — the spec's "`fill_missed_day` is refused by `logBackfill` on a logged day" was not true until Task 5. |
| `logCorrection({ day, count })` | correction id | `correctionOk`: today or later, unlogged, outside the plan, count below the timed pouches; not editable |
| `logCheckin({ sleepHours, sleepQuality, workout })` | checkin id | nothing editable (same as `logPouch`) |

Undo: `api.undoEvent(id)` removes the newest event only, only inside `UNDO_WINDOW_MS` (15 s) of `enteredAt ?? ts`. The card shows its Undo chip for 12 s (`UNDO_WINDOW_MS - 3000`), the same convention as the log toast and Fix this day, so a tap as the chip leaves still lands.

---

## Shared fixture (Tasks 1 and 2)

```js
const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });
const NOW = Date.parse('2026-10-01T21:12:00-05:00'); // Thu 9:12 PM CDT — app day 2026-10-01
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => vi.useRealTimers());
```

The api tests (Task 5) use the synchronous-hook harness already in `src/__tests__/corrections.test.js` (a hoisted fake `useState`/`useMemo`/`useEffect`/`useContext`, `vi.mock('react', …)`, then `app = () => fake.render(AppStateProvider, { children: null }).props.value`, `seed(root)` into a stubbed `localStorage`, `T0 = 2026-09-24T15:00:00Z`, a 30-day plan from 2026-09-01). `appendChatTurn`'s tests already live there — not in `store.test.js`, which has no provider harness — so the new ones join them. Render tests (Tasks 6 and 8) use `renderGuards.test.js`'s harness: `vi.mock('../state.jsx', () => ({ useApp: () => ({ state: app.state, tick: 0, readOnly: false }) }))` and `renderToStaticMarkup(createElement(Component, props))`.

---

### Task 1: `src/coachTools.js` — the vocabulary (Lane A)

**Files:**
- Create: `src/coachTools.js`
- Create: `src/__tests__/coachTools.test.js`

- [ ] **Step 1: Write the failing test — `src/__tests__/coachTools.test.js`**

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOOLS, TOOL_NAMES, MAX_PROPOSALS, MAX_TOKENS, livePouchesForPrompt, promptClock, fmtAppDay } from '../coachTools.js';
import { TRIGGERS } from '../triggers.js';
import { generatePlan } from '../planGenerator.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });
const NOW = Date.parse('2026-10-01T21:12:00-05:00'); // Thu, 9:12 PM CDT — app day 2026-10-01
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => vi.useRealTimers());

describe('TOOLS — the eight verbs and nothing else', () => {
  it('names exactly the eight tools, in the spec order', () => {
    expect(TOOL_NAMES).toEqual(['log_pouch_now', 'log_resisted_now', 'add_late_pouch', 'mark_mistake', 'add_reason', 'fill_missed_day', 'correct_day_total', 'log_checkin']);
    expect(MAX_PROPOSALS).toBe(5);
    expect(MAX_TOKENS).toBe(800);
  });
  it('every tool is name + description + input_schema, and every schema is closed', () => {
    for (const t of TOOLS) {
      expect(Object.keys(t)).toEqual(['name', 'description', 'input_schema']);
      expect(t.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
      for (const r of t.input_schema.required) expect(Object.keys(t.input_schema.properties)).toContain(r);
    }
  });
  it('every trigger enum is the app\'s TRIGGERS list, so the two cannot drift', () => {
    const enums = JSON.stringify(TOOLS).match(/"enum":\[[^\]]*\]/g).filter((e) => !e.includes('keep'));
    expect(enums.length).toBeGreaterThan(0);
    for (const e of enums) expect(e).toBe(`"enum":${JSON.stringify(TRIGGERS)}`);
  });
  it('no tool reaches the forbidden list', () => {
    for (const name of TOOL_NAMES) expect(name).not.toMatch(/attempt|plan|quit|setting|token|key|recover|price|meal|cost|undo|tag_event/);
    const all = JSON.stringify(TOOLS);
    for (const word of ['startAttempt', 'archiveActive', 'updateSettings', 'updateDevice', 'startFresh', 'quit date', 'apiKey']) expect(all).not.toContain(word);
  });
});

describe('livePouchesForPrompt', () => {
  it('lists live pouches of the last 7 app days, newest first, with wall-clock HH:MM', () => {
    const old = ev('pouch', '2026-09-24', { ts: '2026-09-24T14:00:00.000Z' }); // 8 app days back
    const a = ev('pouch', '2026-09-25', { ts: '2026-09-25T14:00:00.000Z' });
    const b = ev('pouch', '2026-10-01', { ts: '2026-10-01T13:30:00.000Z' });
    const c = ev('pouch', '2026-10-01', { ts: '2026-10-01T19:14:00.000Z', trigger: 'stress' });
    const r = ev('resisted', '2026-10-01');
    expect(livePouchesForPrompt(attempt([old, a, b, c, r]), NOW)).toEqual([
      { id: c.id, day: '2026-10-01', time: '14:14', trigger: 'stress' },
      { id: b.id, day: '2026-10-01', time: '08:30', trigger: null },
      { id: a.id, day: '2026-09-25', time: '09:00', trigger: null },
    ]);
  });
  it('drops a voided pouch; an untimed pouch shows time null; a reason\'s triggers win', () => {
    const p = ev('pouch', '2026-09-30', { ts: '2026-09-30T15:00:00.000Z' });
    const v = { ...ev('void', '2026-09-30'), target: p.id };
    const u = ev('pouch', '2026-09-29', { ts: '2026-10-01T20:00:00.000Z', late: true, timeKnown: false, enteredAt: '2026-10-01T20:00:00.000Z', ctx: null });
    const q = ev('pouch', '2026-09-29', { ts: '2026-09-29T15:00:00.000Z', trigger: 'coffee' });
    const why = { ...ev('reason', '2026-09-29'), target: q.id, triggers: ['boredom', 'social'], note: '' };
    expect(livePouchesForPrompt(attempt([p, v, u, q, why]), NOW)).toEqual([
      { id: u.id, day: '2026-09-29', time: null, trigger: null },
      { id: q.id, day: '2026-09-29', time: '10:00', trigger: 'boredom, social' },
    ]);
  });
  it('a 1:30 AM pouch belongs to the app day before, and shows its own wall clock', () => {
    const late = ev('pouch', '2026-09-30', { ts: '2026-10-01T06:30:00.000Z' }); // 1:30 AM CDT on Oct 1 = app day Sep 30
    expect(livePouchesForPrompt(attempt([late]), NOW)).toEqual([{ id: late.id, day: '2026-09-30', time: '01:30', trigger: null }]);
  });
  it('caps the list at 60 rows', () => {
    const many = Array.from({ length: 70 }, (_, i) => ev('pouch', '2026-10-01', { ts: new Date(Date.parse('2026-10-01T10:00:00.000Z') + i * 60000).toISOString() }));
    const list = livePouchesForPrompt(attempt(many), NOW);
    expect(list).toHaveLength(60);
    expect(list[0].id).toBe(many[69].id);
  });
});

describe('promptClock — the 4am rule', () => {
  it('03:59 is still the app day before; 04:00 is the new one', () => {
    expect(promptClock(Date.parse('2026-10-02T03:59:00-05:00'))).toEqual({ day: '2026-10-01', time: '03:59', weekday: 'Thu' });
    expect(promptClock(Date.parse('2026-10-02T04:00:00-05:00'))).toEqual({ day: '2026-10-02', time: '04:00', weekday: 'Fri' });
  });
  it('reads the evening as the user sees it', () => {
    expect(promptClock(NOW)).toEqual({ day: '2026-10-01', time: '21:12', weekday: 'Thu' });
  });
});

describe('fmtAppDay', () => {
  it('reads like the cards', () => {
    expect(fmtAppDay('2026-10-01')).toBe('Thu Oct 1');
    expect(fmtAppDay('2026-09-29')).toBe('Tue Sep 29');
  });
});
```

- [ ] **Step 2: Run — expect red**

Run: `npx vitest run src/__tests__/coachTools.test.js`
Expected: FAIL — `Error: Cannot find module '../coachTools.js' imported from …/src/__tests__/coachTools.test.js`.

- [ ] **Step 3: Write `src/coachTools.js`**

```js
// The coach's vocabulary: one Claude tool per api method it may PROPOSE. This
// file names the actions and shows the model what it may point at; it calls
// nothing. coachActions.js validates whatever comes back, and the user's tap on
// a card is the only thing that ever writes. The forbidden list — starting or
// ending an attempt, the plan or quit date, the device token or session key,
// the recovery path, price and meal times — has no tool here, so the model
// cannot even name it.
import { TRIGGERS } from './triggers.js';
import { liveEvents, todayKey, triggersFor } from './store.js';
import { dayKeyOf, localHM } from './time.js';

export const MAX_PROPOSALS = 5;
// Room for a short reply plus up to five tool calls. The Worker's clamp is the
// same number (guard.js LIMITS.maxTokens), pinned by coachProxyPin.test.js.
export const MAX_TOKENS = 800;
export const NOTE_MAX = 140;
export const COUNT_MAX = 60;
// The Worker refuses a replayed tool_use whose input is bigger than this, and a
// tool_result longer than RESULT_MAX; the app keeps under both on its own.
export const TOOL_INPUT_MAX = 2048;
export const RESULT_MAX = 500;
const PROMPT_DAYS = 7;
const PROMPT_POUCHES = 60;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
// Calendar arithmetic on UTC noon, so no device zone or DST can move a day.
const noonOf = (day) => new Date(`${day}T12:00:00Z`);

// "Thu Oct 1" for an app day — the day the user means, never a reading of a
// timestamp in whatever zone the phone is in now.
export function fmtAppDay(day) {
  const d = noonOf(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const DAY = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The app day, YYYY-MM-DD. Days run 4 AM to 4 AM.' };
const TIME = { type: ['string', 'null'], pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Wall-clock HH:MM, 24h, on that day; null when the user does not remember.' };
const TRIGGER = { type: 'string', enum: TRIGGERS };
const TRIGGER_LIST = { type: 'array', items: TRIGGER, maxItems: TRIGGERS.length, uniqueItems: true };
const NOTE = { type: 'string', maxLength: NOTE_MAX };
const POUCH_ID = { type: 'string', description: 'An id from the pouch list in the system prompt, copied exactly.' };
const COUNT = { type: 'integer', minimum: 0, maximum: COUNT_MAX };
const shape = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: 'log_pouch_now',
    description: 'Propose logging a pouch the user is taking right now. The app stamps the time when the user confirms.',
    input_schema: shape({ trigger: TRIGGER }),
  },
  {
    name: 'log_resisted_now',
    description: 'Propose logging a craving the user just resisted.',
    input_schema: shape({ trigger: TRIGGER }),
  },
  {
    name: 'add_late_pouch',
    description: 'Propose adding a pouch the user forgot to log: the app day it belongs to, the time it happened (or null), and why.',
    input_schema: shape({ day: DAY, time: TIME, triggers: TRIGGER_LIST, note: NOTE }, ['day', 'time', 'triggers', 'note']),
  },
  {
    name: 'mark_mistake',
    description: 'Propose marking a logged pouch as an accidental tap. It stops counting and stays in the history.',
    input_schema: shape({ pouch_id: POUCH_ID }, ['pouch_id']),
  },
  {
    name: 'add_reason',
    description: 'Propose adding why a logged pouch happened: triggers, a note, or both.',
    input_schema: shape({ pouch_id: POUCH_ID, triggers: TRIGGER_LIST, note: NOTE }, ['pouch_id', 'triggers', 'note']),
  },
  {
    name: 'fill_missed_day',
    description: 'Propose filling in a past day that has no log: how many pouches, and whether the streak keeps or breaks. Over the cap of that day, the streak breaks.',
    input_schema: shape({ day: DAY, count: COUNT, streak: { type: 'string', enum: ['keep', 'break'] } }, ['day', 'count', 'streak']),
  },
  {
    name: 'correct_day_total',
    description: 'Propose raising the total of a logged past day to what it really was.',
    input_schema: shape({ day: DAY, count: COUNT }, ['day', 'count']),
  },
  {
    name: 'log_checkin',
    description: 'Propose the morning check-in: hours slept, sleep quality 1 to 5, and whether the user worked out. At least one of the three.',
    input_schema: shape({
      sleep_hours: { type: 'number', minimum: 0, maximum: 16 },
      sleep_quality: { type: 'integer', minimum: 1, maximum: 5 },
      workout: { type: 'boolean' },
    }),
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

// The pouches the coach may point at: live (a voided pouch is gone), from the
// last 7 app days, newest first, at most 60. The prompt prints exactly this
// list and coachActions.js accepts exactly these ids, so the model can never
// name a pouch the user hasn't been shown — or one from another attempt.
// `time` is the wall clock where the pouch was logged (localHM), null when its
// time is unknown.
export function livePouchesForPrompt(state, now = Date.now()) {
  const today = todayKey(new Date(now));
  const from = new Date(noonOf(today).getTime() - (PROMPT_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  return liveEvents(state)
    .filter((e) => e.type === 'pouch' && typeof e.id === 'string')
    .map((e) => ({ e, day: dayKeyOf(e) }))
    .filter(({ day }) => day >= from && day <= today)
    .sort((a, b) => (a.day === b.day ? Date.parse(b.e.ts) - Date.parse(a.e.ts) : a.day < b.day ? 1 : -1))
    .slice(0, PROMPT_POUCHES)
    .map(({ e, day }) => {
      const { h, m } = localHM(e);
      return { id: e.id, day, time: e.timeKnown === false ? null : `${pad(h)}:${pad(m)}`, trigger: triggersFor(state, e).join(', ') || null };
    });
}

// "Now", as the coach should read it: the app day (4am rule), the phone's wall
// clock, and that day's weekday. 2:30 AM on Friday is still Thursday's app day.
export function promptClock(now = Date.now()) {
  const d = new Date(now);
  const day = todayKey(d);
  return { day, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, weekday: WEEKDAYS[noonOf(day).getUTCDay()] };
}
```

Why each piece: `TRIGGER` reuses `TRIGGERS` so the enum can never drift from the chips; `additionalProperties: false` on every schema so the model is told up front an unknown field won't do (`coachActions.js` enforces it regardless); `livePouchesForPrompt` filters `liveEvents` (a voided pouch is gone) and only string ids (the api compares with `===`); the 7-day window is computed on UTC noon so no device zone can shift it; untimed pouches (`timeKnown: false`) show `time: null` because their `ts` is when they were written, not when they happened.

- [ ] **Step 4: Run — expect green**

Run: `npx vitest run src/__tests__/coachTools.test.js`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/coachTools.js src/__tests__/coachTools.test.js
git commit -m "coachTools: the coach's eight verbs, the pouch list it may point at, and its clock

One Claude tool per api method, schemas closed and built from TRIGGERS. The
prompt's pouch list is live, 7 app days, newest first, capped at 60 — the only
ids the coach may name. Nothing here calls anything."
```

---

### Task 2: `src/coachActions.js` — the allowlist (Lane A, after 1)

**Files:**
- Create: `src/coachActions.js`
- Create: `src/__tests__/coachActions.test.js`

Card shape (used by Tasks 6, 7, 9): `{ toolUseId, name, status, action?, reason?, eventId? }` with `status` ∈ `pending | invalid | saved | refused | skipped | undone`; `action = { toolUseId, name, verb, args, summary, facts }`. Sheet message shape (Task 7): coach `{ role: 'assistant', text, proposals, cards, overflow, answered?, held? }`; user `{ role: 'user', text, results?, outcomes?, auto? }`.

- [ ] **Step 1: Write the failing test — `src/__tests__/coachActions.test.js`**

The validation matrix, tool by tool: a good input; each bad field; an unknown key; a wrong type; out of range; a foreign id; a voided pouch; a pouch older than 7 days; a future day; a pre-plan day; a day the calendar lacks; a DST-gap time; a past-quit day allowed for `add_late_pouch`; a 5 KB note; seven triggers. Then overflow at 6, duplicate suppression, every `tool_result`, `applyAction` with a fake api returning an id / `null` / a verb outside the allowlist, `toTurns`' exact shapes, and the saved record.

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateProposal, takeProposals, outcomeResult, overflowResult, resultsFor, applyAction, toTurns,
  actionsOf, outcomesOf, renderOutcomes, REFUSED,
} from '../coachActions.js';
import { generatePlan } from '../planGenerator.js';
import { capForDay } from '../plan.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
// 90 days from Mon 2026-09-28: Thu Oct 1 is Day 4, cap 8 (Baseline hold).
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-28', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });
const NOW = Date.parse('2026-10-01T21:12:00-05:00'); // Thu 9:12 PM CDT
const TODAY = '2026-10-01';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => vi.useRealTimers());

// 2:14 PM CDT today, and one voided pouch.
const P = ev('pouch', TODAY, { ts: '2026-10-01T19:14:00.000Z' });
const GONE = ev('pouch', TODAY, { ts: '2026-10-01T15:00:00.000Z' });
const S = attempt([P, GONE, { ...ev('void', TODAY), target: GONE.id }]);
const call = (name, input, id = 'toolu_1') => ({ id, name, input });
const check = (name, input, state = S) => validateProposal(state, call(name, input), NOW);
const reasonOf = (name, input, state) => {
  const r = check(name, input, state);
  expect(r.ok).toBe(false);
  return r.reason;
};

describe('validateProposal — what every tool must look like', () => {
  it('an unknown tool name, a missing id, a non-object input, an unknown key, a missing key', () => {
    expect(validateProposal(S, call('update_settings', {}), NOW)).toEqual({ ok: false, toolUseId: 'toolu_1', name: 'update_settings', reason: 'unknown action' });
    expect(validateProposal(S, { name: 'log_pouch_now', input: {} }, NOW).reason).toBe('the proposal has no id');
    expect(reasonOf('log_pouch_now', 'coffee')).toBe('the input is not an object');
    expect(reasonOf('log_pouch_now', ['coffee'])).toBe('the input is not an object');
    expect(reasonOf('log_pouch_now', { trigger: 'coffee', ts: '2026-10-01T12:00:00Z' })).toBe('unexpected field');
    expect(reasonOf('add_late_pouch', { day: TODAY, time: '16:30', triggers: [] })).toBe('missing note');
  });
  it('a past attempt proposes nothing', () => {
    expect(reasonOf('log_pouch_now', {}, { ...S, status: 'archived' })).toBe('this attempt is read-only');
  });
});

describe('log_pouch_now / log_resisted_now', () => {
  it('good, with and without a trigger (null counts as none)', () => {
    expect(check('log_pouch_now', { trigger: 'boredom' })).toEqual({ ok: true, action: {
      toolUseId: 'toolu_1', name: 'log_pouch_now', verb: 'logPouch', args: ['boredom'],
      summary: 'Log a pouch now · boredom', facts: 'stamped when you confirm · boredom',
    } });
    expect(check('log_pouch_now', {}).action.args).toEqual([null]);
    expect(check('log_resisted_now', { trigger: null }).action).toMatchObject({ verb: 'logResisted', args: [null], summary: 'Log a craving resisted' });
  });
  it('a trigger outside the list, or of the wrong type', () => {
    expect(reasonOf('log_pouch_now', { trigger: 'rage' })).toBe("the trigger isn't one of the app's");
    expect(reasonOf('log_resisted_now', { trigger: 3 })).toBe("the trigger isn't one of the app's");
  });
});

describe('add_late_pouch', () => {
  const good = { day: TODAY, time: '16:30', triggers: ['boredom'], note: '' };
  it('good: the card reads the day and the time in the app\'s words', () => {
    expect(check('add_late_pouch', good).action).toEqual({
      toolUseId: 'toolu_1', name: 'add_late_pouch', verb: 'logLatePouch', args: [{ day: TODAY, time: '16:30', triggers: ['boredom'], note: '' }],
      summary: 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom', facts: 'Thu Oct 1 · 4:30 PM · boredom · added later',
    });
  });
  it('time null is "time unknown"; the note is trimmed', () => {
    const a = check('add_late_pouch', { ...good, time: null, triggers: [], note: '  after the meeting ' }).action;
    expect(a.args).toEqual([{ day: TODAY, time: null, triggers: [], note: 'after the meeting' }]);
    expect(a.summary).toBe('Add a pouch · Thu Oct 1 · time unknown');
    expect(a.facts).toBe('Thu Oct 1 · time unknown · no reason · “after the meeting” · added later');
  });
  it('a day past quit day is allowed (the still-free check-in must not be blocked)', () => {
    // 30 days from Aug 30: quit day is Sep 28, so Sep 30 is Day 32.
    const done = attempt([], { plan: generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-30', mealTimes: settings.mealTimes }) });
    expect(check('add_late_pouch', { ...good, day: '2026-09-30' }, done).ok).toBe(true);
  });
  it.each([
    ['a day that is not a date', { day: 'yesterday' }, 'day is not a real date'],
    ['a day the calendar lacks', { day: '2026-09-31' }, 'day is not a real date'],
    ['a pre-plan day', { day: '2026-09-27' }, 'day is before Day 1'],
    ['a future day', { day: '2026-10-02' }, 'day is in the future'],
    ['a time later than now', { time: '22:30' }, 'that time is later than now'],
    ['a time not HH:MM', { time: '4:30' }, 'time must be HH:MM or null'],
    ['a time of the wrong type', { time: 1630 }, 'time must be HH:MM or null'],
    ['triggers not a list', { triggers: 'boredom' }, 'triggers must be a list'],
    ['an unknown trigger', { triggers: ['rage'] }, "a trigger isn't one of the app's"],
    ['a trigger twice', { triggers: ['stress', 'stress'] }, 'a trigger appears twice'],
    ['seven triggers', { triggers: ['after-meal', 'coffee', 'driving', 'stress', 'boredom', 'social', 'coffee'] }, 'too many triggers'],
    ['a note of 141 characters', { note: 'x'.repeat(141) }, 'note is longer than 140 characters'],
    ['a 5 KB note', { note: 'x'.repeat(5000) }, 'note is longer than 140 characters'],
    ['a note that is not text', { note: 7 }, 'note must be text'],
  ])('%s', (_, patch, reason) => {
    expect(reasonOf('add_late_pouch', { ...good, ...patch })).toBe(reason);
  });
  it('a time the spring-forward jump skipped is refused, not quietly moved', () => {
    // 2026-03-08 02:30 never happened in Chicago. Clock a day later so it is past.
    vi.setSystemTime(new Date('2026-03-09T18:00:00Z'));
    const spring = attempt([], { plan: generatePlan({ pouchesPerDay: 9, mg: 9, lengthDays: 30, startDate: '2026-03-01', mealTimes: settings.mealTimes }) });
    // App day Mar 7 + 02:30 lands on calendar Mar 8 at 2:30 AM: the gap.
    expect(validateProposal(spring, call('add_late_pouch', { ...good, day: '2026-03-07', time: '02:30' }), Date.parse('2026-03-09T18:00:00Z')).reason)
      .toBe("that time didn't happen on that day (the clocks changed)");
  });
});

describe('mark_mistake / add_reason — only ids the prompt showed', () => {
  it('good', () => {
    expect(check('mark_mistake', { pouch_id: P.id }).action).toEqual({
      toolUseId: 'toolu_1', name: 'mark_mistake', verb: 'voidPouch', args: [P.id],
      summary: 'Mark as mistake · the 2:14 PM pouch on Thu Oct 1', facts: 'Thu Oct 1 · 2:14 PM · stops counting · stays in your history',
    });
    expect(check('add_reason', { pouch_id: P.id, triggers: ['stress'], note: '' }).action).toMatchObject({
      verb: 'logReason', args: [{ target: P.id, triggers: ['stress'], note: '' }], summary: 'Add a reason · 2:14 PM pouch · stress',
    });
    expect(check('add_reason', { pouch_id: P.id, triggers: [], note: ' late call ' }).action.summary).toBe('Add a reason · 2:14 PM pouch · a note');
  });
  it('a foreign id, a voided pouch, a pouch older than 7 days, a pouch of another attempt', () => {
    const old = ev('pouch', '2026-09-24', { ts: '2026-09-24T15:00:00.000Z' });
    const s = attempt([P, old], { plan: generatePlan({ pouchesPerDay: 9, mg: 9, lengthDays: 90, startDate: '2026-09-21', mealTimes: settings.mealTimes }) });
    expect(reasonOf('mark_mistake', { pouch_id: 'not-a-real-id' })).toBe('pouch_id is not a live pouch from the last 7 days');
    expect(reasonOf('mark_mistake', { pouch_id: GONE.id })).toBe('pouch_id is not a live pouch from the last 7 days');
    expect(reasonOf('mark_mistake', { pouch_id: old.id }, s)).toBe('pouch_id is not a live pouch from the last 7 days');
    expect(reasonOf('add_reason', { pouch_id: 'a1-pouch', triggers: ['stress'], note: '' })).toBe('pouch_id is not a live pouch from the last 7 days');
  });
  it('a reason with neither triggers nor a note', () => {
    expect(reasonOf('add_reason', { pouch_id: P.id, triggers: [], note: '   ' })).toBe('a reason needs a trigger or a note');
  });
});

describe('fill_missed_day — BackfillForm\'s streak rule', () => {
  const cap = capForDay(plan, 2); // Tue Sep 29 = Day 2
  it('within cap the model\'s choice stands, and the card says it', () => {
    expect(check('fill_missed_day', { day: '2026-09-29', count: 7, streak: 'keep' }).action).toEqual({
      toolUseId: 'toolu_1', name: 'fill_missed_day', verb: 'logBackfill', args: [{ day: '2026-09-29', count: 7, streak: 'keep' }],
      summary: 'Fill in Tue Sep 29 · 7 pouches · streak kept', facts: 'Tue Sep 29 · 7 pouches · streak kept · entered later',
    });
    expect(check('fill_missed_day', { day: '2026-09-29', count: 1, streak: 'break' }).action.summary).toBe('Fill in Tue Sep 29 · 1 pouch · streak breaks');
  });
  it('over cap the streak breaks whatever the model said', () => {
    const a = check('fill_missed_day', { day: '2026-09-29', count: cap + 1, streak: 'keep' }).action;
    expect(a.args[0].streak).toBe('break');
    expect(a.summary).toBe(`Fill in Tue Sep 29 · ${cap + 1} pouches · streak breaks: over cap`);
  });
  it.each([
    ['a negative count', { count: -1 }, 'count must be a whole number from 0 to 60'],
    ['a fractional count', { count: 2.5 }, 'count must be a whole number from 0 to 60'],
    ['a count over 60', { count: 61 }, 'count must be a whole number from 0 to 60'],
    ['a count as text', { count: '7' }, 'count must be a whole number from 0 to 60'],
    ['a streak word outside the two', { streak: 'maybe' }, "streak must be 'keep' or 'break'"],
    ['a future day', { day: '2026-10-05' }, 'day is in the future'],
  ])('%s', (_, patch, reason) => {
    expect(reasonOf('fill_missed_day', { day: '2026-09-29', count: 7, streak: 'keep', ...patch })).toBe(reason);
  });
});

describe('correct_day_total', () => {
  it('good, and the bounds', () => {
    expect(check('correct_day_total', { day: '2026-09-29', count: 9 }).action).toMatchObject({ verb: 'logCorrection', args: [{ day: '2026-09-29', count: 9 }], summary: 'Correct Tue Sep 29 · total 9' });
    expect(reasonOf('correct_day_total', { day: '2026-09-29', count: 61 })).toBe('count must be a whole number from 0 to 60');
    expect(reasonOf('correct_day_total', { day: '2026-09-27', count: 3 })).toBe('day is before Day 1');
  });
});

describe('log_checkin', () => {
  it('good: only the answers given reach the api', () => {
    expect(check('log_checkin', { sleep_hours: 6.5, sleep_quality: 3, workout: true }).action).toMatchObject({
      verb: 'logCheckin', args: [{ sleepHours: 6.5, sleepQuality: 3, workout: true }], summary: 'Morning check-in · 6.5h · 3/5 · workout',
    });
    expect(check('log_checkin', { workout: false }).action).toMatchObject({ args: [{ workout: false }], summary: 'Morning check-in · no workout' });
  });
  it.each([
    ['nothing answered', {}, 'a check-in needs at least one answer'],
    ['all null', { sleep_hours: null, sleep_quality: null, workout: null }, 'a check-in needs at least one answer'],
    ['17 hours', { sleep_hours: 17 }, 'sleep_hours must be 0 to 16, in tenths'],
    ['hundredths', { sleep_hours: 6.55 }, 'sleep_hours must be 0 to 16, in tenths'],
    ['hours as text', { sleep_hours: '7' }, 'sleep_hours must be 0 to 16, in tenths'],
    ['quality 6', { sleep_quality: 6 }, 'sleep_quality must be a whole number from 1 to 5'],
    ['quality 2.5', { sleep_quality: 2.5 }, 'sleep_quality must be a whole number from 1 to 5'],
    ['workout as text', { workout: 'yes' }, 'workout must be true or false'],
  ])('%s', (_, input, reason) => {
    expect(reasonOf('log_checkin', input)).toBe(reason);
  });
});

describe('takeProposals', () => {
  it('keeps the order, cards the first five, and lists the rest as overflow', () => {
    const six = Array.from({ length: 6 }, (_, i) => call('log_resisted_now', {}, `toolu_${i}`));
    const { cards, overflow } = takeProposals(S, six, NOW);
    expect(cards.map((c) => c.toolUseId)).toEqual(['toolu_0', 'toolu_1', 'toolu_2', 'toolu_3', 'toolu_4']);
    expect(cards.every((c) => c.status === 'pending')).toBe(true);
    expect(overflow).toEqual(['toolu_5']);
  });
  it('an invalid proposal is a card with a reason and no action', () => {
    const { cards } = takeProposals(S, [call('mark_mistake', { pouch_id: 'nope' }, 'toolu_x'), call('log_pouch_now', {}, 'toolu_y')], NOW);
    expect(cards[0]).toEqual({ toolUseId: 'toolu_x', name: 'mark_mistake', status: 'invalid', reason: 'pouch_id is not a live pouch from the last 7 days' });
    expect(cards[1]).toMatchObject({ toolUseId: 'toolu_y', status: 'pending', action: { verb: 'logPouch' } });
  });
  it('the same pouch marked twice is one card and one invalid; two pouches now are two cards', () => {
    const { cards } = takeProposals(S, [
      call('mark_mistake', { pouch_id: P.id }, 'a'), call('mark_mistake', { pouch_id: P.id }, 'b'),
      call('log_pouch_now', {}, 'c'), call('log_pouch_now', {}, 'd'),
    ], NOW);
    expect(cards.map((c) => c.status)).toEqual(['pending', 'invalid', 'pending', 'pending']);
    expect(cards[1].reason).toBe('the same action twice in one reply');
  });
  it('no proposals, or something that is not a list, is no cards', () => {
    expect(takeProposals(S, [], NOW)).toEqual({ cards: [], overflow: [] });
    expect(takeProposals(S, undefined, NOW)).toEqual({ cards: [], overflow: [] });
  });
});

describe('outcomeResult — what the coach is told', () => {
  const card = (status, extra = {}) => ({ toolUseId: 'toolu_1', name: 'add_late_pouch', status, ...extra });
  it('one tool_result per outcome; refused and invalid are errors', () => {
    expect(outcomeResult(card('saved', { eventId: 'e1' }))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' });
    expect(outcomeResult(card('undone'))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved, then undone by the user' });
    expect(outcomeResult(card('skipped'))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'skipped by the user' });
    expect(outcomeResult(card('pending'))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'skipped by the user' });
    expect(outcomeResult(card('refused', { reason: REFUSED }))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: `refused: ${REFUSED}`, is_error: true });
    expect(outcomeResult(card('invalid', { reason: 'unknown action' }))).toEqual({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'invalid: unknown action', is_error: true });
  });
  it('overflow is told to split; resultsFor answers every tool_use, cards first', () => {
    expect(overflowResult('toolu_6')).toEqual({ type: 'tool_result', tool_use_id: 'toolu_6', content: 'invalid: more than 5 actions in one reply — ask the user to split them up', is_error: true });
    const m = { cards: [card('saved'), { ...card('skipped'), toolUseId: 'toolu_2' }], overflow: ['toolu_6'] };
    expect(resultsFor(m).map((r) => r.tool_use_id)).toEqual(['toolu_1', 'toolu_2', 'toolu_6']);
  });
});

describe('applyAction — the one place a verb is called', () => {
  const action = { verb: 'logLatePouch', args: [{ day: TODAY, time: '16:30', triggers: [], note: '' }] };
  it('calls the api method with the validated args; an id is saved', () => {
    const api = { logLatePouch: vi.fn(() => 'e42') };
    expect(applyAction(api, action)).toEqual({ outcome: 'saved', eventId: 'e42' });
    expect(api.logLatePouch).toHaveBeenCalledWith({ day: TODAY, time: '16:30', triggers: [], note: '' });
  });
  it('null from the api is refused, with the reason the coach and the card show', () => {
    expect(applyAction({ logLatePouch: () => null }, action)).toEqual({ outcome: 'refused', reason: REFUSED });
  });
  it('a verb outside the allowlist is never called, even if the api has it', () => {
    const api = { startFresh: vi.fn(() => 'x'), updateSettings: vi.fn(() => 'x') };
    expect(applyAction(api, { verb: 'startFresh', args: [] }).outcome).toBe('refused');
    expect(applyAction(api, { verb: 'updateSettings', args: [{}] }).outcome).toBe('refused');
    expect(api.startFresh).not.toHaveBeenCalled();
    expect(api.updateSettings).not.toHaveBeenCalled();
  });
});

describe('toTurns — the exact conversation the API gets', () => {
  const proposals = [{ id: 'toolu_1', name: 'add_late_pouch', input: { day: TODAY, time: '16:30', triggers: ['boredom'], note: '' } }];
  const results = [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' }];
  it('text-only turns stay strings', () => {
    expect(toTurns([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hey.' }])).toEqual([
      { role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hey.' },
    ]);
  });
  it('a coach turn that proposed is text + tool_use blocks; the follow-up is only tool_results', () => {
    expect(toTurns([
      { role: 'user', text: 'had one at 4:30' },
      { role: 'assistant', text: 'Confirm and it\'s in.', proposals, cards: [] },
      { role: 'user', text: 'Confirmed: …', results, auto: true },
    ])).toEqual([
      { role: 'user', content: 'had one at 4:30' },
      { role: 'assistant', content: [{ type: 'text', text: 'Confirm and it\'s in.' }, { type: 'tool_use', id: 'toolu_1', name: 'add_late_pouch', input: proposals[0].input }] },
      { role: 'user', content: results },
    ]);
  });
  it('a coach turn with no words is tool_use blocks alone', () => {
    expect(toTurns([{ role: 'assistant', text: '', proposals }])[0].content.map((b) => b.type)).toEqual(['tool_use']);
  });
  it('a typed turn that answers pending cards leads with the tool_results, then the text', () => {
    const skipped = [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'skipped by the user' }];
    expect(toTurns([{ role: 'user', text: 'never mind', results: skipped }])).toEqual([
      { role: 'user', content: [...skipped, { type: 'text', text: 'never mind' }] },
    ]);
  });
  it('a runaway tool input is replayed empty, so the proxy never refuses the history', () => {
    const big = [{ id: 'toolu_9', name: 'add_late_pouch', input: { note: 'x'.repeat(5000) } }];
    expect(toTurns([{ role: 'assistant', text: 'ok', proposals: big }])[0].content[1].input).toEqual({});
  });
});

describe('the saved chat\'s record', () => {
  const cards = [
    { toolUseId: 'a', name: 'add_late_pouch', status: 'saved', action: { summary: 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom' } },
    { toolUseId: 'b', name: 'mark_mistake', status: 'skipped', action: { summary: 'Mark as mistake · the 2:14 PM pouch on Thu Oct 1' } },
    { toolUseId: 'c', name: 'fill_missed_day', status: 'refused', reason: REFUSED, action: { summary: 'Fill in Tue Sep 29 · 7 pouches · streak kept' } },
    { toolUseId: 'd', name: 'drop_table', status: 'invalid', reason: 'unknown action' },
    { toolUseId: 'e', name: 'log_checkin', status: 'pending', action: { summary: 'Morning check-in · 6.5h' } },
  ];
  it('actionsOf names each proposal in the app\'s words; an unknown tool is "unknown"', () => {
    expect(actionsOf(cards).map((a) => a.name)).toEqual(['add_late_pouch', 'mark_mistake', 'fill_missed_day', 'unknown', 'log_checkin']);
    expect(actionsOf(cards)[3].summary).toBe("An action the app doesn't have");
  });
  it('outcomesOf: a still-pending card counts as skipped; reasons ride only on refused and invalid', () => {
    expect(outcomesOf(cards).map((o) => [o.outcome, o.reason ?? null])).toEqual([
      ['saved', null], ['skipped', null], ['refused', REFUSED], ['invalid', 'unknown action'], ['skipped', null],
    ]);
  });
  it('renderOutcomes reads as one line', () => {
    expect(renderOutcomes(outcomesOf(cards.slice(0, 3)))).toBe(
      `Confirmed: Add a pouch · Thu Oct 1 · 4:30 PM · boredom / Skipped: Mark as mistake · the 2:14 PM pouch on Thu Oct 1 / Didn't save: Fill in Tue Sep 29 · 7 pouches · streak kept (${REFUSED})`,
    );
  });
});
```

- [ ] **Step 2: Run — expect red**

Run: `npx vitest run src/__tests__/coachActions.test.js`
Expected: FAIL — `Error: Cannot find module '../coachActions.js' imported from …/src/__tests__/coachActions.test.js`.

- [ ] **Step 3: Write `src/coachActions.js`**

```js
// The allowlist between the model and the log. A model's tool call is
// untrusted input, like a backup file: nothing here evaluates text, and
// nothing here writes on its own. validateProposal turns one tool call into an
// action the app knows how to perform — exact keys, types, enums and bounds;
// days the attempt has; pouch ids from the list the prompt itself showed — or
// into a reason it can't. applyAction is the ONE place a verb is called, and it
// only runs on the user's tap; the api's own guards run again inside it.
import { TRIGGERS } from './triggers.js';
import { TOOLS, TOOL_NAMES, MAX_PROPOSALS, NOTE_MAX, COUNT_MAX, TOOL_INPUT_MAX, RESULT_MAX, livePouchesForPrompt, fmtAppDay } from './coachTools.js';
import { resolveLate, fmtHM } from './latePouch.js';
import { todayKey, dayNumberFor } from './store.js';
import { capForDay } from './plan.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const SCHEMA = Object.fromEntries(TOOLS.map((t) => [t.name, t.input_schema]));
const VERBS = new Set(['logPouch', 'logResisted', 'logLatePouch', 'voidPouch', 'logReason', 'logBackfill', 'logCorrection', 'logCheckin']);

// The headline of a card whose details can't be trusted (an invalid one): the
// verb in the app's words, never the model's.
const HEADLINE = {
  log_pouch_now: 'Log a pouch now',
  log_resisted_now: 'Log a craving resisted',
  add_late_pouch: 'Add a pouch',
  mark_mistake: 'Mark as mistake',
  add_reason: 'Add a reason',
  fill_missed_day: 'Fill in a day',
  correct_day_total: 'Correct a day',
  log_checkin: 'Morning check-in',
};
const UNKNOWN = "An action the app doesn't have";

export const REFUSED = "the app wouldn't save it — it may already be logged, or the day isn't in this attempt";
const OVERFLOW = `more than ${MAX_PROPOSALS} actions in one reply — ask the user to split them up`;

const parts = (...xs) => xs.filter(Boolean).join(' · ');
const pouches = (n) => `${n} ${n === 1 ? 'pouch' : 'pouches'}`;
const clock = (time) => (time === null ? 'time unknown' : fmtHM(time));

// ── field checks: each returns a reason, or null when the value will do ──

function dayProblem(state, day, today) {
  // resolveLate with no time is the app's own "is this a real calendar day".
  if (typeof day !== 'string' || !resolveLate({ day, time: null }).ok) return 'day is not a real date';
  if (dayNumberFor(state, day) < 1) return 'day is before Day 1';
  if (day > today) return 'day is in the future';
  return null;
}

function triggersProblem(list) {
  if (!Array.isArray(list)) return 'triggers must be a list';
  if (list.length > TRIGGERS.length) return 'too many triggers';
  if (!list.every((t) => TRIGGERS.includes(t))) return "a trigger isn't one of the app's";
  if (new Set(list).size !== list.length) return 'a trigger appears twice';
  return null;
}

function noteProblem(note) {
  if (typeof note !== 'string') return 'note must be text';
  if (note.trim().length > NOTE_MAX) return `note is longer than ${NOTE_MAX} characters`;
  return null;
}

const countProblem = (n) => (Number.isInteger(n) && n >= 0 && n <= COUNT_MAX ? null : `count must be a whole number from 0 to ${COUNT_MAX}`);
// An optional field may be absent or null; models send both for "not given".
const triggerProblem = (t) => (t == null || TRIGGERS.includes(t) ? null : "the trigger isn't one of the app's");

// ── one builder per tool: a reason string, or { verb, args, summary, facts } ──

const BUILD = {
  log_pouch_now(state, { trigger = null }) {
    return triggerProblem(trigger) ?? {
      verb: 'logPouch', args: [trigger ?? null],
      summary: parts('Log a pouch now', trigger), facts: parts('stamped when you confirm', trigger ?? 'no trigger'),
    };
  },
  log_resisted_now(state, { trigger = null }) {
    return triggerProblem(trigger) ?? {
      verb: 'logResisted', args: [trigger ?? null],
      summary: parts('Log a craving resisted', trigger), facts: parts('stamped when you confirm', trigger ?? 'no trigger'),
    };
  },
  add_late_pouch(state, { day, time, triggers, note }, { today, now }) {
    const bad = dayProblem(state, day, today) ?? triggersProblem(triggers) ?? noteProblem(note);
    if (bad) return bad;
    if (time !== null && typeof time !== 'string') return 'time must be HH:MM or null';
    const r = resolveLate({ day, time, now });
    if (r.skipped) return "that time didn't happen on that day (the clocks changed)";
    if (!r.ok) return 'time must be HH:MM or null';
    if (r.future) return 'that time is later than now';
    const why = triggers.join(', ');
    const n = note.trim();
    return {
      verb: 'logLatePouch', args: [{ day, time, triggers, note: n }],
      summary: parts('Add a pouch', fmtAppDay(day), clock(time), why),
      facts: parts(fmtAppDay(day), clock(time), why || 'no reason', n && `“${n}”`, 'added later'),
    };
  },
  mark_mistake(state, { pouch_id }, { pouches: live }) {
    const p = live.get(pouch_id);
    if (!p) return 'pouch_id is not a live pouch from the last 7 days';
    const which = p.time === null ? 'the time-unknown pouch' : `the ${fmtHM(p.time)} pouch`;
    return {
      verb: 'voidPouch', args: [pouch_id],
      summary: parts('Mark as mistake', `${which} on ${fmtAppDay(p.day)}`),
      facts: parts(fmtAppDay(p.day), clock(p.time), 'stops counting', 'stays in your history'),
    };
  },
  add_reason(state, { pouch_id, triggers, note }, { pouches: live }) {
    const p = live.get(pouch_id);
    if (!p) return 'pouch_id is not a live pouch from the last 7 days';
    const bad = triggersProblem(triggers) ?? noteProblem(note);
    if (bad) return bad;
    const n = note.trim();
    if (!triggers.length && !n) return 'a reason needs a trigger or a note';
    const which = p.time === null ? 'time-unknown pouch' : `${fmtHM(p.time)} pouch`;
    return {
      verb: 'logReason', args: [{ target: pouch_id, triggers, note: n }],
      summary: parts('Add a reason', which, triggers.join(', ') || 'a note'),
      facts: parts(fmtAppDay(p.day), clock(p.time), triggers.join(', '), n && `“${n}”`),
    };
  },
  fill_missed_day(state, { day, count, streak }, { today }) {
    const bad = dayProblem(state, day, today) ?? countProblem(count);
    if (bad) return bad;
    if (streak !== 'keep' && streak !== 'break') return "streak must be 'keep' or 'break'";
    // Mirrors BackfillForm: over the day's cap the streak breaks whatever was
    // asked, so the card never promises a kept streak the store won't give.
    const over = count > capForDay(state.plan, dayNumberFor(state, day));
    const final = over ? 'break' : streak;
    const said = over ? 'streak breaks: over cap' : final === 'keep' ? 'streak kept' : 'streak breaks';
    return {
      verb: 'logBackfill', args: [{ day, count, streak: final }],
      summary: parts(`Fill in ${fmtAppDay(day)}`, pouches(count), said),
      facts: parts(fmtAppDay(day), pouches(count), said, 'entered later'),
    };
  },
  correct_day_total(state, { day, count }, { today }) {
    const bad = dayProblem(state, day, today) ?? countProblem(count);
    if (bad) return bad;
    return {
      verb: 'logCorrection', args: [{ day, count }],
      summary: parts(`Correct ${fmtAppDay(day)}`, `total ${count}`),
      facts: parts(fmtAppDay(day), `total ${count}`, 'the logged pouches stay'),
    };
  },
  log_checkin(state, { sleep_hours = null, sleep_quality = null, workout = null }) {
    if (sleep_hours === null && sleep_quality === null && workout === null) return 'a check-in needs at least one answer';
    const tenths = typeof sleep_hours === 'number' ? Math.round(sleep_hours * 10) : NaN;
    if (sleep_hours !== null && !(Number.isFinite(sleep_hours) && sleep_hours >= 0 && sleep_hours <= 16 && Math.abs(sleep_hours * 10 - tenths) < 1e-9)) return 'sleep_hours must be 0 to 16, in tenths';
    if (sleep_quality !== null && !(Number.isInteger(sleep_quality) && sleep_quality >= 1 && sleep_quality <= 5)) return 'sleep_quality must be a whole number from 1 to 5';
    if (workout !== null && typeof workout !== 'boolean') return 'workout must be true or false';
    const payload = {
      ...(sleep_hours !== null ? { sleepHours: tenths / 10 } : {}),
      ...(sleep_quality !== null ? { sleepQuality: sleep_quality } : {}),
      ...(workout !== null ? { workout } : {}),
    };
    const said = parts(sleep_hours !== null && `${tenths / 10}h`, sleep_quality !== null && `${sleep_quality}/5`, workout !== null && (workout ? 'workout' : 'no workout'));
    return {
      verb: 'logCheckin', args: [payload],
      summary: parts('Morning check-in', said),
      facts: parts('for today', said),
    };
  },
};

// One tool call → { ok: true, action } or { ok: false, toolUseId, name, reason }.
// `action` = { toolUseId, name, verb, args, summary, facts }: the summary is
// the card's headline and `facts` its second line, both built here from the
// validated values — the card never shows the model's own words as fact.
export function validateProposal(state, proposal, now = Date.now()) {
  const toolUseId = typeof proposal?.id === 'string' ? proposal.id : '';
  const name = typeof proposal?.name === 'string' ? proposal.name : '';
  const no = (reason) => ({ ok: false, toolUseId, name, reason });
  if (!toolUseId) return no('the proposal has no id');
  if (!TOOL_NAMES.includes(name)) return no('unknown action');
  if (state?.status !== 'active') return no('this attempt is read-only');
  const input = proposal.input;
  if (!isObj(input)) return no('the input is not an object');
  const schema = SCHEMA[name];
  if (Object.keys(input).some((k) => !has(schema.properties, k))) return no('unexpected field');
  const missing = schema.required.find((k) => !has(input, k));
  if (missing) return no(`missing ${missing}`);
  const ctx = { now, today: todayKey(new Date(now)), pouches: new Map(livePouchesForPrompt(state, now).map((p) => [p.id, p])) };
  const built = BUILD[name](state, input, ctx);
  return typeof built === 'string' ? no(built) : { ok: true, action: { toolUseId, name, ...built } };
}

// Actions that make no sense twice in one reply. Two pouches at once are
// real; marking the same pouch twice, or filling one day twice, is not.
const onceKey = ({ name, args: [a] }) => {
  if (name === 'mark_mistake') return `${name}:${a}`;
  if (name === 'add_reason') return `${name}:${a.target}`;
  if (name === 'fill_missed_day' || name === 'correct_day_total') return `${name}:${a.day}`;
  if (name === 'log_checkin') return name;
  return null;
};

// A reply's tool calls → { cards, overflow }. Cards keep the model's order: the
// first five, each `pending` (with its action) or `invalid` (with a reason).
// `overflow` is the ids past five — never shown, always answered.
export function takeProposals(state, proposals, now = Date.now()) {
  const list = Array.isArray(proposals) ? proposals : [];
  const seen = new Set();
  const cards = list.slice(0, MAX_PROPOSALS).map((p) => {
    const v = validateProposal(state, p, now);
    if (!v.ok) return { toolUseId: v.toolUseId, name: v.name, status: 'invalid', reason: v.reason };
    const key = onceKey(v.action);
    if (key && seen.has(key)) return { toolUseId: v.action.toolUseId, name: v.action.name, status: 'invalid', reason: 'the same action twice in one reply' };
    if (key) seen.add(key);
    return { toolUseId: v.action.toolUseId, name: v.action.name, status: 'pending', action: v.action };
  });
  const overflow = list.slice(MAX_PROPOSALS).map((p) => (typeof p?.id === 'string' ? p.id : '')).filter(Boolean);
  return { cards, overflow };
}

// What the coach is told about one card: `content` is short and the app's own
// words; `is_error` marks the two outcomes the coach must not report as done.
// A card still pending when this is asked for was passed over: skipped.
export function outcomeResult(card) {
  const base = { type: 'tool_result', tool_use_id: card.toolUseId };
  if (card.status === 'saved') return { ...base, content: 'saved' };
  if (card.status === 'undone') return { ...base, content: 'saved, then undone by the user' };
  if (card.status === 'refused') return { ...base, content: `refused: ${card.reason}`.slice(0, RESULT_MAX), is_error: true };
  if (card.status === 'invalid') return { ...base, content: `invalid: ${card.reason}`.slice(0, RESULT_MAX), is_error: true };
  return { ...base, content: 'skipped by the user' };
}

export const overflowResult = (toolUseId) => ({ type: 'tool_result', tool_use_id: toolUseId, content: `invalid: ${OVERFLOW}`, is_error: true });

// Every tool_use of a coach message answered, cards first, in order — the API
// refuses a turn that leaves one out.
export const resultsFor = (message) => [...(message.cards ?? []).map(outcomeResult), ...(message.overflow ?? []).map(overflowResult)];

// The user's tap. `null` from the api means its own guard said no (a day
// already logged, a pouch already voided, a day outside the attempt): that is a
// card state, never a thrown error.
export function applyAction(api, action) {
  const fn = VERBS.has(action?.verb) ? api?.[action.verb] : null;
  const id = typeof fn === 'function' ? fn(...action.args) : null;
  return typeof id === 'string' && id ? { outcome: 'saved', eventId: id } : { outcome: 'refused', reason: REFUSED };
}

// The sheet's messages → the Messages API conversation. A text-only turn stays
// `content: string`, so a chat with no actions sends the same body as before.
// A coach turn that proposed is replayed as its text + tool_use blocks; a user
// turn that answers one leads with its tool_result blocks (the API requires
// them first), then the typed text — or nothing else, for the app's follow-up.
export function toTurns(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      const uses = (m.proposals ?? []).map(({ id, name, input }) => ({
        type: 'tool_use', id, name,
        // A runaway input is already an invalid card; replaying it whole would
        // only get the next request refused by the proxy's 2 KB clamp.
        input: isObj(input) && JSON.stringify(input).length <= TOOL_INPUT_MAX ? input : {},
      }));
      if (!uses.length) return { role: 'assistant', content: m.text };
      return { role: 'assistant', content: [...(m.text ? [{ type: 'text', text: m.text }] : []), ...uses] };
    }
    const results = m.results ?? [];
    if (!results.length) return { role: 'user', content: m.text };
    return { role: 'user', content: m.auto ? results : [...results, { type: 'text', text: m.text }] };
  });
}

const known = (name) => (TOOL_NAMES.includes(name) ? name : 'unknown');
const summaryOf = (card) => card.action?.summary ?? HEADLINE[card.name] ?? UNKNOWN;

// For the saved chat: what a coach message proposed …
export const actionsOf = (cards = []) => cards.map((c) => ({ name: known(c.name), summary: summaryOf(c) }));

// … and how each one ended, on the user turn that answered it.
export const outcomesOf = (cards = []) => cards.map((c) => {
  const outcome = c.status === 'pending' ? 'skipped' : c.status;
  return { name: known(c.name), summary: summaryOf(c), outcome, ...((outcome === 'refused' || outcome === 'invalid') && c.reason ? { reason: c.reason } : {}) };
});

const WORD = { saved: 'Confirmed', undone: 'Undone', refused: "Didn't save", skipped: 'Skipped', invalid: "Couldn't be done" };

// The follow-up's user text in the saved chat, in words a reader of the vault
// understands: "Confirmed: Add a pouch · Thu Oct 1 · 4:30 PM · boredom / …".
export function renderOutcomes(outcomes) {
  return outcomes.map((o) => `${WORD[o.outcome] ?? 'Skipped'}: ${o.summary}${o.reason ? ` (${o.reason})` : ''}`).join(' / ');
}
```

Decisions written into the code (record them in the build log):
- An optional field (`trigger`, `sleep_hours`, `sleep_quality`, `workout`) may be absent **or** `null`; models send both for "not given".
- A note over 140 characters is **invalid**, not trimmed: the card must show exactly what will be written.
- Reasons are fixed app strings; none echoes a model value, so a `tool_result` and the vault never carry model text back as fact.
- Duplicates: the same pouch marked twice, two reasons for one pouch, one day filled or corrected twice, or two check-ins in one reply → the second card is invalid ("the same action twice in one reply"). Two `log_pouch_now` or two `add_late_pouch` stay legal — two pouches at once are real.
- `applyAction` checks the verb against its own allowlist before touching the api, so even a hand-built action can't reach `startFresh` or `updateSettings`.
- `toTurns` replays a tool input larger than 2 KB as `{}` — that card is already invalid, and the proxy would refuse the whole history otherwise.

- [ ] **Step 4: Run — expect green**

Run: `npx vitest run src/__tests__/coachActions.test.js`
Expected: PASS — 60 tests.

- [ ] **Step 5: Commit**

```bash
git add src/coachActions.js src/__tests__/coachActions.test.js
git commit -m "coachActions: the allowlist between the model and the log

A tool call is untrusted input. validateProposal checks names, keys, types,
enums, bounds, real days inside the attempt, and pouch ids from the prompt's
own list; the card's words come from validated values only. applyAction is the
one place a verb is called, on the user's tap; a null from the api is a refused
card, never a throw. toTurns builds the exact Messages API conversation."
```

---

### Task 3: `src/coach.js` — tools in the request, proposals out of the reply (Lane A, after 2)

**Files:**
- Modify: `src/coach.js`
- Modify: `src/__tests__/coach.test.js`

`askCoach(state, turns, apiKey, now = Date.now())` → `{ text, proposals: [{ id, name, input }], stopReason }`. `turns` is what `toTurns` builds. The existing callers in the tests move from `[{ role, text }]` to `[{ role, content }]` and from a string result to `.text`; the only app caller is `CoachSheet.jsx`, rewritten in Task 7 (until then the sheet still compiles but would send the old shape — Task 7 lands before anything ships).

- [ ] **Step 1: Write the failing tests — `src/__tests__/coach.test.js`**

Apply this diff (the existing tests move to the new signature and reply shape; the honesty test splits into the active and the past wording; the size test now measures the whole body with tools; a new describe pins the request and the reply):

```diff
diff --git a/src/__tests__/coach.test.js b/src/__tests__/coach.test.js
--- a/src/__tests__/coach.test.js
+++ b/src/__tests__/coach.test.js
@@ -4,6 +4,7 @@ import { DEFAULT_SETTINGS, freshRoot, startAttempt, archiveActive, updateAttempt
 import { generatePlan } from '../planGenerator.js';
 import { capForDay } from '../plan.js';
 import { makeEvent } from '../store.js';
+import { TOOL_NAMES } from '../coachTools.js';
 
 const mealTimes = DEFAULT_SETTINGS.mealTimes;
 const pouchAt = (iso) => makeEvent('pouch', null, new Date(iso));
@@ -13,9 +14,9 @@ async function systemFor(state) {
   let body;
   vi.stubGlobal('fetch', async (_url, init) => {
     body = JSON.parse(init.body);
-    return { ok: true, json: async () => ({ content: [{ text: 'ok' }] }) };
+    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
   });
-  await askCoach(state, [{ role: 'user', text: 'How am I doing?' }], 'test-key');
+  await askCoach(state, [{ role: 'user', content: 'How am I doing?' }], 'test-key');
   return body.system;
 }
 
@@ -81,22 +82,43 @@ describe('coach prompt — facts come from the log, not the calendar', () => {
 
 // ── what the coach can and can't do ─────────────────────────────────────────
 //
-// The coach can only talk. It is told so, and told where the real fix lives,
-// and the prompt has to stay small enough that the proxy's 16 KB body cap
-// still leaves room for the conversation.
+// An active attempt's coach proposes; the user confirms every card. A past
+// attempt's coach can only talk, and is told where the real fix lives. The
+// prompt has to stay small enough that the proxy's body cap still leaves room
+// for the conversation.
 describe('coach prompt — honest about what it can do', () => {
-  it('says it cannot make changes and never claims one was made', async () => {
+  it('an active attempt: proposes, the user confirms, never claims a card is done', async () => {
     const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
     const r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
     const system = await systemFor(attemptById(r, 'a1'));
+    expect(system).toContain('you can propose these actions; the user confirms each on a card in the app, and nothing is saved until they do');
+    expect(system).toContain("You can't change settings, the plan, or the attempt");
+    expect(system).toContain('Fix this day');
+    expect(system).not.toContain('cannot add, change, backfill or tag');
+    for (const rule of [
+      'Propose only what the user clearly asked for or clearly stated as a fact. A guess is a question, not a card.',
+      'Never mark_mistake unless the user says a tap was an accident. Never add_late_pouch for a pouch already in the list.',
+      'Give a day as YYYY-MM-DD and a time as HH:MM 24h on that day; "4:30" in the evening means 16:30; before 4 AM belongs to the previous app day (the app handles it — just name the day the user means). Use null when the user doesn\'t remember the time.',
+      'fill_missed_day within cap: ask whether the streak keeps or breaks before proposing, unless the user said.',
+      'At most 5 actions in a reply. Say in one short sentence what each card does; the card is the confirmation, so never claim it is done.',
+      'After a tool result: one short line. "4:30 is in." / "That one didn\'t save — the app says it\'s already logged." Nothing is done until the result says saved.',
+    ]) expect(system).toContain(rule);
+    expect(system).not.toMatch(/\byour\b/i);
+  });
+
+  it('a past attempt keeps the read-only wording: cannot change anything, never claims a change', async () => {
+    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 60, startDate: '2026-07-08', mealTimes });
+    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-07T12:00:00Z' });
+    r = archiveActive(r, '2026-09-18T12:00:00Z');
+    const system = await systemFor(attemptById(r, 'a1'));
     expect(system).toContain('cannot add, change, backfill or tag');
     expect(system).toContain('Never claim a change was made');
-    expect(system).toContain('Fix this day');
     expect(system).toContain("Fix this day (add a pouch you missed, with its time or 'unknown'; mark an accidental tap as a mistake; correct a past total; add reasons)");
+    expect(system).not.toContain('Tool rules');
     expect(system).not.toMatch(/\byour\b/i);
   });
 
-  it('a week of fully logged days keeps the system prompt under 8 KB', async () => {
+  it('a week of fully logged days keeps the system prompt under 10 KB and the body under 20 KB', async () => {
     // 30-day plan, day 1 = Sep 15, so today (Sep 21) is day 7 and the log
     // window holds seven days. Every day is as heavy as the data model allows:
     // ten tagged pouches, a reason on each, and a correction raising the total.
@@ -120,8 +142,12 @@ describe('coach prompt — honest about what it can do', () => {
       events.push({ ...makeEvent('correction', null, new Date(`${day}T16:59:00Z`)), day, count: light ? 10 : 12 });
     });
     r = updateAttempt(r, 'a1', (a) => ({ ...a, events }));
-    const system = await systemFor(attemptById(r, 'a1'));
-    expect(system.length).toBeLessThan(8000);
+    let body;
+    vi.stubGlobal('fetch', async (_url, init) => { body = init.body; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }; });
+    await askCoach(attemptById(r, 'a1'), [{ role: 'user', content: 'How am I doing?' }], 'test-key');
+    const system = JSON.parse(body).system;
+    expect(system.length).toBeLessThan(10000);
+    expect(body.length).toBeLessThan(20000);
     expect(system).toMatch(/\| 2026-09-20 \| \d+ \| 10\* \(4\) \|/);
     expect(system).toContain(`Today: 10 pouches used (cap ${capForDay(plan, 7)})`);
   });
@@ -154,7 +180,7 @@ const anAttempt = () => {
   return attemptById(startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' }), 'a1');
 };
 
-const okReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: 'ok' }] }) });
+const okReply = () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) });
 
 describe('the coach through the proxy', () => {
   afterEach(() => {
@@ -166,7 +192,7 @@ describe('the coach through the proxy', () => {
     const fetchSpy = vi.fn().mockResolvedValue(okReply());
     vi.stubGlobal('fetch', fetchSpy);
     const ask = await coachVia();
-    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], FAKE_KEY)).resolves.toBe('ok');
+    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], FAKE_KEY)).resolves.toMatchObject({ text: 'ok' });
     const [url, init] = fetchSpy.mock.calls[0];
     expect(url).toBe(`${PROXY}/v1/messages`);
     expect(url).not.toContain(DEVICE);
@@ -182,12 +208,12 @@ describe('the coach through the proxy', () => {
     const bodies = [];
     vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(init.body); return okReply(); }));
     const state = anAttempt();
-    const messages = [{ role: 'user', text: 'How am I doing?' }];
-    await askCoach(state, messages, FAKE_KEY); // direct, with the session key
+    const turns = [{ role: 'user', content: 'How am I doing?' }];
+    await askCoach(state, turns, FAKE_KEY); // direct, with the session key
     const ask = await coachVia();
-    await ask(state, messages, ''); // proxy, no key at all
+    await ask(state, turns, ''); // proxy, no key at all
     expect(bodies[1]).toBe(bodies[0]);
-    expect(Object.keys(JSON.parse(bodies[1]))).toEqual(['model', 'max_tokens', 'system', 'messages']);
+    expect(Object.keys(JSON.parse(bodies[1]))).toEqual(['model', 'max_tokens', 'system', 'tools', 'messages']);
   });
 
   it('maps the proxy 401 to the device token, not to the key', async () => {
@@ -195,7 +221,7 @@ describe('the coach through the proxy', () => {
       ok: false, status: 401, json: async () => ({ error: { message: 'unknown device' } }),
     }));
     const ask = await coachVia();
-    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], '')).rejects.toThrow('bad-device-token');
+    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], '')).rejects.toThrow('bad-device-token');
   });
 
   it('passes the proxy’s own message through for anything else', async () => {
@@ -203,14 +229,14 @@ describe('the coach through the proxy', () => {
       ok: false, status: 502, json: async () => ({ error: { message: 'upstream refused' } }),
     }));
     const ask = await coachVia();
-    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], '')).rejects.toThrow('upstream refused');
+    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], '')).rejects.toThrow('upstream refused');
   });
 
   it('a configured proxy with no device token asks for the token, not for a key', async () => {
     const fetchSpy = vi.fn();
     vi.stubGlobal('fetch', fetchSpy);
     const ask = await coachVia({ token: '' });
-    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], '')).rejects.toThrow('no-device-token');
+    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], '')).rejects.toThrow('no-device-token');
     expect(fetchSpy).not.toHaveBeenCalled();
   });
 
@@ -218,9 +244,88 @@ describe('the coach through the proxy', () => {
     const fetchSpy = vi.fn().mockResolvedValue(okReply());
     vi.stubGlobal('fetch', fetchSpy);
     const ask = await coachVia({ token: '' });
-    await expect(ask(anAttempt(), [{ role: 'user', text: 'hi' }], FAKE_KEY)).resolves.toBe('ok');
+    await expect(ask(anAttempt(), [{ role: 'user', content: 'hi' }], FAKE_KEY)).resolves.toMatchObject({ text: 'ok' });
     const [url, init] = fetchSpy.mock.calls[0];
     expect(url).toBe('https://api.anthropic.com/v1/messages');
     expect(init.headers['x-api-key']).toBe(FAKE_KEY);
   });
 });
+
+// ── tools: the request and the reply ────────────────────────────────────────
+//
+// The body is the contract with both transports and with the proxy's clamps;
+// the reply is untrusted, so parsing only sorts it into words and proposals.
+describe('the coach request carries tools; the reply splits into words and proposals', () => {
+  const capture = (reply) => {
+    const bodies = [];
+    vi.stubGlobal('fetch', vi.fn(async (_url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => reply }; }));
+    return bodies;
+  };
+  const withPouches = () => {
+    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
+    let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
+    r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [pouchAt('2026-09-21T14:00:00Z'), pouchAt('2026-09-20T19:30:00Z')] }));
+    return attemptById(r, 'a1');
+  };
+
+  it('an active attempt: tools = the eight, max_tokens 800, messages exactly as given', async () => {
+    const bodies = capture({ content: [{ type: 'text', text: 'ok' }] });
+    const turns = [{ role: 'user', content: 'hi' }];
+    await askCoach(withPouches(), turns, 'test-key');
+    expect(bodies[0].max_tokens).toBe(800);
+    expect(bodies[0].tools.map((t) => t.name)).toEqual(TOOL_NAMES);
+    expect(bodies[0].messages).toEqual(turns);
+  });
+
+  it('a past attempt: no tools at all, and a stray tool_use in the reply is dropped', async () => {
+    const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 60, startDate: '2026-07-08', mealTimes });
+    const r = archiveActive(startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-07-07T12:00:00Z' }), '2026-09-18T12:00:00Z');
+    const bodies = capture({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'toolu_1', name: 'log_pouch_now', input: {} }] });
+    const out = await askCoach(attemptById(r, 'a1'), [{ role: 'user', content: 'hi' }], 'test-key');
+    expect('tools' in bodies[0]).toBe(false);
+    expect(Object.keys(bodies[0])).toEqual(['model', 'max_tokens', 'system', 'messages']);
+    expect(out).toEqual({ text: 'ok', proposals: [], stopReason: null });
+  });
+
+  it('text + two tool_use blocks: words joined, proposals in order, stop reason kept', async () => {
+    capture({ stop_reason: 'tool_use', content: [
+      { type: 'text', text: 'Here are both.' },
+      { type: 'tool_use', id: 'toolu_1', name: 'add_late_pouch', input: { day: '2026-09-21', time: '08:30', triggers: [], note: '' } },
+      { type: 'text', text: '  Confirm and they are in. ' },
+      { type: 'tool_use', id: 'toolu_2', name: 'log_resisted_now', input: { trigger: 'stress' } },
+    ] });
+    expect(await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'test-key')).toEqual({
+      text: 'Here are both.\n\nConfirm and they are in.',
+      proposals: [
+        { id: 'toolu_1', name: 'add_late_pouch', input: { day: '2026-09-21', time: '08:30', triggers: [], note: '' } },
+        { id: 'toolu_2', name: 'log_resisted_now', input: { trigger: 'stress' } },
+      ],
+      stopReason: 'tool_use',
+    });
+  });
+
+  it('text only, tool_use only, and nothing at all', async () => {
+    capture({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Steady.' }] });
+    expect(await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k')).toEqual({ text: 'Steady.', proposals: [], stopReason: 'end_turn' });
+    capture({ content: [{ type: 'tool_use', id: 'toolu_1', name: 'log_pouch_now', input: {} }] });
+    expect(await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k')).toMatchObject({ text: '', proposals: [{ id: 'toolu_1' }] });
+    capture({ content: [] });
+    expect((await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k')).text).toBe('…');
+  });
+
+  it('the prompt names Now and every id the coach may point at', async () => {
+    const state = withPouches();
+    const ids = state.events.map((e) => e.id);
+    const system = await systemFor(state);
+    expect(system).toContain('Now: Mon 2026-09-21, 12:00 on the user\'s clock.');
+    expect(system).toContain('These ids are the only ones you may name in a tool:');
+    expect(system).toContain(`- ${ids[0]} · 2026-09-21 · 09:00 · no trigger`);
+    expect(system).toContain(`- ${ids[1]} · 2026-09-20 · 14:30 · no trigger`);
+  });
+
+  it('no tool names a forbidden action', async () => {
+    const bodies = capture({ content: [{ type: 'text', text: 'ok' }] });
+    await askCoach(withPouches(), [{ role: 'user', content: 'hi' }], 'k');
+    for (const t of bodies[0].tools) expect(t.name).not.toMatch(/attempt|plan|quit|setting|token|key|recover|price|meal/);
+  });
+});
```

- [ ] **Step 2: Run — expect red**

Run: `npx vitest run src/__tests__/coach.test.js`
Expected: FAIL — among others, `expected [ 'model', 'max_tokens', 'system', 'messages' ] to deeply equal [ 'model', 'max_tokens', 'system', 'tools', 'messages' ]`, `expected 400 to be 800`, and the reply tests receive a string instead of `{ text, proposals, stopReason }`.

- [ ] **Step 3: Change `src/coach.js`**

```diff
diff --git a/src/coach.js b/src/coach.js
--- a/src/coach.js
+++ b/src/coach.js
@@ -9,6 +9,7 @@ import { markdownSummary, asOfDay, dayNumberFor, isLogged, pouchesForDay, resist
 import { stageForDay, capForDay } from './plan.js';
 import { moneyStats } from './money.js';
 import { coachTransport, authErrorFor } from './proxyConfig.js';
+import { TOOLS, MAX_TOKENS, MAX_PROPOSALS, livePouchesForPrompt, promptClock } from './coachTools.js';
 
 const MODEL = 'claude-haiku-4-5-20251001';
 
@@ -46,9 +47,40 @@ function liveData(state) {
   ].join('\n');
 }
 
+// The pouches the coach may name, one per line, ids exactly as the app will
+// check them. Times are the wall clock where each pouch was logged.
+function pouchList(state, now) {
+  const rows = livePouchesForPrompt(state, now).map((p) => `- ${p.id} · ${p.day} · ${p.time ?? 'time unknown'} · ${p.trigger ?? 'no trigger'}`);
+  return rows.length ? rows.join('\n') : '- (none in the last 7 days)';
+}
+
+// A past attempt keeps the old wording: it gets no tools, and its history is
+// read-only, so the only honest answer to "fix this" is where the fix lives.
+const READ_ONLY_RULES = "What you can and can't do: you can talk about the plan and the log; you cannot add, change, backfill or tag anything, and you cannot see or change settings. If the user asks for a change, say plainly that you can't make it and point to the path in the app: tap the day on Calendar, or the pencil beside it in Stats → Fix this day (add a pouch you missed, with its time or 'unknown'; mark an accidental tap as a mistake; correct a past total; add reasons). This conversation is saved with the user's data and reviewed later, so for anything the app can't do yet, ask for the specifics a reviewer needs — which day, what count, which pouch — and confirm you've noted it. Never claim a change was made.";
+
+// The active attempt: the coach proposes with its tools, the user confirms
+// each card, and the app — never the model — decides what a card may write.
+function toolRules(state, now) {
+  const { day, time, weekday } = promptClock(now);
+  return `What you can and can't do: you can propose these actions; the user confirms each on a card in the app, and nothing is saved until they do. You can't change settings, the plan, or the attempt — for those, or anything the tools don't cover, point to the path in the app: tap the day on Calendar, or the pencil beside it in Stats → Fix this day. This conversation is saved with the user's data and reviewed later, so for anything the app can't do yet, ask for the specifics a reviewer needs — which day, what count, which pouch — and confirm you've noted it.
+
+Now: ${weekday} ${day}, ${time} on the user's clock. Days run 4 AM to 4 AM, so before 4 AM it is still the app day above.
+
+Pouches logged in the last 7 days, newest first (id · day · time · triggers). These ids are the only ones you may name in a tool:
+${pouchList(state, now)}
+
+Tool rules:
+- Propose only what the user clearly asked for or clearly stated as a fact. A guess is a question, not a card.
+- Never mark_mistake unless the user says a tap was an accident. Never add_late_pouch for a pouch already in the list.
+- Give a day as YYYY-MM-DD and a time as HH:MM 24h on that day; "4:30" in the evening means 16:30; before 4 AM belongs to the previous app day (the app handles it — just name the day the user means). Use null when the user doesn't remember the time.
+- fill_missed_day within cap: ask whether the streak keeps or breaks before proposing, unless the user said.
+- At most ${MAX_PROPOSALS} actions in a reply. Say in one short sentence what each card does; the card is the confirmation, so never claim it is done.
+- After a tool result: one short line. "4:30 is in." / "That one didn't save — the app says it's already logged." Nothing is done until the result says saved.`;
+}
+
 // "You" is the coach; the person is always "the user". Nothing here names
 // anyone — the plan, dates, and numbers all come from the attempt.
-function systemPrompt(state) {
+function systemPrompt(state, now) {
   const plan = state.plan;
   const kept = moneyStats(state).kept;
   return `You are the in-app coach for "Pouch Down", a nicotine pouch taper app. The user ${state.status === 'archived' ? 'was' : 'is'} on a ${plan.totalDays}-day taper, ${plan.startDate} to quit day ${plan.quitDate}.
@@ -66,7 +98,7 @@ In the log, "early" means before the pacing slot unlocked and "over" means beyon
 
 Coaching style: direct, warm, zero shame, zero toxic positivity. Cravings are waves; delay beats willpower. Reference the user's actual numbers when relevant. If the user went over, normalize it fast and refocus on the next slot, not the miss. 2-4 sentences per reply — this is a phone chat, not an essay. Never give medical advice; suggest a doctor for anything clinical.
 
-What you can and can't do: you can talk about the plan and the log; you cannot add, change, backfill or tag anything, and you cannot see or change settings. If the user asks for a change, say plainly that you can't make it and point to the path in the app: tap the day on Calendar, or the pencil beside it in Stats → Fix this day (add a pouch you missed, with its time or 'unknown'; mark an accidental tap as a mistake; correct a past total; add reasons). This conversation is saved with the user's data and reviewed later, so for anything the app can't do yet, ask for the specifics a reviewer needs — which day, what count, which pouch — and confirm you've noted it. Never claim a change was made.`;
+${state.status === 'archived' ? READ_ONLY_RULES : toolRules(state, now)}`;
 }
 
 // Thrown error names the sheet maps to copy: 'no-key' (no proxy and no key),
@@ -74,17 +106,25 @@ What you can and can't do: you can talk about the plan and the log; you cannot a
 // 'bad-key' / 'bad-device-token' (401 — whichever credential was actually sent),
 // and anything else is the message the far end gave, or `API error <status>`.
 // `apiKey` is only ever read when the proxy isn't in play.
-export async function askCoach(state, messages, apiKey) {
+//
+// `turns` is the conversation as the Messages API takes it (coachActions.js
+// toTurns). → { text, proposals: [{ id, name, input }], stopReason }: every
+// text block joined, every tool_use block a proposal, in order. Proposals are
+// untrusted — the caller validates them before anything is shown.
+export async function askCoach(state, turns, apiKey, now = Date.now()) {
   const { url, headers, mode } = coachTransport(apiKey);
+  const archived = state.status === 'archived';
 
   const res = await fetch(url, {
     method: 'POST',
     headers,
     body: JSON.stringify({
       model: MODEL,
-      max_tokens: 400,
-      system: systemPrompt(state),
-      messages: messages.map((m) => ({ role: m.role, content: m.text })),
+      max_tokens: MAX_TOKENS,
+      system: systemPrompt(state, now),
+      // History is read-only: a past attempt is never offered a tool.
+      ...(archived ? {} : { tools: TOOLS }),
+      messages: turns,
     }),
   });
 
@@ -94,5 +134,11 @@ export async function askCoach(state, messages, apiKey) {
     throw new Error(body?.error?.message || `API error ${res.status}`);
   }
   const data = await res.json();
-  return data.content?.[0]?.text ?? '…';
+  const blocks = Array.isArray(data?.content) ? data.content : [];
+  const text = blocks
+    .filter((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim())
+    .map((b) => b.text.trim())
+    .join('\n\n');
+  const proposals = archived ? [] : blocks.filter((b) => b?.type === 'tool_use').map(({ id, name, input }) => ({ id, name, input }));
+  return { text: text || (proposals.length ? '' : '…'), proposals, stopReason: typeof data?.stop_reason === 'string' ? data.stop_reason : null };
 }
```

The wording is the spec's, with one change forced by an existing pin: "propose these actions with your tools" would break `talks about "the user", never "your"`, so the active paragraph says "you can propose these actions; the user confirms each on a card" — the spec's own phrasing.

- [ ] **Step 4: Run — expect green; whole suite**

Run: `npx vitest run src/__tests__/coach.test.js` → PASS, 20 tests. Then `npm test` → all green (CoachSheet has no unit test; it moves to the new `askCoach` in Task 7).

- [ ] **Step 5: Commit**

```bash
git add src/coach.js src/__tests__/coach.test.js
git commit -m "coach.js: the active coach gets eight tools, Now, and the pouch ids it may name

max_tokens 800 (the Worker's new clamp). A past attempt gets no tools and keeps
the read-only wording. The reply splits into words and proposals; proposals are
untrusted and go straight to coachActions.js."
```

---

### Task 4: The Worker learns tools and content blocks; the pin (Lane B)

Same change as the prompt (the spec: "Same change, same commit as the prompt" — the coordinator merges Tasks 3 and 4 back to back, before anything else lands on the branch). The proxy stays dormant (`COACH_PROXY` empty); nothing is deployed.

**How the Worker's tests run:** there is no `package.json` in `workers/coach-proxy/` and no separate `npm test` — the root `vite.config.js` includes `workers/**/*.test.js`, so `npm test` runs them, and `npx vitest run workers/coach-proxy` runs them alone from the repo root. (The README said otherwise; Step 6 fixes it.) The spec's gate "the Worker's own `npm test` green" is therefore `npx vitest run workers/coach-proxy`.

**Files:**
- Modify: `workers/coach-proxy/src/guard.js`
- Modify: `workers/coach-proxy/__tests__/guard.test.js`
- Modify: `workers/coach-proxy/README.md`
- Create: `src/__tests__/coachProxyPin.test.js` (Steps 7–9, after Task 3)
- `workers/coach-proxy/src/worker.js` does **not** change: it reads `LIMITS.bodyBytes` for the early `content-length` check and calls `checkBody`, so the new caps reach it through the import.

- [ ] **Step 1: Write the failing tests — `workers/coach-proxy/__tests__/guard.test.js`**

The body fixtures are literals in the app's exact shapes, so this file runs without the app's modules:

```diff
diff --git a/workers/coach-proxy/__tests__/guard.test.js b/workers/coach-proxy/__tests__/guard.test.js
--- a/workers/coach-proxy/__tests__/guard.test.js
+++ b/workers/coach-proxy/__tests__/guard.test.js
@@ -11,6 +11,7 @@ import {
   checkBody,
   corsHeaders,
   LIMITS,
+  TOOL_NAMES,
 } from '../src/guard.js';
 
 const ORIGINS = 'https://jxmcc15.github.io, http://localhost:5173';
@@ -23,6 +24,7 @@ const SECOND = 'abababababababababababababababababababababababab0';
 const TOKENS = `${GOOD},${SECOND}`;
 
 const MODEL = 'claude-haiku-4-5-20251001';
+const byteLen = (text) => new TextEncoder().encode(text).length;
 
 function validBody(over = {}) {
   return JSON.stringify({
@@ -167,7 +169,7 @@ describe('checkBody — what it refuses', () => {
     expect(checkBody(validBody({ max_tokens: '400' })).status).toBe(400);
   });
 
-  it('refuses a field that is not one of the four allowed ones', () => {
+  it('refuses a field that is not one of the five allowed ones', () => {
     const r = checkBody(validBody({ temperature: 1 }));
     expect(r.ok).toBe(false);
     expect(r.status).toBe(400);
@@ -176,7 +178,7 @@ describe('checkBody — what it refuses', () => {
 
   it('refuses extra fields whatever they are called', () => {
     expect(checkBody(validBody({ stream: true })).status).toBe(400);
-    expect(checkBody(validBody({ tools: [] })).status).toBe(400);
+    expect(checkBody(validBody({ tool_choice: { type: 'any' } })).status).toBe(400);
     expect(checkBody(validBody({ metadata: { user_id: 'x' } })).status).toBe(400);
   });
 
@@ -278,11 +280,110 @@ describe('corsHeaders', () => {
 
 describe('LIMITS', () => {
   it('is the one place the caps are written down', () => {
-    expect(LIMITS.maxTokens).toBe(400);
-    expect(LIMITS.bodyBytes).toBe(16 * 1024);
+    expect(LIMITS.maxTokens).toBe(800);
+    expect(LIMITS.bodyBytes).toBe(48 * 1024);
     expect(LIMITS.messages).toBe(40);
     expect(LIMITS.totalChars).toBe(60 * 1024);
     expect(LIMITS.models).toEqual([MODEL]);
-    expect(LIMITS.fields).toEqual(['model', 'max_tokens', 'system', 'messages']);
+    expect(LIMITS.fields).toEqual(['model', 'max_tokens', 'system', 'tools', 'messages']);
+    expect(LIMITS).toMatchObject({ tools: 8, toolDescription: 1024, toolSchema: 4096, blocks: 12, toolInput: 2048, toolResult: 500 });
+    expect(TOOL_NAMES).toEqual(['log_pouch_now', 'log_resisted_now', 'add_late_pouch', 'mark_mistake', 'add_reason', 'fill_missed_day', 'correct_day_total', 'log_checkin']);
+  });
+});
+
+// ── the coach as app assistant (2026-10-02) ─────────────────────────────────
+//
+// The app now sends its eight tools, replays the coach's tool calls, and
+// answers them with tool results. Every one of those is clamped here, and the
+// bodies below are the app's exact shapes, written out as literals so this file
+// runs on its own (coachProxyPin.test.js checks the app's REAL bodies).
+
+const tool = (name, over = {}) => ({
+  name,
+  description: 'Propose logging a pouch the user is taking right now.',
+  input_schema: { type: 'object', properties: { trigger: { type: 'string', enum: ['coffee', 'stress'] } }, required: [], additionalProperties: false },
+  ...over,
+});
+const TOOLS = TOOL_NAMES.map((n) => tool(n));
+const USE = { type: 'tool_use', id: 'toolu_01', name: 'add_late_pouch', input: { day: '2026-10-01', time: '16:30', triggers: ['boredom'], note: '' } };
+const RESULT = { type: 'tool_result', tool_use_id: 'toolu_01', content: 'saved' };
+const withTools = (messages, over = {}) => validBody({ max_tokens: 800, tools: TOOLS, messages, ...over });
+const FIRST = [{ role: 'user', content: 'had one at 4:30 I forgot, boredom' }];
+const PROPOSED = [...FIRST, { role: 'assistant', content: [{ type: 'text', text: "Here's that 4:30 one — confirm and it's in." }, USE] }];
+
+describe('checkBody — the app\'s exact bodies', () => {
+  it('text-only, as a chat with no actions sends it (tools offered, none called)', () => {
+    expect(checkBody(withTools(FIRST)).ok).toBe(true);
+  });
+  it('the follow-up: the coach\'s tool call replayed, then a user turn of only tool results', () => {
+    expect(checkBody(withTools([...PROPOSED, { role: 'user', content: [RESULT] }])).ok).toBe(true);
+  });
+  it('a typed turn that answers pending cards: results first, then the text; an error result too', () => {
+    const skipped = { type: 'tool_result', tool_use_id: 'toolu_01', content: 'invalid: unknown action', is_error: true };
+    expect(checkBody(withTools([...PROPOSED, { role: 'user', content: [skipped, { type: 'text', text: 'never mind' }] }])).ok).toBe(true);
+  });
+  it('a past attempt: no tools field at all', () => {
+    expect(checkBody(validBody({ max_tokens: 800 })).ok).toBe(true);
+  });
+});
+
+describe('checkBody — the new clamps', () => {
+  it('max_tokens 800 passes, 801 does not', () => {
+    expect(checkBody(withTools(FIRST, { max_tokens: 800 })).ok).toBe(true);
+    expect(checkBody(withTools(FIRST, { max_tokens: 801 })).message).toBe('max_tokens must be 800 or less.');
+  });
+  it('a body of exactly 48 KB passes; one byte more does not', () => {
+    const at = (n) => {
+      const base = withTools([{ role: 'user', content: '' }]);
+      return base.replace('"content":""', `"content":"${'x'.repeat(n - byteLen(base))}"`);
+    };
+    expect(byteLen(at(LIMITS.bodyBytes))).toBe(LIMITS.bodyBytes);
+    expect(checkBody(at(LIMITS.bodyBytes)).ok).toBe(true);
+    expect(checkBody(at(LIMITS.bodyBytes + 1)).message).toBe('Request body is too large.');
+  });
+  it('tools: an empty list, nine tools, a name the app lacks, a repeated name', () => {
+    expect(checkBody(withTools(FIRST, { tools: [] })).message).toBe('tools must be a non-empty array.');
+    expect(checkBody(withTools(FIRST, { tools: [...TOOLS, tool('log_pouch_now')] })).message).toBe('Too many tools — 8 at most.');
+    expect(checkBody(withTools(FIRST, { tools: [tool('update_settings')] })).message).toBe('That tool is not allowed.');
+    expect(checkBody(withTools(FIRST, { tools: [tool('mark_mistake'), tool('mark_mistake')] })).message).toBe('That tool is not allowed.');
+  });
+  it('tools: an extra key, a long description, a big or non-object schema', () => {
+    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { cache_control: { type: 'ephemeral' } })] })).status).toBe(400);
+    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { description: 'x'.repeat(1025) })] })).message).toBe('A tool description is missing or too long.');
+    const big = { type: 'object', properties: { note: { type: 'string', description: 'x'.repeat(4096) } } };
+    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { input_schema: big })] })).message).toBe('A tool input_schema is missing or too large.');
+    expect(checkBody(withTools(FIRST, { tools: [tool('log_pouch_now', { input_schema: { type: 'string' } })] })).status).toBe(400);
+  });
+  it('a tool_use in a user message, or a tool_result in an assistant message', () => {
+    expect(checkBody(withTools([{ role: 'user', content: [USE] }])).message).toBe('Only the assistant can call a tool.');
+    expect(checkBody(withTools([...FIRST, { role: 'assistant', content: [RESULT] }])).message).toBe('Only the user can return a tool result.');
+  });
+  it('a tool_use naming a tool the app lacks, a big input, a non-object input, an extra key', () => {
+    const asCoach = (b) => withTools([...FIRST, { role: 'assistant', content: [b] }]);
+    expect(checkBody(asCoach({ ...USE, name: 'start_attempt' })).message).toBe('That tool is not allowed.');
+    expect(checkBody(asCoach({ ...USE, input: { note: 'x'.repeat(2048) } })).message).toBe('A tool_use input is too large.');
+    expect(checkBody(asCoach({ ...USE, input: 'log it' })).message).toBe('A tool_use input must be an object.');
+    expect(checkBody(asCoach({ ...USE, cache_control: { type: 'ephemeral' } })).status).toBe(400);
+  });
+  it('a tool_result with long content, no content, a non-boolean is_error, an extra key', () => {
+    const asUser = (b) => withTools([...PROPOSED, { role: 'user', content: [b] }]);
+    expect(checkBody(asUser({ ...RESULT, content: 'x'.repeat(501) })).message).toBe('A tool_result content must be a short string.');
+    expect(checkBody(asUser({ ...RESULT, content: '' })).status).toBe(400);
+    expect(checkBody(asUser({ ...RESULT, content: [{ type: 'text', text: 'saved' }] })).status).toBe(400);
+    expect(checkBody(asUser({ ...RESULT, is_error: 'yes' })).message).toBe('is_error must be true or false.');
+    expect(checkBody(asUser({ ...RESULT, cache_control: {} })).status).toBe(400);
+  });
+  it('content blocks: 12 pass, 13 do not; none at all does not; an image or a bare string block does not', () => {
+    const texts = (n) => Array.from({ length: n }, () => ({ type: 'text', text: 'ok' }));
+    expect(checkBody(withTools([{ role: 'user', content: texts(12) }])).ok).toBe(true);
+    expect(checkBody(withTools([{ role: 'user', content: texts(13) }])).message).toBe('A message holds 1 to 12 content blocks.');
+    expect(checkBody(withTools([{ role: 'user', content: [] }])).status).toBe(400);
+    expect(checkBody(withTools([{ role: 'user', content: [{ type: 'image', source: {} }] }])).message).toBe('That content block type is not allowed.');
+    expect(checkBody(withTools([{ role: 'user', content: ['hi'] }])).message).toBe('Each content block must be an object.');
+    expect(checkBody(withTools([{ role: 'user', content: [{ type: 'text', text: '' }] }])).status).toBe(400);
+  });
+  it('every block\'s text counts toward the character cap', () => {
+    const r = checkBody(withTools([{ role: 'user', content: [{ type: 'text', text: 'y'.repeat(200) }] }]), { totalChars: 100 + 'You are a warm, direct coach.'.length });
+    expect(r.message).toBe('The conversation is too long.');
   });
 });
```

- [ ] **Step 2: Run — expect red**

Run: `npx vitest run workers/coach-proxy`
Expected: FAIL — `TOOL_NAMES` is not exported (`expected undefined to deeply equal [ 'log_pouch_now', … ]`), `Unsupported field in request body: tools`, `max_tokens must be 400 or less.`, `Request body is too large.` for the 48 KB body.

- [ ] **Step 3: Change `workers/coach-proxy/src/guard.js`**

```diff
diff --git a/workers/coach-proxy/src/guard.js b/workers/coach-proxy/src/guard.js
--- a/workers/coach-proxy/src/guard.js
+++ b/workers/coach-proxy/src/guard.js
@@ -7,17 +7,33 @@
 // `message` is what the caller is told — it never carries a secret, a header
 // value, or anything about how the check was made.
 
+// The eight actions the app's coach may propose — its own copy, because the
+// Worker ships alone. src/__tests__/coachProxyPin.test.js pins it equal to
+// TOOL_NAMES in src/coachTools.js, so the two can't drift.
+export const TOOL_NAMES = [
+  'log_pouch_now', 'log_resisted_now', 'add_late_pouch', 'mark_mistake',
+  'add_reason', 'fill_missed_day', 'correct_day_total', 'log_checkin',
+];
+
 // The caps, in one place so the README, the tests and the code can't drift.
 // They exist to bound what a stolen device token can cost: one small model,
-// short answers, small requests.
+// short answers, small requests — and, since the coach proposes actions, only
+// the app's own eight tools, each small, with tool calls and their results
+// only where the conversation can hold them.
 export const LIMITS = {
   models: ['claude-haiku-4-5-20251001'],
-  fields: ['model', 'max_tokens', 'system', 'messages'],
+  fields: ['model', 'max_tokens', 'system', 'tools', 'messages'],
   roles: ['user', 'assistant'],
-  maxTokens: 400,
-  bodyBytes: 16 * 1024,
+  maxTokens: 800,
+  bodyBytes: 48 * 1024,
   messages: 40,
   totalChars: 60 * 1024,
+  tools: 8,
+  toolDescription: 1024,
+  toolSchema: 4 * 1024,
+  blocks: 12,
+  toolInput: 2 * 1024,
+  toolResult: 500,
 };
 
 // `ALLOWED_ORIGINS` and `DEVICE_TOKENS` are both comma-separated settings typed
@@ -73,10 +89,61 @@ function byteLength(text) {
   return new TextEncoder().encode(text).length;
 }
 
+const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
+const onlyKeys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));
+
+// The app's tool definitions: name, description and schema, nothing else, and
+// only the names the app has. → a refusal message, or null when they'll do.
+function toolsProblem(tools, lim) {
+  if (!Array.isArray(tools) || tools.length === 0) return 'tools must be a non-empty array.';
+  if (tools.length > lim.tools) return `Too many tools — ${lim.tools} at most.`;
+  const seen = new Set();
+  for (const t of tools) {
+    if (!isObj(t) || !onlyKeys(t, ['name', 'description', 'input_schema'])) return 'Each tool may only have a name, a description and an input_schema.';
+    if (!TOOL_NAMES.includes(t.name) || seen.has(t.name)) return 'That tool is not allowed.';
+    seen.add(t.name);
+    if (typeof t.description !== 'string' || t.description.length > lim.toolDescription) return 'A tool description is missing or too long.';
+    if (!isObj(t.input_schema) || t.input_schema.type !== 'object' || JSON.stringify(t.input_schema).length > lim.toolSchema) {
+      return 'A tool input_schema is missing or too large.';
+    }
+  }
+  return null;
+}
+
+// One content block of one message. → [refusal message | null, characters it
+// adds to the conversation]. Text in either role; a tool call only from the
+// assistant, a tool result only from the user — the only places the app puts them.
+function blockProblem(b, role, lim) {
+  if (!isObj(b)) return ['Each content block must be an object.', 0];
+  if (b.type === 'text') {
+    if (!onlyKeys(b, ['type', 'text']) || typeof b.text !== 'string' || b.text === '') return ['A text block needs non-empty text and nothing else.', 0];
+    return [null, b.text.length];
+  }
+  if (b.type === 'tool_use') {
+    if (role !== 'assistant') return ['Only the assistant can call a tool.', 0];
+    if (!onlyKeys(b, ['type', 'id', 'name', 'input']) || typeof b.id !== 'string' || b.id === '') return ['A tool_use block needs an id, a name and an input, and nothing else.', 0];
+    if (!TOOL_NAMES.includes(b.name)) return ['That tool is not allowed.', 0];
+    if (!isObj(b.input)) return ['A tool_use input must be an object.', 0];
+    const input = JSON.stringify(b.input);
+    if (input.length > lim.toolInput) return ['A tool_use input is too large.', 0];
+    return [null, b.id.length + input.length];
+  }
+  if (b.type === 'tool_result') {
+    if (role !== 'user') return ['Only the user can return a tool result.', 0];
+    if (!onlyKeys(b, ['type', 'tool_use_id', 'content', 'is_error']) || typeof b.tool_use_id !== 'string' || b.tool_use_id === '') {
+      return ['A tool_result block needs a tool_use_id and content, and nothing else.', 0];
+    }
+    if (typeof b.content !== 'string' || b.content === '' || b.content.length > lim.toolResult) return ['A tool_result content must be a short string.', 0];
+    if (b.is_error !== undefined && typeof b.is_error !== 'boolean') return ['is_error must be true or false.', 0];
+    return [null, b.tool_use_id.length + b.content.length];
+  }
+  return ['That content block type is not allowed.', 0];
+}
+
 // The request body, as the raw text that arrived. Everything about it is
 // checked before a single byte goes upstream: its size, that it parses, that it
-// holds only the four fields the app sends, and that each of those is the shape
-// and size we expect. `limits` is only overridden by tests.
+// holds only the fields the app sends, and that each of those is the shape and
+// size we expect. `limits` is only overridden by tests.
 export function checkBody(raw, limits = {}) {
   const lim = { ...LIMITS, ...limits };
 
@@ -111,6 +178,11 @@ export function checkBody(raw, limits = {}) {
     return bad('system must be a string.');
   }
 
+  if (body.tools !== undefined) {
+    const problem = toolsProblem(body.tools, lim);
+    if (problem) return bad(problem);
+  }
+
   if (!Array.isArray(body.messages) || body.messages.length === 0) {
     return bad('messages must be a non-empty array.');
   }
@@ -129,10 +201,19 @@ export function checkBody(raw, limits = {}) {
       }
     }
     if (!lim.roles.includes(m.role)) return bad('Each message needs a role of user or assistant.');
-    if (typeof m.content !== 'string' || m.content === '') {
-      return bad('Each message needs content as a non-empty string.');
+    if (typeof m.content === 'string') {
+      if (m.content === '') return bad('Each message needs content as a non-empty string or a list of blocks.');
+      chars += m.content.length;
+    } else if (Array.isArray(m.content)) {
+      if (m.content.length === 0 || m.content.length > lim.blocks) return bad(`A message holds 1 to ${lim.blocks} content blocks.`);
+      for (const b of m.content) {
+        const [problem, n] = blockProblem(b, m.role, lim);
+        if (problem) return bad(problem);
+        chars += n;
+      }
+    } else {
+      return bad('Each message needs content as a non-empty string or a list of blocks.');
     }
-    chars += m.content.length;
   }
   if (chars > lim.totalChars) return bad('The conversation is too long.');
 
```

- [ ] **Step 4: Run — expect green**

Run: `npx vitest run workers/coach-proxy`
Expected: PASS — 45 tests.

- [ ] **Step 5: (no code) Confirm `worker.js` needs nothing** — `grep -n "LIMITS\|checkBody" workers/coach-proxy/src/worker.js` prints the import, the `content-length` pre-check and the `checkBody(raw)` call; nothing else names a cap.

- [ ] **Step 6: `workers/coach-proxy/README.md`** (four backticks: the diff itself contains a fenced block)

````diff
diff --git a/workers/coach-proxy/README.md b/workers/coach-proxy/README.md
--- a/workers/coach-proxy/README.md
+++ b/workers/coach-proxy/README.md
@@ -153,7 +153,7 @@ Every refusal comes back as `{"error":{"message":"…"}}` with a status code:
 | --- | --- | --- |
 | 403 | Origin not allowed | the `origin` header is missing, or isn't in `ALLOWED_ORIGINS` in `wrangler.toml` |
 | 401 | Unknown device | the `x-pd-device` token doesn't match what you uploaded |
-| 400 | The request itself is refused | wrong model, `max_tokens` over 400, an extra field, or too much text |
+| 400 | The request itself is refused | wrong model, `max_tokens` over 800, an extra field, a tool the app doesn't have, or too much text |
 | 405 | Wrong method or path | it has to be `POST` to `/v1/messages` |
 | 502 | The call to Claude failed | no API key uploaded, key rejected, or Claude is having a moment |
 
@@ -214,7 +214,7 @@ the code only ever prints a failure's name and an upstream status number.
 Cloudflare's free plan includes 100,000 Worker requests a day. Coach chats and
 price look-ups are a handful of requests a day, so this stays free with a very
 large margin. The part that does cost money is the Claude API usage itself,
-which is why the model is pinned to Haiku, `max_tokens` is capped at 400, and the
+which is why the model is pinned to Haiku, `max_tokens` is capped at 800, and the
 key should sit on a workspace with a monthly spend cap.
 
 ---
@@ -228,22 +228,28 @@ in one object (`LIMITS`) so they can't drift from the tests or this README:
 | Limit | Value |
 | --- | --- |
 | Model allowed | `claude-haiku-4-5-20251001` only |
-| `max_tokens` | 400 or less |
-| Request body | 16 KB |
+| `max_tokens` | 800 or less |
+| Request body | 48 KB |
 | Messages per request | 40 |
 | Total characters (system + messages) | 60 KB |
-| Body fields allowed | `model`, `max_tokens`, `system`, `messages` — nothing else |
+| Body fields allowed | `model`, `max_tokens`, `system`, `tools`, `messages` — nothing else |
+| Tools | 1 to 8, each only `name` / `description` / `input_schema`; names from `TOOL_NAMES` (the app's eight); description ≤ 1 KB; schema ≤ 4 KB |
+| Message content | a non-empty string, or 1 to 12 blocks: `text`; `tool_use` (assistant only, input ≤ 2 KB); `tool_result` (user only, content ≤ 500 characters, optional boolean `is_error`) |
+
+`TOOL_NAMES` is the Worker's own copy of the app's tool list;
+`src/__tests__/coachProxyPin.test.js` fails if the two ever differ, and runs
+the app's real request bodies through `checkBody`. A prompt or tool change and
+the matching change here ship in the same commit.
 
 Run the tests:
 
 ```sh
-npx vitest run --root workers/coach-proxy
+npx vitest run workers/coach-proxy
 ```
 
-(from the repo root, or `npx vitest run` from this folder). The repo's own
-`npm test` uses `test.include: ['src/**/*.test.js']` in `vite.config.js`, which
-does not reach this folder — adding `'workers/**/*.test.js'` to that list would
-fold these tests into the main suite.
+from the repo root. There is no separate package here: the repo's own
+`npm test` includes `workers/**/*.test.js` (see `test.include` in
+`vite.config.js`), so these tests run with everything else.
 
 Nothing in here is deployed by the repo's GitHub Actions workflow. The Worker
 only changes when someone runs `npx wrangler deploy` from this folder.
````

Commit Steps 1–6:

```bash
git add workers/coach-proxy/src/guard.js workers/coach-proxy/__tests__/guard.test.js workers/coach-proxy/README.md
git commit -m "Worker: tools, content blocks and tool results, each clamped — dormant until deployed

Only the app's eight tool names, each tool small; tool_use only from the
assistant, tool_result only from the user; 12 blocks a message; max_tokens 800;
48 KB bodies. Everything else is still refused. Ships with the prompt change."
```

- [ ] **Step 7 (after Task 3): Write the pin — `src/__tests__/coachProxyPin.test.js`**

```js
// The app and the proxy are two programs that must agree on one contract: the
// tool names, the token cap, and the exact bodies the app sends. The Worker
// ships on its own, so it keeps its own copy of each — pinned here to the
// app's, with the REAL bodies askCoach builds run through the Worker's guard.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOOLS, TOOL_NAMES, MAX_TOKENS, RESULT_MAX, TOOL_INPUT_MAX } from '../coachTools.js';
import { askCoach } from '../coach.js';
import { takeProposals, toTurns, resultsFor } from '../coachActions.js';
import { TOOL_NAMES as WORKER_TOOL_NAMES, LIMITS, checkBody } from '../../workers/coach-proxy/src/guard.js';
import { DEFAULT_SETTINGS, freshRoot, startAttempt, updateAttempt, archiveActive, attemptById } from '../root.js';
import { generatePlan } from '../planGenerator.js';
import { makeEvent } from '../store.js';

const mealTimes = DEFAULT_SETTINGS.mealTimes;
const NOW = Date.parse('2026-09-21T17:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const active = () => {
  const plan = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-09-19', mealTimes });
  let r = startAttempt(freshRoot(), { plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' });
  r = updateAttempt(r, 'a1', (a) => ({ ...a, events: [makeEvent('pouch', null, new Date('2026-09-21T14:00:00Z'))] }));
  return attemptById(r, 'a1');
};

// Every body askCoach posts, as the raw string the Worker would receive.
function captureBodies() {
  const bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    bodies.push(init.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) };
  }));
  return bodies;
}

describe('the Worker and the app agree', () => {
  it('on the tool names and the token cap', () => {
    expect(WORKER_TOOL_NAMES).toEqual(TOOL_NAMES);
    expect(LIMITS.maxTokens).toBe(MAX_TOKENS);
    expect(LIMITS.tools).toBeGreaterThanOrEqual(TOOLS.length);
    expect(LIMITS.toolResult).toBe(RESULT_MAX);
    expect(LIMITS.toolInput).toBe(TOOL_INPUT_MAX);
  });
  it('every tool the app sends fits the Worker\'s per-tool clamps', () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeLessThanOrEqual(LIMITS.toolDescription);
      expect(JSON.stringify(t.input_schema).length).toBeLessThanOrEqual(LIMITS.toolSchema);
    }
  });
  it('the app\'s real bodies pass checkBody: first turn, follow-up, typed-while-pending, past attempt', async () => {
    const bodies = captureBodies();
    const state = active();
    const pouchId = state.events[0].id;
    const proposals = [
      { id: 'toolu_01', name: 'add_late_pouch', input: { day: '2026-09-21', time: '08:30', triggers: ['boredom'], note: '' } },
      { id: 'toolu_02', name: 'mark_mistake', input: { pouch_id: 'not-a-real-id' } },
      { id: 'toolu_03', name: 'add_reason', input: { pouch_id: pouchId, triggers: ['stress'], note: '' } },
    ];
    const { cards, overflow } = takeProposals(state, proposals, NOW);
    const coach = { role: 'assistant', text: 'Three cards.', proposals, cards, overflow };
    const user = { role: 'user', text: 'had one at 8:30, boredom' };

    await askCoach(state, toTurns([user]), 'test-key');
    const saved = { ...coach, cards: cards.map((c) => (c.status === 'pending' ? { ...c, status: 'saved', eventId: 'e1' } : c)) };
    await askCoach(state, toTurns([user, saved, { role: 'user', text: 'Confirmed: …', results: resultsFor(saved), auto: true }]), 'test-key');
    const skipped = { ...coach, cards: cards.map((c) => (c.status === 'pending' ? { ...c, status: 'skipped' } : c)) };
    await askCoach(state, toTurns([user, skipped, { role: 'user', text: 'never mind', results: resultsFor(skipped) }]), 'test-key');
    const r = archiveActive(startAttempt(freshRoot(), { plan: state.plan, settings: { ...DEFAULT_SETTINGS }, now: '2026-09-18T12:00:00Z' }), '2026-09-20T12:00:00Z');
    await askCoach(attemptById(r, 'a1'), toTurns([user]), 'test-key');

    expect(bodies).toHaveLength(4);
    for (const raw of bodies) expect(checkBody(raw)).toMatchObject({ ok: true });
    expect(JSON.parse(bodies[1]).messages[2].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'tool_result']);
    expect(JSON.parse(bodies[2]).messages[2].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'tool_result', 'text']);
    expect('tools' in JSON.parse(bodies[3])).toBe(false);
  });
});
```

- [ ] **Step 8: Run — green** (it pins a contract both sides already meet; if it is red, one side drifted — fix that side, never the pin)

Run: `npx vitest run src/__tests__/coachProxyPin.test.js`
Expected: PASS — 3 tests. To see it bite once, change one name in `workers/coach-proxy/src/guard.js` `TOOL_NAMES` and rerun: `the Worker and the app agree > on the tool names and the token cap` fails, and the real bodies fail `checkBody` with `That tool is not allowed.` Revert.

- [ ] **Step 9: Commit**

```bash
git add src/__tests__/coachProxyPin.test.js
git commit -m "Pin: the Worker's tool names and caps equal the app's, and the app's real bodies pass checkBody

First turn, follow-up of only tool_results, typed turn led by tool_results,
and a past attempt with no tools — all built by askCoach + toTurns, all through
the Worker's guard."
```

---

### Task 5: Saved chats record actions and outcomes; the api says no honestly (Lane C)

**Files:**
- Modify: `src/root.js` (`CHAT_OUTCOMES`, `wellFormedChatAction`, `wellFormedChatOutcome`, `wellFormedMessage`)
- Modify: `src/state.jsx` (`backfillOk`, `chatEntries`, `appendChatTurn`, `logBackfill`, `logPouch`, `logResisted`, `logCheckin`)
- Modify: `src/ingest.js` (Coach chats section)
- Modify: `src/__tests__/corrections.test.js`, `src/__tests__/root.test.js`, `src/__tests__/ingest.test.js`

Stored shape (spec, "Saved chats"):

```
chat.messages[i] = { role, text, ts,
  actions?:  [{ name, summary }],                            // on a coach message that proposed
  outcomes?: [{ name, summary, outcome, reason? }] }         // on the user message that answered
```

`wellFormed` (load gate) checks types and the outcome enum only — a long summary can't crash a render, so length is not a reason to send James to the recovery screen. `appendChatTurn` (write gate) also bounds lengths (name ≤ 40, summary and reason ≤ 200, 1–5 entries) and drops a bad list, keeping the words. A coach reply that is only cards may have blank words when it carries `actions`. The user message of a typed turn that skipped pending cards carries `outcomes` too (not only the follow-up's), so the vault shows every card's end.

- [ ] **Step 1: Failing tests — `src/__tests__/corrections.test.js`**

```diff
diff --git a/src/__tests__/corrections.test.js b/src/__tests__/corrections.test.js
--- a/src/__tests__/corrections.test.js
+++ b/src/__tests__/corrections.test.js
@@ -223,6 +223,72 @@ describe('appendChatTurn — coach chats saved with the attempt', () => {
     app().api.appendChatTurn(null, { user: 'hi', assistant: 'hello' });
     expect(events()).toEqual([]);
   });
+
+  // ── what the coach proposed, and how each card ended (2026-10-02) ──
+  const ACT = { name: 'add_late_pouch', summary: 'Add a pouch · Thu Sep 24 · 4:30 PM · boredom' };
+  const OUT = { ...ACT, outcome: 'saved' };
+
+  it('actions ride on the coach message, outcomes on the user message', () => {
+    const id = app().api.appendChatTurn(null, { user: 'had one at 4:30', assistant: 'Confirm and it is in.', actions: [ACT] });
+    app().api.appendChatTurn(id, { user: 'Confirmed: Add a pouch · Thu Sep 24 · 4:30 PM · boredom', assistant: '4:30 is in.', outcomes: [OUT] });
+    const [u1, c1, u2, c2] = chats()[0].messages;
+    expect(u1).not.toHaveProperty('outcomes');
+    expect(c1.actions).toEqual([ACT]);
+    expect(u2.outcomes).toEqual([OUT]);
+    expect(c2).not.toHaveProperty('actions');
+  });
+
+  it('a coach reply that is only cards saves with blank words; with no cards it is still refused', () => {
+    expect(app().api.appendChatTurn(null, { user: 'log one', assistant: '', actions: [ACT] })).toEqual(expect.any(String));
+    expect(chats()[0].messages[1]).toEqual({ role: 'assistant', text: '', ts: new Date(T0).toISOString(), actions: [ACT] });
+    expect(app().api.appendChatTurn(null, { user: 'log one', assistant: '', actions: 'nope' })).toBeNull();
+  });
+
+  it('a refused or invalid outcome keeps its reason; extra fields are not stored', () => {
+    const refused = { name: 'fill_missed_day', summary: 'Fill in Tue Sep 22 · 7 pouches · streak kept', outcome: 'refused', reason: "the app wouldn't save it", extra: 'x' };
+    app().api.appendChatTurn(null, { user: "Didn't save: …", assistant: 'That one did not save.', outcomes: [refused] });
+    expect(chats()[0].messages[0].outcomes).toEqual([{ name: 'fill_missed_day', summary: refused.summary, outcome: 'refused', reason: refused.reason }]);
+  });
+
+  it.each([
+    ['actions not a list', { actions: { name: 'x', summary: 'y' } }],
+    ['an empty list', { actions: [] }],
+    ['six entries', { actions: Array.from({ length: 6 }, () => ACT) }],
+    ['a summary that is not text', { actions: [{ name: 'x', summary: 5 }] }],
+    ['a summary over 200 characters', { actions: [{ name: 'x', summary: 's'.repeat(201) }] }],
+    ['a name over 40 characters', { actions: [{ name: 'n'.repeat(41), summary: 'y' }] }],
+    ['an outcome outside the five', { outcomes: [{ ...OUT, outcome: 'done' }] }],
+    ['a reason that is not text', { outcomes: [{ ...OUT, outcome: 'refused', reason: { why: 1 } }] }],
+  ])('%s → dropped; the words still save, nothing throws', (_, extra) => {
+    expect(app().api.appendChatTurn(null, { user: 'hi', assistant: 'hello', ...extra })).toEqual(expect.any(String));
+    const [u, c] = chats()[0].messages;
+    expect(u).not.toHaveProperty('outcomes');
+    expect(c).not.toHaveProperty('actions');
+  });
+});
+
+describe('logBackfill and the live logs say no when nothing was written', () => {
+  it('a logged day, a day outside the plan, today: null and no event', () => {
+    seed(withEvents([ev('pouch', Y)]));
+    expect(app().api.logBackfill({ day: Y, count: 3, streak: 'keep' })).toBeNull(); // already logged
+    expect(app().api.logBackfill({ day: '2026-08-31', count: 3, streak: 'keep' })).toBeNull(); // before Day 1
+    expect(app().api.logBackfill({ day: '2026-09-24', count: 3, streak: 'keep' })).toBeNull(); // today
+    expect(app().api.logBackfill({ day: '2026-09-22', count: 2.5, streak: 'keep' })).toBeNull();
+    expect(app().api.logBackfill({ day: '2026-09-22', count: 3, streak: 'maybe' })).toBeNull();
+    expect(events()).toHaveLength(1);
+  });
+  it('an unlogged past day: the id of the event that landed', () => {
+    seed(withEvents([]));
+    const id = app().api.logBackfill({ day: '2026-09-22', count: 3, streak: 'keep' });
+    expect(events()).toEqual([expect.objectContaining({ id, type: 'backfill', day: '2026-09-22', count: 3, streak: 'keep' })]);
+  });
+  it('the same day twice in one tick: the second is null', () => {
+    seed(withEvents([]));
+    const { api } = app();
+    expect(api.logBackfill({ day: '2026-09-22', count: 3, streak: 'keep' })).toEqual(expect.any(String));
+    expect(app().api.logBackfill({ day: '2026-09-22', count: 3, streak: 'keep' })).toBeNull();
+    expect(events()).toHaveLength(1);
+  });
 });
 
 describe('read-only and unreadable storage: every new mutation is a no-op returning null', () => {
@@ -237,6 +303,10 @@ describe('read-only and unreadable storage: every new mutation is a no-op return
     expect(app().api.logCorrection({ day: Y, count: 9 })).toBeNull();
     expect(app().api.logReason({ target: p.id, triggers: ['stress'] })).toBeNull();
     expect(app().api.appendChatTurn(null, { user: 'hi', assistant: 'hello' })).toBeNull();
+    expect(app().api.logPouch('stress')).toBeNull();
+    expect(app().api.logResisted(null)).toBeNull();
+    expect(app().api.logCheckin({ sleepQuality: 3 })).toBeNull();
+    expect(app().api.logBackfill({ day: '2026-09-22', count: 3, streak: 'keep' })).toBeNull();
     expect(app().state.events).toHaveLength(1);
     expect(app().state.chats).toEqual([]);
   });
```

- [ ] **Step 2: Failing tests — `src/__tests__/root.test.js`**

```diff
diff --git a/src/__tests__/root.test.js b/src/__tests__/root.test.js
--- a/src/__tests__/root.test.js
+++ b/src/__tests__/root.test.js
@@ -204,6 +204,14 @@ describe('loadRoot on a v2 that parses and passes the outer shape but cannot ren
     'a message text is an object': (a) => { a.chats[0].messages[1].text = { t: 'Steady.' }; },
     'a message ts is a number': (a) => { a.chats[0].messages[0].ts = 1758639600000; },
     'a message is null': (a) => { a.chats[0].messages[0] = null; },
+    // actions/outcomes (2026-10-02): absent is fine; present must be text.
+    'a message actions is an object': (a) => { a.chats[0].messages[1].actions = { name: 'x', summary: 'y' }; },
+    'an action is null': (a) => { a.chats[0].messages[1].actions = [null]; },
+    'an action summary is an object': (a) => { a.chats[0].messages[1].actions = [{ name: 'add_late_pouch', summary: { s: 'x' } }]; },
+    'an action has no name': (a) => { a.chats[0].messages[1].actions = [{ summary: 'Add a pouch' }]; },
+    'an outcome is not one of the five': (a) => { a.chats[0].messages[0].outcomes = [{ name: 'x', summary: 'y', outcome: 'done' }]; },
+    'an outcome reason is an object': (a) => { a.chats[0].messages[0].outcomes = [{ name: 'x', summary: 'y', outcome: 'refused', reason: { r: 1 } }]; },
+    'a message outcomes is a string': (a) => { a.chats[0].messages[0].outcomes = 'saved'; },
   };
 
   for (const [label, wreck] of Object.entries(breakIt)) {
@@ -252,6 +260,18 @@ describe('loadRoot on a v2 that parses and passes the outer shape but cannot ren
     expect(root.attempts[0].chats).toEqual(renderable().chats);
   });
 
+  it('a coach message with actions and a user message with outcomes load as they are', () => {
+    const a = renderable();
+    a.chats[0].messages[1].actions = [{ name: 'add_late_pouch', summary: 'Add a pouch · Wed Sep 23 · 4:30 PM · boredom' }];
+    a.chats[0].messages[0].outcomes = [
+      { name: 'add_late_pouch', summary: 'Add a pouch · Wed Sep 23 · 4:30 PM · boredom', outcome: 'saved' },
+      { name: 'unknown', summary: "An action the app doesn't have", outcome: 'invalid', reason: 'unknown action' },
+    ];
+    const { root, problem } = loadRoot(mem({ [KEY_V2]: JSON.stringify(rootWith(a)) }), NOW);
+    expect(problem).toBeNull();
+    expect(root.attempts[0].chats[0].messages).toEqual(a.chats[0].messages);
+  });
+
   it('a chat with no messages yet is still legitimate', () => {
     const a = renderable();
     a.chats[0].messages = [];
```

- [ ] **Step 3: Failing tests — `src/__tests__/ingest.test.js`**

```diff
diff --git a/src/__tests__/ingest.test.js b/src/__tests__/ingest.test.js
--- a/src/__tests__/ingest.test.js
+++ b/src/__tests__/ingest.test.js
@@ -187,6 +187,49 @@ describe('coach chats', () => {
     expect(line).toBe('- **You:** hide % % this and tag \\#craving');
     expect(md).not.toMatch(/%%/);
   });
+  it('lists what the coach proposed under its message, and how each card ended under the reply to it', () => {
+    const add = 'Add a pouch · Thu Sep 24 · 4:30 PM · boredom';
+    const mark = 'Mark as mistake · the 2:14 PM pouch on Thu Sep 24';
+    const fill = 'Fill in Tue Sep 22 · 7 pouches · streak kept';
+    const root = withChats([chat('c1', '2026-09-25', '15:00', [
+      msg('user', 'had one at 4:30, and the 2:14 was an accident'),
+      { ...msg('assistant', 'Three cards.'), actions: [{ name: 'add_late_pouch', summary: add }, { name: 'mark_mistake', summary: mark }, { name: 'fill_missed_day', summary: fill }] },
+      { ...msg('user', 'Confirmed: …'), outcomes: [
+        { name: 'add_late_pouch', summary: add, outcome: 'saved' },
+        { name: 'mark_mistake', summary: mark, outcome: 'skipped' },
+        { name: 'fill_missed_day', summary: fill, outcome: 'refused', reason: "the app wouldn't save it" },
+        { name: 'unknown', summary: "An action the app doesn't have", outcome: 'invalid', reason: 'unknown action' },
+        { name: 'log_pouch_now', summary: 'Log a pouch now', outcome: 'undone' },
+      ] },
+      { ...msg('assistant', ''), actions: [{ name: 'log_pouch_now', summary: 'Log a pouch now' }] },
+    ])]);
+    const md = renderCoachChats(root, { exportedAt, now: new Date() });
+    expect(md).toContain([
+      '- **Coach:** Three cards.',
+      `  - ↳ proposed: ${add}`,
+      `  - ↳ proposed: ${mark}`,
+      `  - ↳ proposed: ${fill}`,
+      '- **You:** Confirmed: …',
+      `  - ✓ saved: ${add}`,
+      `  - – skipped: ${mark}`,
+      `  - ✗ refused: ${fill} (the app wouldn't save it)`,
+      "  - ✗ invalid: An action the app doesn't have (unknown action)",
+      '  - ↺ undone: Log a pouch now',
+      '- **Coach:** —',
+      '  - ↳ proposed: Log a pouch now',
+    ].join('\n'));
+  });
+  it('escapes action and outcome lines like every other line', () => {
+    const root = withChats([chat('c1', '2026-09-25', '15:00', [
+      msg('user', 'hi'),
+      { ...msg('assistant', 'ok'), actions: [{ name: 'x', summary: nasty }] },
+      { ...msg('user', 'next'), outcomes: [{ name: 'x', summary: 'tag #craving', outcome: 'refused', reason: '[[Secret]] %% hide' }] },
+    ])]);
+    const md = renderCoachChats(root, { exportedAt, now: new Date() });
+    expect(md).toContain("  - ↳ proposed: See ((Secret Note)) and 'code' / pipe (script)alert(1)(/script)");
+    expect(md).toContain('  - ✗ refused: tag \\#craving (((Secret)) % % hide)');
+    expect(md).not.toMatch(/\[\[Secret/);
+  });
   it('caps a long message at 2000 characters', () => {
     const md = renderCoachChats(withChats([chat('c1', '2026-09-25', '15:00', [msg('user', 'x'.repeat(3000))])]), { exportedAt, now: new Date() });
     const line = md.split('\n').find((l) => l.startsWith('- **You:**'));
```

- [ ] **Step 4: Run — expect red**

Run: `npx vitest run src/__tests__/corrections.test.js src/__tests__/root.test.js src/__tests__/ingest.test.js`
Expected: FAIL — `appendChatTurn` drops `actions`/`outcomes` (`expected undefined to deeply equal [ { name: 'add_late_pouch', … } ]`); `logBackfill` on a logged day returns an id (`expected '…' to be null`); `logPouch`/`logResisted`/`logCheckin` in the viewer return ids; the root break cases load as `problem: null` instead of `'corrupt'`; the ingest has no `↳ proposed:` lines.

- [ ] **Step 5: `src/root.js`**

```diff
diff --git a/src/root.js b/src/root.js
--- a/src/root.js
+++ b/src/root.js
@@ -79,9 +79,19 @@ function wellFormedEvent(e) {
   return true;
 }
 
+// What a coach message may carry besides its words (2026-10-02): `actions`,
+// the cards a coach message proposed, and `outcomes`, how each one ended, on the
+// user turn that answered them. Every field is text the ingest prints. Absent is
+// fine (every chat before this build); present must be a list of these.
+export const CHAT_OUTCOMES = ['saved', 'refused', 'skipped', 'invalid', 'undone'];
+export const wellFormedChatAction = (x) => isObj(x) && isStr(x.name) && isStr(x.summary);
+export const wellFormedChatOutcome = (x) => wellFormedChatAction(x) && CHAT_OUTCOMES.includes(x.outcome) && (x.reason === undefined || isStr(x.reason));
+const listOf = (list, ok) => list === undefined || (Array.isArray(list) && list.every(ok));
+
 // A coach chat, as the ingest renders it into the vault: every field is text.
 // Exported so the ingest can skip a bad chat instead of throwing on it.
-const wellFormedMessage = (m) => isObj(m) && (m.role === 'user' || m.role === 'assistant') && isStr(m.text) && isStr(m.ts);
+const wellFormedMessage = (m) => isObj(m) && (m.role === 'user' || m.role === 'assistant') && isStr(m.text) && isStr(m.ts)
+  && listOf(m.actions, wellFormedChatAction) && listOf(m.outcomes, wellFormedChatOutcome);
 export const wellFormedChat = (c) => isObj(c) && isStr(c.id) && isStr(c.startedAt) && isStr(c.day)
   && Array.isArray(c.messages) && c.messages.every(wellFormedMessage);
 
```

- [ ] **Step 6: `src/state.jsx`**

```diff
diff --git a/src/state.jsx b/src/state.jsx
--- a/src/state.jsx
+++ b/src/state.jsx
@@ -1,5 +1,5 @@
 import { createContext, useContext, useEffect, useMemo, useState } from 'react';
-import { loadRoot, saveRoot, attemptById, updateAttempt, startAttempt, archiveActive } from './root.js';
+import { loadRoot, saveRoot, attemptById, updateAttempt, startAttempt, archiveActive, wellFormedChatAction, wellFormedChatOutcome } from './root.js';
 import { makeEvent, makeId, pouchCtxForNow, todayKey, isLogged, dayNumberFor, timedPouchesForDay, isVoided } from './store.js';
 import { dayKeyOf } from './time.js';
 import { TRIGGERS } from './triggers.js';
@@ -12,6 +12,11 @@ const Ctx = createContext(null);
 
 const NOTE_MAX = 140;
 const CHAT_TEXT_MAX = 4000;
+// A coach turn's record of its cards: at most one entry per card (5), each
+// field short. The app writes summaries and reasons itself, well inside these.
+const CHAT_ENTRIES_MAX = 5;
+const CHAT_NAME_MAX = 40;
+const CHAT_LINE_MAX = 200;
 
 // A correction raises a logged past day's total. Never today (still being
 // logged), never an unlogged day (silence stays silence), never below the
@@ -49,6 +54,26 @@ function latePouchOk(a, { day, time, triggers, note }) {
   return r.ok && !r.future && reasonBody({ triggers, note }) !== null;
 }
 
+// A backfill is allowed only on an unlogged past day inside the plan. Checked
+// before the write so the api can say no (null) instead of handing back the id
+// of an event the updater then quietly dropped — a coach card has to know.
+function backfillOk(a, { day, count, streak }) {
+  if (typeof day !== 'string' || !DAY_RE.test(day) || day >= todayKey()) return false;
+  if (!Number.isInteger(count) || count < 0 || (streak !== 'keep' && streak !== 'break')) return false;
+  const n = dayNumberFor(a, day);
+  return n >= 1 && n <= a.plan.totalDays && !isLogged(a, day);
+}
+
+const bounded = (x) => x.name.length <= CHAT_NAME_MAX && x.summary.length <= CHAT_LINE_MAX && (x.reason === undefined || x.reason.length <= CHAT_LINE_MAX);
+// A coach message's actions or outcomes, as stored: 1–5 well-formed, bounded
+// entries holding only their own fields — or null, and the words save without
+// them. A bad list is dropped, never a throw: the reply already happened.
+function chatEntries(list, ok, pick) {
+  return Array.isArray(list) && list.length >= 1 && list.length <= CHAT_ENTRIES_MAX && list.every((x) => ok(x) && bounded(x)) ? list.map(pick) : null;
+}
+const pickAction = ({ name, summary }) => ({ name, summary });
+const pickOutcome = ({ name, summary, outcome, reason }) => ({ name, summary, outcome, ...(reason !== undefined ? { reason } : {}) });
+
 // The pouch a void would name: a pouch of this attempt not already voided.
 const voidable = (a, id) => a.events.some((e) => e.id === id && e.type === 'pouch') && !isVoided(a, { id, type: 'pouch' });
 
@@ -116,18 +141,27 @@ export function AppStateProvider({ children }) {
       return a && !readOnly && a.id === cur.root.activeAttemptId ? a : null;
     };
     return {
+      // → the new event's id, or null when nothing may change (a past attempt
+      // on screen, unreadable storage). Same for logResisted and logCheckin.
       logPouch(trigger = null) {
+        if (!editable()) return null;
         const ev = makeEvent('pouch', trigger);
         // ctx snapshots slot/cap/nth at log time, computed against the
         // pre-append attempt; verdicts derive at read time.
         onActive((a) => ({ ...a, events: [...a.events, { ...ev, ctx: pouchCtxForNow(a) }] }));
         return ev.id;
       },
-      logResisted(trigger = null) { const ev = makeEvent('resisted', trigger); append(ev); return ev.id; },
+      logResisted(trigger = null) {
+        if (!editable()) return null;
+        const ev = makeEvent('resisted', trigger);
+        append(ev);
+        return ev.id;
+      },
       // Always 'manual': the app is the only way to write a check-in now that the
       // URL entry point is gone. Check-ins stored as 'shortcut' still read and
       // score exactly as they did — history is append-only.
       logCheckin({ sleepQuality, sleepScore, sleepHours, workout } = {}) {
+        if (!editable()) return null;
         const ev = { ...makeEvent('checkin'), source: 'manual' };
         if (sleepQuality != null) ev.sleepQuality = sleepQuality;
         if (sleepScore != null) ev.sleepScore = sleepScore;
@@ -137,21 +171,15 @@ export function AppStateProvider({ children }) {
         return ev.id;
       },
       // Fills in a past day that has no log. `day` is the day being filled, not
-      // today. One backfill per day; bad input is a no-op (returns null).
+      // today. One backfill per day, on an in-plan day only. → the event id, or
+      // null when the day can't take one (logged already, outside the plan,
+      // today or later) or the input won't do — nothing is written then.
       logBackfill({ day, count, streak } = {}) {
-        const valid = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day < todayKey()
-          && Number.isInteger(count) && count >= 0
-          && (streak === 'keep' || streak === 'break');
-        if (!valid) return null;
+        const a = editable();
+        const input = { day, count, streak };
+        if (!a || !backfillOk(a, input)) return null;
         const ev = { ...makeEvent('backfill'), day, count, streak };
-        // Only an unlogged, in-plan day may be filled — a day already logged (pouch/
-        // resisted/backfill), before the plan starts, or after its last day is a
-        // no-op here too, even though the UI only offers eligible days; the id is
-        // still returned (see comment above).
-        onActive((a) => {
-          const n = dayNumberFor(a, day);
-          return isLogged(a, day) || n < 1 || n > a.plan.totalDays ? a : { ...a, events: [...a.events, ev] };
-        });
+        onActive((cur) => (backfillOk(cur, input) ? { ...cur, events: [...cur.events, ev] } : cur));
         return ev.id;
       },
       // The real total for a logged past day, entered later. Appends; the latest
@@ -208,16 +236,22 @@ export function AppStateProvider({ children }) {
       },
       // One coach exchange, saved on the active attempt (not an event: nothing
       // scores it). Appends to chat `chatId`, or starts a chat when that id isn't
-      // there. → the chat id, or null (bad turn, read-only, unreadable storage).
-      appendChatTurn(chatId, { user, assistant } = {}) {
+      // there. `actions` (what the coach's reply proposed) rides on the coach
+      // message; `outcomes` (how the cards it answers ended) on the user message.
+      // A coach reply may be only cards, so its words may be blank when it
+      // proposed something. → the chat id, or null (bad turn, read-only,
+      // unreadable storage).
+      appendChatTurn(chatId, { user, assistant, actions, outcomes } = {}) {
         const a = editable();
         if (!a || typeof user !== 'string' || typeof assistant !== 'string') return null;
-        if (user.trim() === '' || assistant.trim() === '') return null; // a blank turn is nothing to keep
+        const acts = chatEntries(actions, wellFormedChatAction, pickAction);
+        const outs = chatEntries(outcomes, wellFormedChatOutcome, pickOutcome);
+        if (user.trim() === '' || (assistant.trim() === '' && !acts)) return null; // a blank turn is nothing to keep
         const now = new Date();
         const ts = now.toISOString();
         const messages = [
-          { role: 'user', text: user.trim().slice(0, CHAT_TEXT_MAX), ts },
-          { role: 'assistant', text: assistant.trim().slice(0, CHAT_TEXT_MAX), ts },
+          { role: 'user', text: user.trim().slice(0, CHAT_TEXT_MAX), ts, ...(outs ? { outcomes: outs } : {}) },
+          { role: 'assistant', text: assistant.trim().slice(0, CHAT_TEXT_MAX), ts, ...(acts ? { actions: acts } : {}) },
         ];
         const has = (x) => (x.chats ?? []).some((c) => c.id === chatId);
         const id = chatId != null && has(a) ? chatId : makeId(now);
```

`backfillOk` mirrors the updater's own check (unlogged, Day 1…totalDays, before today) and runs twice like `correctionOk`: once against the last render to decide the return value, once inside the updater as the real guard. `BackfillForm` ignores the return value, so nothing on screen changes.

- [ ] **Step 7: `src/ingest.js`**

```diff
diff --git a/src/ingest.js b/src/ingest.js
--- a/src/ingest.js
+++ b/src/ingest.js
@@ -260,6 +260,9 @@ export function renderLiveLog(root, { exportedAt, now = new Date() }) {
 const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
 const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
 const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
+const SUMMARY_MAX = 200; // a card's headline; the app writes them well inside this
+// How each card ended, as one glyph a reader can scan down the note.
+const OUTCOME_MARK = { saved: '✓', undone: '↺', refused: '✗', invalid: '✗', skipped: '–' };
 const readableChat = (c) => wellFormedChat(c) && c.messages.length > 0;
 const startedMs = (c) => { const t = Date.parse(c.startedAt); return Number.isNaN(t) ? -Infinity : t; };
 
@@ -330,7 +333,17 @@ export function renderCoachChats(root, { exportedAt, now = new Date() }) {
         lines.push(`## Attempt ${safeText(attempt.id)} — ${attempt.status === 'archived' ? 'archived' : 'active'}`, '');
       }
       lines.push(`### ${chatHeading(attempt, chat)}`, '');
-      for (const m of chat.messages) lines.push(`- **${m.role === 'user' ? 'You' : 'Coach'}:** ${safeText(m.text, CHAT_TEXT_MAX)}`);
+      for (const m of chat.messages) {
+        // A coach reply can be only cards, so its words may be blank.
+        lines.push(`- **${m.role === 'user' ? 'You' : 'Coach'}:** ${safeText(m.text, CHAT_TEXT_MAX) || '—'}`);
+        // What the coach proposed, then — on the turn that answered it — what
+        // came of each card. Summaries are the app's words, but they came out
+        // of a backup like everything else here, so they go through safeText.
+        for (const a of m.actions ?? []) lines.push(`  - ↳ proposed: ${safeText(a.summary, SUMMARY_MAX)}`);
+        for (const o of m.outcomes ?? []) {
+          lines.push(`  - ${OUTCOME_MARK[o.outcome]} ${o.outcome}: ${safeText(o.summary, SUMMARY_MAX)}${o.reason ? ` (${safeText(o.reason, SUMMARY_MAX)})` : ''}`);
+        }
+      }
       lines.push('');
     }
   });
```

- [ ] **Step 8: Run — green; whole suite; lint**

Run: `npx vitest run src/__tests__/corrections.test.js src/__tests__/root.test.js src/__tests__/ingest.test.js src/__tests__/state-guards.test.js` → PASS. Then `npm test` and `npm run lint` (the one known warning).

- [ ] **Step 9: Commit**

```bash
git add src/root.js src/state.jsx src/ingest.js src/__tests__/corrections.test.js src/__tests__/root.test.js src/__tests__/ingest.test.js
git commit -m "Saved chats record what the coach proposed and how each card ended; the api says no when it wrote nothing

appendChatTurn stores actions on the coach message and outcomes on the user
message, bounded, dropped (never thrown) when malformed. logBackfill now checks
before it writes, and the live logs return null in the viewer, so a confirmed
card can never claim a save that didn't happen. The vault's Coach Chats shows
each proposal and outcome, escaped."
```

---

### Task 6: `src/components/ActionCard.jsx` — the receipt (Lane D, after 2)

Design brief: Modern Dark Cinema unchanged — a frosted `.card` inside the chat stream under the coach's bubble; lucide icon per verb in `--accent-bright` (faint when muted); headline 15px/600 from `action.summary`; a faint second line from `action.facts`; Confirm (`btn-accent`) and Skip (`btn-ghost`) at 44px; Saved in `--green` with an Undo chip (44px); refused in `--amber`, never red; skipped/undone struck and muted; invalid muted with the app's own sentence and the reason, no buttons. Height grows on the same spring as Fix this day's `ReasonEditor` (`damping 26, stiffness 240`); state changes crossfade in `AnimatePresence mode="wait"`; `?static` and `MotionConfig reducedMotion="user"` already govern every `motion.*`. Pure props — the sheet owns every state change.

**Files:**
- Create: `src/components/ActionCard.jsx`
- Modify: `src/__tests__/renderGuards.test.js`

- [ ] **Step 1: Failing tests — `src/__tests__/renderGuards.test.js`**

Add the import after the `PlanView` import:

```js
const { default: ActionCard } = await import('../components/ActionCard.jsx');
```

Append at the end of the file:

```js
// ── the coach's cards, and thumb-sized chips (2026-10-02) ───────────────────

describe('ActionCard draws each state from the validated action, never the model\'s words', () => {
  const action = { toolUseId: 'toolu_1', name: 'add_late_pouch', verb: 'logLatePouch', args: [], summary: 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom', facts: 'Thu Oct 1 · 4:30 PM · boredom · added later' };
  const card = (status, extra = {}) => ({ toolUseId: 'toolu_1', name: 'add_late_pouch', status, action, ...extra });
  const draw = (props) => renderToStaticMarkup(createElement(ActionCard, { onConfirm() {}, onSkip() {}, onUndo() {}, ...props }));
  const buttons = (out) => out.match(/<button[^>]*>/g) ?? [];

  it('pending: headline, facts, Skip and Confirm, both 44px', () => {
    const out = draw({ card: card('pending') });
    expect(out).toContain('Add a pouch · Thu Oct 1 · 4:30 PM · boredom');
    expect(out).toContain('Thu Oct 1 · 4:30 PM · boredom · added later');
    expect(out).toContain('aria-label="Confirm: Add a pouch · Thu Oct 1 · 4:30 PM · boredom"');
    expect(out).toContain('aria-label="Skip: Add a pouch · Thu Oct 1 · 4:30 PM · boredom"');
    expect(buttons(out)).toHaveLength(2);
    for (const b of buttons(out)) expect(b).toContain('min-height:44px');
  });
  it('pending while busy: both buttons disabled', () => {
    for (const b of buttons(draw({ card: card('pending'), busy: true }))) expect(b).toContain('disabled');
  });
  it('saved: "Saved", an Undo chip only while undoable, never a second Confirm', () => {
    const live = draw({ card: card('saved', { eventId: 'e1' }), undoable: true });
    expect(live).toContain('Saved');
    expect(live).toContain('aria-label="Undo: Add a pouch · Thu Oct 1 · 4:30 PM · boredom"');
    expect(live).not.toContain('Confirm');
    expect(buttons(live)[0]).toContain('min-height:44px');
    expect(buttons(draw({ card: card('saved', { eventId: 'e1' }), undoable: false }))).toHaveLength(0);
  });
  it('refused: amber "Didn’t save — reason", no buttons', () => {
    const out = draw({ card: card('refused', { reason: "the app wouldn't save it" }) });
    expect(out).toContain('Didn’t save — the app wouldn&#x27;t save it');
    expect(out).toContain('var(--amber)');
    expect(buttons(out)).toHaveLength(0);
  });
  it('skipped and undone: the headline struck, no buttons', () => {
    for (const [status, word] of [['skipped', 'Skipped'], ['undone', 'Undone']]) {
      const out = draw({ card: card(status) });
      expect(out).toContain(word);
      expect(out).toContain('line-through');
      expect(buttons(out)).toHaveLength(0);
    }
  });
  it('invalid: the app\'s sentence and the reason, no buttons, no model text', () => {
    const out = draw({ card: { toolUseId: 'toolu_9', name: 'drop_everything', status: 'invalid', reason: 'unknown action' } });
    expect(out).toContain('The coach proposed something the app can&#x27;t do');
    expect(out).toContain('unknown action');
    expect(out).not.toContain('drop_everything');
    expect(buttons(out)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — expect red**

Run: `npx vitest run src/__tests__/renderGuards.test.js`
Expected: FAIL — `Error: Cannot find module '../components/ActionCard.jsx' imported from …/src/__tests__/renderGuards.test.js`.

- [ ] **Step 3: Write `src/components/ActionCard.jsx`**

```jsx
import { AnimatePresence, motion } from 'framer-motion';
import { Ban, CalendarPlus, Check, CircleAlert, Clock, PencilLine, Plus, ShieldCheck, Sunrise, Tag, TriangleAlert, Undo2 } from 'lucide-react';

const spring = { type: 'spring', damping: 26, stiffness: 240 };
// Grows from nothing on the same spring as Fix this day's editors.
const grow = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: spring,
  style: { overflow: 'hidden' },
};

const ICON = {
  log_pouch_now: Plus,
  log_resisted_now: ShieldCheck,
  add_late_pouch: Clock,
  mark_mistake: Ban,
  add_reason: Tag,
  fill_missed_day: CalendarPlus,
  correct_day_total: PencilLine,
  log_checkin: Sunrise,
};

const TAP = { minHeight: 44 };

// One thing the coach proposed, as a receipt: the headline and the facts the
// app would write — both built by coachActions.js from the validated values,
// never the model's own words — and the user's two choices. A card is never a
// form: a wrong one is skipped and corrected in chat. Pure props, so the sheet
// owns every state change and the render guards can draw each state.
//
// card.status: 'pending' | 'saved' | 'refused' | 'skipped' | 'invalid' | 'undone'
export default function ActionCard({ card, busy = false, undoable = false, onConfirm, onSkip, onUndo }) {
  const invalid = card.status === 'invalid';
  const Icon = invalid ? CircleAlert : ICON[card.name] ?? CircleAlert;
  const headline = invalid ? "The coach proposed something the app can't do" : card.action.summary;
  const struck = card.status === 'skipped' || card.status === 'undone';
  const muted = struck || invalid;

  return (
    <motion.div
      {...grow}
      role="group"
      aria-label={invalid ? 'Proposed action the app can’t do' : `Proposed: ${headline}`}
      className="card"
      style={{ ...grow.style, padding: '12px 14px', marginTop: 8, opacity: muted ? 0.72 : 1 }}
    >
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <Icon size={18} color={muted ? 'var(--fg-faint)' : 'var(--accent-bright)'} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: muted ? 'var(--fg-muted)' : 'var(--fg)', textDecoration: struck ? 'line-through' : 'none' }}>
            {headline}
          </div>
          <div className="small faint" style={{ marginTop: 2 }}>{invalid ? card.reason : card.action.facts}</div>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={card.status} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring}>
          {card.status === 'pending' && (
            <div className="row" style={{ gap: 10, marginTop: 12 }}>
              <motion.button type="button" className="btn btn-ghost" aria-label={`Skip: ${headline}`} disabled={busy} whileTap={busy ? undefined : { scale: 0.98 }} onClick={onSkip} style={{ ...TAP, flex: 1 }}>
                Skip
              </motion.button>
              <motion.button type="button" className="btn btn-accent" aria-label={`Confirm: ${headline}`} disabled={busy} whileTap={busy ? undefined : { scale: 0.98 }} onClick={onConfirm} style={{ ...TAP, flex: 1 }}>
                Confirm
              </motion.button>
            </div>
          )}
          {card.status === 'saved' && (
            <div className="spread" style={{ marginTop: 10, minHeight: 44 }}>
              <span role="status" className="row" style={{ gap: 6, color: 'var(--green)', fontWeight: 600 }}>
                <Check size={16} aria-hidden="true" /> Saved
              </span>
              {undoable && (
                <motion.button type="button" className="chip" aria-label={`Undo: ${headline}`} whileTap={{ scale: 0.94 }} onClick={onUndo} style={{ ...TAP, flex: '0 0 auto', padding: '6px 14px', fontSize: 13 }}>
                  <Undo2 size={14} aria-hidden="true" /> Undo
                </motion.button>
              )}
            </div>
          )}
          {card.status === 'refused' && (
            <p role="status" className="small row" style={{ gap: 6, margin: '10px 0 0', color: 'var(--amber)' }}>
              <TriangleAlert size={15} aria-hidden="true" style={{ flexShrink: 0 }} /> Didn’t save — {card.reason}
            </p>
          )}
          {card.status === 'skipped' && <p role="status" className="small faint" style={{ margin: '8px 0 0' }}>Skipped</p>}
          {card.status === 'undone' && <p role="status" className="small faint" style={{ margin: '8px 0 0' }}>Undone</p>}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
```

- [ ] **Step 4: Run — expect green; lint**

Run: `npx vitest run src/__tests__/renderGuards.test.js` → PASS (4 existing + 6 new). `npm run lint` → the one known warning.

- [ ] **Step 5: Commit**

```bash
git add src/components/ActionCard.jsx src/__tests__/renderGuards.test.js
git commit -m "ActionCard: a proposal as a receipt — Confirm or Skip, then Saved, refused, skipped, undone or can't-do

Headline and facts come from the validated action, never the model's words; an
invalid card says so in the app's own sentence and offers nothing. 44px
targets, Fix this day's spring, pure props."
```

---

### Task 7: `src/components/CoachSheet.jsx` — the flow (after 3, 5, 6)

What the sheet does, in order of the spec:
- **Send:** optimistic user bubble → `askCoach(state, toTurns(next), getKey(), Date.now())` → coach bubble + cards (`takeProposals`) → `appendChatTurn({ user, assistant, actions })`.
- **Resolve:** Confirm → `applyAction` → `saved` (+ `eventId`) or `refused`; Skip → `skipped`; Confirm all → a queue walked one card per render (each api call sees the log the previous one wrote), stopping at the first refusal (the rest stay pending).
- **Follow-up:** when no card of the newest coach message is pending, an effect sends a user turn whose content is only the `tool_result` blocks (`auto: true`, not drawn) → coach bubble (+ cards). At most 3 automatic rounds in a row (`MAX_CHAIN`); after that, results wait and lead James's next typed turn. Saved as `{ user: renderOutcomes(outcomes), assistant, outcomes, actions }`.
- **Typing while cards are pending** marks them `skipped`; their results (and any held ones) lead the typed turn, then the text; the turn is saved with those `outcomes`.
- **Errors:** a failed typed turn rolls back (the skips with it) and puts the words back in the field; a failed follow-up removes its `auto` turn and marks the coach message `held` (no automatic retry) — card states stay, the events are saved, and the results lead the next typed turn. A refused save is a card state, never an error banner.
- **Undo:** shown while the card's event is the newest and inside 12 s; `api.undoEvent` → `undone`. An undo after the follow-up already went out shows on the card; the coach learns it from the fresh log and pouch list in the next request; the saved chat keeps the outcome as it was sent (append-only).
- **Header:** "knows your plan & your log · proposes, you confirm". **Quick chips** gain "I forgot to log one" and "That last tap was a mistake".
- **Read-only:** `App.jsx` never mounts the sheet in the viewer; the sheet still never makes or draws a card when `readOnly` (belt to that brace).

**Files:**
- Modify (rewrite): `src/components/CoachSheet.jsx`

There is no unit harness for the sheet (it is a stateful React tree with async effects); its tests are the walk in Task 9, which drives every branch above in a real browser.

- [ ] **Step 1: Write the whole file**

```jsx
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, SendHorizontal, CheckCheck } from 'lucide-react';
import { useApp } from '../state.jsx';
import { askCoach } from '../coach.js';
import { takeProposals, applyAction, resultsFor, toTurns, actionsOf, outcomesOf, renderOutcomes } from '../coachActions.js';
import { UNDO_WINDOW_MS, isJustLogged } from '../justLogged.js';
import { getKey, subscribe } from '../sessionKey.js';
import { hasProxy, getDeviceToken, subscribe as subscribeToken } from '../proxyConfig.js';
import ActionCard from './ActionCard.jsx';

const QUICK = ['I want one right now', 'How am I doing?', 'Remind me why', 'I forgot to log one', 'That last tap was a mistake'];
// Automatic follow-ups in a row before the coach waits for the user to type:
// a coach that keeps proposing can't keep itself talking.
const MAX_CHAIN = 3;
// Undo is shown for 12 s, like the log toast and Fix this day; the api honours
// it 3 s longer so a tap landing as the chip leaves still counts.
const UNDO_SHOWN_MS = UNDO_WINDOW_MS - 3000;

// Each of these names the one thing that fixes it: retyping a key does nothing
// when it's the device token the proxy turned down.
function errorCopy(e) {
  if (e.message === 'bad-key') return 'That API key was rejected — double-check it in Settings.';
  if (e.message === 'no-key') return 'Add your API key in Settings first.';
  if (e.message === 'no-device-token') return 'Paste your device token in Settings to turn the coach on.';
  if (e.message === 'bad-device-token') return 'That device token was turned down — paste a fresh one in Settings.';
  return `Couldn't reach the coach: ${e.message}`;
}

// The newest coach message: the only one whose cards can still be pending.
const latestCoach = (messages) => messages.findLastIndex((m) => m.role === 'assistant');
// A coach message whose cards have outcomes the coach hasn't been told yet.
const owes = (m) => !!m && (m.cards?.length ?? 0) > 0 && !m.answered;
// One card changed, wherever it sits: a saved card can still be undone after
// the coach has replied to it.
const withCard = (messages, toolUseId, patch) => messages.map((m) => (m.cards?.some((c) => c.toolUseId === toolUseId)
  ? { ...m, cards: m.cards.map((c) => (c.toolUseId === toolUseId ? { ...c, ...patch } : c)) }
  : m));

// The coach's reply as a message: its words, and its proposals validated into
// cards. A past attempt is never sent tools, so it never gets a card.
function coachMessage(state, readOnly, reply) {
  if (readOnly) return { role: 'assistant', text: reply.text, proposals: [], cards: [], overflow: [] };
  return { role: 'assistant', text: reply.text, proposals: reply.proposals, ...takeProposals(state, reply.proposals, Date.now()) };
}

// Saved only once the coach answered: a failed request leaves no trace. A
// storage failure here must not undo a reply that did arrive: keep it on
// screen and carry on — the next turn simply tries to save again.
function saveTurn(api, chatIdRef, turn) {
  try {
    chatIdRef.current = api.appendChatTurn(chatIdRef.current, turn) ?? chatIdRef.current;
  } catch {
    // nothing: the reply stays, no error is shown
  }
}

// Messages on screen are { role, text, … }: a coach message carries the raw
// `proposals` (replayed to the API), their `cards`, any `overflow` ids, and
// `answered` once its results went out (`held` when a follow-up failed — the
// results then lead the next typed turn). A user message that answered cards
// carries `results` and `outcomes`; `auto` marks the app's own follow-up,
// which the API sees and the screen doesn't draw. toTurns() builds the API
// conversation from this one list.
export default function CoachSheet({ onClose, openSettings }) {
  const { state, api, readOnly } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chain, setChain] = useState(0); // automatic follow-ups since the user last typed
  const [queue, setQueue] = useState([]); // Confirm all: card ids still to confirm, in order
  const scrollRef = useRef(null);
  // One saved chat per opening of the sheet: null until the first reply lands,
  // then the id appendChatTurn handed back, so later turns join the same chat.
  const chatIdRef = useRef(null);
  // The key is held for the session, so the sheet follows it: add one in
  // Settings and the coach opens here without a reload.
  const [apiKey, setApiKey] = useState(getKey);
  useEffect(() => subscribe(setApiKey), []);
  // The other way in: a proxy holding the key, unlocked by a token that stays on
  // this device. Either one is enough to open the chat, and both are watched so
  // filling one in Settings opens the coach here without a reload.
  const [deviceToken, setDeviceToken] = useState(getDeviceToken);
  useEffect(() => subscribeToken(setDeviceToken), []);
  const proxyOn = hasProxy();
  const viaProxy = proxyOn && Boolean(deviceToken.trim());
  const canRun = viaProxy || Boolean(apiKey.trim());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
  }, [messages, busy]);

  // The user's tap: the same api method the sheets call, through the one
  // place a verb is ever called (coachActions.js applyAction).
  const confirm = (toolUseId) => {
    const card = messages[latestCoach(messages)]?.cards?.find((c) => c.toolUseId === toolUseId);
    if (!card || card.status !== 'pending') return;
    const r = applyAction(api, card.action);
    setMessages((cur) => withCard(cur, toolUseId, r.outcome === 'saved' ? { status: 'saved', eventId: r.eventId } : { status: 'refused', reason: r.reason }));
  };

  // Confirm all walks the queue one card per render, so each api call is
  // checked against the log the one before it wrote. The first refusal stops
  // it; the cards after it stay pending.
  useEffect(() => {
    if (!queue.length) return;
    const [next, ...rest] = queue;
    const card = messages[latestCoach(messages)]?.cards?.find((c) => c.toolUseId === next);
    if (!card || card.status !== 'pending') {
      setQueue([]);
      return;
    }
    const r = applyAction(api, card.action);
    setMessages((cur) => withCard(cur, next, r.outcome === 'saved' ? { status: 'saved', eventId: r.eventId } : { status: 'refused', reason: r.reason }));
    setQueue(r.outcome === 'saved' ? rest : []);
  }, [queue, messages, api]);

  // Undo is the api's own: only the newest event, only inside its window.
  const undoable = (card) => {
    const last = state.events[state.events.length - 1];
    return card.status === 'saved' && last?.id === card.eventId && isJustLogged(last, UNDO_SHOWN_MS);
  };
  const undo = (card) => {
    if (!undoable(card)) return;
    api.undoEvent(card.eventId);
    setMessages((cur) => withCard(cur, card.toolUseId, { status: 'undone' }));
  };

  // Once every card of the newest coach message is resolved, the coach hears
  // how they went — one call for the whole batch — so it can say "4:30 is in",
  // or say honestly that one didn't save. Runs after the render that resolved
  // the last card, so `state` already holds what was written. At most
  // MAX_CHAIN in a row; after that the results wait for the user's next words.
  useEffect(() => {
    if (busy || queue.length || chain >= MAX_CHAIN) return;
    const i = latestCoach(messages);
    const m = messages[i];
    if (!owes(m) || m.held || m.cards.some((c) => c.status === 'pending')) return;
    const outcomes = outcomesOf(m.cards);
    const auto = { role: 'user', text: renderOutcomes(outcomes), results: resultsFor(m), outcomes, auto: true };
    const next = [...messages.map((x, k) => (k === i ? { ...x, answered: true } : x)), auto];
    setMessages(next);
    setChain((c) => c + 1);
    setBusy(true);
    setError(null);
    askCoach(state, toTurns(next), getKey(), Date.now())
      .then((reply) => {
        const coach = coachMessage(state, readOnly, reply);
        setMessages((cur) => [...cur, coach]);
        saveTurn(api, chatIdRef, { user: auto.text, assistant: coach.text, outcomes, actions: actionsOf(coach.cards) });
      }, (e) => {
        setError(errorCopy(e));
        // The follow-up rolls back; the cards keep their states (the events
        // are saved), and their results lead the next thing the user types.
        setMessages((cur) => cur.filter((x) => x !== auto).map((x, k) => (k === i ? { ...x, answered: false, held: true } : x)));
      })
      .finally(() => setBusy(false));
  }, [messages, busy, queue, chain, state, api, readOnly]);

  const send = async (text) => {
    const words = text.trim();
    if (!words || busy) return;
    setError(null);
    // Typing past pending cards skips them; whatever the coach hasn't been told
    // about the newest cards leads this turn, before the words.
    const i = latestCoach(messages);
    const m = messages[i];
    let base = messages;
    let answer = {};
    if (owes(m)) {
      const resolved = { ...m, cards: m.cards.map((c) => (c.status === 'pending' ? { ...c, status: 'skipped' } : c)), answered: true };
      base = messages.map((x, k) => (k === i ? resolved : x));
      answer = { results: resultsFor(resolved), outcomes: outcomesOf(resolved.cards) };
    }
    const next = [...base, { role: 'user', text: words, ...answer }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setChain(0);
    setQueue([]);
    try {
      const coach = coachMessage(state, readOnly, await askCoach(state, toTurns(next), getKey(), Date.now()));
      setMessages((cur) => [...cur, coach]);
      saveTurn(api, chatIdRef, { user: words, assistant: coach.text, actions: actionsOf(coach.cards), outcomes: answer.outcomes });
    } catch (e) {
      setError(errorCopy(e));
      setMessages(messages); // roll back the optimistic user message, and the skips with it
      setInput(text);
    } finally {
      setBusy(false);
    }
  };

  const newest = latestCoach(messages);
  const pendingCount = messages[newest]?.cards?.filter((c) => c.status === 'pending').length ?? 0;

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        aria-label="AI coach"
        style={{ display: 'flex', flexDirection: 'column', height: '78dvh' }}
      >
        <div className="sheet-handle" />
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Sparkles size={18} color="var(--accent-bright)" />
          <h3 style={{ fontSize: 16 }}>Coach</h3>
          <span className="small faint">knows your plan & your log · proposes, you confirm</span>
        </div>

        {!canRun ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <Sparkles size={22} color="var(--accent-bright)" />
            <p className="muted small" style={{ margin: '10px 0 16px' }}>
              {proxyOn ? (
                <>
                  The coach runs through your own proxy — paste this device's
                  token in Settings once and it's on. Once per device, not once
                  per session.
                </>
              ) : (
                <>
                  The coach runs on your own Claude API key — it's kept for this
                  session only and costs pennies a day. Add it in Settings; your
                  password manager can fill it in next time.
                </>
              )}
            </p>
            {/* App hands this in already pointed at Settings' Coach connection
                sheet; called bare so the click event never rides along. */}
            <button className="btn btn-accent" onClick={() => openSettings()}>
              Open Settings
            </button>
          </div>
        ) : (
          <>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
              {messages.length === 0 && (
                <p className="small muted" style={{ textAlign: 'center', margin: 'auto 20px' }}>
                  Chats are fresh each time — the coach already knows today's
                  numbers, your stage, and your triggers.
                </p>
              )}
              {messages.map((m, i) => (m.auto ? null : (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: m.role === 'user' ? 'flex-end' : 'stretch', maxWidth: m.role === 'user' ? '85%' : '100%' }}>
                  {(m.role === 'user' || m.text) && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: m.role === 'user' ? '100%' : '85%',
                        padding: '10px 14px',
                        borderRadius: 16,
                        fontSize: 15,
                        userSelect: 'text',
                        WebkitUserSelect: 'text',
                        background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-strong)',
                        border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                        color: m.role === 'user' ? '#fff' : 'var(--fg)',
                      }}
                    >
                      {m.text}
                    </motion.div>
                  )}
                  {!readOnly && m.cards?.length > 0 && (
                    <AnimatePresence initial={false}>
                      {i === newest && pendingCount > 1 && (
                        <motion.div key="all" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 240 }} style={{ overflow: 'hidden' }}>
                          <motion.button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy || queue.length > 0}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setQueue(m.cards.filter((c) => c.status === 'pending').map((c) => c.toolUseId))}
                            style={{ width: '100%', minHeight: 44, marginTop: 8, color: 'var(--accent-bright)' }}
                          >
                            <CheckCheck size={17} aria-hidden="true" /> Confirm all
                          </motion.button>
                        </motion.div>
                      )}
                      {m.cards.map((c) => (
                        <ActionCard
                          key={c.toolUseId}
                          card={c}
                          busy={busy || queue.length > 0}
                          undoable={undoable(c)}
                          onConfirm={() => confirm(c.toolUseId)}
                          onSkip={() => setMessages((cur) => withCard(cur, c.toolUseId, { status: 'skipped' }))}
                          onUndo={() => undo(c)}
                        />
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              )))}
              {busy && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="row small muted"
                  style={{ gap: 6, padding: '4px 8px' }}
                >
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                      style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--fg-muted)' }}
                    />
                  ))}
                </motion.div>
              )}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="small"
                  style={{ color: 'var(--red)', padding: '6px 2px' }}
                  role="alert"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {messages.length === 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {QUICK.map((q) => (
                  <button key={q} className="chip" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            <form
              className="row"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Talk to your coach…"
                aria-label="Message the coach"
                style={{ flex: 1 }}
              />
              <motion.button
                type="submit"
                className="btn btn-accent"
                style={{ minWidth: 52, padding: 0 }}
                whileTap={{ scale: 0.94 }}
                disabled={busy || !input.trim()}
                aria-label="Send"
              >
                <SendHorizontal size={19} />
              </motion.button>
            </form>
          </>
        )}
      </motion.div>
    </>
  );
}
```

- [ ] **Step 2: Verify — suite, lint, build**

Run: `npm test` (all green — nothing imports the sheet), `npm run lint` (exactly the one known warning; an `exhaustive-deps` warning here means an effect lost a dependency — fix the effect, don't silence it), `npm run build && rm -rf dist/`.

- [ ] **Step 3: Commit**

```bash
git add src/components/CoachSheet.jsx
git commit -m "Coach sheet: proposals become cards, a tap confirms, the coach hears how it went

Confirm, Skip, Confirm all (one card per render, stops at a refusal), Undo for
12 s. One follow-up turn per resolved batch, at most three in a row; typing
past a pending card skips it and leads with its result. Header: proposes, you
confirm. Two new quick chips."
```

---

### Task 8: 44px reason chips on the log toast and the SOS overlay (Lane E, after 6)

**Files:**
- Modify: `src/components/LogToast.jsx` (`chipStyle`)
- Modify: `src/components/SOSOverlay.jsx` (trigger chips)
- Modify: `src/__tests__/renderGuards.test.js`

The SOS chips were already 44px through `.chip` in `index.css` (only the toast overrode it to 36); the inline `minHeight: 44` makes the size something the render guard can see and a later style can't quietly shrink. Padding matches `ReasonFields`' chips (`6px 13px`, 13px text).

- [ ] **Step 1: Failing tests — `src/__tests__/renderGuards.test.js`**

Add after the `ActionCard` import:

```js
const { default: LogToast } = await import('../components/LogToast.jsx');
const { default: SOSOverlay } = await import('../components/SOSOverlay.jsx');
```

Append at the end of the file:

```js
describe('reason chips are 44px tall on the log toast and the SOS overlay', () => {
  it('LogToast: undo and every trigger chip', () => {
    const p = { id: 'tp', ts: `${DAY}T16:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null };
    app.state = { ...attempt(), events: [p] };
    const chips = renderToStaticMarkup(createElement(LogToast, { eventId: 'tp', until: Date.now() + 12000, onDone() {} })).match(/<button[^>]*>/g);
    expect(chips).toHaveLength(7); // undo + six triggers
    for (const c of chips) expect(c).toContain('min-height:44px');
  });
  it('SOSOverlay: every trigger chip', () => {
    const chips = (renderToStaticMarkup(createElement(SOSOverlay, { onClose() {}, onResisted() {}, onUsed() {} })).match(/<button[^>]*class="chip[^>]*>/g)) ?? [];
    expect(chips).toHaveLength(6);
    for (const c of chips) expect(c).toContain('min-height:44px');
  });
});
```

- [ ] **Step 2: Run — expect red**

Run: `npx vitest run src/__tests__/renderGuards.test.js`
Expected: FAIL — `expected '<button class="chip" style="min-height:36px;…' to contain 'min-height:44px'` (toast) and the SOS chips have no inline `min-height` at all.

- [ ] **Step 3: The two components**

```diff
diff --git a/src/components/LogToast.jsx b/src/components/LogToast.jsx
--- a/src/components/LogToast.jsx
+++ b/src/components/LogToast.jsx
@@ -68,7 +68,8 @@ export default function LogToast({ eventId, until, onDone }) {
   // had removed the pouch when nothing had changed.
   const isLast = state.events[state.events.length - 1]?.id === eventId;
 
-  const chipStyle = { minHeight: 36, padding: '6px 13px', fontSize: 13 };
+  // 44px tall, like the reason chips in Fix this day: a thumb-sized target.
+  const chipStyle = { minHeight: 44, padding: '6px 13px', fontSize: 13 };
 
   return (
     <motion.div
```

```diff
diff --git a/src/components/SOSOverlay.jsx b/src/components/SOSOverlay.jsx
--- a/src/components/SOSOverlay.jsx
+++ b/src/components/SOSOverlay.jsx
@@ -82,6 +82,9 @@ export default function SOSOverlay({ onClose, onResisted, onUsed }) {
                 <motion.button
                   key={t}
                   className={`chip ${trigger === t ? 'selected' : ''}`}
+                  // 44px written out, not left to .chip: the render guards pin
+                  // it, and a later chip style can't quietly shrink it.
+                  style={{ minHeight: 44, padding: '6px 13px', fontSize: 13 }}
                   onClick={() => setTrigger(t)}
                   whileTap={{ scale: 0.94 }}
                 >
```

- [ ] **Step 4: Run — green; lint**

Run: `npx vitest run src/__tests__/renderGuards.test.js` → PASS, 12 tests. `npm run lint` → the one known warning.

- [ ] **Step 5: Commit**

```bash
git add src/components/LogToast.jsx src/components/SOSOverlay.jsx src/__tests__/renderGuards.test.js
git commit -m "Reason chips are 44px on the log toast and the SOS overlay, like Fix this day

A thumb-sized target everywhere a reason is picked; the render guards pin it."
```

---

### Task 9: `scripts/e2e/walk-coach.mjs` — the eighth walk (after 7)

Modelled on `walk-latepouch.mjs`: same pinned-clock pattern (`atNow`, `TZ`, `tsFor`, `celebratedFor`, `clearOverlay`, `checkAppendOnly`), same 90-day synthetic plan and prices, its own fixture. Port **4343** (`lsof -i :4343` first). The Claude API is answered by `context.route` with scripted JSON (an `OPTIONS` preflight gets 204 with CORS headers; every `POST` is recorded and answered from `SCRIPT` in order); a catch-all route registered first aborts and records any request to any other host (Playwright runs later-registered routes first). The key is `walk-fake-key-not-real`, typed into Settings → Coach connection's password field — never `sk-ant-…`, and the walk checks it never reaches `localStorage`.

What it proves (the spec's Tests section, item by item): proposal → card → Confirm → event appended with the right `day`/`ts`/`tzOffsetMin` and `late: true` → the follow-up body's user turn is only the `tool_result` → the coach line renders → reload keeps the events, and the saved chat has `actions`/`outcomes` → Skip and Confirm all → an invalid proposal (foreign id) renders without a Confirm and writes nothing → typing while pending skips, and the typed turn leads with the results → a past attempt can't reach the coach (the viewer has no coach button and sends nothing; the no-`tools` body is pinned in `coach.test.js` and `coachProxyPin.test.js`, because `App.jsx` never mounts the sheet in the viewer) → zero console errors, no external request, `pouch-down-v1` still absent.

**Files:**
- Create: `scripts/e2e/walk-coach.mjs`
- Modify: `scripts/e2e/run-all.mjs`

- [ ] **Step 1: Write the walk**

```js
// Proves the coach as app assistant in a real browser: the coach PROPOSES, the
// user confirms on a card, and only that tap writes — through the same api
// method Fix this day uses. The Claude API is never reached: every request to
// it is answered by this walk with a scripted reply, and every other host is
// refused, so the run needs no network and no key of any value.
//
// What the unit suite cannot see, and this walk does:
//   · a fake key typed into Settings → Coach connection opens the coach, and
//     never lands in localStorage;
//   · "had one at 4:30" → a card reading "Add a pouch · Thu Oct 1 · 4:30 PM ·
//     boredom" → Confirm → a reason and a late pouch appended with the right
//     day, ts and zone → the follow-up request carries ONLY the tool_result →
//     the coach's "4:30 is in." renders;
//   · three cards at once: Skip one, Confirm all the rest — a resisted and a
//     check-in appended, the mistake never written, the follow-up answering
//     all three in order;
//   · a proposal naming a pouch that doesn't exist renders as "can't do", with
//     no Confirm, and writes nothing; typing while a card is pending skips it,
//     and the typed turn leads with both tool_results, then the words;
//   · after a reload — no re-seed — the events are still there and the saved
//     chat holds every proposal (`actions`) and every outcome (`outcomes`);
//   · a past attempt in the viewer has no coach button, so it can never send
//     a request (that it would carry no tools is pinned in coach.test.js).
//
// One browser context on a PINNED clock (America/Chicago) and a synthetic
// 90-day plan (9/day · 9 mg · [6, 3], Day 1 Mon 2026-09-28) — the same plan and
// prices as walk-latepouch. "Today" is Thu 2026-10-01 = Day 4, 9:12 PM, with
// three taps logged; Days 1–3 are logged too, so no backfill prompt shows.
// Attempt a1 is a synthetic past attempt for the viewer step.
//
// Every expected number is written twice: by hand in the fixture comments, and
// by store.js on the attempt READ BACK from the browser's localStorage.
// `--dry` prints the fixture and runs the hand-vs-store.js checks, no browser.
//
// Synthetic data only. James's real data never enters this repo; it is public.
// The key below is an obviously fake string: nothing is ever sent anywhere.
//
// Usage: node scripts/e2e/walk-coach.mjs [--dist DIR] [--out DIR] [--port N] [--keep] [--dry]
import { chromium } from 'playwright-core';
import * as e2e from './lib.mjs';
import { generatePlan } from '../../src/planGenerator.js';
import { capForDay } from '../../src/plan.js';
import { pouchesForDay, resistedForDay, checkinForDay, missedDays, todayKey, fmtTime } from '../../src/store.js';
import { awardsFor } from '../../src/awards.js';
import { TOOL_NAMES } from '../../src/coachTools.js';
import { dayKeyAt, offsetMinInZone } from '../../src/time.js';

const args = e2e.parseArgs({ name: 'walk-coach', port: 4343 });
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------- the clock */

const TZ = 'America/Chicago';
process.env.TZ = TZ;
const NOW = '2026-10-01T21:12:00-05:00'; // Thu, CDT — 9:12 PM, three taps logged today
const NOW_MS = Date.parse(NOW);
const TODAY = '2026-10-01';

const RealDate = Date;
function atNow(fn, at = NOW_MS) {
  class PinnedDate extends RealDate {
    constructor(...a) {
      if (a.length) super(...a);
      else super(at);
    }
    static now() {
      return at;
    }
  }
  globalThis.Date = PinnedDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/* ------------------------------------------------------------ day helpers */

const epochDay = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86400000);
const dayStrOf = (ed) => new Date(ed * 86400000).toISOString().slice(0, 10);
const addDays = (s, n) => dayStrOf(epochDay(s) + n);
const pad = (n) => String(n).padStart(2, '0');

const START = '2026-09-28'; // Day 1, a Monday. TODAY is Day 4.
const TODAY_N = epochDay(TODAY) - epochDay(START) + 1;
const dayOf = (n) => addDays(START, n - 1);

/* --------------------------------------------------------------- the plans */

const SETTINGS = {
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  costPerTin: 5,
  pouchesPerTin: 20,
  wakeTime: '07:00',
  sleepTime: '23:00',
};
const PLAN = generatePlan({
  pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: START,
  mealTimes: SETTINGS.mealTimes, sleepTime: SETTINGS.sleepTime, pouchesPerTin: SETTINGS.pouchesPerTin,
});
const CAP = 8; // Days 1–15: "Baseline hold" at 8/day (checked in domainChecks)
// The past attempt for the viewer step: 30 days in August, ended Sep 27.
const OLD_PLAN = generatePlan({ pouchesPerDay: 9, mg: 6, lengthDays: 30, startDate: '2026-08-01', mealTimes: SETTINGS.mealTimes });

/* ------------------------------------------------------------- the events */

const slotHM = (slot) => {
  if (slot.anchor === 'fixed') return slot.time;
  const [h, m] = SETTINGS.mealTimes[slot.anchor].split(':').map(Number);
  const t = h * 60 + m + (slot.offsetMin || 0);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

// Local wall-clock time on `day` in TZ, as epoch ms (resolved twice for DST).
const tsFor = (day, hm, plusMin = 0) => {
  const [h, m] = hm.split(':').map(Number);
  const naive = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m + plusMin) * 60000;
  const ms = naive - offsetMinInZone(naive, TZ) * 60000;
  return naive - offsetMinInZone(ms, TZ) * 60000;
};

// By hand (cap 8 every day):
//
//   d1  Mon 9/28  6 pouches   green
//   d2  Tue 9/29  5 pouches   green
//   d3  Wed 9/30  4 pouches   green
//   d4  Thu 10/1  3 taps      today 3/8   ← the coach's day, at 9:12 PM
//
//   after the 4:30 PM card is confirmed   today 4/8, 0 resisted
//   after Confirm all (mistake skipped)   today 4/8, 1 resisted, check-in 6.5h · 3/5 · workout
//   the "can't do" card and the skipped 1:00 PM card write nothing.
const PATTERN = { 1: 6, 2: 5, 3: 4, [TODAY_N]: 3 };
const TODAY_COUNTS = [3, 4, 4];
const RESISTED = [0, 0, 1];

function buildEvents() {
  const stage = PLAN.stages[0];
  let k = 0;
  const mk = (type, ms, extra = {}) => {
    const tzOffsetMin = offsetMinInZone(ms, TZ);
    return { id: `wc-${++k}`, ts: new Date(ms).toISOString(), tzOffsetMin, day: dayKeyAt(ms, tzOffsetMin), type, trigger: null, ...extra };
  };
  const events = [];
  for (let n = 1; n <= TODAY_N; n++) {
    const day = dayOf(n);
    const firstSlotAt = new Date(tsFor(day, slotHM(stage.slots[0]))).toISOString();
    for (let i = 0; i < (PATTERN[n] ?? 0); i++) {
      const slot = stage.slots[i];
      const slotMs = tsFor(day, slotHM(slot));
      events.push(mk('pouch', slotMs + 5 * 60000, {
        ctx: { nth: i + 1, cap: stage.pouchesPerDay, slotId: slot.id, slotLabel: slot.label, slotAt: new Date(slotMs).toISOString(), firstSlotAt },
      }));
    }
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  return events;
}

const EVENTS = buildEvents();
const TODAY_TAPS = EVENTS.filter((e) => e.type === 'pouch' && e.day === TODAY);
// The tap the coach proposes to mark as a mistake — and the user skips.
const TARGET = TODAY_TAPS[0];

// What the confirmed cards append, entered at NOW (for the award pre-marking
// and the hand checks; the walk reads the real ones back from storage).
const LATE_HM = '16:30';
const LATE_MS = tsFor(TODAY, LATE_HM);
const enteredAt = new Date(NOW_MS).toISOString();
const stampNow = (type, extra) => ({ id: `expected-${type}`, ts: enteredAt, tzOffsetMin: offsetMinInZone(NOW_MS, TZ), day: TODAY, type, trigger: null, ...extra });
const POUCH = { id: 'expected-pouch', ts: new Date(LATE_MS).toISOString(), tzOffsetMin: offsetMinInZone(LATE_MS, TZ), day: TODAY, type: 'pouch', trigger: null, ctx: null, late: true, enteredAt };
const REASON = stampNow('reason', { target: POUCH.id, triggers: ['boredom'], note: '' });
const RESIST = stampNow('resisted', { trigger: 'stress' });
const CHECKIN = stampNow('checkin', { source: 'manual', sleepHours: 6.5, sleepQuality: 3, workout: true });
const withEvents = (attempt, list) => ({ ...attempt, events: [...attempt.events, ...list] });
const STATES = (a) => [a, withEvents(a, [REASON, POUCH]), withEvents(a, [REASON, POUCH, RESIST, CHECKIN])];

function celebratedFor(attempt) {
  const ids = new Set();
  for (const s of STATES(attempt)) for (const a of atNow(() => awardsFor(s))) if (a.earned) ids.add(a.id);
  return [...ids].sort();
}

function fixture() {
  const bare = {
    id: 'a2', status: 'active', createdAt: '2026-09-28T01:30:00.000Z', archivedAt: null,
    settings: SETTINGS, plan: PLAN, events: EVENTS, chats: [],
    celebratedStages: [], celebratedAwards: [],
    checkinDismissedFor: TODAY, // keeps the morning check-in card out of the shots
  };
  const attempt = { ...bare, celebratedAwards: celebratedFor(bare) };
  const old = {
    id: 'a1', status: 'archived', createdAt: '2026-07-31T12:00:00.000Z', archivedAt: '2026-09-27T12:00:00.000Z',
    settings: SETTINGS, plan: OLD_PLAN, chats: [],
    events: [{ id: 'old-1', ts: '2026-08-01T14:00:00.000Z', tzOffsetMin: -300, day: '2026-08-01', type: 'pouch', trigger: null, ctx: null }],
    celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null,
  };
  const root = { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [old, attempt] };
  return { attempt, root, rootJSON: JSON.stringify(root) };
}

const FIX = fixture();

/* ------------------------------------------------------- the scripted coach */

const FAKE_KEY = 'walk-fake-key-not-real';
const API = 'https://api.anthropic.com/v1/messages';
const text = (t) => ({ type: 'text', text: t });
const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const reply = (content, stop = 'end_turn') => ({ id: 'msg_walk', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', stop_reason: stop, content });

const SAY_LATE = 'had one at 4:30 I forgot, boredom';
const SAY_BATCH = 'that first tap today was an accident, I resisted one just now from stress, and I slept 6.5 hours, 3 out of 5, and worked out';
const SAY_ODD = 'and mark the one from last week, and add one at 1';
const SAY_NEVERMIND = 'actually never mind';

const LATE_SUMMARY = 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom';
const MARK_SUMMARY = `Mark as mistake · the ${fmtTime(TARGET)} pouch on Thu Oct 1`;
const RESIST_SUMMARY = 'Log a craving resisted · stress';
const CHECKIN_SUMMARY = 'Morning check-in · 6.5h · 3/5 · workout';
const ONE_PM_SUMMARY = 'Add a pouch · Thu Oct 1 · 1:00 PM';

// One reply per request, in the order the walk makes them.
const SCRIPT = [
  reply([text("Here's that 4:30 one — confirm and it's in."), use('toolu_walk_01', 'add_late_pouch', { day: TODAY, time: LATE_HM, triggers: ['boredom'], note: '' })], 'tool_use'),
  reply([text('4:30 is in.')]),
  reply([
    text('Three cards: the accidental tap, the craving you beat, and the check-in.'),
    use('toolu_walk_02', 'mark_mistake', { pouch_id: TARGET.id }),
    use('toolu_walk_03', 'log_resisted_now', { trigger: 'stress' }),
    use('toolu_walk_04', 'log_checkin', { sleep_hours: 6.5, sleep_quality: 3, workout: true }),
  ], 'tool_use'),
  reply([text('Resisted one is in, and the check-in. The tap stays counted.')]),
  reply([
    text('Here you go.'),
    use('toolu_walk_05', 'mark_mistake', { pouch_id: 'not-a-real-id' }),
    use('toolu_walk_06', 'add_late_pouch', { day: TODAY, time: '13:00', triggers: [], note: '' }),
  ], 'tool_use'),
  reply([text('No problem.')]),
];

/* --------------------------------------------- hand vs store.js, no browser */

function numbersOf(s) {
  return atNow(() => ({ today: pouchesForDay(s, TODAY), resisted: resistedForDay(s, TODAY), checkin: checkinForDay(s, TODAY) }));
}

function domainChecks(rec) {
  rec.section('domain · hand derivation vs store.js (no browser)');
  rec.check(`Pinned clock: Node and store.js agree today is Thu ${TODAY} (Day ${TODAY_N})`,
    atNow(() => todayKey()) === TODAY && TODAY_N === 4, `todayKey ${atNow(() => todayKey())}, day ${TODAY_N}`);
  const caps = Array.from({ length: TODAY_N }, (_, i) => capForDay(PLAN, i + 1));
  rec.check(`Every fixture day has cap ${CAP} (Baseline hold)`, caps.every((c) => c === CAP), caps.join(','));
  rec.check('No missed day, so no backfill prompt shows', atNow(() => missedDays(FIX.attempt)).length === 0);
  rec.check('Today\'s three taps all sit before 9:12 PM, on today', TODAY_TAPS.length === 3
    && TODAY_TAPS.every((e) => Date.parse(e.ts) < NOW_MS && e.day === TODAY), TODAY_TAPS.map((e) => fmtTime(e)).join(', '));
  STATES(FIX.attempt).forEach((s, i) => {
    const got = numbersOf(s);
    rec.check(`state ${i}: today ${TODAY_COUNTS[i]}/${CAP}, ${RESISTED[i]} resisted`,
      got.today === TODAY_COUNTS[i] && got.resisted === RESISTED[i], JSON.stringify({ today: got.today, resisted: got.resisted }));
  });
  rec.check('The past attempt is archived and the active one is a2', FIX.root.attempts.map((a) => `${a.id}:${a.status}`).join(',') === 'a1:archived,a2:active');
  rec.check('The fake key is not a real-looking key', !/^sk-ant-/.test(FAKE_KEY));
}

const STEPS = [
  'open → AI coach → "Open Settings" → type the fake key → back to the coach (key never in localStorage)',
  `"${SAY_LATE}" → card "${LATE_SUMMARY}" (Confirm + Skip, 44px) · request has 8 tools, max_tokens 800, Now, today's ids`,
  'Confirm → reason + late pouch appended (ts 4:30 PM CDT, late, ctx null) → follow-up = only the tool_result → "4:30 is in."',
  `"${SAY_BATCH.slice(0, 40)}…" → three cards + Confirm all → Skip the mistake → Confirm all → resisted + check-in appended`,
  `"${SAY_ODD}" → a "can't do" card with no Confirm + a pending 1:00 PM card → "${SAY_NEVERMIND}" skips it`,
  'reload → events and the saved chat (actions + outcomes) are still there; ring 4 of 8',
  'Settings → Attempts → Attempt 1 → no coach button in the viewer → Exit',
];

function printFixture() {
  log(`\nclock: ${NOW} (${TZ}) — today ${TODAY} = Day ${TODAY_N}`);
  log(`plan: 90 days from ${START} → quit ${PLAN.quitDate}; stage 1 "${PLAN.stages[0].name}" at ${CAP}/day`);
  log('storage: pouch-down-v1 absent · pouch-down-v2 = { a1 archived, a2 active }');
  log(`  events ${EVENTS.length} · today's taps ${TODAY_TAPS.map((e) => fmtTime(e)).join(', ')} · mistake target ${TARGET.id}`);
  log(`  celebratedAwards ${FIX.attempt.celebratedAwards.join(', ')}`);
  log('  steps:');
  STEPS.forEach((s, k) => log(`   ${String(k + 1).padStart(2)}. ${s}`));
}

/* ---------------------------------------------------------------- browser */

const UNLOCK = '[role="dialog"][aria-modal="true"][aria-labelledby]';
const notes = [];

// An award unlock over the sheet would block every tap. The fixture pre-marks
// every reachable award; after a write, an overlay fails instead of noting.
async function clearOverlay(page, where, rec = null) {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    if (!(await page.locator(UNLOCK).count())) break;
    const t = (await page.locator(UNLOCK).first().innerText().catch(() => '')).split('\n')[0];
    seen.push(t);
    if (!rec) notes.push(`unexpected award overlay at ${where}: "${t}"`);
    log(`  (dismissed an unexpected award overlay at ${where}: "${t}")`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  if (rec) rec.check(`${where}: no award unlock overlay`, seen.length === 0, seen.map((t) => `"${t}"`).join(', '));
}

const coachLoc = (page) => page.getByRole('dialog', { name: 'AI coach' });
const storedRoot = async (page) => JSON.parse((await e2e.readStorage(page, 'pouch-down-v2')) ?? 'null');
const storedA2 = (root) => root?.attempts?.find((a) => a.id === 'a2') ?? null;
const card = (sheet, summary) => sheet.getByRole('group', { name: `Proposed: ${summary}`, exact: true });
const lastUser = (body) => body?.messages?.at(-1);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function ringCount(page) {
  const ring = page.getByRole('button', { name: /^Log a pouch\. \d+ of \d+ used today\.$/ });
  const label = (await ring.getAttribute('aria-label', { timeout: 5000 }).catch(() => null)) ?? '';
  return { label, used: Number(label.match(/(\d+) of/)?.[1] ?? NaN) };
}

// Types into the coach and sends; resolves once the reply for request `n`
// (1-based) has rendered `expectText`.
async function say(page, words, expectText) {
  const sheet = coachLoc(page);
  await sheet.getByLabel('Message the coach', { exact: true }).fill(words);
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  return sheet.getByText(expectText, { exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
}

// Seeded events byte-identical and in order; then exactly `types` appended.
function checkAppendOnly(rec, L, stored, types) {
  const evs = stored?.events ?? [];
  const bad = EVENTS.filter((e, i) => JSON.stringify(evs[i]) !== JSON.stringify(e)).length;
  rec.check(`${L} all ${EVENTS.length} seeded events byte-identical, in order`, bad === 0 && evs.length >= EVENTS.length, bad ? `${bad} changed/missing` : '');
  const added = evs.slice(EVENTS.length);
  rec.check(`${L} exactly ${types.length} new events: ${types.join(', ')}`,
    added.length === types.length && added.every((e, i) => e?.type === types[i]), added.map((e) => `${e.type}/${e.day}`).join(', ') || 'none');
  return added;
}

async function connect(rec, page) {
  rec.section('connect: a fake key, typed into Settings');
  await page.getByRole('button', { name: 'AI coach', exact: true }).click();
  const sheet = coachLoc(page);
  await sheet.waitFor({ state: 'visible', timeout: 5000 });
  rec.check('coach: header says "proposes, you confirm"', (await sheet.innerText()).includes('knows your plan & your log · proposes, you confirm'));
  await sheet.getByRole('button', { name: 'Open Settings', exact: true }).click();
  const sub = page.getByRole('dialog', { name: 'Coach connection' });
  const up = await sub.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  rec.check('"Open Settings" lands on Coach connection', up);
  await page.locator('#apikey').fill(FAKE_KEY);
  await sub.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'AI coach', exact: true }).click();
  const input = await coachLoc(page).getByLabel('Message the coach', { exact: true }).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  rec.check('the coach opens to the chat once a key is held', input);
  const body = await e2e.bodyText(page);
  rec.check('quick chips include "I forgot to log one" and "That last tap was a mistake"',
    body.includes('I forgot to log one') && body.includes('That last tap was a mistake'));
  rec.check('the fake key is nowhere in localStorage', !((await e2e.readStorage(page, 'pouch-down-v2')) ?? '').includes(FAKE_KEY));
}

async function walk(browser, base, rec) {
  const L = 'coach:';
  const ctx = await e2e.phoneContext(browser, { tz: TZ, now: NOW });
  await e2e.seedStorage(ctx, { 'pouch-down-v1': null, 'pouch-down-v2': FIX.rootJSON });

  // No network: anything not this app is refused and recorded, and the one
  // Claude endpoint answers from SCRIPT. Later routes win, so the catch-all
  // goes first.
  const external = [];
  const posted = [];
  const script = [...SCRIPT];
  await ctx.route((url) => !url.href.startsWith(base), (route) => { external.push(route.request().url()); return route.abort(); });
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await ctx.route(API, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    posted.push({ body: JSON.parse(req.postData() ?? 'null'), headers: req.headers() });
    const next = script.shift() ?? reply([text('(script ran out)')]);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(next) });
  });

  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, 'coach');

  rec.section('open');
  await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' });
  const up = await page.getByRole('button', { name: 'AI coach', exact: true }).waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
  rec.check(`${L} Today renders with the coach button`, up);
  await clearOverlay(page, `${L} boot`);
  rec.check(`${L} Today ring reads ${TODAY_COUNTS[0]} of ${CAP}`, (await ringCount(page)).used === TODAY_COUNTS[0]);
  await connect(rec, page);
  const sheet = coachLoc(page);

  // ── 1. one remembered pouch ──
  rec.section('"had one at 4:30" → card → Confirm → follow-up');
  const late = card(sheet, LATE_SUMMARY);
  const said = await say(page, SAY_LATE, "Here's that 4:30 one — confirm and it's in.");
  rec.check(`${L} the coach's words render`, said);
  rec.check(`${L} a card reads "${LATE_SUMMARY}"`, await late.isVisible().catch(() => false));
  const lateText = (await late.innerText().catch(() => '')).replace(/\s+/g, ' ');
  rec.check(`${L} its facts line: Thu Oct 1 · 4:30 PM · boredom · added later`, lateText.includes('Thu Oct 1 · 4:30 PM · boredom · added later'), lateText);
  const b1 = posted[0]?.body;
  rec.check(`${L} request 1: max_tokens 800, the eight tools, the typed words as a string`,
    b1?.max_tokens === 800 && same(b1?.tools?.map((t) => t.name), TOOL_NAMES) && same(b1?.messages, [{ role: 'user', content: SAY_LATE }]),
    JSON.stringify({ max: b1?.max_tokens, tools: b1?.tools?.length, messages: b1?.messages }));
  rec.check(`${L} request 1: the prompt names Now (Thu ${TODAY}, 9 PM) and every live pouch of today`,
    /Now: Thu 2026-10-01, 21:\d\d on the user's clock\./.test(b1?.system ?? '') && TODAY_TAPS.every((e) => b1.system.includes(`- ${e.id} · ${TODAY} ·`)));
  rec.check(`${L} request 1: sent with the fake key, and nothing else of anyone's`, posted[0]?.headers['x-api-key'] === FAKE_KEY);
  for (const name of ['Confirm', 'Skip']) {
    const box = await late.getByRole('button', { name: `${name}: ${LATE_SUMMARY}`, exact: true }).boundingBox();
    rec.check(`${L} "${name}" is at least 44px tall`, (box?.height ?? 0) >= 44, `${box?.height}`);
  }
  await late.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await rec.snap(page, 'pending-card');

  await late.getByRole('button', { name: `Confirm: ${LATE_SUMMARY}`, exact: true }).click();
  await clearOverlay(page, `${L} after Confirm`, rec);
  const followed = await sheet.getByText('4:30 is in.', { exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  rec.check(`${L} the follow-up renders "4:30 is in."`, followed);
  rec.check(`${L} the card says Saved, with an Undo chip`,
    (await late.innerText()).includes('Saved') && await late.getByRole('button', { name: `Undo: ${LATE_SUMMARY}`, exact: true }).isVisible().catch(() => false));
  const b2 = posted[1]?.body;
  rec.check(`${L} request 2 replays the coach turn as text + tool_use`,
    same(b2?.messages?.[1], { role: 'assistant', content: [text("Here's that 4:30 one — confirm and it's in."), use('toolu_walk_01', 'add_late_pouch', { day: TODAY, time: LATE_HM, triggers: ['boredom'], note: '' })] }),
    JSON.stringify(b2?.messages?.[1]));
  rec.check(`${L} request 2's user turn is ONLY the tool_result: saved`,
    same(lastUser(b2), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_walk_01', content: 'saved' }] }), JSON.stringify(lastUser(b2)));
  const s1 = storedA2(await storedRoot(page));
  const [r1, p1] = checkAppendOnly(rec, `${L} [late]`, s1, ['reason', 'pouch']);
  rec.check(`${L} the pouch: day ${TODAY} · ts ${POUCH.ts} (4:30 PM CDT) · tzOffsetMin -300 · late · ctx null`,
    !!p1 && p1.day === TODAY && p1.ts === POUCH.ts && p1.tzOffsetMin === -300 && p1.late === true && p1.ctx === null && !('timeKnown' in p1),
    JSON.stringify(p1));
  rec.check(`${L} the reason targets it with [boredom]`, !!r1 && r1.target === p1?.id && same(r1.triggers, ['boredom']), JSON.stringify(r1));
  await rec.snap(page, 'saved-card');

  // ── 2. three cards: Skip one, Confirm all ──
  rec.section('three cards → Skip one → Confirm all');
  const ok3 = await say(page, SAY_BATCH, 'Three cards: the accidental tap, the craving you beat, and the check-in.');
  rec.check(`${L} three cards render`, ok3 && await card(sheet, MARK_SUMMARY).isVisible() && await card(sheet, RESIST_SUMMARY).isVisible() && await card(sheet, CHECKIN_SUMMARY).isVisible());
  const all = sheet.getByRole('button', { name: 'Confirm all', exact: true });
  rec.check(`${L} "Confirm all" sits above them`, await all.isVisible().catch(() => false));
  await card(sheet, MARK_SUMMARY).getByRole('button', { name: `Skip: ${MARK_SUMMARY}`, exact: true }).click();
  await page.waitForTimeout(300);
  rec.check(`${L} the skipped card reads "Skipped" and offers nothing`,
    (await card(sheet, MARK_SUMMARY).innerText()).includes('Skipped') && (await card(sheet, MARK_SUMMARY).getByRole('button').count()) === 0);
  rec.check(`${L} two pending: "Confirm all" still there`, await all.isVisible().catch(() => false));
  await all.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // the sheet scrolls smoothly; let it land before the shot
  await rec.snap(page, 'confirm-all');
  await all.click();
  const ok4 = await sheet.getByText('Resisted one is in, and the check-in. The tap stays counted.', { exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  rec.check(`${L} the follow-up renders`, ok4);
  rec.check(`${L} both confirmed cards say Saved`,
    (await card(sheet, RESIST_SUMMARY).innerText()).includes('Saved') && (await card(sheet, CHECKIN_SUMMARY).innerText()).includes('Saved'));
  rec.check(`${L} request 4 answers all three, in order: skipped, saved, saved`, same(lastUser(posted[3]?.body), { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'toolu_walk_02', content: 'skipped by the user' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_03', content: 'saved' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_04', content: 'saved' },
  ] }), JSON.stringify(lastUser(posted[3]?.body)));
  const s2 = storedA2(await storedRoot(page));
  const added2 = checkAppendOnly(rec, `${L} [batch]`, s2, ['reason', 'pouch', 'resisted', 'checkin']);
  rec.check(`${L} the resisted carries "stress"; the check-in 6.5h · 3/5 · workout, manual`,
    added2[2]?.trigger === 'stress' && added2[3]?.sleepHours === 6.5 && added2[3]?.sleepQuality === 3 && added2[3]?.workout === true && added2[3]?.source === 'manual',
    JSON.stringify(added2.slice(2)));
  rec.check(`${L} no void was written: the skipped mistake stays a counted tap`, !(s2?.events ?? []).some((e) => e.type === 'void'));
  await card(sheet, CHECKIN_SUMMARY).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await rec.snap(page, 'saved-skipped');

  // ── 3. a card the app can't do, and typing past a pending one ──
  rec.section('an invalid proposal, then typing while a card is pending');
  const ok5 = await say(page, SAY_ODD, 'Here you go.');
  const odd = sheet.getByRole('group', { name: 'Proposed action the app can’t do', exact: true });
  rec.check(`${L} the foreign id renders as "can't do", with no buttons`,
    ok5 && (await odd.innerText().catch(() => '')).includes("The coach proposed something the app can't do") && (await odd.getByRole('button').count()) === 0);
  rec.check(`${L} the 1:00 PM card is pending; one pending means no "Confirm all"`,
    await card(sheet, ONE_PM_SUMMARY).getByRole('button', { name: `Confirm: ${ONE_PM_SUMMARY}`, exact: true }).isVisible().catch(() => false)
      && (await all.count()) === 0);
  rec.check(`${L} no follow-up was sent while a card is pending (5 requests so far)`, posted.length === 5, `${posted.length}`);
  await card(sheet, ONE_PM_SUMMARY).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await rec.snap(page, 'invalid-card');
  const ok6 = await say(page, SAY_NEVERMIND, 'No problem.');
  rec.check(`${L} the reply to the typed turn renders`, ok6);
  rec.check(`${L} the 1:00 PM card now reads "Skipped"`, (await card(sheet, ONE_PM_SUMMARY).innerText()).includes('Skipped'));
  rec.check(`${L} request 6 leads with both tool_results, then the words`, same(lastUser(posted[5]?.body), { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'toolu_walk_05', content: 'invalid: pouch_id is not a live pouch from the last 7 days', is_error: true },
    { type: 'tool_result', tool_use_id: 'toolu_walk_06', content: 'skipped by the user' },
    text(SAY_NEVERMIND),
  ] }), JSON.stringify(lastUser(posted[5]?.body)));
  checkAppendOnly(rec, `${L} [invalid + skip]`, storedA2(await storedRoot(page)), ['reason', 'pouch', 'resisted', 'checkin']);

  // ── 4. reload: what was saved, saved ──
  rec.section('reload → events and the saved chat');
  await page.locator('.sheet-backdrop').click({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(500);
  const before = JSON.stringify(storedA2(await storedRoot(page))?.events);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'AI coach', exact: true }).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} reload`);
  const s3 = storedA2(await storedRoot(page));
  rec.check(`${L} after reload the stored events are unchanged (seeding did not re-run)`, JSON.stringify(s3?.events) === before);
  const got = numbersOf(s3);
  rec.check(`${L} store.js on the STORED attempt: today ${TODAY_COUNTS[2]}, ${RESISTED[2]} resisted, check-in 6.5h`,
    got.today === TODAY_COUNTS[2] && got.resisted === RESISTED[2] && got.checkin?.sleepHours === 6.5, JSON.stringify({ today: got.today, resisted: got.resisted }));
  rec.check(`${L} Today ring reads ${TODAY_COUNTS[2]} of ${CAP}`, (await ringCount(page)).used === TODAY_COUNTS[2]);
  const msgs = s3?.chats?.[0]?.messages ?? [];
  rec.check(`${L} one saved chat of 12 messages, user/coach in turn`,
    s3?.chats?.length === 1 && msgs.length === 12 && msgs.every((m, i) => m.role === (i % 2 ? 'assistant' : 'user')), `${s3?.chats?.length} chats, ${msgs.length} messages`);
  rec.check(`${L} the first coach message records its proposal`, same(msgs[1]?.actions, [{ name: 'add_late_pouch', summary: LATE_SUMMARY }]), JSON.stringify(msgs[1]?.actions));
  rec.check(`${L} the follow-up reads "Confirmed: …" and records "saved"`,
    msgs[2]?.text === `Confirmed: ${LATE_SUMMARY}` && same(msgs[2]?.outcomes, [{ name: 'add_late_pouch', summary: LATE_SUMMARY, outcome: 'saved' }]) && msgs[3]?.text === '4:30 is in.',
    JSON.stringify(msgs[2]));
  rec.check(`${L} the batch: three proposed; skipped, saved, saved`,
    msgs[5]?.actions?.length === 3 && same(msgs[6]?.outcomes?.map((o) => o.outcome), ['skipped', 'saved', 'saved']), JSON.stringify(msgs[6]?.outcomes));
  rec.check(`${L} the typed turn records "invalid" (with its reason) and "skipped"`,
    msgs[10]?.text === SAY_NEVERMIND && same(msgs[10]?.outcomes?.map((o) => o.outcome), ['invalid', 'skipped'])
      && msgs[10]?.outcomes?.[0]?.reason === 'pouch_id is not a live pouch from the last 7 days', JSON.stringify(msgs[10]));
  rec.check(`${L} the fake key is still nowhere in localStorage`, !((await e2e.readStorage(page, 'pouch-down-v2')) ?? '').includes(FAKE_KEY));

  // ── 5. a past attempt can't reach the coach ──
  rec.section('the viewer: no coach for a past attempt');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Attempts' }).first().click();
  const attempts = page.locator('[role="dialog"][aria-label="Attempts"]');
  await attempts.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await attempts.getByRole('button', { name: /^Attempt 1/ }).click();
  const viewing = await page.getByRole('button', { name: 'Exit read-only view', exact: true }).waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  rec.check(`${L} Attempt 1 opens read-only`, viewing);
  const requests = posted.length;
  rec.check(`${L} the viewer has no coach button`, (await page.getByRole('button', { name: 'AI coach', exact: true }).count()) === 0);
  await rec.snap(page, 'viewer-no-coach');
  await page.getByRole('button', { name: 'Exit read-only view', exact: true }).click();
  await page.waitForTimeout(400);
  rec.check(`${L} nothing was sent from the viewer`, posted.length === requests && requests === 6, `${posted.length} requests`);

  rec.check(`${L} no request left for any other host`, external.length === 0, external.slice(0, 3).join(', '));
  await e2e.v1Unchanged(page, null, rec);
  if (!args.keep) await ctx.close();
  return errors;
}

/* ------------------------------------------------------------------ main */

e2e.run(async () => {
  const rec = e2e.createRecorder(args.out);
  if (args.dry) {
    printFixture();
    domainChecks(rec);
    return e2e.finish(rec);
  }
  domainChecks(rec);
  const dist = args.dist ?? (await e2e.buildApp(`${args.out}/build`));
  const { base } = await e2e.startPreview({ dist, port: args.port });
  const browser = await chromium.launch();
  const errors = await walk(browser, base, rec);
  if (notes.length) log(`\nnotes (not failures):\n - ${notes.join('\n - ')}`);
  if (!args.keep) await browser.close();
  return e2e.finish(rec, errors);
});
```

- [ ] **Step 2: Register it**

```diff
diff --git a/scripts/e2e/run-all.mjs b/scripts/e2e/run-all.mjs
--- a/scripts/e2e/run-all.mjs
+++ b/scripts/e2e/run-all.mjs
@@ -29,6 +29,7 @@ const WALKS = [
   { name: 'walk-recovery', port: 4337 },
   { name: 'walk-fixday', port: 4339 },
   { name: 'walk-latepouch', port: 4341 },
+  { name: 'walk-coach', port: 4343 },
 ];
 
 const argv = process.argv.slice(2);
```

- [ ] **Step 3: Dry run, then the walk, then the suite**

Run: `node scripts/e2e/walk-coach.mjs --dry` → `RESULT walk-coach: 9 passed, 0 failed, 0 console errors`.
Run: `node scripts/e2e/walk-coach.mjs --out "$SCRATCH/walk-coach"` (any folder outside the repo) → `RESULT walk-coach: 66 passed, 0 failed, 0 console errors`, six screenshots: `pending-card`, `saved-card`, `confirm-all`, `saved-skipped`, `invalid-card`, `viewer-no-coach`.
Run: `npm run e2e` → 8/8 PASS, 0 console errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e/walk-coach.mjs scripts/e2e/run-all.mjs
git commit -m "Walk: the coach proposes, a tap confirms — routed fake API, eight walks

4:30 PM card → reason + late pouch appended → follow-up of only the
tool_result; Skip + Confirm all; a can't-do card writes nothing; typing skips a
pending card; reload keeps events and the saved chat's actions/outcomes; the
viewer has no coach. No network, a fake key, synthetic data."
```

---

### Task 10: CLAUDE.md, screenshots, build log, gates (coordinator)

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/superpowers/reports/2026-10-02-coach-assistant-build-log.md`

- [ ] **Step 1: `CLAUDE.md`** — three edits: the E2E bullet counts eight walks; the coach-proxy bullet states the new clamps; a new bullet after the AI coach bullet states the assistant's rules.

```diff
diff --git a/CLAUDE.md b/CLAUDE.md
--- a/CLAUDE.md
+++ b/CLAUDE.md
@@ -49,8 +49,9 @@ Rules (they outlive the build):
   is the only real kill switch. The key belongs on a dedicated Console
   workspace with a monthly spend cap — that cap is what bounds the loss if a
   key ever leaks, since nothing in the app can stop misuse through the API.
-- **E2E**: `npm run e2e` runs the six Playwright walks in `scripts/e2e/`
-  (migration, setup, backfill, awards, recovery, fixday) on one private build.
+- **E2E**: `npm run e2e` runs the eight Playwright walks in `scripts/e2e/`
+  (migration, setup, backfill, awards, recovery, fixday, latepouch, coach) on
+  one private build.
   `lib.mjs` is the harness: clocks are pinned (`phoneContext({ now })`),
   seeding runs once per context (a re-seed on reload makes reload checks lie),
   and nothing builds into the repo's `dist/`. Synthetic data only.
@@ -126,6 +127,21 @@ status colors. All motion is Framer springs; `MotionConfig reducedMotion="user"`
   comes back with `device.apiKey: ''`, so no path persists one again. NEVER
   commit a key, never move it into the repo or build, and never reintroduce a
   saved key field.
+- **The coach proposes; the user confirms** (2026-10-02). A model's tool call
+  is untrusted input, like a backup file. `src/coachActions.js` is the
+  allowlist: exact keys, types, enums and bounds, days inside the attempt, and
+  pouch ids only from the list the prompt itself printed
+  (`livePouchesForPrompt`); a card's words come from validated values, never
+  the model's. A card's Confirm calls the same api method the sheets call,
+  through `applyAction` — the one place a verb is called — and the api's own
+  guards run again there; every api write returns the new id or `null` when
+  nothing was written, and `null` is a refused card, never a throw. There is
+  never a tool for the forbidden list: starting or ending an attempt, the plan
+  or quit date, the device token or session key, the recovery path, price or
+  meal times. A past attempt is sent no tools. The Worker's clamps
+  (`guard.js` `LIMITS` + `TOOL_NAMES`) ship in the same commit as any prompt
+  or tool change — `coachProxyPin.test.js` fails otherwise. Saved chats carry
+  `actions` (what was proposed) and `outcomes` (how each card ended).
 - **The coach proxy** (`workers/coach-proxy/`, built 2026-09-25, **dormant until
   `COACH_PROXY` in `src/proxyConfig.js` is filled in and deployed**): a
   Cloudflare Worker James owns holds the key as a secret, so the phone holds
@@ -133,8 +149,9 @@ status colors. All motion is Framer springs; `MotionConfig reducedMotion="user"`
   call time — proxy when one is configured *and* this device holds a token,
   otherwise the session-key path, which stays the labelled fallback. The device
   token is a rotatable preference, not a secret of value; the Worker's clamps
-  (one model, `max_tokens` 400, 16 KB body, no field outside the four the app
-  sends) are what bound its misuse. `proxyConfig.js` is the single source of
+  (one model, `max_tokens` 800, 48 KB body, no field outside the five the app
+  sends, only the app's eight tools, tool calls and results only where the
+  conversation can hold them) are what bound its misuse. `proxyConfig.js` is the single source of
   truth and `vite.config.js` imports it for the CSP, so **filling the constant
   in without deploying a rebuild gives a silent CSP block** — change and ship
   together.
```

- [ ] **Step 2: Gates on the final commit, numbers recorded for the log**

`npm test` (baseline 699 passed + this build's: coachTools 11, coachActions 60, coach +8, coachProxyPin 3, guard +13, corrections +13, root +8, ingest +2, renderGuards +8; 4 skipped) · `npm run lint` (one known warning) · `npm run build && rm -rf dist/` · `npx vitest run workers/coach-proxy` (45) · `npm run e2e` (8/8, 0 console errors).

- [ ] **Step 3: Screenshots** — read the walk's six PNGs from its `--out` folder in the scratchpad (never the repo). The three the spec asks for at 390px are `pending-card` (a pending card), `confirm-all` (Confirm all over two pending cards, one skipped above), `saved-skipped` (a saved + skipped pair).

- [ ] **Step 4: Outside reviews** — Sol (GPT-5.6, `~/.codex/bin/ask-chatgpt`) on `git diff main...HEAD` with `coachActions.js`, `CoachSheet.jsx`, `guard.js` and `state.jsx` called out; Gemini (`~/.gemini/bin/ask-gemini`, no `--search`) for the design + security red-team on the sheet, the card and the validation module, with the spec's question verbatim: can any sequence of proposals make a day read better than the log? Paste curated excerpts only (no vault files, nothing of James's). Verify every claim against the code; fix accepted ones (fresh implementer, then a reviewer); log rejected ones with the reason.

- [ ] **Step 5: The build log** — `docs/superpowers/reports/2026-10-02-coach-assistant-build-log.md`, in the voice of the 2026-10-01 late-pouch log. It must contain:
  - what changed and why, task by task, with commit hashes;
  - the concepts, in plain words for James: tool use (the model names an action, the app decides), an allowlist versus a blocklist, why the follow-up is one call per batch, why Confirm all walks one card per render;
  - every solo decision: optional fields accept `null`; an over-long note is invalid, not trimmed; duplicate suppression and which verbs it covers; tool inputs over 2 KB replayed as `{}`; `outcomes` also recorded on a typed turn that skipped cards; a blank coach text allowed when it carries `actions`; the Undo chip at 12 s with the api's 15 s; an undo after the follow-up stays on the card and in the fresh prompt, not in the saved outcome; `wellFormed` checks types and the enum, `appendChatTurn` the lengths; the prompt's "you can propose these actions" wording (the "your" pin);
  - every place the code contradicted the spec, and what was done: `appendChatTurn` tests live in `corrections.test.js`; `logBackfill` (and `logPouch`/`logResisted`/`logCheckin` in the viewer) returned ids for writes that never happened — fixed in Task 5; the Worker has no `npm test` of its own; the viewer never mounts the coach, so "past attempt sends no tools" is proven in unit tests and the walk proves the viewer can't send; SOS chips were already 44px by CSS; the coach bounds (`sleep_hours` 0–16, `count` 0–60) are wider than the check-in card's 0–14 and the backfill stepper's 40 — the api accepts both, the spec's bounds stand;
  - gate numbers, the six screenshots described in words, both reviews (accepted / rejected with reasons);
  - follow-ups: deploy the Worker (its clamps are ready), Firebase sync, off-track detection before 10/7.

- [ ] **Step 6: Commit, then merge + push per the one-time authorization**

```bash
git add CLAUDE.md docs/superpowers/reports/2026-10-02-coach-assistant-build-log.md
git commit -m "CLAUDE.md: the coach proposes, the user confirms; build log for the coach-assistant night"
```

The spec records James's one-time authorization (2026-10-01, this branch only): merge + push to `main` when `npm test`, lint, build, e2e and both outside reviews are green. The coordinator does this, not a task worker; the never-push rule stands everywhere else.

---

## Self-review (done while writing)

- **Spec coverage, section by section:** What James decided — proposes-only (T2 `applyAction`, T7), forbidden list has no tool (T1 test + T3 test), Worker in the same change (T4, merged with T3), Now in the prompt + day/`HH:MM` (T1 `promptClock`, T3), saved chats record actions/outcomes (T5). Answers 1–4: 5 cards + Confirm all + sixth refused (T2 overflow, T6/T7), automatic follow-up one call per batch (T7, walk), ship gate (T10), 44px chips (T8). Not in this build: no editing (card is pure receipt), no streaming/model change (`MODEL` untouched), no new storage key (chats only), no deployment (T4 note), nothing James-specific (synthetic fixtures). The eight verbs table (T1 schemas, T2 builders + summaries verbatim, backfill streak rule, `pouch_id` from the live 7-day list). Architecture: `coachTools.js` (T1), `coachActions.js` incl. `toTurns`/`renderOutcomes` (T2), `coach.js` request/return/prompt/archived (T3), ActionCard states/motion/busy (T6), CoachSheet send/resolve/follow-up/chain cap/typing/errors/header/chips/read-only (T7), saved chats + `wellFormedChat` + ingest lines (T5), Worker limits list item by item (T4), 44px chips (T8). Data flow 1–7 (walk step 1). Security: allowlist, ids from the app's own list, guards rerun (T2, T5), `invalid` + `is_error` for foreign id / future day / eleventh trigger / 5 KB note (T2 matrix), no new storage (T5 shape only), past attempt no tools (T3), red-team question (T10). Tests section: every bullet has a task (T1, T2, T3, T4, T5, T6/T8, T9). Gates (T10).
- **Gaps found and placed:** `logBackfill` returning ids for unwritten events (added to T5); the follow-up's `state` must include the confirmed write (the effect runs after the render that resolved the card, T7); Confirm all racing the render-time guard (queue walked one card per render, T7); `exhaustive-deps` in the lint gate (module-level helpers, full dependency lists, T7); the README's stale test instructions (T4).
- **Placeholder scan:** no "TBD", "TODO", "similar to", "add appropriate" or "handle edge cases" in this plan.
- **Names used consistently:** `TOOLS`, `TOOL_NAMES`, `MAX_PROPOSALS`, `MAX_TOKENS`, `NOTE_MAX`, `COUNT_MAX`, `TOOL_INPUT_MAX`, `RESULT_MAX`, `livePouchesForPrompt(state, now)`, `promptClock(now)`, `fmtAppDay(day)`; `validateProposal(state, proposal, now)`, `takeProposals(state, proposals, now)`, `outcomeResult(card)`, `overflowResult(id)`, `resultsFor(message)`, `applyAction(api, action)`, `toTurns(messages)`, `actionsOf(cards)`, `outcomesOf(cards)`, `renderOutcomes(outcomes)`, `REFUSED`; `askCoach(state, turns, apiKey, now)` → `{ text, proposals, stopReason }`; `appendChatTurn(chatId, { user, assistant, actions, outcomes })`; `CHAT_OUTCOMES`, `wellFormedChatAction`, `wellFormedChatOutcome`; guard `TOOL_NAMES`, `LIMITS.{tools, toolDescription, toolSchema, blocks, toolInput, toolResult}`; `ActionCard({ card, busy, undoable, onConfirm, onSkip, onUndo })`; aria labels `Confirm: <summary>`, `Skip: <summary>`, `Undo: <summary>`, `Proposed: <summary>`, `Proposed action the app can’t do`, `Confirm all`.
- **Verified before writing:** every new and changed file in this plan was built in a scratch copy of this worktree (outside the repo) and run: `npm test` 825 passed / 4 skipped, lint at the one known warning, `vite build` clean, `walk-coach` 66/66 with 0 console errors, and the seven existing walks green on the same build.
