// pouch-coach — the small piece of server that holds the Claude API key so the
// phone doesn't have to.
//
// The phone posts the same body it used to post straight to the Claude API,
// plus a device token header. This Worker checks the request against guard.js,
// adds the API key from its own secret store, forwards the call, and hands the
// answer back. The key never travels to the phone and never appears in a
// response, a log line or an error.
//
// All the judgement lives in guard.js. This file is the wiring: read the
// request, ask the guard, forward or refuse.

import { allowedOrigin, tokenOk, checkBody, corsHeaders, LIMITS } from './guard.js';

const UPSTREAM = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const PATH = '/v1/messages';
const DEVICE_HEADER = 'x-pd-device';

// Every response says the same two things about itself: it's JSON, and nothing
// in between us is allowed to keep a copy.
function baseHeaders(origin, env) {
  return {
    ...corsHeaders(origin, env.ALLOWED_ORIGINS),
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  };
}

// One error shape for every refusal, matching what the app reads:
// `{ error: { message } }`. The message is written for a human looking at a
// phone; it never describes a secret or a header value.
function fail(status, message, origin, env) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: baseHeaders(origin, env),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);

    // The preflight: the browser asking whether it may send the real request.
    // It gets the CORS headers and no body. When the origin isn't on the list
    // the echo is simply absent, and the browser stops there by itself.
    if (request.method === 'OPTIONS' && url.pathname === PATH) {
      return new Response(null, { status: 204, headers: corsHeaders(origin, env.ALLOWED_ORIGINS) });
    }

    if (request.method !== 'POST' || url.pathname !== PATH) {
      return fail(405, `Use POST ${PATH}.`, origin, env);
    }

    // Who's asking. The origin check is what keeps another website from using
    // this proxy through a visitor's browser; the token is what keeps anything
    // else from using it at all. Both are required.
    if (!allowedOrigin(origin, env.ALLOWED_ORIGINS)) {
      return fail(403, 'This origin is not allowed to use this proxy.', origin, env);
    }
    if (!tokenOk(request.headers.get(DEVICE_HEADER), env.DEVICE_TOKENS)) {
      return fail(401, 'Unknown device.', origin, env);
    }

    // Cheap size check before reading anything, when the caller declared a
    // length. checkBody measures the real bytes afterwards regardless.
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > LIMITS.bodyBytes) {
      return fail(400, 'Request body is too large.', origin, env);
    }

    let raw;
    try {
      raw = await request.text();
    } catch {
      return fail(400, 'Request body must be JSON.', origin, env);
    }

    const checked = checkBody(raw);
    if (!checked.ok) return fail(checked.status, checked.message, origin, env);

    if (!env.ANTHROPIC_API_KEY) {
      // Deploying without the secret is a setup mistake, not a caller's fault.
      return fail(502, 'The proxy is not finished being set up.', origin, env);
    }

    // Forward a request built from scratch: the checked body, and exactly three
    // headers. Nothing the browser sent — no cookies, no user agent, no
    // forwarded token — is passed along.
    let upstream;
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(checked.body),
      });
    } catch (err) {
      // The name of the failure is enough to debug a network problem, and it
      // can't contain anything we were holding.
      console.error('upstream request failed:', err?.name || 'error');
      return fail(502, 'Could not reach the Claude API.', origin, env);
    }

    if (!upstream.ok) {
      // The upstream status is a useful number and not a secret; the upstream
      // body is not passed on, so nothing about the account can leak through.
      console.error('upstream returned', upstream.status);
      return fail(502, `The Claude API returned an error (${upstream.status}).`, origin, env);
    }

    let text;
    try {
      text = await upstream.text();
    } catch {
      return fail(502, 'The Claude API answer could not be read.', origin, env);
    }

    // The Claude API's own JSON, unchanged, with our headers around it.
    return new Response(text, { status: 200, headers: baseHeaders(origin, env) });
  },
};
