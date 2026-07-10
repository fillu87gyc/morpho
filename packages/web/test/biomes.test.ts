// M30: バイオーム (biomes.ts) のテスト。
//   - 決定論: 同じ (チャンク座標, worldSeed) は常に同じバイオーム。
//   - 分布: 5種すべてが現実的な頻度で出現し、荒地 (旅の主役) が主要な
//     割合を占めつつ連続しすぎない (地帯はまとまるが、森は必ずどこかにある)。
//   - まとまり: ノイズがチャンク単位のばらばらな砂嵐ではなく「地帯」を
//     作ること (隣接チャンクの一致率がランダムより十分高い)。
//   - 子孫接続: wildMutationBoost の単調性と上限。

import { describe, it, expect } from 'vitest';
import { biomeAt, valueNoise, wildMutationBoost, BIOME_MUTATION_FACTOR, type BiomeId } from '../src/biomes.js';

const ALL: BiomeId[] = ['forest', 'barrens', 'rocky', 'toxic', 'waterside'];

// 原野の開始チャンク近傍を模した領域を数 seed ぶん走査する共通ヘルパ。
function census(seed: number, half = 40): Map<BiomeId, number> {
  const counts = new Map<BiomeId, number>(ALL.map((b) => [b, 0]));
  for (let cy = -half; cy < half; cy++) {
    for (let cx = -half; cx < half; cx++) {
      const b = biomeAt(cx, cy, seed);
      counts.set(b, counts.get(b)! + 1);
    }
  }
  return counts;
}

describe('biomeAt の決定論', () => {
  it('同じ (cx, cy, worldSeed) は常に同じバイオーム (負座標・大きな seed 含む)', () => {
    for (const [cx, cy, seed] of [[0, 0, 1], [-7, 13, 1234], [10416, 10416, 987654321], [-100, -100, 42]] as const) {
      expect(biomeAt(cx, cy, seed)).toBe(biomeAt(cx, cy, seed));
    }
  });

  it('worldSeed が違えば地図も変わる (十分な割合のチャンクで不一致)', () => {
    let diff = 0, total = 0;
    for (let cy = 0; cy < 20; cy++) {
      for (let cx = 0; cx < 20; cx++) {
        total++;
        if (biomeAt(cx, cy, 1) !== biomeAt(cx, cy, 2)) diff++;
      }
    }
    expect(diff / total).toBeGreaterThan(0.3);
  });

  it('valueNoise は [0,1] に収まり連続的 (隣接サンプルの差が小さい)', () => {
    let prev = valueNoise(0, 0, 7, 1);
    for (let i = 1; i <= 100; i++) {
      const v = valueNoise(i * 0.05, 3.3, 7, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.25); // 格子1/20刻みで飛ばない
      prev = v;
    }
  });
});

describe('バイオームの分布 (複数 seed で頑健)', () => {
  it('80×80 チャンクの領域に5種すべてが出現する', () => {
    for (const seed of [1, 1234, 99, 5555]) {
      const counts = census(seed);
      for (const b of ALL) {
        expect(counts.get(b)!, `seed=${seed} biome=${b}`).toBeGreaterThan(0);
      }
    }
  });

  it('荒地は主要な割合 (15〜55%) を占めるが、森 (餌場) も 20% 以上ある', () => {
    for (const seed of [1, 1234, 99, 5555]) {
      const counts = census(seed);
      const total = 80 * 80;
      const barrens = counts.get('barrens')! / total;
      const forest = counts.get('forest')! / total;
      expect(barrens, `seed=${seed}`).toBeGreaterThan(0.15);
      expect(barrens, `seed=${seed}`).toBeLessThan(0.55);
      expect(forest, `seed=${seed}`).toBeGreaterThan(0.20);
    }
  });

  it('地帯としてまとまる: 隣接チャンクのバイオーム一致率がランダムより十分高い', () => {
    // 5種が独立ランダムなら一致率は Σp² ≈ 0.3 前後。値ノイズの地帯なら
    // 大部分の隣接ペアは同じ地帯に入る。
    for (const seed of [1, 1234]) {
      let same = 0, total = 0;
      for (let cy = -30; cy < 30; cy++) {
        for (let cx = -30; cx < 30; cx++) {
          const b = biomeAt(cx, cy, seed);
          if (biomeAt(cx + 1, cy, seed) === b) same++;
          if (biomeAt(cx, cy + 1, seed) === b) same++;
          total += 2;
        }
      }
      expect(same / total, `seed=${seed}`).toBeGreaterThan(0.7);
    }
  });
});

describe('wildMutationBoost (子孫の出番)', () => {
  it('距離に対して単調非減少で、飽和後は一定', () => {
    const b0 = wildMutationBoost(0, 'forest');
    const b250 = wildMutationBoost(250, 'forest');
    const b500 = wildMutationBoost(500, 'forest');
    const b9999 = wildMutationBoost(9999, 'forest');
    expect(b0).toBe(1); // 母体のそば・穏やかな森 = 補正なし
    expect(b250).toBeGreaterThan(b0);
    expect(b500).toBeGreaterThan(b250);
    expect(b9999).toBe(b500);
  });

  it('過酷なバイオーム (荒地/毒) ほど大きい', () => {
    const d = 300;
    expect(wildMutationBoost(d, 'barrens')).toBeGreaterThan(wildMutationBoost(d, 'forest'));
    expect(wildMutationBoost(d, 'toxic')).toBeGreaterThan(wildMutationBoost(d, 'rocky'));
    expect(wildMutationBoost(d, 'rocky')).toBeGreaterThan(wildMutationBoost(d, 'waterside'));
  });

  it('上限 2.0 を超えない・下限 1.0 を下回らない (負の距離も安全)', () => {
    for (const b of ALL) {
      expect(wildMutationBoost(1e9, b)).toBeLessThanOrEqual(2.0);
      expect(wildMutationBoost(-10, b)).toBeGreaterThanOrEqual(1.0);
      expect(BIOME_MUTATION_FACTOR[b]).toBeGreaterThanOrEqual(1.0);
    }
  });
});
