// Proves the awards UI in a real browser — the part the unit suite cannot see:
// does the unlock actually RENDER, does the celebration REPLAY, and is the
// trophy case reachable from both doors on a 390px phone.
//
// Seven flows, seven browser contexts (1+2 share one; 6 runs twice):
//   1   the unlock plays          (animations ON, captured at three beats)
//   2   it does NOT replay        (drain the queue, reload twice)
//   3   the trophy case           (Stats card + both doors from Today; its own
//                                  context — see the note at flow 3)
//   1b  the streak badge alone    (its own batch; the cap pushes it out of 1)
//   4   THE PLAN'S C1 FLOW 4      (3 green finished days → "3-day streak" →
//                                  dismiss each → reload twice → none; stored
//                                  celebratedAwards is exactly the batch)
//   5   read-only Attempt 1       (migrated from v1; NO overlay, ever)
//   6   ?static and reduce        (renders, dismissible, no confetti canvas)
//
// Synthetic data only. Both v2 fixtures are built here from planGenerator.js,
// and each expected unlock batch is computed here from awards.js with the same
// two comparators AwardUnlock.jsx uses — so the walk asserts the UI against the
// domain rather than against a hardcoded guess. James's real data never enters
// this repo; it is public.
//
// THE CLOCK IS PINNED. Every context boots at NOW (Mon 2026-09-21, 8 PM,
// America/Chicago) via phoneContext({ now }), and this process scores the
// fixtures at that same instant in that same zone (`atNow` below) — so the walk
// gives the same answer next month as tonight. `--now ISO` moves the instant,
// which is how to aim the fixture across a DST change (e.g. --now
// 2026-11-03T20:00:00-06:00 puts day 2 on the fall-back day); the fixture
// checks verify every event's stamped day, offset and wall-clock time whatever
// instant you pick, so the DST handling in `tsFor` is tested, not trusted.
//
// The one hard invariant, same as every walk: `pouch-down-v1` must be
// byte-identical at the end of every context. It is the rollback, and nothing
// in the app may ever write it.
//
// Plumbing (build, preview, phone, seeding, recorder, exit code) is lib.mjs.
//
// Usage: node scripts/e2e/walk-awards.mjs [--dist DIR] [--out DIR] [--port N]
//          [--now ISO] [--keep] [--dry]
//   --dist  serve this build instead of building one (run-all passes it)
//   --dry   print what the fixtures earn and run the fixture checks — no build,
//           no browser; how you check a fixture change in a second
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as e2e from './lib.mjs';
import { seedV1String } from './seed-v1.mjs';
import { generatePlan } from '../../src/planGenerator.js';
import { newlyEarned } from '../../src/awards.js';
import { offsetMinInZone, dayKeyAt, DAY_CUTOFF_HOURS } from '../../src/time.js';
import { todayKey, statusForDay, dayNumberFor } from '../../src/store.js';
import { TIER_RANK } from '../../src/components/awards/tiers.js';

const args = e2e.parseArgs({ name: 'walk-awards', port: 4335 });

/* -------------------------------------------------------------------- clock */

// One zone for everyone: the phone (phoneContext's timezoneId) and this Node
// process, which awards.js asks for "today" through store.js.
const TZ = 'America/Chicago';
process.env.TZ = TZ; // Node re-reads its zone when this is assigned

const nowFlag = (() => {
  const i = process.argv.indexOf('--now');
  return i === -1 ? null : process.argv[i + 1];
})();
const NOW = nowFlag ?? '2026-09-21T20:00:00-05:00';
const NOW_MS = Date.parse(NOW);
if (!Number.isFinite(NOW_MS)) throw new Error(`--now: can't read "${NOW}" as a time`);

// Runs fn with this process's clock stopped at NOW. awards.js → asOfDay →
// todayKey() calls `new Date()`; without this the expected batch would be
// scored at the real "now" while the phone is scoring the pinned one.
function atNow(fn) {
  const Real = globalThis.Date;
  class Pinned extends Real {
    constructor(...a) { super(...(a.length ? a : [NOW_MS])); }
    static now() { return NOW_MS; }
  }
  globalThis.Date = Pinned;
  try { return fn(); } finally { globalThis.Date = Real; }
}

const TODAY = dayKeyAt(NOW_MS, offsetMinInZone(NOW_MS, TZ));

/* ------------------------------------------------------------------ fixture */

const epochDay = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86400000);
const dayStrOf = (ed) => new Date(ed * 86400000).toISOString().slice(0, 10);
const addDays = (s, n) => dayStrOf(epochDay(s) + n);
const pad = (n) => String(n).padStart(2, '0');
const addMin = (hm, plus) => {
  const [h, m] = hm.split(':').map(Number);
  const t = h * 60 + m + plus;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

const SETTINGS = {
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' },
  costPerTin: 5,
  pouchesPerTin: 20,
  wakeTime: '07:00',
  sleepTime: '23:00',
};

// Day 1 = three days ago, so days 1–3 are all SETTLED (the day is over) — which
// is what awards.js requires before a green day may count toward a streak.
const START = addDays(TODAY, -3);

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

const slotHM = (slot) => (slot.anchor === 'fixed' ? slot.time : addMin(SETTINGS.mealTimes[slot.anchor], slot.offsetMin || 0));

// Local wall-clock time on `day`, in TZ, as epoch ms. Resolved twice so a DST
// shift between the guess and the answer doesn't leave it an hour out.
const tsFor = (day, hm, plusMin = 0) => {
  const [h, m] = hm.split(':').map(Number);
  const naive = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m + plusMin) * 60000;
  const ms = naive - offsetMinInZone(naive, TZ) * 60000;
  return naive - offsetMinInZone(ms, TZ) * 60000;
};

