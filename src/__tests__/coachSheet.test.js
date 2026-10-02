// The coach sheet's flow, driven in Node with no DOM: the same tiny
// synchronous hook runtime as corrections.test.js (setters apply functional
// updaters in call order, effects run right after their render), plus a fake
// useRef. Each render hands back the sheet's element tree; the tests find the
// cards in it and call their handlers the way taps would. A tap's handler is
// the one from the render on screen, so two taps before the next render use
// the same closure — exactly the double-tap the sheet must survive.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fake = vi.hoisted(() => {
  let rec = null;
  let cur = null;
  return {
    reset() { rec = null; },
    render(Comp, props = {}) {
      rec ??= { slots: [], deps: [] };
      const frame = { i: 0, effects: [] };
      cur = frame;
      let out;
      try { out = Comp(props); } finally { cur = null; }
      for (const [i, fn, deps] of frame.effects) {
        const p = rec.deps[i];
        if (!p || !deps || deps.some((d, k) => d !== p[k])) { rec.deps[i] = deps; fn(); }
      }
      return out;
    },
    useState(init) {
      const i = cur.i++;
      if (!(i in rec.slots)) rec.slots[i] = typeof init === 'function' ? init() : init;
      return [rec.slots[i], (v) => { rec.slots[i] = typeof v === 'function' ? v(rec.slots[i]) : v; }];
    },
    useRef(init) { const i = cur.i++; if (!(i in rec.slots)) rec.slots[i] = { current: init }; return rec.slots[i]; },
    useEffect(fn, deps) { cur.effects.push([cur.i++, fn, deps]); },
  };
});

vi.mock('react', async (importOriginal) => ({ ...(await importOriginal()), useState: fake.useState, useRef: fake.useRef, useEffect: fake.useEffect }));

const ctx = vi.hoisted(() => ({ value: null }));
vi.mock('../state.jsx', () => ({ useApp: () => ctx.value }));
const askCoach = vi.hoisted(() => vi.fn());
vi.mock('../coach.js', () => ({ askCoach }));
vi.mock('../sessionKey.js', () => ({ getKey: () => 'test-key', subscribe: () => () => {} }));
vi.mock('../proxyConfig.js', () => ({ hasProxy: () => false, getDeviceToken: () => '', subscribe: () => () => {} }));

const { default: CoachSheet } = await import('../components/CoachSheet.jsx');
const { default: ActionCard } = await import('../components/ActionCard.jsx');
const { generatePlan } = await import('../planGenerator.js');

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-28', ...settings });
const state = { id: 'a2', status: 'active', archivedAt: null, settings, plan, events: [], celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null };
const NOW = Date.parse('2026-10-01T21:12:00-05:00');

let api;
let ids;
beforeEach(() => {
  fake.reset();
  askCoach.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  ids = 0;
  // Writes land in the state the sheet reads, as the provider's would, so a
  // saved card's Undo is offered while its event is the newest.
  const setEvents = (fn) => { ctx.value = { ...ctx.value, state: { ...ctx.value.state, events: fn(ctx.value.state.events) } }; };
  const write = vi.fn(() => {
    const id = `e${++ids}`;
    setEvents((evs) => [...evs, { id, type: 'pouch', ts: new Date().toISOString(), tzOffsetMin: -300, day: '2026-10-01', trigger: null }]);
    return id;
  });
  api = { logPouch: write, logResisted: write, appendChatTurn: vi.fn(() => 'chat1'), undoEvent: vi.fn((id) => setEvents((evs) => (evs.at(-1)?.id === id ? evs.slice(0, -1) : evs))) };
  ctx.value = { state, api, readOnly: false, tick: 0 };
});
afterEach(() => vi.useRealTimers());

const render = () => fake.render(CoachSheet, { onClose() {}, openSettings() {} });
const walk = (node, hit, out = []) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, hit, out));
  else if (node && typeof node === 'object' && node.props) {
    if (hit(node)) out.push(node);
    walk(node.props.children, hit, out);
  }
  return out;
};
const cards = (tree) => walk(tree, (n) => n.type === ActionCard).map((n) => n.props);
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const pouchNow = (id) => ({ id, name: 'log_pouch_now', input: { trigger: null } });

// Opens the sheet and sends a quick chip; the coach answers with `proposals`.
async function opened(proposals) {
  askCoach.mockResolvedValueOnce({ text: 'Here you go.', proposals, stopReason: 'tool_use' });
  const chip = walk(render(), (n) => n.type === 'button' && n.props.className === 'chip')[0];
  chip.props.onClick();
  await flush();
  return render();
}

