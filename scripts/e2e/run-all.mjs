// Runs every end-to-end walk against ONE build. Building once and handing the
// same bundle to each walk (`--dist`) means every walk tests the same app, and
// no walk touches the repo's shared dist/.
//
// Walks run one after another, each on its own port, each writing its full
// output to <out>/<walk>.log and its screenshots to <out>/<walk>/. The console
// gets one line per walk plus a summary. A walk whose file doesn't exist yet
// counts as FAILED (MISSING) — a suite that silently skips a walk isn't green.
//
// Usage: node scripts/e2e/run-all.mjs [--only walk-setup] [--out DIR] [--timeout SECONDS]
//   (or: npm run e2e -- --only setup)
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

// Order matters only for reading the report: migration first, because every
// later walk assumes an app that boots.
const WALKS = [
  { name: 'walk-migration', port: 4331 },
  { name: 'walk-setup', port: 4317 },
  { name: 'walk-backfill', port: 4333 },
  { name: 'walk-awards', port: 4335 },
  { name: 'walk-recovery', port: 4337 },
];

const argv = process.argv.slice(2);
const arg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i === -1 ? dflt : argv[i + 1];
};
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const OUT = resolve(arg('--out', join(tmpdir(), 'pouch-e2e', `run-${stamp}`)));
// A hung walk must not hang the suite. Generous: a walk is normally ~1 min.
const TIMEOUT_MS = Number(arg('--timeout', 300)) * 1000;

const only = arg('--only');
const norm = (s) => s.replace(/\.mjs$/, '').replace(/^walk-/, '');
const walks = only ? WALKS.filter((w) => norm(w.name) === norm(only)) : WALKS;
if (!walks.length) {
  console.error(`--only ${only}: no such walk. Known: ${WALKS.map((w) => w.name).join(', ')}`);
  process.exit(2);
}

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

// Runs one walk, teeing nothing to the console: the log file has it all.
function runWalk({ name, port }, dist) {
  const file = join(HERE, `${name}.mjs`);
  if (!existsSync(file)) return Promise.resolve({ status: 'MISSING', line: 'no such file', ms: 0 });

  const logPath = join(OUT, `${name}.log`);
  const logFile = createWriteStream(logPath);
  const started = Date.now();
  return new Promise((res) => {
    const child = spawn(
      process.execPath,
      [file, '--dist', dist, '--port', String(port), '--out', join(OUT, name)],
      { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // Keep the RESULT line as it streams past, so we don't reread the log.
    let result = null;
    let partial = '';
    child.stdout.on('data', (chunk) => {
      logFile.write(chunk);
      const lines = (partial + chunk).split('\n');
      partial = lines.pop();
      for (const l of lines) if (l.startsWith('RESULT ')) result = l;
    });
    child.stderr.on('data', (chunk) => logFile.write(chunk));

    // SIGTERM first so the walk's own handler stops its preview server;
    // SIGKILL if it won't go.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ }
      setTimeout(() => { try { process.kill(child.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000).unref();
    }, TIMEOUT_MS);
    const killOnExit = () => { try { process.kill(child.pid); } catch { /* gone */ } };
    process.on('exit', killOnExit);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      process.off('exit', killOnExit);
      if (partial.startsWith('RESULT ')) result = partial;
      logFile.end();
      const ms = Date.now() - started;
      const how = timedOut ? `timed out after ${secs(TIMEOUT_MS)}` : signal ? `killed by ${signal}` : `exit ${code}`;
      res({ status: code === 0 && !timedOut ? 'PASS' : 'FAIL', line: result ?? how, ms, logPath });
    });
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`e2e → ${OUT}`);
  const t0 = Date.now();
  const dist = await buildApp(join(OUT, 'build'));
  console.log(`built in ${secs(Date.now() - t0)}\n`);

  const results = [];
  for (const w of walks) {
    // A "running…" line that the result overwrites — terminals only; in a log
    // file a carriage return is just noise.
    if (process.stdout.isTTY) process.stdout.write(`  …     ${w.name.padEnd(15)} running\r`);
    const r = await runWalk(w, dist);
    results.push({ ...w, ...r });
    const tag = r.status === 'PASS' ? 'PASS' : 'FAIL';
    const extra = r.status === 'MISSING' ? '(MISSING)' : r.line;
    console.log(`  ${tag}  ${w.name.padEnd(15)} ${secs(r.ms).padStart(7)}  ${extra}`);
  }

  const failed = results.filter((r) => r.status !== 'PASS');
  console.log(`\n${results.length - failed.length}/${results.length} walks passed in ${secs(Date.now() - t0)}`);
  if (failed.length) {
    console.log(`failed: ${failed.map((r) => (r.status === 'MISSING' ? `${r.name} (missing)` : r.name)).join(', ')}`);
    console.log(`logs + screenshots: ${OUT}`);
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
