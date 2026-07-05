import { describe, it, expect } from 'vitest';
import {
  eraFor, type EraInput,
  DIFFUSE_MIN_DAY, PLASMODIUM_MIN_DAY, MATURE_MIN_DAY, PLASMODIUM_MASS_KG_REQUIRED,
} from '../src/era.js';

function input(overrides: Partial<EraInput> = {}): EraInput {
  return {
    coloniesReached: 0, massKg: 0, connectedNetworks: 3, sourceColonies: 3, exploration: 0, day: 0,
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

  it('最初の拠点接続でも day が閾値未満なら胞子期のまま (day 進捗を表示)', () => {
    const e = eraFor(input({ coloniesReached: 1, day: 4 }));
    expect(e.name).toBe('胞子期');
    expect(e.progress).toBeCloseTo(4 / DIFFUSE_MIN_DAY);
  });

  it('最初の拠点接続 + day が閾値以上で拡散期に入る', () => {
    const e = eraFor(input({ coloniesReached: 1, day: DIFFUSE_MIN_DAY }));
    expect(e.name).toBe('拡散期');
  });

  it('拠点接続2個+質量要件を満たしても day が足りなければ拡散期のまま', () => {
    const e = eraFor(input({
      coloniesReached: 2, massKg: PLASMODIUM_MASS_KG_REQUIRED, day: DIFFUSE_MIN_DAY,
    }));
    expect(e.name).toBe('拡散期');
  });

  it('拠点接続2個+質量要件+day要件を満たすと変形体期に入る', () => {
    const e = eraFor(input({
      coloniesReached: 2, massKg: PLASMODIUM_MASS_KG_REQUIRED, day: PLASMODIUM_MIN_DAY,
    }));
    expect(e.name).toBe('変形体期');
  });

  it('拠点接続2個でも質量が足りなければ day を満たしても拡散期のまま', () => {
    const e = eraFor(input({ coloniesReached: 2, massKg: 1.0, day: PLASMODIUM_MIN_DAY }));
    expect(e.name).toBe('拡散期');
  });

  it('全ネットワーク統合 + 探索率50%以上でも day が足りなければ成熟期にならない', () => {
    const e = eraFor(input({
      coloniesReached: 3, massKg: 10, connectedNetworks: 1, sourceColonies: 3, exploration: 0.5,
      day: PLASMODIUM_MIN_DAY,
    }));
    expect(e.name).toBe('変形体期');
  });

  it('全ネットワーク統合 + 探索率50%以上 + day要件で成熟期に入る', () => {
    const e = eraFor(input({
      coloniesReached: 3, massKg: 10, connectedNetworks: 1, sourceColonies: 3, exploration: 0.5,
      day: MATURE_MIN_DAY,
    }));
    expect(e.name).toBe('成熟期');
    expect(e.progress).toBe(1);
  });

  it('ネットワーク統合していても探索率が足りなければ成熟期にならない', () => {
    const e = eraFor(input({
      coloniesReached: 3, massKg: 10, connectedNetworks: 1, sourceColonies: 3, exploration: 0.2,
      day: MATURE_MIN_DAY,
    }));
    expect(e.name).toBe('変形体期');
  });

  it('単一コロニー (sourceColonies<=1) は常にネットワーク統合済み扱い', () => {
    const e = eraFor(input({
      coloniesReached: 2, massKg: 10, connectedNetworks: 1, sourceColonies: 1, exploration: 0.6,
      day: MATURE_MIN_DAY,
    }));
    expect(e.name).toBe('成熟期');
  });

  it('progress は常に [0,1] に収まる', () => {
    for (const reached of [0, 1, 2, 5]) {
      for (const mass of [0, 0.5, 1.5, 10]) {
        for (const day of [0, 5, 10, 20, 30, 40, 100]) {
          const e = eraFor(input({
            coloniesReached: reached, massKg: mass, exploration: 0.9,
            connectedNetworks: 1, sourceColonies: 1, day,
          }));
          expect(e.progress).toBeGreaterThanOrEqual(0);
          expect(e.progress).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('条件をすべて満たしたまま日数だけが経過すると胞子期→拡散期→変形体期→成熟期と単調に進む', () => {
    const names: string[] = [];
    for (const day of [0, DIFFUSE_MIN_DAY, PLASMODIUM_MIN_DAY, MATURE_MIN_DAY]) {
      const e = eraFor(input({
        coloniesReached: 3, massKg: 10, connectedNetworks: 1, sourceColonies: 1, exploration: 0.9, day,
      }));
      names.push(e.name);
    }
    expect(names).toEqual(['胞子期', '拡散期', '変形体期', '成熟期']);
  });
});
