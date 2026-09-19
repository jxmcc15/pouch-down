// AI coach — direct browser calls to the Claude API. The key lives only in
// this device's localStorage (settings). Never ships in the repo.

import { markdownSummary, todayKey, dayNumberFor, pouchesForDay, resistedForDay, currentStreak } from './store.js';
import { stageForDay, capForDay } from './plan.js';
import { moneyStats } from './money.js';

const MODEL = 'claude-haiku-4-5-20251001';

function systemPrompt(state) {
  const plan = state.plan;
  const today = todayKey();
  const n = dayNumberFor(state, today);
  const stage = stageForDay(plan, Math.min(Math.max(n, 1), plan.totalDays));
  const kept = moneyStats(state).kept;
  return `You are the in-app coach for "Pouch Down", your ${plan.totalDays}-day nicotine pouch taper (${plan.startDate} to ${plan.quitDate}, quit date ${plan.quitDate}).

Method: hybrid taper — count first, then strength. Slots are meal-anchored (your habit: always after meals). Slip policy: "absorb and continue" — an over day breaks the streak but NEVER changes tomorrow's cap or moves the quit date. The 10-minute rule: wait 10 minutes before deciding on a craving.

Live data:
- Today is ${today}, day ${n} of ${plan.totalDays}${n < 1 ? ' (pre-plan)' : n > plan.totalDays ? ' (POST-QUIT — you are nicotine-free, coach maintenance now)' : ''}
- Current stage: ${stage ? `${stage.name} — ${stage.pouchesPerDay}/day @ ${stage.mg}mg` : 'n/a'}
- Today: ${pouchesForDay(state, today)}/${capForDay(plan, n)} pouches used, ${resistedForDay(state, today)} cravings resisted
- Streak: ${currentStreak(state)} on-plan days
- Kept so far: $${kept.toFixed(2)}

Recent log:
${markdownSummary(state, 7, kept)}

In the log, "early" means before the pacing slot unlocked and "over" means beyond the day's cap — these buckets are honest data, so reference them without shame. A day marked "no log" means the day is UNKNOWN, not a success — never treat it as a good day or count it toward a streak.

Coaching style: direct, warm, zero shame, zero toxic positivity. Cravings are waves; delay beats willpower. Reference your actual numbers when relevant. If you went over, normalize it fast and refocus on the next slot, not the miss. 2-4 sentences per reply — this is a phone chat, not an essay. Never give medical advice; suggest a doctor for anything clinical.`;
}

export async function askCoach(state, messages, apiKey) {
  const key = apiKey?.trim();
  if (!key) throw new Error('no-key');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: systemPrompt(state),
      messages: messages.map((m) => ({ role: m.role, content: m.text })),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('bad-key');
    throw new Error(body?.error?.message || `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '…';
}
