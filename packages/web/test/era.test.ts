import { describe, it, expect } from 'vitest';
import {
  eraFor, type EraInput,
  DIFFUSE_MIN_DAY, PLASMODIUM_MIN_DAY, MATURE_MIN_DAY, PLASMODIUM_MASS_KG_REQUIRED,
  estimateEraEta, type EraSample,
  describeEraBlocker,
  wildlandEraFor, describeWildlandEraBlocker, type WildlandEraInput,
  WILDLAND_DIFFUSE_REACH_REQUIRED, WILDLAND_DIFFUSE_CHUNKS_REQUIRED,
  WILDLAND_PLASMODIUM_CHUNKS_REQUIRED, WILDLAND_PLASMODIUM_BIOMES_REQUIRED,
  WILDLAND_MATURE_REACH_REQUIRED, WILDLAND_MATURE_BIOMES_REQUIRED,
  WILDLAND_DIFFUSE_MIN_DAY, WILDLAND_PLASMODIUM_MIN_DAY, WILDLAND_MATURE_MIN_DAY,
  WILDLAND_ERA_ETA_SMOOTHING_ALPHA,
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

  // M32: smoothingAlpha 引数の追加は既存6ステージの呼び出し (引数なし) の
  // 挙動を変えないこと、かつ渡した場合は進捗の揺れを均して ETA を安定させる
  // ことを検証する。
  describe('smoothingAlpha (M32: 原野の ETA 平滑化)', () => {
    it('smoothingAlpha を渡さない呼び出しは既存の挙動と完全に一致する (既存6ステージ不変)', () => {
      const samples = [sample(0, 0), sample(1000, 0.1), sample(2000, 0.2), sample(3000, 0.3)];
      expect(estimateEraEta(samples, undefined)).toBe(estimateEraEta(samples));
    });

    it('進捗が一時的に大きく後退しても、平滑化すると null にならず ETA を出せる', () => {
      // 一定の速度で伸びたあと、1点だけ大きく後退してすぐ立ち直る (M30 の
      // 距離コスト勾配で遠征枝が枯れて戻る挙動を模したノイズ)。平滑化なし
      // (raw) は直前の急な後退にそのまま引っ張られて null (見積もれない) に
      // なるが、progress を EMA で均してから速度を推定する平滑化版は
      // 後退1点分に振り切られず ETA を出せる。
      const samples = [
        sample(0, 0.08), sample(1000, 0.11), sample(2000, 0.14), sample(3000, 0.17), sample(4000, 0.20),
        sample(5000, 0.23), sample(6000, 0.26), sample(7000, 0.29), sample(8000, 0.32),
        sample(9000, 0.14) /* 大きく後退 */, sample(10000, 0.17), sample(11000, 0.20),
      ];
      expect(estimateEraEta(samples)).toBeNull();
      expect(estimateEraEta(samples, WILDLAND_ERA_ETA_SMOOTHING_ALPHA)).not.toBeNull();
    });

    it('ノイズを含む増加系列に対し、平滑化した ETA 系列は平滑化なしより分散が小さい (安定性)', () => {
      // 「増加トレンド + 単発ノイズ」を模した progress 系列をスライディング
      // ウィンドウで estimateEraEta に渡し (ui.ts の renderEraEta と同じ使い方)、
      // 出てくる ETA の系列の変動 (連続差分の絶対値の平均) を比較する。
      const noisyProgress = [0.05, 0.09, 0.07, 0.14, 0.11, 0.20, 0.16, 0.27, 0.22, 0.33, 0.29, 0.40];
      const rawEtas: number[] = [];
      const smoothedEtas: number[] = [];
      for (let end = 3; end <= noisyProgress.length; end++) {
        const window = noisyProgress.slice(0, end).map((p, i) => sample(i * 1000, p));
        const raw = estimateEraEta(window);
        const smoothed = estimateEraEta(window, WILDLAND_ERA_ETA_SMOOTHING_ALPHA);
        if (raw !== null) rawEtas.push(raw);
        if (smoothed !== null) smoothedEtas.push(smoothed);
      }
      const meanAbsDiff = (xs: number[]): number => {
        if (xs.length < 2) return 0;
        let sum = 0;
        for (let i = 1; i < xs.length; i++) sum += Math.abs(xs[i]! - xs[i - 1]!);
        return sum / (xs.length - 1);
      };
      expect(smoothedEtas.length).toBeGreaterThan(2);
      expect(meanAbsDiff(smoothedEtas)).toBeLessThan(meanAbsDiff(rawEtas));
    });
  });
});

