// Proves the app fails SAFE when what's stored on the phone can't be read. The
// recovery screen is the one place the app admits it doesn't understand its own
// data, and the rule there is absolute: until James says "start fresh", the app
// writes NOTHING. Not v2 (it might be the only copy of his history), never v1
// (the rollback), and no stray key of its own either. The spec (§10) says
// "do not overwrite"; this walk is the proof, byte for byte.
//
// What the unit suite cannot see, and this walk does:
//   · the real boot routes unreadable storage to the recovery screen, with copy
//     for THAT cause ("couldn't read" vs "couldn't move your old data");
//   · both keys come out byte-identical after the first load, after a reload,
//     and after "Download what's stored" — and the key LIST doesn't change;
//   · the download is the raw stored text with the API key blanked — even when
//     the text is cut off halfway through the key — and it says it's redacted;
//   · "Start fresh" copies the unreadable bytes aside before writing, brings
//     Attempt 1 back from v1, and refuses to go on (until a download exists)
//     when the copy aside can't be made because storage is full;
//   · the confirm says, in plain words, what will happen — no "v2", no
//     "storage key".
//
// Eight browser contexts, each on a PINNED clock (Mon 2026-09-21 20:00,
// America/Chicago). A fake key (`sk-ant-FAKE-E2E-KEY`) is planted in v1's
// settings and, wherever v2 still says `apiKey`, in v2's device — so every
// payload has something to leak:
//   A   v2 not JSON (a doubled comma), v1 readable   Download → reload → Start
//                                                    fresh → Front door with
//                                                    Attempt 1; the rescue key
//                                                    holds the corrupt bytes.
//   B   v2 cut off mid-way through the API key       the redaction must blank a
//                                                    key that never closes.
//   C1  v2 valid JSON, version 3                     wrong shape #1.
//   C2  v2 `attempts` is an object; no v1 at all     wrong shape #2.
//   C3  v2 attempt has no `plan`; v1 parses but      wrong shape #3, and the
//       isn't a v1 state                             "older history stays" copy.
//   D   v1 unreadable, no v2                         the migration-failed cause;
//                                                    Start fresh → a root marked
//                                                    legacyV1 'unread' → setup.
//   Q   like A (v2 behind a byte-order mark), but    Yes, start fresh must stop
//       setItem throws QuotaExceededError for        and ask for a download; once
//       `pouch-down-v2-corrupt*` keys                there is one, it may go on.
//                                                    And the confirm must stop
//                                                    saying the data is "set
//                                                    aside on this phone" — it
//                                                    isn't; the file is the only
//                                                    copy.
//   Q2  storage full again, but James downloads     the app must still stop
//       BEFORE tapping Yes (as the confirm advises)  once and say the copy is the
//                                                    only one, then go on.
// B, C1–C3 open the confirm and back out with "Not yet" — which must write
// nothing either.
//
// Every fixture is checked in Node before any browser starts (`--dry` runs just
// these): the unreadable ones really are unreadable, loadRoot really lands on
// the cause the context claims, and the expected payload was worked out from
// the fixture itself (the same text built with a blank key), not by running the
// app's own redactSecrets — so a redaction bug can't grade its own homework.
//
// Synthetic data only (scripts/e2e/seed-v1.mjs), seeded exactly once per
// context by lib.mjs. `pouch-down-v1` must be byte-identical (or still absent)
// at the end of every context — it is the rollback, and nothing in the app may
// ever write it.
//
// Usage: node scripts/e2e/walk-recovery.mjs [--dist DIR] [--out DIR] [--port N] [--keep] [--dry]
import { chromium } from 'playwright-core';
import * as e2e from './lib.mjs';
import { seedV1 } from './seed-v1.mjs';
import { loadRoot, freshStartRoot } from '../../src/root.js';

const args = e2e.parseArgs({ name: 'walk-recovery', port: 4337 });
const TZ = 'America/Chicago';
const NOW = '2026-09-21T20:00:00-05:00';
const NOW_ISO = new Date(NOW).toISOString(); // 2026-09-22T01:00:00.000Z
const APP_DAY = '2026-09-21'; // 20:00 Monday in Chicago is Monday's app day
// Literal names, not the app's constants: if the app renamed a key, this walk
// should notice rather than follow it.
const K1 = 'pouch-down-v1';
const K2 = 'pouch-down-v2';
const RESCUE = 'pouch-down-v2-corrupt-';
// preserveCorruptV2 stamps the rescue key with the UTC second it ran.
const RESCUE_AT = `${RESCUE}${NOW_ISO.slice(0, 13).replace('T', '-')}-`; // …-2026-09-22-01-

