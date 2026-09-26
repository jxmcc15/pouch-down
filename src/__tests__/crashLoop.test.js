import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary, { CrashScreen } from '../components/ErrorBoundary.jsx';
import {
  KEY_V1,
  KEY_V2,
  DEFAULT_SETTINGS,
  BOOT_CRASH_KEY,
  bootCrashSeen,
  markBootCrash,
  clearBootCrash,
  startFreshFromCrash,
} from '../root.js';

const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _m: m,
  };
};

const V1 = JSON.stringify({
  version: 1,
  settings: { ...DEFAULT_SETTINGS, apiKey: 'sk-ant-TEST' },
  events: [{ id: 'e1', ts: '2026-07-08T11:42:07.123Z', type: 'pouch', trigger: null }],
});

const boundary = (crashed) => {
  const b = new ErrorBoundary({ children: 'fine' });
  if (crashed) b.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
  return b;
};

// A crash that comes from the stored data itself crashed again the moment the
// user reloaded: same boot, same render, same crash screen, no way out but
// clearing storage by hand. The marker is what tells the second boot that the
// first one already failed, so it can offer the recovery path instead.
describe('the boot-crash marker', () => {
  beforeEach(() => { globalThis.sessionStorage = mem(); });
  afterEach(() => { delete globalThis.sessionStorage; });

  it('starts unset, is set by a crash, and is cleared again', () => {
    expect(bootCrashSeen()).toBe(false);
    markBootCrash();
    expect(globalThis.sessionStorage.getItem(BOOT_CRASH_KEY)).toBeTruthy();
    expect(bootCrashSeen()).toBe(true);
    clearBootCrash();
    expect(bootCrashSeen()).toBe(false);
  });

  it('lives in sessionStorage, and never touches either localStorage key', () => {
    markBootCrash();
    expect([...globalThis.sessionStorage._m.keys()]).toEqual([BOOT_CRASH_KEY]);
    expect(BOOT_CRASH_KEY).not.toBe(KEY_V1);
    expect(BOOT_CRASH_KEY).not.toBe(KEY_V2);
  });

  // Safari with site data blocked throws on the property itself, and private
  // mode throws on the write. Neither may take down the crash screen — the one
  // screen whose whole job is to still work when nothing else does.
  it('survives a storage that throws on every touch', () => {
    const boom = () => { throw new Error('SecurityError'); };
    globalThis.sessionStorage = { getItem: boom, setItem: boom, removeItem: boom };
    expect(() => markBootCrash()).not.toThrow();
    expect(() => clearBootCrash()).not.toThrow();
    expect(bootCrashSeen()).toBe(false);
  });

  it('survives no sessionStorage at all', () => {
    delete globalThis.sessionStorage;
    expect(() => markBootCrash()).not.toThrow();
    expect(bootCrashSeen()).toBe(false);
  });
});

describe('ErrorBoundary across two boots', () => {
  beforeEach(() => { globalThis.sessionStorage = mem(); });
  afterEach(() => { delete globalThis.sessionStorage; });

  it('a crash records the marker for the next boot', () => {
    const b = boundary(true);
    b.componentDidCatch(new Error('boom'), { componentStack: '' });
    expect(bootCrashSeen()).toBe(true);
  });

  it('a successful render clears the marker', () => {
    markBootCrash();
    const b = boundary(false);
    b.componentDidMount();
    expect(bootCrashSeen()).toBe(false);
  });

  it('a crash does not clear the marker it just recorded', () => {
    const b = boundary(true);
    b.componentDidCatch(new Error('boom'), { componentStack: '' });
    b.componentDidMount(); // React commits the fallback, so this runs too
    expect(bootCrashSeen()).toBe(true);
  });

  // The first crash is usually nothing — a reload sorts it out. Only the
  // second one in a row means the reload lands back on the same crash.
  it('the first crash of a session offers a reload, not a rewrite', () => {
    const first = boundary(true).render();
    expect(first.type).toBe(CrashScreen);
    expect(first.props.repeat).toBe(false);
  });

  it('a crash on a boot that already found a marker offers the recovery path', () => {
    markBootCrash();
    const again = boundary(true).render();
    expect(again.type).toBe(CrashScreen);
    expect(again.props.repeat).toBe(true);
  });

  // This boot got past the door, so whatever breaks later is a first crash —
  // a reload is still the honest thing to offer, not a rewrite.
  it('a boot that mounted fine treats a later crash as a first crash', () => {
    markBootCrash(); // left over from the boot before
    const b = boundary(false);
    b.componentDidMount();
    b.state = ErrorBoundary.getDerivedStateFromError(new Error('boom later'));
    expect(b.render().props.repeat).toBe(false);
  });

  it('the marker is read at construction, before this boot writes its own', () => {
    const b = boundary(false);
    markBootCrash(); // as this boot's own crash would
    b.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    expect(b.render().props.repeat).toBe(false);
  });
});

