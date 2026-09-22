// Shared plumbing for the end-to-end walks. Each walk (walk-*.mjs) is one
// story told against the real built app in headless Chromium on a 390px
// "phone"; this file is everything that ISN'T the story — building, serving,
// the phone, seeding storage, pinning the clock, recording checks, and the exit
// code. It exists so five walks can run side by side without five slightly
// different copies of the same plumbing drifting apart.
//
// The contract, as a walk uses it:
//
//   import { chromium } from 'playwright-core';
//   import * as e2e from './lib.mjs';
//
//   const args = e2e.parseArgs({ name: 'walk-foo', port: 4339 });
//   e2e.run(async () => {
//     const dist = args.dist ?? await e2e.buildApp(`${args.out}/build`);
//     const { base } = await e2e.startPreview({ dist, port: args.port });
//     const browser = await chromium.launch();
//     const ctx = await e2e.phoneContext(browser, { now: '2026-09-21T20:00:00-05:00' });
//     await e2e.seedStorage(ctx, { 'pouch-down-v1': seedV1String(), 'pouch-down-v2': null });
//     const page = await ctx.newPage();
//     const errors = e2e.watchErrors(page);
//     const rec = e2e.createRecorder(args.out);
//     await page.goto(`${base}?static`);
//     rec.check('Front door renders', /start a new attempt/i.test(await e2e.bodyText(page)));
//     await e2e.v1Unchanged(page, seeded, rec);
//     await e2e.finish(rec, errors);   // prints RESULT, exits 0 / 1
//   });
//
// Two gotchas this file exists to get right:
//
// 1. PRIVATE BUILD DIR. `npm run build` writes the repo's shared `dist/`. Two
//    walks building at once would overwrite each other's bundle mid-run, and a
//    walk could end up testing a build it didn't make. `buildApp` always builds
//    into a directory the caller names (never `dist/`), and `--dist DIR` lets a
//    runner build once and hand the same bundle to every walk.
//
// 2. SEED EXACTLY ONCE. An init script runs on EVERY navigation — reloads
//    included — so an ungated "set localStorage" quietly puts the fixture back
//    each time. Session B2 found this made reload assertions lie: the app looked
//    like it forgot what it had saved, when really the harness was handing it a
//    fresh copy. `seedStorage` gates on a sentinel COOKIE (not a localStorage
//    key, so the app's storage holds only the app's keys and a walk can count
//    them honestly). The cookie lives as long as the context, so a reload, a
//    navigation, or a second page in the same context never re-seeds.
//
// And one rule the whole harness serves: `pouch-down-v1` is the rollback. The
// harness may seed it into a fresh browser; the app may never write or delete
// it. `v1Unchanged` is the check every walk should end on.
//
// Exit codes: 0 = every check passed and no console errors; 1 = something
// failed; 2 = the walk itself crashed. The last line a walk prints is always
// `RESULT <name>: …`, which run-all.mjs reads.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Run Vite's own entry point with this Node, rather than via npx. That way the
// PID we hold IS the server — killing npx can leave its vite child running.
const VITE = join(REPO, 'node_modules/vite/bin/vite.js');
const BASE_PATH = '/pouch-down/'; // `base` in vite.config.js

const log = (...a) => console.log(...a);

// What the rest of the file needs to know about this run.
const state = { name: 'e2e', keep: false, finished: false, code: 1, bases: [] };

/* ---------------------------------------------------------------- args */

export function parseArgs({ name, port } = {}) {
  const argv = process.argv.slice(2);
  const val = (flag) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  state.name = name ?? 'e2e';
  state.keep = argv.includes('--keep');
  const dist = val('--dist');
  return {
    name: state.name,
    out: resolve(val('--out') ?? join(tmpdir(), 'pouch-e2e', state.name)),
    port: Number(val('--port') ?? port),
    keep: state.keep,
    dry: argv.includes('--dry'),
    dist: dist ? resolve(dist) : null,
  };
}

