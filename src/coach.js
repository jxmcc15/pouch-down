// AI coach — one POST per message, either through the proxy this person owns
// (which holds the API key server-side, so the phone holds nothing) or, when no
// proxy is configured, straight to the Claude API with the session key. The
// choice is made at call time by proxyConfig.js; the body is identical either
// way, so nothing below this line has to know which one it got. No key or token
// ever ships in the repo.

import { markdownSummary, asOfDay, dayNumberFor, isLogged, pouchesForDay, resistedForDay, currentStreak } from './store.js';
import { stageForDay, capForDay } from './plan.js';
import { moneyStats } from './money.js';
import { coachTransport, authErrorFor } from './proxyConfig.js';
import { TOOLS, MAX_TOKENS, MAX_PROPOSALS, livePouchesForPrompt, promptClock } from './coachTools.js';

const MODEL = 'claude-haiku-4-5-20251001';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Every fact here is read "as of" the attempt's scoring day (asOfDay) and from
// its log. The calendar can say a quit day has passed; only the log can say
// how it went, so nothing is ever claimed from elapsed time alone.
function liveData(state) {
  const plan = state.plan;
  const past = state.status === 'archived';
  const day = asOfDay(state); // today while active; the last scored day of a past attempt
  const n = dayNumberFor(state, day);
  const inPlan = n >= 1 && n <= plan.totalDays;

  const where = n < 1
    ? `before day 1 (the plan starts ${plan.startDate})`
    : n > plan.totalDays
      ? `${plural(n - plan.totalDays, 'day', 'days')} past quit day (${plan.quitDate}). Past quit day — check the log; the date alone says nothing about whether the user still uses pouches`
      : `day ${n} of ${plan.totalDays}${n === plan.totalDays ? ' (quit day)' : ''}`;
  const stage = inPlan ? stageForDay(plan, n) : null;
  const logged = isLogged(state, day);
  const used = pouchesForDay(state, day);
  const counts = logged
    ? `${plural(used, 'pouch', 'pouches')} used${inPlan ? ` (cap ${capForDay(plan, n)})` : ''}, ${plural(resistedForDay(state, day), 'craving', 'cravings')} resisted`
    : past ? 'no log — unknown, not zero' : 'nothing logged yet — unknown, not zero';

  return [
    past
      ? `- This is a past attempt that has ended; the user is looking back at it. Its record runs through ${day}, ${where}. Treat it as history, not as today.`
      : `- Today is ${day}, ${where}.`,
    `- ${past ? 'Stage on that day' : 'Current stage'}: ${stage ? `${stage.name} — ${stage.pouchesPerDay}/day @ ${stage.mg}mg` : 'n/a'}`,
    `- ${past ? 'That day' : 'Today'}: ${counts}`,
    `- Streak: ${plural(currentStreak(state), 'on-plan day', 'on-plan days')}`,
  ].join('\n');
}

// The pouches the coach may name, one per line, ids exactly as the app will
// check them. Times are the wall clock where each pouch was logged.
function pouchList(state) {
  const rows = livePouchesForPrompt(state).map((p) => `- ${p.id} · ${p.day} · ${p.time ?? 'time unknown'} · ${p.trigger ?? 'no trigger'}`);
  return rows.length ? rows.join('\n') : '- (none in the last 7 days)';
}

// A past attempt keeps the old wording: it gets no tools, and its history is
// read-only, so the only honest answer to "fix this" is where the fix lives.
const READ_ONLY_RULES = "What you can and can't do: you can talk about the plan and the log; you cannot add, change, backfill or tag anything, and you cannot see or change settings. If the user asks for a change, say plainly that you can't make it and point to the path in the app: tap the day on Calendar, or the pencil beside it in Stats → Fix this day (add a pouch you missed, with its time or 'unknown'; mark an accidental tap as a mistake; correct a past total; add reasons). This conversation is saved with the user's data and reviewed later, so for anything the app can't do yet, ask for the specifics a reviewer needs — which day, what count, which pouch — and confirm you've noted it. Never claim a change was made.";

