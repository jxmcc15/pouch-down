import { describe, it, expect, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary, { CrashScreen } from '../components/ErrorBoundary.jsx';

// Before this, a render crash was a white screen on every boot with no way
// out. The crash screen must work with nothing else working — and write nothing.
describe('ErrorBoundary', () => {
  afterEach(() => { delete globalThis.localStorage; });

  it('passes children straight through while nothing is wrong', () => {
    expect(renderToStaticMarkup(createElement(ErrorBoundary, null, createElement('p', null, 'fine')))).toBe('<p>fine</p>');
  });

  it('a caught error switches it to the crash screen', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('boom'))).toEqual({ crashed: true });
    const b = new ErrorBoundary({ children: 'fine' });
    b.state = ErrorBoundary.getDerivedStateFromError(new Error('boom'));
    expect(b.render().type).toBe(CrashScreen);
  });

  it('the crash screen says the log is safe and offers the two ways out', () => {
    const html = renderToStaticMarkup(createElement(CrashScreen));
    expect(html).toContain('Something broke on this screen. Your log is still safe on this phone.');
    expect(html).toContain('Download what&#x27;s stored');
    expect(html).toContain('Reload');
    expect(html).not.toMatch(/James/);
  });

  it('rendering the crash screen never touches storage', () => {
    const calls = [];
    globalThis.localStorage = { getItem: (k) => calls.push(['get', k]) && null, setItem: (k) => calls.push(['set', k]), removeItem: (k) => calls.push(['remove', k]) };
    renderToStaticMarkup(createElement(CrashScreen));
    expect(calls).toEqual([]);
  });
});
