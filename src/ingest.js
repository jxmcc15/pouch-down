// Pure half of `pouch-ingest`: turn a backup file's text into a v2 root, and a
// root into the vault's Live Log note. No fs here — scripts/ingest-backup.mjs
// does the I/O, and a future Firebase pull can reuse the renderer as is.
// Day math comes from store.js, which scores an active attempt "as of today" by
// reading the clock — so every score here runs inside atExport(). `now` is the
// Mac's real clock: it only says how old the backup is and how far to show the
// days since the export (as "not in backup").

import { LEGACY_PLAN } from './legacyPlan.js';
import { migrateV1 } from './migrate.js';
import { stageForDay, capForDay } from './plan.js';
import {
  asOfDay, todayKey, dayKeyFor, dayNumberFor, dateForDayNumber, eventsForDay, isLogged,
  pouchesForDay, resistedForDay, streaks, classifyPouch, disciplineStats, checkinForDay,
  fmtTime, localDateStr, triggersFor,
} from './store.js';
import { moneyStats } from './money.js';
import { awardsFor } from './awards.js';
import { wellFormedChat } from './root.js';

export const STALE_DAYS = 3;
const DAY_MS = 86400000;
const TABLE_DAYS = 21;
const SAFE_TEXT_MAX = 80;
const CHAT_TEXT_MAX = 2000; // a coach message is prose, so it gets far more room than a table cell

// In the vault, Markdown, code fences, table pipes, wikilinks and Templater tags
// are live syntax — the note is read by Obsidian, not just by a human. A backup
// is data, so every string that came out of one goes through here on its way
// into the note, including the ones inside headings: it is rendered as words.
// Trusted, by contrast: this file's own fixed text, and numbers the app derived
// itself. One line, capped, so a long value can't run away with the layout.
const NEUTRAL = { '`': "'", '~': '-', '<': '(', '>': ')', '|': '/', '[': '(', ']': ')' };
export function safeText(value, max = SAFE_TEXT_MAX) {
  if (value == null) return '';
  const flat = String(value)
    // Control characters, which a note has no use for. oxlint reads the
    // eslint-style directive; matching them here is the point.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[`~<>|[\]]/g, (c) => NEUTRAL[c]);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

// → { format: 1 | 2, exportedAt, root }. Throws with a reason that never quotes
// the file (JSON.parse's own message can echo its contents, so it's replaced).
export function parseBackup(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('not valid JSON, so not a Pouch Down backup');
  }
  if (j?.app !== 'pouch-down') throw new Error('not a Pouch Down backup');
  const key = j.format === 2 ? j.root?.device?.apiKey : j.state?.settings?.apiKey;
  if (/sk-ant-/.test(text) || (typeof key === 'string' && key.trim() !== '')) {
    throw new Error('backup contains an API key — refusing to store it');
  }
  if (typeof j.exportedAt !== 'string' || Number.isNaN(Date.parse(j.exportedAt))) throw new Error('backup has no export time');
  if (j.format === 2) {
    if (j.root?.version !== 2 || !Array.isArray(j.root.attempts)) throw new Error('v2 backup without a readable root');
    return { format: 2, exportedAt: j.exportedAt, root: j.root };
  }
  if (j.format != null) throw new Error(`backup format ${j.format} is newer than this tool`);
  if (!j.state || !Array.isArray(j.state.events)) throw new Error('v1 backup without a readable state');
  return { format: 1, exportedAt: j.exportedAt, root: migrateV1(j.state, { legacyPlan: LEGACY_PLAN, now: j.exportedAt }) };
}

// The attempt the Live Log is about: the active one, else the most recent.
export const liveAttempt = (root) => root.attempts.find((a) => a.id === root.activeAttemptId) ?? root.attempts.at(-1) ?? null;

export const backupAgeDays = (exportedAt, now = new Date()) => Math.floor((now.getTime() - Date.parse(exportedAt)) / DAY_MS);
export const isStale = (exportedAt, now = new Date()) => now.getTime() - Date.parse(exportedAt) > STALE_DAYS * DAY_MS;