// What each event was MEANT to be, by id — checked against what it came out as.
const WANT = new Map();

const mkEvent = (id, type, ms, extra = {}) => {
  const tzOffsetMin = offsetMinInZone(ms, TZ);
  return {
    id,
    ts: new Date(ms).toISOString(),
    tzOffsetMin,
    day: dayKeyAt(ms, tzOffsetMin),
    type,
    trigger: null,
    ...extra,
  };
};

// Days 1–3: seven pouches a day, every one five minutes AFTER its slot unlocks.
// Under the cap of nine (green, so the streak runs) and never early (so the
// whole day classifies on-time). `resisted` adds two ridden-out cravings on
// day 2 — the main fixture wants them (a 4th award, so the cap of three is
// exercised); flow 4's plain "three green days" doesn't.
function buildEvents(prefix, { resisted }) {
  const stage = PLAN.stages[0];
  const events = [];
  let n = 0;
  const push = (type, day, hm, plusMin, extra) => {
    const ev = mkEvent(`${prefix}-${++n}`, type, tsFor(day, hm, plusMin), extra);
    WANT.set(ev.id, { day, hm: addMin(hm, plusMin) });
    events.push(ev);
  };
  const firstHM = slotHM(stage.slots[0]);
  for (let d = 1; d <= 3; d++) {
    const day = addDays(START, d - 1);
    const firstSlotAt = new Date(tsFor(day, firstHM)).toISOString();
    for (let i = 0; i < 7; i++) {
      const slot = stage.slots[i];
      const hm = slotHM(slot);
      push('pouch', day, hm, 5, {
        trigger: i === 0 ? 'routine' : null,
        ctx: {
          nth: i + 1,
          cap: stage.pouchesPerDay,
          slotId: slot.id,
          slotLabel: slot.label,
          slotAt: new Date(tsFor(day, hm)).toISOString(),
          firstSlotAt,
        },
      });
    }
    if (resisted && d === 2) {
      push('resisted', day, '15:20', 0, { trigger: 'stress' });
      push('resisted', day, '16:40', 0, { trigger: 'boredom' });
    }
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  return events;
}

const makeAttempt = (events) => ({
  id: 'a1',
  status: 'active',
  createdAt: events[0].ts,
  archivedAt: null,
  settings: SETTINGS,
  plan: PLAN,
  events,
  celebratedStages: [],
  celebratedAwards: [],
  checkinDismissedFor: TODAY, // keeps the morning card out of the Today shots
});

const ATTEMPT = makeAttempt(buildEvents('walk', { resisted: true })); // flows 1–3, 1b, 6
const STREAK_ATTEMPT = makeAttempt(buildEvents('streak', { resisted: false })); // flow 4

// `already` pre-marks awards as celebrated, which is how flow 1b isolates a
// single badge — the streak — into a batch of its own.
const rootJSON = (attempt, already = []) =>
  JSON.stringify({
    version: 2,
    device: { apiKey: '' },
    activeAttemptId: attempt.id,
    attempts: [{ ...attempt, celebratedAwards: already }],
  });
const V1 = seedV1String();

/* ------------------------------------- what AwardUnlock should decide to show */

// Same two comparators AwardUnlock.jsx uses: rarest three get an overlay, in
// build order; anything past three is marked without ever being shown.
const byRarity = (a, b) =>
  TIER_RANK[b.tier] - TIER_RANK[a.tier] || String(a.earnedOn).localeCompare(String(b.earnedOn));
const byBuild = (a, b) =>
  TIER_RANK[a.tier] - TIER_RANK[b.tier] || String(a.earnedOn).localeCompare(String(b.earnedOn));

function batchFor(attempt) {
  const earned = atNow(() => newlyEarned(attempt));
  const ranked = [...earned].sort(byRarity);
  return { earned, shown: ranked.slice(0, 3).sort(byBuild), overflow: ranked.slice(3) };
}

const { earned: EARNED, shown: EXPECTED, overflow: OVERFLOW } = batchFor(ATTEMPT);
const STREAK = batchFor(STREAK_ATTEMPT);

// The dismiss button's label. honest-yellow is moving to "Got it" (so "Nice"
// doesn't read as cheering the slip); either is accepted for it until that
// lands, and every other award must say "Nice".
const ackRx = (a) => (a.id === 'honest-yellow' ? /^(Got it|Nice)$/i : /^Nice$/i);

/* ----------------------------------------------------------------- browser */

const UNLOCK = '[role="dialog"][aria-modal="true"]';

// An init script that stamps the instant the unlock first appears, so the three
// animation screenshots can report honest offsets instead of guesses.
const WATCH = `
  window.__unlockAt = null;
  window.__mark = () => {
    if (window.__unlockAt === null && document.querySelector('${UNLOCK}')) {
      window.__unlockAt = performance.now();
    }
  };
  document.addEventListener('DOMContentLoaded', () => {
    try {
      new MutationObserver(window.__mark).observe(document.body, { childList: true, subtree: true });
      window.__mark();
    } catch (e) {}
  });
`;

const rec = e2e.createRecorder(args.out);
const check = rec.check;
const allErrors = [];

// `root` null seeds ONLY the v1 key, so the app migrates it (flow 5). Seeding
// is once per context (lib's cookie gate), so a reload never hands the app a
// fresh `celebratedAwards: []` and fakes a replay.
async function openContext(browser, label, { root = rootJSON(ATTEMPT), reducedMotion } = {}) {
  const ctx = await e2e.phoneContext(browser, { tz: TZ, now: NOW_MS, ...(reducedMotion ? { reducedMotion } : {}) });
  await e2e.seedStorage(ctx, { 'pouch-down-v1': V1, 'pouch-down-v2': root });
  await ctx.addInitScript(WATCH);
  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, label);
  allErrors.push(errors);
  return { ctx, page };
}

