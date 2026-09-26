// Proves the "Fix this day" sheet in a real browser. Attempt 1 faded partly
// because the log stopped matching the day: a pouch taken away from the phone
// never got tapped, and the day scored as if it hadn't happened. The sheet is
// how a past day gets its real total and how any pouch gets its reasons —
// both as NEW events, never by rewriting what was logged.
//
// What the unit suite cannot see, and this walk does:
//   · both doors open the sheet on a 390px phone: the History pencil and the
//     Calendar cell, each for the day that was tapped;
//   · the stepper can't go below the timed logs, and the verdict line tracks
//     the total live (10 of cap 8 reads "over", in amber, before saving);
//   · a pouch row opens its reason editor, and two chips plus a note show on
//     the row the moment they're saved;
//   · after a reload — no re-seed — History reads "Corrected total: 10 (4
//     timed)", the pouch still carries its reasons, and the Calendar cell is
//     amber 10/8;
//   · storage is append-only: every seeded event byte-identical, exactly one
//     correction and one reason appended after them.
//
// One browser context on a PINNED clock (America/Chicago) and a synthetic
// 90-day plan (9/day · 9 mg · [6, 3], Day 1 Tue 2026-09-22). "Today" is Thu
// 2026-09-24 = Day 3, 10 AM, nothing logged yet today; yesterday (Day 2) holds
// four timed pouches — a logged, in-plan past day. Day 1 is logged too, so no
// backfill prompt sits over the walk (walk-backfill owns the prompt).
//
// Every expected number is written twice: by hand in the fixture comments,
// and by store.js on the attempt READ BACK from the browser's localStorage.
// `--dry` prints the fixture and runs the hand-vs-store.js checks, no browser.
//
// Awards are pre-marked as celebrated (every award any state in this walk can
// earn) so an unlock overlay can't sit on top of the sheet. walk-awards.mjs
// owns celebrations; this walk owns the sheet.
//
// Synthetic data only. James's real data never enters this repo; it is public.
//
// Usage: node scripts/e2e/walk-fixday.mjs [--dist DIR] [--out DIR] [--port N] [--keep] [--dry]
import { chromium } from 'playwright-core';
import * as e2e from './lib.mjs';
import { generatePlan } from '../../src/planGenerator.js';
import { capForDay } from '../../src/plan.js';
import {
  statusForDay, pouchesForDay, timedPouchesForDay, missedDays, todayKey, triggersFor, reasonFor, fmtTime,
} from '../../src/store.js';
import { awardsFor } from '../../src/awards.js';
import { dayKeyAt, offsetMinInZone } from '../../src/time.js';

const args = e2e.parseArgs({ name: 'walk-fixday', port: 4339 });
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------- the clock */

// Node and the browser must agree on "today", or yesterday quietly becomes
// today and the sheet shows "corrections open tomorrow". Both run in Chicago,
// and store.js is only ever called here inside atNow().
const TZ = 'America/Chicago';
process.env.TZ = TZ;
const NOW = '2026-09-24T10:00:00-05:00'; // Thu, CDT — mid-morning, nothing logged yet today
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
// Same formatting the sheet, History and Calendar use (local noon).
const monthDayOf = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const FIX_N = TODAY_N - 1; // yesterday, the day being fixed
const FIX_DAY = dayOf(FIX_N);
const FIX_LABEL = `Day ${FIX_N}, ${monthDayOf(FIX_DAY)}`; // "Day 2, Sep 23"

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

// By hand:
//
//   d1  Tue 9/22  6 pouches   green   6/8
//   d2  Wed 9/23  4 pouches   green   4/8   ← the day being fixed
//   d3  Thu 9/24  today, unlogged at 10 AM
//
//   Correct d2 to 10:  pouchesForDay = max(4 timed, 10) = 10 > cap 8 → yellow
//   Reasons on d2's first pouch: coffee + stress, note NOTE
const PATTERN = { 1: 6, [FIX_N]: 4 };
const TOTAL = 10;
const CHIPS = ['coffee', 'stress'];
const NOTE = 'synthetic: first one with the morning coffee';

