# Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape Settings, Stats, Calendar and Today as decided in
`docs/superpowers/specs/2026-09-28-design-pass-design.md`, then land the three
fixes Session D deferred, without touching a domain rule or breaking a walk.

**Architecture:** Every new behaviour starts as a pure function in its own
small module with a unit test (`coachStatus`, `stripPicks`, `monthsFor`,
`lastBackup`, `asText`), and the components only render what those return.
Settings becomes a grouped sheet that hosts two sub-sheets; Stats gets a
segment control over the same data; Calendar renders month sections from
`monthsFor`. E2E walks are edited *in the same commit* as the UI they test.

**Tech Stack:** Vite 8 + React 19 + Framer Motion 12, lucide-react, vitest
(node env, `renderToStaticMarkup` for components), Playwright walks in
`scripts/e2e/`. No new dependencies.

**Branch:** `feat/design-pass` in `~/Projects/pouch-down-design` (worktree of
`~/Projects/pouch-down`, `node_modules` symlinked). Never push.

---

## Ground rules the executor must not forget

- Read `CLAUDE.md` first. Events are append-only; silence is never success;
  nothing James-specific in the repo; the key is never at rest; the CSP is
  build-only; days run 4am→4am.
- `npm test` must stay green after every task. Lint baseline is exactly one
  warning (`src/state.jsx:226`). `npm run build` then `rm -rf dist/` (a
  present `dist/` flips `csp.test.js`).
- Every existing e2e selector keeps working, or the walk is edited in the
  same commit with the reason in the message. The selector contract is listed
  under each task that touches it.
- Component tests follow `src/__tests__/disciplineCard.test.js`: mock
  `../state.jsx` with `vi.hoisted`, render with `renderToStaticMarkup`.
- Commit messages explain *why*, end with the attribution lines the session
  prompt gives.

---

## File map

| File | Responsibility |
|---|---|
| `src/text.js` (new) | `asText(v)` — the one `String()` guard, so display code never prints an object |
| `src/proxyConfig.js` | + `coachStatus({ proxyOn, hasToken, hasKey })` → `'proxy' \| 'key' \| 'none'` |
| `src/lastBackup.js` (new) | last-backup-day preference: `getLastBackup / setLastBackup / subscribe` |
| `src/calendarMonths.js` (new) | `monthsFor(state)` — plan days grouped by month with marks |
| `src/components/awards/TrophyCase.jsx` | + `stripPicks(awards, max)` and `TrophyStrip` |
| `src/components/settings/SubSheet.jsx` (new) | the stacked sheet chrome both sub-sheets share |
| `src/components/settings/SettingsRow.jsx` (new) | the 56px title/subtitle/chevron row |
| `src/components/settings/CoachConnectSheet.jsx` (new) | token + key fields (moved, verbatim) |
| `src/components/settings/AttemptsSheet.jsx` (new) | current summary, past list, danger zone |
| `src/components/SettingsSheet.jsx` | rebuilt as the grouped sheet |
| `src/components/StatsView.jsx` | segment control + sections |
| `src/components/HistoryTimeline.jsx` | weekday in the row, guards |
| `src/components/CalendarView.jsx` | month sections |
| `src/components/TodayView.jsx` | SOS under the ring |
| `src/components/TodayLog.jsx`, `PlanView.jsx` | guards |
| `src/components/CoachSheet.jsx`, `src/App.jsx` | `openSettings('coach')` |
| `src/components/onboarding/steps.jsx` | honest setup copy |
| `src/migrate.js` | fill `DEFAULT_SETTINGS` gaps |
| `scripts/notify-telegram.mjs` | chat id from the env file |
| `src/index.css` | section header, segment, row, danger zone, month header, marks |
| `vite.config.js` | `define` for `import.meta.env.VITE_BUILD` |

---

## Task 1: `asText` guard + the three display components

**Files:**
- Create: `src/text.js`
- Create: `src/__tests__/renderGuards.test.js`
- Modify: `src/components/TodayLog.jsx`, `src/components/HistoryTimeline.jsx`, `src/components/PlanView.jsx`

- [ ] **Step 1: Write the failing tests**

`src/__tests__/renderGuards.test.js`:

```js
// wellFormed gates every root that reaches these components, so this is belt
// to those braces: a stored string that turned into an object must render as
// nothing, never throw "Objects are not valid as a React child" mid-tab.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePlan } from '../planGenerator.js';
import { asText } from '../text.js';

const app = vi.hoisted(() => ({ state: null }));
vi.mock('../state.jsx', () => ({ useApp: () => ({ state: app.state, tick: 0, readOnly: false }) }));

const { default: TodayLog } = await import('../components/TodayLog.jsx');
const { default: HistoryTimeline } = await import('../components/HistoryTimeline.jsx');
const { default: PlanView } = await import('../components/PlanView.jsx');

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
const DAY = '2026-09-25';
const hostile = [
  { id: 'p1', ts: `${DAY}T14:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null,
    ctx: { nth: 1, cap: 9, slotId: 'x', slotLabel: { evil: true }, slotAt: `${DAY}T13:00:00.000Z`, firstSlotAt: `${DAY}T13:00:00.000Z` } },
  { id: 'r1', ts: `${DAY}T14:00:05.000Z`, tzOffsetMin: -300, day: DAY, type: 'reason', trigger: null, for: 'p1', triggers: [{ no: 1 }, 'stress'], note: ['not', 'a', 'string'] },
  { id: 'c1', ts: `${DAY}T13:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'checkin', trigger: null, source: 'manual', sleepQuality: { deep: true }, sleepHours: 'seven' },
];
const attempt = () => ({
  id: 'a2', status: 'active', archivedAt: null, settings, events: hostile,
  plan: {
    ...plan,
    stages: plan.stages.map((s, i) => (i === 0
      ? { ...s, name: { bad: 1 }, tagline: ['x'], slots: s.slots.map((sl, j) => (j === 0 ? { ...sl, label: 42 } : sl)) }
      : s)),
  },
  celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${DAY}T17:00:00.000Z`)); app.state = attempt(); });
afterEach(() => { vi.useRealTimers(); app.state = null; });

describe('asText', () => {
  it('passes strings and numbers through, and blanks everything else', () => {
    expect(asText('hi')).toBe('hi');
    expect(asText(7)).toBe('7');
    expect(asText(null)).toBe('');
    expect(asText(undefined)).toBe('');
    expect(asText({ a: 1 })).toBe('');
    expect(asText(['x'])).toBe('');
    expect(asText(NaN)).toBe('');
  });
});

