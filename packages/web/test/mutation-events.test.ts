import { describe, it, expect } from 'vitest';
import { detectMutation, detectNewTraitChips, newTraitChipText } from '../src/mutation-events.js';
import type { Genome, Traits } from '@morpho/sim';

function traits(overrides: Partial<Traits> = {}): Traits {
  return { exploration: 0.5, efficiency: 0.5, stability: 0.5, ...overrides };
}

function genome(overrides: Partial<Genome> = {}): Genome {
  return {
    lightAvoidance: 1, moisturePref: 1, heatTolerance: 1, toxinResistance: 1,
    branchProb: 1, growthVigor: 1,
    ...overrides,
  } as Genome;
}

describe('detectMutation', () => {
  it('Δが閾値未満なら無音', () => {
    expect(detectMutation(traits(), traits({ exploration: 0.55 }))).toBeNull();
  });

  it('1軸だけ閾値を超えて上昇した場合、その軸の上昇を報告する', () => {
    const text = detectMutation(traits(), traits({ exploration: 0.65 }));
    expect(text).toBe('個体が突然変異 — 探索性が上昇');
  });

  it('低下方向にも反応する', () => {
    const text = detectMutation(traits(), traits({ stability: 0.3 }));
    expect(text).toBe('個体が突然変異 — 安定性が低下');
  });

  it('複数軸が同時に動いた場合、最大Δの1軸だけを報告する', () => {
    const text = detectMutation(traits(), traits({ exploration: 0.6, efficiency: 0.75 }));
    expect(text).toBe('個体が突然変異 — 効率性が上昇');
  });
});

describe('detectNewTraitChips / newTraitChipText', () => {
  it('efficiency が閾値 (0.7) を上回った日に「迷路構造が得意」が新規出現する', () => {
    const g = genome();
    const newChips = detectNewTraitChips(g, traits({ efficiency: 0.5 }), traits({ efficiency: 0.75 }), 'タイプ');
    expect(newChips).toContain('迷路構造が得意');
    expect(newTraitChipText(newChips)).toBe('新しい形質を獲得 — 迷路構造が得意');
  });

  it('チップ集合が変わらなければ空配列 (無音)', () => {
    const g = genome();
    const newChips = detectNewTraitChips(g, traits({ efficiency: 0.8 }), traits({ efficiency: 0.85 }), 'タイプ');
    expect(newChips).toEqual([]);
    expect(newTraitChipText(newChips)).toBeNull();
  });

  it('genome 由来のチップは traits が変わっても差分に出ない (前日と同じ genome を渡す前提)', () => {
    const g = genome({ lightAvoidance: 1.2 });
    const newChips = detectNewTraitChips(g, traits({ exploration: 0.1 }), traits({ exploration: 0.9 }), 'タイプ');
    expect(newChips).toEqual([]);
  });
});
