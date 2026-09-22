// The first thing James does after tonight's deploy, driven in headless
// Chromium on a 390px phone: the app finds his old v1 data, migrates it into
// the attempts model, shows the Front door, and he opens Attempt 1
// (Jul 8 – Sep 5) READ-ONLY to see whether it tells the truth. Then Exit, then
// a reload. Screenshots every step so a human can actually LOOK at it.
//
// "Tells the truth" is the whole point of the rebuild, so most of this walk is
// about what must NOT be on screen: no log ring, SOS, check-in, coach or
// backfill prompt (a past attempt has no today), no award overlay (awards show
// but never celebrate), no "nicotine-free", "since last pouch" or "since quit
// day" clock (elapsed time is not evidence), and no current streak — a best
// streak labelled "best" is history, anything else is a number silence could
// have made up. Silent days must read gray "no log",
// never green. Every expected number (logged days, best streak, pouches not
// used, money kept, each stage's "N of M days logged", each day's count and
// wall-clock times) is worked out HERE from the seeded events and the frozen
// legacy plan, with no app code, so the app can't grade its own homework.
//
// Three browser contexts, each on a PINNED clock (Mon 2026-09-21 21:00 CDT —
// the evening James restarts), each seeded exactly once by lib.mjs with v1 only:
//   A  America/Chicago   the full walk, where James actually is now.
//   B  America/New_York  the same walk from the zone v1 was logged in. v1
//                        events carry no zone, so migration stamps them New
//                        York; History must show the SAME wall-clock times in
//                        both contexts — a Chicago reader must not shift them.
//   C  America/Chicago   v1 with ONE unreadable entry (a pouch with no ts).
//                        Migration must still succeed, keep every readable
//                        event, set the bad one aside, and say so in the
//                        read-only summary instead of dropping it silently.
//
// The one assertion that matters beyond "it rendered": `pouch-down-v1` must be
// byte-identical at the end of every context. It is the rollback; the app may
// read it once and never write it. After Exit each full context reloads once:
// viewing mode must not survive a reload, and the stored root must be the same
// one attempt — not re-migrated (the seed didn't re-run), not duplicated.
//
// Selectors lean on roles, aria labels and computed colors rather than layout,
// because Today's ring and toast are still being polished. The viewer isn't.
//
// Usage: node scripts/e2e/walk-migration.mjs [--dist DIR] [--out DIR] [--port N] [--keep] [--dry]
import { chromium } from 'playwright-core';
import * as e2e from './lib.mjs';
import { seedV1, seedV1String, summary } from './seed-v1.mjs';
import { LEGACY_PLAN } from '../../src/legacyPlan.js';

const args = e2e.parseArgs({ name: 'walk-migration', port: 4331 });

// Mon 2026-09-21 21:00 CDT, the same instant in every context.
const NOW = '2026-09-21T21:00:00-05:00';

/* ------------------------------------------------------------------ fixture */

// The unreadable entry for context C: a pouch with no timestamp, so it can't be
// put on any day. Spliced into the middle of the history, not the end, so a
// migration that stops at the first bad entry loses real events and shows it.
const BROKEN = { id: 'synthetic-unreadable', type: 'pouch', trigger: null };
function seedWithBrokenEntry() {
  const v1 = seedV1();
  v1.events.splice(Math.floor(v1.events.length / 2), 0, BROKEN);
  return JSON.stringify(v1);
}

const CONTEXTS = [
  { id: 'A', title: 'what James sees tonight', tz: 'America/Chicago', seed: seedV1String, full: true },
  { id: 'B', title: 'the same walk, read in New York', tz: 'America/New_York', seed: seedV1String, full: true },
  { id: 'C', title: 'one unreadable v1 entry', tz: 'America/Chicago', seed: seedWithBrokenEntry, full: false },
];

// History rows opened and read line by line: a check-in day, a resisted day,
// a full early day, and the lone late day in the quiet stretch.
const SAMPLE_DAYS = [1, 10, 12, 47];

