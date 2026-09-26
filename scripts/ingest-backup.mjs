#!/usr/bin/env node
// pouch-ingest — files the phone's backup in the vault and re-renders the Live Log.
//
// The phone exports via Settings → Download full backup, then AirDrop (lands in
// ~/Downloads) or Save to Files → iCloud Drive → PouchDown. This picks up every
// `pouch-down-backup-*.json|.txt` there, copies each valid new one into
// $POUCH_BACKUP_DIR/Backups/, moves Downloads originals into Backups/_ingested/
// (iCloud copies stay put), and writes $POUCH_BACKUP_DIR/Live Log.md and
// Coach Chats.md from the newest backup. It never deletes a file and never overwrites a different one.
//
// It trusts sources, not filenames. The iCloud folder is trusted by location;
// ~/Downloads is shared with everything else on the Mac, so a file there is
// trusted only if macOS says AirDrop put it there. A candidate also has to be a
// plausible backup before it is filed: within the size cap, not dated ahead of
// the clock, and a root the app itself would load. Refusals land in
// `result.rejected` as { file, reason }; the file stays exactly where it is.
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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBackup, renderLiveLog, renderCoachChats, chatsOf, liveAttempt, backupAgeDays, isStale, atExport } from '../src/ingest.js';
import { streaks } from '../src/store.js';
import { wellFormed } from '../src/root.js';
import { planMessages, nextState, isDue, errorText, statePath, loadState, saveState, notify } from './notify-telegram.mjs';

const BACKUP_NAME = /^pouch-down-backup-.*\.(json|txt)$/i;
const ICLOUD_PLACEHOLDER = /^\.(pouch-down-backup-.*\.(json|txt))\.icloud$/i; // not downloaded to this Mac yet
const BLOCKED_CODES = new Set(['EPERM', 'EACCES']);
const AIRDROP_AGENT = 'sharingd'; // the macOS service that writes an AirDropped file
const MAX_BYTES = 5 * 1024 * 1024; // a real backup is orders of magnitude smaller
const FUTURE_SLACK_MS = 5 * 60 * 1000; // the Mac and the phone don't share a clock to the second

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

// Where macOS says a file came from. It records that in the file's
// `com.apple.quarantine` extended attribute; the third `;`-separated field
// names the agent that put the file there. null when the attribute is absent
// (a file this Mac made itself) or when xattr can't be run at all.
export function provenance(file) {
  try {
    const r = spawnSync('xattr', ['-p', 'com.apple.quarantine', file], { encoding: 'utf8' });
    if (r.error || r.status !== 0 || typeof r.stdout !== 'string') return null;
    const agent = r.stdout.trim().split(';')[2];
    return agent ? agent.trim() || null : null;
  } catch {
    return null;
  }
}

// Whether this file is one we're willing to read as a backup. The iCloud folder
// is trusted by its location, as it always was: only the phone writes there.
// ~/Downloads is a shared doormat, so a file there is trusted by how it arrived
// — James's phone backups come by AirDrop only, and AirDrop names its own agent.
export function trusted({ dir, file, provenance: ask = provenance }) {
  return isICloud(dir) || ask(file) === AIRDROP_AGENT;
}

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

// A file dated ahead of the clock is not believed: the Live Log is pinned to the
// newest export time it can find, so a single wrong date would freeze the note.
const isFuture = (exportedAt, now) => Date.parse(exportedAt) > now.getTime() + FUTURE_SLACK_MS;

// "Valid backup", used both for what gets filed and for what the note may be
// rendered from: it parses, it isn't dated ahead of the clock, and the app
// itself would load its root.
const readBackup = (file, now = new Date()) => {
  try {
    const backup = parseBackup(fs.readFileSync(file, 'utf8'));
    return isFuture(backup.exportedAt, now) || !wellFormed(backup.root) ? null : { file, ...backup };
  } catch {
    return null; // not a backup
  }
};
const newer = (a, b) => (!b || (a && Date.parse(a.exportedAt) > Date.parse(b.exportedAt)) ? a : b);

// Newest valid backup already in the folder. Backups/ names sort by export time,
// so its first valid one is its newest. Backups filed by hand elsewhere in the
// folder count too: a phone copy identical to one of those is a duplicate, so
// it only goes to _ingested/ and never lands in Backups/.
function newestArchived(backupDir, now = new Date()) {
  const archiveDir = path.join(backupDir, 'Backups');
  let names = [];
  try {
    names = fs.readdirSync(archiveDir).filter((n) => n.endsWith('.json')).sort().reverse();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  let best = null;
  for (const name of names) if ((best = readBackup(path.join(archiveDir, name), now))) break;
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
      else if (e.isFile() && /\.(json|txt)$/i.test(e.name)) best = newer(readBackup(p, now), best);
    }
  };
  walk(backupDir);
  return best;
}

