// M28: 原野の全世界統計 (computeWorld のチャンク側集計への切り替え) と
// 全世界俯瞰 (worldOverview) のテスト。
// 有界6ステージの数値が不変であること (exploredChunks=0、worldOverview=null、
// 面積は従来の窓集計) もここで守る。

import { describe, it, expect } from 'vitest';
import { Game } from '../src/game.js';

describe('原野の全世界統計 (M28)', () => {
  it('有界ステージでは worldOverview は null、exploredChunks は 0', () => {
    const g = new Game(42, 'petri');
    expect(g.worldOverview()).toBeNull();
    const world = g.snapshot().world;
    expect(world.exploredChunks).toBe(0);
    expect(world.reachDistance).toBeGreaterThanOrEqual(0);
  });

  it('原野では worldOverview がチャンク要約 + 統計 + 窓原点を返す', () => {
    const g = new Game(42, 'wildland');
    const o = g.worldOverview();
    expect(o).not.toBeNull();
    expect(o!.chunks.length).toBeGreaterThan(0);
    // チャンク一辺は WILDLAND_CHUNK_CELLS × cellWorldSize(=1)。
    expect(o!.chunkWorldSize).toBe(48);
    // 窓の中心に母体 (WILDLAND_CENTER) が来る初期原点 (game.ts 参照)。
    expect(o!.windowOrigin.x).toBe(500_000 - 50);
    expect(o!.windowOrigin.y).toBe(500_000 - 50);
    expect(o!.stats.exploredChunks).toBeGreaterThan(0);
    expect(o!.tick).toBe(0);
    // 要約の中身が有限の妥当な値であること。
    for (const c of o!.chunks) {
      expect(Number.isFinite(c.nutrientAvg)).toBe(true);
      expect(c.obstacleDensity).toBeGreaterThanOrEqual(0);
      expect(c.obstacleDensity).toBeLessThanOrEqual(1);
      expect(c.biomass).toBeGreaterThanOrEqual(0);
    }
  });

  it('原野の computeWorld はチャンク側の全世界集計を使う (worldOverview.stats と同源)', () => {
    const g = new Game(7, 'wildland');
    g.tick(60);
    const world = g.snapshot().world;
    const stats = g.worldOverview()!.stats;
    // どちらも同じキャッシュ (wildlandWorldStats) から出るので一致する。
    expect(world.areaM2).toBe(stats.areaM2);
    expect(world.massKg).toBe(stats.massKg);
    expect(world.exploredChunks).toBe(stats.exploredChunks);
    // 成長後は世界に体があり、探索済みチャンクも複数ある。
    expect(world.areaM2).toBeGreaterThan(0);
    expect(world.massKg).toBeGreaterThan(0);
    expect(world.exploredChunks).toBeGreaterThan(1);
  }, 20_000);

  it('全世界統計はキャッシュされつつ、tick が進めば数え直されて伸びる', () => {
    const g = new Game(7, 'wildland');
    const at0 = g.snapshot().world.areaM2;
    expect(at0).toBe(0); // 初期状態はまだ biomass が滲んでいない
    // 再計算間隔 (24tick) を大きく超えて進めれば、必ず数え直されている。
    g.tick(240);
    const grown = g.snapshot().world;
    expect(grown.areaM2).toBeGreaterThan(at0);
    expect(grown.reachDistance).toBeGreaterThan(0);
  }, 20_000);

  it('worldOverview() の呼び出しは sim を乱さない (読み取り専用・決定論を保つ)', () => {
    const a = new Game(11, 'wildland');
    const b = new Game(11, 'wildland');
    for (let i = 0; i < 5; i++) {
      a.tick(20);
      b.tick(20);
      a.worldOverview(); // a 側だけ毎回俯瞰を取る
      a.worldOverview();
    }
    const sa = a.snapshot().state, sb = b.snapshot().state;
    expect(sa.nodes.length).toBe(sb.nodes.length);
    expect(sa.edges.length).toBe(sb.edges.length);
    for (let i = 0; i < sa.nodes.length; i++) {
      expect(sa.nodes[i]!.pos.x).toBe(sb.nodes[i]!.pos.x);
      expect(sa.nodes[i]!.pos.y).toBe(sb.nodes[i]!.pos.y);
    }
  }, 20_000);

  it('原野の到達距離は母体 (WILDLAND_CENTER) 基準で、成長とともに単調でなくとも正になる', () => {
    const g = new Game(13, 'wildland');
    // 種まき (seedSource radius=6) の時点で母体の周囲にノードが散っている。
    const initial = g.snapshot().world.reachDistance;
    expect(initial).toBeGreaterThan(0);
    expect(initial).toBeLessThan(20);
    g.tick(120);
    expect(g.snapshot().world.reachDistance).toBeGreaterThan(initial);
  }, 20_000);
});