// v1 was logged in New York, and Jul–Sep there is EDT (UTC-4) — no DST change
// inside the attempt, so a fixed offset is exact here. Days run 4am → 4am.
const HOUR = 3600000;
const DAY_MS = 24 * HOUR;
const EDT_MS = 4 * HOUR;
const CUTOFF_MS = 4 * HOUR;
const nyDayOf = (ts) => new Date(Date.parse(ts) - EDT_MS - CUTOFF_MS).toISOString().slice(0, 10);
const nyClock = (ts) => {
  const d = new Date(Date.parse(ts) - EDT_MS);
  const h = d.getUTCHours();
  return `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const addDays = (s, n) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
// The walk's own idea of "can this entry be put on a day" — a timestamp that parses.
const readable = (e) => !!e && typeof e === 'object' && !Array.isArray(e)
  && typeof e.ts === 'string' && Number.isFinite(Date.parse(e.ts));

// Everything the viewer should say, derived from the seeded v1 string and the
// frozen legacy plan only — the spec's rules, re-implemented by hand.
function expectFrom(seeded) {
  const v1 = JSON.parse(seeded);
  const plan = LEGACY_PLAN;
  const events = v1.events.filter(readable);
  const days = [];
  for (let n = 1; n <= plan.totalDays; n++) {
    const date = addDays(plan.startDate, n - 1);
    const stage = plan.stages.find((s) => n >= s.days[0] && n <= s.days[1]);
    const evs = events.filter((e) => nyDayOf(e.ts) === date).sort((a, b) => a.ts.localeCompare(b.ts));
    const pouches = evs.filter((e) => e.type === 'pouch').length;
    const resisted = evs.filter((e) => e.type === 'resisted').length;
    // Logged = a pouch or a resisted craving. A check-in alone says nothing about nicotine.
    const logged = pouches + resisted > 0;
    const cap = stage.pouchesPerDay;
    days.push({ n, date, cap, pouches, logged, green: logged && pouches <= cap, times: evs.map((e) => nyClock(e.ts)) });
  }
  let run = 0;
  let best = 0;
  for (const d of days) {
    run = d.green ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const logged = days.filter((d) => d.logged);
  const base = plan.baseline.pouchesPerDay;
  const perPouch = v1.settings.costPerTin / v1.settings.pouchesPerTin;
  const used = logged.reduce((s, d) => s + d.pouches, 0);
  return {
    v1,
    events,
    unreadable: v1.events.filter((e) => !readable(e)),
    days,
    loggedDays: logged.length,
    best,
    // The spec's money: logged days only — old pace minus what was spent.
    kept: logged.length * base * perPouch - used * perPouch,
    // Pouches not used: logged days only, never below zero on a day.
    avoided: logged.reduce((s, d) => s + Math.max(0, base - d.pouches), 0),
    stages: plan.stages.map((s) => ({
      days: s.days,
      of: s.days[1] - s.days[0] + 1,
      logged: days.filter((d) => d.n >= s.days[0] && d.n <= s.days[1] && d.logged).length,
    })),
  };
}

const STEPS = (C) => [
  `pin clock to ${NOW} (${C.tz}); seed pouch-down-v1 = ${C.id === 'C' ? 'seedV1() + 1 unreadable entry' : 'seedV1String()'}, pouch-down-v2 absent`,
  'boot → migration → Front door: "Start a new attempt" + "Past attempts" with exactly one row, "Attempt 1 · Jul 8 – Sep 5 · 60 days · N logged"',
  'stored v2: a1 archived, every readable v1 event present and stamped New York, ' +
    (C.id === 'C' ? 'the bad entry kept aside in unreadableEvents' : 'no unreadableEvents') + ', no API key in attempts',
  'open Attempt 1 → banner "Viewing Attempt 1 · Jul 8 – Sep 5" + Exit',
  'Today: the read-only summary (days logged, best streak, kept) and none of: log ring, SOS, check-in, coach, backfill, award overlay, "nicotine-free", "since last pouch", a current streak' +
    (C.id === 'C' ? '; "One old entry couldn\'t be read. It\'s kept in your backup."' : ''),
  ...(C.full
    ? [
      'Calendar: none of the live controls',
      'Stats: "pouches not used" labelled "on logged days" with the logged-days number; History lists exactly 60 days, each day\'s count or "no log", silent days never green',
      `Stats: open Days ${SAMPLE_DAYS.join(', ')} → wall-clock times as logged in New York`,
      'Plan: every stage past/ended with "N of M days logged", none green, none "done"',
      'Settings in the viewer: no "Simulate import", no "This is your first attempt", key field disabled',
      'Exit → Front door; viewing wrote nothing to v2',
      'reload → still the Front door, same single attempt (seed did not re-run, nothing duplicated)',
    ]
    : ['Exit → Front door']),
  'pouch-down-v1 byte-identical',
];

/* ----------------------------------------------- fixture self-check (no browser) */

function fixtureChecks(rec) {
  rec.section('fixture vs seed-v1.mjs (no browser)');
  const S = summary();
  const X = expectFrom(seedV1String());
  const Xc = expectFrom(seedWithBrokenEntry());
  // If the walk's own day-bucketing disagreed with the seed's, every count below would be wrong.
  rec.check(`walk derives ${S.loggedDays} logged days, as seed-v1 says`, X.loggedDays === S.loggedDays, `${X.loggedDays}`);
  rec.check(`walk derives ${S.totalDays} plan days, ${S.silentDays} silent`,
    X.days.length === S.totalDays && X.days.filter((d) => !d.logged).length === S.silentDays,
    `${X.days.length} days, ${X.days.filter((d) => !d.logged).length} silent`);
  rec.check('every seeded event lands on a plan day', X.days.reduce((s, d) => s + d.times.length, 0) === X.events.length);
  rec.check('the last days of the attempt are silent (the tail the viewer must gray out)',
    X.days.slice(-4).every((d) => !d.logged));
  rec.check('C: exactly one unreadable entry, every other event readable',
    Xc.unreadable.length === 1 && Xc.events.length === Xc.v1.events.length - 1 && Xc.loggedDays === S.loggedDays,
    `${Xc.unreadable.length} unreadable of ${Xc.v1.events.length}`);
}

/* ------------------------------------------------------------- the walk */

const visible = (loc, timeout = 5000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n = 90) => squash(s).slice(0, n);

const readRaw = (p) => e2e.readStorage(p, 'pouch-down-v2');
const parse = (raw) => {
  try { return raw ? JSON.parse(raw) : null; } catch { return undefined; }
};

// Every property name anywhere under `obj`, for "no API key has leaked in here".
function keyPaths(obj, want, path = '') {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).flatMap(([k, v]) => [
    ...(want.test(k) ? [`${path}${k}`] : []),
    ...keyPaths(v, want, `${path}${k}.`),
  ]);
}

// Lines that claim a CURRENT streak. A best streak ("10 / BEST STREAK") is
// history and fine; a trophy's title ("7-day streak") is a badge name, not a
// claim; "No streak going yet" has no number and is honest. Anything else with
// a positive number on or right above a "streak" line is a claim.
function currentStreakClaims(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  lines.forEach((l, i) => {
    if (!/streak/i.test(l) || /\bbest\b/i.test(l) || /^\d+-day streak$/i.test(l)) return;
    const own = Number((l.match(/\b(\d+)\b/) ?? [])[1]);
    const above = /^\d+$/.test(lines[i - 1] ?? '') ? Number(lines[i - 1]) : NaN;
    if (own > 0 || above > 0) out.push(Number.isNaN(above) ? l : `${lines[i - 1]} ${l}`);
  });
  return out;
}

// Everything a past attempt must not offer, found by role and aria label first
// and by copy second. Returns { item: [what was found] } — empty means absent.
async function liveControls(page, { allowDialog = false } = {}) {
  const found = await page.evaluate(() => {
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const els = (sel) => [...document.querySelectorAll(sel)].filter(shown);
    const label = (el) => el.getAttribute('aria-label') ?? '';
    const say = (el) => (label(el) || el.innerText || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 60);
    const controls = els('button, [role="button"], a');
    const text = document.body.innerText;
    const copy = (rx) => (text.match(rx) ?? []).map((m) => `"${m}"`);
    return {
      'log ring': [
        ...controls.filter((el) => /\blog a pouch\b/i.test(label(el))).map(say),
        ...copy(/\b\d+ of \d+ used today\b|\bmg each\b/gi),
      ],
      SOS: [...controls.filter((el) => /\bSOS\b/.test(el.innerText ?? '') || /craving sos/i.test(label(el))).map(say),
        ...els('[aria-label="Craving SOS"]').map(say)],
      'check-in card': [...controls.filter((el) => /check-in/i.test(label(el))).map(say),
        ...copy(/morning check-in|how'd you sleep/gi)],
      'coach button': controls.filter((el) => /coach/i.test(label(el))).map(say),
      'backfill prompt': copy(/no log for \w+/gi),
      'award-unlock overlay': els('[aria-modal="true"], [role="dialog"], [role="alertdialog"]').map(say),
      '"nicotine-free"': copy(/nicotine[- ]free/gi),
      '"since last pouch"': copy(/since last pouch/gi),
      // The post-quit screen's elapsed clock — what a past attempt would show
      // if the viewer check ever ran after the quit-day check.
      '"since quit day" clock': copy(/since quit day/gi),
      'streak chip': controls.filter((el) => /streak/i.test(label(el)) && /trophy case/i.test(label(el))).map(say),
    };
  });
  if (allowDialog) found['award-unlock overlay'] = [];
  found['current streak'] = currentStreakClaims(await e2e.bodyText(page));
  return found;
}

const offenders = (found) => Object.entries(found).filter(([, v]) => v.length).map(([k, v]) => `${k}: ${v.slice(0, 2).join(', ')}`);

async function walkContext(browser, base, C, rec, shared) {
  const L = (s) => `${C.id} ${s}`;
  rec.section(`${C.id} · ${C.title} — clock ${NOW}, ${C.tz}`);

  const seeded = C.seed(); // ONE call: seedV1() mints fresh ids every time it runs
  const X = expectFrom(seeded);
  const S = summary();

  const ctx = await e2e.phoneContext(browser, { tz: C.tz, now: NOW });
  await e2e.seedStorage(ctx, { 'pouch-down-v1': seeded, 'pouch-down-v2': null });
  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, C.id);

  await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' });
  const startBtn = page.getByRole('button', { name: /start a new attempt/i });
  const doorUp = await visible(startBtn, 8000);

  const pageNow = await page.evaluate(() => Date.now());
  const drift = Math.round((pageNow - Date.parse(NOW)) / 1000);
  rec.check(L('page clock is pinned'), drift >= 0 && drift < 600, `${drift}s after ${NOW}`);
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  rec.check(L(`page is in ${C.tz}`), zone === C.tz, zone);

  /* front door */
  await rec.snap(page, `${C.id}-front-door`);
  const doorText = await e2e.bodyText(page);
  rec.check(L('Front door: "Start a new attempt"'), doorUp, doorUp ? '' : clip(doorText));
  rec.check(L('Front door: "Past attempts" list'), /past attempts/i.test(doorText));
  const rows = page.getByRole('button', { name: /^attempt \d+/i });
  await visible(rows, 2000);
  const rowCount = await rows.count();
  rec.check(L('exactly one past attempt listed'), rowCount === 1, `${rowCount} rows`);
  const row = rows.first();
  const rowText = rowCount ? squash(await row.innerText()) : '';
  const want = new RegExp(`^Attempt 1\\s+Jul 8\\s*[–-]\\s*Sep 5\\s*·\\s*60 days\\s*·\\s*${S.loggedDays} logged$`);
  rec.check(L(`row reads "Attempt 1 · Jul 8 – Sep 5 · 60 days · ${S.loggedDays} logged"`), want.test(rowText), `"${rowText}"`);
  rec.check(L('Front door: no streak, no elapsed-time clock'),
    !/\b\d+[- ]day streak|nicotine[- ]free|since last pouch/i.test(doorText), clip(doorText.match(/.*(streak|nicotine|since last).*/i)?.[0]));

  /* stored v2, straight after the migration */
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  rec.check(L('storage holds exactly v1 + v2'), keys.join(',') === 'pouch-down-v1,pouch-down-v2', keys.join(', '));
  const rawBefore = await readRaw(page);
  const root = parse(rawBefore);
  const a1 = root?.attempts?.[0];
  rec.check(L('v2 written: one attempt, a1, archived, nothing active'),
    root?.version === 2 && root.attempts.length === 1 && a1?.id === 'a1' && a1.status === 'archived' && root.activeAttemptId === null,
    root === null ? 'no pouch-down-v2' : root === undefined ? 'v2 is not JSON' : `${root.attempts?.length} attempts, a1 ${a1?.status}, active ${root.activeAttemptId}`);
  rec.check(L('a1 plan is the frozen Jul 8 → Sep 5, 60 days; v1 celebrations carried'),
    a1?.plan?.startDate === '2026-07-08' && a1.plan.quitDate === '2026-09-05' && a1.plan.totalDays === 60
      && JSON.stringify(a1.celebratedStages) === JSON.stringify(X.v1.celebratedStages)
      && Array.isArray(a1.celebratedAwards) && a1.celebratedAwards.length === 0,
    `${a1?.plan?.startDate} → ${a1?.plan?.quitDate}, ${a1?.plan?.totalDays} days, stages ${JSON.stringify(a1?.celebratedStages)}`);

  const v2Events = a1?.events ?? [];
  rec.check(L(`event count equal (${X.events.length}${X.unreadable.length ? ` readable of ${X.v1.events.length}` : ''})`),
    v2Events.length === X.events.length, `${v2Events.length} in v2`);
  // Present = same id, and every field v1 had comes through unchanged.
  const byId = new Map(v2Events.map((e) => [e.id, e]));
  const missing = X.events.filter((e) => {
    const got = byId.get(e.id);
    return !got || Object.keys(e).some((k) => JSON.stringify(got[k]) !== JSON.stringify(e[k]));
  });
  rec.check(L('every readable v1 event present, fields unchanged'), missing.length === 0,
    missing.length ? `${missing.length} missing/changed, e.g. ${missing[0].id}` : '');
  const badStamp = v2Events.filter((e) => e.tzOffsetMin !== -240 || e.day !== nyDayOf(e.ts));
  rec.check(L('every event stamped New York (EDT -240) with its 4am→4am day'), v2Events.length > 0 && badStamp.length === 0,
    badStamp.length ? `${badStamp.length} off, e.g. ${badStamp[0].id} ${badStamp[0].tzOffsetMin} ${badStamp[0].day}` : '');
  if (X.unreadable.length) {
    rec.check(L('the unreadable entry is kept aside, verbatim'),
      JSON.stringify(a1?.unreadableEvents) === JSON.stringify(X.unreadable) && !v2Events.some((e) => e.id === BROKEN.id),
      `unreadableEvents = ${JSON.stringify(a1?.unreadableEvents)}`);
  } else {
    rec.check(L('no unreadableEvents'), a1 && !('unreadableEvents' in a1), a1 && 'unreadableEvents' in a1 ? JSON.stringify(a1.unreadableEvents).slice(0, 60) : '');
  }
  const leaks = keyPaths(root?.attempts, /api.?key/i);
  rec.check(L('no API key anywhere in attempts'), !!root?.attempts && leaks.length === 0, leaks.join(', '));

  /* open attempt 1 */
  const exitBtn = page.getByRole('button', { name: /exit/i });
  if (rowCount) await row.click();
  const inViewer = await visible(exitBtn, 4000);
  rec.check(L('Attempt 1 opens'), inViewer, rowCount ? '' : 'no row to open');
  // Long enough for an award unlock or a backfill prompt to show up if either
  // were (wrongly) going to.
  await page.waitForTimeout(1200);
  await rec.snap(page, `${C.id}-viewer-today`);
  const banner = inViewer ? squash(await exitBtn.first().locator('xpath=ancestor::div[.//*[contains(., "Viewing")]][1]').innerText().catch(() => '')) : '';
  rec.check(L('banner reads "Viewing Attempt 1 · Jul 8 – Sep 5" with Exit'),
    /^Viewing Attempt 1\b\s*·?\s*Jul 8\s*[–-]\s*Sep 5\b/.test(banner) && /\bExit$/.test(banner), `"${banner}"`);

  /* today, read-only */
  const found = await liveControls(page);
  for (const [item, hits] of Object.entries(found)) {
    rec.check(L(`Today: no ${item}`), hits.length === 0, hits.slice(0, 2).join(', '));
  }
  const today = await page.locator('main').first().innerText().catch(() => '');
  const tl = squash(today);
  const fig = (label) => tl.match(new RegExp(`(\\$?[\\d.,]+) ${label}`, 'i'))?.[1];
  rec.check(L(`summary: ${X.loggedDays} days logged`), fig('days logged') === String(X.loggedDays), `shows ${fig('days logged')}`);
  rec.check(L(`summary: best streak ${X.best}, labelled best`), fig('best streak') === String(X.best), `shows ${fig('best streak')}`);
  const keptWant = `$${Math.abs(X.kept).toFixed(2)}`;
  const keptLabel = X.kept < 0 ? 'over your old pace' : 'kept vs old pace';
  rec.check(L(`summary: ${keptWant} ${keptLabel} (logged days only)`), fig(keptLabel) === keptWant, `shows ${fig(keptLabel) ?? tl.match(/\$[\d.]+ [a-z ]+/i)?.[0]}`);
  const unreadLine = "One old entry couldn't be read. It's kept in your backup.";
  if (X.unreadable.length) {
    rec.check(L(`summary: "${unreadLine}"`), tl.includes(unreadLine), clip(tl.match(/[^.]*couldn.t be read[^.]*\.[^.]*\./i)?.[0] ?? 'no such line'));
  } else {
    rec.check(L('summary: no unreadable-entries line'), !/couldn.t be read/i.test(tl));
  }

  const nav = page.getByRole('navigation', { name: /main/i });
  const goTab = async (name) => {
    const b = nav.getByRole('button', { name: new RegExp(`^${name}$`, 'i') });
    if (!(await visible(b, 2000))) return false;
    await b.first().click();
    await page.waitForTimeout(450);
    return (await b.first().getAttribute('aria-current')) === 'page';
  };
  const noLive = async (where) => {
    const o = offenders(await liveControls(page));
    rec.check(L(`${where}: none of the live controls, no current streak`), o.length === 0, o.slice(0, 3).join('; '));
  };

  if (C.full) {
    /* calendar */
    rec.check(L('Calendar tab opens'), await goTab('calendar'));
    await rec.snap(page, `${C.id}-viewer-calendar`);
    await noLive('Calendar');

    /* stats */
    rec.check(L('Stats tab opens'), await goTab('stats'));
    await rec.snap(page, `${C.id}-viewer-stats`, { fullPage: true });
    await noLive('Stats');
    const notUsed = page.locator('.card').filter({ hasText: /pouches not used/i }).last();
    const nu = (await visible(notUsed, 2000)) ? squash(await notUsed.innerText()) : '';
    rec.check(L('"pouches not used" is labelled "on logged days"'), /pouches not used on logged days/i.test(nu), `"${clip(nu)}"`);
    rec.check(L(`pouches not used = ${X.avoided} (logged days only)`), Number(nu.match(/^(\d+)/)?.[1]) === X.avoided, `shows ${nu.match(/^(\d+)/)?.[1]}`);
    const loggedCard = squash(await page.locator('.card').filter({ hasText: /of \d+ days/i }).first().innerText().catch(() => ''));
    rec.check(L(`Stats: ${X.loggedDays} of 60 days logged`), new RegExp(`^${X.loggedDays} of 60 days logged$`, 'i').test(loggedCard), `"${loggedCard}"`);

    // History: all 60 days, newest first, each with its count or "no log".
    const history = page.locator('.card').filter({ has: page.getByText(/^history$/i) }).last();
    const hasHistory = await visible(history, 2000);
    rec.check(L('History card present'), hasHistory);
    const showAll = history.getByRole('button', { name: /show all/i });
    if (await visible(showAll, 1500)) {
      rec.check(L('History offers "Show all 60 days"'), /show all 60 days/i.test(await showAll.innerText()), await showAll.innerText());
      await showAll.click();
      await page.waitForTimeout(300);
    }
    const dayBtns = history.locator('button[aria-expanded]');
    const read = await dayBtns.evaluateAll((els) => els.map((el) => {
      const green = [el, ...el.querySelectorAll('*')].some((x) => /^rgba?\(52, 211, 153/.test(getComputedStyle(x).backgroundColor));
      return { text: el.innerText.replace(/\s+/g, ' ').trim(), green };
    }));
    const listed = read.map((r) => ({ ...r, n: Number(r.text.match(/^Day (\d+)\b/)?.[1]) })).filter((r) => r.n);
    const ns = listed.map((r) => r.n);
    rec.check(L('History lists exactly 60 days, 60 → 1, each once'),
      ns.length === 60 && ns.every((n, i) => n === 60 - i), `${ns.length} rows: ${ns.slice(0, 3).join(',')}…${ns.slice(-2).join(',')}`);
    const wrong = [];
    for (const d of X.days) {
      const r = listed.find((x) => x.n === d.n);
      const tail = d.logged ? `${d.pouches}/${d.cap}` : 'no log';
      if (!r || !r.text.endsWith(`· ${tail}`)) wrong.push(`Day ${d.n} want "${tail}" got "${r?.text ?? 'no row'}"`);
    }
    rec.check(L('every History row shows its count, silent days "no log"'), listed.length > 0 && wrong.length === 0, wrong.slice(0, 2).join('; '));
    const silentTail = X.days.filter((d) => d.n > 47);
    rec.check(L(`the silent tail (Days 48–60) reads "no log"`),
      silentTail.every((d) => listed.find((x) => x.n === d.n)?.text.endsWith('· no log')),
      silentTail.filter((d) => !listed.find((x) => x.n === d.n)?.text.endsWith('· no log')).map((d) => d.n).join(','));
    const fakeGreen = listed.filter((r) => r.green && !X.days[r.n - 1].green).map((r) => r.n);
    const lostGreen = X.days.filter((d) => d.green && !listed.find((r) => r.n === d.n)?.green).map((d) => d.n);
    rec.check(L('green dots only on logged, under-cap days — silence never green'),
      listed.length > 0 && fakeGreen.length === 0 && lostGreen.length === 0,
      `${fakeGreen.length ? `green but shouldn't be: ${fakeGreen.slice(0, 6).join(',')}` : ''}${lostGreen.length ? ` missing green: ${lostGreen.slice(0, 6).join(',')}` : ''}`);

    // Open a few days and read their wall-clock times.
    shared.times[C.id] = {};
    for (const n of SAMPLE_DAYS) {
      const btn = dayBtns.filter({ hasText: new RegExp(`^\\s*Day ${n}\\b`) }).first();
      if (!(await visible(btn, 1500))) {
        rec.check(L(`Day ${n} opens`), false, 'no row');
        continue;
      }
      await btn.click();
      await page.waitForTimeout(400);
      const body = await btn.locator('xpath=..').innerText().catch(() => '');
      const times = body.match(/\b\d{1,2}:\d{2} [AP]M\b/g) ?? [];
      shared.times[C.id][n] = times;
      const exp = X.days[n - 1].times;
      rec.check(L(`Day ${n}: ${exp.length} entries at the times logged in New York`),
        times.join(',') === exp.join(','), `got [${times.slice(0, 4).join(', ')}${times.length > 4 ? '…' : ''}] want [${exp.slice(0, 4).join(', ')}${exp.length > 4 ? '…' : ''}]`);
      if (n === SAMPLE_DAYS[SAMPLE_DAYS.length - 1]) {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await rec.snap(page, `${C.id}-viewer-history-day${n}`);
      }
    }
    await noLive('Stats, History open');

    /* plan */
    rec.check(L('Plan tab opens'), await goTab('plan'));
    await rec.snap(page, `${C.id}-viewer-plan`, { fullPage: true });
    await noLive('Plan');
    const cards = await page.locator('main .card').evaluateAll((els) => els.map((el) => ({
      text: el.innerText.replace(/\s+/g, ' ').trim(),
      green: [el, ...el.querySelectorAll('*')].some((x) => {
        const s = getComputedStyle(x);
        return [s.color, s.backgroundColor, s.borderTopColor].some((c) => /^rgba?\(52, 211, 153/.test(c));
      }),
    })));
    const stageCards = cards.filter((c) => /^([a-z ]+ · )?days? \d+/i.test(c.text));
    rec.check(L(`Plan lists ${X.stages.length} stages`), stageCards.length === X.stages.length, `${stageCards.length} stage cards`);
    const badStages = [];
    X.stages.forEach((s, i) => {
      const t = stageCards[i]?.text ?? '';
      const range = s.days[0] === s.days[1] ? `day ${s.days[0]}\\b` : `days ${s.days[0]}\\s*[–-]\\s*${s.days[1]}\\b`;
      const count = `${s.logged} of ${s.of} days? logged`;
      if (!new RegExp(`^(past|ended) · ${range}[^]*\\b${count}\\b`, 'i').test(t)) badStages.push(`#${i + 1} want "${s.logged} of ${s.of}" got "${t.slice(0, 70)}"`);
    });
    rec.check(L('every stage reads past/ended with "N of M days logged"'), stageCards.length > 0 && badStages.length === 0, badStages.slice(0, 2).join('; '));
    const nowStage = stageCards.filter((c) => /^now\b/i.test(c.text));
    rec.check(L('no stage claims to be "now"'), nowStage.length === 0, nowStage.map((c) => c.text.slice(0, 40)).join('; '));
    const doneOrGreen = stageCards.filter((c) => c.green || /\bdone\b/i.test(c.text));
    rec.check(L('no stage is green or "done"'), stageCards.length > 0 && doneOrGreen.length === 0, doneOrGreen.map((c) => c.text.slice(0, 40)).join('; '));

    /* settings, opened in the viewer */
    const gear = page.getByRole('button', { name: /^settings$/i });
    if (await visible(gear, 2000)) await gear.first().click();
    const sheet = page.locator('[role="dialog"]').filter({ hasText: /settings/i }).first();
    const sheetUp = await visible(sheet, 3000);
    rec.check(L('Settings opens in the viewer'), sheetUp);
    if (sheetUp) {
      await page.waitForTimeout(350);
      await rec.snap(page, `${C.id}-viewer-settings`);
      const st = await sheet.innerText();
      rec.check(L('Settings: no "Simulate import"'), !/simulate import/i.test(st), clip(st.match(/.*simulate.*/i)?.[0]));
      rec.check(L('Settings: no "This is your first attempt"'), !/this is your first attempt/i.test(st), clip(st.match(/.*first attempt.*/i)?.[0]));
      const key = sheet.getByLabel(/api key/i);
      const keyN = await key.count();
      const keyOff = keyN > 0 && (await key.first().isDisabled());
      rec.check(L('Settings: the API key field is disabled'), keyOff, keyOff ? '' : keyN ? 'field is editable' : 'no key field found');
      const inputs = await sheet.locator('input').evaluateAll((els) => els.map((e) => ({ id: e.id || e.type, disabled: e.disabled })));
      const open = inputs.filter((i) => !i.disabled).map((i) => i.id);
      rec.check(L('Settings: every edit field disabled'), inputs.length > 0 && open.length === 0, open.length ? `editable: ${open.join(', ')}` : `${inputs.length} inputs`);
      const attempts = sheet.getByText(/^attempts$/i).first();
      if (await visible(attempts, 1000)) {
        await attempts.scrollIntoViewIfNeeded().catch(() => {});
        await rec.snap(page, `${C.id}-viewer-settings-attempts`);
      }
      const done = sheet.getByRole('button', { name: /^done$/i });
      if (await visible(done, 1000)) await done.first().click();
      else await page.keyboard.press('Escape');
      rec.check(L('Settings closes'), await sheet.waitFor({ state: 'hidden', timeout: 3000 }).then(() => true, () => false));
    }
  }

  /* exit */
  if (await visible(exitBtn, 2000)) await exitBtn.first().click();
  const back = await visible(startBtn, 4000);
  await page.waitForTimeout(250);
  await rec.snap(page, `${C.id}-front-door-after-exit`);
  rec.check(L('Exit returns to the Front door'), back && !/viewing attempt/i.test(await e2e.bodyText(page)));
  const rawAfter = await readRaw(page);
  rec.check(L('viewing wrote nothing to v2'), rawAfter === rawBefore,
    rawAfter === rawBefore ? '' : `${parse(rawAfter)?.attempts?.[0]?.events?.length} events, awards ${JSON.stringify(parse(rawAfter)?.attempts?.[0]?.celebratedAwards)}`);

  /* reload */
  if (C.full) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const doorAgain = await visible(startBtn, 8000);
    await page.waitForTimeout(250);
    await rec.snap(page, `${C.id}-after-reload`);
    const t = await e2e.bodyText(page);
    rec.check(L('reload: still the Front door — viewing mode not persisted'), doorAgain && !/viewing attempt/i.test(t), clip(t));
    const after = parse(await readRaw(page));
    // A re-seed would have deleted v2 before boot, and the migration would have
    // rebuilt attempt 1 with a new archivedAt (the clock has moved on since).
    rec.check(L('reload: same single attempt — seed did not re-run, nothing duplicated'),
      after?.attempts?.length === 1 && after.attempts[0].archivedAt === a1?.archivedAt
        && after.attempts[0].events.length === v2Events.length && after.activeAttemptId === null,
      after ? `${after.attempts?.length} attempts, archivedAt ${after.attempts?.[0]?.archivedAt} (was ${a1?.archivedAt})` : 'pouch-down-v2 gone');
    const rows2 = await page.getByRole('button', { name: /^attempt \d+/i }).count();
    rec.check(L('reload: Front door still lists one past attempt'), rows2 === 1, `${rows2} rows`);
  }

  await e2e.v1Unchanged(page, seeded, rec, C.id);
  if (!args.keep) await ctx.close();
  return errors;
}