// → { dryRun, ingested, duplicates, rejected, failed, blocked, waiting, readableDirs, newest, liveLog, coachChats }
// `provenance` and `trusted` are injectable so tests never consult the real
// extended attributes of a real file.
export function ingest(opts = {}) {
  const {
    backupDir, searchDirs, dryRun = false, now = new Date(), log = console.log,
    provenance: ask = provenance, trusted: isTrusted = trusted,
  } = { ...config(), ...opts };
  const archiveDir = path.join(backupDir, 'Backups');
  const movedDir = path.join(archiveDir, '_ingested');
  const say = (line) => log(dryRun ? `[dry run] ${line}` : line);
  const result = { dryRun, ingested: [], duplicates: [], rejected: [], failed: [], blocked: [], waiting: [], readableDirs: 0, newest: null, liveLog: null, coachChats: null };
  // A refused file is named with its reason and nothing else, and is left alone.
  const reject = (file, reason) => {
    result.rejected.push({ file, reason });
    say(`refused  ${file}: ${reason} — left where it is`);
  };

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
        if (!st.isFile()) continue;
        if (!isTrusted({ dir, file, provenance: ask })) { reject(file, 'untrusted-source'); continue; }
        if (st.size > MAX_BYTES) { reject(file, 'too-large'); continue; } // decided from stat, before any read
        candidates.push({ file, dir, mtimeMs: st.mtimeMs });
      } catch (err) {
        if (BLOCKED_CODES.has(err.code)) result.blocked.push({ path: file, code: err.code });
        else result.failed.push({ file, reason: `can't read it (${err.code ?? err.message})` });
        say(`skipped  ${file}: can't read it (${err.code ?? err.message})`);
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first

  // What the vault already knew before this run files anything: the coach chats
  // it holds are the ones James has seen, so only chats beyond them are "new".
  // Taken before step 2, which is what adds to the folder.
  const before = newestArchived(backupDir, now);

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
    if (isFuture(backup.exportedAt, now)) { reject(file, 'future-export'); continue; }
    // The same check the app makes before it trusts stored data. A file that
    // parses but can't be read as a root is not a backup we can score.
    if (!wellFormed(backup.root)) { reject(file, 'unreadable-root'); continue; }
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
  //    re-renders, so the staleness warning stays current. Everything step 2
  //    added to the folder is in `parsed`, so `before` plus `parsed` is the lot.
  let newest = before;
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
      // As of the export, like the Live Log — this is the streak the Telegram ping reports.
      streak: attempt ? atExport(newest.exportedAt, () => streaks(attempt)) : null,
    };
    result.liveLog = writeNote(path.join(backupDir, 'Live Log.md'), renderLiveLog(newest.root, { exportedAt: newest.exportedAt, now }), { backupDir, dryRun });

    const ids = (b) => chatsOf(b.root).map(({ chat }) => chat.id);
    const had = new Set(before && candidates.length ? ids(before) : []);
    const chats = ids(newest);
    result.coachChats = {
      ...writeNote(path.join(backupDir, 'Coach Chats.md'), renderCoachChats(newest.root, { exportedAt: newest.exportedAt, now }), { backupDir, dryRun }),
      total: chats.length,
      // With no earlier backup there is nothing to be new against: the first
      // ingest would otherwise call every chat ever had "new".
      fresh: before && candidates.length ? chats.filter((id) => !had.has(id)) : [],
    };
  }
  return result;
}

// Writes a rendered note only when its text changed, so an unchanged run
// leaves the vault's git history alone. → { path, changed }
function writeNote(target, md, { backupDir, dryRun }) {
  let current = null;
  try { current = fs.readFileSync(target, 'utf8'); } catch { /* first run */ }
  const changed = current !== md;
  if (changed && !dryRun) {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(target, md);
  }
  return { path: target, changed };
}

const fmtLocal = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// The summary: files ingested, data as of, current streak, and the coach
// chats when the newest backup has any.
export function summaryLines(r) {
  const extra = [
    r.duplicates.length && `${r.duplicates.length} already filed`,
    // A refusal James never hears about reads as "nothing arrived" when something did.
    r.rejected?.length && `${r.rejected.length} refused`,
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
  if (r.coachChats?.total) lines.push(`Coach chats: ${r.coachChats.total} (${r.coachChats.fresh.length} new)`);
  return lines;
}

const USAGE = `Usage: pouch-ingest [--dry-run] [--notify]

Files Pouch Down backups (pouch-down-backup-*.json|.txt) from ~/Downloads and
iCloud Drive/PouchDown into the vault, then re-renders "Live Log.md" and
"Coach Chats.md".

A file in ~/Downloads is only read if macOS says AirDrop put it there, which is
how the phone sends them; the iCloud folder is trusted by location. Anything
refused is named with its reason and left exactly where it is.

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
// `opts` is passed through to ingest(), so a test can pin the clock and inject
// provenance instead of asking macOS about a real file.
export async function main(argv = process.argv.slice(2), env = process.env, opts = {}) {
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
  if (flags.has('--notify')) return watch(env, flags.has('--dry-run'), opts);
  let r;
  try {
    r = ingest({ ...config(env), dryRun: flags.has('--dry-run'), ...opts });
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
async function watch(env, dryRun, opts = {}) {
  const now = new Date();
  const lines = [];
  let r = null, error = null;
  try {
    r = ingest({ ...config(env), dryRun, now, ...opts, log: (line) => lines.push(line) });
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
    // Refusals ride in the same memory as failures, so neither is repeated on
    // every Downloads change and both are forgotten once the file is gone.
    const next = nextState(state, { delivered, failedNow: r && [...r.failed, ...r.rejected], now });
    try {
      if (JSON.stringify(next) !== JSON.stringify(state)) saveState(file, next);
    } catch (err) {
      lines.push(`couldn't save ${file}: ${err.message}`);
    }
  }

  // A file that keeps failing or a folder that stays blocked is logged when its
  // message goes out, not again on every run after that.
  const happened = error || messages.length || r.ingested.length || r.duplicates.length || r.rejected.length || r.liveLog?.changed;
  if (dryRun || happened) {
    console.log(`── ${stamp(now)} pouch-ingest --notify${dryRun ? ' --dry-run' : ''}`);
    for (const line of [...lines, ...(r ? summaryLines(r) : [])]) console.log(line);
  }
  if (error) return 1;
  return r.blocked.length && r.readableDirs === 0 ? 2 : 0;
}

const invokedDirectly = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = await main();
