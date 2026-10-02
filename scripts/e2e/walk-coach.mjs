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
//     no Confirm, and writes nothing; a sixth proposal is never drawn; typing
//     while cards are pending skips them, and the typed turn leads with every
//     tool_result (the two invalid ones is_error), then the words;
//   · a card the validator allowed but the api refuses — "mark the 5:00 pouch"
//     after that pouch was undone — reads "Didn't save", writes nothing, and
//     the coach hears it as an is_error result;
//   · every request body the app sends passes the Worker's own checkBody;
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
import { REFUSED } from '../../src/coachActions.js';
import { checkBody } from '../../workers/coach-proxy/src/guard.js';

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
//   after Confirm all (2) + the mistake   today 3/8, 1 resisted, check-in 6.5h · 3/5 · workout
//                                         (the 8:20 AM tap voided; the 1:30 PM card skipped)
//   the "can't do" card, the skipped cards and the refused one write nothing;
//   the 5:00 PM pouch is saved and undone, so it ends as it began.
const PATTERN = { 1: 6, 2: 5, 3: 4, [TODAY_N]: 3 };
const TODAY_COUNTS = [3, 4, 3];
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
const VOID = stampNow('void', { target: TARGET.id });
const CHECKIN = stampNow('checkin', { source: 'manual', sleepHours: 6.5, sleepQuality: 3, workout: true });
const withEvents = (attempt, list) => ({ ...attempt, events: [...attempt.events, ...list] });
const STATES = (a) => [a, withEvents(a, [REASON, POUCH]), withEvents(a, [REASON, POUCH, RESIST, CHECKIN, VOID])];
// What the log holds, appended, once the batch is through: Confirm all writes
// in the cards' order, and the mistake's own tap comes last.
const AFTER_BATCH = ['reason', 'pouch', 'resisted', 'checkin', 'void'];

// The 5:00 PM pouch is saved and then undone; for a moment today reads 5/8.
const POUCH5 = { ...POUCH, id: 'expected-pouch-5', ts: new Date(tsFor(TODAY, '17:00')).toISOString() };