describe('display components survive hostile stored strings', () => {
  it('TodayLog renders the pouch row without throwing or printing [object Object]', () => {
    const out = renderToStaticMarkup(createElement(TodayLog));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('stress'); // the one real trigger survives
  });
  it('HistoryTimeline renders the day, its rows, and nothing garbled', () => {
    const out = renderToStaticMarkup(createElement(HistoryTimeline));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('check-in');
  });
  it('PlanView renders every stage, with the hostile name and slot label blank', () => {
    const out = renderToStaticMarkup(createElement(PlanView));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('House rules');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/renderGuards.test.js`
Expected: FAIL — `Cannot find module '../text.js'`, then (after creating it)
"Objects are not valid as a React child" from TodayLog / PlanView (`slot.label.toLowerCase is not a function`).

- [ ] **Step 3: Create `src/text.js`**

```js
// The one String() guard for display code. Stored data is validated by
// wellFormed before it reaches a component, so this is belt to those braces:
// a value that is not text renders as nothing rather than as "[object Object]"
// or a thrown "Objects are not valid as a React child" that takes the tab down.
export const asText = (v) =>
  typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
```

- [ ] **Step 4: Guard `TodayLog.jsx`**

Import `asText` and change the pouch row:

```js
import { asText } from '../text.js';
// …
const tags = triggersFor(state, ev).map(asText).filter(Boolean);
// …
const slotLabel = asText(ev.ctx?.slotLabel);
```

(`tags` is computed once at the top of `LogRow`; the resisted row uses the same guarded array.)

- [ ] **Step 5: Guard `HistoryTimeline.jsx`**

Import `asText`. In `EventRow`:
- pouch: `ev.ctx?.slotLabel` → `asText(ev.ctx?.slotLabel)` (render the segment only when non-empty); `triggersFor(state, ev)` → `triggersFor(state, ev).map(asText).filter(Boolean)` (compute once as `const tags`); the note segment becomes `const note = asText(reasonFor(state, ev)?.note);` rendered when non-empty.
- resisted: same `tags` treatment.
- checkin: `quality {asText(ev.sleepQuality)}/5` only when `typeof ev.sleepQuality === 'number'`; `{fmtHours(ev.sleepHours)}h` only when `typeof ev.sleepHours === 'number' && Number.isFinite(ev.sleepHours)`.

- [ ] **Step 6: Guard `PlanView.jsx`**

Import `asText`. Replace `{s.name}` → `{asText(s.name)}`, `{s.tagline}` → `{asText(s.tagline)}`,
`{slot.label.toLowerCase()}` → `{asText(slot.label).toLowerCase()}`,
`Buy {s.shopBefore.what}` → `Buy {asText(s.shopBefore.what)}`, and the meals line
`{asText(state.settings.mealTimes.breakfast)} / …`.

- [ ] **Step 7: Run tests**

Run: `npm test`
Expected: all green, 3 + 1 new tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/text.js src/__tests__/renderGuards.test.js src/components/TodayLog.jsx src/components/HistoryTimeline.jsx src/components/PlanView.jsx
git commit -m "Display guards: a stored value that isn't text renders as nothing

Session D deferred these: wellFormed gates every root that reaches TodayLog,
HistoryTimeline and PlanView, but a slot label or stage name that had become
an object would still throw inside React and take the tab down. asText() is
the single guard, and the test renders each component against hostile
fixtures with react-dom/server — no new dependency."
```

---

## Task 2: `migrate.js` fills `DEFAULT_SETTINGS` gaps (separate reviewer)

**Files:**
- Modify: `src/migrate.js`
- Test: `src/__tests__/migrate.test.js`

- [ ] **Step 1: Write the failing tests** (append to `migrate.test.js`, inside `describe('migrateV1')`)

```js
  it('fills settings a v1 never had from DEFAULT_SETTINGS, without replacing a present value', () => {
    const input = v1();
    input.settings = { mealTimes: { breakfast: '07:15', lunch: '12:00' }, costPerTin: 9.5, apiKey: 'sk-ant-TEST' };
    const s = migrateV1(input, opts).attempts[0].settings;
    expect(s).toEqual({
      mealTimes: { breakfast: '07:15', lunch: '12:00', dinner: '18:30' },
      costPerTin: 9.5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00',
    });
    expect(s).not.toHaveProperty('apiKey');
  });

  it('a v1 with no settings at all migrates with the defaults, key blank', () => {
    const input = v1();
    delete input.settings;
    const root = migrateV1(input, opts);
    expect(root.attempts[0].settings).toEqual(DEFAULT_SETTINGS);
    expect(root.device.apiKey).toBe('');
  });

  it('a complete v1 settings object migrates byte-for-byte as before', () => {
    const { apiKey, ...expected } = v1().settings;
    expect(migrateV1(v1(), opts).attempts[0].settings).toEqual(expected);
  });
```

Add `import { DEFAULT_SETTINGS } from '../root.js';` at the top.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/migrate.test.js`
Expected: the first two FAIL (missing `dinner`, `pouchesPerTin`, `wakeTime`, `sleepTime`).

- [ ] **Step 3: Implement**

In `src/migrate.js`:

```js
import { DEFAULT_SETTINGS } from './root.js';
// …
export function migrateV1(v1, { legacyPlan, now = new Date().toISOString() }) {
  // v1 grew fields over its life (wake and sleep arrived late), so an early
  // export can be missing some. Fill only what is absent — a value the person
  // set is never replaced — and strip the key: it goes to the device, blank.
  const { apiKey = '', ...given } = v1.settings ?? {};
  const settings = {
    ...DEFAULT_SETTINGS,
    ...given,
    mealTimes: { ...DEFAULT_SETTINGS.mealTimes, ...(given.mealTimes ?? {}) },
  };
```

(the rest unchanged). Check `root.js` does not import `migrate.js` — if it does, move `DEFAULT_SETTINGS` reading to a parameter instead; it does not today.

- [ ] **Step 4: Run the whole suite**

Run: `npm test` — Expected: green. The golden test (`plan.test.js` / real-data tests) still passes because the golden v1 already carries every field.

- [ ] **Step 5: Reviewer gate.** Dispatch a fresh reviewer agent with only the diff (`git diff src/migrate.js src/__tests__/migrate.test.js`) and this brief: *"migrate.js is the most load-bearing code in the app: it turns the sacred read-only `pouch-down-v1` into attempt 1. Confirm (1) no present value is ever replaced, (2) the key is still stripped, (3) `unreadableEvents` handling is untouched, (4) the output for a complete v1 is byte-identical to before. Report findings; do not edit."* Fix anything it finds before committing.

- [ ] **Step 6: Commit**

```bash
git add src/migrate.js src/__tests__/migrate.test.js
git commit -m "Migration fills settings a v1 never had, replacing nothing

A v1 export from before wake and sleep existed migrated with those fields
missing; the tightened wellFormed then sent the next boot to recovery instead
of Today. Missing keys now come from DEFAULT_SETTINGS (meal times key by
key), present values are never touched, the key is still stripped to the
device. Reviewed separately, as the brief asked."
```

---

## Task 3: Notify-only Telegram bot — chat id from the env file

**Files:**
- Modify: `scripts/notify-telegram.mjs` (`telegramConfig`)
- Test: `src/__tests__/notify.test.js`

- [ ] **Step 1: Write the failing test** (new `describe` at the end of `notify.test.js`)

```js
describe('telegramConfig reads a self-contained env file', () => {
  it('takes the chat id from the same file as the token, so a notify-only bot needs nothing beside it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pouch-notify-'));
    fs.writeFileSync(path.join(dir, 'telegram.env'), 'TELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef\nTELEGRAM_CHAT_ID=987654321\n');
    expect(telegramConfig({ POUCH_TELEGRAM_ENV: path.join(dir, 'telegram.env') }))
      .toEqual({ token: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef', chatId: '987654321' });
  });
  it('POUCH_TELEGRAM_CHAT still wins over the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pouch-notify-'));
    fs.writeFileSync(path.join(dir, 'telegram.env'), 'TELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef\nTELEGRAM_CHAT_ID=1\n');
    expect(telegramConfig({ POUCH_TELEGRAM_ENV: path.join(dir, 'telegram.env'), POUCH_TELEGRAM_CHAT: '2' }).chatId).toBe('2');
  });
  it('without a chat id anywhere it still says so, and never invents one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pouch-notify-'));
    fs.writeFileSync(path.join(dir, 'telegram.env'), 'TELEGRAM_BOT_TOKEN=123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef\n');
    expect(telegramConfig({ POUCH_TELEGRAM_ENV: path.join(dir, 'telegram.env') })).toEqual({ problem: 'no Telegram chat to send to' });
  });
});
```

Make sure `telegramConfig` is in the test file's import list from `../../scripts/notify-telegram.mjs`.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/__tests__/notify.test.js` — first test FAILS (`problem: 'no Telegram chat to send to'`).

- [ ] **Step 3: Implement** — in `telegramConfig`, read both keys from the file:

```js
  let token = null;
  let chatId = env.POUCH_TELEGRAM_CHAT || null;
  try {
    const text = fs.readFileSync(envFile, 'utf8');
    const val = (name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*["']?([^"'\\s]+)`, 'm').exec(text)?.[1] ?? null;
    token = val('TELEGRAM_BOT_TOKEN');
    // A notify-only bot's file carries its own chat id, so nothing has to sit
    // beside it. The plugin's folder has no such line and falls through to
    // access.json exactly as before.
    if (!chatId) chatId = val('TELEGRAM_CHAT_ID');
  } catch { /* not set up */ }
```

Update the header comment's `Env:` block: `POUCH_TELEGRAM_ENV  the .env holding TELEGRAM_BOT_TOKEN (and optionally TELEGRAM_CHAT_ID) …`.

- [ ] **Step 4: Run `npm test`** — green.

- [ ] **Step 5: Commit**

```bash
git add scripts/notify-telegram.mjs src/__tests__/notify.test.js
git commit -m "Notifier: a notify-only bot's env file can carry its own chat id

