// What the page is allowed to load, and where its font comes from.
//
// The policy is a build-time <meta http-equiv>. Two things make that worth a
// test rather than a glance at the config:
//
//  1. It is invisible until it breaks. A directive that is too tight shows up
//     as a blank screen on James's phone, after a push, with no error anyone
//     reads. So the exact policy string is pinned here — widening it has to be
//     a deliberate edit to this file.
//  2. It only exists in `build`. Dev-mode hot reload needs inline script and a
//     websocket, so the plugin is `apply: 'build'` and dev stays unpoliced.
//     That asymmetry is easy to lose; it is asserted below.
//
// The font half is the same story from the other side: the policy says
// `font-src 'self'`, which is only honest if Inter is actually ours. These
// tests fail if the remote @import ever comes back, in the CSS or in the
// service worker's runtime cache.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../vite.config.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(REPO, p), 'utf8');

// The policy, spelled out. Written here independently of the config on
// purpose: if the two ever disagree, one of them is a mistake.
const EXPECTED =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self'; " +
  "font-src 'self'; " +
  "img-src 'self'; " +
  "connect-src 'self' https://api.anthropic.com; " +
  "worker-src 'self' blob:; " +
  "manifest-src 'self'; " +
  "base-uri 'self'; " +
  "object-src 'none'; " +
  "form-action 'self'; " +
  "frame-src 'none'";

const GOOGLE = /fonts\.(googleapis|gstatic)\.com/;

const plugins = (config.plugins ?? []).flat(Infinity).filter(Boolean);
const cspPlugin = plugins.find((p) => p.name === 'csp');

// transformIndexHtml may be a bare function or { order, handler }; accept both
// so a Vite upgrade that changes the idiom doesn't read as a policy failure.
const runTransform = (html) => {
  const hook = cspPlugin.transformIndexHtml;
  const fn = typeof hook === 'function' ? hook : hook.handler;
  const out = fn.call({}, html, { path: '/index.html', filename: 'index.html' });
  return typeof out === 'string' ? out : out.html;
};

const policyIn = (html) => {
  const m = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i.exec(html);
  return m ? m[1] : null;
};

const MINIMAL = '<!doctype html>\n<html lang="en">\n  <head>\n    <title>Pouch Down</title>\n  </head>\n  <body><div id="root"></div></body>\n</html>\n';

describe('the CSP plugin', () => {
  it('is in the plugin list and only applies to builds', () => {
    expect(cspPlugin, 'no plugin named "csp" in vite.config.js').toBeTruthy();
    // Dev needs inline script + a websocket. The policy must never be in dev.
    expect(cspPlugin.apply).toBe('build');
  });

  it('injects the meta tag into <head>', () => {
    const out = runTransform(MINIMAL);
    expect(policyIn(out)).not.toBeNull();
    // Before anything that could load: first thing in <head>.
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'));
    // It adds, it doesn't rewrite.
    expect(out).toContain('<div id="root"></div>');
  });

  it('leaves the charset declaration first, and well inside the first 1024 bytes', () => {
    const withCharset = MINIMAL.replace('<head>', '<head>\n    <meta charset="UTF-8" />');
    const out = runTransform(withCharset);
    expect(out.indexOf('charset')).toBeLessThan(out.indexOf('Content-Security-Policy'));
    expect(Buffer.byteLength(out.slice(0, out.indexOf('charset')))).toBeLessThan(1024);
    // Still ahead of anything that could fetch.
    expect(out.indexOf('Content-Security-Policy')).toBeLessThan(out.indexOf('<title>'));
  });

  it('ships exactly the reviewed policy', () => {
    expect(policyIn(runTransform(MINIMAL))).toBe(EXPECTED);
  });

  it('carries every directive the review asked for', () => {
    const policy = policyIn(runTransform(MINIMAL));
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-src 'none'",
      "manifest-src 'self'",
      "connect-src 'self' https://api.anthropic.com",
      "worker-src 'self' blob:",
    ]) {
      expect(policy, `missing ${directive}`).toContain(directive);
    }
  });

  it('allows api.anthropic.com and nothing else off-origin', () => {
    const policy = policyIn(runTransform(MINIMAL));
    const hosts = policy.match(/https?:\/\/[^\s;']+/g) ?? [];
    expect(hosts).toEqual(['https://api.anthropic.com']);
  });

  it('names no Google font origin', () => {
    expect(policyIn(runTransform(MINIMAL))).not.toMatch(GOOGLE);
  });

  it('never loosens style-src or script-src with unsafe-inline / unsafe-eval', () => {
    const policy = policyIn(runTransform(MINIMAL));
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
  });
});

describe('Inter is ours', () => {
  const css = read('src/index.css');

  it('the stylesheet no longer reaches out to Google', () => {
    expect(css).not.toMatch(GOOGLE);
    expect(css).not.toMatch(/@import/);
  });

  it('declares the variable face with the full weight range and swap', () => {
    expect(css).toContain('@font-face');
    expect(css).toMatch(/font-weight:\s*100 900/);
    expect(css).toMatch(/font-display:\s*swap/);
    expect(css).toMatch(/font-family:\s*'Inter'/);
  });

  it('points at the files with a relative url, so Vite fingerprints them', () => {
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/['"]/g, ''));
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(u.startsWith('./')).toBe(true);
      expect(u).toMatch(/\.woff2$/);
    }
  });

  it('the woff2 files are real woff2 files of a sane size', () => {
    const files = readdirSync(join(REPO, 'src/fonts')).filter((f) => f.endsWith('.woff2'));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const p = join(REPO, 'src/fonts', f);
      // Magic bytes: a woff2 begins "wOF2". A 404 page saved as .woff2 doesn't.
      expect(readFileSync(p).subarray(0, 4).toString('latin1'), `${f} is not a woff2`).toBe('wOF2');
      const { size } = statSync(p);
      expect(size).toBeGreaterThan(10_000);
      expect(size).toBeLessThan(500_000);
    }
  });

  it('ships the font licence next to the fonts', () => {
    const ofl = read('src/fonts/OFL.txt');
    expect(ofl).toContain('SIL OPEN FONT LICENSE');
    expect(ofl).toContain('Inter');
  });

  it('the service worker no longer runtime-caches a Google origin', () => {
    expect(read('vite.config.js')).not.toMatch(GOOGLE);
  });
});

// These only mean anything once `npm run build` has run. Skipped rather than
// faked when dist/ is absent: a green tick for a build that didn't happen is
// worse than an honest skip.
const DIST = join(REPO, 'dist');
const built = existsSync(join(DIST, 'index.html'));

describe.skipIf(!built)('the built app', () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

  it('carries the policy in dist/index.html', () => {
    expect(policyIn(readFileSync(join(DIST, 'index.html'), 'utf8'))).toBe(EXPECTED);
  });

  it('references no Google font origin anywhere in the bundle', () => {
    const offenders = walk(DIST).filter((f) => GOOGLE.test(readFileSync(f, 'latin1')));
    expect(offenders.map((f) => f.slice(DIST.length + 1))).toEqual([]);
  });

  it('emitted the fonts as local assets', () => {
    const fonts = walk(DIST).filter((f) => f.endsWith('.woff2'));
    expect(fonts.length).toBeGreaterThanOrEqual(2);
  });
});
