import { describe, it, expect, beforeEach } from 'vitest';
import { Lineage, type HarvestInput } from '../src/lineage.js';
import type { Genome, Individuality } from '@morpho/sim';

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

const genome = (v: number): Genome => ({
  mergeRadius: v, branchProb: v, nutrientPref: v, moisturePref: v, lightAvoidance: v, growthVigor: v,
  heatTolerance: v, toxinResistance: v,
});
const ind: Individuality = {
  exploration: 0.5, efficiency: 0.5, stability: 0.5, health: 0.5, vitality: 0.5, adaptability: 0.5,
};

function harvestInput(seed: number, day: number): HarvestInput {
  return {
    genome: genome(1 + seed * 0.01), typeId: 'balanced', typeLabel: 'バランス型',
    individuality: ind, seed, day, stageId: 'petri', stageName: '皿',
  };
}

describe('Lineage', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('初期状態では系統がなく、次は1代目', () => {
    const l = new Lineage();
    expect(l.list()).toHaveLength(0);
    expect(l.current()).toBeUndefined();
    expect(l.nextGeneration()).toBe(1);
  });

  it('harvest すると1代目として記録される', () => {
    const l = new Lineage();
    const entry = l.harvest(harvestInput(1, 5));
    expect(entry.generation).toBe(1);
    expect(l.current()?.generation).toBe(1);
    expect(l.nextGeneration()).toBe(2);
  });

  it('harvest を重ねると世代が積み上がる', () => {
    const l = new Lineage();
    l.harvest(harvestInput(1, 5));
    l.harvest(harvestInput(2, 10));
    l.harvest(harvestInput(3, 15));
    expect(l.list()).toHaveLength(3);
    expect(l.list().map((e) => e.generation)).toEqual([1, 2, 3]);
    expect(l.current()?.generation).toBe(3);
  });

  it('version は harvest のたびに増える', () => {
    const l = new Lineage();
    const v0 = l.version;
    l.harvest(harvestInput(1, 5));
    expect(l.version).toBe(v0 + 1);
  });

  it('clear で系統がリセットされ、次はまた1代目になる', () => {
    const l = new Lineage();
    l.harvest(harvestInput(1, 5));
    l.clear();
    expect(l.list()).toHaveLength(0);
    expect(l.nextGeneration()).toBe(1);
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const l1 = new Lineage();
    l1.harvest(harvestInput(7, 8));
    const l2 = new Lineage();
    expect(l2.current()?.seed).toBe(7);
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const l = new Lineage();
      l.harvest(harvestInput(1, 5));
    }).not.toThrow();
  });

  // M13: 分岐ツリー。
  describe('分岐 (M13)', () => {
    it('1つの親から複数回採種すると、同じ親を持つ複数の子ができる (分岐)', () => {
      const l = new Lineage();
      const parent = l.harvest(harvestInput(1, 5));
      const childA = l.harvest(harvestInput(2, 10));
      l.startFrom(parent.id); // 同じ親からもう一度採る
      const childB = l.harvest(harvestInput(3, 10));
      expect(childA.parentId).toBe(parent.id);
      expect(childB.parentId).toBe(parent.id);
      expect(childA.id).not.toBe(childB.id);
      expect(l.list()).toHaveLength(3);
    });

    it('startFrom() で任意の祖先を選び直すと、以後の harvest はその子になる', () => {
      const l = new Lineage();
      const gen1 = l.harvest(harvestInput(1, 5));
      l.harvest(harvestInput(2, 10));
      l.harvest(harvestInput(3, 15)); // 現在3代目
      l.startFrom(gen1.id);
      expect(l.current()?.id).toBe(gen1.id);
      expect(l.nextGeneration()).toBe(2);
      const child = l.harvest(harvestInput(4, 20));
      expect(child.generation).toBe(2);
      expect(child.parentId).toBe(gen1.id);
    });

    it('存在しない id への startFrom は何も変えない', () => {
      const l = new Lineage();
      l.harvest(harvestInput(1, 5));
      const before = l.current()?.id;
      expect(l.startFrom('nonexistent')).toBeUndefined();
      expect(l.current()?.id).toBe(before);
    });

    it('1代目の親は null になる', () => {
      const l = new Lineage();
      const root = l.harvest(harvestInput(1, 5));
      expect(root.parentId).toBeNull();
    });

    it('永続化後も activeParentId (どの祖先から続けるか) が復元される', () => {
      const l1 = new Lineage();
      const gen1 = l1.harvest(harvestInput(1, 5));
      l1.harvest(harvestInput(2, 10));
      l1.startFrom(gen1.id);
      const l2 = new Lineage();
      expect(l2.current()?.id).toBe(gen1.id);
    });

    it('v1 (線形履歴) は根から一直線に伸びる木として読み込まれる', () => {
      const v1 = [
        { generation: 1, genome: genome(1), typeId: 'balanced', typeLabel: 'バランス型', individuality: ind, seed: 1, day: 5, stageId: 'petri', stageName: '皿', harvestedAt: '2026-01-01T00:00:00.000Z' },
        { generation: 2, genome: genome(1), typeId: 'balanced', typeLabel: 'バランス型', individuality: ind, seed: 2, day: 10, stageId: 'petri', stageName: '皿', harvestedAt: '2026-01-02T00:00:00.000Z' },
      ];
      localStorage.setItem('morpho.lineage.v1', JSON.stringify(v1));
      const l = new Lineage();
      expect(l.list()).toHaveLength(2);
      expect(l.list()[0]!.parentId).toBeNull();
      expect(l.list()[1]!.parentId).toBe(l.list()[0]!.id);
      expect(l.current()?.seed).toBe(2);
    });
  });
});