The watcher borrows the conversational bot's token because that folder is
the default. Pointing POUCH_TELEGRAM_ENV at a second file already worked for
the token; the chat id still had to come from access.json beside it, which
a notify-only bot doesn't have. Now TELEGRAM_CHAT_ID in the same file is
enough. James wires it: the build log has the recipe. Nothing changes until
he does."
```

---

## Task 4: `coachStatus`, `lastBackup`, build id

**Files:**
- Modify: `src/proxyConfig.js` (append), `vite.config.js`
- Create: `src/lastBackup.js`
- Test: `src/__tests__/proxy.test.js` (append), `src/__tests__/lastBackup.test.js` (new)

- [ ] **Step 1: Tests**

Append to `proxy.test.js` (import `coachStatus`):

```js
describe('coachStatus — the one line Settings shows', () => {
  it('proxy only when a proxy is configured and this device holds a token', () => {
    expect(coachStatus({ proxyOn: true, hasToken: true, hasKey: false })).toBe('proxy');
    expect(coachStatus({ proxyOn: true, hasToken: true, hasKey: true })).toBe('proxy');
  });
  it('key when a session key is held and the proxy path is not live', () => {
    expect(coachStatus({ proxyOn: false, hasToken: false, hasKey: true })).toBe('key');
    expect(coachStatus({ proxyOn: true, hasToken: false, hasKey: true })).toBe('key');
  });
  it('none otherwise', () => {
    expect(coachStatus({ proxyOn: false, hasToken: true, hasKey: false })).toBe('none');
    expect(coachStatus({})).toBe('none');
  });
});
```

`src/__tests__/lastBackup.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { getLastBackup, setLastBackup, subscribe, LAST_BACKUP_KEY } from '../lastBackup.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe('lastBackup', () => {
  beforeEach(() => { globalThis.localStorage = mem(); setLastBackup(''); });
  it('is empty until a backup goes out', () => { expect(getLastBackup()).toBe(''); });
  it('remembers the app-day of the last backup and tells subscribers', () => {
    const seen = [];
    const off = subscribe((d) => seen.push(d));
    setLastBackup('2026-09-25');
    expect(getLastBackup()).toBe('2026-09-25');
    expect(globalThis.localStorage.getItem(LAST_BACKUP_KEY)).toBe('2026-09-25');
    expect(seen).toEqual(['2026-09-25']);
    off();
  });
  it('only ever stores a YYYY-MM-DD day, never anything else', () => {
    setLastBackup('not a day');
    expect(getLastBackup()).toBe('');
  });
  it('survives storage being unavailable', () => {
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
    expect(() => setLastBackup('2026-09-25')).not.toThrow();
    expect(getLastBackup()).toBe('2026-09-25');
  });
});
```

- [ ] **Step 2: Run** — both FAIL (missing exports / module).

- [ ] **Step 3: Implement `coachStatus`** at the end of `proxyConfig.js`:

```js
// ── what Settings says ──────────────────────────────────────────────────────
//
// One word for the coach's state, derived the same way pickTransport picks a
// transport, so the status line can never disagree with what a call would do.
export function coachStatus({ proxyOn = false, hasToken = false, hasKey = false } = {}) {
  if (proxyOn && hasToken) return 'proxy';
  if (hasKey) return 'key';
  return 'none';
}
```

- [ ] **Step 4: Implement `src/lastBackup.js`** — mirror the device-token block:

```js
// When this phone last sent a backup out — an app-day, not a secret, not data.
// It lives in its own localStorage key, outside the root, so it never rides in
// a backup or a recovery dump and never touches an attempt. Storage is guarded
// twice, like the device token: memory keeps working when the store can't.
export const LAST_BACKUP_KEY = 'pouch-down-last-backup';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

let current = '';
let loaded = false;
const listeners = new Set();

function store() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function getLastBackup() {
  if (!loaded) {
    loaded = true;
    try { current = store()?.getItem(LAST_BACKUP_KEY) ?? ''; } catch { current = ''; }
    if (!DAY.test(current)) current = '';
  }
  return current;
}

export function setLastBackup(day) {
  current = typeof day === 'string' && DAY.test(day) ? day : '';
  loaded = true;
  try {
    const s = store();
    if (current) s?.setItem(LAST_BACKUP_KEY, current);
    else s?.removeItem(LAST_BACKUP_KEY);
  } catch { /* memory only from here */ }
  for (const fn of listeners) fn(current);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
```

- [ ] **Step 5: Build id in `vite.config.js`**

```js
import { execSync } from 'node:child_process'
// …
// The short commit the build came from, shown on Settings → About so a screen
// on the phone can be matched to a commit. 'dev' outside a checkout or in dev.
const buildId = () => {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev' } catch { return 'dev' }
}
// in defineConfig({ … }):
  define: { 'import.meta.env.VITE_BUILD': JSON.stringify(buildId()) },
```

Run `npm run build && rm -rf dist/` once to confirm the config still loads, and `npx vitest run src/__tests__/csp.test.js`.

- [ ] **Step 6: `npm test`** green. **Commit:**

```bash
git add src/proxyConfig.js src/lastBackup.js src/__tests__/proxy.test.js src/__tests__/lastBackup.test.js vite.config.js
git commit -m "Settings groundwork: coach status, last-backup day, build id

Three small pure pieces the new Settings sheet reads. coachStatus derives
the one status line from the same facts pickTransport uses, so the sheet
can't claim a connection a call wouldn't make. lastBackup remembers the
app-day a backup last went out, in its own key outside the root — a
preference, never data, never in a dump. VITE_BUILD carries the short commit
into About."
```

---

## Task 5: Settings — sub-sheet chrome, row, Coach and Attempts sheets

**Files:**
- Create: `src/components/settings/SubSheet.jsx`, `SettingsRow.jsx`, `CoachConnectSheet.jsx`, `AttemptsSheet.jsx`
- Modify: `src/index.css` (append)

- [ ] **Step 1: CSS** (append to `src/index.css` under a new `/* ---- settings ---- */`):

```css
/* ---- settings ---- */
.section-head {
  display: flex; align-items: baseline; justify-content: space-between;
  margin: 22px 0 8px;
  font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 700;
  color: var(--accent-bright);
}
.section-head::after { content: ''; flex: 1; height: 1px; margin-left: 10px; background: linear-gradient(90deg, var(--accent-glow), transparent); }
.settings-row {
  display: flex; align-items: center; gap: 12px; width: 100%;
  min-height: 56px; padding: 10px 14px; text-align: left;
  background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
}
.settings-row .title { font-weight: 600; font-size: 15px; }
.settings-row .sub { font-size: 13px; color: var(--fg-muted); margin-top: 2px; }
.settings-row .chev { margin-left: auto; color: var(--fg-faint); flex-shrink: 0; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--fg-faint); }
.status-dot.on { background: var(--green); box-shadow: 0 0 8px var(--green-glow); }
.status-dot.session { background: var(--amber); }
.danger-zone {
  margin-top: 28px; padding: 14px; border-radius: var(--radius);
  border: 1px solid rgba(248, 113, 113, 0.35); background: rgba(248, 113, 113, 0.06);
}
.danger-zone .section-head { color: var(--red); margin-top: 0; }
.danger-zone .section-head::after { background: linear-gradient(90deg, rgba(248,113,113,0.35), transparent); }
.btn-danger { background: rgba(248, 113, 113, 0.10); border: 1px solid rgba(248, 113, 113, 0.35); color: var(--red); }
```

- [ ] **Step 2: `SubSheet.jsx`** — the stacked chrome (same z-indices as `TrophyDetailSheet`):

```jsx
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';

// A sheet stacked on top of Settings: backdrop 52, sheet 53, like the trophy
// detail sheet over the case. Escape closes it; Settings underneath stays put.
export default function SubSheet({ label, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <motion.div className="sheet-backdrop" style={{ zIndex: 52 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="sheet"
        style={{ zIndex: 53 }}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        aria-label={label}
      >
        <div className="sheet-handle" />
        <div className="spread">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 16 }}>{label}</h3>
            {subtitle && <p className="small faint" style={{ margin: '2px 0 0' }}>{subtitle}</p>}
          </div>
          <motion.button
            type="button"
            aria-label={`Close ${label.toLowerCase()}`}
            onClick={onClose}
            whileTap={{ scale: 0.92 }}
            className="row"
            style={{ minWidth: 44, minHeight: 44, justifyContent: 'flex-end', padding: '0 0 0 12px', margin: '-11px -2px -11px 0', background: 'none', color: 'var(--fg-muted)' }}
          >
            <X size={18} />
          </motion.button>
        </div>
        {children}
        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>Done</button>
      </motion.div>
    </>
  );
}
```

- [ ] **Step 3: `SettingsRow.jsx`**

```jsx
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

