// Turns "5-pack at the gas station for $23.99 plus tax" into numbers. Same
// key and direct-browser call as coach.js — the key is held for the session
// only (sessionKey.js), is never stored on the device, and never ships
//
// Deliberately isolated: the future public build proxies this through a
// backend, and when it does, this is the only file that changes.

// Same model id as coach.js, which has been making this exact
// direct-from-the-browser call in production in this app since July. If a
// live call ever comes back with a model-not-found error, the one-line fix is
// to drop the date and use the undated alias: 'claude-haiku-4-5'.
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM = `You convert a person's description of how they buy nicotine pouches into a per-tin price. Reply with ONLY a JSON object: {"pricePerTin": number, "pouchesPerTin": number, "explanation": string}. pricePerTin is the out-the-door cost of ONE tin in the user's currency, including any tax they mention, rounded to cents. pouchesPerTin defaults to 20 if they don't say. explanation is one short sentence showing the arithmetic. If you cannot work it out, reply {"error": "one short sentence saying what is missing"}.`;

// Throws, never returns a partial result. Error taxonomy — the sheet maps
// every one of these to copy, and only `unclear:` is shown verbatim:
//   'no-key'     no API key on this device
//   'bad-key'    401 — the key was rejected
//   'api'        any other non-2xx response
//   'unclear:…'  the model says what's missing (the only message shown as-is)
//   'unreadable' the reply wasn't usable JSON, or the numbers were nonsense
// Anything else that escapes (offline, DNS, a non-JSON body) is a raw network
// error and falls into the sheet's catch-all copy. The key is only ever sent
// in the x-api-key header — never in a URL, a log, or an error message.
export async function priceFromText(text, apiKey) {
  if (!apiKey?.trim()) throw new Error('no-key');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    }),
  });
  if (res.status === 401) throw new Error('bad-key');
  if (!res.ok) throw new Error('api');
  const data = await res.json();
  return parsePriceReply(data.content?.[0]?.text ?? '');
}

// Pure, so it can be tested without ever touching the network.
export function parsePriceReply(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('unreadable');
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    throw new Error('unreadable'); // malformed JSON is just an unusable reply
  }
  if (j?.error) throw new Error(`unclear:${j.error}`);
  const price = Number(j?.pricePerTin), per = Math.round(Number(j?.pouchesPerTin));
  if (!(price > 0 && price < 200) || !(per >= 1 && per <= 100)) throw new Error('unreadable');
  return { pricePerTin: Math.round(price * 100) / 100, pouchesPerTin: per, explanation: String(j.explanation ?? '') };
}