const FAKE_KEY = 'sk-ant-FAKE-E2E-KEY'; // never a real key — the point is that it must not leak

/* ------------------------------------------------------------------ fixture */

// A throwaway Storage, so Node can ask the app's loaders what a fixture means.
const memStorage = (entries) => {
  const m = new Map(Object.entries(entries).filter(([, v]) => v !== null && v !== undefined));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
};

// ONCE: seed-v1 numbers its event ids from a module-level counter, so a second
// call would hand back a different history.
const V1 = seedV1();
const v1With = (apiKey) => ({ ...V1, settings: { ...V1.settings, apiKey } });

// Every fixture is a pair: the text stored, and the text the download must
// carry — built the same way with the key left blank.
const pair = (make, why) => ({ raw: make(FAKE_KEY), redacted: make(''), why });

// Attempt 1 exactly as the app builds it from v1 — the realistic body for the
// v2 fixtures, and what context A's Start fresh must bring back.
const MIGRATED = freshStartRoot(memStorage({ [K1]: JSON.stringify(v1With(FAKE_KEY)) }), NOW_ISO);
const rootWith = (apiKey) => ({ ...MIGRATED, device: { apiKey } }); // same key order as the app

const V1F = {
  readable: pair((k) => JSON.stringify(v1With(k)), 'synthetic 60-day v1, fake key in settings'),
  // Cut 60% of the way in: well past settings (so the whole key is in there),
  // mid-way through the events.
  truncated: (() => {
    const full = pair((k) => JSON.stringify(v1With(k)));
    const cut = Math.floor(full.raw.length * 0.6);
    return { raw: full.raw.slice(0, cut), redacted: full.redacted.slice(0, cut - FAKE_KEY.length), why: `v1 cut off at char ${cut} of ${full.raw.length}` };
  })(),
  notV1: pair((k) => JSON.stringify({ settings: { ...V1.settings, apiKey: k }, events: 'lost' }), 'parses, but events is a string'),
};

const V2F = {
  invalid: pair(
    (k) => JSON.stringify(rootWith(k)).replace('"activeAttemptId":null,', '"activeAttemptId":null,,"note":"café — ☕",'),
    'migrated root with a doubled comma (and some non-ASCII, so "byte-identical" means something)',
  ),
  // The device moved to the END, so the cut lands after all of Attempt 1 — a
  // write that died mid-key. Nothing after the cut; the key never closes.
  truncated: (() => {
    const s = JSON.stringify({ version: 2, activeAttemptId: null, attempts: MIGRATED.attempts, device: { apiKey: FAKE_KEY } });
    const at = s.indexOf(FAKE_KEY);
    return { raw: s.slice(0, at + 9), redacted: s.slice(0, at), why: `migrated root cut at char ${at + 9}, inside the key ("…${s.slice(at - 12, at + 9)}")` };
  })(),
  version3: pair((k) => JSON.stringify({ version: 3, device: { apiKey: k }, activeAttemptId: null, attempts: [] }), '{"version":3,…}'),
  attemptsObject: pair(
    (k) => JSON.stringify({ version: 2, device: { apiKey: k }, activeAttemptId: 'a1', attempts: { a1: { id: 'a1', status: 'active', events: [] } } }),
    'attempts is an object, not a list',
  ),
  noPlan: pair((k) => {
    const r = rootWith(k);
    const a1 = { ...r.attempts[0] };
    delete a1.plan;
    return JSON.stringify({ ...r, attempts: [a1] });
  }, 'migrated root whose Attempt 1 has no plan'),
  bom: pair((k) => `﻿${JSON.stringify(rootWith(k))}`, 'migrated root behind a byte-order mark'),
};

// cause: what loadRoot reports. next: which "Start fresh" the confirm must
// describe (what freshStartRoot would begin from). end: how the context ends.
const CONTEXTS = [
  { id: 'A', title: 'v2 is not JSON; v1 readable', v2: V2F.invalid, v1: V1F.readable, cause: 'corrupt', next: 'restore', end: 'start-fresh' },
  { id: 'B', title: 'v2 cut off mid-way through the API key', v2: V2F.truncated, v1: V1F.readable, cause: 'corrupt', next: 'restore', end: 'not-yet' },
  { id: 'C1', title: 'v2 is valid JSON, version 3', v2: V2F.version3, v1: V1F.readable, cause: 'corrupt', next: 'restore', end: 'not-yet' },
  { id: 'C2', title: 'v2 attempts is not a list; no v1', v2: V2F.attemptsObject, v1: null, cause: 'corrupt', next: 'plain', end: 'not-yet' },
  { id: 'C3', title: 'v2 attempt has no plan; v1 is not a v1 state', v2: V2F.noPlan, v1: V1F.notV1, cause: 'corrupt', next: 'unread', end: 'not-yet' },
  { id: 'D', title: 'v1 unreadable, no v2 — migration failed', v2: null, v1: V1F.truncated, cause: 'migration-failed', next: 'migration', end: 'start-fresh' },
  { id: 'Q', title: 'storage full — the copy aside is refused', v2: V2F.bom, v1: V1F.readable, cause: 'corrupt', next: 'restore', end: 'quota' },
  { id: 'Q2', title: 'storage full, downloaded BEFORE Yes', v2: V2F.invalid, v1: V1F.readable, cause: 'corrupt', next: 'restore', end: 'quota-late' },
];

