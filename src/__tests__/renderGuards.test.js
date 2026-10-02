// wellFormed gates every root that reaches these components, so this is belt
// to those braces: a stored string that turned into an object must render as
// nothing, never throw "Objects are not valid as a React child" mid-tab.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePlan } from '../planGenerator.js';
import { asText } from '../text.js';

const app = vi.hoisted(() => ({ state: null }));
vi.mock('../state.jsx', () => ({ useApp: () => ({ state: app.state, tick: 0, readOnly: false }) }));

const { default: TodayLog } = await import('../components/TodayLog.jsx');
const { default: HistoryTimeline } = await import('../components/HistoryTimeline.jsx');
const { default: PlanView } = await import('../components/PlanView.jsx');
const { default: ActionCard, Footer: ActionCardFooter } = await import('../components/ActionCard.jsx');
const { PresenceContext } = await import('framer-motion');

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
const DAY = '2026-09-25';
const hostile = [
  { id: 'p1', ts: `${DAY}T14:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null,
    ctx: { nth: 1, cap: 9, slotId: 'x', slotLabel: { evil: true }, slotAt: `${DAY}T13:00:00.000Z`, firstSlotAt: `${DAY}T13:00:00.000Z` } },
  { id: 'r1', ts: `${DAY}T14:00:05.000Z`, tzOffsetMin: -300, day: DAY, type: 'reason', trigger: null, target: 'p1', triggers: [{ no: 1 }, 'stress'], note: { evil: true } },
  { id: 'x1', ts: `${DAY}T15:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'resisted', trigger: { evil: true } },
  { id: 'c1', ts: `${DAY}T13:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'checkin', trigger: null, source: 'manual', sleepQuality: { deep: true }, sleepHours: 'seven' },
  // A string `late` and an object `enteredAt` are not a late pouch.
  { id: 'p2', ts: `${DAY}T16:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null, late: 'yes', enteredAt: {} },
  { id: 'p3', ts: `${DAY}T17:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null, late: true, timeKnown: false, enteredAt: `${DAY}T17:00:00.000Z` },
  { id: 'p4', ts: `${DAY}T18:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null },
  { id: 'v1', ts: `${DAY}T18:30:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'void', target: 'p4', trigger: null },
  { id: 'v2', ts: `${DAY}T18:31:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'void', target: { evil: true }, trigger: null },
];
const count = (out, s) => out.split(s).length - 1;
// The three row facts, each exactly once: p3 is the only real late pouch and
// the only untimed one, p4 the only mistake. The strike sits on p4's time and
// verdict — two spans, one row. A void draws no row of its own: without v2
// (target not a string) the output is unchanged, and without v1 the strike
// and "mistake" are gone with nothing left in their place.
const expectRowFacts = (render) => {
  const out = render();
  expect(count(out, 'time unknown')).toBe(1);
  expect(count(out, 'added later')).toBe(1);
  expect(count(out, 'mistake')).toBe(1);
  expect(count(out, 'line-through')).toBe(2);
  app.state = { ...app.state, events: hostile.filter((e) => e.id !== 'v2') };
  expect(render()).toBe(out);
  app.state = { ...app.state, events: hostile.filter((e) => e.type !== 'void') };
  const unvoided = render();
  expect(count(unvoided, 'line-through')).toBe(0);
  expect(count(unvoided, 'mistake')).toBe(0);
};
// The first stage carries the hostile name/tagline/label; the first stage
// with a shopping line (still ahead on day 5) carries a hostile `what`.
const shopAt = plan.stages.findIndex((s) => s.shopBefore);
const attempt = () => ({
  id: 'a2', status: 'active', archivedAt: null, settings, events: hostile,
  plan: {
    ...plan,
    stages: plan.stages.map((s, i) => {
      if (i === 0) return { ...s, name: { bad: 1 }, tagline: { evil: true }, slots: s.slots.map((sl, j) => (j === 0 ? { ...sl, label: 42 } : sl)) };
      if (i === shopAt) return { ...s, shopBefore: { ...s.shopBefore, what: { evil: true } } };
      return s;
    }),
  },
  celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null,
});

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(`${DAY}T17:00:00.000Z`)); app.state = attempt(); });
afterEach(() => { vi.useRealTimers(); app.state = null; });

