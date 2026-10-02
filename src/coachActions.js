// The allowlist between the model and the log. A model's tool call is
// untrusted input, like a backup file: nothing here evaluates text, and
// nothing here writes on its own. validateProposal turns one tool call into an
// action the app knows how to perform — exact keys, types, enums and bounds;
// days the attempt has; pouch ids from the list the prompt itself showed — or
// into a reason it can't. applyAction is the ONE place a verb is called, and it
// only runs on the user's tap; the api's own guards run again inside it.
import { TRIGGERS } from './triggers.js';
import { TOOLS, TOOL_NAMES, MAX_PROPOSALS, NOTE_MAX, COUNT_MAX, TOOL_INPUT_MAX, RESULT_MAX, livePouchesForPrompt, fmtAppDay } from './coachTools.js';
import { resolveLate, fmtHM } from './latePouch.js';
import { todayKey, dayNumberFor, isLogged, timedPouchesForDay, rawEventsForDay } from './store.js';
import { capForDay } from './plan.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const SCHEMA = Object.fromEntries(TOOLS.map((t) => [t.name, t.input_schema]));
const VERBS = new Set(['logPouch', 'logResisted', 'logLatePouch', 'voidPouch', 'logReason', 'logBackfill', 'logCorrection', 'logCheckin']);

// The headline of a card whose details can't be trusted (an invalid one): the
// verb in the app's words, never the model's.
const HEADLINE = {
  log_pouch_now: 'Log a pouch now',
  log_resisted_now: 'Log a craving resisted',
  add_late_pouch: 'Add a pouch',
  mark_mistake: 'Mark as mistake',
  add_reason: 'Add a reason',
  fill_missed_day: 'Fill in a day',
  correct_day_total: 'Correct a day',
  log_checkin: 'Morning check-in',
};
const UNKNOWN = "An action the app doesn't have";
// A reason reaches a card a person reads, and the coach as its tool_result: the
// app's words, never a field name.
const FIELD_WORDS = { day: 'day', time: 'time', triggers: 'list of reasons', note: 'note', pouch_id: 'pouch', count: 'count', streak: 'streak choice' };

export const REFUSED = "the app wouldn't save it — it may already be logged, or the day isn't in this attempt";
const OVERFLOW = `more than ${MAX_PROPOSALS} actions in one reply — ask the user to split them up`;

const parts = (...xs) => xs.filter(Boolean).join(' · ');
const pouches = (n) => `${n} ${n === 1 ? 'pouch' : 'pouches'}`;
const clock = (time) => (time === null ? 'time unknown' : fmtHM(time));

// ── field checks: each returns a reason, or null when the value will do ──

function dayProblem(state, day, today) {
  // resolveLate with no time is the app's own "is this a real calendar day".
  if (typeof day !== 'string' || !resolveLate({ day, time: null }).ok) return "that day isn't on the calendar";
  if (dayNumberFor(state, day) < 1) return 'that day is before the plan started';
  if (day > today) return 'that day is after today';
  return null;
}

function triggersProblem(list) {
  if (!Array.isArray(list)) return "the reasons didn't come as a list";
  if (list.length > TRIGGERS.length) return 'more reasons than the app has';
  if (!list.every((t) => TRIGGERS.includes(t))) return "that's not one of the app's reasons";
  if (new Set(list).size !== list.length) return 'a reason appears twice';
  return null;
}

// Control characters and bidi overrides could make a note draw as something
// else on the card — a line break, or text running backwards over the facts.
const unshowable = (c) => c <= 0x1f || c === 0x7f || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);

function noteProblem(note) {
  if (typeof note !== 'string') return "the note isn't text";
  if (note.trim().length > NOTE_MAX) return `the note is too long — ${NOTE_MAX} characters at most`;
  for (let i = 0; i < note.length; i++) if (unshowable(note.charCodeAt(i))) return "the note has characters the app can't show";
  return null;
}

// The api's own guards for a past day (backfillOk / correctionOk in state.jsx),
// asked here first so no card offers a Confirm that can only be refused.
function pastDayProblem(state, day, today) {
  if (day >= today) return "that day isn't over yet";
  if (dayNumberFor(state, day) > state.plan.totalDays) return 'that day is after the plan ends';
  return null;
}

const countProblem = (n) => (Number.isInteger(n) && n >= 0 && n <= COUNT_MAX ? null : `the count has to be a whole number from 0 to ${COUNT_MAX}`);
// An optional field may be absent or null; models send both for "not given".
const triggerProblem = (t) => (t == null || TRIGGERS.includes(t) ? null : "that's not one of the app's reasons");

// ── one builder per tool: a reason string, or { verb, args, summary, facts } ──