// One row of Settings that opens somewhere: a title that IS the state, a
// subtitle that names the one thing to do about it, a chevron. 56px tall.
export default function SettingsRow({ icon = null, title, subtitle, onClick, ariaLabel }) {
  return (
    <motion.button type="button" className="settings-row" onClick={onClick} aria-label={ariaLabel} whileTap={{ scale: 0.98 }}>
      {icon}
      <span style={{ minWidth: 0 }}>
        <span className="title" style={{ display: 'block' }}>{title}</span>
        {subtitle && <span className="sub" style={{ display: 'block' }}>{subtitle}</span>}
      </span>
      <ChevronRight size={18} className="chev" />
    </motion.button>
  );
}
```

- [ ] **Step 4: `CoachConnectSheet.jsx`** — move the two blocks out of today's `SettingsSheet.jsx` **verbatim** (ids `device-token` and `apikey`, names, `type="password"`, `autoComplete`, helper copy). Shape:

```jsx
import { useState, useEffect } from 'react';
import { Check } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { getKey, setKey, subscribe } from '../../sessionKey.js';
import { hasProxy, getDeviceToken, setDeviceToken, subscribe as subscribeToken } from '../../proxyConfig.js';
import SubSheet from './SubSheet.jsx';

export default function CoachConnectSheet({ onClose }) {
  const { readOnly } = useApp();
  const [apiKey, setApiKey] = useState(getKey);
  useEffect(() => subscribe(setApiKey), []);
  const [deviceToken, setTokenField] = useState(getDeviceToken);
  useEffect(() => subscribeToken(setTokenField), []);
  const proxyOn = hasProxy();
  const connected = Boolean(deviceToken.trim());

  return (
    <SubSheet label="Coach connection" subtitle="How the coach reaches Claude" onClose={onClose}>
      {proxyOn && ( /* the device-token block, verbatim from SettingsSheet */ )}
      {/* the API-key block, verbatim: label text stays "Claude API key (for the coach)" or the proxy variant */}
    </SubSheet>
  );
}
```

Copy the JSX exactly; the key field's label must still match `/api key/i` and be `disabled={readOnly}`.

- [ ] **Step 5: `AttemptsSheet.jsx`**

```jsx
import { useState } from 'react';
import { motion } from 'framer-motion';
import { History } from 'lucide-react';
import { useApp } from '../../state.jsx';
import { isLogged, dateForDayNumber, asOfDay, dayNumberFor } from '../../store.js';
import { stageForDay } from '../../plan.js';
import { asText } from '../../text.js';
import SubSheet from './SubSheet.jsx';

const fmtShort = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const loggedDaysIn = (attempt, upToN = attempt.plan.totalDays) => {
  let n = 0;
  for (let i = 1; i <= Math.min(upToN, attempt.plan.totalDays); i++) if (isLogged(attempt, dateForDayNumber(attempt, i))) n++;
  return n;
};

export default function AttemptsSheet({ onClose }) {
  const { state, root, api, readOnly } = useApp();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const past = root.attempts.filter((a) => a.id !== state.id && a.status === 'archived');
  const exitTo = root.activeAttemptId ? 'get back to your current attempt' : 'start a new one';
  const note = readOnly
    ? past.length > 0
      ? `You're viewing a past attempt, read-only. Open another below, or exit at the top to ${exitTo}.`
      : `You're viewing a past attempt, read-only. Exit at the top to ${exitTo}.`
    : past.length > 0
      ? 'Nothing is ever deleted. Open one to look back at it.'
      : 'This is your first attempt. Past ones show up here once you start a new one.';
  const asOfN = Math.min(Math.max(dayNumberFor(state, asOfDay(state)), 0), state.plan.totalDays);
  const stage = asOfN >= 1 ? stageForDay(state.plan, asOfN) : null;

  return (
    <SubSheet label="Attempts" onClose={onClose}>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="tiny muted">{readOnly ? 'Viewing' : 'Current'}</div>
        <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>Attempt {state.id.slice(1)}</div>
        <div className="small muted num" style={{ marginTop: 2 }}>
          {fmtShort(state.plan.startDate)} → {fmtShort(state.plan.quitDate)} · {asOfN >= 1 ? `day ${asOfN} of ${state.plan.totalDays}` : 'not started yet'}
          {stage ? ` · ${asText(stage.name)}` : ''}
        </div>
        {asOfN >= 1 && <div className="small faint num" style={{ marginTop: 2 }}>{loggedDaysIn(state, asOfN)} of {asOfN} days logged so far</div>}
      </div>

      <div className="section-head">Past attempts</div>
      <p className="small muted" style={{ margin: 0 }}>{note}</p>
      {past.map((a) => (
        <motion.button key={a.id} className="btn" style={{ width: '100%', marginTop: 8, justifyContent: 'flex-start', minHeight: 52 }} whileTap={{ scale: 0.98 }} onClick={() => { api.viewAttempt(a.id); onClose(); }}>
          <History size={16} />
          <span style={{ textAlign: 'left' }}>
            Attempt {a.id.slice(1)}
            <span className="small faint" style={{ display: 'block', fontWeight: 400 }}>
              {fmtShort(a.plan.startDate)} – {fmtShort(a.plan.quitDate)} · {loggedDaysIn(a)} of {a.plan.totalDays} days logged
            </span>
          </span>
        </motion.button>
      ))}

      {!readOnly && (
        <div className="danger-zone">
          <div className="section-head">Danger zone</div>
          {confirmEnd ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <p className="small" style={{ margin: 0 }}>Your history stays, read-only. You can't reopen this attempt. Next, you'll set up a new plan.</p>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { api.archiveActive(); onClose(); }}>End attempt</button>
                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirmEnd(false)}>Keep going</button>
              </div>
            </motion.div>
          ) : (
            <>
              <button className="btn btn-danger" style={{ width: '100%' }} onClick={() => setConfirmEnd(true)}>End this attempt and start over</button>
              <p className="small faint" style={{ margin: '8px 0 0' }}>Asks you to confirm first. Nothing is deleted.</p>
            </>
          )}
        </div>
      )}
    </SubSheet>
  );
}
```

Note: `onClose` of AttemptsSheet must close **both** sheets when it opens a past attempt or ends the attempt — Task 6 passes `onClose` accordingly (`closeAll`).

- [ ] **Step 6: Commit** (no test yet beyond lint; the sheet is exercised by the walks in Task 6)

```bash
git add src/index.css src/components/settings/
git commit -m "Settings sub-sheets: coach connection and attempts, each behind one row

The two heavy, rarely-touched parts of Settings get a sheet of their own,
stacked over Settings the way the trophy detail stacks over the case. The
token and key fields move verbatim — same ids, same password fields, same
copy, still nothing at rest. Ending an attempt now lives at the bottom of the
Attempts sheet inside a red danger zone, with its confirm step intact."
```

---

## Task 6: Settings — the grouped sheet + walk edits

**Files:**
- Rewrite: `src/components/SettingsSheet.jsx`
- Modify: `src/App.jsx`, `src/components/CoachSheet.jsx`, `src/components/onboarding/steps.jsx`
- Modify walks: `scripts/e2e/walk-migration.mjs`, `scripts/e2e/walk-backfill.mjs`

**Selector contract (must hold after this task):** `button[aria-label="Settings"]` opens it · dialog `[role="dialog"]` containing text "Settings" · in the viewer: no "Simulate import", no "This is your first attempt" *in the main sheet*, every `input` in the main sheet disabled, a `Done` button · the key field (label `/api key/i`) exists **in the Coach connection dialog** and is disabled in the viewer · `button[name=/^Attempt 1\b/]` exists **in the Attempts dialog**.

- [ ] **Step 1: Rewrite `SettingsSheet.jsx`**

```jsx
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCopy, Check, Download, Sparkles, Bot, Flag } from 'lucide-react';
import { useApp } from '../state.jsx';
import { markdownSummary, fullBackup, todayKey, asOfDay, dayNumberFor } from '../store.js';
import { moneyStats } from '../money.js';
import { getKey, subscribe as subscribeKey } from '../sessionKey.js';
import { hasProxy, getDeviceToken, subscribe as subscribeToken, coachStatus } from '../proxyConfig.js';
import { getLastBackup, setLastBackup, subscribe as subscribeBackup } from '../lastBackup.js';
import PriceHelpSheet from './onboarding/PriceHelpSheet.jsx';
import SettingsRow from './settings/SettingsRow.jsx';
import CoachConnectSheet from './settings/CoachConnectSheet.jsx';
import AttemptsSheet from './settings/AttemptsSheet.jsx';

const fmtShort = (dateStr) => new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const COACH_COPY = {
  proxy: { title: 'Connected via your proxy', sub: 'Nothing to enter next time', dot: 'on' },
  key: { title: 'Key held for this session', sub: 'Cleared when the tab closes; your password manager refills it', dot: 'session' },
  none: { title: 'Not connected', sub: 'Add a key — or a device token if you run a proxy', dot: '' },
};