// Runs fn with the clock pinned to the moment the phone exported the backup.
// That moment is "today" for everything the backup says: scored by the Mac's
// clock instead, each day since the export reads unlogged — a 1.5-day-old
// backup zeroes a real 8-day streak. store.js takes no clock argument, so the
// pin is a Date subclass swapped in for the call: synchronous and restored in
// `finally`, so nothing outside fn ever sees it. The day is the Mac's local
// app day of that instant, same as dayKeyFor(exportedAt).
export function atExport(exportedAt, fn) {
  const RealDate = globalThis.Date;
  const ms = RealDate.parse(exportedAt);
  class ExportDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(ms);
    }
    static now() { return ms; }
  }
  globalThis.Date = ExportDate;
  try {
    return fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

// Local wall clock of this machine (the Mac sits in the phone's zone).
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const isoLocal = (d) => `${localDateStr(d)}T${hm(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
const money = (x) => `${x < 0 ? '-' : ''}$${Math.abs(x).toFixed(2)}`;
const validBackfill = (e) => e.type === 'backfill' && Number.isInteger(e.count) && e.count >= 0;

function sleepCell(c) {
  if (!c) return '—';
  const hours = c.sleepHours != null ? `${safeText(c.sleepHours)}h` : null;
  const quality = c.sleepQuality != null ? `${safeText(c.sleepQuality)}/5` : null;
  if (hours && quality) return `${hours} (${quality})`;
  return hours ?? quality ?? '—';
}

// One table row. Unlogged days show — for everything logged: silence is never
// success, and a day after the export isn't silence either — it just isn't in the file.
function dayRow(state, n, { today, exportDay }) {
  const d = dateForDayNumber(state, n);
  const cap = capForDay(state.plan, n);
  const isToday = state.status !== 'archived' && d === today;
  if (!isLogged(state, d)) {
    const status = d > exportDay ? 'not in backup' : isToday ? 'no log yet' : 'no log';
    return `| ${n} | ${safeText(d)} | ${safeText(cap)} | — | — | — | — | — | — | ${status} |`;
  }
  const evs = eventsForDay(state, d);
  let early = 0, over = 0, first = null;
  for (const e of evs) {
    if (e.type !== 'pouch') continue;
    const v = classifyPouch(state, e);
    if (v.bucket === 'early') early++;
    if (v.bucket === 'over-cap') over++;
    if (first == null || Date.parse(e.ts) < Date.parse(first.ts)) first = e;
  }
  const used = pouchesForDay(state, d);
  const isOver = used > cap;
  let status = evs.some(validBackfill) ? (isOver ? 'backfilled, over' : 'backfilled') : isOver ? 'over' : 'on plan';
  if (isToday) status += ' so far';
  return `| ${n} | ${safeText(d)} | ${safeText(cap)} | ${used} | ${early} | ${over} | ${first ? safeText(fmtTime(first)) : '—'} | ${resistedForDay(state, d)} | ${sleepCell(checkinForDay(state, d))} | ${status} |`;
}

// Scored as of the export (call it inside atExport). The table alone runs on
// to `shownThrough`, so the days since the export show up as "not in backup"
// instead of vanishing.
function attemptSection(state, { exportDay, shownThrough }) {
  const { plan } = state;
  const archived = state.status === 'archived';
  const asOf = asOfDay(state);
  const n = dayNumberFor(state, asOf);
  const lines = [`## Attempt ${safeText(state.id)} — ${archived ? 'archived' : 'active'}`, ''];

  let where;
  if (archived) where = `archived ${safeText(dayKeyFor(state.archivedAt))} · scored through ${safeText(asOf)}`;
  else if (n < 1) where = `starts in ${1 - n} day${n === 0 ? '' : 's'}`;
  else if (n > plan.totalDays) where = `${n - plan.totalDays} day${n - plan.totalDays === 1 ? '' : 's'} past quit day`;
  else {
    const s = stageForDay(plan, n);
    where = `day ${n} of ${plan.totalDays} · stage ${safeText(s.id)} of ${plan.stages.length}, ${safeText(s.name)}: cap ${safeText(s.pouchesPerDay)}${s.mg ? ` × ${safeText(s.mg)}mg` : ''}`;
  }
  lines.push(`- **Plan:** ${safeText(plan.startDate)} → ${safeText(plan.quitDate)} (${safeText(plan.totalDays)} days) · ${where}`);

  const st = streaks(state);
  lines.push(`- **Streak:** ${archived ? 'final' : 'current'} ${st.current} · best ${st.best}`);

  const m = moneyStats(state);
  lines.push(`- **Money (logged days only):** old pace ${money(m.oldPace)} · spent ${money(m.spent)} · kept ${money(m.kept)} over ${m.loggedDays} logged day${m.loggedDays === 1 ? '' : 's'}`);

  const earned = awardsFor(state).filter((a) => a.earned);
  // A celebrated award never un-earns; when the log no longer supports it, it
  // stays earned with no date (earnedOn null), so it's listed without one.
  lines.push(`- **Awards earned:** ${earned.length ? earned.map((a) => (a.earnedOn ? `${a.title} (${safeText(a.earnedOn)})` : a.title)).join(', ') : 'none yet'}`);

  const disc = disciplineStats(state);
  lines.push(
    `- **Discipline:** ${disc.onTime} on-time · ${disc.early} early${disc.preFirstSlot ? ` (${disc.preFirstSlot} before first slot)` : ''} · ${disc.overCap} over-cap · ${disc.backfilled} backfilled` +
    (disc.avgMinHeld != null ? ` · avg held +${Math.round(disc.avgMinHeld)}m` : '') +
    (disc.avgMinEarly != null ? ` · avg early ${Math.round(disc.avgMinEarly)}m` : '')
  );

  const triggers = {};
  for (const e of state.events) for (const t of triggersFor(state, e)) triggers[t] = (triggers[t] || 0) + 1;
  const top = Object.entries(triggers).sort((a, b) => b[1] - a[1]).slice(0, 5);
  lines.push(`- **Top triggers:** ${top.length ? top.map(([t, c]) => `${safeText(t)} (${c})`).join(', ') : 'none tagged'}`);

  const through = !archived && shownThrough > asOf ? shownThrough : asOf; // never short of the export day
  const last = Math.min(dayNumberFor(state, through), plan.totalDays);
  lines.push('', `### Last ${TABLE_DAYS} days`, '');
  if (last < 1) {
    lines.push(`Day 1 is ${plan.startDate} — nothing to score yet.`);
    return lines;
  }
  lines.push('| Day | Date | Cap | Used | Early | Over | First | Resisted | Sleep | Status |', '|---|---|---|---|---|---|---|---|---|---|');
  const ctx = { today: asOf, exportDay }; // an active attempt's "today" is the export day
  for (let i = Math.max(1, last - TABLE_DAYS + 1); i <= last; i++) lines.push(dayRow(state, i, ctx));
  return lines;
}