/* ------------------------------------------------------------------ main */

e2e.run(async () => {
  const rec = e2e.createRecorder(args.out);

  if (args.dry) {
    const S = summary();
    const X = expectFrom(seedV1String());
    console.log(`\nfixture: pouch-down-v1 = seedV1String() ${JSON.stringify(S)}, ${X.events.length} events; pouch-down-v2 absent`);
    console.log(`context C adds one unreadable entry mid-history: ${JSON.stringify(BROKEN)}`);
    console.log(`expected: ${X.loggedDays} logged days · best streak ${X.best} · pouches not used ${X.avoided} · kept $${X.kept.toFixed(2)}`);
    console.log(`stages: ${X.stages.map((s) => `${s.days[0]}–${s.days[1]} ${s.logged}/${s.of}`).join(' · ')}`);
    console.log(`history: ${X.days.map((d) => (d.logged ? d.pouches : '·')).join(' ')}`);
    for (const n of SAMPLE_DAYS) console.log(`  Day ${n} (${X.days[n - 1].date}): ${X.days[n - 1].times.join(', ')}`);
    for (const C of CONTEXTS) {
      console.log(`\n${C.id} · ${C.title} — port ${args.port}`);
      STEPS(C).forEach((s, k) => console.log(`  ${String(k + 1).padStart(2)}. ${s}`));
    }
    console.log('\nthen: History times in A and B must match row for row');
    fixtureChecks(rec);
    return e2e.finish(rec);
  }

  fixtureChecks(rec);
  const dist = args.dist ?? (await e2e.buildApp(`${args.out}/build`));
  const { base } = await e2e.startPreview({ dist, port: args.port });
  const browser = await chromium.launch();
  const shared = { times: {} };
  const errors = [];
  for (const C of CONTEXTS) {
    // A stalled control is the APP failing this context, not the walk
    // crashing: record it and move on to the next context.
    errors.push(await walkContext(browser, base, C, rec, shared).catch((e) => {
      rec.check(`${C.id} walk did not stall`, false, String(e?.message ?? e).split('\n')[0]);
      return [];
    }));
  }

  rec.section('A vs B — the same history, read in two zones');
  const A = shared.times.A ?? {};
  const B = shared.times.B ?? {};
  for (const n of SAMPLE_DAYS) {
    const a = A[n] ?? [];
    const b = B[n] ?? [];
    rec.check(`Day ${n}: Chicago and New York show the same wall-clock times`, a.length > 0 && a.join(',') === b.join(','),
      `A [${a.slice(0, 3).join(', ')}…] B [${b.slice(0, 3).join(', ')}…]`);
  }

  if (!args.keep) await browser.close();
  return e2e.finish(rec, errors);
});
