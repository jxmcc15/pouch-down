// Drives the real app in headless Chromium the way James will on his phone:
// Front door → view Attempt 1 → Exit → Start new → the 8 setup screens → Begin
// → Today. Screenshots every step so a human can actually LOOK at the result.
//
// Synthetic data only (scripts/e2e/seed-v1.mjs). The one hard assertion that
// matters beyond "it rendered": `pouch-down-v1` must be byte-identical at the
// end — it is the rollback, and nothing in the app may ever write it.
//
// Usage: node scripts/e2e/walk-setup.mjs [--out DIR] [--port N] [--keep]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { seedV1String } from './seed-v1.mjs';

const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? dflt : process.argv[i + 1];
};
const OUT = arg('--out', '/tmp/pouch-walk');
const PORT = Number(arg('--port', 4317));
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

// Clicks the first visible element whose text matches. Returns false rather
// than throwing so the walk can report where it stalled instead of dying.
async function clickText(page, rx, { timeout = 4000 } = {}) {
  const loc = page.locator('button, [role="button"], a').filter({ hasText: rx });
  try {
    await loc.first().waitFor({ state: 'visible', timeout });
    await loc.first().click();
    await page.waitForTimeout(220);
    return true;
  } catch {
    return false;
  }
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);

async function main() {
  mkdirSync(OUT, { recursive: true });
  const seeded = seedV1String();

  log(`\nbuilding…`);
  await new Promise((res, rej) => {
    const b = spawn('npm', ['run', 'build'], { stdio: 'ignore' });
    b.on('exit', (c) => (c === 0 ? res() : rej(new Error(`build exited ${c}`))));
  });

  // Fixed port + kill by PID. (A previous session used `pkill -f vite`, which
  // would also kill any unrelated dev server running on this Mac.)
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  const stop = () => { try { process.kill(server.pid); } catch { /* already gone */ } };
  process.on('exit', stop);

  const base = `http://localhost:${PORT}/pouch-down/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },      // iPhone
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'America/New_York',
  });

  // Seed BEFORE any app code runs, and stub the share sheet so a tap on
  // "Download what's stored" can't hang the run on a native dialog.
  await ctx.addInitScript(`
    try {
      localStorage.setItem('pouch-down-v1', ${JSON.stringify(seeded)});
      localStorage.removeItem('pouch-down-v2');
    } catch (e) {}
    navigator.share = () => Promise.resolve();
    navigator.canShare = () => false;
  `);

  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // Wait for the preview server to answer.
  for (let i = 0; i < 40; i++) {
    try { await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' }); break; }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  await page.waitForTimeout(700);

  log(`\n── front door ──`);
  await snap(page, 'front-door');
  let text = await bodyText(page);
  check('Front door renders', /start a new attempt/i.test(text), text.slice(0, 90).replace(/\n/g, ' | '));
  check('Past attempt listed', /attempt 1/i.test(text));
  check('No fake streak on front door', !/60 day streak|60-day streak/i.test(text));

  log(`\n── read-only viewer ──`);
  if (await clickText(page, /attempt 1/i)) {
    await page.waitForTimeout(400);
    await snap(page, 'read-only');
    text = await bodyText(page);
    check('Read-only banner shown', /read-only/i.test(text));
    check('Exit offered', /exit/i.test(text));
    if (!(await clickText(page, /^exit$/i))) check('Exit works', false, 'could not click Exit');
    await page.waitForTimeout(400);
    text = await bodyText(page);
    check('Exit returns to front door', /start a new attempt/i.test(text));
  } else {
    check('Open Attempt 1', false, 'no clickable past-attempt row');
  }

  log(`\n── setup walkthrough ──`);
  await snap(page, 'before-setup');

  // The acceptance inputs from the spec: 9/day · 9 mg · [6,3] · 90 days ·
  // 2026-09-21 must produce 8 stages, first cut Oct 6, quit day Dec 19.
  const chip = async (rx) => {
    const loc = page.locator('button').filter({ hasText: rx });
    const nth = await loc.count();
    for (let i = 0; i < nth; i++) {
      const txt = (await loc.nth(i).innerText()).trim();
      if (rx.test(txt) && txt.length <= 8) { await loc.nth(i).click(); return true; }
    }
    return false;
  };

  // Answers the screen in front of us, keyed on its heading.
  async function answer(t) {
    if (/how many pouches/i.test(t)) {
      const num = page.locator('input[type="number"], input[inputmode="numeric"]').first();
      if (await num.count()) { await num.fill('9'); await num.blur().catch(() => {}); return '9/day'; }
      for (let i = 0; i < 9; i++) await clickText(page, /^\+$/, { timeout: 800 });
      return '9/day (stepper)';
    }
    if (/what strength/i.test(t)) return (await chip(/^9\s*mg$|^9$/)) ? '9 mg' : 'strength FAILED';
    if (/lower strength|can you buy/i.test(t)) {
      // Screen 3 defaults to EVERY chip below the current strength (spec §5),
      // so the acceptance case [6, 3] means toggling 8, 4 and 2 back off.
      const off = [];
      for (const mg of [8, 4, 2]) {
        if (await chip(new RegExp(`^${mg}\\s*mg$|^${mg}$`))) off.push(mg);
      }
      return `deselected ${off.join(',')} → [6,3]`;
    }
    if (/how long/i.test(t)) return (await chip(/^90$|^90\s*days$/)) ? '90 days' : '90 FAILED';
    if (/day 1/i.test(t)) {
      const d = page.locator('input[type="date"]').first();
      if (await d.count()) { await d.fill('2026-09-21'); return '2026-09-21'; }
      return 'date input not found';
    }
    if (/rhythm/i.test(t)) return 'meal defaults';
    if (/pay/i.test(t)) return 'price defaults';
    return 'no input needed';
  }

  if (!(await clickText(page, /start a new attempt/i))) {
    check('Enter setup', false, 'Start a new attempt not clickable');
  } else {
    await page.waitForTimeout(400);
    for (let screen = 1; screen <= 10; screen++) {
      let t = await bodyText(page);
      const heading = t.split('\n').find((l) => l.trim() && !/^step|^set up/i.test(l)) ?? '(blank)';
      if (/^\s*$/.test(t)) { check(`Setup screen ${screen} not blank`, false); break; }

      // Detect the preview by a real Begin BUTTON — screen 4's helper copy
      // ("the quit date is fixed once you begin") matches a body-text test.
      const beginBtn = page.locator('button').filter({ hasText: /^begin$/i });
      if (await beginBtn.count()) {
        await snap(page, `setup-${String(screen).padStart(2, '0')}-preview`);
        check('Reached plan preview', true);
        check('Quit date shown (Dec 19)', /dec\w*\s*19/i.test(t), t.match(/.{0,30}dec.{0,25}/i)?.[0]?.replace(/\n/g, ' ') ?? 'not found');
        check('First cut shown (Oct 6)', /oct\w*\s*6\b/i.test(t));
        check('Eight stages listed', (t.match(/\d+\s*\/day/gi) ?? []).length >= 7,
          `${(t.match(/\d+\s*\/day/gi) ?? []).length} "/day" lines`);
        break;
      }

      const did = await answer(t);
      await page.waitForTimeout(200);
      await snap(page, `setup-${String(screen).padStart(2, '0')}`);
      log(`  screen ${screen}: ${heading.slice(0, 52)} → ${did}`);

      if (!(await clickText(page, /^(next|continue)$/i))) {
        check(`Advance past screen ${screen}`, false, `"${heading.slice(0, 40)}" — Next still disabled`);
        break;
      }
    }
  }

  log(`\n── begin ──`);
  if (await clickText(page, /^begin$/i)) {
    await page.waitForTimeout(600);
    await snap(page, 'today');
    text = await bodyText(page);
    check('Landed on the app after Begin', !/start a new attempt/i.test(text));
  } else {
    check('Begin', false, 'Begin not reachable');
  }

  log(`\n── data safety ──`);
  const after = await page.evaluate(() => localStorage.getItem('pouch-down-v1'));
  check('pouch-down-v1 byte-identical', after === seeded,
    after === null ? 'KEY WAS DELETED' : after === seeded ? '' : 'KEY WAS REWRITTEN');
  const v2 = await page.evaluate(() => localStorage.getItem('pouch-down-v2'));
  check('v2 written', !!v2);

  check('No console errors', errors.length === 0, errors.slice(0, 3).join(' / '));

  writeFileSync(`${OUT}/report.json`, JSON.stringify({ failures: fail, errors }, null, 2));
  log(`\nscreenshots → ${OUT}`);
  log(fail.length ? `\n${fail.length} FAILURE(S):\n - ${fail.join('\n - ')}\n` : `\nALL CHECKS PASSED\n`);

  if (!KEEP) { await browser.close(); stop(); }
  process.exit(fail.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
