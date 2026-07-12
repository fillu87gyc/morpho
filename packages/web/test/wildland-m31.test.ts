// M31: 介入カーブのテスト (Game 直接駆動)。
//   - 極小スタート: 原野は「胞子1個 (source 1 + 枝2本) + 最初の餌パッチ1つ」
//   - 発芽ラッチ: 発芽前は成長が鈍い / 餌を置くと発芽して勢いが変わる
//   - 大局介入 (マクロツール): チャンク実座標への placeX / 可視化ビュー /
//     期間中の維持 / 有界ステージでは no-op
// 長時間の対照実験 (Day 3 の無介入 vs 餌) はハーネス
// (docs/playtest-2026-07-09-infinite/m31-*.txt) 側で、ここでは高速な不変条件のみ。

import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';
import { MACRO_TOOLS, CORRIDOR_LENGTH } from '../src/macro-tools.js';

// 窓ローカル座標 → 表示用密フィールドの生値 (game.test.ts の obstacleAt と同型)。
function fieldAt(g: Game, field: { data: Float32Array }, pos: { x: number; y: number }): number {
  const fs = g.fieldSize;
  const s = fs / g.worldSize;
  const x = Math.min(fs - 1, Math.max(0, Math.floor(pos.x * s)));
  const y = Math.min(fs - 1, Math.max(0, Math.floor(pos.y * s)));
  return field.data[y * fs + x] ?? 0;
}

describe('M31: 極小スタート', () => {
  it('原野は source 1点 + 枝2本 (ノード3・エッジ2) で始まる', () => {
    const g = new Game(1234, 'wildland');
    expect(g.state.nodes.filter((n) => n.type === 'source')).toHaveLength(1);
    expect(g.state.nodes).toHaveLength(3);
    expect(g.state.edges).toHaveLength(2);
  });

  it('既存6ステージの開始は不変 (皿: source 3点 × 枝6本)', () => {
    const g = new Game(1234, 'petri');
    expect(g.state.nodes.filter((n) => n.type === 'source')).toHaveLength(3);
    expect(g.state.edges).toHaveLength(18);
  });

  it('開始チャンクには餌パッチが湧いている (最初のひと口)', () => {
    const g = new Game(1234, 'wildland');
    // 窓中央 (胞子) の周囲 ±16 のどこかに、根を張れる濃さ (>0.55) の栄養がある。
    let best = 0;
    for (let dx = -16; dx <= 16; dx += 2) {
      for (let dy = -16; dy <= 16; dy += 2) {
        best = Math.max(best, fieldAt(g, g.env.nutrients, { x: 50 + dx, y: 50 + dy }));
      }
    }
    expect(best).toBeGreaterThan(0.55);
  });

  it('発芽前の Day 1 は網が小さいまま (無介入の自走爆発が起きない)', () => {
    const g = new Game(1234, 'wildland');
    g.tick(240); // Day 1
    // M31 前は Day 1 で約90〜110 リンクに達していた (第5回検証 + ハーネス実測)。
    expect(g.state.edges.length).toBeLessThan(40);
  }, 30_000);
});