describe('the crash screen', () => {
  afterEach(() => { delete globalThis.localStorage; delete globalThis.sessionStorage; });

  it('a first crash says reload and offers nothing that writes', () => {
    const html = renderToStaticMarkup(createElement(CrashScreen, { repeat: false }));
    expect(html).toContain('Download what&#x27;s stored');
    expect(html).toContain('Reload');
    expect(html).not.toContain('Start fresh');
  });

  it('a repeat crash says so and offers start fresh alongside the download', () => {
    const html = renderToStaticMarkup(createElement(CrashScreen, { repeat: true }));
    expect(html).toContain('Download what&#x27;s stored');
    expect(html).toContain('Start fresh');
    expect(html).toMatch(/keeps happening|happened again/i);
    expect(html).not.toMatch(/James/);
  });

  it('rendering either version never touches storage', () => {
    const calls = [];
    globalThis.localStorage = { getItem: (k) => calls.push(['get', k]) && null, setItem: (k) => calls.push(['set', k]), removeItem: (k) => calls.push(['remove', k]) };
    renderToStaticMarkup(createElement(CrashScreen, { repeat: false }));
    renderToStaticMarkup(createElement(CrashScreen, { repeat: true }));
    expect(calls).toEqual([]);
  });
});

// Start fresh from the crash screen is the same path the recovery screen
// takes: copy what is stored aside, rebuild from v1, save, reload. v1 is the
// rollback and is never written and never deleted.
describe('startFreshFromCrash', () => {
  beforeEach(() => { globalThis.sessionStorage = mem(); });
  afterEach(() => { delete globalThis.sessionStorage; });

  it('copies the unreadable v2 aside, writes a fresh root, and leaves v1 byte-for-byte', () => {
    const s = mem({ [KEY_V1]: V1, [KEY_V2]: '{"version":2,"attempts":"broken"}' });
    expect(startFreshFromCrash(s, '2026-09-25T18:00:00.000Z')).toBe('started');
    expect(s.getItem(KEY_V1)).toBe(V1);
    const rescued = [...s._m.keys()].filter((k) => k.includes('-corrupt-'));
    expect(rescued).toHaveLength(1);
    expect(s.getItem(rescued[0])).toBe('{"version":2,"attempts":"broken"}');
    // attempt 1 comes back from v1, archived, with nothing active
    const next = JSON.parse(s.getItem(KEY_V2));
    expect(next.attempts.map((a) => [a.id, a.status])).toEqual([['a1', 'archived']]);
    expect(next.activeAttemptId).toBeNull();
  });

  it('never writes to the v1 key and never removes anything', () => {
    const writes = [];
    const removes = [];
    const base = mem({ [KEY_V1]: V1, [KEY_V2]: '{broken' });
    const s = {
      getItem: (k) => base.getItem(k),
      setItem: (k, v) => { writes.push(k); base.setItem(k, v); },
      removeItem: (k) => removes.push(k),
    };
    startFreshFromCrash(s, '2026-09-25T18:00:00.000Z');
    expect(writes).not.toContain(KEY_V1);
    expect(writes).toContain(KEY_V2);
    expect(removes).toEqual([]);
    expect(base.getItem(KEY_V1)).toBe(V1);
  });

  it('clears the boot-crash marker once it has started fresh', () => {
    markBootCrash();
    startFreshFromCrash(mem({ [KEY_V2]: '{broken' }), '2026-09-25T18:00:00.000Z');
    expect(bootCrashSeen()).toBe(false);
  });

  // A full quota means the copy aside did not land, so carrying on would write
  // over the only copy there is. It stops, and says why.
  it('stops when the copy aside could not be made', () => {
    const s = {
      getItem: (k) => (k === KEY_V2 ? '{broken' : null),
      setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; },
    };
    expect(startFreshFromCrash(s, '2026-09-25T18:00:00.000Z')).toBe('rescue-failed');
  });

  it('with force it goes ahead after the copy aside failed, and still leaves v1 alone', () => {
    const base = mem({ [KEY_V1]: V1, [KEY_V2]: '{broken' });
    let allowWrites = false;
    const s = {
      getItem: (k) => base.getItem(k),
      setItem: (k, v) => {
        if (!allowWrites && k !== KEY_V2) throw new Error('quota');
        base.setItem(k, v);
      },
    };
    expect(startFreshFromCrash(s, '2026-09-25T18:00:00.000Z', { force: true })).toBe('started');
    expect(base.getItem(KEY_V1)).toBe(V1);
    expect(JSON.parse(base.getItem(KEY_V2)).version).toBe(2);
    allowWrites = true;
  });

  it('a save that throws is reported, not swallowed', () => {
    const s = {
      getItem: () => null, // nothing to rescue
      setItem: () => { throw new Error('quota'); },
    };
    expect(startFreshFromCrash(s, '2026-09-25T18:00:00.000Z')).toBe('failed');
  });
});
