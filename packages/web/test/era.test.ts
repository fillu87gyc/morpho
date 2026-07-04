import { describe, it, expect } from 'vitest';
import { eraFor, type EraInput } from '../src/era.js';

function input(overrides: Partial<EraInput> = {}): EraInput {
  return {
    coloniesReached: 0, massKg: 0, connectedNetworks: 3, sourceColonies: 3, exploration: 0,
    ...overrides,
  };
}

describe('eraFor', () => {
  it('拠点未接続・質量ゼロは胞子期、progress 0', () => {
    const e = eraFor(input());
    expect(e.name).toBe('胞子期');
    expect(e.progress).toBe(0);
  });

  it('質量が伸びると胞子期のまま progress が上がる', () => {
    const e = eraFor(input({ massKg: 0.15 }));
    expect(e.name).toBe('胞子期');
    expect(e.progress).toBeCloseTo(0.5);
  });

  it('最初の拠点接続で拡散期に入る', () => {
    const e = eraFor(input({ coloniesReached: 1 }));
    expect(e.name).toBe('拡散期');
  });

  it('拠点接続2個+質量1.5kg以上で変形体期に入る', () => {
    const e = eraFor(input({ coloniesReached: 2, massKg: 1.5 }));
    expect(e.name).toBe('変形体期');
  });

  it('拠点接続2個でも質量が足りなければ拡散期のまま', () => {
    const e = eraFor(input({ coloniesReached: 2, massKg: 1.0 }));
    expect(e.name).toBe('拡散期');
  });

  it('全ネットワーク統合 + 探索率50%以上で成熟期に入る', () => {
    const e = eraFor(input({
      coloniesReached: 3, massKg: 3, connectedNetworks: 1, sourceColonies: 3, exploration: 0.5,
    }));
    expect(e.name).toBe('成熟期');
    expect(e.progress).toBe(1);
  });

  it('ネットワーク統合していても探索率が足りなければ成熟期にならない', () => {
    const e = eraFor(input({
      coloniesReached: 3, massKg: 3, connectedNetworks: 1, sourceColonies: 3, exploration: 0.2,
    }));
    expect(e.name).toBe('変形体期');
  });

  it('単一コロニー (sourceColonies<=1) は常にネットワーク統合済み扱い', () => {
    const e = eraFor(input({
      coloniesReached: 2, massKg: 3, connectedNetworks: 1, sourceColonies: 1, exploration: 0.6,
    }));
    expect(e.name).toBe('成熟期');
  });

  it('progress は常に [0,1] に収まる', () => {
    for (const reached of [0, 1, 2, 5]) {
      for (const mass of [0, 0.5, 1.5, 10]) {
        const e = eraFor(input({ coloniesReached: reached, massKg: mass, exploration: 0.9, connectedNetworks: 1, sourceColonies: 1 }));
        expect(e.progress).toBeGreaterThanOrEqual(0);
        expect(e.progress).toBeLessThanOrEqual(1);
      }
    }
  });
});
