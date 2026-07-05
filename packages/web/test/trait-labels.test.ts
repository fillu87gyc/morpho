import { describe, it, expect } from 'vitest';
import { starsOf, traitChipsFor, environmentTagsFor, typeDescriptionFor } from '../src/trait-labels.js';
import type { Genome, Individuality, Traits, IndividualTypeId } from '@morpho/sim';
import type { EnvBalance } from '../src/game.js';

function ind(score: number): Individuality {
  return { exploration: score, efficiency: score, stability: score, health: score, vitality: score, adaptability: score };
}

const NEUTRAL_GENOME: Genome = {
  mergeRadius: 1, branchProb: 1, nutrientPref: 1, moisturePref: 1, lightAvoidance: 1, growthVigor: 1,
  heatTolerance: 1, toxinResistance: 1,
};

const NEUTRAL_TRAITS: Traits = { exploration: 0.5, efficiency: 0.5, stability: 0.5 };

describe('starsOf', () => {
  it('低スコアは★1、満点は★5になる (境界値を固定する)', () => {
    expect(starsOf(ind(0))).toBe(1);
    expect(starsOf(ind(0.34))).toBe(1);
    expect(starsOf(ind(0.35))).toBe(2);
    expect(starsOf(ind(0.5))).toBe(3);
    expect(starsOf(ind(0.65))).toBe(4);
    expect(starsOf(ind(0.81))).toBe(5);
    expect(starsOf(ind(1))).toBe(5);
  });
});

describe('traitChipsFor', () => {
  it('中立な genome ではタイプラベルのみが含まれる', () => {
    const chips = traitChipsFor(NEUTRAL_GENOME, NEUTRAL_TRAITS, 'バランス型');
    expect(chips).toEqual(['バランス型']);
  });

  it('lightAvoidance が高いと「光を避ける」が付く', () => {
    const chips = traitChipsFor({ ...NEUTRAL_GENOME, lightAvoidance: 1.3 }, NEUTRAL_TRAITS, 'X');
    expect(chips).toContain('光を避ける');
  });

  it('moisturePref が低いと「乾燥にやや強い」が付く', () => {
    const chips = traitChipsFor({ ...NEUTRAL_GENOME, moisturePref: 0.7 }, NEUTRAL_TRAITS, 'X');
    expect(chips).toContain('乾燥にやや強い');
  });

  it('heatTolerance/toxinResistance が高いと耐性チップが付く (M10 遺伝子)', () => {
    const chips = traitChipsFor({ ...NEUTRAL_GENOME, heatTolerance: 1.3, toxinResistance: 1.3 }, NEUTRAL_TRAITS, 'X');
    expect(chips).toContain('熱に強い');
    expect(chips).toContain('毒に鈍感');
  });

  it('効率性が高いと「迷路構造が得意」が付く', () => {
    const chips = traitChipsFor(NEUTRAL_GENOME, { ...NEUTRAL_TRAITS, efficiency: 0.9 }, 'X');
    expect(chips).toContain('迷路構造が得意');
  });

  it('最大4個に収める', () => {
    const chips = traitChipsFor(
      { ...NEUTRAL_GENOME, lightAvoidance: 1.3, moisturePref: 0.7, heatTolerance: 1.3, toxinResistance: 1.3, branchProb: 1.3, growthVigor: 1.3 },
      { ...NEUTRAL_TRAITS, efficiency: 0.9 },
      'X',
    );
    expect(chips.length).toBeLessThanOrEqual(4);
  });
});

describe('typeDescriptionFor', () => {
  it('5タイプすべてに空でない1文が定義されている (スナップショット代わりに固定)', () => {
    const ids: IndividualTypeId[] = ['thick-connector', 'spreader', 'efficient', 'resilient', 'balanced'];
    for (const id of ids) {
      const text = typeDescriptionFor(id);
      expect(text.length).toBeGreaterThan(0);
    }
    expect(typeDescriptionFor('thick-connector')).toBe('太い幹をつくり、安定したネットワークを好む。');
  });
});

describe('environmentTagsFor', () => {
  const neutral: EnvBalance = { light: 0.5, temperature: 0.5, moisture: 0.5, nutrient: 0.5, toxin: 0 };

  it('中立な環境ではタグなし', () => {
    expect(environmentTagsFor(neutral)).toEqual([]);
  });

  it('暗い/乾いた/エサ少/毒素多/暑い/寒いをそれぞれ検出する', () => {
    expect(environmentTagsFor({ ...neutral, light: 0.1 })).toContain('暗い');
    expect(environmentTagsFor({ ...neutral, moisture: 0.1 })).toContain('乾いた土地');
    expect(environmentTagsFor({ ...neutral, nutrient: 0.1 })).toContain('エサが少ない');
    expect(environmentTagsFor({ ...neutral, toxin: 0.5 })).toContain('毒素が多い');
    expect(environmentTagsFor({ ...neutral, temperature: 0.8 })).toContain('暑い');
    expect(environmentTagsFor({ ...neutral, temperature: 0.1 })).toContain('寒い');
  });
});