describe('asText', () => {
  it('passes strings and numbers through, and blanks everything else', () => {
    expect(asText('hi')).toBe('hi');
    expect(asText(7)).toBe('7');
    expect(asText(null)).toBe('');
    expect(asText(undefined)).toBe('');
    expect(asText({ a: 1 })).toBe('');
    expect(asText(['x'])).toBe('');
    expect(asText(NaN)).toBe('');
  });
});

describe('display components survive hostile stored strings', () => {
  it('TodayLog renders the pouch row without throwing or printing [object Object]', () => {
    const out = renderToStaticMarkup(createElement(TodayLog));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('stress'); // the one real trigger survives
    expectRowFacts(() => renderToStaticMarkup(createElement(TodayLog)));
  });
  it('HistoryTimeline renders the day, its rows, and nothing garbled', () => {
    const out = renderToStaticMarkup(createElement(HistoryTimeline));
    expect(out).not.toContain('[object Object]');
    expect(out).not.toContain('NaN'); // sleepHours: 'seven' never reaches fmtHours
    expect(out).toContain('check-in');
    expect(out).toContain('resisted');
    // today's section is open by default for a live attempt
    expectRowFacts(() => renderToStaticMarkup(createElement(HistoryTimeline)));
  });
  it('PlanView renders every stage, with the hostile name and slot label blank', () => {
    // Meal times only matter to PlanView's footer; the other screens read them
    // for slot timing, which wellFormed guards on its own.
    app.state = { ...app.state, settings: { ...settings, mealTimes: { breakfast: { a: 1 }, lunch: { b: 1 }, dinner: { c: 1 } } } };
    const out = renderToStaticMarkup(createElement(PlanView));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('House rules');
    expect(out).toContain('Buy'); // the shopping line rendered, its hostile item blank
  });
});

// ── the coach's cards (2026-10-02) ──────────────────────────────────────────