const BUILD = {
  log_pouch_now(state, { trigger = null }) {
    return triggerProblem(trigger) ?? {
      verb: 'logPouch', args: [trigger ?? null],
      summary: parts('Log a pouch now', trigger), facts: 'stamped when you confirm',
    };
  },
  log_resisted_now(state, { trigger = null }) {
    return triggerProblem(trigger) ?? {
      verb: 'logResisted', args: [trigger ?? null],
      summary: parts('Log a craving resisted', trigger), facts: 'stamped when you confirm',
    };
  },
  add_late_pouch(state, { day, time, triggers, note }, { today, now }) {
    const bad = dayProblem(state, day, today) ?? triggersProblem(triggers) ?? noteProblem(note);
    if (bad) return bad;
    if (time !== null && typeof time !== 'string') return "that time isn't a time of day";
    const r = resolveLate({ day, time, now });
    if (r.skipped) return "that time didn't happen on that day (the clocks changed)";
    if (!r.ok) return "that time isn't a time of day";
    if (r.future) return "that time hasn't happened yet";
    const why = triggers.join(', ');
    const n = note.trim();
    return {
      verb: 'logLatePouch', args: [{ day, time, triggers, note: n }],
      summary: parts('Add a pouch', fmtAppDay(day), clock(time), why),
      // The note is the user's own words via the model: it rides on its own
      // line (`note`), never inside the facts the app vouches for.
      facts: parts(!why && 'no reason', 'added later'), note: n,
    };
  },
  mark_mistake(state, { pouch_id }, { pouches: live }) {
    const p = live.get(pouch_id);
    if (!p) return "that pouch isn't one from the last 7 days";
    const which = p.time === null ? 'the time-unknown pouch' : `the ${fmtHM(p.time)} pouch`;
    return {
      verb: 'voidPouch', args: [pouch_id],
      summary: parts('Mark as mistake', `${which} on ${fmtAppDay(p.day)}`),
      facts: parts('stops counting', 'stays in your history'),
    };
  },
  add_reason(state, { pouch_id, triggers, note }, { pouches: live }) {
    const p = live.get(pouch_id);
    if (!p) return "that pouch isn't one from the last 7 days";
    const bad = triggersProblem(triggers) ?? noteProblem(note);
    if (bad) return bad;
    const n = note.trim();
    if (!triggers.length && !n) return 'a reason needs at least one trigger or a note';
    const which = p.time === null ? 'time-unknown pouch' : `${fmtHM(p.time)} pouch`;
    return {
      verb: 'logReason', args: [{ target: pouch_id, triggers, note: n }],
      summary: parts('Add a reason', which, triggers.join(', ') || 'a note'),
      facts: fmtAppDay(p.day), note: n,
    };
  },
  fill_missed_day(state, { day, count, streak }, { today }) {
    const bad = dayProblem(state, day, today) ?? countProblem(count);
    if (bad) return bad;
    if (streak !== 'keep' && streak !== 'break') return 'the streak has to be kept or broken';
    const late = pastDayProblem(state, day, today);
    if (late) return late;
    if (isLogged(state, day)) return 'that day is already logged';
    // Tighter than the app's own form, on purpose: the model is the untrusted
    // party. Voiding every pouch of a heavy day and filling it with 0 would
    // turn it green; a day that had pouches is fixed by hand, from Calendar.
    if (rawEventsForDay(state, day).some((e) => e.type === 'pouch')) return 'that day has pouches on it, some marked as mistakes — fill it in from Calendar if it needs fixing';
    // Mirrors BackfillForm: over the day's cap the streak breaks whatever was
    // asked, so the card never promises a kept streak the store won't give.
    const over = count > capForDay(state.plan, dayNumberFor(state, day));
    const final = over ? 'break' : streak;
    const said = over ? 'streak breaks: over cap' : final === 'keep' ? 'streak kept' : 'streak breaks';
    return {
      verb: 'logBackfill', args: [{ day, count, streak: final }],
      summary: parts(`Fill in ${fmtAppDay(day)}`, pouches(count), said),
      facts: parts(over && said, 'entered later'),
    };
  },
  correct_day_total(state, { day, count }, { today }) {
    const bad = dayProblem(state, day, today) ?? countProblem(count) ?? pastDayProblem(state, day, today);
    if (bad) return bad;
    if (!isLogged(state, day)) return 'that day has no log to correct';
    if (count < timedPouchesForDay(state, day)) return 'that total is below the pouches already logged that day';
    return {
      verb: 'logCorrection', args: [{ day, count }],
      summary: parts(`Correct ${fmtAppDay(day)}`, `total ${count}`),
      facts: 'the logged pouches stay',
    };
  },
  log_checkin(state, { sleep_hours = null, sleep_quality = null, workout = null }) {
    if (sleep_hours === null && sleep_quality === null && workout === null) return 'a check-in needs at least one answer';
    // One decimal at most: 6.5 survives a round to tenths unchanged, 6.55 doesn't.
    if (sleep_hours !== null && !(typeof sleep_hours === 'number' && sleep_hours >= 0 && sleep_hours <= 16 && Math.round(sleep_hours * 10) / 10 === sleep_hours)) return 'sleep hours need to be 0 to 16, one decimal at most';
    if (sleep_quality !== null && !(Number.isInteger(sleep_quality) && sleep_quality >= 1 && sleep_quality <= 5)) return 'sleep quality has to be a whole number from 1 to 5';
    if (workout !== null && typeof workout !== 'boolean') return 'the workout answer has to be yes or no';
    const payload = {
      ...(sleep_hours !== null ? { sleepHours: sleep_hours } : {}),
      ...(sleep_quality !== null ? { sleepQuality: sleep_quality } : {}),
      ...(workout !== null ? { workout } : {}),
    };
    const said = parts(sleep_hours !== null && `${sleep_hours}h`, sleep_quality !== null && `${sleep_quality}/5`, workout !== null && (workout ? 'workout' : 'no workout'));
    return {
      verb: 'logCheckin', args: [payload],
      summary: parts('Morning check-in', said),
      facts: 'for today',
    };
  },
};