const quota = (C) => C.end.startsWith('quota');
const seededOf = (C) => ({ [K1]: C.v1?.raw ?? null, [K2]: C.v2?.raw ?? null });
const seededKeys = (C) => Object.entries(seededOf(C)).filter(([, v]) => v !== null).map(([k]) => k).sort();

// The recovery screen's two causes, and what each confirm must say will happen.
const CAUSE = {
  corrupt: /couldn['’]t read what['’]s saved/i,
  'migration-failed': /couldn['’]t move your old data/i,
};
const NEXT = {
  restore: { say: [/first attempt comes back/i, /set aside/i, /not deleted/i], not: [/older history/i] },
  plain: { say: [/set aside/i, /not deleted/i], not: [/first attempt comes back/i, /older history/i] },
  unread: { say: [/set aside/i, /not deleted/i, /older history stays/i, /untouched/i], not: [/first attempt comes back/i] },
  migration: { say: [/old history stays on this phone/i, /untouched/i, /can['’]t read it/i], not: [/set aside/i, /first attempt comes back/i] },
};
// Words James shouldn't have to know. Checked on the whole screen, confirm open.
const JARGON = /\bv[0-9]\b|storage key|local ?storage|\bjson\b|\bpars(e|ing)\b|\bschema\b|pouch-down-|\bnull\b|undefined|\bNaN\b|\[object/i;

const STEPS = (C) => {
  const s = [
    `pin clock to ${NOW} (${TZ}); seed ${seededKeys(C).join(' + ') || 'nothing'}` + (quota(C) ? `; setItem throws QuotaExceededError for ${RESCUE}*` : ''),
    `boot → recovery screen, cause "${CAUSE[C.cause].source}"; keys + bytes unchanged`,
  ];
  if (C.end === 'quota') {
    s.push('reload → recovery again; unchanged');
    s.push(`Start fresh → confirm (${C.next}), plain words; unchanged`);
    s.push('Yes, start fresh → refused: alert asks for a download, Yes disabled, confirm stops saying "set aside on this phone"; v2 intact, no rescue key; a forced tap still does nothing');
    s.push("Download what's stored → clipboard payload (raw text, key blanked, says redacted); unchanged; Yes re-enabled; confirm says the file is the only copy");
    s.push('Yes, start fresh → Front door with Attempt 1; v1 intact');
  } else if (C.end === 'quota-late') {
    s.push('reload → recovery again; unchanged');
    s.push("Download what's stored → clipboard payload (raw text, key blanked, says redacted); unchanged");
    s.push(`Start fresh → confirm (${C.next}), plain words; unchanged`);
    s.push('Yes, start fresh → the copy aside is refused, so it STOPS once: says the copied text is the only copy, stops saying "set aside on this phone"; v2 intact, no rescue key');
    s.push('Yes, start fresh again → Front door with Attempt 1; v1 intact');
  } else {
    s.push("Download what's stored → clipboard payload (raw text, key blanked, says redacted); unchanged");
    s.push('reload → recovery again; unchanged');
    s.push(`Start fresh → confirm (${C.next}), plain words; unchanged`);
    if (C.end === 'not-yet') s.push('Not yet → back to the recovery screen; unchanged');
    if (C.id === 'A') s.push(`Yes, start fresh → Front door, Attempt 1 archived and rebuilt from v1; ${RESCUE}* holds the corrupt bytes exactly; reload stays put`);
    if (C.id === 'D') s.push("Yes, start fresh → setup; v2 = empty root marked legacyV1 'unread'; no rescue key; reload stays put");
  }
  s.push('pouch-down-v1 byte-identical' + (C.v1 ? '' : ' (still absent)'));
  return s;
};

/* ------------------------------------------------ fixtures vs the app (no browser) */

const parses = (s) => { try { JSON.parse(s); return true; } catch { return false; } };

function fixtureChecks(rec) {
  rec.section('fixtures vs loadRoot / freshStartRoot (no browser)');
  for (const C of CONTEXTS) {
    const L = (s) => `${C.id} fixture: ${s}`;
    const got = loadRoot(memStorage(seededOf(C)), NOW_ISO);
    rec.check(L(`loadRoot reports '${C.cause}'`), got.problem === C.cause, `got ${got.problem}`);
    for (const [name, f] of [['v2', C.v2], ['v1', C.v1]]) {
      if (!f) continue;
      // A key cut off after 9 chars is still a leak of those 9 chars.
      const leak = f.raw.includes(FAKE_KEY) || /sk-ant-FA$/.test(f.raw);
      rec.check(L(`${name} carries the fake key (something to leak)`), leak);
      rec.check(L(`${name} expected payload has no key in it`), !/sk-ant-/.test(f.redacted) && f.redacted.length < f.raw.length);
    }
    const next = freshStartRoot(memStorage(seededOf(C)), NOW_ISO);
    const kind = next.legacyV1 === 'unread' ? (C.cause === 'migration-failed' ? 'migration' : 'unread') : next.attempts.length ? 'restore' : 'plain';
    rec.check(L(`Start fresh would begin from '${C.next}'`), kind === C.next, `freshStartRoot → ${kind}`);
  }
  rec.check('A fixture: v2 is not JSON', !parses(V2F.invalid.raw));
  rec.check('B fixture: v2 is not JSON and ends inside the key', !parses(V2F.truncated.raw) && V2F.truncated.raw.endsWith(`"apiKey":"${FAKE_KEY.slice(0, 9)}`));
  for (const C of CONTEXTS.filter((c) => c.id.startsWith('C'))) rec.check(`${C.id} fixture: v2 IS valid JSON (wrong shape, not broken text)`, parses(C.v2.raw));
  rec.check('D fixture: v1 is not JSON, v2 absent', !parses(V1F.truncated.raw) && CONTEXTS.find((c) => c.id === 'D').v2 === null);
  rec.check('Q fixture: v2 is not JSON only because of the byte-order mark', !parses(V2F.bom.raw) && parses(V2F.bom.raw.slice(1)));
  rec.check('A/Q expected restore: Attempt 1 archived with every synthetic v1 event',
    MIGRATED.attempts.length === 1 && MIGRATED.attempts[0].status === 'archived' && MIGRATED.attempts[0].events.length === V1.events.length,
    `${MIGRATED.attempts[0]?.events.length} of ${V1.events.length} events`);
}

/* ------------------------------------------------------------- the walk */

const visible = (loc, timeout = 5000) => loc.first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
const heading = (p) => p.getByRole('heading', { name: /your data is still here/i });
const button = (p, rx) => p.getByRole('button', { name: rx });
const DOWNLOAD = /download what['’]s stored/i;
const COPIED = /copied/i;
const START = /^start fresh$/i;
const YES = /^yes, start fresh$/i;
const NOT_YET = /^not yet$/i;

// Everything in localStorage, as the page sees it.
const storageOf = (p) => p.evaluate(() => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    o[k] = localStorage.getItem(k);
  }
  return o;
});

const firstDiff = (a, b) => {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
};
const differ = (got, want) =>
  got === want ? '' : got === null ? 'KEY IS GONE' : want === null ? `key appeared (${got.length} chars)`
    : `differs at char ${firstDiff(got, want)} (${got.length} vs ${want.length} chars)`;

// The core promise of the recovery screen: nothing added, nothing removed,
// nothing rewritten.
function untouched(rec, L, stage, got, C) {
  const want = seededKeys(C);
  const keys = Object.keys(got).sort();
  const added = keys.filter((k) => !want.includes(k));
  const removed = want.filter((k) => !keys.includes(k));
  rec.check(L(`${stage}: key list unchanged`), !added.length && !removed.length,
    [added.length && `added ${added.join(', ')}`, removed.length && `removed ${removed.join(', ')}`].filter(Boolean).join('; '));
  const v2 = got[K2] ?? null;
  const v1 = got[K1] ?? null;
  rec.check(L(`${stage}: ${K2} ${C.v2 ? 'byte-identical' : 'still absent'}`), v2 === (C.v2?.raw ?? null), differ(v2, C.v2?.raw ?? null));
  rec.check(L(`${stage}: ${K1} ${C.v1 ? 'byte-identical' : 'still absent'}`), v1 === (C.v1?.raw ?? null), differ(v1, C.v1?.raw ?? null));
}

async function onRecovery(page, rec, L, stage, C) {
  const up = await visible(heading(page), 8000);
  const text = await e2e.bodyText(page);
  rec.check(L(`${stage}: recovery screen shown`), up, up ? '' : text.slice(0, 90).replace(/\n/g, ' | '));
  const other = Object.entries(CAUSE).find(([k]) => k !== C.cause)[1];
  rec.check(L(`${stage}: says the cause is ${C.cause}`), CAUSE[C.cause].test(text) && !other.test(text),
    text.split('\n').find((l) => /couldn/i.test(l))?.slice(0, 90) ?? 'no "couldn\'t" line');
  // Nothing may be saved while this screen is up — give the app's effects and
  // its 1s tick a chance to prove otherwise before reading storage.
  await page.waitForTimeout(1200);
}

// "Download what's stored". phoneContext's canShare says no, so the app takes
// its clipboard route; the stub keeps every copy in window.__clipboardLog.
async function download(page, rec, L, C) {
  const tapped = await visible(button(page, DOWNLOAD), 3000);
  rec.check(L(`"Download what's stored" is offered`), tapped);
  if (tapped) await button(page, DOWNLOAD).first().click();
  const done = await visible(button(page, COPIED), 4000);
  rec.check(L('download: the button says it was copied'), done);
  const cap = await page.evaluate(() => ({ last: window.__clipboard, n: window.__clipboardLog?.length ?? 0, shares: window.__shares?.length ?? 0 }));
  rec.check(L('download: one copy to the clipboard, no share'), cap.n === 1 && cap.shares === 0, `${cap.n} copies, ${cap.shares} shares`);
  const text = cap.last ?? '';
  let dump = null;
  try { dump = JSON.parse(text); } catch { /* checked below */ }
  rec.check(L('payload is readable JSON'), !!dump, dump ? '' : text.slice(0, 60).replace(/\s+/g, ' '));
  const v2 = dump?.keys?.[K2];
  const v1 = dump?.keys?.[K1];
  rec.check(L(`payload: ${K2} is the raw stored text, key blanked`), v2 === (C.v2?.redacted ?? null),
    typeof v2 === 'string' && C.v2 ? differ(v2, C.v2.redacted) : `got ${JSON.stringify(v2)?.slice(0, 40)}`);
  rec.check(L(`payload: ${K1} is the raw stored text, key blanked`), v1 === (C.v1?.redacted ?? null),
    typeof v1 === 'string' && C.v1 ? differ(v1, C.v1.redacted) : `got ${JSON.stringify(v1)?.slice(0, 40)}`);
  const leak = text.includes(FAKE_KEY) || /sk-ant-(?!REDACTED)|FAKE-E2E/.test(text);
  rec.check(L(`payload: no ${FAKE_KEY}, not even part of it`), !!text && !leak, leak ? `…${text.slice(Math.max(0, text.search(/sk-ant-/) - 20), text.search(/sk-ant-/) + 30)}…` : '');
  rec.check(L('payload says it was redacted'), /redacted/i.test(text) && Array.isArray(dump?.redacted) && dump.redacted.includes('apiKey'),
    JSON.stringify(dump?.redacted));
  return text;
}

// The confirm card's words, whitespace squashed.
const CARD = (p) => p.locator('.card').filter({ hasText: /start a fresh attempt\?/i });
const cardText = async (p) => ((await CARD(p).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ');
// Once the copy aside has failed, nothing is set aside — a confirm that still
// says so is telling James his data is safe on the phone when it isn't.
const SET_ASIDE_CLAIM = /set aside on this phone/i;

async function openConfirm(page, rec, L, C) {
  const ask = await visible(button(page, START), 3000);
  rec.check(L('"Start fresh" is offered'), ask);
  if (ask) await button(page, START).first().click();
  const up = await visible(CARD(page), 4000);
  rec.check(L('Start fresh asks to confirm first'), up);
  await page.waitForTimeout(250);
  const copy = up ? await cardText(page) : '';
  const want = NEXT[C.next];
  const missing = want.say.filter((rx) => !rx.test(copy));
  const wrong = want.not.filter((rx) => rx.test(copy));
  rec.check(L(`confirm says what will happen (${C.next})`), up && !missing.length && !wrong.length,
    [missing.length && `missing ${missing.join(' ')}`, wrong.length && `wrongly says ${wrong.join(' ')}`, copy.slice(0, 160)].filter(Boolean).join(' — '));
  rec.check(L('confirm asks for a download first'), /download it first/i.test(copy), copy.slice(0, 80));
  const body = await e2e.bodyText(page);
  const j = body.match(JARGON);
  rec.check(L('no jargon on screen (v2, storage key, JSON…)'), !j, j ? `"${body.slice(Math.max(0, j.index - 30), j.index + 30).replace(/\n/g, ' ')}"` : '');
  return up;
}

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return undefined; } };

// After Start fresh lands on Attempt 1: the archived attempt must be the one
// v1 builds — every event, the legacy plan, the settings — not an empty shell.
function restoredCheck(rec, L, stored) {
  const root = parse(stored);
  const a = root?.attempts?.[0];
  const want = MIGRATED.attempts[0];
  const same = (k) => JSON.stringify(a?.[k]) === JSON.stringify(want[k]);
  rec.check(L(`${K2} rewritten as a readable root with Attempt 1 only`),
    root?.version === 2 && root.attempts?.length === 1 && root.activeAttemptId === null,
    root === undefined ? 'not JSON' : root === null ? 'absent' : `${root.attempts?.length} attempts, active ${root.activeAttemptId}`);
  rec.check(L('Attempt 1 is archived, rebuilt from v1'), a?.id === 'a1' && a.status === 'archived' && a.createdAt === want.createdAt, `${a?.id} ${a?.status}`);
  rec.check(L('Attempt 1 has every v1 event, unchanged'), same('events'), `${a?.events?.length} of ${want.events.length}`);
  rec.check(L('Attempt 1 keeps the legacy plan, settings, celebrations'), same('plan') && same('settings') && same('celebratedStages'));
  rec.check(L(`archived on today's app day (${APP_DAY})`), a?.archivedDay === APP_DAY, a?.archivedDay);
  // The key stays on the phone — it just never leaves it in a download.
  rec.check(L('the API key came back on the device'), root?.device?.apiKey === FAKE_KEY);
}

async function walkContext(browser, base, C, rec) {
  const L = (s) => `${C.id} ${s}`;
  rec.section(`${C.id} · ${C.title} — clock ${NOW} ${TZ}`);
  const ctx = await e2e.phoneContext(browser, { tz: TZ, now: NOW });
  if (quota(C)) {
    // Storage "full" for the rescue copy only: the app's own v2 save, and the
    // harness's seed, still go through. __quotaRefusals proves the app tried.
    await ctx.addInitScript(`
(() => {
  const real = Storage.prototype.setItem;
  window.__quotaRefusals = 0;
  Storage.prototype.setItem = function (k, v) {
    if (String(k).startsWith(${JSON.stringify(RESCUE.slice(0, -1))})) {
      window.__quotaRefusals++;
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    return real.call(this, k, v);
  };
})();
`);
  }
  await e2e.seedStorage(ctx, seededOf(C));
  const page = await ctx.newPage();
  const errors = e2e.watchErrors(page, C.id);
  let step = 'boot';
  const at = (s) => { step = s; };

  try {
    await page.goto(`${base}?static`, { waitUntil: 'domcontentloaded' });
    await onRecovery(page, rec, L, 'boot', C);
    const pageNow = await page.evaluate(() => Date.now());
    const drift = Math.round((pageNow - Date.parse(NOW)) / 1000);
    rec.check(L('page clock is pinned'), drift >= 0 && drift < 600, `${drift}s after ${NOW}`);
    await rec.snap(page, `${C.id}-recovery`);
    untouched(rec, L, 'after load', await storageOf(page), C);

    if (!quota(C)) {
      at('download');
      await download(page, rec, L, C);
      await rec.snap(page, `${C.id}-downloaded`);
      untouched(rec, L, 'after download', await storageOf(page), C);
    }

    at('reload');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await onRecovery(page, rec, L, 'reload', C);
    await rec.snap(page, `${C.id}-after-reload`);
    untouched(rec, L, 'after reload', await storageOf(page), C);

    if (C.end === 'quota-late') {
      // Downloaded first, as the confirm itself advises — so the React state
      // already knows there's a copy when the rescue fails.
      at('download');
      await download(page, rec, L, C);
      await rec.snap(page, `${C.id}-downloaded`);
      untouched(rec, L, 'after download', await storageOf(page), C);
    }

    at('confirm');
    const confirming = await openConfirm(page, rec, L, C);
    await rec.snap(page, `${C.id}-confirm`);
    untouched(rec, L, 'confirm open', await storageOf(page), C);

    if (C.end === 'not-yet') {
      at('not yet');
      await button(page, NOT_YET).first().click();
      const back = await visible(button(page, START), 3000);
      rec.check(L('"Not yet" goes back to the recovery screen'), back && !(await visible(button(page, YES), 300)));
      await page.waitForTimeout(400);
      await rec.snap(page, `${C.id}-not-yet`);
      untouched(rec, L, 'after Not yet', await storageOf(page), C);
    }

    if (C.end === 'quota' && confirming) {
      at('yes, refused');
      await button(page, YES).first().click();
      const alert = page.getByRole('alert').filter({ hasText: /download it first/i });
      const warned = await visible(alert, 3000);
      await page.waitForTimeout(400);
      await rec.snap(page, `${C.id}-refused`);
      const tried = await page.evaluate(() => window.__quotaRefusals);
      rec.check(L('the app tried to copy the bytes aside (and storage refused)'), tried >= 1, `${tried} refused writes`);
      rec.check(L('says it could not keep a copy: download first'), warned);
      rec.check(L('Yes, start fresh is disabled until a download'), await button(page, YES).first().isDisabled().catch(() => false));
      rec.check(L('still on the recovery screen'), await visible(heading(page), 500));
      const refusedCopy = await cardText(page);
      rec.check(L('refused: confirm no longer claims the data is set aside on this phone'), !!refusedCopy && !SET_ASIDE_CLAIM.test(refusedCopy),
        refusedCopy.slice(0, 160));
      untouched(rec, L, 'after the refused Yes', await storageOf(page), C);
      // A disabled button fires no click; forcing one proves the guard isn't
      // just the button's opacity.
      await button(page, YES).first().click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
      untouched(rec, L, 'after a forced tap', await storageOf(page), C);

      at('download');
      await download(page, rec, L, C);
      untouched(rec, L, 'after download', await storageOf(page), C);
      rec.check(L('Yes, start fresh is enabled once downloaded'), await button(page, YES).first().isEnabled().catch(() => false));
      await rec.snap(page, `${C.id}-downloaded`);
      // With no copy on the phone, the file James just saved is the only one.
      const lastCopy = await cardText(page);
      rec.check(L('downloaded: confirm no longer claims the data is set aside on this phone'), !!lastCopy && !SET_ASIDE_CLAIM.test(lastCopy),
        lastCopy.slice(0, 160));
      rec.check(L('downloaded: confirm says the saved file is the only copy'), /\bonly (copy|one)\b/i.test(lastCopy), lastCopy.slice(0, 160));
    }

    if (C.end === 'quota-late' && confirming) {
      // The rescue fails on this tap. A download already exists, but James was
      // just told his data is "set aside on this phone" — so the app must stop
      // once and say the copied text is now the only copy, not write over v2.
      at('yes, stopped once');
      await button(page, YES).first().click();
      const alert = page.getByRole('alert').filter({ hasText: /\bonly (copy|one)\b/i });
      const warned = await visible(alert, 3000);
      await page.waitForTimeout(400);
      await rec.snap(page, `${C.id}-stopped-once`);
      const tried = await page.evaluate(() => window.__quotaRefusals);
      rec.check(L('the app tried to copy the bytes aside (and storage refused)'), tried >= 1, `${tried} refused writes`);
      rec.check(L('first Yes stops: still on the recovery screen'), await visible(heading(page), 500));
      rec.check(L('says the copied text is the only copy'), warned);
      const copy = await cardText(page);
      rec.check(L('confirm no longer claims the data is set aside on this phone'), !!copy && !SET_ASIDE_CLAIM.test(copy), copy.slice(0, 160));
      rec.check(L('Yes stays enabled (the download exists)'), await button(page, YES).first().isEnabled().catch(() => false));
      untouched(rec, L, 'after the first Yes', await storageOf(page), C);
    }

    if ((C.id === 'A' || quota(C)) && confirming) {
      at('yes, start fresh');
      await button(page, YES).first().click();
      const door = await visible(button(page, /start a new attempt/i), 6000);
      await page.waitForTimeout(400);
      await rec.snap(page, `${C.id}-front-door`);
      rec.check(L('Start fresh lands on the Front door'), door && !(await visible(heading(page), 200)));
      rec.check(L('Attempt 1 listed as a past attempt'), await visible(button(page, /attempt 1\b/i), 2000));
      const got = await storageOf(page);
      restoredCheck(rec, L, got[K2]);
      rec.check(L(`${K1} byte-identical after Start fresh`), got[K1] === C.v1.raw, differ(got[K1] ?? null, C.v1.raw));
      const rescues = Object.keys(got).filter((k) => k.startsWith(RESCUE));
      const others = Object.keys(got).filter((k) => ![K1, K2].includes(k) && !k.startsWith(RESCUE));
      rec.check(L('no other key written'), !others.length, others.join(', '));
      if (quota(C)) {
        rec.check(L('no rescue key (storage refused it; the download is the copy)'), !rescues.length, rescues.join(', '));
      } else {
        rec.check(L(`exactly one ${RESCUE}* key, stamped with the pinned time`), rescues.length === 1 && rescues[0].startsWith(RESCUE_AT), rescues.join(', ') || 'none');
        rec.check(L('the rescue key holds the corrupt bytes exactly'), rescues.length === 1 && got[rescues[0]] === C.v2.raw,
          rescues.length === 1 ? differ(got[rescues[0]], C.v2.raw) : '');

        at('reload after start fresh');
        await page.reload({ waitUntil: 'domcontentloaded' });
        const still = await visible(button(page, /start a new attempt/i), 6000);
        await page.waitForTimeout(400);
        await rec.snap(page, `${C.id}-front-door-after-reload`);
        rec.check(L('reload: still the Front door, not recovery'), still && !(await visible(heading(page), 200)));
        const again = await storageOf(page);
        rec.check(L('reload: rescue key still there, same bytes'), rescues.length === 1 && again[rescues[0]] === C.v2.raw);
        rec.check(L('reload: same keys as straight after Start fresh'), JSON.stringify(Object.keys(again).sort()) === JSON.stringify(Object.keys(got).sort()),
          Object.keys(again).sort().join(', '));
      }
    }

    if (C.id === 'D' && confirming) {
      at('yes, start fresh');
      await button(page, YES).first().click();
      const setup = await visible(page.locator('#setup-count'), 6000);
      await page.waitForTimeout(400);
      await rec.snap(page, `${C.id}-setup`);
      rec.check(L('Start fresh lands in setup (nothing to go back to)'), setup && !(await visible(heading(page), 200)));
      const got = await storageOf(page);
      const root = parse(got[K2]);
      rec.check(L(`${K2} is an empty root marked legacyV1 'unread'`),
        root?.version === 2 && Array.isArray(root.attempts) && root.attempts.length === 0 && root.activeAttemptId === null && root.legacyV1 === 'unread',
        root === undefined ? 'not JSON' : root === null ? 'absent' : JSON.stringify(root).slice(0, 120));
      rec.check(L(`${K1} byte-identical after Start fresh`), got[K1] === C.v1.raw, differ(got[K1] ?? null, C.v1.raw));
      const added = Object.keys(got).filter((k) => !seededKeys(C).includes(k));
      rec.check(L(`only ${K2} was added (no rescue — there was no v2 to rescue)`), JSON.stringify(added) === JSON.stringify([K2]), added.join(', '));

      at('reload after start fresh');
      await page.reload({ waitUntil: 'domcontentloaded' });
      const still = await visible(page.locator('#setup-count'), 6000);
      await rec.snap(page, `${C.id}-setup-after-reload`);
      rec.check(L('reload: setup again, not recovery'), still && !(await visible(heading(page), 200)));
      rec.check(L("reload: still marked legacyV1 'unread'"), parse(await e2e.readStorage(page, K2))?.legacyV1 === 'unread');
    }
  } catch (e) {
    rec.check(L(`walk reached the end (stalled at: ${step})`), false, String(e?.message ?? e).split('\n')[0]);
    await rec.snap(page, `${C.id}-stalled`);
  }

  await e2e.v1Unchanged(page, C.v1?.raw ?? null, rec, `${C.id}, end of context`);
  if (!args.keep) await ctx.close();
  // No console whitelist, not even in Q. The one real failure path Q drives —
  // the copy aside refused by a full storage — is handled without a log:
  // preserveCorruptV2 swallows the QuotaExceededError and returns false, and
  // the screen says so in words. (RecoveryScreen's console.error calls fire
  // only if the download itself or the re-read of storage throws, which no
  // context here provokes.) So a console error anywhere in this walk, Q
  // included, is unexpected and fails the run.
  return errors;
}

/* ------------------------------------------------------------------ main */

e2e.run(async () => {
  const rec = e2e.createRecorder(args.out);

  if (args.dry) {
    console.log(`\nfake key: ${FAKE_KEY} — planted in v1 settings.apiKey and v2 device.apiKey`);
    const show = (f) => (f ? `${f.raw.length} chars — ${f.why}\n        starts ${JSON.stringify(f.raw.slice(0, 48))}… ends …${JSON.stringify(f.raw.slice(-28))}` : 'absent');
    for (const C of CONTEXTS) {
      console.log(`\n${C.id} · ${C.title} — port ${args.port}, clock ${NOW} ${TZ}`);
      console.log(`  v2: ${show(C.v2)}`);
      console.log(`  v1: ${show(C.v1)}`);
      STEPS(C).forEach((s, k) => console.log(`  ${String(k + 1).padStart(2)}. ${s}`));
    }
    fixtureChecks(rec);
    return e2e.finish(rec);
  }

  fixtureChecks(rec);
  const dist = args.dist ?? (await e2e.buildApp(`${args.out}/build`));
  const { base } = await e2e.startPreview({ dist, port: args.port });
  const browser = await chromium.launch();
  const errors = [];
  for (const C of CONTEXTS) errors.push(await walkContext(browser, base, C, rec));
  if (!args.keep) await browser.close();
  return e2e.finish(rec, errors);
});