// → the Live Log note (Markdown). Rendered from whatever the newest backup says;
// every run of pouch-ingest overwrites it.
export function renderLiveLog(root, { exportedAt, now = new Date() }) {
  const exported = new Date(exportedAt);
  const exportDay = dayKeyFor(exportedAt);
  const lines = [
    '---',
    'title: Pouch Down — Live Log',
    'type: reference',
    'tags:',
    '  - health/cessation',
    '  - project/pouch-down',
    '  - live-log',
    'aliases:',
    '  - Pouch Down Live Log',
    `created: ${localDateStr(exported)}`,
    `updated: ${localDateStr(now)}`,
    `data_as_of: ${isoLocal(exported)}`,
    'generated_by: pouch-ingest',
    '---',
    '',
    '# Pouch Down — Live Log',
    '',
    'Part of [[Pouch Down — Cessation System]] · build: [[Attempt 2 — Build Schedule]]',
    '',
  ];
  if (isStale(exportedAt, now)) {
    lines.push(
      `> [!warning] This backup is ${backupAgeDays(exportedAt, now)} days old — AirDrop a fresh one from Pouch Down → Settings → Download full backup.`,
      `> Days after ${safeText(exportDay)} aren't in it, so they read "not in backup" and the streak below may read short.`,
      ''
    );
  }
  lines.push(`Data as of ${localDateStr(exported)} ${hm(exported)} (when the backup was exported). Regenerated by \`pouch-ingest\` on every run — edits here get overwritten.`, '');

  const attempts = root.attempts.map((a) => `${safeText(a.id)} (${safeText(a.status)}, ${safeText(a.plan.startDate)} → ${safeText(a.plan.quitDate)})`);
  lines.push(`Attempts in this backup: ${attempts.length ? attempts.join(' · ') : 'none yet'}`, '');

  const state = liveAttempt(root);
  if (!state) lines.push('No attempt set up yet — start one in the app.');
  else lines.push(...atExport(exportedAt, () => attemptSection(state, { exportDay, shownThrough: todayKey(now) })));
  return `${lines.join('\n')}\n`;
}

