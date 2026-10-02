// Every decision the proxy makes, as pure functions: no network, no Worker
// runtime, nothing to stub. worker.js is the thin wiring that calls these and
// turns their answers into responses.
//
// The shape of an answer is always the same: `{ ok: true, body }` when a
// request may go upstream, `{ ok: false, status, message }` when it may not.
// `message` is what the caller is told — it never carries a secret, a header
// value, or anything about how the check was made.

// The eight actions the app's coach may propose — its own copy, because the
// Worker ships alone. src/__tests__/coachProxyPin.test.js pins it equal to
// TOOL_NAMES in src/coachTools.js, so the two can't drift.
export const TOOL_NAMES = [
  'log_pouch_now', 'log_resisted_now', 'add_late_pouch', 'mark_mistake',
  'add_reason', 'fill_missed_day', 'correct_day_total', 'log_checkin',
];

// The caps, in one place so the README, the tests and the code can't drift.
// They exist to bound what a stolen device token can cost: one small model,
// short answers, small requests — and, since the coach proposes actions, only
// the app's own eight tools, each small, with tool calls and their results
// only where the conversation can hold them.
export const LIMITS = {
  models: ['claude-haiku-4-5-20251001'],
  fields: ['model', 'max_tokens', 'system', 'tools', 'messages'],
  roles: ['user', 'assistant'],
  maxTokens: 800,
  bodyBytes: 48 * 1024,
  messages: 40,
  totalChars: 60 * 1024,
  tools: 8,
  // These four are characters (string length), the unit the app measures in —
  // a serialised input the app replays whole must never be refused here. Only
  // bodyBytes is bytes; it bounds everything below it whatever the alphabet.
  toolDescription: 1024,
  toolSchema: 4 * 1024,
  blocks: 12,
  toolInput: 2 * 1024,
  toolResult: 500,
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

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const onlyKeys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));

// The app's tool definitions: name, description and schema, nothing else, and
// only the names the app has. → a refusal message, or null when they'll do.
function toolsProblem(tools, lim) {
  if (!Array.isArray(tools) || tools.length === 0) return 'tools must be a non-empty array.';
  if (tools.length > lim.tools) return `Too many tools — ${lim.tools} at most.`;
  const seen = new Set();
  for (const t of tools) {
    if (!isObj(t) || !onlyKeys(t, ['name', 'description', 'input_schema'])) return 'Each tool may only have a name, a description and an input_schema.';
    if (!TOOL_NAMES.includes(t.name) || seen.has(t.name)) return 'That tool is not allowed.';
    seen.add(t.name);
    if (typeof t.description !== 'string' || t.description === '' || t.description.length > lim.toolDescription) return 'A tool description is missing or too long.';
    if (!isObj(t.input_schema) || t.input_schema.type !== 'object' || JSON.stringify(t.input_schema).length > lim.toolSchema) {
      return 'A tool input_schema is missing or too large.';
    }
  }
  return null;
}

// One content block of one message. → [refusal message | null, characters it
// adds to the conversation]. Text in either role; a tool call only from the
// assistant, a tool result only from the user — the only places the app puts them.
function blockProblem(b, role, lim) {
  if (!isObj(b)) return ['Each content block must be an object.', 0];
  if (b.type === 'text') {
    if (!onlyKeys(b, ['type', 'text']) || typeof b.text !== 'string' || b.text === '') return ['A text block needs non-empty text and nothing else.', 0];
    return [null, b.text.length];
  }
  if (b.type === 'tool_use') {
    if (role !== 'assistant') return ['Only the assistant can call a tool.', 0];
    if (!onlyKeys(b, ['type', 'id', 'name', 'input']) || typeof b.id !== 'string' || b.id === '') return ['A tool_use block needs an id, a name and an input, and nothing else.', 0];
    if (!TOOL_NAMES.includes(b.name)) return ['That tool is not allowed.', 0];
    if (!isObj(b.input)) return ['A tool_use input must be an object.', 0];
    const input = JSON.stringify(b.input);
    if (input.length > lim.toolInput) return ['A tool_use input is too large.', 0];
    return [null, b.id.length + b.name.length + input.length];
  }
  if (b.type === 'tool_result') {
    if (role !== 'user') return ['Only the user can return a tool result.', 0];
    if (!onlyKeys(b, ['type', 'tool_use_id', 'content', 'is_error']) || typeof b.tool_use_id !== 'string' || b.tool_use_id === '') {
      return ['A tool_result block needs a tool_use_id and content, and nothing else.', 0];
    }
    if (typeof b.content !== 'string' || b.content === '' || b.content.length > lim.toolResult) return ['A tool_result content must be a short string.', 0];
    if (b.is_error !== undefined && typeof b.is_error !== 'boolean') return ['is_error must be true or false.', 0];
    return [null, b.tool_use_id.length + b.content.length];
  }
  return ['That content block type is not allowed.', 0];
}

// The request body, as the raw text that arrived. Everything about it is
// checked before a single byte goes upstream: its size, that it parses, that it
// holds only the fields the app sends, and that each of those is the shape and
// size we expect. `limits` is only overridden by tests.
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

  if (body.tools !== undefined) {
    const problem = toolsProblem(body.tools, lim);
    if (problem) return bad(problem);
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
    if (typeof m.content === 'string') {
      if (m.content === '') return bad('Each message needs content as a non-empty string or a list of blocks.');
      chars += m.content.length;
    } else if (Array.isArray(m.content)) {
      if (m.content.length === 0 || m.content.length > lim.blocks) return bad(`A message holds 1 to ${lim.blocks} content blocks.`);
      for (const b of m.content) {
        const [problem, n] = blockProblem(b, m.role, lim);
        if (problem) return bad(problem);
        chars += n;
      }
    } else {
      return bad('Each message needs content as a non-empty string or a list of blocks.');
    }
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
