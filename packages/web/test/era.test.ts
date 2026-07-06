import { describe, it, expect } from 'vitest';
import {
  eraFor, type EraInput,
  DIFFUSE_MIN_DAY, PLASMODIUM_MIN_DAY, MATURE_MIN_DAY, PLASMODIUM_MASS_KG_REQUIRED,
  estimateEraEta, type EraSample,
  describeEraBlocker,
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

describe('describeEraBlocker', () => {
  it('成熟期に到達済みなら空文字 (もう条件はない)', () => {
    const e = describeEraBlocker(input({
      coloniesReached: 3, massKg: 10, connectedNetworks: 1, sourceColonies: 3, exploration: 0.5,
      day: MATURE_MIN_DAY,
    }));
    expect(e).toBe('');
  });

  it('胞子期でまだ最初の拠点にも届いていなければ、その条件を示す', () => {
    const e = describeEraBlocker(input());
    expect(e).toBe('条件: 最初の拠点に到達');
  });

  it('胞子期で拠点条件は満たしたが day ゲート待ちなら day を示す', () => {
    const e = describeEraBlocker(input({ coloniesReached: 1, day: 2 }));
    expect(e).toBe(`条件: Day ${DIFFUSE_MIN_DAY} まで経過`);
  });

  it('拡散期でまだ2拠点目に届いていなければその条件を示す', () => {
    const e = describeEraBlocker(input({ coloniesReached: 1, day: DIFFUSE_MIN_DAY }));
    expect(e).toBe('条件: もう1拠点に到達');
  });

  it('拡散期で拠点は足りているが質量が足りなければ質量条件を示す', () => {
    const e = describeEraBlocker(input({ coloniesReached: 2, massKg: 0.5, day: DIFFUSE_MIN_DAY }));
    expect(e).toBe('条件: 総質量を増やす');
  });

  it('拡散期で条件は満たしたが day ゲート待ちなら day を示す', () => {
    const e = describeEraBlocker(input({
      coloniesReached: 2, massKg: PLASMODIUM_MASS_KG_REQUIRED, day: DIFFUSE_MIN_DAY,
    }));
    expect(e).toBe(`条件: Day ${PLASMODIUM_MIN_DAY} まで経過`);
  });

  it('変形体期でネットワーク未統合なら「ネットワークをひとつに」を示す', () => {
    const e = describeEraBlocker(input({
      coloniesReached: 2, massKg: PLASMODIUM_MASS_KG_REQUIRED, day: PLASMODIUM_MIN_DAY,
      connectedNetworks: 2, sourceColonies: 2, exploration: 0.9,
    }));
    expect(e).toBe('条件: ネットワークをひとつに');
  });

  it('変形体期で統合済みだが探索率が足りなければその条件を示す', () => {
    const e = describeEraBlocker(input({
      coloniesReached: 3, massKg: 10, day: PLASMODIUM_MIN_DAY,
      connectedNetworks: 1, sourceColonies: 3, exploration: 0.1,
    }));
    expect(e).toBe('条件: 個体をさらに広げる');
  });

  it('変形体期で条件は満たしたが day ゲート待ちなら day を示す', () => {
    const e = describeEraBlocker(input({
      coloniesReached: 3, massKg: 10, day: PLASMODIUM_MIN_DAY,
      connectedNetworks: 1, sourceColonies: 3, exploration: 0.9,
    }));
    expect(e).toBe(`条件: Day ${MATURE_MIN_DAY} まで経過`);
  });
});

describe('estimateEraEta', () => {
  function sample(atMs: number, progress: number): EraSample {
    return { atMs, progress };
  }

  it('サンプルが1件以下なら null', () => {
    expect(estimateEraEta([])).toBeNull();
    expect(estimateEraEta([sample(0, 0.1)])).toBeNull();
  });

  it('一定速度で進む履歴から正しい ETA を推定する', () => {
    // 1000ms あたり progress 0.1 ずつ進む → 残り 0.5 なら 5000ms
    const samples = [sample(0, 0), sample(1000, 0.1), sample(2000, 0.2), sample(3000, 0.3), sample(4000, 0.4), sample(5000, 0.5)];
    const eta = estimateEraEta(samples);
    expect(eta).not.toBeNull();
    expect(eta!).toBeCloseTo(5000, -2);
  });

  it('停滞 (progress が動かない) すると null を返す', () => {
    const samples = [sample(0, 0.3), sample(1000, 0.3), sample(2000, 0.3), sample(3000, 0.3)];
    expect(estimateEraEta(samples)).toBeNull();
  });

  it('progress が後退した (質量減少などで進捗が下がった) 場合、平均速度が負なら null', () => {
    const samples = [sample(0, 0.5), sample(1000, 0.45), sample(2000, 0.4)];
    expect(estimateEraEta(samples)).toBeNull();
  });

  it('残り進捗が0以下ならETAは0', () => {
    const samples = [sample(0, 0.9), sample(1000, 1), sample(2000, 1)];
    expect(estimateEraEta(samples)).toBe(0);
  });

  it('時刻が単調でない (dtMs<=0) サンプルは無視して計算する', () => {
    const samples = [sample(0, 0), sample(1000, 0.1), sample(1000, 0.15), sample(2000, 0.2)];
    const eta = estimateEraEta(samples);
    expect(eta).not.toBeNull();
    expect(eta!).toBeGreaterThan(0);
  });
});
