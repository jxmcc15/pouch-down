import { describe, it, expect } from 'vitest';
import { dayKeyAt, offsetMinInZone, dayKeyOf, localHM, stampNow } from '../time.js';

describe('day keys do not depend on where the device is', () => {
  it('runs days 4am → 4am in the zone the event was logged in', () => {
    const at = (iso) => dayKeyAt(Date.parse(iso), -240); // EDT
    expect(at('2026-07-10T07:59:00Z')).toBe('2026-07-09'); // 3:59am EDT → previous day
    expect(at('2026-07-10T08:00:00Z')).toBe('2026-07-10'); // 4:00am EDT
    expect(at('2026-07-11T03:30:00Z')).toBe('2026-07-10'); // 11:30pm EDT
  });

  it('knows a named zone\'s offset at an instant, DST included', () => {
    expect(offsetMinInZone(Date.parse('2026-07-10T12:00:00Z'), 'America/New_York')).toBe(-240);
    expect(offsetMinInZone(Date.parse('2026-12-10T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinInZone(Date.parse('2026-07-10T12:00:00Z'), 'Asia/Tokyo')).toBe(540);
  });

  it('prefers the stamped day over anything derived', () => {
    expect(dayKeyOf({ ts: '2026-07-10T07:59:00Z', day: '2026-01-01' })).toBe('2026-01-01');
  });

  it('reads wall-clock time from the stamped offset', () => {
    expect(localHM({ ts: '2026-07-23T10:33:00Z', tzOffsetMin: -240 })).toEqual({ h: 6, m: 33 });
  });

  it('stamps new events with ts, offset and day that agree with each other', () => {
    const now = new Date('2026-09-22T08:30:00.000Z');
    const s = stampNow(now);
    expect(s.ts).toBe('2026-09-22T08:30:00.000Z');
    expect(s.tzOffsetMin).toBe(-now.getTimezoneOffset());
    expect(s.day).toBe(dayKeyAt(now.getTime(), s.tzOffsetMin));
  });
});
