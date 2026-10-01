// Proves "Add a pouch" and "Mark as mistake" in a real browser. A pouch taken
// away from the phone used to be lost to the log, and an accidental tap could
// only be undone in its first seconds — after that it counted forever. The
// sheet now takes a remembered pouch with the time it happened, and marks a
// tap as a mistake, both as NEW events: nothing logged is ever rewritten.
//
// What the unit suite cannot see, and this walk does:
//   · Fix this day opens for TODAY from the Calendar, says the total comes
//     from the log, and keeps the stepper closed;
//   · a time later than now is refused before saving ("later than now", Save
//     disabled), and 4:30 PM with "boredom" saves with an Undo on offer;
//   · after a reload — no re-seed — History shows the row as "added later"
//     with its reason, the day reads one higher, and the Money card drops by
//     one pouch;
//   · a seeded tap marked as a mistake (behind a confirm) is struck, the count
//     and the money come back down, and the struck row stays in history;
//   · storage is append-only: every seeded event byte-identical, exactly a
//     reason, a pouch and a void appended after them.
//
// One browser context on a PINNED clock (America/Chicago) and a synthetic
// 90-day plan (9/day · 9 mg · [6, 3], Day 1 Tue 2026-09-22) — the same plan
// and prices as walk-fixday. "Today" is Thu 2026-09-24 = Day 3, 9 PM, with
// three taps already logged; Days 1 and 2 are logged too, so no backfill
// prompt sits over the walk (walk-backfill owns the prompt).
//
// Every expected number is written twice: by hand in the fixture comments,
// and by store.js on the attempt READ BACK from the browser's localStorage.
// `--dry` prints the fixture and runs the hand-vs-store.js checks, no browser.
//
// Awards are pre-marked as celebrated (every award any state in this walk can
// earn) so an unlock overlay can't sit on top of the sheet. walk-awards.mjs
// owns celebrations; this walk owns the add and the mark.
//
// Synthetic data only. James's real data never enters this repo; it is public.
//
// Usage: node scripts/e2e/walk-latepouch.mjs [--dist DIR] [--out DIR] [--port N] [--keep] [--dry]
import { chromium } from 'playwright-core';
import * as e2e from './lib.mjs';
import { generatePlan } from '../../src/planGenerator.js';
import { capForDay } from '../../src/plan.js';
import {
  statusForDay, pouchesForDay, rawEventsForDay, isVoided, missedDays, todayKey, triggersFor, fmtTime,
} from '../../src/store.js';
import { moneyStats } from '../../src/money.js';
import { awardsFor } from '../../src/awards.js';
import { resolveLate } from '../../src/latePouch.js';
import { dayKeyAt, offsetMinInZone } from '../../src/time.js';

const args = e2e.parseArgs({ name: 'walk-latepouch', port: 4341 });
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------- the clock */

// Node and the browser must agree on "today", or the sheet opens for the
// wrong day. Both run in Chicago, and store.js is only ever called here
// inside atNow().
const TZ = 'America/Chicago';
process.env.TZ = TZ;
const NOW = '2026-09-24T21:00:00-05:00'; // Thu, CDT — 9 PM, three taps logged today
const NOW_MS = Date.parse(NOW);
const TODAY = '2026-09-24';

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

const START = '2026-09-22'; // Day 1, a Tuesday. TODAY is Day 3.
const TODAY_N = epochDay(TODAY) - epochDay(START) + 1;
const dayOf = (n) => addDays(START, n - 1);
// Same formatting the Calendar and History labels use (local noon).
const monthDayOf = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const TODAY_LABEL = `Day ${TODAY_N}, ${monthDayOf(TODAY)}`; // "Day 3, Sep 24"

/* --------------------------------------------------------------- the plan */

const SETTINGS = {
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  costPerTin: 5,
  pouchesPerTin: 20,
  wakeTime: '07:00',
  sleepTime: '23:00',
};

