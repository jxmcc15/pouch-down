// Proves the awards UI in a real browser — the part the unit suite cannot see:
// does the unlock actually RENDER, does the celebration REPLAY, and is the
// trophy case reachable from both doors on a 390px phone.
//
// Five flows, four browser contexts:
//   1  the unlock plays          (animations ON, captured at three beats)
//   2  it does NOT replay        (drain the queue, reload twice)
//   3  the trophy case           (Stats card + both doors from Today)
//   4  read-only Attempt 1       (migrated from v1; NO overlay, ever)
//   5  ?static and reduce        (renders, dismissible, no confetti canvas)
//
// Synthetic data only. The v2 fixture is built here from planGenerator.js, and
// the expected unlock batch is computed here from awards.js — so the walk
// asserts the UI against the domain rather than against a hardcoded guess.
// James's real data never enters this repo; it is public.
//
// The one hard invariant, same as walk-setup.mjs: `pouch-down-v1` must be
// byte-identical at the end of every context. It is the rollback, and nothing
// in the app may ever write it.
//
// Usage: node scripts/e2e/walk-awards.mjs [--out DIR] [--port N] [--keep]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedV1String } from './seed-v1.mjs';
import { generatePlan } from '../../src/planGenerator.js';
import { newlyEarned } from '../../src/awards.js';
import { offsetMinInZone, dayKeyAt } from '../../src/time.js';
import { todayKey } from '../../src/store.js';
import { TIER_RANK } from '../../src/components/awards/tiers.js';

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? dflt : process.argv[i + 1];
};
const OUT = arg('--out', '/tmp/pouch-awards-walk');
const PORT = Number(arg('--port', 4319));
const KEEP = process.argv.includes('--keep');

const log = (...a) => console.log(...a);
const fail = [];
const check = (label, ok, detail = '') => {
  log(`${ok ? '  ok ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fail.push(`${label}${detail ? `: ${detail}` : ''}`);
};

let shot = 0;
const snap = async (page, name) => {
  const file = `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file });
  return file;
};
const snapEl = async (loc, name) => {
  const file = `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`;
  await loc.screenshot({ path: file });
  return file;
};

/* ------------------------------------------------------------------ fixture */

// Node and the browser must agree on what "today" is, or a plan anchored to
// today-3 lands on the wrong day number. Drive the browser from this machine's
// own zone rather than pinning a zone the harness doesn't share.
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TODAY = todayKey();

const epochDay = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86400000);
const dayStrOf = (ed) => new Date(ed * 86400000).toISOString().slice(0, 10);
const addDays = (s, n) => dayStrOf(epochDay(s) + n);
const pad = (n) => String(n).padStart(2, '0');

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

