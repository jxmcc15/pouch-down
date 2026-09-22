// Drives the real app in headless Chromium the way James will on his phone:
// Front door → view Attempt 1 → Exit → Start new → the 8 setup screens → plan
// preview → Begin → Today. Screenshots every step so a human can actually LOOK
// at the result.
//
// Three browser contexts, each on a PINNED clock (America/Chicago), so the walk
// means the same thing next month as it does tonight:
//   A  Sun 2026-09-20 12:00  the spec's acceptance numbers — 9/day · 9 mg ·
//                            [6, 3] · 90 days · Day 1 typed as 2026-09-21 →
//                            8 stages, first cut Tue Oct 6 (day 16), quit Sat
//                            Dec 19. Also takes the read-only detour.
//   B  Mon 2026-09-21 20:00  what James sees tonight: the default Day 1 must be
//                            Tue 09-22 (first cut Wed Oct 7, quit Sun Dec 20),
//                            and a typed past date (09-20) must be refused.
//   C  Tue 2026-09-22 02:30  the 4 AM cutoff: still Monday's app day, so the
//                            default Day 1 is STILL 09-22, 09-21 is still
//                            "today" (allowed), and Today opens pre-Day-1.
//
// Every preview is checked three ways: planGenerator.js against the spec's
// hand-stated numbers (no browser needed — `--dry` runs just these), the UI
// against the spec, and every stage card against planGenerator.js. So a drift
// in the domain, the screen, or the spec each shows up as its own failure.
//
// Synthetic data only (scripts/e2e/seed-v1.mjs), seeded exactly once per
// context by lib.mjs. The one hard assertion that matters beyond "it
// rendered": `pouch-down-v1` must be byte-identical at the end of every
// context — it is the rollback, and nothing in the app may ever write it.
// After Begin each context reloads once, to prove the attempt was really saved
// (and that the harness didn't quietly hand the app a fresh copy).
//
// Selectors lean on ids, roles and aria state rather than copy, because the
// wording of setup and the pre-Day-1 card is still being tuned.
//
// Usage: node scripts/e2e/walk-setup.mjs [--dist DIR] [--out DIR] [--port N] [--keep] [--dry]
import { chromium } from 'playwright-core';
import * as e2e from './lib.mjs';
import { seedV1, seedV1String, summary } from './seed-v1.mjs';
import { generatePlan } from '../../src/planGenerator.js';
import { dayKeyAt, offsetMinInZone } from '../../src/time.js';

const args = e2e.parseArgs({ name: 'walk-setup', port: 4317 });
const TZ = 'America/Chicago';

/* ------------------------------------------------------------------ fixture */

// The answers typed on screens 1–4. Screens 6–7 (rhythm, price) keep whatever
// the app pre-fills from the migrated v1 settings — which are these.
const INPUTS = { pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90 };
const SEEDED_SETTINGS = seedV1().settings;

const CONTEXTS = [
  {
    id: 'A',
    title: 'spec acceptance numbers',
    now: '2026-09-20T12:00:00-05:00',
    appToday: '2026-09-20',
    defaultDay1: '2026-09-21',
    type: '2026-09-21', // typed even though it is the default: these are the spec's inputs
    refuse: [],
    allow: [],
    readOnlyDetour: true,
    spec: { stages: 8, firstCut: { day: 16, date: '2026-10-06', weekday: 'Tue' }, quit: { date: '2026-12-19', weekday: 'Sat' } },
  },
  {
    id: 'B',
    title: 'what James sees tonight',
    now: '2026-09-21T20:00:00-05:00',
    appToday: '2026-09-21',
    defaultDay1: '2026-09-22',
    type: null, // accept the default
    refuse: ['2026-09-20'],
    allow: [],
    spec: { stages: 8, firstCut: { day: 16, date: '2026-10-07', weekday: 'Wed' }, quit: { date: '2026-12-20', weekday: 'Sun' } },
  },
  {
    id: 'C',
    title: '4 AM cutoff',
    now: '2026-09-22T02:30:00-05:00',
    appToday: '2026-09-21', // 02:30 Tue still counts toward Monday
    defaultDay1: '2026-09-22',
    type: null,
    refuse: [],
    allow: ['2026-09-21'], // the app's "today", even though the calendar says Tuesday
    spec: { stages: 8, firstCut: { day: 16, date: '2026-10-07', weekday: 'Wed' }, quit: { date: '2026-12-20', weekday: 'Sun' } },
  },
];