// One tool call → { ok: true, action } or { ok: false, toolUseId, name, reason }.
// `action` = { toolUseId, name, verb, args, summary, facts, note? }: the summary is
// the card's headline and `facts` its second line — only what the headline
// doesn't already say (the consequence or qualifier) — both built here from the
// validated values — the card never shows the model's own words as fact.
// `note` (add_late_pouch, add_reason) is the trimmed note, for its own line.
export function validateProposal(state, proposal, now = Date.now()) {
  const toolUseId = typeof proposal?.id === 'string' ? proposal.id : '';
  const name = typeof proposal?.name === 'string' ? proposal.name : '';
  const no = (reason) => ({ ok: false, toolUseId, name, reason });
  if (!toolUseId) return no('the proposal came without an id');
  if (!TOOL_NAMES.includes(name)) return no("the app doesn't have that action");
  if (state?.status !== 'active') return no("a past attempt can't change");
  const input = proposal.input;
  if (!isObj(input)) return no("the proposal's details couldn't be read");
  const schema = SCHEMA[name];
  if (Object.keys(input).some((k) => !has(schema.properties, k))) return no("the proposal had a detail the app doesn't take");
  const missing = schema.required.find((k) => !has(input, k));
  if (missing) return no(`the ${FIELD_WORDS[missing]} is missing`);
  const ctx = { now, today: todayKey(new Date(now)), pouches: new Map(livePouchesForPrompt(state, now).map((p) => [p.id, p])) };
  const built = BUILD[name](state, input, ctx);
  return typeof built === 'string' ? no(built) : { ok: true, action: { toolUseId, name, ...built } };
}

// Actions that make no sense twice in one reply. Two pouches at once are
// real; marking the same pouch twice, or filling one day twice, is not.
const onceKey = ({ name, args: [a] }) => {
  if (name === 'mark_mistake') return `${name}:${a}`;
  if (name === 'add_reason') return `${name}:${a.target}`;
  if (name === 'fill_missed_day' || name === 'correct_day_total') return `${name}:${a.day}`;
  if (name === 'log_checkin') return name;
  return null;
};

// A reply's tool calls → { cards, overflow }. Cards keep the model's order: the
// first five, each `pending` (with its action) or `invalid` (with a reason).
// `overflow` is the ids past five — never shown, always answered.
export function takeProposals(state, proposals, now = Date.now()) {
  const list = Array.isArray(proposals) ? proposals : [];
  const seen = new Set();
  const cards = list.slice(0, MAX_PROPOSALS).map((p) => {
    const v = validateProposal(state, p, now);
    if (!v.ok) return { toolUseId: v.toolUseId, name: v.name, status: 'invalid', reason: v.reason };
    const key = onceKey(v.action);
    if (key && seen.has(key)) return { toolUseId: v.action.toolUseId, name: v.action.name, status: 'invalid', reason: 'the same action twice in one reply' };
    if (key) seen.add(key);
    return { toolUseId: v.action.toolUseId, name: v.action.name, status: 'pending', action: v.action };
  });
  const overflow = list.slice(MAX_PROPOSALS).map((p) => (typeof p?.id === 'string' ? p.id : '')).filter(Boolean);
  return { cards, overflow };
}

// What the coach is told about one card: `content` is short and the app's own
// words; `is_error` marks the two outcomes the coach must not report as done.
// A card still pending when this is asked for was passed over: skipped.
export function outcomeResult(card) {
  const base = { type: 'tool_result', tool_use_id: card.toolUseId };
  if (card.status === 'saved') return { ...base, content: 'saved' };
  if (card.status === 'undone') return { ...base, content: 'saved, then undone by the user' };
  if (card.status === 'refused') return { ...base, content: `refused: ${card.reason}`.slice(0, RESULT_MAX), is_error: true };
  if (card.status === 'invalid') return { ...base, content: `invalid: ${card.reason}`.slice(0, RESULT_MAX), is_error: true };
  return { ...base, content: 'skipped by the user' };
}

