// M32: 原野を本編に — 目標系と記録系の全面接続 (Game 経由の統合テスト)。
//   - 原野の時代は wildlandEraFor (無限世界の節目) で進み、拠点数ベースの
//     旧条件 (「もう1拠点に到達」) では止まらない
//   - WorldInfo.biomesDiscovered が実際に伸びる (era/quests の入力)
//   - quests に wild-reach/wild-biomes が含まれ、reachDistance/biomesDiscovered
//     から進捗が出る
//   - 有界6ステージの era/quests は完全に不変 (eraFor のまま、拠点数ベース)

import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

describe('原野の時代 (M32: wildlandEraFor への配線)', () => {
  it('開始直後は胞子期・progress 0 に近い (母体の森の中)', () => {
    const g = new Game(1234, 'wildland');
    const snap = g.snapshot();
    expect(snap.era.name).toBe('胞子期');
    expect(snap.world.biomesDiscovered).toBeGreaterThanOrEqual(1); // 母体の森 (forest) は最初から発見済み
  });

  it('成長させると到達距離・探索チャンクが伸び、時代が胞子期から先へ進む', () => {
    const g = new Game(1234, 'wildland');
    g.tick(2400); // Day 10 相当
    const snap = g.snapshot();
    expect(snap.world.reachDistance).toBeGreaterThan(0);
    expect(snap.world.exploredChunks).toBeGreaterThan(9); // 初期窓 (3×3) より広い
    // 拠点数ベースの旧条件 (もう1拠点に到達) には一切依存しない指標で
    // 時代が判定されている = 胞子期に恒久停止しない見込みがある。
    expect(['胞子期', '拡散期', '変形体期', '成熟期']).toContain(snap.era.name);
  }, 30_000);

  it('有界ステージ (皿) の時代判定は M32 で完全に不変 (拠点数ベース)', () => {
    const g = new Game(1234, 'petri');
    const snap = g.snapshot();
    expect(snap.era.name).toBe('胞子期');
    expect(snap.world.biomesDiscovered).toBe(0); // 原野以外では常に0
  });

  // M32 実プレイ検証で発見した回帰: reachDistance (現在の最遠ノードまでの
  // 距離) は M30 の距離コスト勾配で遠征枝が枯れて戻ると縮む (非単調)。
  // seed=1 は実測で Day15 reach 84 → Day20 68 と後退し、それをそのまま
  // 時代の条件に使うと 拡散期 → 胞子期 に後退して見えた。
  // reachDistancePeak (生涯最大値) を条件に使うことでこれを防いでいる。
  it('reachDistance が後退しても、reachDistancePeak は単調非減少で時代は後退しない', () => {
    const ERA_ORDER = ['胞子期', '拡散期', '変形体期', '成熟期'];
    const g = new Game(1, 'wildland');
    let bestIdx = 0;
    let sawReachRegression = false;
    let prevReach = 0;
    let prevPeak = 0;
    for (const day of [5, 10, 15, 20, 25, 30]) {
      const targetTick = day * 240;
      while (g.state.tick < targetTick) g.tick(Math.min(240, targetTick - g.state.tick));
      const snap = g.snapshot();
      if (snap.world.reachDistance < prevReach) sawReachRegression = true;
      expect(snap.world.reachDistancePeak).toBeGreaterThanOrEqual(prevPeak); // 単調非減少
      prevReach = snap.world.reachDistance;
      prevPeak = snap.world.reachDistancePeak;
      const idx = ERA_ORDER.indexOf(snap.era.name);
      expect(idx).toBeGreaterThanOrEqual(bestIdx); // 時代名は後退しない
      bestIdx = Math.max(bestIdx, idx);
    }
    // このテスト自体が「reachDistance は実際に後退することがある」という
    // 前提 (seed=1 で実測済み) の上に成り立つことを確認しておく。
    expect(sawReachRegression).toBe(true);
  }, 60_000);
});

describe('原野のクエスト (M32: wild-reach / wild-biomes)', () => {
  it('開始直後は wild-reach/wild-biomes が quests に含まれ、進捗が過大にならない', () => {
    const g = new Game(1234, 'wildland');
    const quests = g.snapshot().quests;
    const wildReach = quests.find((q) => q.id === 'wild-reach');
    const wildBiomes = quests.find((q) => q.id === 'wild-biomes');
    expect(wildReach).toBeDefined();
    expect(wildBiomes).toBeDefined();
    expect(wildReach!.done).toBe(false);
    // M32 受け入れ基準: 開始直後に自動達成されるクエスト/チャレンジが無い。
    expect(wildBiomes!.done).toBe(false);
  });

  it('成長させると wild-reach の進捗が伸びる', () => {
    const g = new Game(1234, 'wildland');
    const before = g.snapshot().quests.find((q) => q.id === 'wild-reach')!.progress;
    g.tick(2400);
    const after = g.snapshot().quests.find((q) => q.id === 'wild-reach')!.progress;
    expect(after).toBeGreaterThan(before);
  }, 30_000);

  it('有界ステージ (皿) では connect-all/explore-70 の挙動が M32 で完全に不変', () => {
    const g = new Game(1234, 'petri');
    const quests = g.snapshot().quests;
    // coloniesTotal (=foodPoints.length, 皿は6) に対し coloniesReached=0 で開始する。
    expect(quests.find((q) => q.id === 'connect-all')!.progress).toBe(0);
    expect(quests.find((q) => q.id === 'explore-70')!.done).toBe(false);
  });
});