// ── Coach chats ───────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const readableChat = (c) => wellFormedChat(c) && c.messages.length > 0;
const startedMs = (c) => { const t = Date.parse(c.startedAt); return Number.isNaN(t) ? -Infinity : t; };

// → [{ attempt, chat }]: the active attempt first, then the rest newest-created
// first; within an attempt, newest chat first. Only chats the app itself would
// accept, and never an empty one — there is nothing in it to read.
export function chatsOf(root) {
  const others = root.attempts.filter((a) => a.id !== root.activeAttemptId)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const active = root.attempts.filter((a) => a.id === root.activeAttemptId);
  return [...active, ...others].flatMap((attempt) => (Array.isArray(attempt.chats) ? attempt.chats : [])
    .map((chat, i) => ({ chat, i }))
    .filter(({ chat }) => readableChat(chat))
    // Later in the list is newer when two chats share a start time.
    .sort((a, b) => startedMs(b.chat) - startedMs(a.chat) || b.i - a.i)
    .map(({ chat }) => ({ attempt, chat })));
}

// "Day 4 — Thu Sep 24, 8:12 PM". The date is the chat's app day (4am→4am, the
// same day its number counts), the time its start on the wall clock. Both come
// out of the backup, so a value that isn't a real day or time is shown as words
// rather than trusted into arithmetic.
function chatHeading(attempt, chat) {
  let when;
  if (DAY_KEY.test(chat.day) && !Number.isNaN(Date.parse(`${chat.day}T12:00:00Z`))) {
    const d = new Date(`${chat.day}T12:00:00Z`);
    when = `Day ${dayNumberFor(attempt, chat.day)} — ${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  } else when = safeText(chat.day);
  return Number.isNaN(Date.parse(chat.startedAt)) ? when : `${when}, ${fmtTime(chat.startedAt)}`;
}

// → the Coach Chats note (Markdown), from the newest backup; every run of
// pouch-ingest overwrites it. Every message is the user's or the model's words,
// so every one goes through safeText: a chat can't write a link, a tag or a
// table into the vault.
export function renderCoachChats(root, { exportedAt, now = new Date() }) {
  const exported = new Date(exportedAt);
  const lines = [
    '---',
    'title: Pouch Down — Coach Chats',
    'type: reference',
    'tags:',
    '  - health/cessation',
    '  - project/pouch-down',
    '  - coach-chats',
    'aliases:',
    '  - Pouch Down Coach Chats',
    `created: ${localDateStr(exported)}`,
    `updated: ${localDateStr(now)}`,
    `data_as_of: ${isoLocal(exported)}`,
    'generated_by: pouch-ingest',
    '---',
    '',
    '# Pouch Down — Coach Chats',
    '',
    `Every conversation with the in-app coach, as of ${localDateStr(exported)} ${hm(exported)} (when the backup was exported). Part of [[Pouch Down — Cessation System]] · the numbers are in [[Pouch Down — Live Log]]. Regenerated by \`pouch-ingest\` on every run — edits here get overwritten.`,
    '',
  ];
  const chats = chatsOf(root);
  const unreadable = root.attempts.reduce((n, a) => n + (Array.isArray(a.chats) ? a.chats.filter((c) => !wellFormedChat(c)).length : 0), 0);
  if (!chats.length) lines.push('No coach chats in this backup yet.', '');
  // Pinned to the export like the Live Log, so nothing here reads the Mac's clock.
  atExport(exportedAt, () => {
    let current = null;
    for (const { attempt, chat } of chats) {
      if (attempt !== current) {
        current = attempt;
        lines.push(`## Attempt ${safeText(attempt.id)} — ${attempt.status === 'archived' ? 'archived' : 'active'}`, '');
      }
      lines.push(`### ${chatHeading(attempt, chat)}`, '');
      for (const m of chat.messages) lines.push(`- **${m.role === 'user' ? 'You' : 'Coach'}:** ${safeText(m.text, CHAT_TEXT_MAX)}`);
      lines.push('');
    }
  });
  if (unreadable) lines.push(`${unreadable} chat${unreadable === 1 ? '' : 's'} couldn't be read.`, '');
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
