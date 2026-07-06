import { describe, it, expect, beforeEach } from 'vitest';
import { allChallenges, dateKey, DailyChallengeTracker, isChallengeExpired } from '../src/challenges.js';

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

describe('allChallenges', () => {
  it('常に3種を返す', () => {
    expect(allChallenges().map((c) => c.kind)).toEqual(['fastest', 'cheapest', 'clean']);
  });

  // M15.7: TICKS_PER_DAY が 40→240 になったことで、旧「Day 6 以内」(=240 tick)
  // という絶対ラインは新しい day 定義では「Day 0 のうちに」に相当する
  // (ROADMAP.md M15.7)。日数換算だけがずれて tick 換算の厳しさは変わらないことを固定する。
  describe('fastest.isComplete', () => {
    const fastest = allChallenges().find((c) => c.kind === 'fastest')!;

    it('全接続かつ Day 0 なら達成', () => {
      expect(fastest.isComplete({ connectProgress: 1, day: 0, networkLinks: 0, toxin: 0 })).toBe(true);
    });

    it('全接続でも Day 1 以降なら未達成', () => {
      expect(fastest.isComplete({ connectProgress: 1, day: 1, networkLinks: 0, toxin: 0 })).toBe(false);
    });

    it('Day 0 でも全接続していなければ未達成', () => {
      expect(fastest.isComplete({ connectProgress: 0.9, day: 0, networkLinks: 0, toxin: 0 })).toBe(false);
    });
  });
});

// M27: 「この皿では期限切れ」— fastest は Day 0 を過ぎると、その皿ではもう
// 達成不可能になる (isComplete が day<=0 を要求するため)。
describe('isChallengeExpired', () => {
  const fastest = allChallenges().find((c) => c.kind === 'fastest')!;
  const cheapest = allChallenges().find((c) => c.kind === 'cheapest')!;

  it('fastest は Day 0 のうちは期限切れではない', () => {
    expect(isChallengeExpired(fastest, 0, false)).toBe(false);
  });

  it('fastest は Day 1 以降、未達成なら期限切れになる', () => {
    expect(isChallengeExpired(fastest, 1, false)).toBe(true);
  });

  it('達成済みなら Day が過ぎていても期限切れ扱いにしない', () => {
    expect(isChallengeExpired(fastest, 5, true)).toBe(false);
  });

  it('期限日を持たないチャレンジ (cheapest) はいつまでも期限切れにならない', () => {
    expect(isChallengeExpired(cheapest, 1000, false)).toBe(false);
  });
});

describe('dateKey', () => {
  it('YYYY-MM-DD 形式になる', () => {
    expect(dateKey(new Date(2026, 6, 3))).toBe('2026-07-03');
  });
});

describe('DailyChallengeTracker (M11: 種別ごとの常時挑戦)', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('未達成の種は isCompleted が false', () => {
    const t = new DailyChallengeTracker();
    expect(t.isCompleted('fastest')).toBe(false);
    expect(t.completedCount()).toBe(0);
  });

  it('complete すると、その種だけ isCompleted が true になる', () => {
    const t = new DailyChallengeTracker();
    t.complete('fastest', 12, 42);
    expect(t.isCompleted('fastest')).toBe(true);
    expect(t.isCompleted('cheapest')).toBe(false);
    expect(t.recordOf('fastest')?.day).toBe(12);
    expect(t.completedCount()).toBe(1);
  });

  it('同じ種を2回 complete しても上書きされない (初回のみ記録)', () => {
    const t = new DailyChallengeTracker();
    t.complete('fastest', 12, 42);
    const v1 = t.version;
    t.complete('fastest', 3, 99);
    expect(t.version).toBe(v1);
    expect(t.recordOf('fastest')?.day).toBe(12);
  });

  it('3種すべて達成できる (日付をまたぐ制限がない)', () => {
    const t = new DailyChallengeTracker();
    t.complete('fastest', 10, 1);
    t.complete('cheapest', 20, 1);
    t.complete('clean', 30, 1);
    expect(t.completedCount()).toBe(3);
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const t1 = new DailyChallengeTracker();
    t1.complete('clean', 20, 7);
    const t2 = new DailyChallengeTracker();
    expect(t2.completedCount()).toBe(1);
    expect(t2.isCompleted('clean')).toBe(true);
  });

  it('v1 (日付ごとの記録) から v2 (種別ごとの記録) へマイグレーションする', () => {
    const raw = [
      { date: '2026-07-01', kind: 'fastest', completedAt: '2026-07-01T00:00:00.000Z', day: 10, seed: 1 },
      { date: '2026-07-02', kind: 'cheapest', completedAt: '2026-07-02T00:00:00.000Z', day: 20, seed: 2 },
    ];
    localStorage.setItem('morpho.challenges.v1', JSON.stringify(raw));
    const t = new DailyChallengeTracker();
    expect(t.isCompleted('fastest')).toBe(true);
    expect(t.isCompleted('cheapest')).toBe(true);
    expect(t.isCompleted('clean')).toBe(false);
    expect(t.completedCount()).toBe(2);
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const t = new DailyChallengeTracker();
      t.complete('fastest', 1, 1);
    }).not.toThrow();
  });
});