describe('wildlandEraFor (M32: 原野の時代)', () => {
  // exploredChunks の既定 9 は実プレイの初期窓 (母体の森 3×3 チャンク) の
  // 焼き込みぶんに相当する (game.ts)。「まだ何も探索していない」を厳密に
  // 表すテストでは明示的に 0 を渡す。
  function wInput(overrides: Partial<WildlandEraInput> = {}): WildlandEraInput {
    return { reachDistance: 0, exploredChunks: 9, biomesDiscovered: 1, day: 0, ...overrides };
  }

  it('母体の森の中 (到達距離・探索チャンクとも条件未満) は胞子期、progress 0', () => {
    const e = wildlandEraFor(wInput({ exploredChunks: 0 }));
    expect(e.name).toBe('胞子期');
    expect(e.progress).toBe(0);
  });

  it('到達距離が伸びると胞子期のまま progress が上がる', () => {
    const e = wildlandEraFor(wInput({ exploredChunks: 0, reachDistance: WILDLAND_DIFFUSE_REACH_REQUIRED / 2 }));
    expect(e.name).toBe('胞子期');
    expect(e.progress).toBeCloseTo(0.5);
  });

  it('母体の森を出ても day が閾値未満なら胞子期のまま (day 進捗を表示)', () => {
    const e = wildlandEraFor(wInput({ reachDistance: WILDLAND_DIFFUSE_REACH_REQUIRED, day: 1 }));
    expect(e.name).toBe('胞子期');
    expect(e.progress).toBeCloseTo(1 / WILDLAND_DIFFUSE_MIN_DAY);
  });

  it('母体の森を出て day 要件も満たすと拡散期に入る', () => {
    const e = wildlandEraFor(wInput({ reachDistance: WILDLAND_DIFFUSE_REACH_REQUIRED, day: WILDLAND_DIFFUSE_MIN_DAY }));
    expect(e.name).toBe('拡散期');
  });

  it('探索チャンク数だけでも母体の森を出た判定になる (到達距離とは OR 条件)', () => {
    const e = wildlandEraFor(wInput({ exploredChunks: WILDLAND_DIFFUSE_CHUNKS_REQUIRED, day: WILDLAND_DIFFUSE_MIN_DAY }));
    expect(e.name).toBe('拡散期');
  });

  it('拡散期の条件 (探索チャンク+バイオーム数) を満たしても day が足りなければ拡散期のまま', () => {
    const e = wildlandEraFor(wInput({
      reachDistance: WILDLAND_DIFFUSE_REACH_REQUIRED,
      exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED, biomesDiscovered: WILDLAND_PLASMODIUM_BIOMES_REQUIRED,
      day: WILDLAND_DIFFUSE_MIN_DAY,
    }));
    expect(e.name).toBe('拡散期');
  });

  it('拡散期の条件 + day 要件を満たすと変形体期に入る', () => {
    const e = wildlandEraFor(wInput({
      reachDistance: WILDLAND_DIFFUSE_REACH_REQUIRED,
      exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED, biomesDiscovered: WILDLAND_PLASMODIUM_BIOMES_REQUIRED,
      day: WILDLAND_PLASMODIUM_MIN_DAY,
    }));
    expect(e.name).toBe('変形体期');
  });

  it('探索チャンクが足りればバイオーム数不足でも拡散期条件は満たすが、変形体期条件のバイオーム不足で変形体期には入らない', () => {
    const e = wildlandEraFor(wInput({
      exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED, biomesDiscovered: 1,
      day: WILDLAND_PLASMODIUM_MIN_DAY,
    }));
    expect(e.name).toBe('拡散期');
  });

  it('成熟期の条件 (到達距離+バイオーム数) + day 要件で成熟期に入る', () => {
    const e = wildlandEraFor(wInput({
      reachDistance: WILDLAND_MATURE_REACH_REQUIRED, biomesDiscovered: WILDLAND_MATURE_BIOMES_REQUIRED,
      exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED,
      day: WILDLAND_MATURE_MIN_DAY,
    }));
    expect(e.name).toBe('成熟期');
    expect(e.progress).toBe(1);
  });

  it('到達距離は足りてもバイオーム数が足りなければ成熟期にならない', () => {
    const e = wildlandEraFor(wInput({
      reachDistance: WILDLAND_MATURE_REACH_REQUIRED, biomesDiscovered: 2,
      exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED,
      day: WILDLAND_MATURE_MIN_DAY,
    }));
    expect(e.name).toBe('変形体期');
  });

  it('progress は常に [0,1] に収まる', () => {
    for (const reach of [0, 50, 100, 300, 1000]) {
      for (const chunks of [0, 10, 20, 40, 100]) {
        for (const biomes of [1, 2, 3, 4, 5]) {
          for (const day of [0, 3, 15, 35, 100]) {
            const e = wildlandEraFor(wInput({ reachDistance: reach, exploredChunks: chunks, biomesDiscovered: biomes, day }));
            expect(e.progress).toBeGreaterThanOrEqual(0);
            expect(e.progress).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('条件をすべて満たしたまま日数だけが経過すると胞子期→拡散期→変形体期→成熟期と単調に進む', () => {
    const names: string[] = [];
    for (const day of [0, WILDLAND_DIFFUSE_MIN_DAY, WILDLAND_PLASMODIUM_MIN_DAY, WILDLAND_MATURE_MIN_DAY]) {
      const e = wildlandEraFor(wInput({
        reachDistance: WILDLAND_MATURE_REACH_REQUIRED, exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED,
        biomesDiscovered: WILDLAND_MATURE_BIOMES_REQUIRED, day,
      }));
      names.push(e.name);
    }
    expect(names).toEqual(['胞子期', '拡散期', '変形体期', '成熟期']);
  });
});

describe('describeWildlandEraBlocker', () => {
  it('成熟期に到達済みなら空文字', () => {
    const e = describeWildlandEraBlocker({
      reachDistance: WILDLAND_MATURE_REACH_REQUIRED, exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED,
      biomesDiscovered: WILDLAND_MATURE_BIOMES_REQUIRED, day: WILDLAND_MATURE_MIN_DAY,
    });
    expect(e).toBe('');
  });

  it('胞子期でまだ母体の森を出ていなければその条件を示す', () => {
    const e = describeWildlandEraBlocker({ reachDistance: 0, exploredChunks: 9, biomesDiscovered: 1, day: 0 });
    expect(e).toBe('条件: 母体の森の外へ');
  });

  it('胞子期で条件は満たしたが day ゲート待ちなら day を示す', () => {
    const e = describeWildlandEraBlocker({
      reachDistance: WILDLAND_DIFFUSE_REACH_REQUIRED, exploredChunks: 9, biomesDiscovered: 1, day: 1,
    });
    expect(e).toBe(`条件: Day ${WILDLAND_DIFFUSE_MIN_DAY} まで経過`);
  });

  it('拡散期でバイオーム数が足りなければその条件を示す', () => {
    const e = describeWildlandEraBlocker({
      reachDistance: WILDLAND_DIFFUSE_REACH_REQUIRED, exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED,
      biomesDiscovered: 1, day: WILDLAND_DIFFUSE_MIN_DAY,
    });
    expect(e).toBe('条件: 別のバイオームを見つける');
  });

  it('変形体期で到達距離が足りなければその条件を示す', () => {
    const e = describeWildlandEraBlocker({
      reachDistance: 100, exploredChunks: WILDLAND_PLASMODIUM_CHUNKS_REQUIRED,
      biomesDiscovered: WILDLAND_PLASMODIUM_BIOMES_REQUIRED, day: WILDLAND_PLASMODIUM_MIN_DAY,
    });
    expect(e).toBe('条件: さらに遠くまで到達');
  });
});