/* ----------------------------------------------------------- processes */

// Keeps the last lines of a child's output so a failure can say WHY.
function tail(child, lines = 20) {
  const buf = [];
  const take = (chunk) => {
    buf.push(...String(chunk).split('\n').filter((l) => l.trim()));
    if (buf.length > lines) buf.splice(0, buf.length - lines);
  };
  child.stdout?.on('data', take);
  child.stderr?.on('data', take);
  return () => buf.join('\n');
}

// One cleanup list for the whole process, and one set of signal handlers, so a
// walk that starts two servers doesn't get two handlers racing to exit.
const cleanups = new Set();
let handlersInstalled = false;
function onCleanup(fn) {
  cleanups.add(fn);
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', () => { for (const f of cleanups) { try { f(); } catch { /* best effort */ } } });
  // A signal handler replaces Node's default "die", so it must exit itself.
  // After a --keep run, Ctrl-C still exits with the walk's real result.
  for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.on(sig, () => process.exit(state.finished ? state.code : code));
  }
}

// Emptying a directory is destructive, so only ever empty one that is new,
// empty, or already looks like a build of this app — never the repo's dist/,
// the repo itself, or anything above it.
function assertSafeOutDir(dir) {
  const within = (a, b) => a === b || a.startsWith(b + sep);
  if (within(dir, join(REPO, 'dist'))) throw new Error(`buildApp: refusing to build into the shared dist/ (${dir})`);
  if (within(REPO, dir) || dir === homedir()) throw new Error(`buildApp: refusing to empty ${dir}`);
  if (existsSync(dir) && readdirSync(dir).length && !existsSync(join(dir, 'index.html'))) {
    throw new Error(`buildApp: ${dir} is not empty and is not a previous build — refusing to empty it`);
  }
}