const slotHM = (slot) => {
  if (slot.anchor === 'fixed') return slot.time;
  const [h, m] = SETTINGS.mealTimes[slot.anchor].split(':').map(Number);
  const t = h * 60 + m + (slot.offsetMin || 0);
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

// Local wall-clock time on `day`, in TZ, as epoch ms. Resolved twice so a DST
// shift between the guess and the answer doesn't leave it an hour out.
const tsFor = (day, hm, plusMin = 0) => {
  const [h, m] = hm.split(':').map(Number);
  const naive = Date.parse(`${day}T00:00:00Z`) + (h * 60 + m + plusMin) * 60000;
  const ms = naive - offsetMinInZone(naive, TZ) * 60000;
  return naive - offsetMinInZone(ms, TZ) * 60000;
};

let evN = 0;
const mkEvent = (type, ms, extra = {}) => {
  const tzOffsetMin = offsetMinInZone(ms, TZ);
  return {
    id: `walk-${++evN}`,
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
// whole day classifies on-time). Two resisted cravings on day 2.
function buildEvents() {
  const stage = PLAN.stages[0];
  const events = [];
  const firstHM = slotHM(stage.slots[0]);
  for (let d = 1; d <= 3; d++) {
    const day = addDays(START, d - 1);
    const firstSlotAt = new Date(tsFor(day, firstHM)).toISOString();
    for (let i = 0; i < 7; i++) {
      const slot = stage.slots[i];
      const slotMs = tsFor(day, slotHM(slot));
      events.push(
        mkEvent('pouch', slotMs + 5 * 60000, {
          trigger: i === 0 ? 'routine' : null,
          ctx: {
            nth: i + 1,
            cap: stage.pouchesPerDay,
            slotId: slot.id,
            slotLabel: slot.label,
            slotAt: new Date(slotMs).toISOString(),
            firstSlotAt,
          },
        })
      );
    }
    if (d === 2) {
      events.push(mkEvent('resisted', tsFor(day, '15:20'), { trigger: 'stress' }));
      events.push(mkEvent('resisted', tsFor(day, '16:40'), { trigger: 'boredom' }));
    }
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  return events;
}

const EVENTS = buildEvents();

const ATTEMPT = {
  id: 'a1',
  status: 'active',
  createdAt: EVENTS[0].ts,
  archivedAt: null,
  settings: SETTINGS,
  plan: PLAN,
  events: EVENTS,
  celebratedStages: [],
  celebratedAwards: [],
  checkinDismissedFor: TODAY, // keeps the morning card out of the Today shots
};

const ROOT_V2 = { version: 2, device: { apiKey: '' }, activeAttemptId: 'a1', attempts: [ATTEMPT] };
const V1 = seedV1String();

/* ------------------------------------- what AwardUnlock should decide to show */

// Same two comparators AwardUnlock.jsx uses: rarest three get an overlay, in
// build order; anything past three is marked without ever being shown.
const byRarity = (a, b) =>
  TIER_RANK[b.tier] - TIER_RANK[a.tier] || String(a.earnedOn).localeCompare(String(b.earnedOn));
const byBuild = (a, b) =>
  TIER_RANK[a.tier] - TIER_RANK[b.tier] || String(a.earnedOn).localeCompare(String(b.earnedOn));

const EARNED = newlyEarned(ATTEMPT);
const RANKED = [...EARNED].sort(byRarity);
const EXPECTED = RANKED.slice(0, 3).sort(byBuild);
const OVERFLOW = RANKED.slice(3);

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

// v2 === false seeds ONLY the v1 key, so the app migrates it (flow 4).
// `already` pre-marks awards as celebrated, which is how flow 1b isolates a
// single badge — the streak — into a batch of its own.
const seedScript = (v2, already = []) => {
  const root = already.length
    ? { ...ROOT_V2, attempts: [{ ...ATTEMPT, celebratedAwards: already }] }
    : ROOT_V2;
  // Seeds ONCE per context, gated on a sentinel. An init script runs on every
  // navigation, so an ungated one would re-seed on reload — which silently
  // restores `celebratedAwards: []` and makes the app look like it replays its
  // celebrations. It doesn't; the harness was handing it a fresh record.
  return `
  try {
    if (localStorage.getItem('__walk-seeded') === null) {
      localStorage.setItem('__walk-seeded', '1');
      localStorage.setItem('pouch-down-v1', ${JSON.stringify(V1)});
      ${v2 ? `localStorage.setItem('pouch-down-v2', ${JSON.stringify(JSON.stringify(root))});` : `localStorage.removeItem('pouch-down-v2');`}
    }
  } catch (e) {}
  navigator.share = () => Promise.resolve();
  navigator.canShare = () => false;
`;
};

const allErrors = [];

async function openContext(browser, label, { v2 = true, reducedMotion, already = [] } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: TZ,
    ...(reducedMotion ? { reducedMotion } : {}),
  });
  await ctx.addInitScript(seedScript(v2, already));
  await ctx.addInitScript(WATCH);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000); // a stalled click reports in 12s, not 30
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${label}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[${label}] ${String(e)}`));
  return { ctx, page, errors };
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const overlayCount = (page) => page.locator(UNLOCK).count();
// canvas-confetti appends its canvas straight to <body>; nothing else in the
// app does, so this is an exact test for "confetti happened".
const confettiCanvases = (page) => page.evaluate(() => document.querySelectorAll('body > canvas').length);
const sinceUnlock = (page) =>
  page.evaluate(() => (window.__unlockAt === null ? null : Math.round(performance.now() - window.__unlockAt)));

async function overflowCheck(page, where) {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  check(`No horizontal overflow · ${where}`, w <= 390, `scrollWidth ${w}`);
}

// Waits until the unlock has been absent for a full second — a celebration that
// arrives late is still a replay.
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

async function waitForBoot(page, base, query = '') {
  for (let i = 0; i < 60; i++) {
    try {
      await page.goto(`${base}${query}`, { waitUntil: 'domcontentloaded' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('preview server never answered');
}

const celebrated = (page) =>
  page.evaluate(() => {
    try {
      const r = JSON.parse(localStorage.getItem('pouch-down-v2'));
      return r.attempts.find((a) => a.id === r.activeAttemptId)?.celebratedAwards ?? [];
    } catch {
      return null;
    }
  });

/* --------------------------------------------------------------- the walk */

async function main() {
  mkdirSync(OUT, { recursive: true });

  log(`\nfixture: plan starts ${START}, today is ${TODAY} (${TZ})`);
  log(`  earned: ${EARNED.map((a) => `${a.title} [${a.tier} ${a.earnedOn}]`).join(', ') || '(none)'}`);
  log(`  expect overlays: ${EXPECTED.map((a) => a.title).join(' → ') || '(none)'}`);
  log(`  expect silently marked: ${OVERFLOW.map((a) => a.title).join(', ') || '(none)'}`);

  // Fixture sanity. A failure here is a HARNESS problem, not a product one.
  check('Fixture: day 3 is settled (before today)', addDays(START, 2) < TODAY, `day3=${addDays(START, 2)} today=${TODAY}`);
  check('Fixture: every seeded event landed on its intended day',
    EVENTS.every((e) => e.day >= START && e.day <= addDays(START, 2)),
    EVENTS.map((e) => e.day).filter((d, i, a) => a.indexOf(d) === i).join(','));
  check('Fixture: streak-3 is earned', EARNED.some((a) => a.id === 'streak-3'));
  check('Fixture: more than three awards earned (exercises the cap)', EARNED.length > 3, `${EARNED.length} earned`);

  // `--dry` stops here: it prints what the fixture earns without building or
  // launching anything, which is how you check a fixture change in a second.
  if (process.argv.includes('--dry')) {
    log(fail.length ? `\n${fail.length} fixture problem(s)\n` : `\nfixture OK\n`);
    process.exit(fail.length ? 1 : 0);
  }

  log(`\nbuilding…`);
  await new Promise((res, rej) => {
    const b = spawn('npm', ['run', 'build'], { stdio: 'ignore' });
    b.on('exit', (c) => (c === 0 ? res() : rej(new Error(`build exited ${c}`))));
  });

  // Fixed port + kill by PID. Never `pkill -f vite` — that would take unrelated
  // dev servers on this Mac down with it.
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  const stop = () => { try { process.kill(server.pid); } catch { /* already gone */ } };
  process.on('exit', stop);

  const base = `http://localhost:${PORT}/pouch-down/`;
  const browser = await chromium.launch();

  // One flow blowing up must not cost the report — or the screenshots already
  // on disk — so the whole walk runs inside a guard and still reports.
  try {

  /* ============================================ FLOW 1 — the unlock plays */

  log(`\n── flow 1 · the unlock plays ──`);
  const A = await openContext(browser, 'flow1-3');
  allErrors.push(A.errors);
  await waitForBoot(A.page, base);

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
      log(`     ${name} captured ~${at}ms after the overlay appeared`);
    }

    // Read the overlay itself, not the page — "Day 4 of 90" in the Today view
    // behind it also matches an "N of M" test.
    const text = await A.page.locator(UNLOCK).innerText();
    check('Overlay names the first expected award', text.includes(EXPECTED[0].title),
      `expected "${EXPECTED[0].title}"`);
    check('Overlay shows the tier line', /unlocked/i.test(text));
    // `.tiny` is text-transform: uppercase, and innerText reports what is
    // painted — so the counter reads "1 OF 3" on screen.
    check('Overlay shows the batch counter "1 of 3"', /\b1 of 3\b/i.test(text),
      text.match(/\d+ of \d+/i)?.[0] ?? 'not found');
    check('Overlay offers exactly one control ("Nice")',
      (await A.page.locator(`${UNLOCK} button`).count()) === 1);
    await overflowCheck(A.page, 'unlock overlay');
  }

  /* ================================= FLOW 2 — drain the queue, never replay */

  log(`\n── flow 2 · dismissal, and NO replay ──`);
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
  check('All earned awards are recorded as celebrated',
    Array.isArray(marked) && EARNED.every((a) => marked.includes(a.id)),
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

  /* ================================================ FLOW 3 — the trophy case */

  log(`\n── flow 3 · trophy case, active attempt ──`);
  await A.page.waitForTimeout(500);
  await A.page.getByRole('button', { name: 'Stats', exact: true }).click();
  await A.page.waitForTimeout(900);

  // .last() takes the innermost match, in case a wrapper ever also carries .card.
  const caseCard = A.page.locator('.card').filter({ hasText: 'Trophy case' }).last();
  check('Trophy case card exists in Stats', (await caseCard.count()) === 1);
  if (await caseCard.count()) {
    await caseCard.scrollIntoViewIfNeeded();
    await A.page.waitForTimeout(700);
    await snapEl(caseCard, 'stats-trophy-case-card');

    // …and scroll it past the viewport in thirds, so a human can see every tier
    // section the way it actually sits on the phone.
    const box = await caseCard.boundingBox();
    const top = await A.page.evaluate(() => window.scrollY);
    for (let i = 0; i < 3; i++) {
      await A.page.evaluate((y) => window.scrollTo(0, y), top + i * 520);
      await A.page.waitForTimeout(450);
      await snap(A.page, `stats-case-scroll-${i + 1}`);
    }
    log(`     trophy case card is ${Math.round(box?.height ?? 0)}px tall`);

    // Every label in here is `.tiny`, i.e. text-transform: uppercase, and
    // innerText reports the painted text — so match case-insensitively.
    const caseText = await caseCard.innerText();
    for (const tier of ['Bronze', 'Silver', 'Gold', 'Aurora']) {
      check(`Tier section rendered · ${tier}`, new RegExp(tier, 'i').test(caseText));
    }
    const counts = caseText.match(/\d+ of \d+/gi) ?? [];
    check('Each tier section shows an "N of M" count', counts.length >= 5, counts.join(' | '));
    await overflowCheck(A.page, 'stats trophy case');
  }

  // --- both doors from Today ---
  await A.page.getByRole('button', { name: 'Today', exact: true }).click();
  await A.page.waitForTimeout(800);

  const chip = A.page.getByRole('button', { name: /trophy case/i }).first();
  check('StreakChip is a button into the case', (await chip.count()) > 0);
  const chipLabel = (await chip.count()) ? await chip.getAttribute('aria-label') : '';
  check('StreakChip reports the 3-day streak', /3 day streak/i.test(chipLabel ?? ''), chipLabel ?? '');
  await snap(A.page, 'today-header-streakchip');

  const sheet = A.page.locator('[role="dialog"][aria-label="Trophy case"]');
  if (await chip.count()) {
    await chip.click();
    await A.page.waitForTimeout(700);
    check('DOOR 1: StreakChip opens the trophy case sheet', (await sheet.count()) === 1);
    await snap(A.page, 'case-sheet-from-streakchip');
    await overflowCheck(A.page, 'trophy case sheet');

    // an earned badge, then a locked one
    for (const [kind, rx] of [['earned', /— earned/], ['locked', /— locked/]]) {
      const target = A.page.getByRole('button', { name: rx }).first();
      if (!(await target.count())) { check(`A ${kind} badge is tappable`, false, 'none found'); continue; }
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await A.page.waitForTimeout(650);
      const detail = A.page.locator('[role="dialog"]').last();
      const dText = await detail.innerText();
      check(`Detail sheet opens for a ${kind} badge`,
        kind === 'earned' ? /Earned\s/.test(dText) : /Keep going to reveal/.test(dText),
        dText.split('\n').slice(0, 3).join(' | '));
      await snap(A.page, `case-detail-${kind}`);
      await A.page.getByRole('button', { name: 'Close', exact: true }).first().click();
      await A.page.waitForTimeout(450);
    }

    await A.page.getByRole('button', { name: 'Done', exact: true }).first().click();
    await A.page.waitForTimeout(600);
    check('Trophy case sheet closes', (await sheet.count()) === 0);
  }

  // --- the footer row: trophy tile door + the 7px alignment fix ---
  const tile = A.page.getByRole('button', { name: /trophies earned/i }).first();
  check('Trophy tile exists in Today footer row', (await tile.count()) > 0);
  if (await tile.count()) {
    await tile.scrollIntoViewIfNeeded();
    await A.page.waitForTimeout(600);
    await snap(A.page, 'today-footer-row');

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
        log(`     ${r.tag} ${r.h.toFixed(1)}px · line-height ${r.lineHeight} · ` +
          r.lines.map((k) => `"${k.t}" ${k.h}/${k.lh}`).join(' · '));
      }
    }

    await tile.click();
    await A.page.waitForTimeout(700);
    check('DOOR 2: trophy tile opens the trophy case sheet', (await sheet.count()) === 1);
    await snap(A.page, 'case-sheet-from-tile');
    await A.page.getByRole('button', { name: 'Done', exact: true }).first().click();
    await A.page.waitForTimeout(450);
  }

  await overflowCheck(A.page, 'today');
  const v1After = await A.page.evaluate(() => localStorage.getItem('pouch-down-v1'));
  check('pouch-down-v1 byte-identical · flows 1-3', v1After === V1,
    v1After === null ? 'KEY WAS DELETED' : v1After === V1 ? '' : 'KEY WAS REWRITTEN');
  await A.ctx.close();

  /* ================== FLOW 1b — the streak badge, which the cap pushes out */

  // The rarest-three rule marks `streak-3` without showing it (it is the
  // lowest-ranked, latest-earned of the four). That is the design working, but
  // the streak badge is the headline of this feature and it deserves to be
  // looked at — so give it a batch of its own by pre-marking the other three.
  if (OVERFLOW.length) {
    log(`\n── flow 1b · "${OVERFLOW[0].title}" alone in its batch ──`);
    const B = await openContext(browser, 'flow1b', { already: EXPECTED.map((a) => a.id) });
    allErrors.push(B.errors);
    await waitForBoot(B.page, base);
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
    const v1B = await B.page.evaluate(() => localStorage.getItem('pouch-down-v1'));
    check('pouch-down-v1 byte-identical · flow 1b', v1B === V1);
    await B.ctx.close();
  }

  /* ============================================= FLOW 4 — read-only attempt 1 */

  log(`\n── flow 4 · read-only Attempt 1 (no v2: migrated from v1) ──`);
  const D = await openContext(browser, 'flow4', { v2: false });
  allErrors.push(D.errors);
  await waitForBoot(D.page, base);
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
    await snapEl(roCase, 'readonly-trophy-case');
    const t = await roCase.innerText();
    check('Read-only case uses the archived voice', /It stands as it is/i.test(t),
      t.split('\n').slice(0, 4).join(' | '));
    const m = t.match(/(\d+) of (\d+)/i);
    log(`     archived attempt earned ${m ? `${m[1]} of ${m[2]}` : '?'} trophies`);
  }
  // Tab around the app read-only and confirm nothing ever pops.
  for (const tab of ['Calendar', 'Plan', 'Today']) {
    await D.page.getByRole('button', { name: tab, exact: true }).click();
    await D.page.waitForTimeout(500);
  }
  await assertNoOverlay(D.page, 'READ-ONLY: still no unlock after touring every tab', 1500);
  await overflowCheck(D.page, 'read-only today');

  const v1D = await D.page.evaluate(() => localStorage.getItem('pouch-down-v1'));
  check('pouch-down-v1 byte-identical · flow 4 (migration read it)', v1D === V1,
    v1D === null ? 'KEY WAS DELETED' : v1D === V1 ? '' : 'KEY WAS REWRITTEN');
  await D.ctx.close();

  /* ============================================== FLOW 5 — ?static and reduce */

  for (const [label, opts, query] of [
    ['?static', {}, '?static'],
    ['reducedMotion: reduce', { reducedMotion: 'reduce' }, ''],
  ]) {
    log(`\n── flow 5 · ${label} ──`);
    const C = await openContext(browser, `flow5-${label}`, opts);
    allErrors.push(C.errors);
    await waitForBoot(C.page, base, query);

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
      check(`Overlay is fully painted · ${label}`,
        t.includes(EXPECTED[0].title) && /unlocked/i.test(t) && /Nice/.test(t));
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

    const v1C = await C.page.evaluate(() => localStorage.getItem('pouch-down-v1'));
    check(`pouch-down-v1 byte-identical · ${label}`, v1C === V1,
      v1C === null ? 'KEY WAS DELETED' : v1C === V1 ? '' : 'KEY WAS REWRITTEN');
    await C.ctx.close();
  }

  } catch (e) {
    check('Walk ran to the end without throwing', false, String(e).split('\n')[0].slice(0, 160));
  }

  /* -------------------------------------------------------------- console */

  const errors = allErrors.flat();
  check('No console errors or page errors', errors.length === 0, errors.slice(0, 4).join(' / '));

  writeFileSync(
    `${OUT}/report.json`,
    JSON.stringify(
      {
        today: TODAY, timeZone: TZ, planStart: START,
        earned: EARNED.map((a) => ({ id: a.id, tier: a.tier, earnedOn: a.earnedOn })),
        shown: EXPECTED.map((a) => a.id),
        overflow: OVERFLOW.map((a) => a.id),
        failures: fail,
        errors,
      },
      null,
      2
    )
  );
  log(`\nscreenshots → ${OUT}`);
  log(fail.length ? `\n${fail.length} FAILURE(S):\n - ${fail.join('\n - ')}\n` : `\nALL CHECKS PASSED\n`);

  if (!KEEP) { await browser.close(); stop(); }
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
