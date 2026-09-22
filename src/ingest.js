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
  fmtTime, localDateStr,
} from './store.js';
import { moneyStats } from './money.js';
import { awardsFor } from './awards.js';

export const STALE_DAYS = 3;
const DAY_MS = 86400000;
const TABLE_DAYS = 21;

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
  const hours = c.sleepHours != null ? `${c.sleepHours}h` : null;
  const quality = c.sleepQuality != null ? `${c.sleepQuality}/5` : null;
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
    return `| ${n} | ${d} | ${cap} | — | — | — | — | — | — | ${status} |`;
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
  return `| ${n} | ${d} | ${cap} | ${used} | ${early} | ${over} | ${first ? fmtTime(first) : '—'} | ${resistedForDay(state, d)} | ${sleepCell(checkinForDay(state, d))} | ${status} |`;
}

// Scored as of the export (call it inside atExport). The table alone runs on
// to `shownThrough`, so the days since the export show up as "not in backup"
// instead of vanishing.
function attemptSection(state, { exportDay, shownThrough }) {
  const { plan } = state;
  const archived = state.status === 'archived';
  const asOf = asOfDay(state);
  const n = dayNumberFor(state, asOf);
  const lines = [`## Attempt ${state.id} — ${archived ? 'archived' : 'active'}`, ''];

  let where;
  if (archived) where = `archived ${dayKeyFor(state.archivedAt)} · scored through ${asOf}`;
  else if (n < 1) where = `starts in ${1 - n} day${n === 0 ? '' : 's'}`;
  else if (n > plan.totalDays) where = `${n - plan.totalDays} day${n - plan.totalDays === 1 ? '' : 's'} past quit day`;
  else {
    const s = stageForDay(plan, n);
    where = `day ${n} of ${plan.totalDays} · stage ${s.id} of ${plan.stages.length}, ${s.name}: cap ${s.pouchesPerDay}${s.mg ? ` × ${s.mg}mg` : ''}`;
  }
  lines.push(`- **Plan:** ${plan.startDate} → ${plan.quitDate} (${plan.totalDays} days) · ${where}`);

  const st = streaks(state);
  lines.push(`- **Streak:** ${archived ? 'final' : 'current'} ${st.current} · best ${st.best}`);

  const m = moneyStats(state);
  lines.push(`- **Money (logged days only):** old pace ${money(m.oldPace)} · spent ${money(m.spent)} · kept ${money(m.kept)} over ${m.loggedDays} logged day${m.loggedDays === 1 ? '' : 's'}`);

  const earned = awardsFor(state).filter((a) => a.earned);
  // A celebrated award never un-earns; when the log no longer supports it, it
  // stays earned with no date (earnedOn null), so it's listed without one.
  lines.push(`- **Awards earned:** ${earned.length ? earned.map((a) => (a.earnedOn ? `${a.title} (${a.earnedOn})` : a.title)).join(', ') : 'none yet'}`);

  const disc = disciplineStats(state);
  lines.push(
    `- **Discipline:** ${disc.onTime} on-time · ${disc.early} early${disc.preFirstSlot ? ` (${disc.preFirstSlot} before first slot)` : ''} · ${disc.overCap} over-cap · ${disc.backfilled} backfilled` +
    (disc.avgMinHeld != null ? ` · avg held +${Math.round(disc.avgMinHeld)}m` : '') +
    (disc.avgMinEarly != null ? ` · avg early ${Math.round(disc.avgMinEarly)}m` : '')
  );

  const triggers = {};
  for (const e of state.events) if (e.trigger) triggers[e.trigger] = (triggers[e.trigger] || 0) + 1;
  const top = Object.entries(triggers).sort((a, b) => b[1] - a[1]).slice(0, 5);
  lines.push(`- **Top triggers:** ${top.length ? top.map(([t, c]) => `${t} (${c})`).join(', ') : 'none tagged'}`);

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
      `> Days after ${exportDay} aren't in it, so they read "not in backup" and the streak below may read short.`,
      ''
    );
  }
  lines.push(`Data as of ${localDateStr(exported)} ${hm(exported)} (when the backup was exported). Regenerated by \`pouch-ingest\` on every run — edits here get overwritten.`, '');

  const attempts = root.attempts.map((a) => `${a.id} (${a.status}, ${a.plan.startDate} → ${a.plan.quitDate})`);
  lines.push(`Attempts in this backup: ${attempts.length ? attempts.join(' · ') : 'none yet'}`, '');

  const state = liveAttempt(root);
  if (!state) lines.push('No attempt set up yet — start one in the app.');
  else lines.push(...atExport(exportedAt, () => attemptSection(state, { exportDay, shownThrough: todayKey(now) })));
  return `${lines.join('\n')}\n`;
}