const open = (page, base, query = '') => page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' });
const bodyText = e2e.bodyText;
const overlayCount = (page) => page.locator(UNLOCK).count();
// canvas-confetti appends its canvas straight to <body>; nothing else in the
// app does, so this is an exact test for "confetti happened".
const confettiCanvases = (page) => page.evaluate(() => document.querySelectorAll('body > canvas').length);
const sinceUnlock = (page) =>
  page.evaluate(() => (window.__unlockAt === null ? null : Math.round(performance.now() - window.__unlockAt)));
// rec.snap only calls .screenshot({ path }), which a Locator has too — so an
// element shot goes through the same numbered sequence as a page shot.
const snap = (target, name) => rec.snap(target, name);

async function overflowCheck(page, where) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`No horizontal overflow · ${where}`, w <= 390, `scrollWidth ${w}`);
}

// Watches for the whole window — a celebration that arrives late is still a
// replay.
async function assertNoOverlay(page, label, ms = 2200) {
  const deadline = Date.now() + ms;
  let seen = 0;
  while (Date.now() < deadline) {
    seen = Math.max(seen, await overlayCount(page));
    if (seen) break;
    await page.waitForTimeout(150);
  }
  check(label, seen === 0, seen ? 'AN UNLOCK OVERLAY APPEARED' : '');
  return seen === 0;
}

// The overlay's own text (not the page's), or '' when there is none.
const overlayText = async (page) => {
  const loc = page.locator(UNLOCK).first();
  return (await loc.count()) ? loc.innerText().catch(() => '') : '';
};
async function waitForOverlay(page, title, ms = 4000) {
  const deadline = Date.now() + ms;
  let t = '';
  while (Date.now() < deadline) {
    t = await overlayText(page);
    if (t.includes(title)) return t;
    await page.waitForTimeout(120);
  }
  return t;
}

const celebrated = async (page) => {
  try {
    const r = JSON.parse(await e2e.readStorage(page, 'pouch-down-v2'));
    return r.attempts.find((a) => a.id === r.activeAttemptId)?.celebratedAwards ?? [];
  } catch {
    return null;
  }
};
// Exactly these ids: same members, no extras, no duplicates.
const sameIds = (got, want) =>
  Array.isArray(got) && got.length === want.length && new Set(got).size === got.length && want.every((id) => got.includes(id));

// lib's v1Unchanged, with the context named in the label so a failure says where.
const v1Same = (page, where) =>
  e2e.v1Unchanged(page, V1, { check: (label, ok, detail) => check(`${label} · ${where}`, ok, detail) });

/* ---------------------------------------------------------- fixture checks */

