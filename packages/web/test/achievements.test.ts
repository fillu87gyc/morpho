import { describe, it, expect, beforeEach } from 'vitest';
import { Achievements, ACHIEVEMENT_DEFS, type AchievementCheckInput } from '../src/achievements.js';
import type { Individuality } from '@morpho/sim';

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

const ind = (score: number): Individuality => ({
  exploration: score, efficiency: score, stability: score,
  health: score, vitality: score, adaptability: score,
});

const baseInput: AchievementCheckInput = {
  connectProgress: 0,
  individuality: ind(0),
  thickEdges: 0,
  encyclopediaCount: 0,
  encyclopediaTotal: 5,
  stagesPlayed: 0,
  dailyChallengesCompleted: 0,
};

describe('Achievements', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('初期状態では何も解除されていない', () => {
    const a = new Achievements();
    expect(a.list()).toHaveLength(0);
    for (const def of ACHIEVEMENT_DEFS) expect(a.isUnlocked(def.id)).toBe(false);
  });

  it('条件を満たすと該当の実績だけ解除される', () => {
    const a = new Achievements();
    a.check({ ...baseInput, connectProgress: 1 }, 1, 5);
    expect(a.isUnlocked('connector')).toBe(true);
    expect(a.isUnlocked('spreader')).toBe(false);
    expect(a.statusOf('connector')?.day).toBe(5);
  });

  it('一度解除された実績は条件を外れても解除されたまま', () => {
    const a = new Achievements();
    a.check({ ...baseInput, thickEdges: 20 }, 1, 5);
    expect(a.isUnlocked('pillar')).toBe(true);
    a.check({ ...baseInput, thickEdges: 0 }, 1, 6);
    expect(a.isUnlocked('pillar')).toBe(true);
  });

  it('version は新規解除があったときだけ増える', () => {
    const a = new Achievements();
    const v0 = a.version;
    a.check(baseInput, 1, 1); // 何も満たさない
    expect(a.version).toBe(v0);
    a.check({ ...baseInput, connectProgress: 1 }, 1, 1);
    expect(a.version).toBe(v0 + 1);
  });

  it('複数条件を同時に満たすと一度に複数解除される', () => {
    const a = new Achievements();
    a.check({
      ...baseInput,
      connectProgress: 1,
      individuality: ind(0.8),
      thickEdges: 25,
      encyclopediaCount: 5,
      stagesPlayed: 3,
      dailyChallengesCompleted: 1,
    }, 1, 10);
    expect(a.list().length).toBe(ACHIEVEMENT_DEFS.length);
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const a1 = new Achievements();
    a1.check({ ...baseInput, connectProgress: 1 }, 3, 9);
    const a2 = new Achievements();
    expect(a2.isUnlocked('connector')).toBe(true);
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const a = new Achievements();
      a.check({ ...baseInput, connectProgress: 1 }, 1, 1);
    }).not.toThrow();
  });
});