describe('CoachSheet — a tap applies a card once', () => {
  it('two taps on Confirm before the next render save one pouch', async () => {
    askCoach.mockResolvedValue({ text: 'Logged.', proposals: [], stopReason: 'end_turn' });
    const [card] = cards(await opened([pouchNow('toolu_1')]));
    expect(card.card.status).toBe('pending');
    card.onConfirm();
    card.onConfirm();
    render(); // the queue applies the card
    const after = cards(render());
    expect(api.logPouch).toHaveBeenCalledTimes(1);
    expect(after[0].card).toMatchObject({ status: 'saved', eventId: 'e1' });
  });

  it('Confirm after Skip, before the next render, writes nothing', async () => {
    askCoach.mockResolvedValue({ text: 'Okay.', proposals: [], stopReason: 'end_turn' });
    const [card] = cards(await opened([pouchNow('toolu_1')]));
    card.onSkip();
    card.onConfirm();
    render();
    expect(api.logPouch).not.toHaveBeenCalled();
    expect(cards(render())[0].card.status).toBe('skipped');
  });

  it('Confirm all goes in order and stops at the first refusal; the rest stay pending', async () => {
    api.logPouch = vi.fn().mockReturnValueOnce('e1').mockReturnValueOnce(null);
    const shown = cards(await opened([pouchNow('toolu_1'), pouchNow('toolu_2'), pouchNow('toolu_3')]));
    const all = walk(render(), (n) => n.props['aria-label'] === undefined && n.props.children?.[1] === ' Confirm all')[0];
    expect(shown).toHaveLength(3);
    all.props.onClick();
    for (let i = 0; i < 4; i++) render();
    expect(cards(render()).map((c) => c.card.status)).toEqual(['saved', 'refused', 'pending']);
    expect(api.logPouch).toHaveBeenCalledTimes(2);
    expect(askCoach).toHaveBeenCalledTimes(1); // a pending card holds the follow-up
  });
});

describe('CoachSheet — the coach hears how it went', () => {
  it('the follow-up is only the tool_result blocks, and is saved with its outcomes', async () => {
    const [card] = cards(await opened([pouchNow('toolu_1')]));
    expect(api.appendChatTurn).toHaveBeenLastCalledWith(null, expect.objectContaining({ assistant: 'Here you go.', actions: [{ name: 'log_pouch_now', summary: 'Log a pouch now' }] }));
    askCoach.mockResolvedValueOnce({ text: 'It is in.', proposals: [], stopReason: 'end_turn' });
    card.onConfirm();
    render(); // applies the card
    render(); // the follow-up goes out after the render that holds the write
    expect(askCoach).toHaveBeenCalledTimes(2);
    const turns = askCoach.mock.calls[1][1];
    expect(turns.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved' }] });
    expect(askCoach.mock.calls[1]).toHaveLength(3); // askCoach takes no clock
    await flush();
    expect(api.appendChatTurn).toHaveBeenLastCalledWith('chat1', {
      user: 'Confirmed: Log a pouch now', assistant: 'It is in.', actions: [],
      outcomes: [{ name: 'log_pouch_now', summary: 'Log a pouch now', outcome: 'saved' }],
    });
  });

  it('typing past a pending card skips it, and its result leads the typed turn', async () => {
    await opened([pouchNow('toolu_1')]);
    askCoach.mockResolvedValueOnce({ text: 'Fine.', proposals: [], stopReason: 'end_turn' });
    const tree = render();
    const form = walk(tree, (n) => n.type === 'form')[0];
    const field = walk(tree, (n) => n.type === 'input')[0];
    field.props.onChange({ target: { value: 'not now' } });
    walk(render(), (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    expect(form).toBeTruthy();
    expect(askCoach.mock.calls[1][1].at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'skipped by the user' }, { type: 'text', text: 'not now' }] });
    expect(cards(render())[0].card.status).toBe('skipped');
    await flush();
    expect(api.logPouch).not.toHaveBeenCalled();
  });

  it('a failed follow-up rolls back its turn but keeps the saved card', async () => {
    const [card] = cards(await opened([pouchNow('toolu_1')]));
    askCoach.mockRejectedValueOnce(new Error('offline'));
    card.onConfirm();
    render();
    render();
    await flush();
    const tree = render();
    expect(cards(tree)[0].card.status).toBe('saved');
    // The save landed; only the reply didn't. The banner says so, in that order.
    expect(walk(tree, (n) => n.props.role === 'alert')[0].props.children).toBe("Saved — the coach couldn't answer just now.");
    expect(askCoach).toHaveBeenCalledTimes(2); // held: no automatic retry
  });
});