describe('ActionCard draws each state from the validated action, never the model\'s words', () => {
  const action = { toolUseId: 'toolu_1', name: 'add_late_pouch', verb: 'logLatePouch', args: [], summary: 'Add a pouch · Thu Oct 1 · 4:30 PM · boredom', facts: 'Thu Oct 1 · 4:30 PM · boredom · added later' };
  const card = (status, extra = {}) => ({ toolUseId: 'toolu_1', name: 'add_late_pouch', status, action, ...extra });
  const draw = (props) => renderToStaticMarkup(createElement(ActionCard, { onConfirm() {}, onSkip() {}, onUndo() {}, ...props }));
  const buttons = (out) => out.match(/<button[^>]*>/g) ?? [];
  // A button's floor: its inline min-height if it has one, else its class's
  // from index.css. 44 is the minimum, not the target — .btn keeps its 48.
  // (readFileSync is the chips block's import below; it has landed by the time
  // any test runs.)
  const minHeight = (tag) => {
    const inline = tag.match(/min-height:(\d+)px/);
    if (inline) return Number(inline[1]);
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    const cls = tag.match(/class="([^" ]+)/)[1];
    return Number(css.match(new RegExp(`\\n\\.${cls} \\{[^}]*?min-height: (\\d+)px`))?.[1] ?? 0);
  };

  it('pending: headline, facts, Skip and Confirm, both 44px', () => {
    const out = draw({ card: card('pending') });
    expect(out).toContain('Add a pouch · Thu Oct 1 · 4:30 PM · boredom');
    expect(out).toContain('Thu Oct 1 · 4:30 PM · boredom · added later');
    expect(out).toContain('aria-label="Confirm: Add a pouch · Thu Oct 1 · 4:30 PM · boredom"');
    expect(out).toContain('aria-label="Skip: Add a pouch · Thu Oct 1 · 4:30 PM · boredom"');
    expect(out).not.toContain('add_late_pouch');
    expect(buttons(out)).toHaveLength(2);
    for (const b of buttons(out)) expect(minHeight(b)).toBeGreaterThanOrEqual(44);
  });
  it('pending while busy: both buttons disabled', () => {
    const bs = buttons(draw({ card: card('pending'), busy: true }));
    expect(bs).toHaveLength(2);
    for (const b of bs) expect(b).toContain('disabled');
  });
  it('saved: "Saved", an Undo chip only while undoable, never a second Confirm', () => {
    const live = draw({ card: card('saved', { eventId: 'e1' }), undoable: true });
    expect(live).toContain('Saved');
    expect(live).toContain('aria-label="Undo: Add a pouch · Thu Oct 1 · 4:30 PM · boredom"');
    expect(live).not.toContain('Confirm');
    expect(live).not.toContain('add_late_pouch');
    expect(buttons(live)).toHaveLength(1);
    expect(minHeight(buttons(live)[0])).toBeGreaterThanOrEqual(44);
    expect(buttons(draw({ card: card('saved', { eventId: 'e1' }), undoable: false }))).toHaveLength(0);
  });
  it('refused: amber "Didn’t save — reason", no buttons', () => {
    const out = draw({ card: card('refused', { reason: "the app wouldn't save it" }) });
    expect(out).toContain('Didn’t save — the app wouldn&#x27;t save it');
    expect(out).toContain('var(--amber)');
    expect(out).not.toContain('Error');
    expect(buttons(out)).toHaveLength(0);
  });
  it('skipped and undone: the headline struck, no buttons', () => {
    for (const [status, word] of [['skipped', 'Skipped'], ['undone', 'Undone']]) {
      const out = draw({ card: card(status) });
      expect(out).toContain(word);
      expect(out).toContain('line-through');
      expect(buttons(out)).toHaveLength(0);
    }
  });
  it('invalid: the app\'s sentence and the reason, no buttons, no model text', () => {
    const out = draw({ card: { toolUseId: 'toolu_9', name: 'drop_everything', status: 'invalid', reason: 'unknown action' } });
    expect(out).toContain('The coach proposed something the app can&#x27;t do');
    expect(out).toContain('unknown action');
    expect(out).not.toContain('drop_everything');
    expect(buttons(out)).toHaveLength(0);
  });
  it('a name off the icon table draws the fallback icon, never a prototype key', () => {
    // ICON['constructor'] is Object — rendered as a component it would throw.
    const out = draw({ card: { ...card('pending'), name: 'constructor' } });
    expect(out).toContain('Confirm');
  });
  it('a footer fading out takes no taps: a second Confirm can never save twice', () => {
    // AnimatePresence keeps the old footer mounted, handlers and all, through
    // its exit spring. The node test can't drive an exit, so it draws the
    // footer the way AnimatePresence does while one leaves: not present.
    const leaving = (c) => renderToStaticMarkup(createElement(PresenceContext.Provider, { value: { isPresent: false, onExitComplete() {}, register: () => () => {}, initial: false, custom: undefined, id: 'x' } },
      createElement(ActionCardFooter, { card: c, headline: action.summary, undoable: true, onConfirm() {}, onSkip() {}, onUndo() {} })));
    for (const c of [card('pending'), card('saved', { eventId: 'e1' })]) {
      const bs = buttons(leaving(c));
      expect(bs.length).toBeGreaterThan(0);
      for (const b of bs) expect(b).toContain('disabled');
    }
    for (const b of buttons(draw({ card: card('pending') }))) expect(b).not.toContain('disabled');
  });
});

// Imported here, not above, so the ActionCard block keeps its own top. The
// vi.mock of state.jsx is hoisted, so the toast reads app.state like the rest.
const { default: LogToast } = await import('../components/LogToast.jsx');
const { default: SOSOverlay } = await import('../components/SOSOverlay.jsx');
const { readFileSync } = await import('node:fs');

describe('reason chips are 44px tall on the log toast and the SOS overlay', () => {
  it('LogToast: undo and every trigger chip carry min-height 44 inline', () => {
    const p = { id: 'tp', ts: `${DAY}T16:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null, ctx: null };
    app.state = { ...attempt(), events: [p] };
    const chips = renderToStaticMarkup(createElement(LogToast, { eventId: 'tp', until: Date.now() + 12000, onDone() {} })).match(/<button[^>]*>/g);
    expect(chips).toHaveLength(7); // undo + six triggers
    for (const c of chips) expect(c).toContain('min-height:44px');
  });
  it('SOSOverlay: every trigger chip is a bare .chip, and .chip is 44px', () => {
    // The SOS chips take their size from the class alone: no inline style can
    // shrink them, and the class itself must hold 44.
    const chips = renderToStaticMarkup(createElement(SOSOverlay, { onClose() {}, onResisted() {}, onUsed() {} })).match(/<button[^>]*class="chip[^>]*>/g) ?? [];
    expect(chips).toHaveLength(6);
    for (const c of chips) expect(c).not.toContain('min-height');
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    expect(css.match(/\n\.chip \{[^}]*\}/)?.[0]).toMatch(/min-height: 44px;/);
  });
});
