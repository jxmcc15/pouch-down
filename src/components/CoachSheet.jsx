import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, SendHorizontal, CheckCheck } from 'lucide-react';
import { useApp } from '../state.jsx';
import { askCoach } from '../coach.js';
import { takeProposals, applyAction, resultsFor, toTurns, actionsOf, outcomesOf, renderOutcomes } from '../coachActions.js';
import { UNDO_WINDOW_MS, isJustLogged } from '../justLogged.js';
import { getKey, subscribe } from '../sessionKey.js';
import { hasProxy, getDeviceToken, subscribe as subscribeToken } from '../proxyConfig.js';
import ActionCard from './ActionCard.jsx';

const QUICK = ['I want one right now', 'How am I doing?', 'Remind me why', 'I forgot to log one', 'That last tap was a mistake'];
// Automatic follow-ups in a row before the coach waits for the user to type:
// a coach that keeps proposing can't keep itself talking.
const MAX_CHAIN = 3;
// Undo is shown for 12 s, like the log toast and Fix this day; the api honours
// it 3 s longer so a tap landing as the chip leaves still counts.
const UNDO_SHOWN_MS = UNDO_WINDOW_MS - 3000;

// Each of these names the one thing that fixes it: retyping a key does nothing
// when it's the device token the proxy turned down.
function errorCopy(e) {
  if (e.message === 'bad-key') return 'That API key was rejected — double-check it in Settings.';
  if (e.message === 'no-key') return 'Add your API key in Settings first.';
  if (e.message === 'no-device-token') return 'Paste your device token in Settings to turn the coach on.';
  if (e.message === 'bad-device-token') return 'That device token was turned down — paste a fresh one in Settings.';
  return `Couldn't reach the coach: ${e.message}`;
}

// The newest coach message: the only one whose cards can still be pending.
const latestCoach = (messages) => messages.findLastIndex((m) => m.role === 'assistant');
// A coach message whose cards have outcomes the coach hasn't been told yet.
const owes = (m) => !!m && (m.cards?.length ?? 0) > 0 && !m.answered;
// One card moved on, wherever it sits (a saved card can still be undone after
// the coach has replied to it) — but only from the state the move starts at.
// Every caller passes this to a functional update, so it reads the card as it
// is now, not as the render that drew the button saw it: a Skip that landed
// first can't be overwritten by a Saved, nor a Saved by a Skip.
const moveCard = (messages, toolUseId, from, patch) => messages.map((m) => (m.cards?.some((c) => c.toolUseId === toolUseId && c.status === from)
  ? { ...m, cards: m.cards.map((c) => (c.toolUseId === toolUseId ? { ...c, ...patch } : c)) }
  : m));
// Undos the coach hasn't heard about: a card undone after its batch was
// answered (it was told "saved"). `told` on a message lists the cards whose
// undo already went out — in the batch's own results, or in a later turn.
const undoneIds = (m) => (m.cards ?? []).filter((c) => c.status === 'undone').map((c) => c.toolUseId);
const unsaidUndos = (messages) => messages.flatMap((m) => (m.answered ? (m.cards ?? []).filter((c) => c.status === 'undone' && !(m.told ?? []).includes(c.toolUseId)) : []));
const markTold = (messages, ids) => messages.map((m) => (m.cards?.some((c) => ids.includes(c.toolUseId)) ? { ...m, told: [...new Set([...(m.told ?? []), ...ids])] } : m));
const unmarkTold = (messages, ids) => messages.map((m) => (m.told?.some((id) => ids.includes(id)) ? { ...m, told: m.told.filter((id) => !ids.includes(id)) } : m));
// What a confirmed card becomes.
const afterApply = (r) => (r.outcome === 'saved' ? { status: 'saved', eventId: r.eventId } : { status: 'refused', reason: r.reason });
const pendingCard = (messages, toolUseId) => {
  const card = messages[latestCoach(messages)]?.cards?.find((c) => c.toolUseId === toolUseId);
  return card?.status === 'pending' ? card : null;
};

// The coach's reply as a message: its words, and its proposals validated into
// cards. A past attempt is never sent tools, so it never gets a card.
function coachMessage(state, readOnly, reply) {
  if (readOnly) return { role: 'assistant', text: reply.text, proposals: [], cards: [], overflow: [] };
  return { role: 'assistant', text: reply.text, proposals: reply.proposals, ...takeProposals(state, reply.proposals, Date.now()) };
}

// Saved only once the coach answered: a failed request leaves no trace. A
// storage failure here must not undo a reply that did arrive: keep it on
// screen and carry on — the next turn simply tries to save again.
function saveTurn(api, chatIdRef, turn) {
  try {
    chatIdRef.current = api.appendChatTurn(chatIdRef.current, turn) ?? chatIdRef.current;
  } catch {
    // nothing: the reply stays, no error is shown
  }
}

