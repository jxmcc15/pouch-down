// src/__tests__/ingestTrust.test.js
// What the ingest pipeline is allowed to trust, and what it refuses to believe.
//
// Every fixture here is synthetic: built in this file, written into a temp dir
// that is removed again, with invented dates and an empty apiKey. Provenance is
// injected, so no test ever asks macOS about a real file.
//
// The pipeline's standing promises, which every test below re-checks: it never
// deletes a file, it never overwrites a different one, and a file it refuses
// stays exactly where it was.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ingest, summaryLines, main } from '../../scripts/ingest-backup.mjs';
import { renderLiveLog, safeText } from '../ingest.js';
import { generatePlan } from '../planGenerator.js';

const NOW = new Date('2026-09-25T18:00:00.000Z');
const EXPORTED = '2026-09-25T17:00:00.000Z';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
const ev = (type, day, extra = {}) => ({ id: `${type}-${day}-${Math.random()}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const attempt = {
  id: 'a2', status: 'active', createdAt: '2026-09-21T12:00:00Z', archivedAt: null, settings, plan,
  events: Array.from({ length: 8 }, () => ev('pouch', '2026-09-21')),
  celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null,
};
const rootOf = (a = attempt) => ({ version: 2, device: { apiKey: '' }, activeAttemptId: 'a2', attempts: [a] });
const backupText = ({ exportedAt = EXPORTED, root = rootOf() } = {}) => JSON.stringify({ app: 'pouch-down', format: 2, exportedAt, root });

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pouch-trust-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

// A search folder plus the vault folder the pipeline writes into. `kind: 'icloud'`
// gives the folder an iCloud Drive path, which is what the location rule keys on.
function bed({ kind = 'downloads' } = {}) {
  const search = kind === 'icloud'
    ? path.join(tmp, 'Library/Mobile Documents/com~apple~CloudDocs/PouchDown')
    : path.join(tmp, 'Downloads');
  fs.mkdirSync(search, { recursive: true });
  const backupDir = path.join(tmp, 'Pouch Down');
  return { search, backupDir, archiveDir: path.join(backupDir, 'Backups'), liveLog: path.join(backupDir, 'Live Log.md') };
}
const put = (dir, name, text) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};
const ls = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return null; } };
const run = ({ search, backupDir }, opts = {}) => ingest({ backupDir, searchDirs: [search], now: NOW, log: () => {}, provenance: () => null, ...opts });

describe('a filename is not provenance', () => {
  it('refuses a ~/Downloads file that did not arrive by AirDrop', () => {
    const b = bed();
    const file = put(b.search, 'pouch-down-backup-1.json', backupText());
    const r = run(b, { provenance: () => null });

    expect(r.rejected).toEqual([{ file, reason: 'untrusted-source' }]);
    expect(r.ingested).toEqual([]);
    expect(fs.existsSync(file)).toBe(true); // left exactly where it was
    expect(ls(b.archiveDir)).toBe(null); // nothing filed
    expect(fs.existsSync(b.liveLog)).toBe(false); // the note is untouched
  });

  it('files a ~/Downloads file that AirDrop put there', () => {
    const b = bed();
    const file = put(b.search, 'pouch-down-backup-1.json', backupText());
    const r = run(b, { provenance: () => 'sharingd' });

    expect(r.rejected).toEqual([]);
    expect(r.ingested).toHaveLength(1);
    expect(ls(b.archiveDir)).toContain('2026-09-25T17-00-00.000Z.json');
    expect(fs.existsSync(file)).toBe(false); // moved aside, not deleted
    expect(ls(path.join(b.archiveDir, '_ingested'))).toEqual(['pouch-down-backup-1.json']);
  });

  it('trusts the iCloud folder by its location, without asking about provenance', () => {
    const b = bed({ kind: 'icloud' });
    const file = put(b.search, 'pouch-down-backup-1.json', backupText());
    const r = run(b, { provenance: () => { throw new Error('provenance must not be consulted for iCloud'); } });

    expect(r.rejected).toEqual([]);
    expect(r.ingested).toHaveLength(1);
    expect(fs.existsSync(file)).toBe(true); // iCloud copies stay put
  });
});

describe('a candidate has to be plausible before it is read', () => {
  it('refuses a file past the size cap without reading it', () => {
    const b = bed({ kind: 'icloud' }); // trusted by location, so size is the only question
    // Not JSON: if the file were read at all, the reason would be a parse failure.
    const file = put(b.search, 'pouch-down-backup-big.json', 'x'.repeat(5 * 1024 * 1024 + 1));
    const r = run(b);

    expect(r.rejected).toEqual([{ file, reason: 'too-large' }]);
    expect(r.failed).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
    expect(ls(b.archiveDir)).toBe(null);
  });

  it('refuses a backup that claims to have been exported in the future', () => {
    const b = bed({ kind: 'icloud' });
    const file = put(b.search, 'pouch-down-backup-ahead.json', backupText({ exportedAt: '2027-01-01T00:00:00.000Z' }));
    const r = run(b);

    expect(r.rejected).toEqual([{ file, reason: 'future-export' }]);
    expect(r.ingested).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
    expect(ls(b.archiveDir)).toBe(null);
    expect(fs.existsSync(b.liveLog)).toBe(false);
  });

  it('allows the small clock difference between the Mac and the phone', () => {
    const b = bed({ kind: 'icloud' });
    put(b.search, 'pouch-down-backup-skew.json', backupText({ exportedAt: '2026-09-25T18:02:00.000Z' })); // 2 min ahead
    const r = run(b);

    expect(r.rejected).toEqual([]);
    expect(r.ingested).toHaveLength(1);
  });

  it('never lets a future-dated file already in the vault pin the note', () => {
    const b = bed({ kind: 'icloud' });
    fs.mkdirSync(b.archiveDir, { recursive: true });
    // Sorted by name, the future one comes first — the note must still read the real newest.
    put(b.archiveDir, '2026-09-25T17-00-00.000Z.json', backupText());
    put(b.archiveDir, '2027-01-01T00-00-00.000Z.json', backupText({ exportedAt: '2027-01-01T00:00:00.000Z' }));
    const r = run(b);

    expect(r.newest.exportedAt).toBe(EXPORTED);
    expect(fs.readFileSync(b.liveLog, 'utf8')).toMatch(/Data as of 2026-09-25/);
    expect(ls(b.archiveDir)).toEqual(['2026-09-25T17-00-00.000Z.json', '2027-01-01T00-00-00.000Z.json']); // nothing removed
  });
});

// A backup the app itself couldn't load has no business being filed as one.
// Filed, it would be re-read as the newest on every run and the note would
// stay frozen on it until someone deleted it by hand.
describe('a backup is checked against the app before it is filed', () => {
  const unreadable = () => backupText({ root: rootOf({ ...attempt, plan: null }) });

  it('refuses a backup the app could not load, and leaves it where it is', () => {
    const b = bed({ kind: 'icloud' });
    const file = put(b.search, 'pouch-down-backup-broken.json', unreadable());
    const r = run(b);

    expect(r.rejected).toEqual([{ file, reason: 'unreadable-root' }]);
    expect(r.ingested).toEqual([]);
    expect(fs.existsSync(file)).toBe(true);
    expect(ls(b.archiveDir)).toBe(null);
    expect(fs.existsSync(b.liveLog)).toBe(false);
  });

  it('does not let one filed by hand pin the note either', () => {
    const b = bed({ kind: 'icloud' });
    fs.mkdirSync(b.archiveDir, { recursive: true });
    put(b.archiveDir, '2026-09-25T17-00-00.000Z.json', backupText());
    put(b.archiveDir, '2026-09-25T19-00-00.000Z.json', unreadable()); // newer, and unusable
    const r = run(b);

    expect(r.newest.exportedAt).toBe(EXPORTED);
    expect(ls(b.archiveDir)).toHaveLength(2); // nothing removed
  });
});

// The Live Log is a vault note, and in the vault Markdown, code fences and
// Templater tags are live syntax. Anything that came out of a backup is data:
// it is rendered as words, through one helper, wherever it appears.
describe('safeText', () => {
  it('leaves ordinary text alone', () => {
    expect(safeText('after lunch')).toBe('after lunch');
    expect(safeText('2026-09-21')).toBe('2026-09-21');
    expect(safeText(9)).toBe('9');
  });

  it('has nothing to say about a missing value', () => {
    expect(safeText(null)).toBe('');
    expect(safeText(undefined)).toBe('');
  });

  it('neutralises the syntax a note would otherwise act on', () => {
    for (const bad of ['`', '```', '~~~', '<%', '%>', '<', '>', '|', '[[', ']]']) {
      const out = safeText(`label ${bad} tail`);
      expect(out).not.toContain(bad);
      expect(out).toContain('label');
      expect(out).toContain('tail');
    }
  });

  it('collapses newlines into one line', () => {
    expect(safeText('one\ntwo\r\n\tthree')).toBe('one two three');
    expect(safeText('  padded  ')).toBe('padded');
  });

  it('caps the length', () => {
    const out = safeText('z'.repeat(400));
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('the rendered note treats backup text as words', () => {
  const nasty = 'x ``` <% tp.file.include("@/secret") %> ~~~ | [[Some Note]]';
  const hostileStage = { ...plan, stages: plan.stages.map((s, i) => (i === 0 ? { ...s, name: nasty } : s)) };
  const hostile = {
    ...attempt,
    id: nasty,
    plan: hostileStage,
    events: [ev('pouch', '2026-09-21', { trigger: nasty }), ev('checkin', '2026-09-21', { sleepHours: nasty, sleepQuality: nasty })],
  };
  const md = () => renderLiveLog({ ...rootOf(hostile), activeAttemptId: nasty }, { exportedAt: EXPORTED, now: NOW });

  it('writes no fence, template tag or wikilink that the backup asked for', () => {
    const out = md();
    expect(out).not.toContain('```');
    expect(out).not.toContain('~~~');
    expect(out).not.toContain('<%');
    expect(out).not.toContain('%>');
    expect(out).not.toContain('[[Some Note]]');
    // Neutralised, not censored: the words still show, so James can see what the
    // backup actually said. It just isn't syntax the note acts on any more.
    expect(out).toContain('tp.file.include');
  });

  it('still builds the heading from fixed words plus the neutralised id', () => {
    expect(md()).toMatch(/^## Attempt x .* — active$/m);
  });

  it('still says the honest things about the attempt', () => {
    const out = md();
    expect(out).toMatch(/\*\*Streak:\*\* current \d+ · best \d+/);
    expect(out).toMatch(/\*\*Top triggers:\*\* x /);
    expect(out).toMatch(/\| 1 \| 2026-09-21 \|/);
  });
});

// One file with every bad property at once: it didn't arrive by AirDrop, it says
// it was exported in the future, its root is one the app couldn't load, and its
// free text is full of fences and template tags. Nothing about the vault moves.
describe('the hostile file walk', () => {
  const nasty = 'x ``` <% tp.file.include("@/secret") %> ~~~ | [[Some Note]]';
  const hostileText = () => backupText({
    exportedAt: '2030-01-01T00:00:00.000Z',
    root: rootOf({ ...attempt, id: nasty, status: nasty, plan: null, events: [ev('pouch', '2026-09-21', { trigger: nasty })] }),
  });
  const existingNote = '# Pouch Down — Live Log\n\nwritten by an earlier run\n';

  // The vault holds a note and an empty archive, so the only thing that could
  // rewrite the note is this file. (A run that finds a good backup re-renders
  // the note from that one every time — see the two tests after these.)
  const walk = (kind) => {
    const b = bed({ kind });
    fs.mkdirSync(b.archiveDir, { recursive: true });
    fs.writeFileSync(b.liveLog, existingNote);
    const file = put(b.search, 'pouch-down-backup-hostile.json', hostileText());
    const before = { note: fs.readFileSync(b.liveLog), archive: ls(b.archiveDir) };
    return { b, file, before, r: run(b) };
  };

  const stateIsUntouched = ({ b, file, before }) => {
    expect(fs.existsSync(file)).toBe(true); // the original is where it was
    expect(ls(b.archiveDir)).toEqual(before.archive); // nothing filed, nothing removed
    expect(fs.readFileSync(b.liveLog)).toEqual(before.note); // byte-identical
  };

  it('refuses it from ~/Downloads and changes nothing in the vault', () => {
    const w = walk('downloads');
    expect(w.r.rejected).toEqual([{ file: w.file, reason: 'untrusted-source' }]);
    expect(w.r.ingested).toEqual([]);
    expect(w.r.liveLog).toBe(null); // nothing to render from, so nothing written
    stateIsUntouched(w);
  });

  it('still refuses it from the trusted iCloud folder — no one gate does all the work', () => {
    const w = walk('icloud');
    expect(w.r.rejected).toEqual([{ file: w.file, reason: 'future-export' }]);
    expect(w.r.ingested).toEqual([]);
    expect(w.r.liveLog).toBe(null);
    stateIsUntouched(w);
  });

  it('leaves a good backup already in the vault untouched, and renders from it', () => {
    const b = bed({ kind: 'icloud' });
    fs.mkdirSync(b.archiveDir, { recursive: true });
    const good = put(b.archiveDir, '2026-09-25T17-00-00.000Z.json', backupText());
    const goodBytes = fs.readFileSync(good);
    const file = put(b.search, 'pouch-down-backup-hostile.json', hostileText());
    const r = run(b);

    expect(r.rejected).toEqual([{ file, reason: 'future-export' }]);
    expect(r.newest.exportedAt).toBe(EXPORTED); // not the hostile file's 2030 date
    expect(fs.readFileSync(good)).toEqual(goodBytes); // nothing overwritten
    expect(ls(b.archiveDir)).toEqual(['2026-09-25T17-00-00.000Z.json']);
    const note = fs.readFileSync(b.liveLog, 'utf8');
    expect(note).toContain('## Attempt a2 — active');
    expect(note).not.toContain('tp.file'); // not one word of it reached the note
  });

  it('says which file it refused and why, and nothing else about it', () => {
    const b = bed();
    const file = put(b.search, 'pouch-down-backup-hostile.json', hostileText());
    const lines = [];
    run(b, { log: (line) => lines.push(line) });

    expect(lines).toEqual([`refused  ${file}: untrusted-source — left where it is`]);
    expect(lines.join('\n')).not.toContain('tp.file');
  });
});

// A refusal James never hears about is the same failure as a silent day in the
// app: it reads as "nothing arrived" when something did.
describe('a refusal is reported, not swallowed', () => {
  it('counts refused files in the summary', () => {
    const b = bed();
    put(b.search, 'pouch-down-backup-1.json', backupText());
    const lines = summaryLines(run(b));

    expect(lines[0]).toBe('Ingested: nothing new (1 refused)');
  });

  it('makes the watcher log a run whose only news is a refusal', async () => {
    // Watcher mode for real, so the "was there any news?" gate is the thing under
    // test. The vault already holds a fresh backup, so this run has nothing to
    // send and nothing to re-render: without the refusal there'd be no news at
    // all, and the log would stay silent about a backup that never arrived.
    const b = bed();
    fs.mkdirSync(b.archiveDir, { recursive: true });
    put(b.archiveDir, '2026-09-25T17-00-00.000Z.json', backupText());
    const env = { POUCH_BACKUP_DIR: b.backupDir, POUCH_SEARCH_DIRS: b.search, POUCH_INGEST_STATE: path.join(tmp, 'state.json') };
    // Clock and provenance are injected, so this never asks the OS about a file.
    const opts = { now: NOW, provenance: () => null };
    const said = [];
    const log = console.log;
    console.log = (...a) => said.push(a.join(' '));
    let code;
    try {
      await main(['--notify'], env, opts); // writes the note for the first time
      said.length = 0;
      put(b.search, 'pouch-down-backup-1.json', backupText());
      code = await main(['--notify'], env, opts);
    } finally {
      console.log = log;
    }
    expect(code).toBe(0);
    expect(said.join('\n')).toMatch(/refused .*pouch-down-backup-1\.json: untrusted-source/);
    expect(said.join('\n')).toContain('nothing new (1 refused)');
    expect(said.join('\n')).toContain('Live Log unchanged'); // the refusal was the only news
  });
});
