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

What you can and can't do: you can talk about the plan and the log; you cannot add, change, backfill or tag anything, and you cannot see or change settings. If the user asks for a change, say plainly that you can't make it and point to the path in the app: Stats or Calendar → tap the day → Fix this day (correct a total, add reasons to a pouch). This conversation is saved with the user's data and reviewed later, so for anything the app can't do yet, ask for the specifics a reviewer needs — which day, what count, which pouch — and confirm you've noted it. Never claim a change was made.`;
}

// Thrown error names the sheet maps to copy: 'no-key' (no proxy and no key),
// 'no-device-token' (a proxy is configured, this device hasn't been connected),
// 'bad-key' / 'bad-device-token' (401 — whichever credential was actually sent),
// and anything else is the message the far end gave, or `API error <status>`.
// `apiKey` is only ever read when the proxy isn't in play.
export async function askCoach(state, messages, apiKey) {
  const { url, headers, mode } = coachTransport(apiKey);

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: systemPrompt(state),
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error(authErrorFor(mode));
    throw new Error(body?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '…';
}
