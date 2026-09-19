// src/__tests__/notify.test.js — the pure half of `pouch-ingest --notify`
// (scripts/notify-telegram.mjs): what to say, when, and never leaking the token.
// No network: the transport tests hand in a fake fetch / osascript.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  fmtWhen, friendlyPath, isDue, inStaleWindow, planMessages, nextState, redact,
  ingestedText, blockedText, staleText, failedText, errorText, sendTelegram, notify,
} from '../../scripts/notify-telegram.mjs';

const HOME = '/Users/sam';
const NODE = '/Users/sam/.nvm/versions/node/v24.14.1/bin/node';
const TOKEN = '123456789:AAFakeTokenForTests_only-0123456789abcdefg';
// Built from local parts so the expected text doesn't depend on the test machine's time zone.
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi);
const iso = (...a) => at(...a).toISOString();

const result = (over = {}) => ({
  dryRun: false, ingested: [], duplicates: [], failed: [], blocked: [], waiting: [], readableDirs: 2,
  newest: { file: 'x.json', exportedAt: iso(2026, 9, 25, 21, 5), ageDays: 0, stale: false, attemptId: 'a2', attemptStatus: 'active', streak: { current: 4, best: 6 } },
  liveLog: { path: '/vault/Live Log.md', changed: false },
  ...over,
});
const filed = { file: `${HOME}/Downloads/pouch-down-backup-1.json`, exportedAt: iso(2026, 9, 25, 21, 5) };
const noon = at(2026, 9, 26, 12);

describe('formatting', () => {
  it('shows local date/time the way a person says it', () => {
    expect(fmtWhen(iso(2026, 9, 25, 21, 5))).toBe('Fri Sep 25, 9:05 PM');
    expect(fmtWhen(iso(2026, 9, 21, 0, 30))).toBe('Mon Sep 21, 12:30 AM');
    expect(fmtWhen(iso(2026, 10, 6, 12, 0))).toBe('Tue Oct 6, 12:00 PM');
  });
  it('shortens home and iCloud Drive paths', () => {
    expect(friendlyPath(`${HOME}/Downloads`, HOME)).toBe('~/Downloads');
    expect(friendlyPath(`${HOME}/Library/Mobile Documents/com~apple~CloudDocs/PouchDown`, HOME)).toBe('iCloud Drive/PouchDown');
    expect(friendlyPath('/tmp/x', HOME)).toBe('/tmp/x');
  });
});

describe('message text', () => {
  it('ingested: data as of, streak, Live Log', () => {
    const r = result({ ingested: [filed], liveLog: { path: '/vault/Live Log.md', changed: true } });
    expect(ingestedText(r)).toBe('📦 Pouch Down backup filed — data as of Fri Sep 25, 9:05 PM. Streak 4 (best 6). Live Log updated.');
  });
  it('ingested: counts several files, and says so when the Live Log did not change', () => {
    const r = result({ ingested: [filed, filed] });
    expect(ingestedText(r)).toBe('📦 2 Pouch Down backups filed — data as of Fri Sep 25, 9:05 PM. Streak 4 (best 6). Live Log already up to date.');
  });
  it('ingested: no streak line for a backup without an attempt', () => {
    const r = result({ ingested: [filed], newest: { ...result().newest, streak: null, attemptId: null } });
    expect(ingestedText(r)).not.toMatch(/Streak/);
  });
  it('blocked: names the folder, the settings path and the real node binary; nothing lost', () => {
    const t = blockedText([{ path: `${HOME}/Downloads`, code: 'EPERM' }], NODE, HOME);
    expect(t).toMatch(/~\/Downloads/);
    expect(t).toMatch(/System Settings → Privacy & Security → Full Disk Access \(or Files and Folders\)/);
    expect(t).toContain(NODE);
    expect(t).toMatch(/Nothing is lost — the file stays where it landed\.$/);
  });
  it('blocked: a blocked file is reported by its folder, each folder once', () => {
    const t = blockedText([
      { path: `${HOME}/Downloads/pouch-down-backup-1.json`, code: 'EPERM' },
      { path: `${HOME}/Downloads`, code: 'EPERM' },
      { path: `${HOME}/Library/Mobile Documents/com~apple~CloudDocs/PouchDown`, code: 'EACCES' },
    ], NODE, HOME);
    expect(t).toContain('~/Downloads and iCloud Drive/PouchDown');
    expect(t.match(/~\/Downloads/g)).toHaveLength(1);
  });
  it('stale: how old, then exactly what to tap', () => {
    expect(staleText({ ageDays: 4 })).toBe('🕰️ Your newest Pouch Down backup is 4 days old. Time for a fresh backup: Pouch Down → Settings → Download full backup → AirDrop to the Mac.');
    expect(staleText(null)).toMatch(/^🕰️ No Pouch Down backup has reached this Mac yet\. Time for a fresh backup:/);
  });
  it('failed: names the file and the reason, never the contents', () => {
    const t = failedText([{ file: `${HOME}/Downloads/pouch-down-backup-2.json`, reason: 'not valid JSON, so not a Pouch Down backup' }], HOME);
    expect(t).toBe("⚠️ Pouch Down couldn't file ~/Downloads/pouch-down-backup-2.json: not valid JSON, so not a Pouch Down backup. It's left where it landed — nothing was deleted.");
  });
  it('failed: several files go in one message', () => {
    const t = failedText([{ file: '/a/pouch-down-backup-1.json', reason: 'r1' }, { file: '/a/pouch-down-backup-2.txt', reason: 'r2' }], HOME);
    expect(t.split('\n')).toEqual(["⚠️ Pouch Down couldn't file 2 files:", '• /a/pouch-down-backup-1.json: r1', '• /a/pouch-down-backup-2.txt: r2', "They're left where they landed — nothing was deleted."]);
  });
  it('error: says what broke without the token', () => {
    expect(errorText(new Error(`boom at https://api.telegram.org/bot${TOKEN}/x`))).not.toContain(TOKEN);
  });
});

