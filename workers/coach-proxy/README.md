# pouch-coach — the API-key proxy

This folder is a small piece of server code that stands between the Pouch Down
app and the Claude API, so the **API key lives on Cloudflare instead of on your
phone**.

Before: the phone held the key and called Claude directly. Anything that could
read the phone's storage could read the key.
After: the phone holds a **device token** — a password that only works for this
one proxy, that can only ask for short answers from one cheap model, and that you
can switch off in ten seconds without touching the key.

Three words, one line each:

- **Worker** — a small program that runs on Cloudflare's servers at a URL. No
  machine to rent, no server to keep alive; it wakes up when a request arrives.
- **Secret** — a value you upload to Cloudflare once. The Worker can read it
  while it runs, but nobody can read it back out, and it is never in this repo.
- **CORS** — the browser's rule about which websites are allowed to call which
  URLs. The Worker answers "only pages from the Pouch Down site."

---

## What you'll end up with

- A URL like `https://pouch-coach.your-subdomain.workers.dev`
- Two secrets stored at Cloudflare: the Claude API key, and your device token(s)
- A phone that never stores the API key again

**You generate and hold both secrets. Claude never sees them, and neither does
anyone else. Never paste an API key or a device token into a chat — not into
Claude, not into ChatGPT, not into a Slack message, not into a GitHub issue. If
one ever lands in a chat window, treat it as burnt and rotate it (see
[Rotating a secret](#rotating-a-secret)).**

---

## Setup, step by step

Run all of these from **this folder**:

```sh
cd ~/Projects/pouch-down/workers/coach-proxy
```

`npx` downloads Wrangler (Cloudflare's command-line tool) on demand, so there is
nothing to install and nothing was added to the project's `package.json`.

### 1. Log in to Cloudflare

```sh
npx wrangler login
```

A browser tab opens and asks you to authorise Wrangler. If you don't have a
Cloudflare account yet, make a free one first — no card needed.

### 2. Make a device token

This is the password your phone will send. Generate it on your own machine:

```sh
openssl rand -hex 24
```

That prints 48 random characters. Copy them into your password manager now,
under something like "Pouch Down device token". You'll need it twice: once in
step 4, once in the app.

### 3. Upload the Claude API key

Get a key from <https://console.anthropic.com>. Use a key on a workspace with a
**monthly spend cap** — that cap is the real limit on what a leak can cost.

```sh
npx wrangler secret put ANTHROPIC_API_KEY
```

It prompts for the value and hides what you type. Paste the key, press Enter.

### 4. Upload the device token

```sh
npx wrangler secret put DEVICE_TOKENS
```

Paste the 48 characters from step 2. If you ever have two devices, put both
tokens here separated by a comma and nothing else:

```
aaaa…,bbbb…
```

### 5. Deploy

```sh
npx wrangler deploy
```

The last lines of the output look roughly like this:

```
Total Upload: 4.20 KiB / gzip: 1.60 KiB
Uploaded pouch-coach (2.11 sec)
Deployed pouch-coach triggers (0.85 sec)
  https://pouch-coach.your-subdomain.workers.dev
Current Version ID: 8f1c…
```

**That URL is the thing you need.** `your-subdomain` is your own Cloudflare
subdomain — usually based on your account name, not literally "your-subdomain".
Copy the URL; the app asks for it once, in its settings.

---

## Testing it with curl

`curl` is a command that sends one HTTP request from your terminal — a way to
prove the proxy works before involving the phone.

Read your token into a shell variable first, so it never appears in your
terminal history:

```sh
read -s PD_TOKEN    # paste the device token, press Enter — nothing is echoed
```

Then, with your own Worker URL in place of `pouch-coach.your-subdomain`:

```sh
curl -i https://pouch-coach.your-subdomain.workers.dev/v1/messages \
  -H "content-type: application/json" \
  -H "origin: https://jxmcc15.github.io" \
  -H "x-pd-device: $PD_TOKEN" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":50,"messages":[{"role":"user","content":"Say hello in five words."}]}'
```

When you're done:

```sh
unset PD_TOKEN
```

A working call answers `HTTP/2 200` followed by JSON with Claude's reply inside
`"content"`. The `origin` header is required — the Worker refuses requests that
don't come from an allowed site, and curl doesn't send one on its own.

### Reading the refusals

Every refusal comes back as `{"error":{"message":"…"}}` with a status code:

| Status | What it means | Usual cause |
| --- | --- | --- |
| 403 | Origin not allowed | the `origin` header is missing, or isn't in `ALLOWED_ORIGINS` in `wrangler.toml` |
| 401 | Unknown device | the `x-pd-device` token doesn't match what you uploaded |
| 400 | The request itself is refused | wrong model, `max_tokens` over 400, an extra field, or too much text |
| 405 | Wrong method or path | it has to be `POST` to `/v1/messages` |
| 502 | The call to Claude failed | no API key uploaded, key rejected, or Claude is having a moment |

Two useful sanity checks: change one character of the token and confirm you get
401, and drop the `origin` header and confirm you get 403.

---

## Rotating a secret

Rotating means replacing a value with a fresh one. Both secrets rotate the same
way, and the Worker picks up the new value within seconds — no redeploy needed.

**The API key** — make a new key at <https://console.anthropic.com>, then:

```sh
npx wrangler secret put ANTHROPIC_API_KEY
```

Paste the new key, then **delete the old key in the Anthropic console.** Until
you delete it there, the old key still works for anyone who has it.

**The device token** — generate a new one, upload it, then put the new value into
the app on your phone:

```sh
openssl rand -hex 24
npx wrangler secret put DEVICE_TOKENS
```

The old token stops working the moment the new value is saved, so the app will
say the device is unknown until you paste the new token into it.

**In an emergency** (phone lost, token in a chat window), set `DEVICE_TOKENS` to
a fresh random value and nothing else can call the proxy. To shut the whole thing
off:

```sh
npx wrangler delete
```

---

## Watching the logs

```sh
npx wrangler tail
```

This streams the Worker's log lines live while you use the app; press Ctrl-C to
stop. You'll see a line per request with its status. Secrets are never logged —
the code only ever prints a failure's name and an upstream status number.

---

## Cost

Cloudflare's free plan includes 100,000 Worker requests a day. Coach chats and
price look-ups are a handful of requests a day, so this stays free with a very
large margin. The part that does cost money is the Claude API usage itself,
which is why the model is pinned to Haiku, `max_tokens` is capped at 400, and the
key should sit on a workspace with a monthly spend cap.

---

## For whoever changes this code next

`src/guard.js` holds every decision as a pure function — allowed origin, device
token, body checks, CORS headers. `src/worker.js` is only wiring. The caps live
in one object (`LIMITS`) so they can't drift from the tests or this README:

| Limit | Value |
| --- | --- |
| Model allowed | `claude-haiku-4-5-20251001` only |
| `max_tokens` | 400 or less |
| Request body | 16 KB |
| Messages per request | 40 |
| Total characters (system + messages) | 60 KB |
| Body fields allowed | `model`, `max_tokens`, `system`, `messages` — nothing else |

Run the tests:

```sh
npx vitest run --root workers/coach-proxy
```

(from the repo root, or `npx vitest run` from this folder). The repo's own
`npm test` uses `test.include: ['src/**/*.test.js']` in `vite.config.js`, which
does not reach this folder — adding `'workers/**/*.test.js'` to that list would
fold these tests into the main suite.

Nothing in here is deployed by the repo's GitHub Actions workflow. The Worker
only changes when someone runs `npx wrangler deploy` from this folder.
