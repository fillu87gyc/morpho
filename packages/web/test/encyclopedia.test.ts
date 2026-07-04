import { describe, it, expect, beforeEach } from 'vitest';
import { Encyclopedia } from '../src/encyclopedia.js';
import { standardCatalogueId, type CatalogueContext } from '../src/catalogue.js';
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

function ctx(overrides: Partial<CatalogueContext> = {}): CatalogueContext {
  return {
    typeId: 'spreader',
    stageId: 'petri',
    individuality: ind(0.5),
    genome,
    balance: { light: 0.5, temperature: 0.5, moisture: 0.5, nutrient: 0.5, toxin: 0 },
    generation: 1,
    connectProgress: 0,
    ...overrides,
  };
}

describe('Encyclopedia', () => {
  beforeEach(() => {
    setGlobalStorage(mockStorage());
  });

  it('新規カタログ枠を記録し、新規発見の id を返す', () => {
    const e = new Encyclopedia();
    const discovered = e.record(ctx(), 1, 5);
    expect(discovered).toEqual([standardCatalogueId('spreader', 'petri')]);
    expect(e.list()).toHaveLength(1);
    expect(e.list()[0]!.name).toContain('ひろがりのこ');
  });

  it('同じ枠でもスコアが高い記録でのみ上書きする', () => {
    const e = new Encyclopedia();
    e.record(ctx({ individuality: ind(0.5) }), 1, 5);
    const v1 = e.version;
    e.record(ctx({ individuality: ind(0.3) }), 2, 6); // 低スコア: 更新されない
    expect(e.version).toBe(v1);
    expect(e.list()[0]!.seed).toBe(1);
    e.record(ctx({ individuality: ind(0.8) }), 3, 7); // 高スコア: 更新される
    expect(e.version).toBe(v1 + 1);
    expect(e.list()[0]!.seed).toBe(3);
  });

  it('2回目の発見では既存枠は newlyDiscovered に含まれない', () => {
    const e = new Encyclopedia();
    e.record(ctx(), 1, 5);
    // 同じ条件 (特殊条件を新たに満たさない) で再発見しても何も新規登録されない。
    const discovered = e.record(ctx({ individuality: ind(0.55) }), 2, 6);
    expect(discovered).toEqual([]);
  });

  it('特殊条件を同時に満たすと複数のカタログ枠が一度に埋まる', () => {
    const e = new Encyclopedia();
    const discovered = e.record(ctx({ connectProgress: 1 }), 1, 5);
    expect(discovered).toContain(standardCatalogueId('spreader', 'petri'));
    expect(discovered).toContain('special:connect');
    expect(e.list()).toHaveLength(2);
  });

  it('toggleFavorite() でお気に入りを切り替えられる', () => {
    const e = new Encyclopedia();
    e.record(ctx(), 1, 5);
    const id = standardCatalogueId('spreader', 'petri');
    expect(e.entryOf(id)?.favorite).toBe(false);
    e.toggleFavorite(id);
    expect(e.entryOf(id)?.favorite).toBe(true);
    e.toggleFavorite(id);
    expect(e.entryOf(id)?.favorite).toBe(false);
  });

  it('お気に入りは記録の更新をまたいで保持される', () => {
    const e = new Encyclopedia();
    e.record(ctx(), 1, 5);
    const id = standardCatalogueId('spreader', 'petri');
    e.toggleFavorite(id);
    e.record(ctx({ individuality: ind(0.9) }), 2, 6); // スコア更新
    expect(e.entryOf(id)?.favorite).toBe(true);
  });

  it('localStorage に永続化され、再生成しても読み込める', () => {
    const e1 = new Encyclopedia();
    e1.record(ctx({ typeId: 'efficient', stageId: 'desert' }), 9, 3);
    const e2 = new Encyclopedia();
    expect(e2.list()).toHaveLength(1);
    expect(e2.list()[0]!.id).toBe(standardCatalogueId('efficient', 'desert'));
  });

  it('v1 (タイプのみ) のデータは「皿」変種として v2 へ移行される', () => {
    const v1 = [{
      typeId: 'balanced', label: 'バランス型', seed: 42, day: 10, genome, individuality: ind(0.6),
      discoveredAt: '2026-01-01T00:00:00.000Z',
    }];
    localStorage.setItem('morpho.encyclopedia.v1', JSON.stringify(v1));
    const e = new Encyclopedia();
    expect(e.list()).toHaveLength(1);
    expect(e.list()[0]!.id).toBe(standardCatalogueId('balanced', 'petri'));
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    expect(() => {
      const e = new Encyclopedia();
      e.record(ctx(), 1, 1);
    }).not.toThrow();
  });
});
