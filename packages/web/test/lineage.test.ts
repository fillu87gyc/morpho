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
});
