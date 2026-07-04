import { describe, it, expect } from 'vitest';
import { localTimeFor, nightFactorFor } from '../src/daytime.js';
import { TICKS_PER_DAY } from '../src/day-loop.js';

describe('localTimeFor', () => {
  it('tick 0 は 00:00:00', () => {
    expect(localTimeFor(0)).toBe('00:00:00');
  });

  it('1日の半分 (TICKS_PER_DAY/2) は正午 12:00:00', () => {
    expect(localTimeFor(TICKS_PER_DAY / 2)).toBe('12:00:00');
  });

  it('1日を跨ぐと時刻は巻き戻る (tick % TICKS_PER_DAY)', () => {
    expect(localTimeFor(TICKS_PER_DAY)).toBe(localTimeFor(0));
    expect(localTimeFor(TICKS_PER_DAY * 3)).toBe('00:00:00');
  });

  it('常に hh:mm:ss 形式になる', () => {
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      expect(localTimeFor(t)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    }
  });
});

describe('nightFactorFor', () => {
  it('正午 (tick 0) は昼 (0 に近い)', () => {
    expect(nightFactorFor(0)).toBeCloseTo(0);
  });

  it('深夜 (半日後) は夜 (1 に近い)', () => {
    expect(nightFactorFor(TICKS_PER_DAY / 2)).toBeCloseTo(1);
  });

  it('常に [0,1] の範囲に収まる', () => {
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      const v = nightFactorFor(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