// `open` lets a caller land on a sub-sheet directly ('coach' from the coach's
// own "Open Settings" button).
export default function SettingsSheet({ onClose, open = null }) {
  const { state, root, api, readOnly } = useApp();
  const s = state.settings;
  const [sub, setSub] = useState(open); // null | 'coach' | 'attempts'
  const [apiKey, setApiKey] = useState(getKey);
  useEffect(() => subscribeKey(setApiKey), []);
  const [deviceToken, setToken] = useState(getDeviceToken);
  useEffect(() => subscribeToken(setToken), []);
  const [lastBackup, setLast] = useState(getLastBackup);
  useEffect(() => subscribeBackup(setLast), []);
  const status = coachStatus({ proxyOn: hasProxy(), hasToken: Boolean(deviceToken.trim()), hasKey: Boolean(apiKey.trim()) });
  const [copied, setCopied] = useState(false);
  const [backedUp, setBackedUp] = useState(null);
  const [priceHelp, setPriceHelp] = useState(false);
  const [drafts, setDrafts] = useState({});

  const pastCount = root.attempts.filter((a) => a.id !== state.id && a.status === 'archived').length;
  const asOfN = dayNumberFor(state, asOfDay(state));
  const attemptTitle = readOnly ? `Viewing Attempt ${state.id.slice(1)} · read-only` : `Attempt ${state.id.slice(1)} · ${asOfN >= 1 ? `day ${Math.min(asOfN, state.plan.totalDays)} of ${state.plan.totalDays}` : `starts ${fmtShort(state.plan.startDate)}`}`;
  const attemptSub = readOnly ? 'Exit at the top to leave the viewer' : pastCount ? `${pastCount} past attempt${pastCount === 1 ? '' : 's'}` : 'Your first attempt';

  const numberField = (key, min) => ({ /* unchanged from today */ });
  const setMeal = (meal, value) => api.updateSettings({ mealTimes: { ...s.mealTimes, [meal]: value } });
  const copyExport = async () => { /* unchanged */ };
  const downloadBackup = async () => { /* unchanged, plus: */ };
  // inside downloadBackup, at both success points (`confirm('shared')` and `confirm('copied')`), add: setLastBackup(todayKey());

  const closeAll = () => { setSub(null); onClose(); };

  return (
    <>
      <motion.div className="sheet-backdrop" … onClick={onClose} />
      <motion.div className="sheet" … role="dialog" aria-label="Settings">
        <div className="sheet-handle" />
        <h3 style={{ fontSize: 16, marginBottom: 0 }}>Settings</h3>

        <div className="section-head">Routine</div>
        {/* the meal grid, verbatim, then: */}
        <p className="small faint" style={{ margin: '6px 0 0' }}>Slot times follow your meals — pouch slots unlock 15 minutes after.</p>
        <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <label htmlFor="wake">wake</label>
            <input id="wake" type="time" disabled={readOnly} value={s.wakeTime ?? ''} onChange={(e) => api.updateSettings({ wakeTime: e.target.value })} />
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="sleep">sleep</label>
            <input id="sleep" type="time" disabled={readOnly} value={s.sleepTime ?? ''} onChange={(e) => api.updateSettings({ sleepTime: e.target.value })} />
          </div>
        </div>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Used when a plan is built — sleep sets where the evening pouches land, and your next attempt starts from these. Your current plan's slots don't move.
        </p>

        <div className="section-head">Money</div>
        {/* cost / pouches per tin row + "Not sure? Work it out", verbatim */}

        <div className="section-head">Coach</div>
        <SettingsRow
          ariaLabel="Coach connection"
          icon={<span className={`status-dot ${COACH_COPY[status].dot}`} aria-hidden="true" />}
          title={COACH_COPY[status].title}
          subtitle={COACH_COPY[status].sub}
          onClick={() => setSub('coach')}
        />

        <div className="section-head">Attempt</div>
        <SettingsRow ariaLabel="Attempts" icon={<Flag size={16} color="var(--accent-bright)" />} title={attemptTitle} subtitle={attemptSub} onClick={() => setSub('attempts')} />

        <div className="section-head">Your data</div>
        <motion.button className="btn" style={{ width: '100%' }} whileTap={{ scale: 0.98 }} onClick={downloadBackup}>
          {/* unchanged backup button contents */}
        </motion.button>
        <p className="small faint" style={{ margin: '6px 0 0' }}>
          Every log, trigger, and check-in as one JSON file. Save it somewhere safe — Files, AirDrop, or email. Your API key is left out.
          {' '}{lastBackup ? `Last backup from this phone: ${fmtShort(lastBackup)}.` : 'No backup from this phone yet.'}
        </p>
        <motion.button className="btn btn-ghost" style={{ width: '100%', marginTop: 12 }} whileTap={{ scale: 0.98 }} onClick={copyExport}>
          {/* unchanged copy button contents */}
        </motion.button>
        <p className="small faint" style={{ margin: '6px 0 0' }}>Plain Markdown — paste it into your notes app or a Claude chat for a weekly review.</p>

        <div className="section-head">About</div>
        <p className="small faint num" style={{ margin: 0 }}>
          Pouch Down · build {import.meta.env.VITE_BUILD ?? 'dev'} · Your log stays on this phone unless you ask the coach.
        </p>

        <button className="btn btn-ghost" style={{ width: '100%', marginTop: 20 }} onClick={onClose}>Done</button>
      </motion.div>

      <AnimatePresence>
        {priceHelp && <PriceHelpSheet key="price-help" … />}
        {sub === 'coach' && <CoachConnectSheet key="coach" onClose={() => setSub(null)} />}
        {sub === 'attempts' && <AttemptsSheet key="attempts" onClose={closeAll} />}
      </AnimatePresence>
    </>
  );
}
```

`AttemptsSheet`'s `onClose` is `closeAll` because both of its actions (view a past attempt, end the attempt) leave Settings entirely; the sheet's own Done/X also close everything, which is acceptable (Settings was only a corridor). Remove the now-unused imports (`History`, `isLogged`, `dateForDayNumber`, `setKey`, `setDeviceToken`).

- [ ] **Step 2: `App.jsx`** — the sheet state carries the sub-sheet:

```jsx
// sheet: null | 'coach' | 'trophies' | { kind: 'settings', open } | { kind: 'fix', day }
const openSettings = (open = null) => setSheet({ kind: 'settings', open });
// pass openSettings={openSettings} to <View> and to <CoachSheet openSettings={() => openSettings('coach')} />
// header gear: onClick={() => openSettings()}
{sheet?.kind === 'settings' && <SettingsSheet key="settings" open={sheet.open} onClose={() => setSheet(null)} />}
```

`MoneyCard`'s `onOpenSettings` keeps calling `openSettings()` with no argument.

- [ ] **Step 3: `steps.jsx`** helper copy (screen with wake/sleep):

```
Sleep time sets where the evening pouches land when the plan is built. Rough times are fine — you can change meal times later in Settings.
```

- [ ] **Step 4: Walk edits**

`walk-migration.mjs` (Settings block, ~L485–510): after the two "no …" text checks, replace the key check with:

```js
      // The key field now lives one tap deeper, on the Coach connection sheet
      // (design pass, 2026-09-28): open it, check there, close it.
      await sheet.getByRole('button', { name: /^coach connection$/i }).first().click();
      const coach = page.locator('[role="dialog"][aria-label="Coach connection"]');
      rec.check(L('Settings: Coach connection opens'), await visible(coach, 3000));
      const key = coach.getByLabel(/api key/i);
      const keyN = await key.count();
      const keyOff = keyN > 0 && (await key.first().isDisabled());
      rec.check(L('Settings: the API key field is disabled'), keyOff, keyOff ? '' : keyN ? 'field is editable' : 'no key field found');
      const coachInputs = await coach.locator('input').evaluateAll((els) => els.filter((e) => !e.disabled).map((e) => e.id || e.type));
      rec.check(L('Coach connection: every field disabled in the viewer'), coachInputs.length === 0, coachInputs.join(', '));
      await coach.getByRole('button', { name: /^done$/i }).first().click();
      await page.waitForTimeout(400);
```

Keep the existing "every edit field disabled" check on the main `sheet` (it now covers meals, wake, sleep, cost, pouches). The optional `attempts` snapshot: change `sheet.getByText(/^attempts$/i)` to `sheet.getByRole('button', { name: /^attempts$/i })` and, if visible, click it, snap the Attempts dialog, and close it with its Done.

`walk-backfill.mjs` (~L842–847): between opening Settings and locating the Attempt 1 row, add:

```js
    // Past attempts moved to the Attempts sheet (design pass, 2026-09-28).
    await page.getByRole('button', { name: 'Attempts', exact: true }).first().click();
    await page.waitForTimeout(500);
