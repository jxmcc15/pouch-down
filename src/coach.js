// AI coach — direct browser calls to the Claude API. The key lives only in
// this device's localStorage (settings). Never ships in the repo.

import { markdownSummary, todayKey, dayNumberFor, pouchesForDay, resistedForDay, currentStreak } from './store.js';
import { stageForDay, capForDay, TOTAL_DAYS, QUIT_DATE, START_DATE } from './plan.js';

const MODEL = 'claude-haiku-4-5-20251001';

function systemPrompt(state) {
  const today = todayKey();
  const n = dayNumberFor(today);
  const stage = stageForDay(Math.min(Math.max(n, 1), TOTAL_DAYS));
  return `You are the in-app coach for "Pouch Down", James's ${TOTAL_DAYS}-day nicotine pouch taper (${START_DATE} to ${QUIT_DATE}, quit date ${QUIT_DATE}).

Method: hybrid taper — count first, then strength. Slots are meal-anchored (his habit: always after meals). Slip policy: "absorb and continue" — an over day breaks the streak but NEVER changes tomorrow's cap or moves the quit date. The 10-minute rule: wait 10 minutes before deciding on a craving.

Live data:
- Today is ${today}, day ${n} of ${TOTAL_DAYS}${n < 1 ? ' (pre-plan)' : n > TOTAL_DAYS ? ' (POST-QUIT — he is nicotine-free, coach maintenance now)' : ''}
- Current stage: ${stage ? `${stage.name} — ${stage.pouchesPerDay}/day @ ${stage.mg}mg` : 'n/a'}
- Today: ${pouchesForDay(state, today)}/${capForDay(n)} pouches used, ${resistedForDay(state, today)} cravings resisted
- Streak: ${currentStreak(state)} on-plan days

Recent log:
${markdownSummary(state, 7)}

Coaching style: direct, warm, zero shame, zero toxic positivity. Cravings are waves; delay beats willpower. Reference his actual numbers when relevant. If he went over, normalize it fast and refocus on the next slot, not the miss. 2-4 sentences per reply — this is a phone chat, not an essay. Never give medical advice; suggest a doctor for anything clinical.`;
}

export async function askCoach(state, messages) {
  const key = state.settings.apiKey?.trim();
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
