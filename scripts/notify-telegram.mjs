// Messages for `pouch-ingest --notify`, the launchd watcher's voice.
//
// Two halves. Deciding what to say is pure (planMessages, nextState and the
// *Text builders; tested in src/__tests__/notify.test.js). Saying it goes to
// Telegram through the Claude Code Telegram plugin's bot, falling back to a
// macOS notification if that isn't set up or the send fails. The bot token is
// read at send time only and is never printed, logged or stored; anything
// that could echo it goes through redact() first. Never throws.
//
// Env: POUCH_TELEGRAM_ENV   the .env holding TELEGRAM_BOT_TOKEN (default:
//                           ~/.claude/channels/telegram/.env; access.json is
//                           read from the same folder)
//      POUCH_TELEGRAM_CHAT  chat id to send to (default: access.json allowFrom[0])
//      POUCH_INGEST_STATE   dedupe state file (default: ~/.local/state/pouch-ingest/state.json)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const DEDUPE_HOURS = 20; // blocked, stale and error messages: at most once per 20 hours each
export const STALE_WINDOW = [9, 21]; // stale nudges only 09:00–21:00 local
const HOUR_MS = 3600000;

// ── Deciding what to say (pure) ────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Fri Sep 25, 9:05 PM", local time.
export function fmtWhen(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function friendlyPath(p, home = os.homedir()) {
  const icloud = path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs');
  if (p === icloud || p.startsWith(`${icloud}/`)) return `iCloud Drive${p.slice(icloud.length)}`;
  if (p === home || p.startsWith(`${home}/`)) return `~${p.slice(home.length)}`;
  return p;
}

export function isDue(lastSentAt, now, hours = DEDUPE_HOURS) {
  const t = Date.parse(lastSentAt ?? '');
  return Number.isNaN(t) || now.getTime() - t >= hours * HOUR_MS;
}

export const inStaleWindow = (now) => now.getHours() >= STALE_WINDOW[0] && now.getHours() < STALE_WINDOW[1];

const failKey = (f) => `${f.file}\n${f.reason}`;

export function ingestedText({ ingested, newest, liveLog, coachChats }) {
  const n = ingested.length;
  const head = n === 1 ? '📦 Pouch Down backup filed' : `📦 ${n} Pouch Down backups filed`;
  const asOf = newest ? ` — data as of ${fmtWhen(newest.exportedAt)}.` : '.';
  const streak = newest?.streak ? ` Streak ${newest.streak.current} (best ${newest.streak.best}).` : '';
  // A new chat may hold a request for a change, so it rides on the filed message
  // rather than being left for James to find in the vault.
  const k = coachChats?.fresh?.length ?? 0;
  const chats = k ? ` · ${k} new coach chat${k === 1 ? '' : 's'}` : '';
  return `${head}${asOf}${streak} ${liveLog?.changed ? 'Live Log updated.' : 'Live Log already up to date.'}${chats}`;
}

export function blockedText(blocked, nodePath, home = os.homedir()) {
  const dirs = blocked.map((b) => friendlyPath(/\.(json|txt)$/i.test(b.path) ? path.dirname(b.path) : b.path, home));
  return `🔒 macOS is blocking Pouch Down from reading ${[...new Set(dirs)].join(' and ')}, so your backup can't be filed yet. ` +
    `To fix it: System Settings → Privacy & Security → Full Disk Access (or Files and Folders) → add ${nodePath} ` +
    `(in the + dialog press ⌘⇧G and paste that path) and toggle it on. Nothing is lost — the file stays where it landed.`;
}

export function staleText(newest) {
  const age = newest ? `Your newest Pouch Down backup is ${newest.ageDays} days old.` : 'No Pouch Down backup has reached this Mac yet.';
  return `🕰️ ${age} Time for a fresh backup: Pouch Down → Settings → Download full backup → AirDrop to the Mac.`;
}

// Names the file and parseBackup's reason, which never quotes the file's contents.
export function failedText(failed, home = os.homedir()) {
  if (failed.length === 1) {
    const [f] = failed;
    return `⚠️ Pouch Down couldn't file ${friendlyPath(f.file, home)}: ${f.reason}. It's left where it landed — nothing was deleted.`;
  }
  return [
    `⚠️ Pouch Down couldn't file ${failed.length} files:`,
    ...failed.map((f) => `• ${friendlyPath(f.file, home)}: ${f.reason}`),
    "They're left where they landed — nothing was deleted.",
  ].join('\n');
}

// A refusal is deliberate — the file was left alone on purpose — so it reads
// differently from a failure, and it never shows James the internal reason code.
// It has to be said out loud: a file he thinks he sent, silently ignored, would
// look exactly like a file that arrived.
const WHY_REFUSED = {
  'untrusted-source': "it didn't arrive by AirDrop, and ~/Downloads is only trusted for AirDrop now. Send it from the phone with AirDrop, or save it to iCloud Drive → PouchDown",
  'too-large': "it's far bigger than a backup should be, so it wasn't opened",
  'future-export': 'its export time is in the future, which a real backup never is — check the phone\'s date',
  'unreadable-root': "the app couldn't read what's inside it, so it wasn't filed",
};
const whyRefused = (reason) => WHY_REFUSED[reason] ?? 'it did not look like a backup from this app';

export function refusedText(rejected, home = os.homedir()) {
  if (rejected.length === 1) {
    const [r] = rejected;
    return `🚫 Pouch Down left ${friendlyPath(r.file, home)} where it is: ${whyRefused(r.reason)}. Nothing was filed and nothing was deleted.`;
  }
  return [
    `🚫 Pouch Down left ${rejected.length} files where they are:`,
    ...rejected.map((r) => `• ${friendlyPath(r.file, home)}: ${whyRefused(r.reason)}`),
    'Nothing was filed and nothing was deleted.',
  ].join('\n');
}

export const errorText = (err) =>
  `⚠️ The Pouch Down watcher hit an error and didn't file anything: ${redact(err?.message ?? err)}. Backups stay where they landed — run pouch-ingest in Terminal to see more.`;

// → [{ kind, text, keys? }] to send for one ingest result; [] when nothing is
// new and nothing is wrong (WatchPaths fires on every change in ~/Downloads).
export function planMessages(r, state = {}, { now = new Date(), nodePath = process.execPath, home = os.homedir() } = {}) {
  const out = [];
  if (r.ingested.length) out.push({ kind: 'ingested', text: ingestedText(r) });
  const told = new Set(state.failedNotified ?? []);
  const fresh = r.failed.filter((f) => !told.has(failKey(f)));
  if (fresh.length) out.push({ kind: 'failed', text: failedText(fresh, home), keys: fresh.map(failKey) });
  // Refusals share the failure memory: same { file, reason } key, so the two can
  // never shadow each other, and neither is repeated on every Downloads change.
  const freshRefused = (r.rejected ?? []).filter((f) => !told.has(failKey(f)));
  if (freshRefused.length) out.push({ kind: 'refused', text: refusedText(freshRefused, home), keys: freshRefused.map(failKey) });
  if (r.blocked.length && isDue(state.blockedSentAt, now)) out.push({ kind: 'blocked', text: blockedText(r.blocked, nodePath, home) });
  // While a folder is blocked a fresh backup may be sitting in it — don't ask for another.
  const stale = !r.newest || r.newest.stale;
  if (stale && !r.blocked.length && inStaleWindow(now) && isDue(state.staleSentAt, now)) out.push({ kind: 'stale', text: staleText(r.newest) });
  return out;
}

// State to save after a run: dedupe clocks for what was actually delivered, and
// the failures already reported that are still failing. A failure that's gone
// is forgotten, so the same name failing again later is reported again. With no
// `failedNow` (the run crashed before listing files) that memory is kept as is.
export function nextState(state = {}, { delivered = [], failedNow, now = new Date() } = {}) {
  const next = { ...state };
  for (const m of delivered) if (['blocked', 'stale', 'error'].includes(m.kind)) next[`${m.kind}SentAt`] = now.toISOString();
  if (failedNow) {
    const told = new Set([...(state.failedNotified ?? []), ...delivered.flatMap((m) => m.keys ?? [])]);
    next.failedNotified = failedNow.map(failKey).filter((k) => told.has(k));
  }
  return next;
}

// ── Dedupe state (outside the vault — the vault is a git repo) ────────────

export const statePath = (env = process.env) => env.POUCH_INGEST_STATE || path.join(os.homedir(), '.local/state/pouch-ingest/state.json');

export function loadState(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch {
    return {}; // first run, or unreadable: start fresh
  }
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
}

// ── Saying it ──────────────────────────────────────────────────────────────

export function redact(text, token) {
  let s = String(text);
  if (token) s = s.split(token).join('<redacted>');
  // the /bot<token>/ URL form, plus bare tokens (digits:secret) that some other text might echo
  return s.replace(/bot\d+:[\w-]+/g, 'bot<redacted>').replace(/\b\d{6,}:[\w-]{20,}/g, '<redacted>');
}

// → { token, chatId } or { problem }. Read only; nothing in that folder is ever written.
export function telegramConfig(env = process.env) {
  const envFile = env.POUCH_TELEGRAM_ENV || path.join(os.homedir(), '.claude/channels/telegram/.env');
  let token = null;
  let chatId = env.POUCH_TELEGRAM_CHAT || null;
  try {
    token = /^\s*(?:export\s+)?TELEGRAM_BOT_TOKEN\s*=\s*["']?([^"'\s]+)/m.exec(fs.readFileSync(envFile, 'utf8'))?.[1] ?? null;
  } catch { /* not set up */ }
  if (!chatId) {
    try {
      const first = JSON.parse(fs.readFileSync(path.join(path.dirname(envFile), 'access.json'), 'utf8')).allowFrom?.[0];
      chatId = first == null ? null : String(first);
    } catch { /* not set up */ }
  }
  if (!token) return { problem: 'no Telegram bot token' };
  if (!chatId) return { problem: 'no Telegram chat to send to' };
  return { token, chatId };
}

// → { ok, status, error? } — the error is redacted; the chat id is never in it.
export async function sendTelegram(text, { token, chatId }, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return { ok: true, status: res.status };
    let why = '';
    try { why = (await res.json())?.description ?? ''; } catch { /* no JSON body */ }
    return { ok: false, status: res.status, error: redact(`HTTP ${res.status}${why ? ` ${why}` : ''}`, token) };
  } catch (err) {
    return { ok: false, status: null, error: redact(`${err.message}${err.cause?.message ? `: ${err.cause.message}` : ''}`, token) };
  }
}

// The text goes in as an argument, not spliced into the script, so no quoting can break it.
export function macNotification(text, { execFileImpl = execFile } = {}) {
  const script = ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title "Pouch Down"', '-e', 'end run'];
  return new Promise((resolve) => {
    try {
      execFileImpl('/usr/bin/osascript', [...script, text], { timeout: 10000 }, (err) => resolve(err ? { ok: false, error: err.message } : { ok: true }));
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

// Telegram first, then a macOS notification. → { delivered, via: 'telegram' | 'macos' | null, status?, error? }
export async function notify(text, { env = process.env, log = console.log, fetchImpl, execFileImpl } = {}) {
  let why;
  try {
    const cfg = telegramConfig(env);
    if (cfg.problem) why = cfg.problem;
    else {
      const r = await sendTelegram(text, cfg, { fetchImpl });
      if (r.ok) return { delivered: true, via: 'telegram', status: r.status };
      why = r.error;
    }
  } catch (err) {
    why = redact(err.message);
  }
  const mac = await macNotification(text, { execFileImpl });
  log(`telegram not sent (${why}); ${mac.ok ? 'showed a macOS notification instead' : `macOS notification failed too (${mac.error})`}`);
  return { delivered: mac.ok, via: mac.ok ? 'macos' : null, error: why };
}