const PLAN = generatePlan({
  pouchesPerDay: 9,
  mg: 9,
  strengths: [6, 3],
  lengthDays: 90,
  startDate: START,
  mealTimes: SETTINGS.mealTimes,
  sleepTime: SETTINGS.sleepTime,
  pouchesPerTin: SETTINGS.pouchesPerTin,
});
// Days 1–15 are the "Baseline hold" stage at 8/day (checked in domainChecks).
const CAP = 8;

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

// By hand (cap 8 every day; $5 a tin of 20 = $0.25 a pouch; old pace 9/day):
//
//   d1  Tue 9/22  6 pouches   green   6/8
//   d2  Wed 9/23  4 pouches   green   4/8
//   d3  Thu 9/24  3 taps      today   3/8   ← the day being fixed, at 9 PM
//
//   Money: 3 logged days × 9 × $0.25 = $6.75 old pace.
//     seeded           used 13 → spent $3.25 → kept $3.50   today 3/8
//     + 4:30 PM pouch  used 14 → spent $3.50 → kept $3.25   today 4/8
//     + first tap void used 13 → spent $3.25 → kept $3.50   today 3/8
const PATTERN = { 1: 6, 2: 4, [TODAY_N]: 3 };
const USED = [13, 14, 13];
const TODAY_COUNTS = [3, 4, 3];
const KEPT = [3.5, 3.25, 3.5];
const LATE_HM = '16:30';
const LATE_CLOCK = '4:30 PM';
const FUTURE_HM = '22:30'; // 10:30 PM, later than 9 PM: the sheet must refuse it
const CHIP = 'boredom';