// Calendar-day arithmetic on UTC midnights — DST can't shift the answer.
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayOf = (s) => WD[new Date(`${s}T12:00:00Z`).getUTCDay()];

// "Oct 6", "October 6", "Oct. 6" — and with `weekday`, "Tue, Oct 6". Never
// matches "Oct 16" for "Oct 6".
function dateRx(s, { weekday = false } = {}) {
  const d = new Date(`${s}T12:00:00Z`);
  const md = `${MON[d.getUTCMonth()]}\\w*\\.?\\s+${d.getUTCDate()}\\b`;
  return new RegExp(weekday ? `\\b${WD[d.getUTCDay()]}\\w*\\.?,?\\s+${md}` : `\\b${md}`, 'i');
}

// The app's own answer to "what day is it" at the pinned instant (4am→4am).
const appDayAt = (iso) => {
  const ms = Date.parse(iso);
  return dayKeyAt(ms, offsetMinInZone(ms, TZ));
};

// What the domain says the preview must show, for the Day 1 the walk will end on.
function expectedFor(C) {
  const day1 = C.type ?? C.defaultDay1;
  const plan = generatePlan({
    ...INPUTS,
    startDate: day1,
    mealTimes: SEEDED_SETTINGS.mealTimes,
    sleepTime: SEEDED_SETTINGS.sleepTime,
    pouchesPerTin: SEEDED_SETTINGS.pouchesPerTin,
  });
  const cut = plan.stages.find((s) => s.kind === 'cut');
  return { day1, plan, firstCut: cut && { day: cut.days[0], date: addDays(day1, cut.days[0] - 1) } };
}

const STEPS = (C) => [
  `pin clock to ${C.now} (${TZ}); seed pouch-down-v1 (synthetic), pouch-down-v2 absent`,
  'Front door: Start a new attempt + Attempt 1 listed, no fake streak',
  ...(C.readOnlyDetour ? ['open Attempt 1 → read-only banner → Exit → Front door'] : []),
  'Start a new attempt → screen 1 count: 9',
  'screen 2 strength: 9 mg',
  'screen 3 lower strengths: leave exactly [6, 3] on',
  'screen 4 length: 90 days',
  `screen 5 Day 1: default must be ${C.defaultDay1}` +
    (C.refuse.length ? `; refuse ${C.refuse.join(', ')}` : '') +
    (C.allow.length ? `; allow ${C.allow.join(', ')}` : '') +
    (C.type ? `; type ${C.type}` : '; keep the default'),
  'screen 6 rhythm: keep migrated meal/sleep times',
  'screen 7 price: keep migrated price',
  `screen 8 preview: ${C.spec.stages} stages, first cut day ${C.spec.firstCut.day} (${C.spec.firstCut.weekday} ${C.spec.firstCut.date}), quit ${C.spec.quit.weekday} ${C.spec.quit.date}`,
  'Begin → Today in pre-Day-1 mode; v2 holds the new attempt',
  'reload once → still Today, same attempt, seed did not re-run; pouch-down-v1 byte-identical',
];

/* ------------------------------------------------ domain vs spec (no browser) */

function domainChecks(rec) {
  rec.section('planGenerator.js + time.js vs the spec (no browser)');
  for (const C of CONTEXTS) {
    const x = expectedFor(C);
    const today = appDayAt(C.now);
    rec.check(`${C.id}: app day at ${C.now} is ${C.appToday}`, today === C.appToday, `time.js says ${today}`);
    rec.check(`${C.id}: default Day 1 (app day + 1) is ${C.defaultDay1}`, addDays(today, 1) === C.defaultDay1, addDays(today, 1));
    rec.check(`${C.id}: planGenerator makes ${C.spec.stages} stages`, x.plan.stages.length === C.spec.stages, `${x.plan.stages.length}`);
    rec.check(
      `${C.id}: first cut is day ${C.spec.firstCut.day}, ${C.spec.firstCut.weekday} ${C.spec.firstCut.date}`,
      x.firstCut?.day === C.spec.firstCut.day && x.firstCut?.date === C.spec.firstCut.date && weekdayOf(x.firstCut.date) === C.spec.firstCut.weekday,
      x.firstCut ? `generator: day ${x.firstCut.day}, ${weekdayOf(x.firstCut.date)} ${x.firstCut.date}` : 'no cut stage',
    );
    rec.check(
      `${C.id}: quit day is ${C.spec.quit.weekday} ${C.spec.quit.date}`,
      x.plan.quitDate === C.spec.quit.date && weekdayOf(x.plan.quitDate) === C.spec.quit.weekday,
      `generator: ${weekdayOf(x.plan.quitDate)} ${x.plan.quitDate}`,
    );
  }
}

