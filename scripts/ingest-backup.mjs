#!/usr/bin/env node
// pouch-ingest — files the phone's backup in the vault and re-renders the Live Log.
//
// The phone exports via Settings → Download full backup, then AirDrop (lands in
// ~/Downloads) or Save to Files → iCloud Drive → PouchDown. This picks up every
// `pouch-down-backup-*.json|.txt` there, copies each valid new one into
// $POUCH_BACKUP_DIR/Backups/, moves Downloads originals into Backups/_ingested/
// (iCloud copies stay put), and writes $POUCH_BACKUP_DIR/Live Log.md from the
// newest backup. It never deletes a file and never overwrites a different one.
//
// Usage: pouch-ingest [--dry-run] [--notify]
// Env:   POUCH_BACKUP_DIR   where backups + Live Log go (default: the vault's Pouch Down folder)
//        POUCH_SEARCH_DIRS  colon-separated folders to pick backups up from
//                           (default: ~/Downloads and iCloud Drive/PouchDown)
//
// `ingest()` returns a structured result so other modes can be built on it
// without re-reading the folders. --notify is the launchd watcher's mode
// (~/Library/LaunchAgents/com.jxm.pouch-ingest.plist): it messages James on
// Telegram about what happened or what needs him — see scripts/notify-telegram.mjs.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseBackup, renderLiveLog, liveAttempt, backupAgeDays, isStale } from '../src/ingest.js';
import { streaks } from '../src/store.js';
import { planMessages, nextState, isDue, errorText, statePath, loadState, saveState, notify } from './notify-telegram.mjs';

const BACKUP_NAME = /^pouch-down-backup-.*\.(json|txt)$/i;
const ICLOUD_PLACEHOLDER = /^\.(pouch-down-backup-.*\.(json|txt))\.icloud$/i; // not downloaded to this Mac yet
const BLOCKED_CODES = new Set(['EPERM', 'EACCES']);

export function config(env = process.env) {
  const home = os.homedir();
  return {
    backupDir: env.POUCH_BACKUP_DIR || '/Users/jxm/jxm-vault/Pouch Down',
    searchDirs: env.POUCH_SEARCH_DIRS
      ? env.POUCH_SEARCH_DIRS.split(':').filter(Boolean)
      : [path.join(home, 'Downloads'), path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs/PouchDown')],
  };
}

// iCloud Drive copies are left in place: moving one would pull it off the phone too.
const isICloud = (dir) => dir.includes('/Mobile Documents/');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Hashes of every .json/.txt anywhere under dir (dot-folders skipped), so a
// backup already archived anywhere in the folder is never stored twice.
function knownHashes(dir) {
  const hashes = new Set();
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.(json|txt)$/i.test(e.name)) hashes.add(sha256(fs.readFileSync(p)));
    }
  };
  walk(dir);
  return hashes;
}

// `name`, or `name (2)`, `name (3)`… — the first that doesn't exist yet.
function freePath(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; ; i++) {
    const p = path.join(dir, i === 1 ? name : `${stem} (${i})${ext}`);
    if (!fs.existsSync(p)) return p;
  }
}

const readBackup = (file) => {
  try {
    return { file, ...parseBackup(fs.readFileSync(file, 'utf8')) };
  } catch {
    return null; // not a backup
  }
};
const newer = (a, b) => (!b || (a && Date.parse(a.exportedAt) > Date.parse(b.exportedAt)) ? a : b);

// Newest valid backup already in the folder. Backups/ names sort by export time,
// so its first valid one is its newest. Backups filed by hand elsewhere in the
// folder count too: a phone copy identical to one of those is a duplicate, so
// it only goes to _ingested/ and never lands in Backups/.
function newestArchived(backupDir) {
  const archiveDir = path.join(backupDir, 'Backups');
  let names = [];
  try {
    names = fs.readdirSync(archiveDir).filter((n) => n.endsWith('.json')).sort().reverse();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let best = null;
  for (const name of names) if ((best = readBackup(path.join(archiveDir, name)))) break;
  const walk = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.name.startsWith('.') || p === archiveDir) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && /\.(json|txt)$/i.test(e.name)) best = newer(readBackup(p), best);
    }
  };
  walk(backupDir);
  return best;
}

