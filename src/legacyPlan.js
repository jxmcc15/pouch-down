// The original hand-written 60-day plan, frozen as data. It is attempt 1's
// plan forever, and the golden reference the generator must reproduce.

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

const STAGES = [
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

export const LEGACY_PLAN = {
  generator: 'legacy-60',
  startDate: '2026-07-08',
  quitDate: '2026-09-05',
  totalDays: 60,
  baseline: { pouchesPerDay: 9, mg: 9 },
  stages: STAGES, // the verbatim array, now local to this file
};
