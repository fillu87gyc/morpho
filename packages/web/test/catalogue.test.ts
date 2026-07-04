import { describe, it, expect } from 'vitest';
import { allCatalogueEntries, catalogueIdsFor, catalogueEntry, standardCatalogueId, CATALOGUE_TOTAL, type CatalogueContext } from '../src/catalogue.js';
import type { Genome, Individuality } from '@morpho/sim';

const NEUTRAL_GENOME: Genome = {
  mergeRadius: 1, branchProb: 1, nutrientPref: 1, moisturePref: 1, lightAvoidance: 1, growthVigor: 1,
  heatTolerance: 1, toxinResistance: 1,
};

function ind(score: number): Individuality {
  return { exploration: score, efficiency: score, stability: score, health: score, vitality: score, adaptability: score };
}

function ctx(overrides: Partial<CatalogueContext> = {}): CatalogueContext {
  return {
    typeId: 'thick-connector',
    stageId: 'petri',
    individuality: ind(0.3),
    genome: NEUTRAL_GENOME,
    balance: { light: 0.5, temperature: 0.5, moisture: 0.5, nutrient: 0.5, toxin: 0 },
    generation: 1,
    connectProgress: 0,
    ...overrides,
  };
}

describe('catalogue', () => {
  it('全部で32種になる (5タイプ×5ステージ + 特殊7種)', () => {
    expect(CATALOGUE_TOTAL).toBe(32);
    expect(allCatalogueEntries().length).toBe(32);
    expect(new Set(allCatalogueEntries().map((e) => e.id)).size).toBe(32);
  });

  it('標準条件では型×ステージの1件だけが該当する', () => {
    const ids = catalogueIdsFor(ctx());
    expect(ids).toEqual([standardCatalogueId('thick-connector', 'petri')]);
  });

  it('毒素の多い環境では特殊条件も同時に該当する', () => {
    const ids = catalogueIdsFor(ctx({ balance: { light: 0.5, temperature: 0.5, moisture: 0.5, nutrient: 0.5, toxin: 0.5 } }));
    expect(ids).toContain(standardCatalogueId('thick-connector', 'petri'));
    expect(ids).toContain('special:toxin');
  });

  it('3世代目以降・★5・全拠点接続・耐性遺伝子・オールラウンドの各特殊条件を検出する', () => {
    expect(catalogueIdsFor(ctx({ generation: 3 }))).toContain('special:gen3');
    expect(catalogueIdsFor(ctx({ individuality: ind(0.9) }))).toContain('special:5star');
    expect(catalogueIdsFor(ctx({ connectProgress: 1 }))).toContain('special:connect');
    expect(catalogueIdsFor(ctx({ genome: { ...NEUTRAL_GENOME, heatTolerance: 1.3 } }))).toContain('special:heat');
    expect(catalogueIdsFor(ctx({ genome: { ...NEUTRAL_GENOME, toxinResistance: 1.3 } }))).toContain('special:toxinres');
    expect(catalogueIdsFor(ctx({ individuality: ind(0.7) }))).toContain('special:allround');
  });

  it('catalogueEntry() は id から名前・説明を引ける', () => {
    const e = catalogueEntry(standardCatalogueId('spreader', 'desert'));
    expect(e).toBeDefined();
    expect(e!.name).toContain('すなちの');
  });

  it('存在しない id には undefined を返す', () => {
    expect(catalogueEntry('nonexistent')).toBeUndefined();
  });
});
