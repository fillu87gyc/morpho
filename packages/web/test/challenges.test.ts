import { describe, it, expect, beforeEach } from 'vitest';
import { dailyChallengeFor, dateKey, DailyChallengeTracker } from '../src/challenges.js';

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

describe('dailyChallengeFor', () => {
  it('同じ日付なら同じチャレンジを返す (決定的)', () => {
    const d = new Date(2026, 6, 3);
    expect(dailyChallengeFor(d).kind).toBe(dailyChallengeFor(new Date(2026, 6, 3)).kind);
  });

  it('日付が違えば異なるチャレンジになりうる', () => {
    const kinds = new Set<string>();
    for (let day = 1; day <= 30; day++) kinds.add(dailyChallengeFor(new Date(2026, 0, day)).kind);
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe('dateKey', () => {
  it('YYYY-MM-DD 形式になる', () => {
    expect(dateKey(new Date(2026, 6, 3))).toBe('2026-07-03');
  });
});

describe('DailyChallengeTracker', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('未達成の日は isCompletedToday が false', () => {
    const t = new DailyChallengeTracker();
    expect(t.isCompletedToday(new Date(2026, 6, 3))).toBe(false);
  });

  it('complete すると同じ日は isCompletedToday が true になる', () => {
    const t = new DailyChallengeTracker();
    const d = new Date(2026, 6, 3);
    t.complete(d, 'fastest', 12, 42);
    expect(t.isCompletedToday(d)).toBe(true);
    expect(t.todayRecord(d)?.kind).toBe('fastest');
    expect(t.completedCount()).toBe(1);
  });

  it('同じ日に2回 complete しても上書きされない (1日1回)', () => {
    const t = new DailyChallengeTracker();
    const d = new Date(2026, 6, 3);
    t.complete(d, 'fastest', 12, 42);
    const v1 = t.version;
    t.complete(d, 'cheapest', 3, 99);
    expect(t.version).toBe(v1);
    expect(t.todayRecord(d)?.kind).toBe('fastest');
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const t1 = new DailyChallengeTracker();
    t1.complete(new Date(2026, 6, 3), 'clean', 20, 7);
    const t2 = new DailyChallengeTracker();
    expect(t2.completedCount()).toBe(1);
  });
});
