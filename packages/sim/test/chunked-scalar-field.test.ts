// M25 (無限ワールドの正しさ): ActivityField/BiomassField はこれまで
// worldSize 全体を覆う密な Float32Array (ScalarField) のままだった。
// 無限ワールドの worldSize (例: 100,000) をそのまま渡すと、1セルが
// 数千ワールド単位を覆う致命的な低解像度になり、growth.ts の
// biomassPull (bioField.sample) が意味を失う — このテストで検証する。

import { describe, it, expect } from 'vitest';
import {
  ChunkedActivityField, ChunkedBiomassField, ActivityField, BiomassField,
} from '../src/index.js';

describe('ChunkedActivityField / ChunkedBiomassField (単体)', () => {
  it('deposit した点の近くで高い値をサンプルする', () => {
    const f = new ChunkedActivityField();
    f.deposit({ x: 50, y: 50 }, 1.0, 3);
    expect(f.sample({ x: 50, y: 50 })).toBeGreaterThan(0.5);
    expect(f.sample({ x: 5000, y: 5000 })).toBe(0); // 遠くは未生成領域 = 0
  });

  it('depositCap を超えて積み上がらない (ActivityField は 1.5)', () => {
    const f = new ChunkedActivityField();
    for (let i = 0; i < 20; i++) f.deposit({ x: 10, y: 10 }, 1.0, 3);
    expect(f.sample({ x: 10, y: 10 })).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it('depositCap を超えて積み上がらない (BiomassField は 2.5)', () => {
    const f = new ChunkedBiomassField();
    for (let i = 0; i < 20; i++) f.deposit({ x: 10, y: 10 }, 1.0, 3);
    expect(f.sample({ x: 10, y: 10 })).toBeLessThanOrEqual(2.5 + 1e-6);
  });

  it('depositSegment は線分沿いに滲む', () => {
    const f = new ChunkedBiomassField();
    f.depositSegment({ x: 0, y: 0 }, { x: 20, y: 0 }, 1.0, 2.5);
    expect(f.sample({ x: 10, y: 0 })).toBeGreaterThan(0.3); // 線分の中点付近
    expect(f.sample({ x: 10, y: 20 })).toBe(0); // 線分から大きく離れた場所
  });

  it('チャンク境界をまたぐ deposit/depositSegment も正しく複数チャンクへ書き込む', () => {
    const f = new ChunkedActivityField(24, 1); // chunkCells=24 の小さいチャンクで境界を跨がせる
    f.deposit({ x: 23, y: 12 }, 1.0, 6); // チャンク(0,0)/(1,0) の境界 (x=24) をまたぐ半径
    expect(f.generatedChunkCount()).toBeGreaterThan(1);
    expect(f.sample({ x: 26, y: 12 })).toBeGreaterThan(0); // 隣接チャンク側にも滲んでいる
  });

  it('diffuse でチャンク境界を越えて質量が伝わる (前線が隣のチャンクへ滲み出す)', () => {
    const f = new ChunkedBiomassField(24, 1);
    f.deposit({ x: 23, y: 12 }, 2.0, 2); // チャンク(0,0)の縁近くに置く
    const before = f.sample({ x: 26, y: 12 }); // 隣接チャンク(1,0)側
    for (let i = 0; i < 10; i++) f.diffuse(0.01, 0.3);
    const after = f.sample({ x: 26, y: 12 });
    expect(after).toBeGreaterThan(before);
  });

  it('diffuse は全体の質量をおおむね保存する (減衰分を除く)', () => {
    const f = new ChunkedBiomassField(32, 1);
    f.deposit({ x: 16, y: 16 }, 5.0, 4);
    const sumBefore = sumGeneratedChunks(f);
    for (let i = 0; i < 5; i++) f.diffuse(0, 0.2); // decay=0 → 拡散のみ、質量保存されるはず
    const sumAfter = sumGeneratedChunks(f);
    expect(sumAfter).toBeCloseTo(sumBefore, 0);
  });
});

// generatedChunkCount() 経由でしかチャンク一覧を得られないため、privateな
// gridへ直接アクセスせず、既知の中心周辺を広くサンプルして概算する
// テスト専用ヘルパ。
function sumGeneratedChunks(f: ChunkedBiomassField): number {
  let sum = 0;
  for (let y = -10; y <= 42; y++) {
    for (let x = -10; x <= 42; x++) {
      sum += f.sample({ x, y });
    }
  }
  return sum;
}

describe('無限ワールド規模での解像度 (回帰の再発防止)', () => {
  it('密な ActivityField(100_000, 64) は前線からの距離が伸びると分解能を失う', () => {
    // 実際に web/game.ts が今まで構築していた形 (M25 増分1時点) を再現。
    // worldSize=100,000 の密フィールドは 1 セルが 100,000/64 ≈ 1562 ワールド
    // 単位を覆うため、隣接した2点 (3 ワールド単位、growthStep 相当離れている)
    // が同じセルに丸め込まれてしまう = biomassPull が機能しない。
    const dense = new BiomassField(100_000, 64);
    dense.deposit({ x: 50_000, y: 50_000 }, 1.0, 3);
    const near = dense.sample({ x: 50_003, y: 50_000 }); // growthStep=3 先
    const center = dense.sample({ x: 50_000, y: 50_000 });
    // 分解能が粗すぎて、3ワールド単位離れても値がほぼ変わらない
    // (=biomassPull の勾配情報が事実上消えている) ことを確認する。
    expect(Math.abs(near - center)).toBeLessThan(0.01);
  });

  it('ChunkedBiomassField は同じ規模でも局所の分解能を保つ', () => {
    const chunked = new ChunkedBiomassField();
    chunked.deposit({ x: 50_000, y: 50_000 }, 1.0, 6);
    const near = chunked.sample({ x: 50_002, y: 50_000 }); // 半径内、中心よりわずかに外
    const center = chunked.sample({ x: 50_000, y: 50_000 });
    const far = chunked.sample({ x: 50_020, y: 50_000 }); // 半径の外 = 未到達
    // 中心に近いほど濃く、遠いほど薄い — 局所勾配が実際に保たれている
    // (密版だと growthStep=3 相当の距離差すら分解できず全て同値になる、
    // 上の「密な ActivityField は分解能を失う」テストと対照)。
    expect(center).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    expect(far).toBe(0);
  });
});

describe('ActivityField/BiomassField (既存の密版) との式の等価性', () => {
  it('1チャンクに収まる範囲では deposit の値が密版と近い (cellWorldSize=1 で概ね一致)', () => {
    // 密版は scale=fieldSize/worldSize=96/100≈0.96 で「cell 空間」に radius を
    // 直接使うため、chunked 版 (cellWorldSize=1) とは正確には一致しないが、
    // 同じ radius/amount パラメータで同程度の桁になることを確認する
    // (chunked-scalar-field.ts の設計コメント参照: 既存チューニング値の再利用が前提)。
    const dense = new ActivityField(100, 96);
    dense.deposit({ x: 50, y: 50 }, 1.0, 3);
    const denseVal = dense.sample({ x: 50, y: 50 });

    const chunked = new ChunkedActivityField();
    chunked.deposit({ x: 50, y: 50 }, 1.0, 3);
    const chunkedVal = chunked.sample({ x: 50, y: 50 });

    expect(chunkedVal).toBeGreaterThan(0.5);
    expect(Math.abs(chunkedVal - denseVal)).toBeLessThan(0.3);
  });
});