function fixtureChecks() {
  const fmt = (xs) => xs.map((a) => a.title).join(' → ') || '(none)';
  const nowLocal = new Date(NOW_MS).toLocaleString('en-US', { timeZone: TZ });
  console.log(`\nfixture: NOW ${NOW} = ${nowLocal} (${TZ}); plan starts ${START}, today is ${TODAY}`);
  console.log(`  main   earned: ${EARNED.map((a) => `${a.title} [${a.tier} ${a.earnedOn}]`).join(', ') || '(none)'}`);
  console.log(`         overlays: ${fmt(EXPECTED)} · silently marked: ${OVERFLOW.map((a) => a.title).join(', ') || '(none)'}`);
  console.log(`  flow 4 earned: ${STREAK.earned.map((a) => `${a.title} [${a.tier} ${a.earnedOn}]`).join(', ') || '(none)'}`);
  console.log(`         overlays: ${fmt(STREAK.shown)} · silently marked: ${STREAK.overflow.map((a) => a.title).join(', ') || '(none)'}`);

  rec.section('fixture (a failure here is a HARNESS problem, not a product one)');
  // The pinned clock has to actually reach the domain code, or every "expected"
  // below is scored against the wrong day.
  check("Fixture: Node's pinned clock and the stamped NOW agree on today",
    atNow(() => todayKey()) === TODAY, `todayKey ${atNow(() => todayKey())} vs ${TODAY}`);
  // A walk takes a few minutes of real time on a clock that keeps ticking; if
  // it straddled the 4 AM cutoff, "today" would change under it.
  const localMin = (() => {
    const off = offsetMinInZone(NOW_MS, TZ);
    const d = new Date(NOW_MS + off * 60000);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();
  const toCutoff = (DAY_CUTOFF_HOURS * 60 - localMin + 1440) % 1440;
  check('Fixture: NOW is at least an hour clear of the 4 AM day cutoff', toCutoff >= 60, `${toCutoff} min to cutoff`);
  check('Fixture: day 3 is settled (before today)', addDays(START, 2) < TODAY, `day3=${addDays(START, 2)} today=${TODAY}`);

  // tsFor's DST handling, proven on every event rather than trusted: the day it
  // is stamped with, the offset it carries, and the wall-clock time it shows in
  // TZ must all be what the fixture asked for.
  const hmIn = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
  const bad = [...ATTEMPT.events, ...STREAK_ATTEMPT.events].filter((e) => {
    const want = WANT.get(e.id);
    const ms = Date.parse(e.ts);
    return !want || e.day !== want.day || e.tzOffsetMin !== offsetMinInZone(ms, TZ) || hmIn.format(new Date(ms)) !== want.hm;
  });
  const offsets = [...new Set(ATTEMPT.events.map((e) => e.tzOffsetMin))].join('/');
  check('Fixture: every seeded event is stamped with the day, offset and wall-clock time it was meant for',
    bad.length === 0,
    bad.length ? bad.slice(0, 3).map((e) => `${e.id} ${e.ts} day=${e.day} want ${JSON.stringify(WANT.get(e.id))}`).join('; ')
      : `days ${[...new Set(ATTEMPT.events.map((e) => e.day))].join(',')} · offsets ${offsets}`);

  check('Fixture: streak-3 is earned', EARNED.some((a) => a.id === 'streak-3'));
  check('Fixture: more than three awards earned (exercises the cap)', EARNED.length > 3, `${EARNED.length} earned`);

  // Flow 4's premise, asked of the domain: three FINISHED green days, and today
  // is day 4 — then the streak must be in the batch the app will show.
  const statuses = atNow(() => [1, 2, 3].map((n) => statusForDay(STREAK_ATTEMPT, addDays(START, n - 1))));
  check('Fixture (flow 4): days 1–3 are green and finished; today is day 4',
    statuses.every((s) => s === 'green') && dayNumberFor(STREAK_ATTEMPT, TODAY) === 4,
    `days 1–3 ${statuses.join('/')} · today is day ${dayNumberFor(STREAK_ATTEMPT, TODAY)}`);
  check('Fixture (flow 4): the 3-day streak is in the batch AwardUnlock will show',
    STREAK.shown.some((a) => a.id === 'streak-3'), `batch: ${fmt(STREAK.shown)}`);

  writeFileSync(join(args.out, 'fixture.json'), JSON.stringify({
    now: NOW, timeZone: TZ, today: TODAY, planStart: START,
    main: { earned: EARNED.map((a) => ({ id: a.id, tier: a.tier, earnedOn: a.earnedOn })), shown: EXPECTED.map((a) => a.id), overflow: OVERFLOW.map((a) => a.id) },
    flow4: { earned: STREAK.earned.map((a) => ({ id: a.id, tier: a.tier, earnedOn: a.earnedOn })), shown: STREAK.shown.map((a) => a.id), overflow: STREAK.overflow.map((a) => a.id) },
  }, null, 2));
}

/* --------------------------------------------------------------- the walk */

async function main() {
  fixtureChecks();
  // `--dry` stops here: no build, no browser.
  if (args.dry) return e2e.finish(rec, []);

  const dist = args.dist ?? (await e2e.buildApp(join(args.out, 'build')));
  const { base, stop } = await e2e.startPreview({ dist, port: args.port });
  const browser = await chromium.launch();

  // One flow blowing up must not cost the report — or the screenshots already
  // on disk — so the whole walk runs inside a guard and still reports.
  try {

  /* ============================================ FLOW 1 — the unlock plays */

  rec.section('flow 1 · the unlock plays');
  const A = await openContext(browser, 'flow1-2');
  await open(A.page, base);

  let appeared = true;
  try {
    await A.page.waitForSelector(UNLOCK, { timeout: 9000 });
  } catch {
    appeared = false;
  }
  check('Unlock overlay appears on load', appeared);

  if (appeared) {
    // Three beats. LAND_MS is 420 in AwardUnlock.jsx: the badge spring lands
    // there, and both the shimmer sweep and the confetti hang off it.
    const beats = [
      ['unlock-1-early', 110, 'backdrop blurring in, badge still small'],
      ['unlock-2-mid', 470, 'badge landed, shimmer sweeping, confetti in the air'],
      ['unlock-3-settled', 1500, 'title/body/button at rest'],
    ];
    for (const [name, target] of beats) {
      const now = (await sinceUnlock(A.page)) ?? 0;
      if (target > now) await A.page.waitForTimeout(target - now);
      const at = await sinceUnlock(A.page);
      if (name === 'unlock-2-mid') {
        check('Confetti canvas present mid-unlock', (await confettiCanvases(A.page)) >= 1);
      }
      await snap(A.page, name);
      console.log(`     ${name} captured ~${at}ms after the overlay appeared`);
    }

    // Read the overlay itself, not the page — "Day 4 of 90" in the Today view
    // behind it also matches an "N of M" test.
    const text = await A.page.locator(UNLOCK).innerText();
    check('Overlay names the first expected award', text.includes(EXPECTED[0].title),
      `expected "${EXPECTED[0].title}"`);
    check('Overlay shows the tier line', /unlocked/i.test(text));
    // `.tiny` is text-transform: uppercase, and innerText reports what is
    // painted — so the counter reads "1 OF 3" on screen.
    check(`Overlay shows the batch counter "1 of ${EXPECTED.length}"`, new RegExp(`\\b1 of ${EXPECTED.length}\\b`, 'i').test(text),
      text.match(/\d+ of \d+/i)?.[0] ?? 'not found');
    check('Overlay offers exactly one control ("Nice")',
      (await A.page.locator(`${UNLOCK} button`).count()) === 1);
    await overflowCheck(A.page, 'unlock overlay');
  }

  /* ================================= FLOW 2 — drain the queue, never replay */

  rec.section('flow 2 · dismissal, and NO replay');
  const seenTitles = [];
  for (let i = 0; i < EXPECTED.length; i++) {
    const t = await bodyText(A.page);
    const match = EXPECTED.find((a) => t.includes(a.title));
    seenTitles.push(match?.title ?? '(unrecognised)');
    if (i === EXPECTED.length - 1) {
      // The last card is the rarest of the batch — worth one more animation
      // shot, since the biggest confetti burst belongs to it.
      await snap(A.page, `unlock-4-final-${(match?.tier ?? 'x')}`);
    }
    const nice = A.page.locator(`${UNLOCK} button`).first();
    if (!(await nice.count())) break;
    await nice.click();
    await A.page.waitForTimeout(i === EXPECTED.length - 1 ? 500 : 700);
  }
  check('Every expected award was shown, in build order',
    seenTitles.join(' → ') === EXPECTED.map((a) => a.title).join(' → '),
    `saw ${seenTitles.join(' → ')}`);
  check('Queue is empty after dismissing the batch', (await overlayCount(A.page)) === 0);

  const marked = await celebrated(A.page);
  check('All earned awards are recorded as celebrated (exactly those ids)',
    sameIds(marked, EARNED.map((a) => a.id)),
    `stored: ${(marked ?? []).join(',')}`);
  for (const a of OVERFLOW) {
    check(`Overflow "${a.title}" was marked without ever being shown`,
      (marked ?? []).includes(a.id) && !seenTitles.includes(a.title));
  }

  await A.page.reload({ waitUntil: 'domcontentloaded' });
  await assertNoOverlay(A.page, 'RELOAD 1: the celebration does NOT replay');
  await snap(A.page, 'after-reload-1-today');

  await A.page.reload({ waitUntil: 'domcontentloaded' });
  await assertNoOverlay(A.page, 'RELOAD 2: still does NOT replay');
  await v1Same(A.page, 'flows 1-2');
  await A.ctx.close();

  /* ================================================ FLOW 3 — the trophy case */

  // A fresh context, seeded with exactly what flow 2 just proved the app
  // stores (every earned id celebrated), rather than carrying on in A. Why:
  // the pinned clock fakes performance.now() and carries it across reloads,
  // while the real document.timeline restarts at 0 on each load. Framer syncs
  // its WAAPI start times to the former, so after A's two reloads every exit
  // animation starts ~20s late — the Stats tab never swaps in and sheets never
  // close within the waits. A harness artefact (a phone has one clock), so the
  // animated flows avoid running after a reload rather than waiting it out.
  rec.section('flow 3 · trophy case, active attempt');
  const T = await openContext(browser, 'flow3', { root: rootJSON(ATTEMPT, EARNED.map((a) => a.id)) });
  await open(T.page, base);
  await assertNoOverlay(T.page, 'Flow 3 opens with nothing left to celebrate', 1200);
  await T.page.waitForTimeout(500);
  await T.page.getByRole('button', { name: 'Stats', exact: true }).click();
  await T.page.waitForTimeout(900);

  // .last() takes the innermost match, in case a wrapper ever also carries .card.
  const caseCard = T.page.locator('.card').filter({ hasText: 'Trophy case' }).last();
  const caseCards = await T.page.locator('.card').filter({ hasText: 'Trophy case' }).count();
  if (!check('Trophy case card exists in Stats', (await caseCard.count()) === 1, `${caseCards} found`)) {
    await snap(T.page, 'FAIL-stats-no-trophy-case');
  }
  if (await caseCard.count()) {
    await caseCard.scrollIntoViewIfNeeded();
    await T.page.waitForTimeout(700);
    await snap(caseCard, 'stats-trophy-case-card');

    // …and scroll it past the viewport in thirds, so a human can see every tier
    // section the way it actually sits on the phone.
    const box = await caseCard.boundingBox();
    const top = await T.page.evaluate(() => window.scrollY);
    for (let i = 0; i < 3; i++) {
      await T.page.evaluate((y) => window.scrollTo(0, y), top + i * 520);
      await T.page.waitForTimeout(450);
      await snap(T.page, `stats-case-scroll-${i + 1}`);
    }
    console.log(`     trophy case card is ${Math.round(box?.height ?? 0)}px tall`);

    // Every label in here is `.tiny`, i.e. text-transform: uppercase, and
    // innerText reports the painted text — so match case-insensitively.
    const caseText = await caseCard.innerText();
    for (const tier of ['Bronze', 'Silver', 'Gold', 'Aurora']) {
      check(`Tier section rendered · ${tier}`, new RegExp(tier, 'i').test(caseText));
    }
    const counts = caseText.match(/\d+ of \d+/gi) ?? [];
    check('Each tier section shows an "N of M" count', counts.length >= 5, counts.join(' | '));
    await overflowCheck(T.page, 'stats trophy case');
  }

  // --- both doors from Today ---
  await T.page.getByRole('button', { name: 'Today', exact: true }).click();
  await T.page.waitForTimeout(800);

  const chip = T.page.getByRole('button', { name: /trophy case/i }).first();
  check('StreakChip is a button into the case', (await chip.count()) > 0);
  const chipLabel = (await chip.count()) ? await chip.getAttribute('aria-label') : '';
  check('StreakChip reports the 3-day streak', /3 day streak/i.test(chipLabel ?? ''), chipLabel ?? '');
  await snap(T.page, 'today-header-streakchip');

  const sheet = T.page.locator('[role="dialog"][aria-label="Trophy case"]');
  if (await chip.count()) {
    await chip.click();
    await T.page.waitForTimeout(700);
    check('DOOR 1: StreakChip opens the trophy case sheet', (await sheet.count()) === 1);
    await snap(T.page, 'case-sheet-from-streakchip');
    await overflowCheck(T.page, 'trophy case sheet');

    // an earned badge, then a locked one. (An ACTIVE attempt's locked badge
    // says "Keep going to reveal"; only a read-only one says "Not earned".)
    for (const [kind, rx] of [['earned', /— earned/], ['locked', /— locked/]]) {
      const target = T.page.getByRole('button', { name: rx }).first();
      if (!(await target.count())) { check(`A ${kind} badge is tappable`, false, 'none found'); continue; }
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await T.page.waitForTimeout(650);
      const detail = T.page.locator('[role="dialog"]').last();
      const dText = await detail.innerText();
      check(`Detail sheet opens for a ${kind} badge`,
        kind === 'earned' ? /Earned\s/.test(dText) : /Keep going to reveal/.test(dText),
        dText.split('\n').slice(0, 3).join(' | '));
      await snap(T.page, `case-detail-${kind}`);
      await T.page.getByRole('button', { name: 'Close', exact: true }).first().click();
      await T.page.waitForTimeout(450);
    }

    await T.page.getByRole('button', { name: 'Done', exact: true }).first().click();
    await T.page.waitForTimeout(600);
    if (!check('Trophy case sheet closes', (await sheet.count()) === 0, `${await sheet.count()} still open`)) {
      await snap(T.page, 'FAIL-case-sheet-still-open');
    }
  }

  // --- the footer row: trophy tile door + the 7px alignment fix ---
  const tile = T.page.getByRole('button', { name: /trophies earned/i }).first();
  check('Trophy tile exists in Today footer row', (await tile.count()) > 0);
  if (await tile.count()) {
    await tile.scrollIntoViewIfNeeded();
    await T.page.waitForTimeout(600);
    await snap(T.page, 'today-footer-row');

    // Two separate questions, deliberately split. `.row > .card + .card
    // { margin-top: 0 }` is one cause of a vertical offset; unequal tile
    // heights under `align-items: center` is another, and the second one
    // survives the first fix.
    const rects = await tile.evaluate((el) => {
      const row = el.parentElement;
      return [...row.children].map((c) => {
        const r = c.getBoundingClientRect();
        const cs = getComputedStyle(c);
        return {
          tag: c.tagName, top: r.top, h: r.height,
          marginTop: cs.marginTop, lineHeight: cs.lineHeight,
          lines: [...c.children].map((k) => ({
            t: (k.textContent || '').trim().slice(0, 16) || k.tagName,
            h: +k.getBoundingClientRect().height.toFixed(1),
            lh: getComputedStyle(k).lineHeight,
          })),
        };
      });
    });
    const tops = rects.map((r) => r.top);
    const spread = Math.max(...tops) - Math.min(...tops);
    check('Footer row: the margin-top fix took (no stacked-card margin)',
      rects.every((r) => parseFloat(r.marginTop) === 0),
      rects.map((r) => `${r.tag} margin-top ${r.marginTop}`).join(' / '));
    check('Footer row tiles are the same height',
      Math.abs(rects[0].h - rects[1].h) < 1.5,
      rects.map((r) => `${r.tag} ${r.h.toFixed(1)}px lh:${r.lineHeight}`).join(' / '));
    check('Footer row tiles are vertically aligned',
      spread < 1.5, `tops ${tops.map((t) => t.toFixed(1)).join(' / ')} — spread ${spread.toFixed(1)}px`);
    if (spread >= 1.5) {
      for (const r of rects) {
        console.log(`     ${r.tag} ${r.h.toFixed(1)}px · line-height ${r.lineHeight} · ` +
          r.lines.map((k) => `"${k.t}" ${k.h}/${k.lh}`).join(' · '));
      }
    }

    await tile.click();
    await T.page.waitForTimeout(700);
    check('DOOR 2: trophy tile opens the trophy case sheet', (await sheet.count()) === 1);
    await snap(T.page, 'case-sheet-from-tile');
    await T.page.getByRole('button', { name: 'Done', exact: true }).first().click();
    await T.page.waitForTimeout(450);
  }

  await overflowCheck(T.page, 'today');
  await v1Same(T.page, 'flow 3');
  await T.ctx.close();

  /* ================== FLOW 1b — the streak badge, which the cap pushes out */

  // The rarest-three rule marks `streak-3` without showing it (it is the
  // lowest-ranked, latest-earned of the four). That is the design working, but
  // the streak badge is the headline of this feature and it deserves to be
  // looked at — so give it a batch of its own by pre-marking the other three.
  if (OVERFLOW.length) {
    rec.section(`flow 1b · "${OVERFLOW[0].title}" alone in its batch`);
    const B = await openContext(browser, 'flow1b', { root: rootJSON(ATTEMPT, EXPECTED.map((a) => a.id)) });
    await open(B.page, base);
    let bOk = true;
    try {
      await B.page.waitForSelector(UNLOCK, { timeout: 9000 });
    } catch {
      bOk = false;
    }
    check(`Unlock plays for "${OVERFLOW[0].title}"`, bOk);
    if (bOk) {
      const now = (await sinceUnlock(B.page)) ?? 0;
      if (now < 470) await B.page.waitForTimeout(470 - now);
      await snap(B.page, 'streak3-unlock-mid');
      await B.page.waitForTimeout(1100);
      await snap(B.page, 'streak3-unlock-settled');
      const t = await B.page.locator(UNLOCK).innerText();
      check('It is the streak badge, named and described',
        t.includes(OVERFLOW[0].title) && t.includes(OVERFLOW[0].body),
        t.split('\n').filter(Boolean).slice(0, 4).join(' | '));
      check('A single-award batch shows no "N of M" counter', !/\d+ of \d+/i.test(t), t.match(/\d+ of \d+/i)?.[0] ?? '');
      await B.page.locator(`${UNLOCK} button`).first().click();
      await B.page.waitForTimeout(600);
      check('Single-award batch dismisses to empty', (await overlayCount(B.page)) === 0);
      await B.page.reload({ waitUntil: 'domcontentloaded' });
      await assertNoOverlay(B.page, 'Streak unlock does NOT replay after reload', 1800);
    }
    await v1Same(B.page, 'flow 1b');
    await B.ctx.close();
  }

  /* ====== FLOW 4 — the plan's C1 flow 4: three green days → "3-day streak" */

  // Verbatim from the build plan: "Seed 3 green days → unlock overlay shows
  // '3-day streak' → dismiss → does not reappear on reload." The batch is
  // whatever the domain says (batchFor), capped at three and in AwardUnlock's
  // order — the fixture check above guarantees the streak is in it. ?static,
  // as C1 asks of every walk; flow 1 already covers the motion.
  rec.section('flow 4 · PLAN C1: 3 green finished days → "3-day streak" → dismiss → no replay');
  {
    const N = STREAK.shown.length;
    const E = await openContext(browser, 'flow4', { root: rootJSON(STREAK_ATTEMPT) });
    await open(E.page, base, '?static');

    const first = await waitForOverlay(E.page, STREAK.shown[0]?.title ?? '(none expected)', 9000);
    check('FLOW 4 · the unlock overlay appears on load', first !== '', first ? '' : 'no overlay within 9s');

    const seen = [];
    for (let i = 0; i < N && first; i++) {
      const a = STREAK.shown[i];
      const t = i === 0 ? first : await waitForOverlay(E.page, a.title);
      const counterOk = N > 1 ? new RegExp(`\\b${i + 1} of ${N}\\b`, 'i').test(t) : !/\d+ of \d+/i.test(t);
      check(`FLOW 4 · overlay ${i + 1}/${N} shows "${a.title}"${N > 1 ? ` with its "${i + 1} of ${N}" counter` : ''}`,
        t.includes(a.title) && counterOk, t.split('\n').filter(Boolean).slice(0, 4).join(' | '));
      seen.push(STREAK.earned.find((x) => t.includes(x.title))?.title ?? '(unrecognised)');
      await snap(E.page, `flow4-overlay-${i + 1}-${a.id}`);

      const btns = E.page.locator(`${UNLOCK} button`);
      const n = await btns.count();
      const label = n ? (await btns.first().innerText()).trim() : '';
      check(`FLOW 4 · overlay ${i + 1}/${N} has one dismiss button (${a.id === 'honest-yellow' ? '"Got it"' : '"Nice"'})`,
        n === 1 && ackRx(a).test(label), `${n} button(s): "${label}"`);
      if (!n) break;
      await btns.first().click();
      await E.page.waitForTimeout(450);
    }

    check('FLOW 4 · the "3-day streak" overlay was on screen', seen.includes('3-day streak'), `saw ${seen.join(' → ') || '(nothing)'}`);
    check(`FLOW 4 · shown in AwardUnlock's order: ${STREAK.shown.map((a) => a.title).join(' → ')}`,
      seen.join(' → ') === STREAK.shown.map((a) => a.title).join(' → '), `saw ${seen.join(' → ') || '(nothing)'}`);
    await assertNoOverlay(E.page, 'FLOW 4 · no overlay left after dismissing each', 1500);

    const want = STREAK.earned.map((a) => a.id); // shown + any overflow
    const after = await celebrated(E.page);
    check('FLOW 4 · celebratedAwards in storage holds exactly the expected ids',
      sameIds(after, want), `stored [${(after ?? []).join(',')}] want [${want.join(',')}]`);

    await E.page.reload({ waitUntil: 'domcontentloaded' });
    await assertNoOverlay(E.page, 'FLOW 4 · RELOAD 1: no overlay');
    await E.page.reload({ waitUntil: 'domcontentloaded' });
    await assertNoOverlay(E.page, 'FLOW 4 · RELOAD 2: still no overlay');
    await snap(E.page, 'flow4-after-reload-2');

    const afterReloads = await celebrated(E.page);
    check('FLOW 4 · celebratedAwards unchanged by both reloads',
      JSON.stringify(afterReloads) === JSON.stringify(after), `stored [${(afterReloads ?? []).join(',')}]`);
    const chip4 = E.page.getByRole('button', { name: /trophy case/i }).first();
    const chip4Label = (await chip4.count()) ? await chip4.getAttribute('aria-label') : '';
    check('FLOW 4 · Today shows the 3-day streak', /3 day streak/i.test(chip4Label ?? ''), chip4Label ?? 'no StreakChip');
    await v1Same(E.page, 'flow 4');
    await E.ctx.close();
  }

  /* ============================================= FLOW 5 — read-only attempt 1 */

  rec.section('flow 5 · read-only Attempt 1 (no v2: migrated from v1)');
  const D = await openContext(browser, 'flow5-readonly', { root: null });
  await open(D.page, base);
  await D.page.waitForTimeout(900);

  let fText = await bodyText(D.page);
  check('Migration produced the Front door with Attempt 1', /attempt 1/i.test(fText));
  await assertNoOverlay(D.page, 'No unlock on the Front door', 1200);
  await snap(D.page, 'readonly-front-door');

  await D.page.getByRole('button', { name: /attempt 1/i }).first().click();
  await D.page.waitForTimeout(900);
  fText = await bodyText(D.page);
  check('Attempt 1 opens read-only', /read-only/i.test(fText));
  await snap(D.page, 'readonly-today');

  // THE assertion of this flow. markAwardCelebrated no-ops on an archived
  // attempt, so an overlay here could never record itself — it would replay on
  // every open, forever.
  await assertNoOverlay(D.page, 'READ-ONLY: no unlock overlay, ever (would replay forever)', 2500);

  await D.page.getByRole('button', { name: 'Stats', exact: true }).click();
  await D.page.waitForTimeout(900);
  const roCase = D.page.locator('.card').filter({ hasText: 'Trophy case' }).last();
  check('Trophy case renders in the archived attempt', (await roCase.count()) === 1);
  if (await roCase.count()) {
    await roCase.scrollIntoViewIfNeeded();
    await D.page.waitForTimeout(700);
    await snap(roCase, 'readonly-trophy-case');
    const t = await roCase.innerText();
    check('Read-only case uses the archived voice', /It stands as it is/i.test(t),
      t.split('\n').slice(0, 4).join(' | '));
    const m = t.match(/(\d+) of (\d+)/i);
    console.log(`     archived attempt earned ${m ? `${m[1]} of ${m[2]}` : '?'} trophies`);
  }
  // Tab around the app read-only and confirm nothing ever pops.
  for (const tab of ['Calendar', 'Plan', 'Today']) {
    await D.page.getByRole('button', { name: tab, exact: true }).click();
    await D.page.waitForTimeout(500);
  }
  await assertNoOverlay(D.page, 'READ-ONLY: still no unlock after touring every tab', 1500);
  await overflowCheck(D.page, 'read-only today');

  await v1Same(D.page, 'flow 5 read-only (migration read it)');
  await D.ctx.close();

  /* ============================================== FLOW 6 — ?static and reduce */

  for (const [label, opts, query] of [
    ['?static', {}, '?static'],
    ['reducedMotion: reduce', { reducedMotion: 'reduce' }, ''],
  ]) {
    rec.section(`flow 6 · ${label}`);
    const C = await openContext(browser, `flow6-${label}`, opts);
    await open(C.page, base, query);

    let ok = true;
    try {
      await C.page.waitForSelector(UNLOCK, { timeout: 9000 });
    } catch {
      ok = false;
    }
    check(`Overlay still renders · ${label}`, ok);
    await C.page.waitForTimeout(900);
    await snap(C.page, `plain-${label.replace(/[^a-z]/gi, '') || 'x'}-unlock`);

    if (ok) {
      const t = await bodyText(C.page);
      const btn = (await C.page.locator(`${UNLOCK} button`).first().innerText().catch(() => '')).trim();
      check(`Overlay is fully painted · ${label}`,
        t.includes(EXPECTED[0].title) && /unlocked/i.test(t) && ackRx(EXPECTED[0]).test(btn), `button "${btn}"`);
      check(`NO confetti canvas · ${label}`, (await confettiCanvases(C.page)) === 0);
      await overflowCheck(C.page, label);

      await C.page.locator(`${UNLOCK} button`).first().click();
      await C.page.waitForTimeout(600);
      const stillOne = await C.page.locator(`${UNLOCK}`).count();
      check(`Dismissible · ${label}`, stillOne <= 1, `${stillOne} overlays after one dismissal`);
      // drain whatever is left, then confirm it doesn't come back
      for (let i = 0; i < 4 && (await overlayCount(C.page)); i++) {
        await C.page.locator(`${UNLOCK} button`).first().click();
        await C.page.waitForTimeout(500);
      }
      check(`Queue drains to empty · ${label}`, (await overlayCount(C.page)) === 0);
      await C.page.reload({ waitUntil: 'domcontentloaded' });
      await assertNoOverlay(C.page, `No replay after reload · ${label}`, 1800);
      await snap(C.page, `plain-${label.replace(/[^a-z]/gi, '') || 'x'}-after-reload`);
    }

    await v1Same(C.page, label);
    await C.ctx.close();
  }

  } catch (e) {
    check('Walk ran to the end without throwing', false, String(e).split('\n')[0].slice(0, 160));
  }

  /* -------------------------------------------------------------- console */

  const errors = allErrors.flat();
  check('No console errors or page errors', errors.length === 0, errors.slice(0, 4).join(' / '));

  if (!args.keep) {
    await browser.close();
    await stop();
  }
  await e2e.finish(rec, allErrors);
}

e2e.run(main);
