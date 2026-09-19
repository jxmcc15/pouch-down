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
// Usage: pouch-ingest [--dry-run]
// Env:   POUCH_BACKUP_DIR   where backups + Live Log go (default: the vault's Pouch Down folder)
//        POUCH_SEARCH_DIRS  colon-separated folders to pick backups up from
//                           (default: ~/Downloads and iCloud Drive/PouchDown)
//
// `ingest()` returns a structured result so other modes (e.g. notifications)
// can be built on it without re-reading the folders.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseBackup, renderLiveLog, liveAttempt, backupAgeDays, isStale } from '../src/ingest.js';
import { streaks } from '../src/store.js';

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

// Newest valid backup already archived in Backups/ (names sort by export time).
function newestArchived(archiveDir) {
  let names;
  try {
    names = fs.readdirSync(archiveDir).filter((n) => n.endsWith('.json')).sort().reverse();
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  for (const name of names) {
    const file = path.join(archiveDir, name);
    try {
      return { file, ...parseBackup(fs.readFileSync(file, 'utf8')) };
    } catch { /* not a backup — keep looking */ }
  }
  return null;
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
  let newest = newestArchived(archiveDir);
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

const USAGE = `Usage: pouch-ingest [--dry-run]

Files Pouch Down backups (pouch-down-backup-*.json|.txt) from ~/Downloads and
iCloud Drive/PouchDown into the vault, then re-renders "Live Log.md".

  --dry-run   print what would happen; write, copy and move nothing
  --help      this text

Env:
  POUCH_BACKUP_DIR   destination folder (default: /Users/jxm/jxm-vault/Pouch Down)
  POUCH_SEARCH_DIRS  colon-separated folders to search (default: ~/Downloads and
                     ~/Library/Mobile Documents/com~apple~CloudDocs/PouchDown)`;

// → exit code: 0 ok (including "nothing new"), 1 error, 2 when no search folder could be read, 64 bad usage.
export function main(argv = process.argv.slice(2), env = process.env) {
  const flags = new Set(argv);
  if (flags.has('--help') || flags.has('-h')) {
    console.log(USAGE);
    return 0;
  }
  const unknown = argv.filter((a) => a !== '--dry-run');
  if (unknown.length) {
    console.error(`pouch-ingest: unknown argument ${unknown[0]}\n\n${USAGE}`);
    return 64;
  }
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

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main();