describe('when to send', () => {
  it('isDue: never sent, or at least 20 hours ago', () => {
    expect(isDue(undefined, noon)).toBe(true);
    expect(isDue('garbage', noon)).toBe(true);
    expect(isDue(new Date(noon - 19.9 * 3600e3).toISOString(), noon)).toBe(false);
    expect(isDue(new Date(noon - 20 * 3600e3).toISOString(), noon)).toBe(true);
  });
  it('stale window is 09:00–21:00 local', () => {
    expect(inStaleWindow(at(2026, 9, 26, 8, 59))).toBe(false);
    expect(inStaleWindow(at(2026, 9, 26, 9, 0))).toBe(true);
    expect(inStaleWindow(at(2026, 9, 26, 20, 59))).toBe(true);
    expect(inStaleWindow(at(2026, 9, 26, 21, 0))).toBe(false);
  });

  const opts = { now: noon, nodePath: NODE, home: HOME };
  const kinds = (r, state = {}, o = opts) => planMessages(r, state, o).map((m) => m.kind);
  const stale = { ...result().newest, ageDays: 4, stale: true };

  it('nothing new and nothing wrong → nothing (WatchPaths fires on every Downloads change)', () => {
    expect(kinds(result())).toEqual([]);
    expect(kinds(result({ duplicates: [filed], liveLog: { path: 'x', changed: true } }))).toEqual([]);
  });
  it('a new backup → one "filed" message', () => {
    expect(kinds(result({ ingested: [filed] }))).toEqual(['ingested']);
  });
  it('blocked → at most once per 20 hours', () => {
    const r = result({ blocked: [{ path: `${HOME}/Downloads`, code: 'EPERM' }] });
    expect(kinds(r)).toEqual(['blocked']);
    expect(kinds(r, { blockedSentAt: new Date(noon - 3600e3).toISOString() })).toEqual([]);
    expect(kinds(r, { blockedSentAt: new Date(noon - 21 * 3600e3).toISOString() })).toEqual(['blocked']);
  });
  it('stale → only in the daytime window, at most once per 20 hours', () => {
    const r = result({ newest: stale });
    expect(kinds(r)).toEqual(['stale']);
    expect(kinds(r, {}, { ...opts, now: at(2026, 9, 26, 22) })).toEqual([]);
    expect(kinds(r, {}, { ...opts, now: at(2026, 9, 26, 7) })).toEqual([]);
    expect(kinds(r, { staleSentAt: new Date(noon - 5 * 3600e3).toISOString() })).toEqual([]);
    expect(kinds(r, { staleSentAt: at(2026, 9, 25, 9).toISOString() })).toEqual(['stale']);
  });
  it('stale when no backup has ever been filed', () => {
    expect(kinds(result({ newest: null, liveLog: null }))).toEqual(['stale']);
  });
  it('no stale nudge while a folder is blocked — a fresh backup may be sitting in it', () => {
    expect(kinds(result({ newest: stale, blocked: [{ path: `${HOME}/Downloads`, code: 'EPERM' }] }))).toEqual(['blocked']);
  });
  it('an old backup filed while still stale → both messages', () => {
    expect(kinds(result({ ingested: [filed], newest: stale }))).toEqual(['ingested', 'stale']);
  });
  it('a failed file is reported once, not on every Downloads change', () => {
    const bad = { file: `${HOME}/Downloads/pouch-down-backup-2.json`, reason: 'not a Pouch Down backup' };
    const r = result({ failed: [bad] });
    const first = planMessages(r, {}, opts);
    expect(first.map((m) => m.kind)).toEqual(['failed']);
    const state = nextState({}, { delivered: first, failedNow: r.failed, now: noon });
    expect(kinds(r, state)).toEqual([]);
    // Another bad file later: only the new one is named.
    const bad2 = { ...bad, file: `${HOME}/Downloads/pouch-down-backup-3.json` };
    const second = planMessages(result({ failed: [bad, bad2] }), state, opts);
    expect(second).toHaveLength(1);
    expect(second[0].text).toContain('pouch-down-backup-3.json');
    expect(second[0].text).not.toContain('pouch-down-backup-2.json');
  });
});

