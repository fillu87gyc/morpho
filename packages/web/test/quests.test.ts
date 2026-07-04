import { describe, it, expect } from 'vitest';
import { computeQuests } from '../src/quests.js';
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

  it('探索性が0.7に達すると explore-70 が完了する', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0.7) });
    const explore = quests.find((q) => q.id === 'explore-70')!;
    expect(explore.progress).toBe(1);
    expect(explore.done).toBe(true);
  });

  it('探索性が0.35 (半分) なら進捗0.5', () => {
    const quests = computeQuests({ coloniesReached: 0, coloniesTotal: 6, traits: traits(0.35) });
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
});
