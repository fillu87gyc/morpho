import { describe, it, expect, beforeEach } from 'vitest';
import { DayReport, type DayRecord } from '../src/day-report.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function mockStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
  };
}

function setGlobalStorage(s: StorageLike | undefined): void {
  const g = globalThis as unknown as { localStorage?: StorageLike };
  if (s) g.localStorage = s;
  else delete g.localStorage;
}

function rec(day: number, exploration: number, efficiency = 0.5, stability = 0.5, massKg = 1, areaM2 = 100): DayRecord {
  return { day, traits: { exploration, efficiency, stability }, massKg, areaM2 };
}

describe('DayReport', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('前日の記録がなければ delta は null (初日)', () => {
    const r = new DayReport();
    r.record(rec(0, 0.1));
    expect(r.delta(0)).toBeNull();
  });

  it('前日比の差分を計算する', () => {
    const r = new DayReport();
    r.record(rec(0, 0.1, 0.2, 0.3, 1, 100));
    r.record(rec(1, 0.15, 0.25, 0.28, 1.5, 150));
    const d = r.delta(1);
    expect(d).not.toBeNull();
    expect(d!.exploration).toBeCloseTo(0.05);
    expect(d!.efficiency).toBeCloseTo(0.05);
    expect(d!.stability).toBeCloseTo(-0.02);
    expect(d!.massKg).toBeCloseTo(0.5);
    expect(d!.areaM2).toBe(50);
  });

  it('同じ日を複数回記録しても上書きされる (冪等)', () => {
    const r = new DayReport();
    r.record(rec(2, 0.1));
    r.record(rec(2, 0.9));
    expect(r.list()).toHaveLength(1);
    expect(r.of(2)!.traits.exploration).toBe(0.9);
  });

  it('60日を超えると古い記録から捨てる (リングバッファ)', () => {
    const r = new DayReport();
    for (let d = 0; d < 65; d++) r.record(rec(d, 0.1));
    expect(r.list()).toHaveLength(60);
    expect(r.of(0)).toBeUndefined();
    expect(r.of(4)).toBeUndefined();
    expect(r.of(5)).toBeDefined();
    expect(r.of(64)).toBeDefined();
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const r1 = new DayReport();
    r1.record(rec(3, 0.4));
    const r2 = new DayReport();
    expect(r2.of(3)?.traits.exploration).toBe(0.4);
  });

  it('reset() で記録を空にできる', () => {
    const r = new DayReport();
    r.record(rec(1, 0.1));
    r.reset();
    expect(r.list()).toHaveLength(0);
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const r = new DayReport();
      r.record(rec(0, 0.1));
    }).not.toThrow();
  });
});