describe('nextState', () => {
  it('starts the dedupe clock only for what was delivered', () => {
    const s = nextState({}, { delivered: [{ kind: 'blocked' }, { kind: 'ingested' }], failedNow: [], now: noon });
    expect(s).toEqual({ blockedSentAt: noon.toISOString(), failedNotified: [] });
    expect(nextState({ staleSentAt: 'old' }, { delivered: [{ kind: 'stale' }], failedNow: [], now: noon }).staleSentAt).toBe(noon.toISOString());
  });
  it('an undelivered failure is retried next run', () => {
    const bad = { file: '/d/pouch-down-backup-2.json', reason: 'r' };
    const s = nextState({}, { delivered: [], failedNow: [bad], now: noon });
    expect(planMessages(result({ failed: [bad] }), s, opts0()).map((m) => m.kind)).toEqual(['failed']);
  });
  it('forgets failures that are gone, so the same name failing again is reported again', () => {
    const bad = { file: '/d/pouch-down-backup-2.json', reason: 'r' };
    const told = nextState({}, { delivered: planMessages(result({ failed: [bad] }), {}, opts0()), failedNow: [bad], now: noon });
    const cleared = nextState(told, { delivered: [], failedNow: [], now: noon });
    expect(cleared.failedNotified).toEqual([]);
  });
  it('keeps the failure memory when the run crashed before listing files', () => {
    expect(nextState({ failedNotified: ['k'] }, { delivered: [{ kind: 'error' }], now: noon })).toEqual({ failedNotified: ['k'], errorSentAt: noon.toISOString() });
  });
});
function opts0() { return { now: noon, nodePath: NODE, home: HOME }; }

describe('the token never leaks', () => {
  it('redact removes the token and any bot URL', () => {
    expect(redact(`GET https://api.telegram.org/bot${TOKEN}/sendMessage failed`, TOKEN)).toBe('GET https://api.telegram.org/bot<redacted>/sendMessage failed');
    expect(redact(`${TOKEN} twice ${TOKEN}`, TOKEN)).not.toContain(TOKEN);
    expect(redact('https://api.telegram.org/bot999:zzz-Y_1/getMe')).toBe('https://api.telegram.org/bot<redacted>/getMe');
    expect(redact('nothing secret here', TOKEN)).toBe('nothing secret here');
  });
  it('sendTelegram posts chat_id + text and reports only the status', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; };
    expect(await sendTelegram('hi', { token: TOKEN, chatId: '42' }, { fetchImpl })).toEqual({ ok: true, status: 200 });
    expect(calls).toEqual([{ url: `https://api.telegram.org/bot${TOKEN}/sendMessage`, body: { chat_id: '42', text: 'hi' } }]);
  });
  it('sendTelegram failures carry no token', async () => {
    const thrower = async (url) => { throw new Error(`request to ${url} failed`); };
    const r = await sendTelegram('hi', { token: TOKEN, chatId: '42' }, { fetchImpl: thrower });
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain(TOKEN);
    const http = await sendTelegram('hi', { token: TOKEN, chatId: '42' }, { fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ description: `Unauthorized ${TOKEN}` }) }) });
    expect(http).toMatchObject({ ok: false, status: 401 });
    expect(http.error).not.toContain(TOKEN);
  });
  it('notify falls back to a macOS notification, logs why without the token, never throws', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pouch-notify-'));
    fs.writeFileSync(path.join(dir, '.env'), `TELEGRAM_BOT_TOKEN=${TOKEN}\n`);
    const env = { POUCH_TELEGRAM_ENV: path.join(dir, '.env'), POUCH_TELEGRAM_CHAT: '42' };
    const logged = [], shown = [];
    const execFileImpl = (cmd, args, o, cb) => { shown.push(args.at(-1)); cb(null); };
    const down = async (url) => { throw new Error(`fetch ${url} failed`); };
    const r = await notify('hello', { env, log: (l) => logged.push(l), fetchImpl: down, execFileImpl });
    expect(r).toMatchObject({ delivered: true, via: 'macos' });
    expect(shown).toEqual(['hello']);
    expect(logged.join('\n')).not.toContain(TOKEN);
    expect(logged.join('\n')).not.toContain('42');
    // Telegram up → no macOS notification.
    const ok = await notify('hello', { env, log: () => {}, fetchImpl: async () => ({ ok: true, status: 200 }), execFileImpl });
    expect(ok).toEqual({ delivered: true, via: 'telegram', status: 200 });
    expect(shown).toHaveLength(1);
    // Not configured at all → macOS notification, no throw.
    const none = await notify('hi', { env: { POUCH_TELEGRAM_ENV: path.join(dir, 'missing.env') }, log: () => {}, fetchImpl: down, execFileImpl });
    expect(none.via).toBe('macos');
    fs.rmSync(dir, { recursive: true });
  });
});
