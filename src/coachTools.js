// The coach's vocabulary: one Claude tool per api method it may PROPOSE. This
// file names the actions and shows the model what it may point at; it calls
// nothing. coachActions.js validates whatever comes back, and the user's tap on
// a card is the only thing that ever writes. The forbidden list — starting or
// ending an attempt, the plan or quit date, the device token or session key,
// the recovery path, price and meal times — has no tool here, so the model
// cannot even name it.
import { TRIGGERS } from './triggers.js';
import { liveEvents, todayKey, triggersFor } from './store.js';
import { dayKeyOf, localHM } from './time.js';

export const MAX_PROPOSALS = 5;
// Room for a short reply plus up to five tool calls. The Worker's clamp is the
// same number (guard.js LIMITS.maxTokens), pinned by coachProxyPin.test.js.
export const MAX_TOKENS = 800;
export const NOTE_MAX = 140;
export const COUNT_MAX = 60;
// The Worker refuses a replayed tool_use whose input is bigger than this, and a
// tool_result longer than RESULT_MAX; the app keeps under both on its own.
export const TOOL_INPUT_MAX = 2048;
export const RESULT_MAX = 500;
const PROMPT_DAYS = 7;
const PROMPT_POUCHES = 60;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
// Calendar arithmetic on UTC noon, so no device zone or DST can move a day.
const noonOf = (day) => new Date(`${day}T12:00:00Z`);

// "Thu Oct 1" for an app day — the day the user means, never a reading of a
// timestamp in whatever zone the phone is in now.
export function fmtAppDay(day) {
  const d = noonOf(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const DAY = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'The app day, YYYY-MM-DD. Days run 4 AM to 4 AM.' };
const TIME = { type: ['string', 'null'], pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'Wall-clock HH:MM, 24h, on that day; null when the user does not remember.' };
const TRIGGER = { type: 'string', enum: TRIGGERS };
const TRIGGER_LIST = { type: 'array', items: TRIGGER, maxItems: TRIGGERS.length, uniqueItems: true };
const NOTE = { type: 'string', maxLength: NOTE_MAX };
const POUCH_ID = { type: 'string', description: 'An id from the pouch list in the system prompt, copied exactly.' };
const COUNT = { type: 'integer', minimum: 0, maximum: COUNT_MAX };
const shape = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: 'log_pouch_now',
    description: 'Propose logging a pouch the user is taking right now. The app stamps the time when the user confirms.',
    input_schema: shape({ trigger: TRIGGER }),
  },
  {
    name: 'log_resisted_now',
    description: 'Propose logging a craving the user just resisted.',
    input_schema: shape({ trigger: TRIGGER }),
  },
  {
    name: 'add_late_pouch',
    description: 'Propose adding a pouch the user forgot to log: the app day it belongs to, the time it happened (or null), and why.',
    input_schema: shape({ day: DAY, time: TIME, triggers: TRIGGER_LIST, note: NOTE }, ['day', 'time', 'triggers', 'note']),
  },
  {
    name: 'mark_mistake',
    description: 'Propose marking a logged pouch as an accidental tap. It stops counting and stays in the history.',
    input_schema: shape({ pouch_id: POUCH_ID }, ['pouch_id']),
  },
  {
    name: 'add_reason',
    description: 'Propose adding why a logged pouch happened: triggers, a note, or both.',
    input_schema: shape({ pouch_id: POUCH_ID, triggers: TRIGGER_LIST, note: NOTE }, ['pouch_id', 'triggers', 'note']),
  },
  {
    name: 'fill_missed_day',
    description: 'Propose filling in a past day that has no log: how many pouches, and whether the streak keeps or breaks. Over the cap of that day, the streak breaks.',
    input_schema: shape({ day: DAY, count: COUNT, streak: { type: 'string', enum: ['keep', 'break'] } }, ['day', 'count', 'streak']),
  },
  {
    name: 'correct_day_total',
    description: 'Propose raising the total of a logged past day to what it really was.',
    input_schema: shape({ day: DAY, count: COUNT }, ['day', 'count']),
  },
  {
    name: 'log_checkin',
    description: 'Propose the morning check-in: hours slept, sleep quality 1 to 5, and whether the user worked out. At least one of the three.',
    input_schema: shape({
      sleep_hours: { type: 'number', minimum: 0, maximum: 16 },
      sleep_quality: { type: 'integer', minimum: 1, maximum: 5 },
      workout: { type: 'boolean' },
    }),
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);

// The pouches the coach may point at: live (a voided pouch is gone), from the
// last 7 app days, newest first, at most 60. The prompt prints exactly this
// list and coachActions.js accepts exactly these ids, so the model can never
// name a pouch the user hasn't been shown — or one from another attempt.
// `time` is the wall clock where the pouch was logged (localHM), null when its
// time is unknown.
export function livePouchesForPrompt(state, now = Date.now()) {
  const today = todayKey(new Date(now));
  const from = new Date(noonOf(today).getTime() - (PROMPT_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  return liveEvents(state)
    .filter((e) => e.type === 'pouch' && typeof e.id === 'string')
    .map((e) => ({ e, day: dayKeyOf(e) }))
    .filter(({ day }) => day >= from && day <= today)
    .sort((a, b) => (a.day === b.day ? Date.parse(b.e.ts) - Date.parse(a.e.ts) : a.day < b.day ? 1 : -1))
    .slice(0, PROMPT_POUCHES)
    .map(({ e, day }) => {
      const { h, m } = localHM(e);
      return { id: e.id, day, time: e.timeKnown === false ? null : `${pad(h)}:${pad(m)}`, trigger: triggersFor(state, e).join(', ') || null };
    });
}

// "Now", as the coach should read it: the app day (4am rule), the phone's wall
// clock, and that day's weekday. 2:30 AM on Friday is still Thursday's app day.
export function promptClock(now = Date.now()) {
  const d = new Date(now);
  const day = todayKey(d);
  return { day, time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, weekday: WEEKDAYS[noonOf(day).getUTCDay()] };
}