function buildEvents() {
  const stage = PLAN.stages[0];
  let k = 0;
  const mk = (type, ms, extra = {}) => {
    const tzOffsetMin = offsetMinInZone(ms, TZ);
    return { id: `fx-${++k}`, ts: new Date(ms).toISOString(), tzOffsetMin, day: dayKeyAt(ms, tzOffsetMin), type, trigger: null, ...extra };
  };
  const events = [];
  for (let n = 1; n < TODAY_N; n++) {
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
// The pouch the walk gives reasons to: d2's first.
const TARGET = EVENTS.find((e) => e.type === 'pouch' && e.day === FIX_DAY);
const TARGET_LABEL = `Pouch at ${fmtTime(TARGET)}`;

// What api.logCorrection / api.logReason append: stamped NOW, filed under d2.
const stampNow = (type, extra) => ({
  id: `expected-${type}`, ts: new Date(NOW_MS).toISOString(), tzOffsetMin: offsetMinInZone(NOW_MS, TZ),
  day: FIX_DAY, type, trigger: null, ...extra,
});
const CORRECTION = stampNow('correction', { count: TOTAL });
const REASON = stampNow('reason', { target: TARGET.id, triggers: CHIPS, note: NOTE });
const withEvents = (attempt, list) => ({ ...attempt, events: [...attempt.events, ...list] });

// Every award any state of this walk can reach, pre-marked as celebrated.
function celebratedFor(attempt) {
  const states = [attempt, withEvents(attempt, [CORRECTION]), withEvents(attempt, [CORRECTION, REASON])];
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

function domainChecks(rec) {
  rec.section('domain · hand derivation vs store.js (no browser)');
  const { attempt } = FIX;
  rec.check(`Pinned clock: Node and store.js agree today is Thu ${TODAY} (Day ${TODAY_N})`,
    atNow(() => todayKey()) === TODAY && TODAY_N === 3, `todayKey ${atNow(() => todayKey())}, day ${TODAY_N}`);
  const caps = Array.from({ length: TODAY_N }, (_, i) => capForDay(PLAN, i + 1));
  rec.check(`Every fixture day has cap ${CAP} (Baseline hold)`, caps.every((c) => c === CAP), caps.join(','));
  rec.check('No missed day, so no backfill prompt covers the walk', atNow(() => missedDays(attempt)).length === 0);
  const s0 = atNow(() => statusForDay(attempt, FIX_DAY));
  rec.check(`Seeded: d${FIX_N} is green 4/${CAP} (a logged, in-plan past day)`,
    s0 === 'green' && atNow(() => pouchesForDay(attempt, FIX_DAY)) === 4, `${s0} ${atNow(() => pouchesForDay(attempt, FIX_DAY))}`);
  const fixed = withEvents(attempt, [CORRECTION, REASON]);
  const s1 = atNow(() => statusForDay(fixed, FIX_DAY));
  rec.check(`After the correction: d${FIX_N} is yellow ${TOTAL}/${CAP}, 4 still timed`,
    s1 === 'yellow' && atNow(() => pouchesForDay(fixed, FIX_DAY)) === TOTAL && atNow(() => timedPouchesForDay(fixed, FIX_DAY)) === 4,
    `${s1} ${atNow(() => pouchesForDay(fixed, FIX_DAY))} (${atNow(() => timedPouchesForDay(fixed, FIX_DAY))} timed)`);
  rec.check(`After the reason: the pouch reads ${CHIPS.join(', ')} + the note`,
    JSON.stringify(triggersFor(fixed, TARGET)) === JSON.stringify(CHIPS) && reasonFor(fixed, TARGET)?.note === NOTE);
}

function printFixture() {
  log(`\nclock: ${NOW} (${TZ}) — today ${TODAY} = Day ${TODAY_N}; fixing ${FIX_LABEL}`);
  log(`plan: 90 days from ${START} → quit ${PLAN.quitDate}; stage 1 "${PLAN.stages[0].name}" at ${CAP}/day`);
  log('storage: pouch-down-v1 absent · pouch-down-v2 = { a2 active }');
  for (let n = 1; n < TODAY_N; n++) {
    const st = atNow(() => statusForDay(FIX.attempt, dayOf(n)));
    log(`  d${n} ${monthDayOf(dayOf(n)).padEnd(7)} ${String(PATTERN[n] ?? 0).padEnd(3)} ${st}`);
  }
  log(`  events ${EVENTS.length} · reasons go on "${TARGET_LABEL}" · celebratedAwards ${FIX.attempt.celebratedAwards.join(', ')}`);
  log('  steps:');
  STEPS.forEach((s, k) => log(`   ${String(k + 1).padStart(2)}. ${s}`));
}

const STEPS = [
  `Stats → History pencil "Fix ${FIX_LABEL}" → sheet "Fix this day" for d${FIX_N}, stepper at 4, Fewer disabled`,
  `More ×${TOTAL - 4} → reads ${TOTAL}; verdict "${TOTAL} of ${CAP} — over…" → Save total → "Corrected … · was 4"`,
  `tap "${TARGET_LABEL}" → chips ${CHIPS.join(' + ')} (aria-pressed) + note → Save reasons → row shows both + note`,
  'Done → sheet closes; storage: exactly one correction + one reason appended, seeded events byte-identical',
  'Calendar cell opens the same sheet for the same day → Done',
  `reload (no re-seed) → History "Corrected total: ${TOTAL} (4 timed)", reasons on the pouch; Calendar amber ${TOTAL}/${CAP}`,
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

async function tab(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(600);
}

// The sheet is open, and for the day we meant.
async function checkSheetFor(rec, page, L) {
  const sheet = sheetLoc(page);
  const up = await sheet.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  rec.check(`${L} "Fix this day" sheet opens`, up);
  if (!up) return false;
  const text = await sheet.innerText();
  rec.check(`${L} sheet is for Day ${FIX_N} · ${monthDayOf(FIX_DAY)}`,
    text.includes(`Day ${FIX_N} ·`) && text.includes(monthDayOf(FIX_DAY)), text.split('\n').slice(0, 3).join(' | '));
  return true;
}

async function closeSheet(rec, page, L) {
  await sheetLoc(page).getByRole('button', { name: 'Done', exact: true }).click();
  const gone = await sheetLoc(page).waitFor({ state: 'hidden', timeout: 5000 }).then(() => true, () => false);
  rec.check(`${L} Done closes the sheet`, gone);
}

// The pouch row's visible text: time · slot · verdict · tags, and the note.
const rowText = (page) => sheetLoc(page).getByRole('button', { name: TARGET_LABEL }).innerText().catch(() => '');

// History: expand d2's section and read its rows.
async function historyRows(page) {
  const toggle = page.locator('button[aria-expanded]').filter({ hasText: new RegExp(`^Day ${FIX_N}\\b`) }).first();
  await toggle.scrollIntoViewIfNeeded();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.waitForTimeout(500);
  // The section's rows sit in the same row wrapper as its toggle.
  return toggle.locator('xpath=..').innerText();
}

async function calendarCell(page) {
  const cell = page.locator(`[aria-label^="${FIX_LABEL}:"]`).first();
  await cell.waitFor({ state: 'visible', timeout: 5000 });
  return { cell, aria: (await cell.getAttribute('aria-label')) ?? '', cls: String((await cell.getAttribute('class')) ?? '') };
}

function checkAppendOnly(rec, L, stored) {
  const evs = stored?.events ?? [];
  const bad = EVENTS.filter((e, i) => JSON.stringify(evs[i]) !== JSON.stringify(e)).length;
  rec.check(`${L} all ${EVENTS.length} seeded events byte-identical, in order`, bad === 0 && evs.length >= EVENTS.length,
    bad ? `${bad} changed/missing` : '');
  const added = evs.slice(EVENTS.length);
  rec.check(`${L} exactly two new events: a correction, then a reason`,
    added.length === 2 && added[0]?.type === 'correction' && added[1]?.type === 'reason',
    added.map((e) => `${e.type}/${e.day}`).join(', ') || 'none');
  const [c, r] = added;
  const entered = (e) => (e && Number.isFinite(Date.parse(e.ts)) ? dayKeyAt(Date.parse(e.ts), e.tzOffsetMin) : null);
  rec.check(`${L} correction: day ${FIX_DAY} · count ${TOTAL} · entered today (CDT)`,
    !!c && c.day === FIX_DAY && c.count === TOTAL && entered(c) === TODAY && c.tzOffsetMin === -300,
    c ? JSON.stringify({ day: c.day, count: c.count, ts: c.ts, tz: c.tzOffsetMin }) : 'missing');
  rec.check(`${L} reason: targets d${FIX_N}'s first pouch · ${CHIPS.join(' + ')} · the note`,
    !!r && r.target === TARGET.id && JSON.stringify([...(r.triggers ?? [])].sort()) === JSON.stringify([...CHIPS].sort()) && r.note === NOTE,
    r ? JSON.stringify({ target: r.target, triggers: r.triggers, note: r.note }) : 'missing');
  const ids = evs.map((e) => e.id);
  rec.check(`${L} event ids unique`, new Set(ids).size === ids.length);
}

async function walk(browser, base, rec) {
  const L = 'fix:';
  const ctx = await e2e.phoneContext(browser, { tz: TZ, now: NOW });
  await e2e.seedStorage(ctx, { 'pouch-down-v1': null, 'pouch-down-v2': FIX.rootJSON });
  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, 'fix');

  rec.section('open');
  await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' });
  const up = await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
  rec.check(`${L} Today renders with the streak chip`, up);
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} boot`);
  rec.check(`${L} no backfill prompt on open`, !/No log for/i.test(await e2e.bodyText(page)));
  await rec.snap(page, 'open');

  // Door 1: the History pencil on Stats.
  rec.section('History pencil → correct the total');
  await tab(page, 'Stats');
  const pencil = page.getByRole('button', { name: `Fix ${FIX_LABEL}`, exact: true });
  const hasPencil = await pencil.count().then((n) => n === 1);
  rec.check(`${L} History shows the pencil "Fix ${FIX_LABEL}"`, hasPencil);
  if (hasPencil) {
    await pencil.scrollIntoViewIfNeeded();
    await pencil.click();
  }
  if (!(await checkSheetFor(rec, page, `${L} [pencil]`))) return errors;
  const sheet = sheetLoc(page);
  await rec.snap(page, 'sheet-open');

  const input = sheet.getByRole('spinbutton', { name: 'Actual total' });
  rec.check(`${L} stepper starts at the timed count (4)`, (await input.inputValue()) === '4', `reads ${await input.inputValue()}`);
  rec.check(`${L} "Fewer" is disabled at the timed count — a total can't go below what was logged`,
    await sheet.getByRole('button', { name: 'Fewer', exact: true }).isDisabled());
  rec.check(`${L} "Save total" is disabled until the total changes`,
    await sheet.getByRole('button', { name: 'Save total', exact: true }).isDisabled());

  // Like a thumb would: one tap at a time.
  const more = sheet.getByRole('button', { name: 'More', exact: true });
  for (let i = 0; i < 45 && (await input.inputValue()) !== String(TOTAL); i++) await more.click();
  rec.check(`${L} "More" steps the total to ${TOTAL}`, (await input.inputValue()) === String(TOTAL), `reads ${await input.inputValue()}`);
  const verdict = sheet.getByRole('status').first();
  const vText = await verdict.innerText();
  rec.check(`${L} live verdict: "${TOTAL} of ${CAP} — over, streak breaks; tomorrow’s cap doesn’t change"`,
    vText.startsWith(`${TOTAL} of ${CAP} — over`) && /tomorrow.s cap doesn.t change/.test(vText), vText);
  const vColor = await verdict.evaluate((el) => getComputedStyle(el).color);
  const amber = await page.evaluate(() => {
    const p = document.createElement('p');
    p.style.color = 'var(--amber)';
    document.body.append(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
  rec.check(`${L} verdict is amber (over cap, never alarm-red)`, vColor === amber, `${vColor} vs amber ${amber}`);
  await rec.snap(page, 'sheet-total-10');

  await sheet.getByRole('button', { name: 'Save total', exact: true }).click();
  await page.waitForTimeout(500);
  await clearOverlay(page, `${L} after Save total`);
  const afterSave = await sheet.innerText();
  rec.check(`${L} corrected line: "Corrected ${monthDayOf(TODAY)} · was 4"`,
    afterSave.includes(`Corrected ${monthDayOf(TODAY)} · was 4`), afterSave.match(/Corrected[^\n]*/)?.[0] ?? 'no corrected line');
  // The pill is uppercased by CSS, so innerText reads "OVER".
  const head = afterSave.split('\n').slice(0, 4).join(' ');
  rec.check(`${L} status pill now reads "over"`, /\bover\b/i.test(head), head);
  rec.check(`${L} stepper keeps ${TOTAL} after saving`, (await input.inputValue()) === String(TOTAL));
  await rec.snap(page, 'sheet-saved');

  // Reasons on a pouch.
  rec.section('pouch reasons');
  const row = sheet.getByRole('button', { name: TARGET_LABEL, exact: true });
  const hasRow = await row.count().then((n) => n === 1);
  rec.check(`${L} pouch row "${TARGET_LABEL}" in the sheet`, hasRow);
  if (hasRow) {
    await row.click();
    await page.waitForTimeout(400);
    for (const t of CHIPS) {
      const chip = sheet.getByRole('button', { name: t, exact: true });
      await chip.click();
      rec.check(`${L} chip "${t}" selected (aria-pressed)`, (await chip.getAttribute('aria-pressed')) === 'true');
    }
    const others = await sheet.locator('button[aria-pressed="true"]').count();
    rec.check(`${L} exactly ${CHIPS.length} chips pressed`, others === CHIPS.length, `${others} pressed`);
    await sheet.getByRole('textbox', { name: 'Note', exact: true }).fill(NOTE);
    await rec.snap(page, 'reason-editor');
    await sheet.getByRole('button', { name: 'Save reasons', exact: true }).click();
    const closed = await sheet.getByRole('button', { name: 'Save reasons', exact: true })
      .waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
    rec.check(`${L} "Save reasons" closes the editor`, closed);
    const rt = await rowText(page);
    rec.check(`${L} row shows both chips: "${CHIPS.join(', ')}"`, rt.includes(CHIPS.join(', ')), rt.replace(/\s+/g, ' '));
    rec.check(`${L} row shows the note`, rt.includes(NOTE), rt.replace(/\s+/g, ' '));
    await rec.snap(page, 'reason-saved');
  }

  await closeSheet(rec, page, L);
  await clearOverlay(page, `${L} after Done`);

  const stored = storedA2(await storedRoot(page));
  checkAppendOnly(rec, L, stored);
  rec.check(`${L} store.js on the STORED attempt: d${FIX_N} yellow ${TOTAL}/${CAP}, 4 timed`,
    atNow(() => statusForDay(stored, FIX_DAY)) === 'yellow' && atNow(() => pouchesForDay(stored, FIX_DAY)) === TOTAL
      && atNow(() => timedPouchesForDay(stored, FIX_DAY)) === 4);

  // Door 2: the Calendar cell opens the same sheet for the same day.
  rec.section('Calendar cell → same sheet');
  await tab(page, 'Calendar');
  const c0 = await calendarCell(page);
  rec.check(`${L} calendar cell "${FIX_LABEL}" is a button`, (await c0.cell.evaluate((el) => el.tagName)) === 'BUTTON');
  await c0.cell.click();
  if (await checkSheetFor(rec, page, `${L} [calendar]`)) {
    const input2 = sheetLoc(page).getByRole('spinbutton', { name: 'Actual total' });
    rec.check(`${L} [calendar] stepper opens at the corrected ${TOTAL}`, (await input2.inputValue()) === String(TOTAL));
    await rec.snap(page, 'calendar-sheet');
    await closeSheet(rec, page, `${L} [calendar]`);
  }

  // Reload: no re-seed, so everything shown now came from what the app saved.
  rec.section('reload');
  const before = JSON.stringify(stored.events);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await chipLoc(page).waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  await clearOverlay(page, `${L} reload`);
  rec.check(`${L} after reload the correction and reason are still stored (seeding did not re-run)`,
    JSON.stringify(storedA2(await storedRoot(page))?.events) === before);

  await tab(page, 'Stats');
  const hist = await historyRows(page);
  rec.check(`${L} History: "Corrected total: ${TOTAL} (4 timed)"`, hist.includes(`Corrected total: ${TOTAL} (4 timed)`),
    hist.match(/Corrected[^\n]*/)?.[0] ?? 'no corrected line');
  rec.check(`${L} History header reads ${TOTAL}/${CAP}`, hist.includes(`${TOTAL}/${CAP}`), hist.split('\n').slice(0, 2).join(' | '));
  rec.check(`${L} History pouch row shows ${CHIPS.join(', ')} and the note`,
    hist.includes(CHIPS.join(', ')) && hist.includes(NOTE));
  rec.check(`${L} History draws no row for the reason event itself (it shows on its pouch)`,
    hist.split(NOTE).length === 2, `note appears ${hist.split(NOTE).length - 1}×`);
  await rec.snap(page, 'reload-history', { fullPage: true });

  await pencilReopen(rec, page, L);

  await tab(page, 'Calendar');
  const c1 = await calendarCell(page);
  await rec.snap(page, 'reload-calendar');
  rec.check(`${L} calendar cell label "${FIX_LABEL}: ${TOTAL} of ${CAP} pouches"`, c1.aria === `${FIX_LABEL}: ${TOTAL} of ${CAP} pouches`, c1.aria);
  rec.check(`${L} calendar cell is amber (cal-yellow), not green`, /\bcal-yellow\b/.test(c1.cls) && !/\bcal-green\b/.test(c1.cls), c1.cls);
  rec.check(`${L} calendar cell text ${TOTAL}/${CAP}`, (await c1.cell.innerText()).includes(`${TOTAL}/${CAP}`));

  await e2e.v1Unchanged(page, null, rec);
  if (!args.keep) await ctx.close();
  return errors;
}

// After the reload, the sheet itself still shows the reasons on the pouch.
async function pencilReopen(rec, page, L) {
  const pencil = page.getByRole('button', { name: `Fix ${FIX_LABEL}`, exact: true });
  await pencil.scrollIntoViewIfNeeded();
  await pencil.click();
  if (!(await checkSheetFor(rec, page, `${L} [reload]`))) return;
  const rt = await rowText(page);
  rec.check(`${L} [reload] sheet's pouch row still shows ${CHIPS.join(', ')} and the note`,
    rt.includes(CHIPS.join(', ')) && rt.includes(NOTE), rt.replace(/\s+/g, ' '));
  const text = await sheetLoc(page).innerText();
  rec.check(`${L} [reload] sheet still reads "Corrected ${monthDayOf(TODAY)} · was 4"`, text.includes(`Corrected ${monthDayOf(TODAY)} · was 4`));
  await closeSheet(rec, page, `${L} [reload]`);
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
