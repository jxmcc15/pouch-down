// The 60-day taper plan — single source of truth.
// Hybrid method: cut count first (days 1-20), then strength (days 21-60).
// Slots are meal-anchored: James uses pouches all day but always after meals,
// so meal slots are protected and idle "floater" slots get cut first.
// Extended 2026-07-08 from the original 30-day plan: stages 1-5 doubled
// exactly, the push-back stage absorbs the remainder so quit lands on day 60.

export const START_DATE = '2026-07-08'; // Day 1 (Wednesday)
export const QUIT_DATE = '2026-09-05'; // Day 60 — zero
export const TOTAL_DAYS = 60;

export const BASELINE = {
  pouchesPerDay: 9, // his 8-10/day average before the plan
  mg: 9,
};

// anchor: 'breakfast' | 'lunch' | 'dinner' (time comes from settings, + offsetMin)
// anchor: 'fixed' uses `time` (HH:MM, 24h)
const slot = (id, label, anchor, timeOrOffset) =>
  anchor === 'fixed'
    ? { id, label, anchor, time: timeOrOffset }
    : { id, label, anchor, offsetMin: timeOrOffset };

const MEAL_SLOTS = {
  breakfast: slot('after-breakfast', 'After breakfast', 'breakfast', 15),
  lunch: slot('after-lunch', 'After lunch', 'lunch', 15),
  dinner: slot('after-dinner', 'After dinner', 'dinner', 15),
};

export const STAGES = [
  {
    id: 1,
    name: 'Baseline hold',
    days: [1, 10],
    pouchesPerDay: 8,
    mg: 9,
    tagline: 'Lock the ceiling at 8. No new habits, just a hard cap.',
    slots: [
      MEAL_SLOTS.breakfast,
      slot('mid-morning', 'Mid-morning', 'fixed', '10:30'),
      MEAL_SLOTS.lunch,
      slot('mid-afternoon', 'Mid-afternoon', 'fixed', '15:00'),
      slot('late-afternoon', 'Late afternoon', 'fixed', '16:30'),
      MEAL_SLOTS.dinner,
      slot('evening', 'Evening', 'fixed', '20:30'),
      slot('late-evening', 'Late evening', 'fixed', '21:45'),
    ],
  },
  {
    id: 2,
    name: 'First cut',
    days: [11, 20],
    pouchesPerDay: 6,
    mg: 9,
    tagline: 'Drop the two weakest floaters. Meals stay protected.',
    slots: [
      MEAL_SLOTS.breakfast,
      slot('mid-morning', 'Mid-morning', 'fixed', '10:30'),
      MEAL_SLOTS.lunch,
      slot('mid-afternoon', 'Mid-afternoon', 'fixed', '15:30'),
      MEAL_SLOTS.dinner,
      slot('evening', 'Evening', 'fixed', '21:00'),
    ],
  },
  {
    id: 3,
    name: 'Strength drop I',
    days: [21, 30],
    pouchesPerDay: 6,
    mg: 6,
    tagline: 'Same rhythm, 6mg tins. Your routine won’t even notice.',
    shopBefore: { date: '2026-07-28', what: '~5 tins of 6mg' },
    slots: [
      MEAL_SLOTS.breakfast,
      slot('mid-morning', 'Mid-morning', 'fixed', '10:30'),
      MEAL_SLOTS.lunch,
      slot('mid-afternoon', 'Mid-afternoon', 'fixed', '15:30'),
      MEAL_SLOTS.dinner,
      slot('evening', 'Evening', 'fixed', '21:00'),
    ],
  },
  {
    id: 4,
    name: 'Meals only (+1)',
    days: [31, 40],
    pouchesPerDay: 4,
    mg: 6,
    tagline: 'Down to after-meal pouches plus one evening floater.',
    slots: [
      MEAL_SLOTS.breakfast,
      MEAL_SLOTS.lunch,
      MEAL_SLOTS.dinner,
      slot('evening', 'Evening', 'fixed', '21:00'),
    ],
  },
  {
    id: 5,
    name: 'Strength drop II',
    days: [41, 50],
    pouchesPerDay: 4,
    mg: 3,
    tagline: 'Same four slots, 3mg. The finish line is visible.',
    shopBefore: { date: '2026-08-17', what: '~3 tins of 3mg' },
    slots: [
      MEAL_SLOTS.breakfast,
      MEAL_SLOTS.lunch,
      MEAL_SLOTS.dinner,
      slot('evening', 'Evening', 'fixed', '21:00'),
    ],
  },
  {
    id: 6,
    name: 'Push the first back',
    days: [51, 58],
    pouchesPerDay: 2,
    mg: 3,
    tagline: 'No pouch until after lunch — delaying the first of the day breaks the wake-up wiring.',
    slots: [MEAL_SLOTS.lunch, MEAL_SLOTS.dinner],
  },
  {
    id: 7,
    name: 'Last one',
    days: [59, 59],
    pouchesPerDay: 1,
    mg: 3,
    tagline: 'One pouch, after dinner. Say goodbye properly.',
    slots: [MEAL_SLOTS.dinner],
  },
  {
    id: 8,
    name: 'Quit day',
    days: [60, 60],
    pouchesPerDay: 0,
    mg: 0,
    tagline: 'Zero. From here the app counts up, not down.',
    slots: [],
  },
];

export function stageForDay(dayNum) {
  if (dayNum < 1) return null; // pre-plan
  if (dayNum > TOTAL_DAYS) return STAGES[STAGES.length - 1]; // post-quit
  return STAGES.find((s) => dayNum >= s.days[0] && dayNum <= s.days[1]);
}

export function capForDay(dayNum) {
  if (dayNum < 1) return BASELINE.pouchesPerDay + 1; // pre-plan: not judged
  const s = stageForDay(dayNum);
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
  { hours: 2160, label: '3 months', body: 'Dopamine function has substantially recovered. You are a person who does not use nicotine.' },
];

export const WITHDRAWAL_NOTES = {
  stageFlip: 'Irritability and fog peak for 2–3 days after each step down, then fade. It is on schedule — not a sign the plan is failing.',
  postQuit: 'Days 1–3 after quitting are the hardest; most physical symptoms are largely gone by day 10.',
};