function celebratedFor(attempt) {
  const ids = new Set();
  const all = [...STATES(attempt), withEvents(attempt, [REASON, POUCH, RESIST, CHECKIN, VOID, POUCH5])];
  for (const s of all) for (const a of atNow(() => awardsFor(s))) if (a.earned) ids.add(a.id);
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
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });
const reply = (content, stop = 'end_turn') => ({ id: 'msg_walk', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', stop_reason: stop, content });

const SAY_LATE = 'had one at 4:30 I forgot, boredom';
const SAY_BATCH = 'that first tap today was an accident, I resisted one just now from stress, I slept 6.5 hours, 3 out of 5, and worked out — oh and maybe one at 1:30';
const BATCH_WORDS = 'Four cards: the accidental tap, the craving you beat, the check-in, and the 1:30 one if it happened.';
const BATCH_REPLY = 'All in: the tap is marked, the craving and the check-in are logged. 1:30 stays out.';
const SAY_ODD = 'and mark the one from last week, and add one at 1';
const SAY_NEVERMIND = 'actually never mind';
const SAY_FIVE = 'one more at 5 I forgot';
const REASON_NOTE = 'with friends at lunch';
// The tap the "add a reason" card names — the second of today's.
const REASON_TARGET = TODAY_TAPS[1];

const LATE_SUMMARY = 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom';
const MARK_SUMMARY = `Mark as mistake · the ${fmtTime(TARGET)} pouch on Thu Oct 1`;
const RESIST_SUMMARY = 'Log a craving resisted · stress';
const CHECKIN_SUMMARY = 'Morning check-in · 6.5h · 3/5 · workout';
const ONE_PM_SUMMARY = 'Add a pouch · Thu Oct 1 · 1:00 PM';
const ONE_THIRTY_SUMMARY = 'Add a pouch · Thu Oct 1 · 1:30 PM';
const BORED_SUMMARY = 'Log a craving resisted · boredom';
const REASON_SUMMARY = `Add a reason · ${fmtTime(REASON_TARGET)} pouch · social`;
const NOW_SUMMARY = 'Log a pouch now';
const FIVE_SUMMARY = 'Add a pouch · Thu Oct 1 · 5:00 PM';
const MARK5_SUMMARY = 'Mark as mistake · the 5:00 PM pouch on Thu Oct 1';
const UNDO_REPLY = 'Got it — the 5:00 one is off the log.';
const OVERFLOW_RESULT = 'invalid: more than 5 actions in one reply — ask the user to split them up';

// The 5:00 PM pouch's id is minted by the app at Confirm, so the reply that
// names it reads it from the very prompt the app sent — the list the
// validator accepts ids from.
const fivePmId = (body) => (body?.system ?? '').match(new RegExp(`^- (\\S+) · ${TODAY} · 17:00 ·`, 'm'))?.[1] ?? 'missing-5pm-id';

// One reply per request, in the order the walk makes them. A function gets the
// request body it answers.
const SCRIPT = [
  reply([text("Here's that 4:30 one — confirm and it's in."), toolUse('toolu_walk_01', 'add_late_pouch', { day: TODAY, time: LATE_HM, triggers: ['boredom'], note: '' })], 'tool_use'),
  reply([text('4:30 is in.')]),
  reply([
    text(BATCH_WORDS),
    toolUse('toolu_walk_02', 'mark_mistake', { pouch_id: TARGET.id }),
    toolUse('toolu_walk_03', 'log_resisted_now', { trigger: 'stress' }),
    toolUse('toolu_walk_04', 'log_checkin', { sleep_hours: 6.5, sleep_quality: 3, workout: true }),
    toolUse('toolu_walk_04b', 'add_late_pouch', { day: TODAY, time: '13:30', triggers: [], note: '' }),
  ], 'tool_use'),
  reply([text(BATCH_REPLY)]),
  reply([
    text('Here you go.'),
    toolUse('toolu_walk_05', 'mark_mistake', { pouch_id: 'not-a-real-id' }),
    toolUse('toolu_walk_06', 'add_late_pouch', { day: TODAY, time: '13:00', triggers: [], note: '' }),
    toolUse('toolu_walk_07', 'log_resisted_now', { trigger: 'boredom' }),
    toolUse('toolu_walk_08', 'add_reason', { pouch_id: REASON_TARGET.id, triggers: ['social'], note: REASON_NOTE }),
    toolUse('toolu_walk_09', 'log_pouch_now', {}),
    toolUse('toolu_walk_10', 'add_late_pouch', { day: TODAY, time: '15:00', triggers: [], note: '' }), // the sixth: never drawn
  ], 'tool_use'),
  reply([text('No problem.')]),
  reply([text("Here's the 5:00 one."), toolUse('toolu_walk_11', 'add_late_pouch', { day: TODAY, time: '17:00', triggers: [], note: '' })], 'tool_use'),
  (body) => reply([text('5:00 is in. You said that one was a slip of the thumb — mark it?'), toolUse('toolu_walk_12', 'mark_mistake', { pouch_id: fivePmId(body) })], 'tool_use'),
  reply([text("That one didn't save — the 5:00 pouch is already gone.")]),
  reply([text(UNDO_REPLY)]),
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
  `"${SAY_BATCH.slice(0, 40)}…" → four cards → Skip 1:30 → "Confirm all (2)" saves resisted + check-in, the mistake waits → its own Confirm voids the tap`,
  `"${SAY_ODD}" → six proposals: a "can't do" card with no Confirm, four pending, the sixth never drawn → "${SAY_NEVERMIND}" skips the four`,
  `"${SAY_FIVE}" → Confirm the 5:00 PM card → the coach proposes marking it → Undo the 5:00 PM pouch → Confirm the mark → "Didn't save"`,
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
  rec.check('coach: header says "proposes, you confirm"', (await sheet.innerText()).includes('knows your log · proposes, you confirm'));
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
    const raw = req.postData() ?? '';
    const body = JSON.parse(raw || 'null');
    posted.push({ raw, body, headers: req.headers() });
    const step = script.shift() ?? reply([text('(script ran out)')]);
    const next = typeof step === 'function' ? step(body) : step;
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
  // The facts line says only what the headline doesn't: the day, time and
  // reason are already up there.
  const facts = (await late.locator('div.small.faint').first().innerText().catch(() => '')).trim();
  rec.check(`${L} its facts line reads "added later" and doesn't repeat the headline's 4:30 PM`,
    facts === 'added later' && !facts.includes('4:30 PM') && lateText.includes('added later'), facts);
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
    same(b2?.messages?.[1], { role: 'assistant', content: [text("Here's that 4:30 one — confirm and it's in."), toolUse('toolu_walk_01', 'add_late_pouch', { day: TODAY, time: LATE_HM, triggers: ['boredom'], note: '' })] }),
    JSON.stringify(b2?.messages?.[1]));
  rec.check(`${L} request 2's user turn is ONLY the tool_result: saved`,
    same(lastUser(b2), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_walk_01', content: 'saved' }] }), JSON.stringify(lastUser(b2)));
  const s1 = storedA2(await storedRoot(page));
  const [r1, p1] = checkAppendOnly(rec, `${L} [late]`, s1, ['reason', 'pouch']);
  rec.check(`${L} the pouch: day ${TODAY} · ts ${POUCH.ts} (4:30 PM CDT) · tzOffsetMin -300 · late · ctx null`,
    !!p1 && p1.day === TODAY && p1.ts === POUCH.ts && p1.tzOffsetMin === -300 && p1.late === true && p1.ctx === null && !('timeKnown' in p1),
    JSON.stringify(p1));
  // The page's clock started at NOW and ticks in real time, so "entered" is
  // NOW plus however long the walk took to get here.
  const entered = Date.parse(p1?.enteredAt ?? '');
  rec.check(`${L} the pouch carries enteredAt = when Confirm was tapped (9:12 PM, not 4:30)`,
    entered >= NOW_MS && entered < NOW_MS + 5 * 60000, p1?.enteredAt);
  rec.check(`${L} the reason targets it with [boredom]`, !!r1 && r1.target === p1?.id && same(r1.triggers, ['boredom']), JSON.stringify(r1));
  await rec.snap(page, 'saved-card');

  // ── 2. four cards: Skip one, Confirm all takes two, the mistake its own tap ──
  rec.section('four cards → Skip one → Confirm all (2) → the mistake on its own');
  const ok3 = await say(page, SAY_BATCH, BATCH_WORDS);
  rec.check(`${L} four cards render`, ok3 && await card(sheet, MARK_SUMMARY).isVisible() && await card(sheet, RESIST_SUMMARY).isVisible()
    && await card(sheet, CHECKIN_SUMMARY).isVisible() && await card(sheet, ONE_THIRTY_SUMMARY).isVisible());
  const all = sheet.getByRole('button', { name: /^Confirm all \(\d+\)$/ });
  const allLabel = async () => ((await all.innerText().catch(() => '')) || '').trim();
  rec.check(`${L} "Confirm all (3)": the three non-mistake cards, never the mistake`, (await allLabel()) === 'Confirm all (3)', await allLabel());
  // Below the last card of the reply, so the thumb passes every card first.
  const allBox = await all.boundingBox();
  const lastBox = await card(sheet, ONE_THIRTY_SUMMARY).boundingBox();
  rec.check(`${L} Confirm all sits below the reply's last card`, !!allBox && !!lastBox && allBox.y >= lastBox.y + lastBox.height - 1, `${allBox?.y} vs ${lastBox?.y}+${lastBox?.height}`);
  await card(sheet, ONE_THIRTY_SUMMARY).getByRole('button', { name: `Skip: ${ONE_THIRTY_SUMMARY}`, exact: true }).click();
  await page.waitForTimeout(400);
  rec.check(`${L} the skipped card reads "Skipped" and offers nothing`,
    (await card(sheet, ONE_THIRTY_SUMMARY).innerText()).includes('Skipped') && (await card(sheet, ONE_THIRTY_SUMMARY).getByRole('button').count()) === 0);
  rec.check(`${L} one mistake + two others pending: "Confirm all (2)"`, (await allLabel()) === 'Confirm all (2)', await allLabel());
  rec.check(`${L} a faint line says "mistakes need their own tap"`, await sheet.getByText('mistakes need their own tap', { exact: true }).isVisible().catch(() => false));
  await all.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400); // the sheet scrolls smoothly; let it land before the shot
  await rec.snap(page, 'confirm-all');
  await all.click();
  await page.waitForTimeout(600);
  await clearOverlay(page, `${L} after Confirm all`, rec);
  rec.check(`${L} Confirm all saved the two`,
    (await card(sheet, RESIST_SUMMARY).innerText()).includes('Saved') && (await card(sheet, CHECKIN_SUMMARY).innerText()).includes('Saved'));
  const markConfirm = card(sheet, MARK_SUMMARY).getByRole('button', { name: `Confirm: ${MARK_SUMMARY}`, exact: true });
  rec.check(`${L} …and left the mistake pending, with its own Confirm`, await markConfirm.isVisible().catch(() => false));
  rec.check(`${L} no follow-up while the mistake waits (3 requests so far)`, posted.length === 3, `${posted.length}`);
  const sMid = storedA2(await storedRoot(page));
  checkAppendOnly(rec, `${L} [Confirm all]`, sMid, AFTER_BATCH.slice(0, 4));
  rec.check(`${L} no void yet: Confirm all never marks a mistake`, !(sMid?.events ?? []).some((e) => e.type === 'void'));
  await markConfirm.click();
  const ok4 = await sheet.getByText(BATCH_REPLY, { exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  rec.check(`${L} the follow-up renders`, ok4);
  rec.check(`${L} the mistake card says Saved`, (await card(sheet, MARK_SUMMARY).innerText()).includes('Saved'));
  rec.check(`${L} request 4 answers all four, in the reply's order: saved, saved, saved, skipped`, same(lastUser(posted[3]?.body), { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'toolu_walk_02', content: 'saved' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_03', content: 'saved' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_04', content: 'saved' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_04b', content: 'skipped by the user' },
  ] }), JSON.stringify(lastUser(posted[3]?.body)));
  const s2 = storedA2(await storedRoot(page));
  const added2 = checkAppendOnly(rec, `${L} [batch]`, s2, AFTER_BATCH);
  rec.check(`${L} the resisted carries "stress"; the check-in 6.5h · 3/5 · workout, manual`,
    added2[2]?.trigger === 'stress' && added2[3]?.sleepHours === 6.5 && added2[3]?.sleepQuality === 3 && added2[3]?.workout === true && added2[3]?.source === 'manual',
    JSON.stringify(added2.slice(2)));
  rec.check(`${L} the void names the ${fmtTime(TARGET)} tap, filed on its day; the pouch itself untouched`,
    added2[4]?.target === TARGET.id && added2[4]?.day === TODAY && same(s2?.events?.find((e) => e.id === TARGET.id), TARGET), JSON.stringify(added2[4]));
  rec.check(`${L} store.js on the stored attempt: today ${TODAY_COUNTS[2]}/${CAP} — the mistake no longer counts`, numbersOf(s2).today === TODAY_COUNTS[2], `${numbersOf(s2).today}`);
  await card(sheet, ONE_THIRTY_SUMMARY).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await rec.snap(page, 'saved-skipped');

  // ── 3. cards the app can't do, and typing past pending ones ──
  rec.section('an invalid proposal and a sixth, then typing while cards are pending');
  const PENDING5 = [ONE_PM_SUMMARY, BORED_SUMMARY, REASON_SUMMARY, NOW_SUMMARY];
  const ok5 = await say(page, SAY_ODD, 'Here you go.');
  const odd = sheet.getByRole('group', { name: 'Proposed action the app can’t do', exact: true });
  rec.check(`${L} the foreign id renders as "can't do", with its reason and no buttons`,
    ok5 && (await odd.innerText().catch(() => '')).includes("The coach proposed something the app can't do")
      && (await odd.innerText().catch(() => '')).includes("that pouch isn't one from the last 7 days") && (await odd.getByRole('button').count()) === 0);
  const pendingNow = [];
  for (const s of PENDING5) pendingNow.push(await card(sheet, s).getByRole('button', { name: `Confirm: ${s}`, exact: true }).isVisible().catch(() => false));
  rec.check(`${L} four cards pending, each with its Confirm: ${PENDING5.join(' / ')}`, pendingNow.every(Boolean), pendingNow.join(','));
  rec.check(`${L} the sixth proposal (3:00 PM) is never drawn: five cards, not six`,
    (await sheet.getByRole('group', { name: /^Proposed/ }).count()) === 1 + 4 + 5 && !(await sheet.innerText()).includes('3:00 PM'),
    `${await sheet.getByRole('group', { name: /^Proposed/ }).count()} cards in the sheet`);
  const noteLine = (await card(sheet, REASON_SUMMARY).locator('[data-note]').innerText().catch(() => '')).trim();
  const noteRow = (await card(sheet, REASON_SUMMARY).locator('[data-note]').locator('..').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  rec.check(`${L} the reason card quotes the note on its own line (data-note), apart from the facts`, noteLine === REASON_NOTE, noteLine);
  rec.check(`${L} the note line says whose words they are: "your note …"`, noteRow.startsWith('your note') && noteRow.includes(REASON_NOTE), noteRow);
  rec.check(`${L} four pending, none a mistake: "Confirm all (4)" is offered`, (await all.count()) === 1 && (await allLabel()) === 'Confirm all (4)', await allLabel());
  rec.check(`${L} no follow-up was sent while cards are pending (5 requests so far)`, posted.length === 5, `${posted.length}`);
  await odd.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await rec.snap(page, 'invalid-card');
  const ok6 = await say(page, SAY_NEVERMIND, 'No problem.');
  rec.check(`${L} the reply to the typed turn renders`, ok6);
  const skippedNow = [];
  for (const s of PENDING5) skippedNow.push((await card(sheet, s).innerText().catch(() => '')).includes('Skipped'));
  rec.check(`${L} all four pending cards now read "Skipped"`, skippedNow.every(Boolean), skippedNow.join(','));
  rec.check(`${L} request 6 leads with every tool_result (invalid + overflow is_error, four skipped), then the words`, same(lastUser(posted[5]?.body), { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'toolu_walk_05', content: "invalid: that pouch isn't one from the last 7 days", is_error: true },
    { type: 'tool_result', tool_use_id: 'toolu_walk_06', content: 'skipped by the user' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_07', content: 'skipped by the user' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_08', content: 'skipped by the user' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_09', content: 'skipped by the user' },
    { type: 'tool_result', tool_use_id: 'toolu_walk_10', content: OVERFLOW_RESULT, is_error: true },
    text(SAY_NEVERMIND),
  ] }), JSON.stringify(lastUser(posted[5]?.body)));
  checkAppendOnly(rec, `${L} [invalid + skip]`, storedA2(await storedRoot(page)), AFTER_BATCH);

  // ── 4. a card the validator allowed and the api refused ──
  rec.section('Confirm the 5:00 PM pouch → Undo it → Confirm "mark it" → Didn\'t save');
  const ok7 = await say(page, SAY_FIVE, "Here's the 5:00 one.");
  rec.check(`${L} a card reads "${FIVE_SUMMARY}"`, ok7 && await card(sheet, FIVE_SUMMARY).isVisible().catch(() => false));
  await card(sheet, FIVE_SUMMARY).getByRole('button', { name: `Confirm: ${FIVE_SUMMARY}`, exact: true }).click();
  await clearOverlay(page, `${L} after the 5:00 PM Confirm`, rec);
  const mark5 = card(sheet, MARK5_SUMMARY);
  const ok8 = await mark5.getByRole('button', { name: `Confirm: ${MARK5_SUMMARY}`, exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  rec.check(`${L} the follow-up proposes "${MARK5_SUMMARY}" — the id the prompt listed`, ok8, fivePmId(posted[7]?.body));
  rec.check(`${L} request 8's user turn is ONLY the tool_result: saved`,
    same(lastUser(posted[7]?.body), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_walk_11', content: 'saved' }] }), JSON.stringify(lastUser(posted[7]?.body)));
  const s5 = storedA2(await storedRoot(page));
  const [p5] = checkAppendOnly(rec, `${L} [5:00 PM saved]`, s5, [...AFTER_BATCH, 'pouch']).slice(5);
  rec.check(`${L} the 5:00 PM pouch: late, ts ${POUCH5.ts}, no reason event (no triggers, no note)`,
    !!p5 && p5.late === true && p5.ts === POUCH5.ts && p5.day === TODAY && p5.tzOffsetMin === -300, JSON.stringify(p5));
  const undo5 = card(sheet, FIVE_SUMMARY).getByRole('button', { name: `Undo: ${FIVE_SUMMARY}`, exact: true });
  const canUndo = await undo5.isVisible().catch(() => false);
  rec.check(`${L} the 5:00 PM card still offers Undo after the follow-up`, canUndo);
  if (canUndo) await undo5.click();
  await page.waitForTimeout(400);
  rec.check(`${L} the 5:00 PM card reads "Undone"`, (await card(sheet, FIVE_SUMMARY).innerText().catch(() => '')).includes('Undone'));
  checkAppendOnly(rec, `${L} [5:00 PM undone]`, storedA2(await storedRoot(page)), AFTER_BATCH);
  await mark5.getByRole('button', { name: `Confirm: ${MARK5_SUMMARY}`, exact: true }).click();
  const ok9 = await sheet.getByText("That one didn't save — the 5:00 pouch is already gone.", { exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  rec.check(`${L} the coach's honest line renders`, ok9);
  const refusedText = (await mark5.innerText().catch(() => '')).replace(/’/g, "'");
  rec.check(`${L} the mark card reads "Didn't save — …" and offers nothing`,
    refusedText.includes(`Didn't save — ${REFUSED}`) && (await mark5.getByRole('button').count()) === 0, refusedText.replace(/\s+/g, ' '));
  rec.check(`${L} request 9 carries the refusal as an is_error result`,
    same(lastUser(posted[8]?.body), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_walk_12', content: `refused: ${REFUSED}`, is_error: true }] }),
    JSON.stringify(lastUser(posted[8]?.body)));
  const s6 = storedA2(await storedRoot(page));
  checkAppendOnly(rec, `${L} [refused]`, s6, AFTER_BATCH);
  rec.check(`${L} no second void was written by the refused card`, (s6?.events ?? []).filter((e) => e.type === 'void').length === 1);

  // The Undo landed after the coach was told "saved" (request 8). Once the
  // mistake card's batch was answered, the app sets the record straight in
  // one more turn, in words — a tool_result may only follow its tool_use.
  const ok10 = await sheet.getByText(UNDO_REPLY, { exact: true }).waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  rec.check(`${L} the undo is reported in one more turn, and the coach's reply renders`, ok10 && posted.length === 10, `${posted.length} requests`);
  const undoTurn = lastUser(posted[9]?.body);
  rec.check(`${L} request 10's last user turn is plain text "Undone: ${FIVE_SUMMARY}", no tool_result`,
    typeof undoTurn?.content === 'string' && undoTurn.content.startsWith('Undone:') && undoTurn.content === `Undone: ${FIVE_SUMMARY}`, JSON.stringify(undoTurn));
  rec.check(`${L} the undo report waited for the mistake card's results: request 9 was the refusal`,
    Array.isArray(lastUser(posted[8]?.body)?.content) && lastUser(posted[8]?.body).content.every((b) => b.type === 'tool_result'));

  // ── 5. reload: what was saved, saved ──
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
  rec.check(`${L} one saved chat of 20 messages, user/coach in turn`,
    s3?.chats?.length === 1 && msgs.length === 20 && msgs.every((m, i) => m.role === (i % 2 ? 'assistant' : 'user')), `${s3?.chats?.length} chats, ${msgs.length} messages`);
  rec.check(`${L} the first coach message records its proposal`, same(msgs[1]?.actions, [{ name: 'add_late_pouch', summary: LATE_SUMMARY }]), JSON.stringify(msgs[1]?.actions));
  rec.check(`${L} the follow-up reads "Confirmed: …" and records "saved"`,
    msgs[2]?.text === `Confirmed: ${LATE_SUMMARY}` && same(msgs[2]?.outcomes, [{ name: 'add_late_pouch', summary: LATE_SUMMARY, outcome: 'saved' }]) && msgs[3]?.text === '4:30 is in.',
    JSON.stringify(msgs[2]));
  rec.check(`${L} the batch: four proposed; saved, saved, saved, skipped`,
    msgs[5]?.actions?.length === 4 && same(msgs[6]?.outcomes?.map((o) => o.outcome), ['saved', 'saved', 'saved', 'skipped']), JSON.stringify(msgs[6]?.outcomes));
  rec.check(`${L} the six-proposal reply records the five cards it drew`, msgs[9]?.actions?.length === 5, JSON.stringify(msgs[9]?.actions));
  rec.check(`${L} the typed turn records "invalid" (with its reason) and four "skipped"`,
    msgs[10]?.text === SAY_NEVERMIND && same(msgs[10]?.outcomes?.map((o) => o.outcome), ['invalid', 'skipped', 'skipped', 'skipped', 'skipped'])
      && msgs[10]?.outcomes?.[0]?.reason === "that pouch isn't one from the last 7 days", JSON.stringify(msgs[10]));
  rec.check(`${L} the 5:00 PM follow-up records "saved" and the coach's mark proposal`,
    same(msgs[14]?.outcomes?.map((o) => o.outcome), ['saved']) && same(msgs[15]?.actions, [{ name: 'mark_mistake', summary: MARK5_SUMMARY }]), JSON.stringify([msgs[14]?.outcomes, msgs[15]?.actions]));
  rec.check(`${L} the refusal is saved in words: "Didn't save: …" with its reason`,
    msgs[16]?.text === `Didn't save: ${MARK5_SUMMARY} (${REFUSED})` && msgs[16]?.outcomes?.[0]?.outcome === 'refused' && msgs[16]?.outcomes?.[0]?.reason === REFUSED,
    JSON.stringify(msgs[16]));
  rec.check(`${L} the late undo is saved: "Undone: …" with an \`undone\` outcome`,
    msgs[18]?.text === `Undone: ${FIVE_SUMMARY}` && same(msgs[18]?.outcomes, [{ name: 'add_late_pouch', summary: FIVE_SUMMARY, outcome: 'undone' }]) && msgs[19]?.text === UNDO_REPLY,
    JSON.stringify(msgs[18]));
  rec.check(`${L} the fake key is still nowhere in localStorage`, !((await e2e.readStorage(page, 'pouch-down-v2')) ?? '').includes(FAKE_KEY));

  // ── 6. a past attempt can't reach the coach ──
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
  rec.check(`${L} nothing was sent from the viewer`, posted.length === requests && requests === 10, `${posted.length} requests`);

  // The Worker's own gate, on the exact bytes the browser sent: the day the
  // proxy is switched on, none of these conversations would be turned away.
  const refusedBy = posted.map((p, k) => [k + 1, checkBody(p.raw)]).filter(([, r]) => !r.ok);
  rec.check(`${L} all ${posted.length} request bodies pass the Worker's checkBody`, posted.length === 10 && refusedBy.length === 0,
    refusedBy.map(([k, r]) => `#${k}: ${r.message}`).join('; '));
  rec.check(`${L} every request (active attempt): max_tokens 800 and the eight tools, sent with the fake key`,
    posted.every((p) => p.body?.max_tokens === 800 && same(p.body?.tools?.map((t) => t.name), TOOL_NAMES) && p.headers['x-api-key'] === FAKE_KEY));

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