// → { dryRun, ingested, duplicates, failed, blocked, waiting, readableDirs, newest, liveLog }
export function ingest(opts = {}) {
  const { backupDir, searchDirs, dryRun = false, now = new Date(), log = console.log } = { ...config(), ...opts };
  const archiveDir = path.join(backupDir, 'Backups');
  const movedDir = path.join(archiveDir, '_ingested');
  const say = (line) => log(dryRun ? `[dry run] ${line}` : line);
  const result = { dryRun, ingested: [], duplicates: [], failed: [], blocked: [], waiting: [], readableDirs: 0, newest: null, liveLog: null };

  // 1. Find candidates in every search dir. A folder macOS won't let us read is
  //    recorded and skipped — the others still get ingested.
  const candidates = [];
  for (const dir of searchDirs) {
    let names;
    try {
      names = fs.readdirSync(dir);
      result.readableDirs++;
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      if (BLOCKED_CODES.has(err.code)) {
        result.blocked.push({ path: dir, code: err.code });
        say(`blocked  ${dir}: macOS won't let ${process.execPath} read it (${err.code})`);
        continue;
      }
      throw err;
    }
    for (const name of names) {
      const placeholder = ICLOUD_PLACEHOLDER.exec(name);
      if (placeholder) {
        result.waiting.push({ file: path.join(dir, placeholder[1]) });
        say(`waiting  ${path.join(dir, placeholder[1])}: still in iCloud, not downloaded to this Mac yet`);
        continue;
      }
      if (!BACKUP_NAME.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (st.isFile()) candidates.push({ file, dir, mtimeMs: st.mtimeMs });
      } catch (err) {
        if (BLOCKED_CODES.has(err.code)) result.blocked.push({ path: file, code: err.code });
        else result.failed.push({ file, reason: `can't read it (${err.code ?? err.message})` });
        say(`skipped  ${file}: can't read it (${err.code ?? err.message})`);
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first

  // 2. File each one: parse, dedupe by content, copy into Backups/, move the
  //    Downloads original aside. Anything that fails stays exactly where it is.
  const hashes = candidates.length ? knownHashes(backupDir) : new Set();
  const parsed = [];
  for (const { file, dir } of candidates) {
    let buf, backup;
    try {
      buf = fs.readFileSync(file);
    } catch (err) {
      if (BLOCKED_CODES.has(err.code)) result.blocked.push({ path: file, code: err.code });
      else result.failed.push({ file, reason: `can't read it (${err.code ?? err.message})` });
      say(`skipped  ${file}: can't read it (${err.code ?? err.message})`);
      continue;
    }
    try {
      backup = parseBackup(buf.toString('utf8'));
    } catch (err) {
      result.failed.push({ file, reason: err.message });
      say(`skipped  ${file}: ${err.message} — left where it is`);
      continue;
    }
    const hash = sha256(buf);
    const duplicate = hashes.has(hash);
    hashes.add(hash);
    let archivedAs = null;
    if (!duplicate) {
      const name = `${new Date(backup.exportedAt).toISOString().replace(/:/g, '-')}.json`;
      archivedAs = freePath(archiveDir, name);
      if (!dryRun) {
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.writeFileSync(archivedAs, buf, { flag: 'wx' }); // exclusive: never overwrites
      }
    }

    let movedTo = null, moveError = null;
    if (!isICloud(dir)) {
      movedTo = freePath(movedDir, path.basename(file));
      if (!dryRun) {
        try {
          fs.mkdirSync(movedDir, { recursive: true });
          fs.renameSync(file, movedTo);
        } catch (err) {
          moveError = err.code ?? err.message; // e.g. EXDEV/EPERM: leave the original, never delete it
          movedTo = null;
        }
      }
    }

    parsed.push({ ...backup, file: archivedAs ?? movedTo ?? file });
    const entry = { file, exportedAt: backup.exportedAt, format: backup.format, archivedAs, movedTo, moveError };
    if (duplicate) result.duplicates.push(entry);
    else result.ingested.push(entry);
    const where = movedTo ? `, original moved to ${path.relative(backupDir, movedTo)}` : moveError ? `, original left in place (${moveError})` : ', original left in place';
    say(duplicate ? `already filed  ${file}${where}` : `filed  ${file} → ${path.relative(backupDir, archivedAs)}${where}`);
  }

  // 3. Render the newest backup we know of — new or already archived. Every run
  //    re-renders, so the staleness warning stays current.
  let newest = newestArchived(backupDir);
  for (const p of parsed) if (!newest || Date.parse(p.exportedAt) > Date.parse(newest.exportedAt)) newest = p;
  if (newest) {
    const attempt = liveAttempt(newest.root);
    result.newest = {
      file: newest.file,
      exportedAt: newest.exportedAt,
      format: newest.format,
      ageDays: backupAgeDays(newest.exportedAt, now),
      stale: isStale(newest.exportedAt, now),
      attemptId: attempt?.id ?? null,
      attemptStatus: attempt?.status ?? null,
      streak: attempt ? streaks(attempt) : null,
    };
    const md = renderLiveLog(newest.root, { exportedAt: newest.exportedAt, now });
    const target = path.join(backupDir, 'Live Log.md');
    let current = null;
    try { current = fs.readFileSync(target, 'utf8'); } catch { /* first run */ }
    const changed = current !== md;
    if (changed && !dryRun) {
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(target, md);
    }
    result.liveLog = { path: target, changed };
  }
  return result;
}

const fmtLocal = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// The 3-line summary: files ingested, data as of, current streak.
export function summaryLines(r) {
  const extra = [
    r.duplicates.length && `${r.duplicates.length} already filed`,
    r.failed.length && `${r.failed.length} failed`,
    r.blocked.length && `${r.blocked.length} blocked by macOS`,
    r.waiting.length && `${r.waiting.length} waiting on iCloud`,
  ].filter(Boolean);
  const n = r.ingested.length;
  const lines = [`Ingested: ${n ? `${n} new backup${n === 1 ? '' : 's'}` : 'nothing new'}${extra.length ? ` (${extra.join(', ')})` : ''}`];
  if (!r.newest) {
    lines.push('Data as of: no backup found yet', 'Streak: — (no Live Log written)');
    return lines;
  }
  const { newest, liveLog } = r;
  const age = newest.ageDays === 0 ? 'today' : `${newest.ageDays} day${newest.ageDays === 1 ? '' : 's'} old`;
  lines.push(`Data as of: ${fmtLocal(newest.exportedAt)} (${age}${newest.stale ? ' — stale, AirDrop a fresh one' : ''})`);
  const streak = newest.streak ? `${newest.streak.current} (best ${newest.streak.best}), attempt ${newest.attemptId}${newest.attemptStatus === 'archived' ? ' (archived)' : ''}` : '— (no attempt yet)';
  const logState = r.dryRun ? (liveLog.changed ? 'would update' : 'unchanged') : liveLog.changed ? 'updated' : 'unchanged';
  lines.push(`Streak: ${streak} · Live Log ${logState}: ${liveLog.path}`);
  return lines;
}

const USAGE = `Usage: pouch-ingest [--dry-run] [--notify]

Files Pouch Down backups (pouch-down-backup-*.json|.txt) from ~/Downloads and
iCloud Drive/PouchDown into the vault, then re-renders "Live Log.md".

  --dry-run   print what would happen; write, copy, move and send nothing
  --notify    watcher mode: message James on Telegram (macOS notification as
              fallback) when a backup is filed, a file fails, macOS blocks a
              folder, or the newest backup is stale; log only when something
              happened. With --dry-run, prints the messages instead.
  --help      this text

Env:
  POUCH_BACKUP_DIR   destination folder (default: /Users/jxm/jxm-vault/Pouch Down)
  POUCH_SEARCH_DIRS  colon-separated folders to search (default: ~/Downloads and
                     ~/Library/Mobile Documents/com~apple~CloudDocs/PouchDown)
  POUCH_TELEGRAM_ENV, POUCH_TELEGRAM_CHAT, POUCH_INGEST_STATE  (--notify; see
                     scripts/notify-telegram.mjs)`;

// → Promise of the exit code: 0 ok (including "nothing new"), 1 error, 2 when no search folder could be read, 64 bad usage.
export async function main(argv = process.argv.slice(2), env = process.env) {
  const flags = new Set(argv);
  if (flags.has('--help') || flags.has('-h')) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((a) => a !== '--dry-run' && a !== '--notify');
  if (unknown.length) {
    console.error(`pouch-ingest: unknown argument ${unknown[0]}\n\n${USAGE}`);
    return 64;
  }
  if (flags.has('--notify')) return watch(env, flags.has('--dry-run'));
  let r;
  try {
    r = ingest({ ...config(env), dryRun: flags.has('--dry-run') });
  } catch (err) {
    console.error(`pouch-ingest: ${err.message}`);
    return 1;
  }
  for (const line of summaryLines(r)) console.log(line);
  if (r.blocked.length && r.readableDirs === 0) {
    console.error(`pouch-ingest: couldn't read any search folder. Give ${process.execPath} access in System Settings → Privacy & Security → Files and Folders (or Full Disk Access).`);
    return 2;
  }
  return 0;
}

const stamp = (d) => `${fmtLocal(d.toISOString())}:${String(d.getSeconds()).padStart(2, '0')}`;

// --notify: launchd runs this on every change in the watched folders and at
// 09:00. Same ingest, then the messages planMessages() picks, deduped through
// the state file. The log gets a block only when something happened, so a
// busy ~/Downloads doesn't fill it with "nothing new".
async function watch(env, dryRun) {
  const now = new Date();
  const lines = [];
  let r = null, error = null;
  try {
    r = ingest({ ...config(env), dryRun, now, log: (line) => lines.push(line) });
  } catch (err) {
    error = err;
    lines.push(`pouch-ingest: ${err.message}`);
  }

  const file = statePath(env);
  const state = loadState(file);
  const messages = error
    ? isDue(state.errorSentAt, now) ? [{ kind: 'error', text: errorText(error) }] : []
    : planMessages(r, state, { now });
  const delivered = [];
  for (const m of messages) {
    if (dryRun) {
      lines.push(`[dry run] would send (${m.kind}): ${m.text}`);
      continue;
    }
    const sent = await notify(m.text, { env, log: (line) => lines.push(line) });
    lines.push(sent.delivered ? `sent ${m.kind} message (${sent.via})` : `couldn't deliver ${m.kind} message`);
    if (sent.delivered) delivered.push(m);
  }
  if (!dryRun) {
    const next = nextState(state, { delivered, failedNow: r?.failed, now });
    try {
      if (JSON.stringify(next) !== JSON.stringify(state)) saveState(file, next);
    } catch (err) {
      lines.push(`couldn't save ${file}: ${err.message}`);
    }
  }

  // A file that keeps failing or a folder that stays blocked is logged when its
  // message goes out, not again on every run after that.
  const happened = error || messages.length || r.ingested.length || r.duplicates.length || r.liveLog?.changed;
  if (dryRun || happened) {
    console.log(`── ${stamp(now)} pouch-ingest --notify${dryRun ? ' --dry-run' : ''}`);
    for (const line of [...lines, ...(r ? summaryLines(r) : [])]) console.log(line);
  }
  if (error) return 1;
  return r.blocked.length && r.readableDirs === 0 ? 2 : 0;
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main();
