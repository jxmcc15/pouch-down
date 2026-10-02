import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TOOLS, TOOL_NAMES, MAX_PROPOSALS, MAX_TOKENS, livePouchesForPrompt, promptClock, fmtAppDay } from '../coachTools.js';
import { TRIGGERS } from '../triggers.js';
import { generatePlan } from '../planGenerator.js';

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const ev = (type, day, extra = {}) => ({ id: `t${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type, trigger: null, ...extra });
const attempt = (events, over = {}) => ({ id: 'a2', status: 'active', archivedAt: null, settings, plan, events, celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over });
const NOW = Date.parse('2026-10-01T21:12:00-05:00'); // Thu, 9:12 PM CDT — app day 2026-10-01
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(NOW)); });
afterEach(() => vi.useRealTimers());

describe('TOOLS — the eight verbs and nothing else', () => {
  it('names exactly the eight tools, in the spec order', () => {
    expect(TOOL_NAMES).toEqual(['log_pouch_now', 'log_resisted_now', 'add_late_pouch', 'mark_mistake', 'add_reason', 'fill_missed_day', 'correct_day_total', 'log_checkin']);
    expect(MAX_PROPOSALS).toBe(5);
    expect(MAX_TOKENS).toBe(800);
  });
  it('every tool is name + description + input_schema, and every schema is closed', () => {
    for (const t of TOOLS) {
      expect(Object.keys(t)).toEqual(['name', 'description', 'input_schema']);
      expect(t.input_schema).toMatchObject({ type: 'object', additionalProperties: false });
      for (const r of t.input_schema.required) expect(Object.keys(t.input_schema.properties)).toContain(r);
    }
  });
  it('every trigger enum is the app\'s TRIGGERS list, so the two cannot drift', () => {
    const enums = JSON.stringify(TOOLS).match(/"enum":\[[^\]]*\]/g).filter((e) => !e.includes('keep'));
    expect(enums.length).toBeGreaterThan(0);
    for (const e of enums) expect(e).toBe(`"enum":${JSON.stringify(TRIGGERS)}`);
  });
  it('no tool reaches the forbidden list', () => {
    for (const name of TOOL_NAMES) expect(name).not.toMatch(/attempt|plan|quit|setting|token|key|recover|price|meal|cost|undo|tag_event/);
    const all = JSON.stringify(TOOLS);
    for (const word of ['startAttempt', 'archiveActive', 'updateSettings', 'updateDevice', 'startFresh', 'quit date', 'apiKey']) expect(all).not.toContain(word);
  });
});

describe('TOOLS — the bounds the model is told', () => {
  const props = (name) => TOOLS.find((t) => t.name === name).input_schema.properties;
  it.each([
    ['add_late_pouch', 'note', { type: 'string', maxLength: 140 }],
    ['add_late_pouch', 'triggers', { type: 'array', maxItems: 6, uniqueItems: true }],
    ['add_reason', 'note', { type: 'string', maxLength: 140 }],
    ['add_reason', 'triggers', { type: 'array', maxItems: 6, uniqueItems: true }],
    ['fill_missed_day', 'count', { type: 'integer', minimum: 0, maximum: 60 }],
    ['correct_day_total', 'count', { type: 'integer', minimum: 0, maximum: 60 }],
    ['log_checkin', 'sleep_hours', { type: 'number', minimum: 0, maximum: 16 }],
    ['log_checkin', 'sleep_quality', { type: 'integer', minimum: 1, maximum: 5 }],
  ])('%s.%s', (name, field, bounds) => {
    expect(props(name)[field]).toMatchObject(bounds);
  });
});

describe('livePouchesForPrompt', () => {
  it('lists live pouches of the last 7 app days, newest first, with wall-clock HH:MM', () => {
    const old = ev('pouch', '2026-09-24', { ts: '2026-09-24T14:00:00.000Z' }); // 8 app days back
    const a = ev('pouch', '2026-09-25', { ts: '2026-09-25T14:00:00.000Z' });
    const b = ev('pouch', '2026-10-01', { ts: '2026-10-01T13:30:00.000Z' });
    const c = ev('pouch', '2026-10-01', { ts: '2026-10-01T19:14:00.000Z', trigger: 'stress' });
    const r = ev('resisted', '2026-10-01');
    expect(livePouchesForPrompt(attempt([old, a, b, c, r]), NOW)).toEqual([
      { id: c.id, day: '2026-10-01', time: '14:14', trigger: 'stress' },
      { id: b.id, day: '2026-10-01', time: '08:30', trigger: null },
      { id: a.id, day: '2026-09-25', time: '09:00', trigger: null },
    ]);
  });
  it('drops a voided pouch; an untimed pouch shows time null; a reason\'s triggers win', () => {
    const p = ev('pouch', '2026-09-30', { ts: '2026-09-30T15:00:00.000Z' });
    const v = { ...ev('void', '2026-09-30'), target: p.id };
    const u = ev('pouch', '2026-09-29', { ts: '2026-10-01T20:00:00.000Z', late: true, timeKnown: false, enteredAt: '2026-10-01T20:00:00.000Z', ctx: null });
    const q = ev('pouch', '2026-09-29', { ts: '2026-09-29T15:00:00.000Z', trigger: 'coffee' });
    const why = { ...ev('reason', '2026-09-29'), target: q.id, triggers: ['boredom', 'social'], note: '' };
    expect(livePouchesForPrompt(attempt([p, v, u, q, why]), NOW)).toEqual([
      { id: u.id, day: '2026-09-29', time: null, trigger: null },
      { id: q.id, day: '2026-09-29', time: '10:00', trigger: 'boredom, social' },
    ]);
  });
  it('a 1:30 AM pouch belongs to the app day before, and shows its own wall clock', () => {
    const late = ev('pouch', '2026-09-30', { ts: '2026-10-01T06:30:00.000Z' }); // 1:30 AM CDT on Oct 1 = app day Sep 30
    expect(livePouchesForPrompt(attempt([late]), NOW)).toEqual([{ id: late.id, day: '2026-09-30', time: '01:30', trigger: null }]);
  });
  it('shows the wall clock where the pouch was logged, not the reader\'s zone', () => {
    const east = ev('pouch', '2026-10-01', { ts: '2026-10-01T13:30:00.000Z', tzOffsetMin: -240 }); // 9:30 AM EDT, read on a Chicago phone
    expect(livePouchesForPrompt(attempt([east]), NOW)).toEqual([{ id: east.id, day: '2026-10-01', time: '09:30', trigger: null }]);
  });
  it('caps the list at 60 rows', () => {
    const many = Array.from({ length: 70 }, (_, i) => ev('pouch', '2026-10-01', { ts: new Date(Date.parse('2026-10-01T10:00:00.000Z') + i * 60000).toISOString() }));
    const list = livePouchesForPrompt(attempt(many), NOW);
    expect(list).toHaveLength(60);
    expect(list[0].id).toBe(many[69].id);
  });
});

describe('promptClock — the 4am rule', () => {
  it('03:59 is still the app day before; 04:00 is the new one', () => {
    expect(promptClock(Date.parse('2026-10-02T03:59:00-05:00'))).toEqual({ day: '2026-10-01', time: '03:59', weekday: 'Thu' });
    expect(promptClock(Date.parse('2026-10-02T04:00:00-05:00'))).toEqual({ day: '2026-10-02', time: '04:00', weekday: 'Fri' });
  });
  it('reads the evening as the user sees it', () => {
    expect(promptClock(NOW)).toEqual({ day: '2026-10-01', time: '21:12', weekday: 'Thu' });
  });
});

describe('fmtAppDay', () => {
  it('reads like the cards', () => {
    expect(fmtAppDay('2026-10-01')).toBe('Thu Oct 1');
    expect(fmtAppDay('2026-09-29')).toBe('Tue Sep 29');
  });
});
