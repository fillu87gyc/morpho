import { describe, it, expect, beforeEach } from 'vitest';
import { Encyclopedia } from '../src/encyclopedia.js';
import type { Genome, Individuality } from '@morpho/sim';

// テスト環境 (vitest, node) には window.localStorage がないので、
// Encyclopedia が呼ぶ最小限の API だけを持つ簡易ストレージを globalThis に生やす。
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

const genome: Genome = {
  mergeRadius: 1, branchProb: 1, nutrientPref: 1, moisturePref: 1, lightAvoidance: 1, growthVigor: 1,
  heatTolerance: 1, toxinResistance: 1,
};
const ind = (score: number): Individuality => ({
  exploration: score, efficiency: score, stability: score,
  health: score, vitality: score, adaptability: score,
});

describe('Encyclopedia', () => {
  beforeEach(() => {
    setGlobalStorage(mockStorage());
  });

  it('新規タイプを記録する', () => {
    const e = new Encyclopedia();
    e.record('spreader', '広がり型', genome, ind(0.5), 1, 5);
    expect(e.list()).toHaveLength(1);
    expect(e.list()[0]!.label).toBe('広がり型');
  });

  it('同じタイプでもスコアが高い記録でのみ上書きする', () => {
    const e = new Encyclopedia();
    e.record('spreader', '広がり型', genome, ind(0.5), 1, 5);
    const v1 = e.version;
    e.record('spreader', '広がり型', genome, ind(0.3), 2, 6); // 低スコア: 更新されない
    expect(e.version).toBe(v1);
    expect(e.list()[0]!.seed).toBe(1);
    e.record('spreader', '広がり型', genome, ind(0.8), 3, 7); // 高スコア: 更新される
    expect(e.version).toBe(v1 + 1);
    expect(e.list()[0]!.seed).toBe(3);
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const e1 = new Encyclopedia();
    e1.record('efficient', '効率型', genome, ind(0.6), 9, 3);
    const e2 = new Encyclopedia();
    expect(e2.list()).toHaveLength(1);
    expect(e2.list()[0]!.typeId).toBe('efficient');
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const e = new Encyclopedia();
      e.record('balanced', 'バランス型', genome, ind(0.4), 1, 1);
    }).not.toThrow();
  });
});