export function buildApp(outDir) {
  const dir = resolve(outDir);
  assertSafeOutDir(dir);
  mkdirSync(dir, { recursive: true });
  log(`building → ${dir}`);
  return new Promise((res, rej) => {
    const b = spawn(process.execPath, [VITE, 'build', '--outDir', dir, '--emptyOutDir'], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const why = tail(b);
    b.on('error', rej);
    b.on('exit', (c) => (c === 0 ? res(dir) : rej(new Error(`vite build exited ${c}:\n${why()}`))));
  });
}

const answers = async (url) => {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
};

export async function startPreview({ dist, port }) {
  if (!dist || !existsSync(join(dist, 'index.html'))) throw new Error(`startPreview: no build at ${dist}`);
  const base = `http://localhost:${port}${BASE_PATH}`;
  // If something already answers here, "the server is up" would be a lie: the
  // walk would test whatever that is (a stale preview, another walk's build).
  if (await answers(base)) throw new Error(`startPreview: port ${port} is already serving — another walk, or a stale preview?`);

  // Fixed port + --strictPort: if the port is taken we fail loudly rather than
  // quietly serving somewhere a runner isn't looking.
  const server = spawn(
    process.execPath,
    [VITE, 'preview', '--outDir', resolve(dist), '--port', String(port), '--strictPort'],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const why = tail(server);
  let exited = null;
  const gone = new Promise((r) => server.on('exit', (c) => { exited = c ?? 'signal'; r(); }));
  // Vite prints its "Local:" URL only once it is listening — proof that the
  // answer below came from OUR server and not a racer on the same port.
  let listening = false;
  server.stdout.on('data', (c) => { if (/Local/.test(String(c))) listening = true; });

  // Kill by PID only. Never `pkill -f vite` — that would take down any
  // unrelated dev server on this Mac too.
  const kill = () => { if (exited === null) { try { process.kill(server.pid); } catch { /* already gone */ } } };
  onCleanup(kill);
  const stop = async () => {
    kill();
    await Promise.race([gone, new Promise((r) => setTimeout(r, 3000))]);
    cleanups.delete(kill);
  };

  // Resolve only once the server actually answers HTTP. If Vite ever stops
  // printing "Local:", a child that has stayed alive 1.5s after the first
  // answer is proof enough (a loser of a port race exits well before that).
  const deadline = Date.now() + 20000;
  let firstAnswer = null;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`vite preview exited (${exited}) before serving:\n${why()}`);
    if (await answers(base)) {
      firstAnswer ??= Date.now();
      if (exited === null && (listening || Date.now() - firstAnswer > 1500)) {
        state.bases.push(base);
        return { base, stop };
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  kill();
  throw new Error(`vite preview never answered on ${base}:\n${why()}`);
}

/* ------------------------------------------------------------ the phone */

// The native share sheet and clipboard can't be driven headless, so they are
// stubbed: share resolves, canShare says no (so the app takes its clipboard
// route), and writeText resolves and keeps the text where a walk can read it —
// `window.__clipboard` is the LAST text copied (null until something is), and
// `window.__clipboardLog` is every copy since this page loaded.
const PHONE_STUBS = `
(() => {
  try {
    window.__clipboard = null;
    window.__clipboardLog = [];
    window.__shares = [];
    const def = (obj, key, value) =>
      Object.defineProperty(obj, key, { value, configurable: true, writable: true });
    def(navigator, 'share', (data) => { window.__shares.push(data); return Promise.resolve(); });
    def(navigator, 'canShare', () => false);
    def(navigator, 'clipboard', {
      writeText: (text) => {
        window.__clipboard = String(text);
        window.__clipboardLog.push(String(text));
        return Promise.resolve();
      },
      readText: () => Promise.resolve(window.__clipboard ?? ''),
      write: () => Promise.resolve(),
      read: () => Promise.resolve([]),
    });
  } catch (e) {}
})();
`;

const toEpochMs = (now) => {
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(ms)) throw new Error(`phoneContext: can't read "${now}" as a time`);
  return ms;
};

// An iPhone-sized context. Pass `now` and the page's clock starts THERE and
// keeps ticking in real time: Date.now(), timers, animation frames and
// performance.now() all run normally, just from the pinned moment — so a walk
// written for "Day 1 is 2026-09-21" still works next month. Leave `now` out
// and the page gets the real clock. Any other option (reducedMotion, locale…)
// passes straight through to browser.newContext.
export async function phoneContext(browser, { tz = 'America/Chicago', now, ...options } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US', // text assertions read dates like "Dec 19"
    timezoneId: tz,
    ...options,
  });
  ctx.setDefaultTimeout(12000); // a stalled click reports in 12s, not 30
  // install() before any page exists: every page then boots on the fake clock,
  // and Playwright carries the elapsed time across reloads rather than resetting.
  if (now !== undefined) await ctx.clock.install({ time: toEpochMs(now) });
  await ctx.addInitScript(PHONE_STUBS);
  return ctx;
}

let seedN = 0;

// Call before the context's first page navigates to the app. Each call seeds
// once per origin; a string value sets that key, null makes sure it is absent.
export async function seedStorage(ctx, entries) {
  const cookie = `__pouch_e2e_seed_${++seedN}_${Math.random().toString(36).slice(2, 8)}`;
  await ctx.addInitScript(`
(() => {
  try {
    // Port in the name: cookies ignore ports, localStorage doesn't.
    const flag = ${JSON.stringify(cookie)} + '_' + location.port + '=1';
    if (document.cookie.split('; ').includes(flag)) return;
    const entries = ${JSON.stringify(entries)};
    for (const [key, value] of Object.entries(entries)) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
    // Only mark seeded once the writes landed — about:blank can't hold
    // storage, so it must not use up the one seed.
    document.cookie = flag + '; path=/; SameSite=Lax';
  } catch (e) {}
})();
`);
}

export const readStorage = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);

/* ------------------------------------------------------------ recording */