function buildEvents() {
  const stage = PLAN.stages[0];
  let k = 0;
  const mk = (type, ms, extra = {}) => {
    const tzOffsetMin = offsetMinInZone(ms, TZ);
    return { id: `lp-${++k}`, ts: new Date(ms).toISOString(), tzOffsetMin, day: dayKeyAt(ms, tzOffsetMin), type, trigger: null, ...extra };
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
// The tap the walk marks as a mistake: today's first.
const TARGET = TODAY_TAPS[0];
const TARGET_LABEL = `Pouch at ${fmtTime(TARGET)}`;

// What api.logLatePouch / api.voidPouch append, entered at NOW: the reason
// first, then the pouch (so undo takes only the pouch), then the void.
const LATE_MS = tsFor(TODAY, LATE_HM);
const enteredAt = new Date(NOW_MS).toISOString();
const POUCH = {
  id: 'expected-pouch', ts: new Date(LATE_MS).toISOString(), tzOffsetMin: offsetMinInZone(LATE_MS, TZ), day: TODAY,
  type: 'pouch', trigger: null, ctx: null, late: true, enteredAt,
};
const stampNow = (type, extra) => ({
  id: `expected-${type}`, ts: enteredAt, tzOffsetMin: offsetMinInZone(NOW_MS, TZ), day: TODAY, type, trigger: null, ...extra,
});
const REASON = stampNow('reason', { target: POUCH.id, triggers: [CHIP], note: '' });
const VOID = stampNow('void', { target: TARGET.id });
const withEvents = (attempt, list) => ({ ...attempt, events: [...attempt.events, ...list] });

// Every award any state of this walk can reach, pre-marked as celebrated.
function celebratedFor(attempt) {
  const states = [attempt, withEvents(attempt, [REASON, POUCH]), withEvents(attempt, [REASON, POUCH, VOID])];
  const ids = new Set();
  for (const s of states) for (const a of atNow(() => awardsFor(s))) if (a.earned) ids.add(a.id);
  return [...ids].sort();
}

function fixture() {
  const bare = {
    id: 'a2', status: 'active', createdAt: '2026-09-22T01:30:00.000Z', archivedAt: null,
    settings: SETTINGS, plan: PLAN, events: EVENTS,
    celebratedStages: [], celebratedAwards: [],
    checkinDismissedFor: TODAY, // keeps the morning check-in card out of the shots
  };
  const attempt = { ...bare, celebratedAwards: celebratedFor(bare) };
  const root = { version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [attempt] };
  return { attempt, root, rootJSON: JSON.stringify(root) };
}

const FIX = fixture();

/* --------------------------------------------- hand vs store.js, no browser */

const usedOf = (s) => atNow(() => [1, 2, TODAY_N].reduce((t, n) => t + pouchesForDay(s, dayOf(n)), 0));

// store.js on one state of the walk: today's count, kept money, used.
function numbersOf(s) {
  const m = atNow(() => moneyStats(s));
  return { today: atNow(() => pouchesForDay(s, TODAY)), kept: m.kept, loggedDays: m.loggedDays, used: usedOf(s) };
}

function domainChecks(rec) {
  rec.section('domain · hand derivation vs store.js (no browser)');
  const { attempt } = FIX;
  rec.check(`Pinned clock: Node and store.js agree today is Thu ${TODAY} (Day ${TODAY_N})`,
    atNow(() => todayKey()) === TODAY && TODAY_N === 3, `todayKey ${atNow(() => todayKey())}, day ${TODAY_N}`);
  const caps = Array.from({ length: TODAY_N }, (_, i) => capForDay(PLAN, i + 1));
  rec.check(`Every fixture day has cap ${CAP} (Baseline hold)`, caps.every((c) => c === CAP), caps.join(','));
  rec.check('No missed day, so no backfill prompt covers the walk', atNow(() => missedDays(attempt)).length === 0);
  rec.check('Today\'s three taps all sit before 9 PM, on today', TODAY_TAPS.length === 3
    && TODAY_TAPS.every((e) => Date.parse(e.ts) < NOW_MS && e.day === TODAY), TODAY_TAPS.map((e) => fmtTime(e)).join(', '));
  rec.check(`Per pouch $${(SETTINGS.costPerTin / SETTINGS.pouchesPerTin).toFixed(2)}, old pace ${PLAN.baseline.pouchesPerDay}/day`,
    atNow(() => moneyStats(attempt)).perPouch === 0.25 && PLAN.baseline.pouchesPerDay === 9);

  // The sheet's resolved line and the api read the same module: 4:30 PM is
  // in the past at 9 PM, 10:30 PM is not.
  const ok = atNow(() => resolveLate({ day: TODAY, time: LATE_HM, now: NOW_MS }));
  const fut = atNow(() => resolveLate({ day: TODAY, time: FUTURE_HM, now: NOW_MS }));
  rec.check(`resolveLate: ${LATE_CLOCK} today is saveable and lands at tsFor(${LATE_HM}), CDT`,
    ok.ok && !ok.future && ok.ms === LATE_MS && ok.tzOffsetMin === -300, JSON.stringify(ok));
  rec.check(`resolveLate: ${FUTURE_HM} today is later than now`, fut.ok && fut.future);

  const states = [attempt, withEvents(attempt, [REASON, POUCH]), withEvents(attempt, [REASON, POUCH, VOID])];
  const names = ['seeded', '+ the 4:30 PM pouch', '+ the void'];
  states.forEach((s, i) => {
    const got = numbersOf(s);
    rec.check(`${names[i]}: today ${TODAY_COUNTS[i]}/${CAP}, used ${USED[i]} over 3 logged days, kept $${KEPT[i].toFixed(2)}`,
      got.today === TODAY_COUNTS[i] && got.used === USED[i] && got.loggedDays === 3 && got.kept === KEPT[i], JSON.stringify(got));
  });
  const last = states[2];
  rec.check('The voided tap is still in the raw day, struck; the live count skips it',
    atNow(() => isVoided(last, TARGET)) && atNow(() => rawEventsForDay(last, TODAY)).some((e) => e.id === TARGET.id));
  rec.check(`The late pouch reads "${CHIP}" through its reason event`,
    JSON.stringify(triggersFor(last, POUCH)) === JSON.stringify([CHIP]));
  rec.check('Today stays "today-under" in every state', states.every((s) => atNow(() => statusForDay(s, TODAY)) === 'today-under'));
}

function printFixture() {
  log(`\nclock: ${NOW} (${TZ}) — today ${TODAY} = ${TODAY_LABEL}`);
  log(`plan: 90 days from ${START} → quit ${PLAN.quitDate}; stage 1 "${PLAN.stages[0].name}" at ${CAP}/day`);
  log('storage: pouch-down-v1 absent · pouch-down-v2 = { a2 active }');
  for (let n = 1; n <= TODAY_N; n++) {
    const st = atNow(() => statusForDay(FIX.attempt, dayOf(n)));
    log(`  d${n} ${monthDayOf(dayOf(n)).padEnd(7)} ${String(PATTERN[n] ?? 0).padEnd(3)} ${st}`);
  }
  log(`  events ${EVENTS.length} · today's taps ${TODAY_TAPS.map((e) => fmtTime(e)).join(', ')} · mistake: "${TARGET_LABEL}"`);
  log(`  celebratedAwards ${FIX.attempt.celebratedAwards.join(', ')}`);
  log('  steps:');
  STEPS.forEach((s, k) => log(`   ${String(k + 1).padStart(2)}. ${s}`));
}

const STEPS = [
  `open → Today ring reads ${TODAY_COUNTS[0]} of ${CAP}`,
  `Calendar → "${TODAY_LABEL}" → sheet for today: "Today's total comes from the log", no stepper`,
  `Add a pouch → ${FUTURE_HM} reads "later than now", Save disabled → ${LATE_HM} + ${CHIP} → "${LATE_CLOCK}" → Save pouch → Added + Undo`,
  'Done → storage: seeded byte-identical, exactly a reason then a pouch appended',
  `reload → History Day ${TODAY_N} ${TODAY_COUNTS[1]}/${CAP} with "${LATE_CLOCK} · added later · ${CHIP}"; Money kept $${KEPT[1].toFixed(2)}`,
  `pencil "Fix ${TODAY_LABEL}" → "${TARGET_LABEL}" → Mark as mistake → confirm → struck, Marked + Undo`,
  `reload → History ${TODAY_COUNTS[2]}/${CAP} with a "mistake" row; ring ${TODAY_COUNTS[2]}; Money kept $${KEPT[2].toFixed(2)}`,
  'storage: exactly reason, pouch, void appended; v1 still absent',
];

/* ---------------------------------------------------------------- browser */

const UNLOCK = '[role="dialog"][aria-modal="true"][aria-labelledby]';
const notes = [];

// An award unlock sitting on top of the sheet would block every tap. The
// fixture pre-marks every reachable award, so this should never fire; if it
// does, dismiss it and say so rather than let it masquerade as a sheet bug.
async function clearOverlay(page, where) {
  for (let i = 0; i < 4; i++) {
    const n = await page.locator(UNLOCK).count();
    if (!n) return;
    const t = (await page.locator(UNLOCK).first().innerText().catch(() => '')).split('\n')[0];
    notes.push(`unexpected award overlay at ${where}: "${t}"`);
    log(`  (dismissed an unexpected award overlay at ${where}: "${t}")`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

const sheetLoc = (page) => page.getByRole('dialog', { name: 'Fix this day' });
const chipLoc = (page) => page.getByRole('button', { name: /trophy case/i }).first();
const storedRoot = async (page) => JSON.parse((await e2e.readStorage(page, 'pouch-down-v2')) ?? 'null');
const storedA2 = (root) => root?.attempts?.find((a) => a.id === 'a2') ?? null;
const money = (v) => `$${v.toFixed(2)}`;

async function tab(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(600);
}

// History is the second segment of Stats (design pass, 2026-09-28); Stats
// opens on Overview, so every visit taps through to it.
async function openHistory(page) {
  await tab(page, 'Stats');
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page.waitForTimeout(450);
}

// The ring's spoken label carries today's count: "Log a pouch. 3 of 8 used today."
async function ringCount(page) {
  const ring = page.getByRole('button', { name: /^Log a pouch\. \d+ of \d+ used today\.$/ });
  const label = (await ring.getAttribute('aria-label', { timeout: 5000 }).catch(() => null)) ?? '';
  return { label, used: Number(label.match(/(\d+) of/)?.[1] ?? NaN) };
}

// The Money card's text, from the card that holds the price-settings button.
async function moneyText(page) {
  const card = page.locator('.card').filter({ has: page.getByRole('button', { name: 'Open price settings' }) }).first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  return (await card.innerText()).replace(/\s+/g, ' ');
}

async function checkToday(rec, page, L, i) {
  await tab(page, 'Today');
  await clearOverlay(page, `${L} Today`);
  const r = await ringCount(page);
  rec.check(`${L} Today ring reads ${TODAY_COUNTS[i]} of ${CAP}`, r.used === TODAY_COUNTS[i], r.label || 'no ring label');
  const m = await moneyText(page);
  // The labels are uppercased by CSS, so innerText reads "KEPT".
  const spent = (USED[i] * SETTINGS.costPerTin) / SETTINGS.pouchesPerTin;
  rec.check(`${L} Money card: You spent ${money(spent)}, Kept ${money(KEPT[i])}`,
    new RegExp(`You spent \\${money(spent)} Kept \\${money(KEPT[i])}(?!\\d)`, 'i').test(m), m.match(/Old pace.*?Quit/i)?.[0] ?? m);
}

// History: expand today's section and read its rows.
async function historyRows(page) {
  const toggle = page.locator('button[aria-expanded]').filter({ hasText: new RegExp(`^Day ${TODAY_N}\\b`) }).first();
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.waitForTimeout(500);
  // The section's rows sit in the same row wrapper as its toggle.
  return toggle.locator('xpath=..').innerText();
}

async function closeSheet(rec, page, L) {
  await sheetLoc(page).getByRole('button', { name: 'Done', exact: true }).click();
  const gone = await sheetLoc(page).waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false);
  rec.check(`${L} Done closes the sheet`, gone);
}

async function reload(rec, page, L) {
  const before = JSON.stringify(storedA2(await storedRoot(page))?.events);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} reload`);
  rec.check(`${L} after reload the stored events are unchanged (seeding did not re-run)`,
    JSON.stringify(storedA2(await storedRoot(page))?.events) === before);
}

// Seeded events byte-identical and in order; then exactly `types` appended.
function checkAppendOnly(rec, L, stored, types) {
  const evs = stored?.events ?? [];
  const bad = EVENTS.filter((e, i) => JSON.stringify(evs[i]) !== JSON.stringify(e)).length;
  rec.check(`${L} all ${EVENTS.length} seeded events byte-identical, in order`, bad === 0 && evs.length >= EVENTS.length,
    bad ? `${bad} changed/missing` : '');
  const added = evs.slice(EVENTS.length);
  rec.check(`${L} exactly ${types.length} new events: ${types.join(', ')}`,
    added.length === types.length && added.every((e, i) => e?.type === types[i]),
    added.map((e) => `${e.type}/${e.day}`).join(', ') || 'none');
  const [r, p, v] = added;
  const entered = (iso) => (Number.isFinite(Date.parse(iso)) ? dayKeyAt(Date.parse(iso), -300) : null);
  rec.check(`${L} pouch: day ${TODAY} · ts ${POUCH.ts} (${LATE_CLOCK} CDT) · ctx null · late · entered today`,
    !!p && p.day === TODAY && p.ts === POUCH.ts && p.tzOffsetMin === -300 && p.ctx === null && p.late === true
      && entered(p.enteredAt) === TODAY && !('timeKnown' in p),
    p ? JSON.stringify({ day: p.day, ts: p.ts, tz: p.tzOffsetMin, ctx: p.ctx, late: p.late, enteredAt: p.enteredAt, timeKnown: p.timeKnown }) : 'missing');
  rec.check(`${L} reason: targets the new pouch · [${CHIP}] · day ${TODAY}`,
    !!r && !!p && r.target === p.id && JSON.stringify(r.triggers) === JSON.stringify([CHIP]) && r.day === TODAY,
    r ? JSON.stringify({ target: r.target, triggers: r.triggers, day: r.day }) : 'missing');
  if (types.length === 3) {
    rec.check(`${L} void: targets today's first tap (${TARGET.id}) · day ${TODAY}`,
      !!v && v.target === TARGET.id && v.day === TODAY, v ? JSON.stringify({ target: v.target, day: v.day }) : 'missing');
  }
  const ids = evs.map((e) => e.id);
  rec.check(`${L} event ids unique`, new Set(ids).size === ids.length);
}

// store.js on the attempt read back from storage, against the hand numbers.
function checkStored(rec, L, stored, i) {
  const got = numbersOf(stored);
  rec.check(`${L} store.js on the STORED attempt: today ${TODAY_COUNTS[i]}, kept ${money(KEPT[i])}`,
    got.today === TODAY_COUNTS[i] && got.kept === KEPT[i] && got.used === USED[i], JSON.stringify(got));
}

async function walk(browser, base, rec) {
  const L = 'late:';
  const ctx = await e2e.phoneContext(browser, { tz: TZ, now: NOW });
  await e2e.seedStorage(ctx, { 'pouch-down-v1': null, 'pouch-down-v2': FIX.rootJSON });
  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, 'late');

  rec.section('open');
  await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' });
  const up = await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
  rec.check(`${L} Today renders with the streak chip`, up);
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} boot`);
  rec.check(`${L} no backfill prompt on open`, !/No log for/i.test(await e2e.bodyText(page)));
  await checkToday(rec, page, L, 0);
  await rec.snap(page, 'open');

  // Door: the Calendar cell for today.
  rec.section('Calendar → today → add a pouch');
  await tab(page, 'Calendar');
  const cell = page.locator(`[aria-label^="${TODAY_LABEL}:"]`).first();
  await cell.waitFor({ state: 'visible', timeout: 5000 });
  await cell.click();
  const sheet = sheetLoc(page);
  const open = await sheet.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  rec.check(`${L} "Fix this day" opens from today's cell`, open);
  if (!open) return errors;
  const text0 = await sheet.innerText();
  rec.check(`${L} sheet is for Day ${TODAY_N} · ${monthDayOf(TODAY)}`,
    text0.includes(`Day ${TODAY_N} ·`) && text0.includes(monthDayOf(TODAY)), text0.split('\n').slice(0, 3).join(' | '));
  rec.check(`${L} sheet says "Today's total comes from the log"`, text0.includes('Today\'s total comes from the log'));
  rec.check(`${L} sheet does not say "corrections open tomorrow"`, !/corrections open tomorrow/i.test(text0));
  rec.check(`${L} no "Actual total" stepper for today`, (await sheet.getByRole('spinbutton', { name: 'Actual total' }).count()) === 0);

  await sheet.getByRole('button', { name: 'Add a pouch', exact: true }).click();
  await page.waitForTimeout(400);
  const time = sheet.getByLabel('Time', { exact: true });
  const line = sheet.getByRole('status').first();
  const save = sheet.getByRole('button', { name: 'Save pouch', exact: true });

  await time.fill(FUTURE_HM);
  await page.waitForTimeout(200);
  const futLine = await line.innerText();
  rec.check(`${L} ${FUTURE_HM} → the line reads "later than now"`, /later than now/.test(futLine), futLine);
  rec.check(`${L} ${FUTURE_HM} → "Save pouch" is disabled`, await save.isDisabled());

  await time.fill(LATE_HM);
  const chip = sheet.getByRole('button', { name: CHIP, exact: true });
  await chip.click();
  await page.waitForTimeout(200);
  rec.check(`${L} chip "${CHIP}" selected (aria-pressed)`, (await chip.getAttribute('aria-pressed')) === 'true');
  const okLine = await line.innerText();
  rec.check(`${L} ${LATE_HM} → the line reads "${LATE_CLOCK}"`, okLine.includes(LATE_CLOCK) && !/later than now/.test(okLine), okLine);
  rec.check(`${L} "Save pouch" is enabled`, !(await save.isDisabled()));
  await rec.snap(page, 'add-card-open');

  await save.click();
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} after Save pouch`);
  const added = await sheet.getByRole('status').filter({ hasText: 'Added' }).isVisible().catch(() => false);
  rec.check(`${L} the card shows "Added"`, added);
  rec.check(`${L} and an Undo chip ("Undo adding this pouch")`,
    await sheet.getByRole('button', { name: 'Undo adding this pouch', exact: true }).isVisible().catch(() => false));
  const lateRow = sheet.getByRole('button', { name: `Pouch at ${LATE_CLOCK}`, exact: true });
  const lateText = (await lateRow.innerText().catch(() => '')).replace(/\s+/g, ' ');
  rec.check(`${L} the sheet lists "Pouch at ${LATE_CLOCK}" · added later · ${CHIP}`,
    lateText.includes('added later') && lateText.includes(CHIP), lateText || 'no row');
  await rec.snap(page, 'added');

  await closeSheet(rec, page, L);
  await clearOverlay(page, `${L} after Done`);
  const s1 = storedA2(await storedRoot(page));
  checkAppendOnly(rec, `${L} [add]`, s1, ['reason', 'pouch']);
  checkStored(rec, `${L} [add]`, s1, 1);

  // Reload: no re-seed, so everything shown now came from what the app saved.
  rec.section('reload → History + Money after the add');
  await reload(rec, page, L);
  await openHistory(page);
  const h1 = await historyRows(page);
  rec.check(`${L} History Day ${TODAY_N} header reads ${TODAY_COUNTS[1]}/${CAP}`, h1.includes(`${TODAY_COUNTS[1]}/${CAP}`), h1.split('\n').slice(0, 2).join(' | '));
  const lateLine = h1.split('\n').find((l) => l.includes(LATE_CLOCK)) ?? '';
  rec.check(`${L} History has the "${LATE_CLOCK}" row, "added later", "${CHIP}"`,
    h1.includes(LATE_CLOCK) && h1.includes('added later') && h1.includes(CHIP), h1.replace(/\s+/g, ' ').slice(0, 300) || lateLine);
  await checkToday(rec, page, L, 1);

  // Mark a different pouch — today's first tap — as a mistake, from the pencil.
  rec.section('History pencil → mark a tap as a mistake');
  await openHistory(page);
  const pencil = page.getByRole('button', { name: `Fix ${TODAY_LABEL}`, exact: true });
  const hasPencil = (await pencil.count()) === 1;
  rec.check(`${L} History shows the pencil "Fix ${TODAY_LABEL}"`, hasPencil);
  if (!hasPencil) return errors;
  await pencil.scrollIntoViewIfNeeded();
  await pencil.click();
  const open2 = await sheet.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  rec.check(`${L} [pencil] "Fix this day" opens`, open2);
  if (!open2) return errors;
  const row = sheet.getByRole('button', { name: TARGET_LABEL, exact: true });
  const hasRow = (await row.count()) === 1;
  rec.check(`${L} pouch row "${TARGET_LABEL}" in the sheet`, hasRow);
  if (!hasRow) return errors;
  await row.click();
  await page.waitForTimeout(400);
  await sheet.getByRole('button', { name: 'Mark as mistake', exact: true }).click();
  await page.waitForTimeout(400);
  const confirmText = 'Mark this pouch as a mistake? It stops counting; it stays in your history.';
  rec.check(`${L} the confirm reads "${confirmText}"`, await sheet.getByText(confirmText, { exact: true }).isVisible().catch(() => false));
  rec.check(`${L} the confirm offers "Keep it" and "Confirm"`,
    (await sheet.getByRole('button', { name: 'Keep it', exact: true }).isVisible())
      && (await sheet.getByRole('button', { name: 'Confirm', exact: true }).isVisible()));
  await rec.snap(page, 'confirm');
  await sheet.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForTimeout(500);
  await clearOverlay(page, `${L} after Confirm`);
  rec.check(`${L} the editor closes`, (await sheet.getByRole('button', { name: 'Mark as mistake', exact: true }).count()) === 0);
  // The struck row is no longer a button: nothing is left to do on it. Right
  // after marking it shows "Marked" + Undo where "mistake" will sit.
  const struck = sheet.getByRole('listitem', { name: `${TARGET_LABEL}, marked as a mistake`, exact: true });
  const struckUp = (await struck.count()) === 1;
  rec.check(`${L} the row is now "${TARGET_LABEL}, marked as a mistake" (not a button)`,
    struckUp && (await row.count()) === 0);
  const items = await sheet.getByRole('list').getByRole('listitem').count();
  rec.check(`${L} the sheet's list still holds all four pouches, the struck one included`, items === 4, `${items} listitems`);
  const struckText = struckUp ? (await struck.innerText()).replace(/\s+/g, ' ') : '';
  rec.check(`${L} the struck row shows "Marked"`, /\bMarked\b/.test(struckText), struckText);
  rec.check(`${L} and an Undo chip ("Undo marking this pouch")`,
    await sheet.getByRole('button', { name: 'Undo marking this pouch', exact: true }).isVisible().catch(() => false));
  const decoration = struckUp ? await struck.locator('span.num').first().evaluate((el) => getComputedStyle(el).textDecorationLine) : '';
  rec.check(`${L} the struck row's time is drawn struck through`, decoration.includes('line-through'), decoration);
  await rec.snap(page, 'struck-row');
  await closeSheet(rec, page, L);
  await clearOverlay(page, `${L} after Done`);

  rec.section('reload → everything back down');
  await reload(rec, page, L);
  await openHistory(page);
  const h2 = await historyRows(page);
  rec.check(`${L} History Day ${TODAY_N} header reads ${TODAY_COUNTS[2]}/${CAP}`, h2.includes(`${TODAY_COUNTS[2]}/${CAP}`), h2.split('\n').slice(0, 2).join(' | '));
  const h2flat = h2.replace(/\s+/g, ' ');
  rec.check(`${L} History has a row marked "mistake" at ${fmtTime(TARGET)}`,
    new RegExp(`${fmtTime(TARGET)}[^]*?mistake`).test(h2flat), h2flat.slice(0, 300));
  rec.check(`${L} the "${LATE_CLOCK}" added-later row is still there`, h2.includes(LATE_CLOCK) && h2.includes('added later'));
  await rec.snap(page, 'reload-history', { fullPage: true });

  await checkToday(rec, page, L, 2);
  const todayLog = page.locator('.card').filter({ hasText: /^Today's log/ }).first();
  await todayLog.scrollIntoViewIfNeeded();
  const logText = (await todayLog.innerText()).replace(/\s+/g, ' ');
  rec.check(`${L} Today's log keeps the struck tap ("mistake") and the late one ("added later")`,
    logText.includes('mistake') && logText.includes('added later'), logText);
  await page.waitForTimeout(300);
  await rec.snap(page, 'today-log');

  const s2 = storedA2(await storedRoot(page));
  checkAppendOnly(rec, `${L} [void]`, s2, ['reason', 'pouch', 'void']);
  checkStored(rec, `${L} [void]`, s2, 2);

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
