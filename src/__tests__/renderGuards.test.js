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

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
const DAY = '2026-09-25';
const hostile = [
  { id: 'p1', ts: `${DAY}T14:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'pouch', trigger: null,
    ctx: { nth: 1, cap: 9, slotId: 'x', slotLabel: { evil: true }, slotAt: `${DAY}T13:00:00.000Z`, firstSlotAt: `${DAY}T13:00:00.000Z` } },
  { id: 'r1', ts: `${DAY}T14:00:05.000Z`, tzOffsetMin: -300, day: DAY, type: 'reason', trigger: null, target: 'p1', triggers: [{ no: 1 }, 'stress'], note: ['not', 'a', 'string'] },
  { id: 'c1', ts: `${DAY}T13:00:00.000Z`, tzOffsetMin: -300, day: DAY, type: 'checkin', trigger: null, source: 'manual', sleepQuality: { deep: true }, sleepHours: 'seven' },
];
const attempt = () => ({
  id: 'a2', status: 'active', archivedAt: null, settings, events: hostile,
  plan: {
    ...plan,
    stages: plan.stages.map((s, i) => (i === 0
      ? { ...s, name: { bad: 1 }, tagline: ['x'], slots: s.slots.map((sl, j) => (j === 0 ? { ...sl, label: 42 } : sl)) }
      : s)),
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
  });
  it('HistoryTimeline renders the day, its rows, and nothing garbled', () => {
    const out = renderToStaticMarkup(createElement(HistoryTimeline));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('check-in');
  });
  it('PlanView renders every stage, with the hostile name and slot label blank', () => {
    const out = renderToStaticMarkup(createElement(PlanView));
    expect(out).not.toContain('[object Object]');
    expect(out).toContain('House rules');
  });
});