export function createRecorder(out) {
  mkdirSync(out, { recursive: true });
  let shot = 0;
  const rec = {
    out,
    fails: [],
    passed: 0,
    check(label, ok, detail = '') {
      log(`${ok ? '  ok ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
      if (ok) rec.passed++;
      else rec.fails.push(`${label}${detail ? `: ${detail}` : ''}`);
      return !!ok;
    },
    section(title) {
      log(`\n── ${title} ──`);
    },
    // Numbered so the folder reads in the order the walk happened. A failed
    // screenshot is logged, not thrown — it shouldn't cost the rest of the walk.
    async snap(page, name) {
      const file = join(out, `${String(++shot).padStart(2, '0')}-${name}.png`);
      try {
        await page.screenshot({ path: file });
        return file;
      } catch (e) {
        log(`  (screenshot ${name} failed: ${String(e.message ?? e).split('\n')[0]})`);
        return null;
      }
    },
  };
  return rec;
}

export function watchErrors(page, label = '') {
  const errors = [];
  const tag = label ? `[${label}] ` : '';
  page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${tag}${String(e)}`));
  return errors;
}

// Clicks the first visible element whose text matches. Returns false rather
// than throwing so the walk can report where it stalled instead of dying.
export async function clickText(page, rx, { timeout = 4000 } = {}) {
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

export const bodyText = (page) => page.evaluate(() => document.body.innerText);

// The rollback key must come out exactly as it went in. Pass `expected: null`
// when the walk started without v1 — then it must still be absent.
export async function v1Unchanged(page, expected, rec) {
  const after = await readStorage(page, 'pouch-down-v1');
  if (expected === null) {
    return rec.check('pouch-down-v1 still absent', after === null, after === null ? '' : 'KEY WAS WRITTEN');
  }
  return rec.check('pouch-down-v1 byte-identical', after === expected,
    after === null ? 'KEY WAS DELETED' : after === expected ? '' : 'KEY WAS REWRITTEN');
}

/* ----------------------------------------------------------------- exit */

// `errors` is one watchErrors() array, or an array of them.
export async function finish(rec, errors = []) {
  const errs = errors.flat();
  const total = rec.passed + rec.fails.length;
  // A walk that asserted nothing proved nothing — that's a failure, not a pass.
  if (total === 0) rec.fails.push('no checks were recorded');
  for (const e of errs.slice(0, 5)) log(`  console error: ${e.split('\n')[0].slice(0, 200)}`);
  if (errs.length > 5) log(`  … and ${errs.length - 5} more console errors`);
  if (rec.fails.length) log(`\n${rec.fails.length} FAILURE(S):\n - ${rec.fails.join('\n - ')}`);
  try {
    writeFileSync(join(rec.out, 'report.json'), JSON.stringify({ name: state.name, passed: rec.passed, failures: rec.fails, errors: errs }, null, 2));
  } catch { /* the report is a courtesy; the exit code is the truth */ }
  log(`\nscreenshots → ${rec.out}`);
  log(`RESULT ${state.name}: ${rec.passed} passed, ${rec.fails.length} failed, ${errs.length} console errors`);

  state.finished = true;
  state.code = rec.fails.length || errs.length ? 1 : 0;
  if (state.keep) {
    // Leave the browser and server up for a human to poke at. Ctrl-C exits
    // with the code above.
    log(`--keep: still serving ${state.bases.join(', ') || '(no server)'} — Ctrl-C to stop`);
    return new Promise(() => {});
  }
  process.exit(state.code);
}

// Runs a walk's main(). Anything thrown means the WALK broke, not the app:
// exit 2, with a RESULT line so the runner can still say which walk it was.
export function run(main) {
  const crash = (e) => {
    console.error(e);
    log(`RESULT ${state.name}: CRASHED — ${String(e?.message ?? e).split('\n')[0]}`);
    process.exit(2);
  };
  process.on('unhandledRejection', crash);
  process.on('uncaughtException', crash);
  Promise.resolve()
    .then(main)
    .then(() => { if (!state.finished) crash(new Error('walk returned without calling finish()')); }, crash);
}