describe('CoachSheet — a typed turn never races a confirm', () => {
  const type = (words) => {
    walk(render(), (n) => n.type === 'input')[0].props.onChange({ target: { value: words } });
  };
  const submit = (tree) => walk(tree, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });

  it('Enter while a confirmed card is still being written sends nothing and skips nothing', async () => {
    const [card] = cards(await opened([pouchNow('toolu_1')]));
    askCoach.mockResolvedValue({ text: 'In.', proposals: [], stopReason: 'end_turn' });
    type('later');
    card.onConfirm();
    const writing = render(); // drawn with the card queued; its effect writes the pouch
    expect(walk(writing, (n) => n.props['aria-label'] === 'Send')[0].props.disabled).toBe(true);
    submit(writing); // Enter lands before the next render
    const after = cards(render());
    expect(api.logPouch).toHaveBeenCalledTimes(1);
    expect(after[0].card.status).toBe('saved');
    expect(askCoach.mock.calls.every(([, turns]) => turns.at(-1).content !== 'later')).toBe(true);
  });

  it('a failed typed turn at the follow-up cap starts no follow-up of its own', async () => {
    let [card] = cards(await opened([pouchNow('toolu_0')]));
    // Three automatic follow-ups in a row, each answered with one more card.
    for (let k = 1; k <= 3; k++) {
      askCoach.mockResolvedValueOnce({ text: `Round ${k}.`, proposals: [pouchNow(`toolu_${k}`)], stopReason: 'tool_use' });
      card.onConfirm();
      render();
      render();
      await flush();
      [card] = cards(render()).filter((c) => c.card.status === 'pending');
    }
    expect(askCoach).toHaveBeenCalledTimes(4);
    card.onConfirm(); // the cap: this one waits for James's words
    render();
    render();
    expect(askCoach).toHaveBeenCalledTimes(4);
    askCoach.mockRejectedValueOnce(new Error('offline'));
    type('and now?');
    submit(render());
    await flush();
    render();
    render();
    await flush();
    expect(askCoach).toHaveBeenCalledTimes(5); // the typed turn only
    expect(walk(render(), (n) => n.type === 'input')[0].props.value).toBe('and now?');
  });
});

describe('CoachSheet — an Undo the coach was told about as "saved"', () => {
  const UNDONE = [{ name: 'log_pouch_now', summary: 'Log a pouch now', outcome: 'undone' }];
  const settle = async () => { render(); render(); await flush(); return render(); };

  it('an Undo after the follow-up went out sends one more turn, in words, and saves the outcome', async () => {
    const [card] = cards(await opened([pouchNow('toolu_1')]));
    askCoach.mockResolvedValueOnce({ text: 'It is in.', proposals: [], stopReason: 'end_turn' });
    card.onConfirm();
    const [saved] = cards(await settle());
    expect(saved.card.status).toBe('saved');
    expect(saved.undoable).toBe(true);
    expect(askCoach).toHaveBeenCalledTimes(2);
    askCoach.mockResolvedValueOnce({ text: 'Taken back.', proposals: [], stopReason: 'end_turn' });
    saved.onUndo();
    const tree = await settle();
    expect(api.undoEvent).toHaveBeenCalledWith('e1');
    expect(cards(tree)[0].card.status).toBe('undone');
    expect(askCoach).toHaveBeenCalledTimes(3);
    expect(askCoach.mock.calls[2][1].at(-1)).toEqual({ role: 'user', content: 'Undone: Log a pouch now' });
    expect(api.appendChatTurn).toHaveBeenLastCalledWith('chat1', { user: 'Undone: Log a pouch now', assistant: 'Taken back.', outcomes: UNDONE, actions: [] });
    await settle();
    expect(askCoach).toHaveBeenCalledTimes(3); // told once, never again
  });

  it('an Undo before the batch is answered rides in its tool_result, with no extra turn', async () => {
    const [first, second] = cards(await opened([pouchNow('toolu_1'), pouchNow('toolu_2')]));
    askCoach.mockResolvedValue({ text: 'Okay.', proposals: [], stopReason: 'end_turn' });
    first.onConfirm();
    const [saved] = cards(await settle());
    expect(askCoach).toHaveBeenCalledTimes(1); // the second card is still pending
    saved.onUndo();
    render();
    second.onSkip();
    await settle();
    await settle();
    expect(askCoach).toHaveBeenCalledTimes(2);
    expect(askCoach.mock.calls[1][1].at(-1).content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'saved, then undone by the user' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: 'skipped by the user' },
    ]);
  });

  it('at the follow-up cap the Undo report waits for the user, then goes out after their turn', async () => {
    let [card] = cards(await opened([pouchNow('toolu_0')]));
    // Three automatic follow-ups; the third answers with words only.
    for (let k = 1; k <= 3; k++) {
      askCoach.mockResolvedValueOnce({ text: `Round ${k}.`, proposals: k < 3 ? [pouchNow(`toolu_${k}`)] : [], stopReason: 'end_turn' });
      card.onConfirm();
      const tree = await settle();
      [card] = cards(tree).filter((c) => c.card.status === 'pending');
    }
    expect(askCoach).toHaveBeenCalledTimes(4);
    const newest = cards(render()).find((c) => c.undoable);
    expect(newest.card.toolUseId).toBe('toolu_2');
    newest.onUndo();
    await settle();
    expect(askCoach).toHaveBeenCalledTimes(4); // the cap holds it
    askCoach.mockResolvedValueOnce({ text: 'Sure.', proposals: [], stopReason: 'end_turn' });
    askCoach.mockResolvedValueOnce({ text: 'Noted.', proposals: [], stopReason: 'end_turn' });
    walk(render(), (n) => n.type === 'input')[0].props.onChange({ target: { value: 'hi' } });
    walk(render(), (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
    await flush();
    await settle();
    expect(askCoach).toHaveBeenCalledTimes(6);
    expect(askCoach.mock.calls[4][1].at(-1)).toEqual({ role: 'user', content: 'hi' });
    expect(askCoach.mock.calls[5][1].at(-1)).toEqual({ role: 'user', content: 'Undone: Log a pouch now' });
  });
});