// The active attempt: the coach proposes with its tools, the user confirms
// each card, and the app — never the model — decides what a card may write.
// Now and the pouch list read the same clock liveData does, so "Today is …"
// and "Now: …" can never disagree within one prompt.
function toolRules(state) {
  const { day, time, weekday } = promptClock();
  return `What you can and can't do: you can propose these actions; the user confirms each on a card in the app, and nothing is saved until they do. You can't change settings, the plan, or the attempt — for those, or anything the tools don't cover, point to the path in the app: tap the day on Calendar, or the pencil beside it in Stats → Fix this day. This conversation is saved with the user's data and reviewed later, so for anything the app can't do yet, ask for the specifics a reviewer needs — which day, what count, which pouch — and confirm you've noted it.

Now: ${weekday} ${day}, ${time} on the user's clock. Days run 4 AM to 4 AM, so before 4 AM it is still the app day above.

Pouches logged in the last 7 days, newest first (id · day · time · triggers). These ids are the only ones you may name in a tool:
${pouchList(state)}

Tool rules:
- Propose only what the user clearly asked for or clearly stated as a fact. A guess is a question, not a card.
- Never mark_mistake unless the user says a tap was an accident. Never add_late_pouch for a pouch already in the list.
- Give a day as YYYY-MM-DD and a time as HH:MM 24h on that day; "4:30" in the evening means 16:30; before 4 AM belongs to the previous app day (the app handles it — just name the day the user means). Use null when the user doesn't remember the time.
- fill_missed_day within cap: ask whether the streak keeps or breaks before proposing, unless the user said.
- At most ${MAX_PROPOSALS} actions in a reply. Say in one short sentence what each card does; the card is the confirmation, so never claim it is done.
- After a tool result: one short line. "4:30 is in." / "That one didn't save — the app says it's already logged." Nothing is done until the result says saved.`;
}

// "You" is the coach; the person is always "the user". Nothing here names
// anyone — the plan, dates, and numbers all come from the attempt.
function systemPrompt(state) {
  const plan = state.plan;
  const kept = moneyStats(state).kept;
  return `You are the in-app coach for "Pouch Down", a nicotine pouch taper app. The user ${state.status === 'archived' ? 'was' : 'is'} on a ${plan.totalDays}-day taper, ${plan.startDate} to quit day ${plan.quitDate}.

Method: hybrid taper — count first, then strength. Pouches are paced by slots anchored to the user's meal times. Slip policy: "absorb and continue" — an over day breaks the streak but NEVER changes the next day's cap or moves the quit date. The 10-minute rule: wait 10 minutes before deciding on a craving.

Live data:
${liveData(state)}
- Kept so far: $${kept.toFixed(2)}

Recent log:
${markdownSummary(state, 7, kept)}

In the log, "early" means before the pacing slot unlocked and "over" means beyond the day's cap — these buckets are honest data, so reference them without shame. A day marked "no log" means the day is UNKNOWN, not a success — never treat it as a good day or count it toward a streak. Only the log says how a day went; never infer it from the date.

Coaching style: direct, warm, zero shame, zero toxic positivity. Cravings are waves; delay beats willpower. Reference the user's actual numbers when relevant. If the user went over, normalize it fast and refocus on the next slot, not the miss. 2-4 sentences per reply — this is a phone chat, not an essay. Never give medical advice; suggest a doctor for anything clinical.

${state.status === 'archived' ? READ_ONLY_RULES : toolRules(state)}`;
}

// Thrown error names the sheet maps to copy: 'no-key' (no proxy and no key),
// 'no-device-token' (a proxy is configured, this device hasn't been connected),
// 'bad-key' / 'bad-device-token' (401 — whichever credential was actually sent),
// and anything else is the message the far end gave, or `API error <status>`.
// `apiKey` is only ever read when the proxy isn't in play.
//
// `turns` is the conversation as the Messages API takes it (coachActions.js
// toTurns). → { text, proposals: [{ id, name, input }], stopReason }: every
// text block joined, every tool_use block a proposal, in order. Proposals are
// untrusted — the caller validates them before anything is shown.
export async function askCoach(state, turns, apiKey) {
  const { url, headers, mode } = coachTransport(apiKey);
  const archived = state.status === 'archived';

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt(state),
      // History is read-only: a past attempt is never offered a tool.
      ...(archived ? {} : { tools: TOOLS }),
      messages: turns,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error(authErrorFor(mode));
    throw new Error(body?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const text = blocks
    .filter((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim())
    .map((b) => b.text.trim())
    .join('\n\n');
  const proposals = archived ? [] : blocks.filter((b) => b?.type === 'tool_use').map(({ id, name, input }) => ({ id, name, input }));
  return { text: text || (proposals.length ? '' : '…'), proposals, stopReason: typeof data?.stop_reason === 'string' ? data.stop_reason : null };
}