/* ------------------------------------------------------------- the walk */

const SCREENS = {
  count: (p) => p.locator('#setup-count'),
  strength: (p) => p.locator('[role="group"][aria-labelledby="setup-mg-label"]'),
  lower: (p) => p.locator('[role="group"][aria-labelledby="setup-lower-label"]'),
  length: (p) => p.locator('[role="group"][aria-labelledby="setup-length-label"]'),
  start: (p) => p.locator('input[type="date"]'),
  rhythm: (p) => p.locator('input[type="time"]'),
  price: (p) => p.locator('#setup-cost'),
  preview: (p) => p.getByRole('button', { name: /^begin$/i }),
};

const visible = (loc, timeout = 5000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
const nextBtn = (p) => p.getByRole('button', { name: /^next$/i });
const stepOf = async (p) => {
  const m = (await e2e.bodyText(p)).match(/step\s+(\d+)\s+of\s+(\d+)/i);
  return m ? { i: Number(m[1]), of: Number(m[2]) } : null;
};
const pressed = async (loc) => (await loc.getAttribute('aria-pressed')) === 'true';
const mgOf = (text) => Number((text.match(/(\d+)\s*mg/i) ?? [])[1]);

// The Today screen: the main nav is up, Today is the current tab, and neither
// the Front door nor setup is showing.
async function onToday(p) {
  const nav = p.getByRole('navigation', { name: /main/i });
  if (!(await visible(nav, 6000))) return { ok: false, why: 'no main nav' };
  const cur = await nav.locator('[aria-current="page"]').first().innerText().catch(() => '');
  const text = await e2e.bodyText(p);
  if (!/today/i.test(cur)) return { ok: false, why: `current tab "${cur}"` };
  if (/start a new attempt/i.test(text)) return { ok: false, why: 'Front door still showing' };
  if (/step\s+\d+\s+of\s+\d+/i.test(text)) return { ok: false, why: 'setup still showing' };
  return { ok: true, why: '' };
}

// Pre-Day-1 mode: no "Day N of 90" header yet, and the screen names Day 1.
async function preMode(p, day1, rec, label) {
  const main = await p.locator('main').first().innerText().catch(() => '');
  const dayHeader = main.match(/\bday\s+\d+\s+of\s+\d+/i)?.[0];
  rec.check(`${label}: no "Day N of 90" yet`, !dayHeader, dayHeader ? `shows "${dayHeader}"` : '');
  // The date, not the wording: both the old card and its rewrite name it.
  rec.check(`${label}: names Day 1 (${day1})`, dateRx(day1).test(main),
    main.split('\n').find((l) => /day 1/i.test(l))?.slice(0, 80) ?? 'no Day 1 line');
}

const readRoot = async (p) => {
  const raw = await e2e.readStorage(p, 'pouch-down-v2');
  try { return raw ? JSON.parse(raw) : null; } catch { return undefined; }
};

// The saved plan's shape against planGenerator.js — dates, days, counts,
// strengths. Names and taglines are left out on purpose: they are copy.
const shape = (plan) => ({
  startDate: plan?.startDate, quitDate: plan?.quitDate, totalDays: plan?.totalDays,
  stages: (plan?.stages ?? []).map((s) => [s.kind, s.days[0], s.days[1], s.pouchesPerDay, s.mg]),
});

async function walkContext(browser, base, C, rec) {
  const X = expectedFor(C);
  const L = (s) => `${C.id} ${s}`;
  rec.section(`${C.id} · ${C.title} — clock ${C.now} ${TZ}`);

  const ctx = await e2e.phoneContext(browser, { tz: TZ, now: C.now });
  const seeded = seedV1String();
  await e2e.seedStorage(ctx, { 'pouch-down-v1': seeded, 'pouch-down-v2': null });
  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, C.id);

  await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' });
  const startBtn = page.getByRole('button', { name: /start a new attempt/i });
  const doorUp = await visible(startBtn, 8000);

  // The page must be on the pinned clock, not this machine's.
  const pageNow = await page.evaluate(() => Date.now());
  const drift = Math.round((pageNow - Date.parse(C.now)) / 1000);
  rec.check(L('page clock is pinned'), drift >= 0 && drift < 600, `${drift}s after ${C.now}`);

  /* front door */
  await rec.snap(page, `${C.id}-front-door`);
  let text = await e2e.bodyText(page);
  rec.check(L('Front door renders'), doorUp, text.slice(0, 90).replace(/\n/g, ' | '));
  const pastRow = page.getByRole('button', { name: /attempt 1\b/i });
  const listed = await visible(pastRow, 2000);
  rec.check(L('Attempt 1 listed as a past attempt'), listed);
  rec.check(L('No fake streak on the Front door'), !/\b\d+[- ]day streak/i.test(text));

  /* read-only detour */
  if (C.readOnlyDetour) {
    // By role, not clickText: the row's textContent runs "Attempt 1Jul 8…"
    // together, so a word-boundary regex can't see where "1" ends.
    if (listed) {
      await pastRow.first().click();
      await page.waitForTimeout(300);
      await rec.snap(page, `${C.id}-read-only`);
      text = await e2e.bodyText(page);
      rec.check(L('Read-only banner shown'), /read-only/i.test(text));
      const exit = page.getByRole('button', { name: /exit/i });
      const exitUp = await visible(exit, 2000);
      rec.check(L('Exit offered'), exitUp);
      if (exitUp) await exit.first().click();
      rec.check(L('Exit returns to the Front door'), await visible(startBtn, 4000));
      await rec.snap(page, `${C.id}-front-door-again`);
    } else {
      rec.check(L('Open Attempt 1'), false, 'no clickable past-attempt row');
    }
  }

  /* setup */
  // Returns false when the walk can't go on — the reason is already recorded.
  const screen = async (n, key, what) => {
    const up = await visible(SCREENS[key](page));
    const step = await stepOf(page);
    return rec.check(L(`screen ${n} is ${what}`), up && step?.i === n && step?.of === 8,
      `${up ? 'showing' : 'NOT showing'}; ${step ? `Step ${step.i} of ${step.of}` : 'no step counter'}`);
  };
  const advance = async (n, what) => {
    const btn = nextBtn(page);
    const ok = (await visible(btn, 2000)) && (await btn.isEnabled());
    rec.check(L(`Next is enabled on screen ${n} (${what})`), ok);
    if (ok) { await btn.click(); await page.waitForTimeout(200); }
    return ok;
  };

  const setup = async () => {
    if (!(await e2e.clickText(page, /start a new attempt/i))) return rec.check(L('Enter setup'), false, 'Start a new attempt not clickable');

    // 1 — count
    if (!(await screen(1, 'count', 'pouches a day'))) return false;
    const count = SCREENS.count(page);
    await count.fill(String(INPUTS.pouchesPerDay));
    await count.blur();
    rec.check(L(`count reads ${INPUTS.pouchesPerDay}`), (await count.inputValue()) === String(INPUTS.pouchesPerDay));
    await rec.snap(page, `${C.id}-setup-1-count`);
    if (!(await advance(1, 'count'))) return false;

    // 2 — strength
    if (!(await screen(2, 'strength', 'current strength'))) return false;
    const mgChip = SCREENS.strength(page).getByRole('button', { name: new RegExp(`^${INPUTS.mg}\\s*mg\\b`, 'i') });
    if (await visible(mgChip, 2000)) await mgChip.first().click();
    rec.check(L(`${INPUTS.mg} mg selected`), (await mgChip.count()) === 1 && (await pressed(mgChip)));
    await rec.snap(page, `${C.id}-setup-2-strength`);
    if (!(await advance(2, 'strength'))) return false;

    // 3 — lower strengths: toggle chips until exactly [6, 3] are on, whatever
    // the default was (today it is "all on").
    if (!(await screen(3, 'lower', 'lower strengths'))) return false;
    const chips = SCREENS.lower(page).getByRole('button');
    const offered = [];
    for (let k = 0; k < (await chips.count()); k++) {
      const chip = chips.nth(k);
      const mg = mgOf(await chip.innerText());
      offered.push(mg);
      if (INPUTS.strengths.includes(mg) !== (await pressed(chip))) await chip.click();
    }
    rec.check(L('only lower strengths offered, incl. 6 and 3'),
      offered.length > 0 && offered.every((mg) => mg < INPUTS.mg) && INPUTS.strengths.every((mg) => offered.includes(mg)),
      `offered [${offered.join(', ')}]`);
    const on = [];
    for (let k = 0; k < (await chips.count()); k++) if (await pressed(chips.nth(k))) on.push(mgOf(await chips.nth(k).innerText()));
    rec.check(L('exactly [6, 3] left on'), on.sort((a, b) => b - a).join(',') === INPUTS.strengths.join(','), `on [${on.join(', ')}]`);
    await rec.snap(page, `${C.id}-setup-3-lower`);
    if (!(await advance(3, 'lower strengths'))) return false;

    // 4 — length
    if (!(await screen(4, 'length', 'plan length'))) return false;
    const lenChip = SCREENS.length(page).getByRole('button', { name: new RegExp(`^${INPUTS.lengthDays}\\s*days\\b`, 'i') });
    if ((await visible(lenChip, 2000)) && !(await pressed(lenChip))) await lenChip.first().click();
    rec.check(L(`${INPUTS.lengthDays} days selected`), (await lenChip.count()) === 1 && (await pressed(lenChip)));
    await rec.snap(page, `${C.id}-setup-4-length`);
    if (!(await advance(4, 'length'))) return false;

    // 5 — Day 1
    if (!(await screen(5, 'start', 'Day 1'))) return false;
    const date = SCREENS.start(page);
    const alert = page.getByRole('alert');
    const dflt = await date.inputValue();
    rec.check(L(`default Day 1 is ${C.defaultDay1}`), dflt === C.defaultDay1, `input holds "${dflt}"`);
    await rec.snap(page, `${C.id}-setup-5-default`);
    const setDate = async (v) => { await date.fill(v); await date.blur(); await page.waitForTimeout(150); };

    for (const past of C.refuse) {
      await setDate(past);
      const msg = (await visible(alert, 2000)) ? await alert.first().innerText() : '';
      rec.check(L(`${past} refused with the app's message`), /passed|past|today or later/i.test(msg), msg ? `"${msg.slice(0, 70)}"` : 'no alert shown');
      rec.check(L(`Next is disabled for ${past}`), await nextBtn(page).isDisabled());
      // A real tap on the dimmed button — it must not move the flow on.
      await nextBtn(page).click({ force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      const step = await stepOf(page);
      const stayed = step?.i === 5 && (await date.isVisible());
      rec.check(L(`${past} does not advance`), stayed, step ? `Step ${step.i}` : 'no step counter');
      await rec.snap(page, `${C.id}-setup-5-refused-${past}`);
      if (!stayed) return false; // the flow moved on; the rest of this walk would be about the wrong plan
    }
    for (const ok of C.allow) {
      await setDate(ok);
      const shown = (await alert.count()) ? await alert.first().innerText() : '';
      const enabled = await nextBtn(page).isEnabled();
      rec.check(L(`${ok} (the app's today) is allowed`), !shown && enabled,
        shown ? `"${shown.slice(0, 70)}"` : enabled ? 'no error, Next enabled' : 'Next disabled');
      await rec.snap(page, `${C.id}-setup-5-allowed-${ok}`);
    }
    if (C.type || C.refuse.length || C.allow.length) await setDate(X.day1);
    const final = await date.inputValue();
    rec.check(L(`Day 1 set to ${X.day1}`), final === X.day1 && !(await alert.count()), `input holds "${final}"`);
    await rec.snap(page, `${C.id}-setup-5-day1`);
    if (!(await advance(5, 'Day 1'))) return false;

    // 6 — rhythm: the migrated times, untouched
    if (!(await screen(6, 'rhythm', 'daily rhythm'))) return false;
    const times = await SCREENS.rhythm(page).evaluateAll((els) => els.map((e) => e.value));
    rec.check(L('rhythm pre-filled from the last attempt'), times.length >= 5 && times.every(Boolean), `[${times.join(', ')}]`);
    await rec.snap(page, `${C.id}-setup-6-rhythm`);
    if (!(await advance(6, 'rhythm'))) return false;

    // 7 — price: the migrated price, untouched
    if (!(await screen(7, 'price', 'price'))) return false;
    await rec.snap(page, `${C.id}-setup-7-price`);
    if (!(await advance(7, 'price'))) return false;

    // 8 — preview
    if (!(await screen(8, 'preview', 'the plan preview'))) return false;
    await page.waitForTimeout(300);
    await rec.snap(page, `${C.id}-setup-8-preview`);
    await page.screenshot({ path: `${rec.out}/${C.id}-preview-full.png`, fullPage: true }).catch(() => {});
    const pv = await page.locator('main').first().innerText();
    const cards = (await page.locator('main .card').allInnerTexts()).map((t) => t.trim()).filter((t) => /^day\s+\d+/i.test(t));

    // Against the spec.
    const S = C.spec;
    rec.check(L(`spec: ${S.stages} stages listed`), cards.length === S.stages, `${cards.length} stage cards`);
    const cutCard = cards.find((t) => new RegExp(`^day\\s+${S.firstCut.day}\\b`, 'i').test(t));
    rec.check(L(`spec: first cut day ${S.firstCut.day}, ${S.firstCut.date.slice(5)}`), !!cutCard && dateRx(S.firstCut.date).test(cutCard.split('\n')[0]),
      cutCard ? cutCard.split('\n')[0] : `no card starting "day ${S.firstCut.day}"`);
    rec.check(L(`spec: quit day ${S.quit.weekday} ${S.quit.date.slice(5)} shown`), dateRx(S.quit.date, { weekday: true }).test(pv),
      pv.match(/zero on[^\n]*/i)?.[0] ?? pv.split('\n')[0]);
    const lastCard = cards[cards.length - 1] ?? '';
    rec.check(L('spec: last card is zero on quit day'), /zero|\b0\s*\/\s*day/i.test(lastCard) && dateRx(S.quit.date).test(lastCard.split('\n')[0]), lastCard.split('\n')[0]);
    rec.check(L(`preview says it starts ${weekdayOf(X.day1)} ${X.day1.slice(5)}`), dateRx(X.day1, { weekday: true }).test(pv));

    // Against planGenerator.js, card by card.
    const bad = [];
    X.plan.stages.forEach((s, k) => {
      const t = cards[k] ?? '';
      const head = t.split('\n')[0];
      const range = s.days[0] === s.days[1] ? `${s.days[0]}\\b(?!\\s*[–-]\\s*\\d)` : `${s.days[0]}\\s*[–-]\\s*${s.days[1]}\\b`;
      const dose = s.pouchesPerDay === 0 ? /zero|\b0\s*\/\s*day/i : new RegExp(`\\b${s.pouchesPerDay}\\s*/\\s*day\\b[\\s\\S]*\\b${s.mg}\\s*mg\\b`, 'i');
      const from = addDays(X.day1, s.days[0] - 1);
      if (!new RegExp(`^day\\s+${range}`, 'i').test(head) || !dateRx(from).test(head) || !dose.test(t)) {
        bad.push(`#${k + 1} want day ${s.days.join('–')} ${from} ${s.pouchesPerDay}/day@${s.mg} got "${head}"`);
      }
    });
    rec.check(L('every stage card matches planGenerator.js'), cards.length === X.plan.stages.length && bad.length === 0,
      bad.length ? bad.slice(0, 2).join('; ') : `${cards.length} vs ${X.plan.stages.length} stages`);
    return true;
  };

  // A stalled control (say, a screen that never came) is the APP failing this
  // context, not the walk crashing: record it and still run the reload and v1
  // checks below.
  const stalled = (what) => (e) => rec.check(L(`${what} did not stall`), false, String(e?.message ?? e).split('\n')[0]);
  const through = await setup().catch(stalled('setup'));

  /* begin → today — returns the root as saved straight after Begin */
  const beginAndLand = async () => {
    const begin = SCREENS.preview(page);
    const canBegin = await begin.isEnabled();
    rec.check(L('Begin is enabled'), canBegin);
    if (canBegin) await begin.click();
    const today = await onToday(page);
    await page.waitForTimeout(300);
    await rec.snap(page, `${C.id}-today`);
    rec.check(L('Begin lands on Today'), today.ok, today.why);
    await preMode(page, X.day1, rec, L('Today (Day 1 is tomorrow)'));

    const before = await readRoot(page);
    const active = before?.attempts?.find((a) => a.id === before.activeAttemptId);
    rec.check(L('v2 written with the migrated attempt + the new one'),
      before?.attempts?.length === 2 && before.attempts[0].status === 'archived' && active === before.attempts[1] && active?.status === 'active',
      before === null ? 'no pouch-down-v2' : before === undefined ? 'v2 is not JSON' : `${before.attempts?.length} attempts`);
    const got = JSON.stringify(shape(active?.plan));
    rec.check(L('saved plan matches planGenerator.js'), got === JSON.stringify(shape(X.plan)),
      active ? `${active.plan?.startDate} → ${active.plan?.quitDate}, ${active.plan?.stages?.length} stages` : 'no active attempt');
    rec.check(L(`saved quit date is the spec's ${C.spec.quit.date}`), active?.plan?.quitDate === C.spec.quit.date);
    return before;
  };
  const before = through ? await beginAndLand().catch(stalled('Begin')) : null;

  /* reload once */
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (before?.attempts) {
    const today = await onToday(page);
    await page.waitForTimeout(300);
    await rec.snap(page, `${C.id}-today-after-reload`);
    rec.check(L('reload: still Today, not the Front door'), today.ok, today.why);
    await preMode(page, X.day1, rec, L('reload'));
    const after = await readRoot(page);
    const was = before.attempts.find((a) => a.id === before.activeAttemptId);
    const now = after?.attempts?.find((a) => a.id === after.activeAttemptId);
    // A re-seed would have deleted v2 before the app booted, and migration
    // would have rebuilt a root holding only Attempt 1.
    rec.check(L('reload: same attempt, seed did not re-run'),
      after?.attempts?.length === 2 && now?.id === was?.id && now?.createdAt === was?.createdAt,
      after ? `${after.attempts?.length} attempts, active ${after.activeAttemptId}` : 'pouch-down-v2 gone');
  } else {
    await visible(startBtn, 4000);
    await rec.snap(page, `${C.id}-after-reload`);
  }

  await e2e.v1Unchanged(page, seeded, rec);
  if (!args.keep) await ctx.close();
  return errors;
}

/* ------------------------------------------------------------------ main */

e2e.run(async () => {
  const rec = e2e.createRecorder(args.out);

  if (args.dry) {
    console.log(`\nfixture: pouch-down-v1 = seedV1String() ${JSON.stringify(summary())}; pouch-down-v2 absent`);
    console.log(`inputs: ${JSON.stringify(INPUTS)}; rhythm/price from v1 settings ${JSON.stringify({ ...SEEDED_SETTINGS.mealTimes, sleep: SEEDED_SETTINGS.sleepTime, costPerTin: SEEDED_SETTINGS.costPerTin, pouchesPerTin: SEEDED_SETTINGS.pouchesPerTin })}`);
    for (const C of CONTEXTS) {
      const X = expectedFor(C);
      console.log(`\n${C.id} · ${C.title} — port ${args.port}`);
      STEPS(C).forEach((s, k) => console.log(`  ${String(k + 1).padStart(2)}. ${s}`));
      console.log(`  planGenerator: ${X.plan.stages.map((s) => `${s.days[0]}–${s.days[1]} ${s.pouchesPerDay}@${s.mg}`).join(' · ')} → quit ${X.plan.quitDate}`);
    }
    domainChecks(rec);
    return e2e.finish(rec);
  }

  domainChecks(rec);
  const dist = args.dist ?? (await e2e.buildApp(`${args.out}/build`));
  const { base } = await e2e.startPreview({ dist, port: args.port });
  const browser = await chromium.launch();
  const errors = [];
  for (const C of CONTEXTS) errors.push(await walkContext(browser, base, C, rec));
  if (!args.keep) await browser.close();
  return e2e.finish(rec, errors);
});