describe('M31: 大局介入 (マクロツール)', () => {
  it('雨季: 広域の湿度が底上げされ、可視化ビューに残り日数が載る', () => {
    const g = new Game(7, 'wildland');
    const before = fieldAt(g, g.env.moisture, { x: 50, y: 50 });
    g.applyMacro('rain', { x: 50, y: 50 });
    g.tick(1); // 窓の焼き直しで表示用フィールドへ反映
    const after = fieldAt(g, g.env.moisture, { x: 50, y: 50 });
    expect(after).toBeGreaterThan(before + 0.2);
    // 窓の縁 (中心から約70) でも上がっている = 半径120の「広域」
    const edge = fieldAt(g, g.env.moisture, { x: 95, y: 95 });
    expect(edge).toBeGreaterThan(0.32); // baseMoisture 0.32 より上

    const views = g.snapshotFast().macroEffects!;
    expect(views).toHaveLength(1);
    expect(views[0]!.kind).toBe('rain');
    expect(views[0]!.radius).toBe(MACRO_TOOLS.rain.radius);
    expect(views[0]!.remainingDays).toBe(5);
    // ビューの座標は窓ローカル (クリックした場所)
    expect(views[0]!.center.x).toBeCloseTo(50, 0);
  });

  it('肥沃な帯: ドラッグ方向に栄養の回廊が敷かれる', () => {
    const g = new Game(7, 'wildland');
    g.applyMacro('corridor', { x: 50, y: 50 }, { x: 40, y: 0 }); // +x 方向
    g.tick(1);
    // 帯の途中 (起点から 24, 48) に根を張れる濃さの栄養
    expect(fieldAt(g, g.env.nutrients, { x: 74, y: 50 })).toBeGreaterThan(0.55);
    // 逆方向には敷かれない (帯は指定方向のみ)
    expect(fieldAt(g, g.env.nutrients, { x: 26, y: 50 })).toBeLessThan(0.3);
    const views = g.snapshotFast().macroEffects!;
    expect(views[0]!.dir!.x).toBeCloseTo(1);
    expect(views[0]!.dir!.y).toBeCloseTo(0);
    expect(views[0]!.lengthWorld).toBe(CORRIDOR_LENGTH);
  });

  it('地熱: 上げ/下げの両方向', () => {
    const g = new Game(7, 'wildland');
    const before = fieldAt(g, g.env.temperature, { x: 50, y: 50 });
    g.applyMacro('geoheat', { x: 50, y: 50 });
    g.tick(1);
    expect(fieldAt(g, g.env.temperature, { x: 50, y: 50 })).toBeGreaterThan(before + 0.05);

    const g2 = new Game(7, 'wildland');
    g2.applyMacro('geocool', { x: 50, y: 50 });
    g2.tick(1);
    expect(fieldAt(g2, g2.env.temperature, { x: 50, y: 50 })).toBeLessThan(before - 0.05);
  });

  it('期間中は再適用で維持され、期限が来ると消える', () => {
    const g = new Game(7, 'wildland');
    g.applyMacro('rain', { x: 50, y: 50 });
    // 再適用間隔 (60) を大きく超えて進める → 湿度は底上げされたまま
    g.tick(240);
    expect(fieldAt(g, g.env.moisture, { x: 50, y: 50 })).toBeGreaterThan(0.45);
    expect(g.snapshotFast().macroEffects![0]!.remainingDays).toBe(4);
  }, 30_000);

  it('有界ステージでは applyMacro は no-op で、ビューも undefined', () => {
    // 湿度は baseMoisture へ向かう自然減衰 (env.decay) が毎tick働くため、
    // 「変化しない」ではなく「applyMacro を呼んでも呼ばないときと bit 一致」
    // で no-op を確認する (同一 seed の対照)。
    const withMacro = new Game(7, 'petri');
    withMacro.applyMacro('rain', { x: 50, y: 50 });
    withMacro.tick(1);
    const without = new Game(7, 'petri');
    without.tick(1);
    expect(fieldAt(withMacro, withMacro.env.moisture, { x: 50, y: 50 }))
      .toBe(fieldAt(without, without.env.moisture, { x: 50, y: 50 }));
    expect(withMacro.snapshotFast().macroEffects).toBeUndefined();
  });

  it('決定論: 同じ seed + 同じマクロ適用は bit 一致', () => {
    const run = () => {
      const g = new Game(99, 'wildland');
      g.tick(60);
      g.applyMacro('rain', { x: 60, y: 40 });
      g.applyMacro('corridor', { x: 50, y: 50 }, { x: 0, y: 30 });
      g.tick(180);
      return g.snapshot();
    };
    const a = run(), b = run();
    expect(a.state.nodes.length).toBe(b.state.nodes.length);
    expect(a.state.edges.length).toBe(b.state.edges.length);
    for (let i = 0; i < a.state.nodes.length; i++) {
      expect(a.state.nodes[i]!.pos.x).toBe(b.state.nodes[i]!.pos.x);
      expect(a.state.nodes[i]!.pos.y).toBe(b.state.nodes[i]!.pos.y);
    }
  }, 30_000);
});
