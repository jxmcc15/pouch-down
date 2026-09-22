// Helpers over a plan object (see planGenerator.js / legacyPlan.js) plus
// static recovery content. There is no global plan: every attempt owns its own.

export function stageForDay(plan, dayNum) {
  if (dayNum < 1) return null; // pre-plan
  if (dayNum > plan.totalDays) return plan.stages[plan.stages.length - 1]; // post-quit
  return plan.stages.find((s) => dayNum >= s.days[0] && dayNum <= s.days[1]);
}

export function capForDay(plan, dayNum) {
  if (dayNum < 1) return plan.baseline.pouchesPerDay + 1; // pre-plan: not judged
  const s = stageForDay(plan, dayNum);
  return s ? s.pouchesPerDay : 0;
}

// Recovery timeline shown after quit day. Times are approximate and
// intentionally conservative — sourced from standard smokeless-nicotine
// cessation guidance, not personalized medical advice.
export const RECOVERY_MILESTONES = [
  { hours: 0.33, label: '20 minutes', body: 'Heart rate and blood pressure start settling back to your normal.' },
  { hours: 12, label: '12 hours', body: 'Blood nicotine has dropped sharply — the steady drip your receptors expect is gone.' },
  { hours: 24, label: '24 hours', body: 'Nearly all nicotine is out of your bloodstream.' },
  { hours: 72, label: '72 hours', body: 'Peak withdrawal. Cravings are strongest right now — and it is downhill after this.' },
  { hours: 120, label: '5 days', body: 'Dopamine signaling is starting to rebalance without nicotine prompts.' },
  { hours: 168, label: '1 week', body: 'Sleep quality and concentration are measurably improving for most people.' },
  { hours: 336, label: '2 weeks', body: 'Gum and mouth blood flow have visibly recovered. Oral tissue is healing.' },
  { hours: 504, label: '3 weeks', body: 'Nicotinic receptor density is normalizing — the physical addiction is unwinding.' },
  { hours: 720, label: '1 month', body: 'Craving episodes are dramatically rarer and shorter. This is the new normal forming.' },
  { hours: 2160, label: '3 months', body: 'Dopamine function has substantially recovered. Each day past quit day is one more you chose.' },
];

export const WITHDRAWAL_NOTES = {
  stageFlip: 'Irritability and fog peak for 2–3 days after each step down, then fade. It is on schedule — not a sign the plan is failing.',
  postQuit: 'Days 1–3 after quitting are the hardest; most physical symptoms are largely gone by day 10.',
};
