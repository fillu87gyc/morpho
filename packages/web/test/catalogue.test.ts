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
  // M32: 原野を STAGE_ORDER に加えたことで 5タイプ×7ステージ+特殊7種 = 42種に
  // 拡張した (以前は 37種 = 5×6+7)。既存6ステージぶんの id・名称は不変
  // (末尾に wildland ぶんが追加されただけ) であることを次のテストで守る。
  it('全部で42種になる (5タイプ×7ステージ + 特殊7種、M32で原野が加わった)', () => {
    expect(CATALOGUE_TOTAL).toBe(42);
    expect(allCatalogueEntries().length).toBe(42);
    expect(new Set(allCatalogueEntries().map((e) => e.id)).size).toBe(42);
  });

  it('原野ぶんの標準エントリ (5タイプ) が図鑑に収録される (M32)', () => {
    const ids = allCatalogueEntries().map((e) => e.id);
    for (const typeId of ['thick-connector', 'spreader', 'efficient', 'resilient', 'balanced'] as const) {
      const id = standardCatalogueId(typeId, 'wildland');
      expect(ids).toContain(id);
      expect(catalogueEntry(id)!.name).toContain('げんやの');
    }
  });

  it('既存6ステージぶんの標準エントリの id・名称は M32 以前と完全に不変', () => {
    expect(catalogueEntry(standardCatalogueId('thick-connector', 'petri'))).toEqual({
      id: 'thick-connector:petri', name: 'さらのねばりのこ', description: '皿で育った太くつなぐ型の個体。',
    });
    expect(catalogueEntry(standardCatalogueId('spreader', 'continent'))).toEqual({
      id: 'spreader:continent', name: 'たいりくのひろがりのこ', description: '大陸で育った広がり型の個体。',
    });
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
