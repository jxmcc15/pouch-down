// The trophy strip on Stats: a glance at the case, not the case. The choice of
// seals is pure (stripPicks); the card only draws it and opens the sheet.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const app = vi.hoisted(() => ({ state: null, readOnly: false, awards: [] }));
vi.mock('../state.jsx', () => ({ useApp: () => ({ state: app.state, readOnly: app.readOnly }) }));
vi.mock('../awards.js', () => ({ awardsFor: () => app.awards }));

const { stripPicks, TrophyStrip } = await import('../components/awards/TrophyCase.jsx');

const a = (id, earned, extra = {}) => ({ id, title: id, tier: 'bronze', earned, progress: 0, earnedOn: null, ...extra });

afterEach(() => { app.state = null; app.readOnly = false; app.awards = []; });

describe('stripPicks', () => {
  it('earned first, newest first, then the closest locked, up to max', () => {
    const awards = [
      a('old', true, { earnedOn: '2026-09-22' }), a('new', true, { earnedOn: '2026-09-25' }),
      a('far', false, { progress: 0.1 }), a('near', false, { progress: 0.8 }), a('mid', false, { progress: 0.5 }),
    ];
    const { shown, more } = stripPicks(awards, 4);
    expect(shown.map((x) => x.id)).toEqual(['new', 'old', 'near', 'mid']);
    expect(more).toBe(1);
  });

  it('an earned award with no date sorts after dated ones, never crashes', () => {
    const { shown } = stripPicks([a('undated', true), a('dated', true, { earnedOn: '2026-09-01' })], 6);
    expect(shown.map((x) => x.id)).toEqual(['dated', 'undated']);
  });

  it('fewer awards than max means nothing more', () => {
    expect(stripPicks([a('x', false)], 6)).toEqual({ shown: [a('x', false)], more: 0 });
  });

  it('ties break the same way every time: the bigger win first, the easier reach first', () => {
    const awards = [
      a('b-day', true, { earnedOn: '2026-09-25' }), a('g-day', true, { tier: 'gold', earnedOn: '2026-09-25' }),
      a('s-zero', false, { tier: 'silver' }), a('b-zero', false),
    ];
    const want = ['g-day', 'b-day', 'b-zero', 's-zero'];
    expect(stripPicks(awards, 6).shown.map((x) => x.id)).toEqual(want);
    expect(stripPicks([...awards].reverse(), 6).shown.map((x) => x.id)).toEqual(want);
  });

  it('a missing or junk progress reads as no progress, and the input is left alone', () => {
    const awards = [a('nan', false, { progress: Number.NaN }), a('some', false, { progress: 0.3 }), a('none', false, { progress: undefined })];
    const before = awards.map((x) => x.id);
    expect(stripPicks(awards, 1)).toEqual({ shown: [awards[1]], more: 2 });
    expect(awards.map((x) => x.id)).toEqual(before);
  });

  it('an empty case is an empty strip', () => {
    expect(stripPicks([], 6)).toEqual({ shown: [], more: 0 });
  });
});

describe('TrophyStrip', () => {
  const html = () => renderToStaticMarkup(createElement(TrophyStrip, { onOpen: () => {} }));

  it('renders nothing without an attempt', () => {
    expect(html()).toBe('');
  });

  it('is one button that names the count, keeps the walk\'s words, and seals that stay quiet', () => {
    app.state = {};
    app.awards = [
      a('showed-up', true, { earnedOn: '2026-09-22' }),
      ...Array.from({ length: 8 }, (_, i) => a(`streak-${i + 3}`, false, { progress: i / 10 })),
    ];
    const out = html();
    expect(out.match(/<button/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Trophy case: 1 of 9 earned. Open the trophy case."');
    expect(out).toContain('Trophy case');
    expect(out).toMatch(/>1(<!-- -->)? of (<!-- -->)?9</); // the visible count, not just the label
    expect(out).toContain('+3 more');
    expect(out).toContain('Earned by showing up and logging honestly.');
    // Six seals, all inside one aria-hidden group — the button already said it
    // all, and each seal would otherwise speak its own name.
    const [before, hidden] = out.split('aria-hidden="true" style="gap:8px');
    expect(before).not.toMatch(/role="img"/);
    expect(hidden.match(/<svg[^>]*role="img"/g)).toHaveLength(6);
  });

  it('a past attempt keeps its own intro line', () => {
    app.state = {};
    app.readOnly = true;
    app.awards = [a('showed-up', true, { earnedOn: '2026-09-22' })];
    const out = html();
    expect(out).toContain('What this attempt earned. It stands as it is.');
    expect(out).not.toContain('more');
  });
});
