// Every decision the proxy makes, as pure functions: no network, no Worker
// runtime, nothing to stub. worker.js is the thin wiring that calls these and
// turns their answers into responses.
//
// The shape of an answer is always the same: `{ ok: true, body }` when a
// request may go upstream, `{ ok: false, status, message }` when it may not.
// `message` is what the caller is told — it never carries a secret, a header
// value, or anything about how the check was made.

// The caps, in one place so the README, the tests and the code can't drift.
// They exist to bound what a stolen device token can cost: one small model,
// short answers, small requests.
export const LIMITS = {
  models: ['claude-haiku-4-5-20251001'],
  fields: ['model', 'max_tokens', 'system', 'messages'],
  roles: ['user', 'assistant'],
  maxTokens: 400,
  bodyBytes: 16 * 1024,
  messages: 40,
  totalChars: 60 * 1024,
};

// `ALLOWED_ORIGINS` and `DEVICE_TOKENS` are both comma-separated settings typed
// by a human, so spaces and a stray trailing comma are expected and harmless.
function list(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// An Origin is a scheme + host + port, and it is compared whole: no prefix
// match, no "ends with", no trailing slash. `https://example.github.io.evil`
// starts with nothing useful, and that is the point.
export function allowedOrigin(origin, allowedOrigins) {
  if (typeof origin !== 'string' || origin === '') return false;
  return list(allowedOrigins).includes(origin);
}

// Compare two strings in a way that takes the same work whichever characters
// differ, so the answer's timing says nothing about how close a guess was.
// The loop always walks the longer string, and the length difference is folded
// into the same accumulator instead of being an early return.
function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    // Past the end of a string charCodeAt gives NaN, and `NaN | 0` is 0.
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

// Is this the token of a device James set up? Every configured token is walked
// every time — no early exit on a match either, for the same reason as above.
export function tokenOk(presented, deviceTokens) {
  if (typeof presented !== 'string' || presented === '') return false;
  let ok = false;
  for (const token of list(deviceTokens)) {
    if (sameString(presented, token)) ok = true;
  }
  return ok;
}

function bad(message) {
  return { ok: false, status: 400, message };
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

// The request body, as the raw text that arrived. Everything about it is
// checked before a single byte goes upstream: its size, that it parses, that it
// holds only the four fields the app sends, and that each of those is the shape
// and size we expect. `limits` is only overridden by tests.
export function checkBody(raw, limits = {}) {
  const lim = { ...LIMITS, ...limits };

  if (typeof raw !== 'string' || raw.trim() === '') return bad('Request body must be JSON.');
  if (byteLength(raw) > lim.bodyBytes) return bad('Request body is too large.');

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return bad('Request body must be valid JSON.');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return bad('Request body must be a JSON object.');
  }

  // An allowlist, not a blocklist: anything the app doesn't send is refused,
  // so no extra API parameter can ride along on a request.
  for (const key of Object.keys(body)) {
    if (!lim.fields.includes(key)) return bad(`Unsupported field in request body: ${key}`);
  }

  if (typeof body.model !== 'string' || !lim.models.includes(body.model)) {
    return bad('That model is not allowed.');
  }

  const max = body.max_tokens;
  if (!Number.isInteger(max) || max < 1) return bad('max_tokens must be a whole number above 0.');
  if (max > lim.maxTokens) return bad(`max_tokens must be ${lim.maxTokens} or less.`);

  if (body.system !== undefined && typeof body.system !== 'string') {
    return bad('system must be a string.');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return bad('messages must be a non-empty array.');
  }
  if (body.messages.length > lim.messages) {
    return bad(`Too many messages — ${lim.messages} at most.`);
  }

  let chars = typeof body.system === 'string' ? body.system.length : 0;
  for (const m of body.messages) {
    if (m === null || typeof m !== 'object' || Array.isArray(m)) {
      return bad('Each message must be an object.');
    }
    for (const key of Object.keys(m)) {
      if (key !== 'role' && key !== 'content') {
        return bad(`Unsupported field in a message: ${key}`);
      }
    }
    if (!lim.roles.includes(m.role)) return bad('Each message needs a role of user or assistant.');
    if (typeof m.content !== 'string' || m.content === '') {
      return bad('Each message needs content as a non-empty string.');
    }
    chars += m.content.length;
  }
  if (chars > lim.totalChars) return bad('The conversation is too long.');

  return { ok: true, body };
}

// The browser only gets an Access-Control-Allow-Origin when its origin is one
// we know; every other origin gets the headers minus that one, which is what
// makes the browser refuse to hand the answer to the page.
//
// `Vary: Origin` is always present, because the answer genuinely differs by
// origin and a cache in between must not reuse one site's response for another.
// There is deliberately no Access-Control-Allow-Credentials: the device token
// is sent as a header, so no cookie ever needs to cross.
export function corsHeaders(origin, allowedOrigins) {
  const headers = { vary: 'Origin' };
  if (!allowedOrigin(origin, allowedOrigins)) return headers;
  return {
    ...headers,
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-pd-device',
    'access-control-max-age': '86400',
  };
}
