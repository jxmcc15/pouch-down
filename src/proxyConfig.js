// Where the coach's Claude calls go, and what gets them in.
//
// COACH_PROXY is the base URL of a small Cloudflare Worker this person owns. The
// Worker holds the Anthropic API key, so the phone never has to: the app posts
// the same request body it has always posted, and the Worker forwards it. An
// empty COACH_PROXY means "no proxy configured" — every caller then falls back
// to today's direct call with the session key (sessionKey.js), which is the
// state the app ships in until the Worker is deployed. vite.config.js imports
// this same constant to widen the CSP's connect-src, so the URL is written once,
// here, and the policy can never drift from the code.
//
// The device token is a preference, not a secret of value. It says "this device
// is allowed to ask" and nothing else: it is rotatable in seconds at the Worker,
// and it cannot spend anything past the Worker's own clamps. So it sits in
// localStorage plainly and survives across sessions — being entered once per
// device instead of once per session is the entire feature. Anyone tempted to
// "protect" it later by holding it in memory only would buy nothing and spend
// the one thing it is for.
//
// No React in this file on purpose: it is a plain module that components read
// and subscribe to, so tests (and the api layer) can use it without a renderer.

export const COACH_PROXY = '';

export const DEVICE_TOKEN_KEY = 'pouch-down-device-token';

// The Worker mirrors the Claude API's path, so the same body posts to either.
export const MESSAGES_PATH = '/v1/messages';
export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export const hasProxy = () => COACH_PROXY.trim().length > 0;

// One slash between base and path, whichever way the base was written. Empty
// base → empty string, never a relative URL that would post to our own origin.
export function proxyUrl(path = MESSAGES_PATH, base = COACH_PROXY) {
  const root = (typeof base === 'string' ? base : '').trim().replace(/\/+$/, '');
  if (!root) return '';
  return `${root}${path.startsWith('/') ? '' : '/'}${path}`;
}

// The origin the CSP has to allow. Unparseable (or absent) gives '' so that a
// typo widens the policy for nothing rather than for something wrong.
export function proxyOrigin(base = COACH_PROXY) {
  const root = (typeof base === 'string' ? base : '').trim();
  if (!root) return '';
  try {
    return new URL(root).origin;
  } catch {
    return '';
  }
}

// ── the device token ────────────────────────────────────────────────────────
//
// Every touch of localStorage is guarded twice, the same way sessionKey.js
// guards sessionStorage: reaching the property can throw on its own (Safari with
// site data blocked) and so can each method (private mode, full quota). Either
// way the token still works for this session — it just won't survive a reload.
// Never a crash, never a dead coach.

let current = '';
const listeners = new Set();

function store() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// → this device's token, or '' when there isn't one. Reads through to storage
// while memory is empty, so no caller has to remember an init step.
export function getDeviceToken() {
  if (current) return current;
  try {
    current = store()?.getItem(DEVICE_TOKEN_KEY) ?? '';
  } catch {
    current = '';
  }
  return current;
}

// Set (or, with an empty value, drop) the token and tell everyone watching. It
// is trimmed because a pasted token nearly always arrives with whitespace, and
// anything that isn't a string is no token rather than a stringified surprise
// sent as a header.
export function setDeviceToken(value) {
  current = typeof value === 'string' ? value.trim() : '';
  try {
    const s = store();
    if (current) s?.setItem(DEVICE_TOKEN_KEY, current);
    else s?.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    // memory-only from here: the token holds for this page, not past a reload
  }
  for (const fn of listeners) fn(current);
}

export const clearDeviceToken = () => setDeviceToken('');

// subscribe(fn) → unsubscribe. fn is called with the new token on every change,
// never on subscribe — a component reads the current value with getDeviceToken().
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── picking a transport ─────────────────────────────────────────────────────

// Pure, so the four combinations are testable without a network or a mock.
// The proxy wins only when one is configured AND this device has a token;
// everything else is today's direct call, which keeps the coach working before
// the Worker exists, and after a token is cleared. Throwing names the fix:
// 'no-device-token' when a proxy is waiting for one, 'no-key' when there is no
// proxy at all. Neither credential ever goes near the URL or the body.
export function pickTransport({ proxy = '', token = '', apiKey = '' } = {}) {
  const base = (typeof proxy === 'string' ? proxy : '').trim();
  const device = (typeof token === 'string' ? token : '').trim();

  if (base && device) {
    return {
      mode: 'proxy',
      url: proxyUrl(MESSAGES_PATH, base),
      headers: {
        'content-type': 'application/json',
        'x-pd-device': device,
      },
    };
  }

  const key = (typeof apiKey === 'string' ? apiKey : '').trim();
  if (!key) throw new Error(base ? 'no-device-token' : 'no-key');
  return {
    mode: 'direct',
    url: ANTHROPIC_MESSAGES_URL,
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  };
}

// The wired version — the same rules, reading the configured proxy and this
// device's stored token. This is what coach.js and priceHelp.js call.
export const coachTransport = (apiKey) =>
  pickTransport({ proxy: COACH_PROXY, token: getDeviceToken(), apiKey });

// A 401 is about whichever credential was actually sent, and the copy people
// read has to say so: retyping a key fixes nothing when the token is stale.
export const authErrorFor = (mode) => (mode === 'proxy' ? 'bad-device-token' : 'bad-key');