// Messages on screen are { role, text, … }: a coach message carries the raw
// `proposals` (replayed to the API), their `cards`, any `overflow` ids, and
// `answered` once its results went out (`held` when a follow-up failed — the
// results then lead the next typed turn). A user message that answered cards
// carries `results` and `outcomes`; `auto` marks the app's own follow-up,
// which the API sees and the screen doesn't draw. toTurns() builds the API
// conversation from this one list.
export default function CoachSheet({ onClose, openSettings }) {
  const { state, api, readOnly } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [chain, setChain] = useState(0); // automatic follow-ups since the user last typed
  const [queue, setQueue] = useState([]); // card ids confirmed and not yet written, in order
  const [undoHeld, setUndoHeld] = useState(false); // an undo report failed: wait for the user's words
  const scrollRef = useRef(null);
  // One saved chat per opening of the sheet: null until the first reply lands,
  // then the id appendChatTurn handed back, so later turns join the same chat.
  const chatIdRef = useRef(null);
  // The key is held for the session, so the sheet follows it: add one in
  // Settings and the coach opens here without a reload.
  const [apiKey, setApiKey] = useState(getKey);
  useEffect(() => subscribe(setApiKey), []);
  // The other way in: a proxy holding the key, unlocked by a token that stays on
  // this device. Either one is enough to open the chat, and both are watched so
  // filling one in Settings opens the coach here without a reload.
  const [deviceToken, setDeviceToken] = useState(getDeviceToken);
  useEffect(() => subscribeToken(setDeviceToken), []);
  const proxyOn = hasProxy();
  const viaProxy = proxyOn && Boolean(deviceToken.trim());
  const canRun = viaProxy || Boolean(apiKey.trim());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999, behavior: 'smooth' });
  }, [messages, busy]);

  // A tap on Confirm only asks: it joins the queue (once, however many taps
  // land before the next render), and the effect below does the writing. So a
  // double tap, or a Confirm that lands after a Skip, can never save twice or
  // save a card that was passed over — the effect reads the card as committed.
  const confirm = (toolUseId) => setQueue((q) => (q.includes(toolUseId) ? q : [...q, toolUseId]));
  const confirmAll = (ids) => setQueue((q) => (q.length ? q : ids));
  const skip = (toolUseId) => setMessages((cur) => moveCard(cur, toolUseId, 'pending', { status: 'skipped' }));

  // The queue is walked one card per render, so each api call is checked
  // against the log the one before it wrote — the same api method the sheets
  // call, through the one place a verb is ever called (applyAction). The first
  // refusal stops it; the cards after it stay pending.
  useEffect(() => {
    if (!queue.length) return;
    const [next, ...rest] = queue;
    const card = pendingCard(messages, next);
    if (!card) {
      setQueue(rest);
      return;
    }
    const r = applyAction(api, card.action);
    setMessages((cur) => moveCard(cur, next, 'pending', afterApply(r)));
    setQueue(r.outcome === 'saved' ? rest : []);
  }, [queue, messages, api]);

  // Undo is the api's own: only the newest event, only inside its window. The
  // chip shows for 12 s; the provider's once-a-second tick re-renders the
  // sheet, so it leaves on time.
  const undoable = (card) => {
    const last = state.events[state.events.length - 1];
    return card.status === 'saved' && last?.id === card.eventId && isJustLogged(last, UNDO_SHOWN_MS);
  };
  const undo = (card) => {
    if (!undoable(card)) return;
    api.undoEvent(card.eventId);
    setMessages((cur) => moveCard(cur, card.toolUseId, 'saved', { status: 'undone' }));
  };

  // Once every card of the newest coach message is resolved, the coach hears
  // how they went — one call for the whole batch — so it can say "4:30 is in",
  // or say honestly that one didn't save. Runs after the render that resolved
  // the last card (and only once the queue is empty), so `state` already holds
  // what was written. At most MAX_CHAIN in a row; after that the results wait
  // for the user's next words.
  useEffect(() => {
    if (busy || queue.length || chain >= MAX_CHAIN) return;
    const i = latestCoach(messages);
    const m = messages[i];
    if (!owes(m) || m.held || m.cards.some((c) => c.status === 'pending')) return;
    const outcomes = outcomesOf(m.cards);
    const auto = { role: 'user', text: renderOutcomes(outcomes), results: resultsFor(m), outcomes, auto: true };
    const next = [...messages.map((x, k) => (k === i ? { ...x, answered: true, told: undoneIds(x) } : x)), auto];
    setMessages(next);
    setChain((c) => c + 1);
    setBusy(true);
    setError(null);
    askCoach(state, toTurns(next), getKey())
      .then((reply) => {
        const coach = coachMessage(state, readOnly, reply);
        setMessages((cur) => [...cur, coach]);
        saveTurn(api, chatIdRef, { user: auto.text, assistant: coach.text, outcomes, actions: actionsOf(coach.cards) });
      }, (e) => {
        // The cards' writes already landed: say so first, so a failed reply
        // never reads as a failed save.
        setError(m.cards.some((c) => c.status === 'saved') ? "Saved — the coach couldn't answer just now." : errorCopy(e));
        // The follow-up rolls back and isn't retried on its own; the cards keep
        // their states (the events are saved), and their results lead the next
        // thing the user types.
        setMessages((cur) => cur.filter((x) => x !== auto).map((x, k) => (k === i ? { ...x, answered: false, held: true } : x)));
      })
      .finally(() => setBusy(false));
  }, [messages, busy, queue, chain, state, api, readOnly]);

  // An Undo that lands after its batch was answered: the coach was told
  // "saved", and the saved chat says so too. One more automatic turn, in
  // words (a tool_result may only follow its tool_use), sets the record
  // straight — several undos fold into one. It never cuts in front of a batch
  // still owed its results, counts toward MAX_CHAIN like any follow-up, and
  // after a failure waits for the user's next words.
  useEffect(() => {
    if (busy || queue.length || chain >= MAX_CHAIN || undoHeld) return;
    const late = unsaidUndos(messages);
    if (!late.length || owes(messages[latestCoach(messages)])) return;
    const ids = late.map((c) => c.toolUseId);
    const outcomes = outcomesOf(late);
    const auto = { role: 'user', text: renderOutcomes(outcomes), outcomes, auto: true };
    const next = [...markTold(messages, ids), auto];
    setMessages(next);
    setChain((c) => c + 1);
    setBusy(true);
    setError(null);
    askCoach(state, toTurns(next), getKey())
      .then((reply) => {
        const coach = coachMessage(state, readOnly, reply);
        setMessages((cur) => [...cur, coach]);
        saveTurn(api, chatIdRef, { user: auto.text, assistant: coach.text, outcomes, actions: actionsOf(coach.cards) });
      }, () => {
        // The undo itself landed; only the coach's answer didn't.
        setError("Undone — the coach couldn't answer just now.");
        setMessages((cur) => unmarkTold(cur.filter((x) => x !== auto), ids));
        setUndoHeld(true);
      })
      .finally(() => setBusy(false));
  }, [messages, busy, queue, chain, undoHeld, state, api, readOnly]);

  const send = async (text) => {
    const words = text.trim();
    // Not while a confirmed card is still being written: its skip would land
    // on a pouch that saved, and the coach would hear "skipped".
    if (!words || busy || queue.length) return;
    setError(null);
    // Typing past pending cards skips them; whatever the coach hasn't been told
    // about the newest cards leads this turn, before the words.
    const i = latestCoach(messages);
    const m = messages[i];
    let base = messages;
    let answer = {};
    let passed = [];
    if (owes(m)) {
      passed = m.cards.filter((c) => c.status === 'pending').map((c) => c.toolUseId);
      const resolved = { ...m, cards: m.cards.map((c) => (c.status === 'pending' ? { ...c, status: 'skipped' } : c)), answered: true, told: undoneIds(m) };
      base = messages.map((x, k) => (k === i ? resolved : x));
      answer = { results: resultsFor(resolved), outcomes: outcomesOf(resolved.cards) };
    }
    const mine = { role: 'user', text: words, ...answer };
    const next = [...base, mine];
    setMessages(next);
    setInput('');
    setBusy(true);
    const chainBefore = chain;
    const undoHeldBefore = undoHeld;
    setChain(0);
    setUndoHeld(false);
    try {
      const coach = coachMessage(state, readOnly, await askCoach(state, toTurns(next), getKey()));
      setMessages((cur) => [...cur, coach]);
      saveTurn(api, chatIdRef, { user: words, assistant: coach.text, actions: actionsOf(coach.cards), outcomes: answer.outcomes });
    } catch (e) {
      setError(errorCopy(e));
      // Roll back the optimistic message and the skips it made — and only
      // those: an Undo tapped while the request was out stays undone.
      setMessages((cur) => cur.filter((x) => x !== mine).map((x, k) => (k === i && owes(m)
        ? { ...x, answered: false, cards: x.cards.map((c) => (passed.includes(c.toolUseId) && c.status === 'skipped' ? { ...c, status: 'pending' } : c)) }
        : x)));
      // The chain count and a held undo report come back too: a failed turn
      // must not start a follow-up nobody asked for.
      setChain(chainBefore);
      setUndoHeld(undoHeldBefore);
      setInput(text);
    } finally {
      setBusy(false);
    }
  };

  const newest = latestCoach(messages);
  const pendingCount = messages[newest]?.cards?.filter((c) => c.status === 'pending').length ?? 0;

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="sheet"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        role="dialog"
        aria-label="AI coach"
        style={{ display: 'flex', flexDirection: 'column', height: '78dvh' }}
      >
        <div className="sheet-handle" />
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <Sparkles size={18} color="var(--accent-bright)" />
          <h3 style={{ fontSize: 16 }}>Coach</h3>
          <span className="small faint">knows your plan & your log · proposes, you confirm</span>
        </div>

        {!canRun ? (
          <div className="card" style={{ textAlign: 'center', padding: 28 }}>
            <Sparkles size={22} color="var(--accent-bright)" />
            <p className="muted small" style={{ margin: '10px 0 16px' }}>
              {proxyOn ? (
                <>
                  The coach runs through your own proxy — paste this device's
                  token in Settings once and it's on. Once per device, not once
                  per session.
                </>
              ) : (
                <>
                  The coach runs on your own Claude API key — it's kept for this
                  session only and costs pennies a day. Add it in Settings; your
                  password manager can fill it in next time.
                </>
              )}
            </p>
            {/* App hands this in already pointed at Settings' Coach connection
                sheet; called bare so the click event never rides along. */}
            <button className="btn btn-accent" onClick={() => openSettings()}>
              Open Settings
            </button>
          </div>
        ) : (
          <>
            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
              {messages.length === 0 && (
                <p className="small muted" style={{ textAlign: 'center', margin: 'auto 20px' }}>
                  Chats are fresh each time — the coach already knows today's
                  numbers, your stage, and your triggers.
                </p>
              )}
              {messages.map((m, i) => (m.auto ? null : (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 0, alignSelf: m.role === 'user' ? 'flex-end' : 'stretch', maxWidth: m.role === 'user' ? '85%' : '100%' }}>
                  {(m.role === 'user' || m.text) && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        maxWidth: m.role === 'user' ? '100%' : '85%',
                        padding: '10px 14px',
                        borderRadius: 16,
                        fontSize: 15,
                        userSelect: 'text',
                        WebkitUserSelect: 'text',
                        background: m.role === 'user' ? 'var(--accent)' : 'var(--surface-strong)',
                        border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                        color: m.role === 'user' ? '#fff' : 'var(--fg)',
                      }}
                    >
                      {m.text}
                    </motion.div>
                  )}
                  {!readOnly && m.cards?.length > 0 && (
                    <AnimatePresence initial={false}>
                      {i === newest && pendingCount > 1 && (
                        <motion.div key="all" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', damping: 26, stiffness: 240 }} style={{ overflow: 'hidden' }}>
                          <motion.button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy || queue.length > 0}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => confirmAll(m.cards.filter((c) => c.status === 'pending').map((c) => c.toolUseId))}
                            style={{ width: '100%', minHeight: 44, marginTop: 8, color: 'var(--accent-bright)' }}
                          >
                            <CheckCheck size={17} aria-hidden="true" /> Confirm all
                          </motion.button>
                        </motion.div>
                      )}
                      {m.cards.map((c) => (
                        <ActionCard
                          key={c.toolUseId}
                          card={c}
                          busy={busy || queue.length > 0}
                          undoable={undoable(c)}
                          onConfirm={() => confirm(c.toolUseId)}
                          onSkip={() => skip(c.toolUseId)}
                          onUndo={() => undo(c)}
                        />
                      ))}
                    </AnimatePresence>
                  )}
                </div>
              )))}
              {busy && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="row small muted"
                  style={{ gap: 6, padding: '4px 8px' }}
                >
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                      style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--fg-muted)' }}
                    />
                  ))}
                </motion.div>
              )}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="small"
                  style={{ color: 'var(--red)', padding: '6px 2px' }}
                  role="alert"
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {messages.length === 0 && (
              <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {QUICK.map((q) => (
                  <button key={q} className="chip" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            )}

            <form
              className="row"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Talk to your coach…"
                aria-label="Message the coach"
                style={{ flex: 1 }}
              />
              <motion.button
                type="submit"
                className="btn btn-accent"
                style={{ minWidth: 52, padding: 0 }}
                whileTap={{ scale: 0.94 }}
                disabled={busy || queue.length > 0 || !input.trim()}
                aria-label="Send"
              >
                <SendHorizontal size={19} />
              </motion.button>
            </form>
          </>
        )}
      </motion.div>
    </>
  );
}
