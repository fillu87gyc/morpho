import { describe, it, expect } from 'vitest';
import { computeQuests, WILD_REACH_TARGET, WILD_BIOMES_TARGET } from '../src/quests.js';
import type { Traits } from '@morpho/sim';

const traits = (exploration: number): Traits => ({ exploration, efficiency: 0, stability: 0 });

describe('computeQuests', () => {
  it('拠点総数が0のときは進捗0', () => {
    const [connect] = computeQuests({ coloniesReached: 0, coloniesTotal: 0, traits: traits(0) });
    expect(connect!.progress).toBe(0);
    expect(connect!.done).toBe(false);
  });

  it('拠点をすべてつなぐと進捗1・doneになる', () => {
    const [connect] = computeQuests({ coloniesReached: 6, coloniesTotal: 6, traits: traits(0) });
    expect(connect!.progress).toBe(1);
    expect(connect!.done).toBe(true);
  });

  it('探索性が0.85に達すると explore-70 が完了する', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0.85) });
    const explore = quests.find((q) => q.id === 'explore-70')!;
    expect(explore.progress).toBe(1);
    expect(explore.done).toBe(true);
  });

  it('探索性が0.425 (半分) なら進捗0.5', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0.425) });
    const explore = quests.find((q) => q.id === 'explore-70')!;
    expect(explore.progress).toBeCloseTo(0.5, 5);
    expect(explore.done).toBe(false);
  });

  it('進捗は常に [0,1] にクランプされる', () => {
    const quests = computeQuests({ coloniesReached: 10, coloniesTotal: 6, traits: traits(1) });
    for (const q of quests) {
      expect(q.progress).toBeGreaterThanOrEqual(0);
      expect(q.progress).toBeLessThanOrEqual(1);
    }
  });

  it('unite-colonies: sourceColonies/connectedNetworks を省略すると常に達成扱い', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0) });
    const unite = quests.find((q) => q.id === 'unite-colonies')!;
    expect(unite.progress).toBe(1);
    expect(unite.done).toBe(true);
  });

  it('unite-colonies: 3コロニーが独立 (ネットワーク数3) だと進捗0', () => {
    const quests = computeQuests({
      coloniesReached: 0, coloniesTotal: 6, traits: traits(0),
      sourceColonies: 3, connectedNetworks: 3,
    });
    const unite = quests.find((q) => q.id === 'unite-colonies')!;
    expect(unite.progress).toBe(0);
    expect(unite.done).toBe(false);
  });

  it('unite-colonies: 2つが統合 (ネットワーク数2) だと進捗0.5', () => {
    const quests = computeQuests({
      coloniesReached: 0, coloniesTotal: 6, traits: traits(0),
      sourceColonies: 3, connectedNetworks: 2,
    });
    const unite = quests.find((q) => q.id === 'unite-colonies')!;
    expect(unite.progress).toBeCloseTo(0.5, 5);
  });

  it('unite-colonies: 全コロニーが1ネットワークに統合されると完了', () => {
    const quests = computeQuests({
      coloniesReached: 0, coloniesTotal: 6, traits: traits(0),
      sourceColonies: 3, connectedNetworks: 1,
    });
    const unite = quests.find((q) => q.id === 'unite-colonies')!;
    expect(unite.progress).toBe(1);
    expect(unite.done).toBe(true);
  });

  it('continent-nutrient: landCoverage を省略すると進捗0', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0) });
    const continentQuest = quests.find((q) => q.id === 'continent-nutrient')!;
    expect(continentQuest.progress).toBe(0);
    expect(continentQuest.done).toBe(false);
  });

  it('continent-nutrient: landCoverage がそのまま進捗になる', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0), landCoverage: 0.68 });
    const continentQuest = quests.find((q) => q.id === 'continent-nutrient')!;
    expect(continentQuest.progress).toBeCloseTo(0.68, 5);
  });

  it('continent-nutrient: landCoverage が1に達すると完了', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0), landCoverage: 1 });
    const continentQuest = quests.find((q) => q.id === 'continent-nutrient')!;
    expect(continentQuest.done).toBe(true);
  });

  // M32: 原野専用クエスト。「拠点をすべてつなぐ (connect-all)」の代わりに
  // 到達距離、「大陸の85%を探索する (explore-70)」の代わりに発見バイオーム数
  // を使う (どちらも原野では無限世界の節目として意味を持つ)。
  describe('wild-reach / wild-biomes (M32: 原野専用)', () => {
    it('reachDistance/biomesDiscovered を省略すると進捗0 (他ステージでは常にこの状態)', () => {
      const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 1, traits: traits(0) });
      expect(quests.find((q) => q.id === 'wild-reach')!.progress).toBe(0);
      expect(quests.find((q) => q.id === 'wild-biomes')!.progress).toBe(0);
    });

    it('wild-reach: reachDistance が WILD_REACH_TARGET に達すると完了', () => {
      const quests = computeQuests({
        coloniesReached: 0, coloniesTotal: 1, traits: traits(0), reachDistance: WILD_REACH_TARGET,
      });
      const q = quests.find((q) => q.id === 'wild-reach')!;
      expect(q.progress).toBe(1);
      expect(q.done).toBe(true);
    });

    it('wild-reach: 半分の距離なら進捗0.5', () => {
      const quests = computeQuests({
        coloniesReached: 0, coloniesTotal: 1, traits: traits(0), reachDistance: WILD_REACH_TARGET / 2,
      });
      expect(quests.find((q) => q.id === 'wild-reach')!.progress).toBeCloseTo(0.5, 5);
    });

    it('wild-biomes: biomesDiscovered が WILD_BIOMES_TARGET に達すると完了', () => {
      const quests = computeQuests({
        coloniesReached: 0, coloniesTotal: 1, traits: traits(0), biomesDiscovered: WILD_BIOMES_TARGET,
      });
      const q = quests.find((q) => q.id === 'wild-biomes')!;
      expect(q.progress).toBe(1);
      expect(q.done).toBe(true);
    });

    it('wild-biomes: 進捗は常に [0,1] にクランプされる (発見数が目標を超えても1のまま)', () => {
      const quests = computeQuests({
        coloniesReached: 0, coloniesTotal: 1, traits: traits(0), biomesDiscovered: 5, reachDistance: 10_000,
      });
      expect(quests.find((q) => q.id === 'wild-biomes')!.progress).toBe(1);
      expect(quests.find((q) => q.id === 'wild-reach')!.progress).toBe(1);
    });
  });
});
