// A past attempt has no "today", so the discipline card must not show a
// "· 0 today" slice under each bucket when viewing one read-only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generatePlan } from '../planGenerator.js';

const app = vi.hoisted(() => ({ state: null }));
vi.mock('../state.jsx', () => ({ useApp: () => ({ state: app.state }) }));

const { default: DisciplineCard } = await import('../components/DisciplineCard.jsx');

const settings = { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30' }, costPerTin: 5, pouchesPerTin: 20, wakeTime: '07:00', sleepTime: '23:00' };
const plan = generatePlan({ pouchesPerDay: 9, mg: 9, strengths: [6, 3], lengthDays: 90, startDate: '2026-09-21', ...settings });
let seq = 0;
const pouch = (day) => ({ id: `d${++seq}`, ts: `${day}T17:00:00.000Z`, tzOffsetMin: -300, day, type: 'pouch', trigger: null });
const attempt = (over = {}) => ({
  id: 'a2', status: 'active', archivedAt: null, settings, plan,
  events: [pouch('2026-09-24'), pouch('2026-09-25')],
  celebratedStages: [], celebratedAwards: [], checkinDismissedFor: null, ...over,
});
const html = () => renderToStaticMarkup(createElement(DisciplineCard));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T17:00:00.000Z')); }); // day 5, noon CT
afterEach(() => { vi.useRealTimers(); app.state = null; });

describe('DisciplineCard', () => {
  it('a live attempt shows today\'s slice under each bucket', () => {
    app.state = attempt();
    const out = html();
    expect(out.match(/ today</g)).toHaveLength(3);
  });

  it('a past attempt shows its all-time buckets but no "today" slice', () => {
    app.state = attempt({ status: 'archived', archivedAt: '2026-09-25T02:00:00.000Z', archivedDay: '2026-09-24' });
    const out = html();
    expect(out).toContain('on time');
    expect(out).toContain('over cap');
    expect(out).not.toMatch(/today/);
  });
});