```

- [ ] **Step 5: Run `npm test`, `npm run lint`, then the two walks**

```bash
npm run e2e -- --only migration
npm run e2e -- --only backfill
```

Expected: both PASS with 0 console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsSheet.jsx src/App.jsx src/components/CoachSheet.jsx src/components/onboarding/steps.jsx scripts/e2e/walk-migration.mjs scripts/e2e/walk-backfill.mjs
git commit -m "Settings reads as six sections instead of one scroll

Routine (meals, and wake/sleep at last, labelled for what they really do:
they are read when a plan is built, and the current plan's slots don't
move), Money, Coach (one row that IS the status, opening the connection
sheet), Attempt (one row opening the attempts sheet, where ending an attempt
lives in a danger zone), Your data (backup first, with the day this phone
last sent one), About (build id and the privacy line). The coach's own
'Open Settings' lands straight on the connection sheet.

Walks: migration opens the Coach connection sheet before checking the key
field is disabled, and backfill opens the Attempts sheet before choosing
Attempt 1 — both moved one tap deeper on purpose."
```

---

## Task 7: Trophy strip

**Files:**
- Modify: `src/components/awards/TrophyCase.jsx` (append `stripPicks`, `TrophyStrip`)
- Test: `src/__tests__/trophyStrip.test.js`

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest';
import { stripPicks } from '../components/awards/TrophyCase.jsx';

const a = (id, earned, extra = {}) => ({ id, title: id, tier: 'bronze', earned, progress: 0, earnedOn: null, ...extra });

describe('stripPicks', () => {
  it('earned first, newest first, then the closest locked, up to max', () => {
    const awards = [
      a('old', true, { earnedOn: '2026-09-22' }), a('new', true, { earnedOn: '2026-09-25' }),
      a('far', false, { progress: 0.1 }), a('near', false, { progress: 0.8 }), a('mid', false, { progress: 0.5 }),
    ];
    const { shown, more } = stripPicks(awards, 4);
    expect(shown.map((x) => x.id)).toEqual(['new', 'old', 'near', 'mid']);
    expect(more).toBe(1);
  });
  it('an earned award with no date sorts after dated ones, never crashes', () => {
    const { shown } = stripPicks([a('undated', true), a('dated', true, { earnedOn: '2026-09-01' })], 6);
    expect(shown.map((x) => x.id)).toEqual(['dated', 'undated']);
  });
  it('fewer awards than max means nothing more', () => {
    expect(stripPicks([a('x', false)], 6)).toEqual({ shown: [a('x', false)], more: 0 });
  });
});
```

- [ ] **Step 2: Implement** (append to `TrophyCase.jsx`)

```jsx
/* ----------------------------------------------------------- the strip */