export const overflowResult = (toolUseId) => ({ type: 'tool_result', tool_use_id: toolUseId, content: `invalid: ${OVERFLOW}`, is_error: true });

// Every tool_use of a coach message answered, cards first, in order — the API
// refuses a turn that leaves one out.
export const resultsFor = (message) => [...(message.cards ?? []).map(outcomeResult), ...(message.overflow ?? []).map(overflowResult)];

// The user's tap. `null` from the api means its own guard said no (a day
// already logged, a pouch already voided, a day outside the attempt): that is a
// card state, never a thrown error.
export function applyAction(api, action) {
  const fn = VERBS.has(action?.verb) ? api?.[action.verb] : null;
  let id = null;
  try {
    if (typeof fn === 'function' && Array.isArray(action.args)) id = fn(...action.args);
  } catch {
    // A throw inside the api (storage full, say) wrote nothing: refused.
  }
  return typeof id === 'string' && id ? { outcome: 'saved', eventId: id } : { outcome: 'refused', reason: REFUSED };
}

// The sheet's messages → the Messages API conversation. A text-only turn stays
// `content: string`, so a chat with no actions sends the same body as before.
// A coach turn that proposed is replayed as its text + tool_use blocks; a user
// turn that answers one leads with its tool_result blocks (the API requires
// them first), then the typed text — or nothing else, for the app's follow-up.
// A tool_use whose name the app doesn't have is left out of the replay, and so
// is its tool_result: the proxy refuses any request naming a tool outside its
// list, so one invented name would otherwise refuse every later turn of the
// chat. Its card was already invalid and the coach already heard so.
export function toTurns(messages) {
  const dropped = new Set();
  return messages.map((m) => {
    if (m.role === 'assistant') {
      const proposals = m.proposals ?? [];
      const kept = proposals.filter((p) => TOOL_NAMES.includes(p?.name));
      for (const p of proposals) if (!kept.includes(p)) dropped.add(p?.id);
      const uses = kept.map(({ id, name, input }) => ({
        type: 'tool_use', id, name,
        // A runaway input is already an invalid card; replaying it whole would
        // only get the next request refused by the proxy's 2 KB clamp.
        input: isObj(input) && JSON.stringify(input).length <= TOOL_INPUT_MAX ? input : {},
      }));
      if (!proposals.length) return { role: 'assistant', content: m.text };
      // The API refuses empty content, so a turn left with nothing says '…'.
      const words = m.text || (uses.length ? '' : '…');
      return { role: 'assistant', content: [...(words ? [{ type: 'text', text: words }] : []), ...uses] };
    }
    const answered = m.results ?? [];
    const results = answered.filter((r) => !dropped.has(r?.tool_use_id));
    if (!answered.length) return { role: 'user', content: m.text };
    // Every result went with its dropped tool_use: the turn's own words remain.
    if (!results.length) return { role: 'user', content: m.text || '…' };
    return { role: 'user', content: m.auto ? results : [...results, { type: 'text', text: m.text }] };
  });
}

const known = (name) => (TOOL_NAMES.includes(name) ? name : 'unknown');
// Only a known name indexes HEADLINE: a model's 'constructor' would otherwise
// find Object's own property and write a function into the saved chat.
const summaryOf = (card) => card.action?.summary ?? (TOOL_NAMES.includes(card.name) ? HEADLINE[card.name] : UNKNOWN);

// For the saved chat: what a coach message proposed …
export const actionsOf = (cards = []) => cards.map((c) => ({ name: known(c.name), summary: summaryOf(c) }));

// … and how each one ended, on the user turn that answered it.
export const outcomesOf = (cards = []) => cards.map((c) => {
  const outcome = c.status === 'pending' ? 'skipped' : c.status;
  return { name: known(c.name), summary: summaryOf(c), outcome, ...((outcome === 'refused' || outcome === 'invalid') && c.reason ? { reason: c.reason } : {}) };
});

const WORD = { saved: 'Confirmed', undone: 'Undone', refused: "Didn't save", skipped: 'Skipped', invalid: "Couldn't be done" };

// The follow-up's user text in the saved chat, in words a reader of the vault
// understands: "Confirmed: Add a pouch · Thu Oct 1 · 4:30 PM · boredom / …".
export function renderOutcomes(outcomes) {
  return outcomes.map((o) => `${WORD[o.outcome] ?? 'Skipped'}: ${o.summary}${o.reason ? ` (${o.reason})` : ''}`).join(' / ');
}