// The handful of seals worth a glance on Stats: what you've earned, newest
// first, then the locked ones you're closest to. Pure, so the choice is
// testable; the sheet shows everything.
export function stripPicks(awards, max = 6) {
  const earned = awards.filter((a) => a.earned).sort((x, y) => String(y.earnedOn ?? '').localeCompare(String(x.earnedOn ?? '')));
  const locked = awards.filter((a) => !a.earned).sort((x, y) => (y.progress ?? 0) - (x.progress ?? 0));
  const all = [...earned, ...locked];
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

// One card, one row of seals, one tap into the case. Keeps "Trophy case" and
// "N of M" in its text and the intro line, which is what the awards walk reads.
export function TrophyStrip({ onOpen }) {
  const { state, readOnly, awards, earned, total } = useAwards();
  if (!state) return null;
  const { shown, more } = stripPicks(awards, 6);
  return (
    <motion.button
      type="button"
      className="card"
      onClick={onOpen}
      aria-label={`Trophy case: ${earned} of ${total} earned. Open the trophy case.`}
      whileTap={{ scale: 0.99 }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      style={{ width: '100%', marginTop: 14, display: 'block', textAlign: 'left' }}
    >
      <div className="spread">
        <span className="tiny muted">Trophy case</span>
        <span className="row tiny faint num" style={{ gap: 4 }}>{earned} of {total} <ChevronRight size={14} /></span>
      </div>
      <div className="row" style={{ gap: 10, marginTop: 12, overflow: 'hidden' }}>
        {shown.map((award, i) => (
          <motion.span key={award.id} initial={{ opacity: 0, scale: 0.84 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...tileSpring, delay: tileDelay(i) }} style={{ flexShrink: 0 }}>
            <Badge award={award} size={40} showRing />
          </motion.span>
        ))}
        {more > 0 && <span className="small faint num" style={{ flexShrink: 0 }}>+{more}</span>}
      </div>
      <p className="small muted" style={{ margin: '10px 0 0' }}>{introLine(earned, total, readOnly)}</p>
    </motion.button>
  );
}
```

Add `ChevronRight` to the lucide import. Check `Badge` accepts `size={40}` (it takes a number; verify in `Badge.jsx` that nothing assumes ≥56).

- [ ] **Step 3: `npm test`** green. **Commit:**

```bash
git add src/components/awards/TrophyCase.jsx src/__tests__/trophyStrip.test.js
git commit -m "Trophy strip: six seals and a door, for a Stats page that isn't a trophy wall

The full case (every tier, every seal) was a third of the Stats scroll while
an identical sheet already existed one tap away. The strip shows what's
earned, newest first, then the closest locked ones, and opens that sheet.
stripPicks is pure and tested; the strip keeps the words the walk reads."
```

---

## Task 8: Stats segment control + sections + walk edits

**Files:**
- Modify: `src/components/StatsView.jsx`, `src/components/HistoryTimeline.jsx`, `src/index.css`
- Modify walks: `scripts/e2e/walk-awards.mjs`, `walk-migration.mjs`, `walk-fixday.mjs`

**Selector contract:** Stats tab button `Stats` · a `.card` containing "Trophy case" and "N of M" (now the strip) · tapping it opens `[role="dialog"][aria-label="Trophy case"]` · the "pouches not used" tile and the "of N days logged" tile on Overview · a `role="tab"` named `History` · inside History: `.card` with text `History`, `button[aria-expanded]` rows starting `Day N`, ending `· used/cap` or `· no log`, "Show all N days", and pencils `Fix Day N, Mon D`.

- [ ] **Step 1: CSS** (append)

```css
/* ---- segment control ---- */
.seg { display: flex; padding: 3px; gap: 2px; border-radius: 14px; background: var(--surface); border: 1px solid var(--border); margin: 0 0 14px; }
.seg-item { position: relative; flex: 1; min-height: 40px; border-radius: 11px; font-size: 14px; font-weight: 600; color: var(--fg-muted); }
.seg-item[aria-selected="true"] { color: var(--fg); }
.seg-pill { position: absolute; inset: 0; border-radius: 11px; background: var(--surface-strong); border: 1px solid var(--border-strong); z-index: -1; }
```

- [ ] **Step 2: `StatsView.jsx`** — replace the body of the default export's return:

```jsx
import { useState } from 'react';
import { TrophyStrip } from './awards/TrophyCase.jsx';
// (remove the MoneyCard and TrophyCase imports)

const SEGMENTS = [{ id: 'overview', label: 'Overview' }, { id: 'history', label: 'History' }];

function Segments({ value, onChange }) {
  return (
    <div className="seg" role="tablist" aria-label="Stats sections">
      {SEGMENTS.map((s) => (
        <button key={s.id} type="button" role="tab" id={`stats-tab-${s.id}`} aria-selected={value === s.id} aria-controls={`stats-panel-${s.id}`} className="seg-item" onClick={() => onChange(s.id)}>
          {value === s.id && <motion.span className="seg-pill" layoutId="stats-seg-pill" transition={{ type: 'spring', damping: 28, stiffness: 320 }} />}
          {s.label}
        </button>
      ))}
    </div>
  );
}

const SectionHead = ({ children }) => <div className="section-head">{children}</div>;

export default function StatsView({ openTrophies, onFixDay }) {
  const [seg, setSeg] = useState('overview');
  // … the existing derived numbers stay exactly as they are …
  return (
    <div>
      <h2 style={{ fontSize: 20, margin: '4px 0 12px' }}>The story so far</h2>
      <Segments value={seg} onChange={setSeg} />

      {seg === 'overview' ? (
        <div role="tabpanel" id="stats-panel-overview" aria-labelledby="stats-tab-overview">
          {/* mg chart card — unchanged */}
          {/* the two tiles row — unchanged */}
          <TrophyStrip onOpen={openTrophies} />
          <SectionHead>Timing</SectionHead>
          <DisciplineCard />
          <FirstPouchChart />
          <RhythmChart />
          <GapsCard />
          <SectionHead>Body</SectionHead>
          <CorrelationCard />
          <SectionHead>Triggers</SectionHead>
          <motion.div className="card" …>{/* unchanged trigger bars card, marginTop 0 */}</motion.div>
        </div>
      ) : (
        <div role="tabpanel" id="stats-panel-history" aria-labelledby="stats-tab-history">
          <HistoryTimeline onFixDay={onFixDay} />
        </div>
      )}
    </div>
  );
}
```

`openSettings` is no longer needed by StatsView (the Money card left); `App.jsx` can keep passing it. Check each chart card's own `marginTop: 14` still stacks correctly under a `.section-head` (they do; the head has its own margins).

- [ ] **Step 3: `HistoryTimeline.jsx`** — weekday in the row header. Add:

```js
const fmtDay = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
};
```

and in the row header use `` ` · ${fmtDay(dateStr)} · ` `` in place of `fmtShort(dateStr)`. The pencil's `aria-label` keeps `fmtShort` (the fixday walk matches `Fix Day 2, Sep 23`). The card's first `marginTop: 14` becomes `0` under the segment control.

- [ ] **Step 4: Walk edits**

`walk-awards.mjs` (~L521–556): replace the case-card block:

```js
  // The full case left Stats for a strip (design pass, 2026-09-28). The
  // strip keeps the words; the tier sections are checked in the sheet it opens.
  const strip = T.page.locator('.card').filter({ hasText: 'Trophy case' }).last();
  const strips = await T.page.locator('.card').filter({ hasText: 'Trophy case' }).count();
  if (!check('Trophy strip card exists in Stats', (await strip.count()) === 1, `${strips} found`)) {
    await snap(T.page, 'FAIL-stats-no-trophy-strip');
  }
  if (await strip.count()) {
    await strip.scrollIntoViewIfNeeded();
    await T.page.waitForTimeout(700);
    await snap(strip, 'stats-trophy-strip');
    const stripText = await strip.innerText();
    check('Strip shows an "N of M" count', /\d+ of \d+/.test(stripText), stripText.split('\n')[0]);
    const box = await strip.boundingBox();
    check('Strip is a strip, not a wall (under 220px tall)', (box?.height ?? 999) < 220, `${Math.round(box?.height ?? 0)}px`);
    await strip.click();
    await T.page.waitForTimeout(700);
    const caseSheet = T.page.locator('[role="dialog"][aria-label="Trophy case"]');
    check('Strip opens the trophy case sheet', (await caseSheet.count()) === 1);
    if (await caseSheet.count()) {
      const caseText = await caseSheet.innerText();
      for (const tier of ['Bronze', 'Silver', 'Gold', 'Aurora']) check(`Tier section rendered · ${tier}`, new RegExp(tier, 'i').test(caseText));
      const counts = caseText.match(/\d+ of \d+/gi) ?? [];
      check('Each tier section shows an "N of M" count', counts.length >= 5, counts.join(' | '));
      await overflowCheck(T.page, 'trophy case sheet from stats');
      await T.page.getByRole('button', { name: 'Done', exact: true }).first().click();
      await T.page.waitForTimeout(600);
    }
  }
```

Flow 5 (~L782–792): rename `roCase` → `roStrip` in spirit; the checks (`.card` with "Trophy case", "It stands as it is", "N of M") hold unchanged because the strip carries the intro line. Update the check label to "Trophy strip renders in the archived attempt".

`walk-migration.mjs` (~L398, before `const history = …`): add

```js
    // History is the second segment of Stats now (design pass, 2026-09-28).
    await page.getByRole('tab', { name: /^history$/i }).click();
    await page.waitForTimeout(450);
```

`walk-fixday.mjs`: change the `tab` helper's callers for Stats — add a helper and use it at both Stats visits (~L359 and ~L469), and inside `historyRows` if it navigates:

```js
async function openHistory(page) {
  await tab(page, 'Stats');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.waitForTimeout(450);
}
```

- [ ] **Step 5: Run** `npm test`, `npm run lint`, then `npm run e2e -- --only awards`, `-- --only migration`, `-- --only fixday`. Expected: PASS, 0 console errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/StatsView.jsx src/components/HistoryTimeline.jsx src/index.css scripts/e2e/walk-awards.mjs scripts/e2e/walk-migration.mjs scripts/e2e/walk-fixday.mjs
git commit -m "Stats: Overview and History as two segments, charts in named sections

One 4,000px pile becomes two views over the same data. Overview: the
descent chart, the tiles, the trophy strip, then Timing / Body / Triggers.
History: the day list with the Fix-this-day pencils, one tap away instead of
seven cards down, each row now naming its weekday. The Money card leaves
Stats — it lives on Today.

Walks: awards checks the tier sections in the sheet the strip opens;
migration and fixday click the History segment first."
```

---

## Task 9: Calendar month sections

**Files:**
- Create: `src/calendarMonths.js`, `src/__tests__/calendarMonths.test.js`
- Modify: `src/components/CalendarView.jsx`, `src/index.css`

**Selector contract:** every day cell has `aria-label` starting `Day N, Mon D: ` and either `no log` or `U of C pouches`; class `cal-nolog` on gray days, `cal-yellow` on over days; cell text contains `U/C`.

- [ ] **Step 1: Test**

```js
import { describe, it, expect } from 'vitest';
import { monthsFor } from '../calendarMonths.js';
import { generatePlan } from '../planGenerator.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, sleepTime: '23:00', pouchesPerTin: 20 };
const plan = generatePlan({ pouchesPerDay: 10, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-22', ...settings });
const ev = (id, day, type, extra = {}) => ({ id, ts: `${day}T15:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const state = {
  id: 'a2', status: 'active', archivedAt: null, settings, plan, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null,
  events: [
    ev('p1', '2026-09-22', 'pouch'), ev('c1', '2026-09-22', 'correction', { day: '2026-09-22', count: 3 }),
    ev('b1', '2026-09-23', 'backfill', { day: '2026-09-23', count: 2, streak: 'keep' }),
  ],
};

describe('monthsFor', () => {
  const months = monthsFor(state);
  it('splits a Sep 22 → Dec 20 plan into four months with the right plan-day ranges', () => {
    expect(months.map((m) => [m.label, ...m.dayRange])).toEqual([
      ['September', 1, 9], ['October', 10, 40], ['November', 41, 70], ['December', 71, 90],
    ]);
  });
  it('each month leads with blanks for the weekday its first plan day falls on', () => {
    expect(months[0].lead).toBe(2); // Tue Sep 22
    expect(months[1].lead).toBe(4); // Thu Oct 1
  });
  it('cells carry the day of month, status, count, cap, and the marks', () => {
    const [d1, d2] = months[0].cells;
    expect(d1).toMatchObject({ n: 1, d: '2026-09-22', dom: 22, cap: 10, corrected: true, backfilled: false });
    expect(d2).toMatchObject({ n: 2, d: '2026-09-23', dom: 23, corrected: false, backfilled: true });
  });
  it('labels a month with its year only when the plan crosses into a new one', () => {
    const late = { ...state, plan: generatePlan({ pouchesPerDay: 10, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-11-20', ...settings }) };
    expect(monthsFor(late).map((m) => m.label)).toEqual(['November', 'December', 'January 2027', 'February 2027']);
  });
});
```

- [ ] **Step 2: Implement `src/calendarMonths.js`**

```js
// The plan's days, grouped by calendar month for the Calendar tab. Pure: it
// reads the attempt and returns plain data, so the grouping is testable and
// the component only draws.
import { dateForDayNumber, statusForDay, pouchesForDay, correctionForDay, eventsForDay } from './store.js';
import { capForDay } from './plan.js';

const at = (iso) => new Date(`${iso}T12:00:00`); // noon: the date can't drift with the zone

export function monthsFor(state) {
  const { totalDays } = state.plan;
  const startYear = at(dateForDayNumber(state, 1)).getFullYear();
  const months = [];
  for (let n = 1; n <= totalDays; n++) {
    const d = dateForDayNumber(state, n);
    const date = at(d);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    let month = months.at(-1);
    if (!month || month.key !== key) {
      const name = date.toLocaleDateString('en-US', { month: 'long' });
      month = {
        key,
        label: date.getFullYear() === startYear ? name : `${name} ${date.getFullYear()}`,
        dayRange: [n, n],
        lead: date.getDay(), // blanks before the first plan day of this month
        cells: [],
      };
      months.push(month);
    }
    month.dayRange[1] = n;
    month.cells.push({
      n, d, dom: date.getDate(),
      status: statusForDay(state, d),
      used: pouchesForDay(state, d),
      cap: capForDay(state.plan, n),
      corrected: correctionForDay(state, d) != null,
      backfilled: eventsForDay(state, d).some((e) => e.type === 'backfill'),
    });
  }
  return months;
}
```

- [ ] **Step 3: CSS** (append to the calendar block)

```css
.cal-month { display: flex; align-items: baseline; justify-content: space-between; margin: 18px 0 6px; }
.cal-month:first-of-type { margin-top: 4px; }
.cal-month b { font-size: 15px; letter-spacing: -0.01em; }
.cal-cell .mark { position: absolute; top: 3px; right: 4px; color: var(--fg-muted); line-height: 0; }
.cal-cell.cal-green .mark, .cal-cell.cal-yellow .mark { color: inherit; opacity: 0.8; }
```

- [ ] **Step 4: `CalendarView.jsx`** — render from `monthsFor`:

```jsx
import { PencilLine, RotateCcw, Star } from 'lucide-react';
import { monthsFor } from '../calendarMonths.js';
// …
const months = monthsFor(state);
const all = months.flatMap((m) => m.cells);
const greens = all.filter((c) => c.status === 'green').length; // etc. for yellows, nologs
const tappable = (c) => !!onFixDay && !readOnly && c.status !== 'future' && c.status !== 'pre';
let i = 0; // running index for the entrance stagger
return (
  <div>
    <h2 …>The {totalDays} days</h2>
    <p className="small muted" …>{fmtLong(startDate)} → {fmtLong(quitDate)} · Every logged day counts. Gray means no log.</p>
    {months.map((m) => (
      <section key={m.key} aria-label={`${m.label}, days ${m.dayRange[0]} to ${m.dayRange[1]}`}>
        <div className="cal-month"><b>{m.label}</b><span className="tiny faint num">days {m.dayRange[0]}–{m.dayRange[1]}</span></div>
        <div className="cal-grid" style={{ marginBottom: 8 }}>{WEEKDAYS.map((w, k) => <div key={k} className="tiny faint" style={{ textAlign: 'center' }}>{w}</div>)}</div>
        <div className="cal-grid">
          {Array.from({ length: m.lead }, (_, k) => <div key={`b${k}`} />)}
          {m.cells.map((c) => {
            const Cell = tappable(c) ? motion.button : motion.div;
            const marks = [c.corrected && 'corrected', c.backfilled && 'backfilled'].filter(Boolean);
            const idx = i++;
            return (
              <Cell
                {...(tappable(c) ? { type: 'button', onClick: () => onFixDay(c.d) } : {})}
                key={c.d}
                className={[ /* same classes as today */ ].filter(Boolean).join(' ')}
                initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 20, stiffness: 260, delay: Math.min(idx, 40) * 0.012 }}
                aria-label={`Day ${c.n}, ${fmtShort(c.d)}: ${c.status === 'nolog' ? 'no log' : `${c.used} of ${c.cap} pouches`}${marks.length ? `, ${marks.join(', ')}` : ''}`}
              >
                {c.n === totalDays ? <Star size={16} color="var(--accent-bright)" fill="var(--accent-bright)" /> : <span className="num">{c.dom}</span>}
                <span className="cap num">{c.status === 'nolog' ? 'no log' : (c.d <= today ? `${c.used}/${c.cap}` : c.cap)}</span>
                {c.corrected && <span className="mark" aria-hidden="true"><PencilLine size={9} /></span>}
                {!c.corrected && c.backfilled && <span className="mark" aria-hidden="true"><RotateCcw size={9} /></span>}
              </Cell>
            );
          })}
        </div>
      </section>
    ))}
    {/* legend: the three existing entries + */}
    <span className="row small muted" style={{ gap: 6 }}><PencilLine size={12} /> corrected</span>
    <span className="row small muted" style={{ gap: 6 }}><RotateCcw size={12} /> backfilled</span>
    <span className="row small muted" style={{ gap: 6 }}><Star size={12} color="var(--accent-bright)" /> quit day</span>
  </div>
);
```

Cap the stagger at index 40 so a 90-day plan doesn't wait 1.3s for December; `?static` still freezes it.

- [ ] **Step 5: Run** `npm test`, then `npm run e2e -- --only backfill` and `-- --only fixday` (both read calendar cells). Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/calendarMonths.js src/__tests__/calendarMonths.test.js src/components/CalendarView.jsx src/index.css
git commit -m "Calendar: months you can read, dates in the cells, marks on corrected days

The grid showed plan-day numbers and no dates; James thinks in 'Thursday,
Sep 24'. Each month is now its own block with a header and weekday row, the
date is the big number, the plan-day range sits in the header, and a day
you corrected or backfilled wears a small pencil or rotate mark — spoken in
the label too. monthsFor is pure and tested; cells keep their classes, tap
target and aria contract, so the walks read them unchanged."
```

---

## Task 10: Today — SOS under the ring

**Files:**
- Modify: `src/components/TodayView.jsx`

- [ ] **Step 1:** Cut the `{!readOnly && (<motion.button … Craving? SOS — ride it out …/>)}` block from below `MoneyCard` and paste it directly after `<LogRing … />` (before the `LogToast` `AnimatePresence`). Change `marginTop: 14` → `marginTop: 10` and `delay: 0.15` → `delay: 0.1`.
- [ ] **Step 2:** `npm test`, then `npm run e2e -- --only migration` (its read-only Today check asserts no SOS in the viewer) and `-- --only awards` (footer-row geometry). Expected PASS.
- [ ] **Step 3: Commit**

```bash
git add src/components/TodayView.jsx
git commit -m "Today: SOS sits under the ring, not under the money

A craving shouldn't need a scroll. The button is unchanged; only its place
is — directly under the log ring, inside the fold on a normal day."
```

---

## Task 11: Gates, screenshots, build log

- [ ] **Step 1:** `npm test` · `npm run lint` (one warning) · `npm run build && rm -rf dist/` · `npm run e2e` (all six, 0 console errors). Record the numbers.
- [ ] **Step 2:** After-screenshots at 390px into the scratchpad (not the repo): Today, Calendar, Stats Overview, Stats History, Settings, Coach connection, Attempts. Use the same harness as the before shots (`scripts/e2e/lib.mjs`: `buildApp` into a scratch dir, `startPreview`, `phoneContext`, seed `pouch-down-v2` from the newest file in `/Users/jxm/jxm-vault/Pouch Down/Backups/`, pin `now` to the backup's last logged evening). **Read every screenshot** and fix what looks wrong before the report.
- [ ] **Step 3:** Write `docs/superpowers/reports/2026-09-2X-design-pass-build-log.md` (educational tone): what changed and why, what reviewers caught, the gates with numbers, the Telegram recipe for James (BotFather → `/newbot` → token; message the bot once; `https://api.telegram.org/bot<token>/getUpdates` → `chat.id`; write `~/.config/pouch-ingest/telegram.env` with `TELEGRAM_BOT_TOKEN=` and `TELEGRAM_CHAT_ID=` (mode 600); add `<key>POUCH_TELEGRAM_ENV</key><string>/Users/jxm/.config/pouch-ingest/telegram.env</string>` to the plist's EnvironmentVariables; `launchctl bootout gui/$(id -u)/com.jxm.pouch-ingest` then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jxm.pouch-ingest.plist`; AirDrop a backup to see the new bot speak), and a "for the next session" list. Commit it.
- [ ] **Step 4:** Give James the merge command and stop. Never push.

---

## Self-review (done while writing)

- **Spec coverage:** Settings §1 → Tasks 4–6 · Stats §2 → Tasks 7–8 · Calendar §3 → Task 9 · Today §4 → Task 10 · fixes §5 → Tasks 1–3 · gates/report → Task 11. `.gitignore` and the spec are already committed (`4c5c10c`).
- **Placeholders:** the "verbatim" moves in Tasks 5–6 refer to blocks quoted in full in today's `SettingsSheet.jsx`; the executor copies from the file, not from memory.
- **Names:** `coachStatus`, `stripPicks`, `TrophyStrip`, `monthsFor`, `asText`, `getLastBackup/setLastBackup`, `SubSheet`, `SettingsRow`, `CoachConnectSheet`, `AttemptsSheet`, `openSettings(open)` are used consistently above. Dialog names: `Settings`, `Coach connection`, `Attempts`, `Trophy case`. Row aria-labels: `Coach connection`, `Attempts`.
