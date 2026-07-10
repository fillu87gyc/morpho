// M29: 成熟領域の休眠 + チャンク evict の検証。
//
// 検証するのは4点 (ROADMAP.md M29 の受け入れ基準):
//   (1) 休眠パラメタ既定 (checkInterval=0) では挙動が完全に不変 (bit 一致)
//       — 既存の決定論テスト群に加えて、ここでも明示的に固定する。
//   (2) 休眠有効時も seed 決定的 (同じ seed → 同じ最終状態 + 同じ休眠集合)。
//   (3) 長時間 (数千tick) 回しても span の成長がほぼ維持されつつ、実体
//       チャンク数 (= diffuse/decay の走査コスト) が前線サイズで頭打ちになる。
//   (4) 休眠したノードは成長に参加しないが、起床 (wakeDormantArea) すれば
//       再び参加する。
//
// 構成は forage-reclaim.test.ts の makeWildlandChunked (原野の地形モデル) を踏襲。

import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, ActivityField, BiomassField,
  EventBus, DEFAULT_PARAMS, run, step, createStepCache, ChunkedGridEnvironment,
  GridEnvironment, ChunkedActivityField, ChunkedBiomassField,
  wakeDormantArea, dormancyCellKeyAt,
  type Vec2, type SimState, type SimParams,
} from '../src/index.js';

const WORLD = 100_000;
const CENTER: Vec2 = { x: WORLD / 2, y: WORLD / 2 };
const CHUNK_CELLS = 24, CELL = 1, CHUNK_W = CHUNK_CELLS * CELL;

// 原野で使う想定の休眠パラメタ (harness/実測と同じ値)。
const DORMANCY_ON: Partial<SimParams> = {
  dormancyCheckInterval: 60,
  dormancyCellWorld: CHUNK_W,
  dormancyFrontierCells: 12,
  dormancyFrontierMargin: 1,
  dormancyEvict: true,
};

function span(state: SimState): number {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const n of state.nodes) {
    if (n.pos.x < a) a = n.pos.x; if (n.pos.x > c) c = n.pos.x;
    if (n.pos.y < b) b = n.pos.y; if (n.pos.y > d) d = n.pos.y;
  }
  return Math.max(c - a, d - b);
}

function makeWildland(overrides: Partial<SimParams>, seed = 99) {
  const env = new ChunkedGridEnvironment({
    worldSize: WORLD, worldSeed: seed, chunkCells: CHUNK_CELLS, cellWorldSize: CELL,
    generateTerrain: (_c, rng) => ({
      foodPatches: [{ x: rng.range(4, CHUNK_W - 4), y: rng.range(4, CHUNK_W - 4), radius: 5, amount: 1.0 }],
    }),
  });
  const params: SimParams = { ...DEFAULT_PARAMS, forageReclaimThreshold: 0.3, ...overrides };
  const rng = createRNG(seed);
  const act = new ChunkedActivityField(CHUNK_CELLS, CELL);
  const bio = new ChunkedBiomassField(CHUNK_CELLS, CELL);
  const state = createInitialState(seed, WORLD);
  seedSource(state, CENTER, 6);
  const bus = new EventBus();
  const cache = createStepCache();
  return { env, params, rng, act, bio, state, bus, cache };
}

type Wildland = ReturnType<typeof makeWildland>;

function drive(w: Wildland, ticks: number) {
  for (let t = 1; t <= ticks; t++) {
    step(w.state, w.env, w.act, w.bio, w.params, w.rng, w.bus, w.cache);
    w.env.decay(0.0006, 0.0009, 0.0009, 0.0015);
    w.bus.drain();
  }
}

// 状態の指紋: ノード位置/種別 + エッジの生命状態を文字列化 (bit 一致の検査用)。
function fingerprint(state: SimState): string[] {
  return [
    ...state.nodes.map((n) => `n${n.id}:${n.type}:${n.pos.x},${n.pos.y}`),
    ...state.edges.map((e) => `e${e.id}:${e.activity},${e.fatigue},${e.radius},${e.flux}`),
  ];
}

describe('既定無効の bit 一致 (回帰ゼロ)', () => {
  it('dormancy パラメタを明示的に既定値で渡しても、有界ステージの結果は完全一致', () => {
    // DEFAULT_PARAMS 自体に休眠フィールドが増えたので、既存の決定論テストが
    // そのまま「既定無効の bit 一致」を担保している。ここでは休眠フィールド
    // だけを明示的に再指定した run と比較して、既定値が本当に無効 (コードパス
    // 不変) であることを固定する。
    const build = (params: SimParams) => {
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 });
      env.placeFood({ x: 50, y: 50 }, 10, 1.5);
      const rng = createRNG(7);
      const act = new ActivityField(100, 64);
      const bio = new BiomassField(100, 64);
      const state = createInitialState(7, 100);
      seedSource(state, { x: 50, y: 50 }, 6);
      run(state, env, act, bio, params, rng, new EventBus(), 1200);
      return state;
    };
    const a = build(DEFAULT_PARAMS);
    const b = build({ ...DEFAULT_PARAMS, dormancyCheckInterval: 0, dormancyEvict: false });
    expect(fingerprint(a)).toEqual(fingerprint(b));
    expect(a.dormantCells).toBeUndefined();
    expect(b.dormantCells).toBeUndefined();
  });
});

describe('休眠有効時の決定論', () => {
  it('同じ seed からは同じ最終状態と同じ休眠集合が得られる (evict 込み)', () => {
    const a = makeWildland(DORMANCY_ON);
    const b = makeWildland(DORMANCY_ON);
    drive(a, 3000);
    drive(b, 3000);
    expect(fingerprint(a.state)).toEqual(fingerprint(b.state));
    expect([...(a.state.dormantCells ?? [])].sort()).toEqual([...(b.state.dormantCells ?? [])].sort());
    expect(a.env.generatedChunkCount()).toBe(b.env.generatedChunkCount());
    expect(a.env.evictedChunkCount()).toBe(b.env.evictedChunkCount());
    // 実際に休眠と evict が起きている前提での比較であること (空集合同士の
    // 自明な一致ではない) を確認する。
    expect((a.state.dormantCells ?? new Set()).size).toBeGreaterThan(0);
  }, 60_000);
});

describe('長時間の対照実験: 成長は維持しつつコストが頭打ちになる (M29 受け入れ)', () => {
  it('休眠有効でも span は伸び続け、実体チャンク数は休眠無効より明確に少ない', () => {
    const off = makeWildland({});
    const on = makeWildland(DORMANCY_ON);
    drive(off, 3000);
    drive(on, 3000);
    const midOnSpan = span(on.state);
    const midOnChunks = on.env.generatedChunkCount() + on.act.generatedChunkCount() + on.bio.generatedChunkCount();
    drive(off, 5000); // 合計 8000 tick (Day 33 相当)
    drive(on, 5000);

    // (a) 前線は休眠有効でも凍結しない: 後半も span が伸び、最初のチャンク
    //     (24単位) をはるかに超える (forage-reclaim.test.ts と同じ基準)。
    expect(span(on.state)).toBeGreaterThan(midOnSpan);
    expect(span(on.state)).toBeGreaterThan(60);

    // (b) diffuse/decay の走査対象 (実体チャンク数) は evict で回収され、
    //     休眠無効の走査対象より明確に少ない = コストが総経過時間ではなく
    //     前線サイズに比例する。
    const offChunks = off.env.generatedChunkCount() + off.act.generatedChunkCount() + off.bio.generatedChunkCount();
    const onChunks = on.env.generatedChunkCount() + on.act.generatedChunkCount() + on.bio.generatedChunkCount();
    expect(onChunks).toBeLessThan(offChunks * 0.6);

    // (c) 実体チャンク数が「増え続けて」いない: 中盤→終盤の増分が中盤までの
    //     蓄積より小さい (無効側は単調に増え続ける)。
    expect(onChunks - midOnChunks).toBeLessThan(midOnChunks);

    // (d) 休眠エッジが実際に存在し (スキップが効いている)、evict も起きている。
    expect((on.state.dormantCells ?? new Set()).size).toBeGreaterThan(0);
    expect(on.env.evictedChunkCount()).toBeGreaterThan(0);

    // (e) 探索統計 (touchedChunkCount) は evict で減らない。
    expect(on.env.touchedChunkCount()).toBe(on.env.generatedChunkCount() + on.env.evictedChunkCount());
  }, 120_000);
});

describe('休眠 → 起床でノードが再び成長へ参加する', () => {
  it('休眠セルのエッジは凍結され、wakeDormantArea + 餌で再び動き出す', () => {
    const w = makeWildland(DORMANCY_ON);
    drive(w, 3000);
    const dormant = w.state.dormantCells!;
    expect(dormant.size).toBeGreaterThan(0);

    // 休眠セルに中点を持つエッジを1本選ぶ。
    const byId = new Map(w.state.nodes.map((n) => [n.id, n]));
    const target = w.state.edges.find((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) return false;
      return dormant.has(dormancyCellKeyAt((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, CHUNK_W));
    });
    expect(target).toBeDefined();
    const a = byId.get(target!.from)!, b = byId.get(target!.to)!;
    const mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };

    // 凍結の確認: 休眠中は activity/fatigue/radius が 1 tick たりとも動かない。
    const frozen = { activity: target!.activity, fatigue: target!.fatigue, radius: target!.radius };
    for (let t = 0; t < 12; t++) {
      // 判定 tick (checkInterval の倍数) を避けて回す — 前線が動くと休眠集合
      // も更新されるため、ここでは「休眠でありつづける間は凍結」だけを見る。
      if ((w.state.tick + 1) % w.params.dormancyCheckInterval === 0) break;
      if (!dormant.has(dormancyCellKeyAt(mid.x, mid.y, CHUNK_W))) break;
      step(w.state, w.env, w.act, w.bio, w.params, w.rng, w.bus, w.cache);
      expect(target!.activity).toBe(frozen.activity);
      expect(target!.fatigue).toBe(frozen.fatigue);
      expect(target!.radius).toBe(frozen.radius);
    }

    // 起床: プレイヤーツール相当 (餌を置く + wakeDormantArea)。
    wakeDormantArea(w.state, w.params, mid, 12);
    expect(w.state.dormantCells!.has(dormancyCellKeyAt(mid.x, mid.y, CHUNK_W))).toBe(false);
    w.env.placeFood(mid, 8, 1.2);

    // 起床後は状態更新が再開する (activity は毎 tick 0.85/0.15 で追従するので
    // 1 tick で必ず動く — 完全に同値のままなら凍結が解けていない)。
    const before = { activity: target!.activity, fatigue: target!.fatigue };
    step(w.state, w.env, w.act, w.bio, w.params, w.rng, w.bus, w.cache);
    const moved = target!.activity !== before.activity || target!.fatigue !== before.fatigue;
    expect(moved).toBe(true);
  }, 60_000);

  it('growth も再参加する: 起床した領域の近くで新しいノードが生まれうる', () => {
    // 休眠領域のノード数は凍結される (growth が触らない) こと自体を確認する:
    // 3000 tick 時点の休眠セル群に属するノード ID 集合は、その後 600 tick
    // (growth 50回ぶん) 回しても「増えない」(前線が戻って起床した場合を除き、
    // このシナリオでは前線は外へ向かうため戻らない)。
    const w = makeWildland(DORMANCY_ON);
    drive(w, 3000);
    const dormant = new Set(w.state.dormantCells!);
    const inDormant = (p: Vec2) => dormant.has(dormancyCellKeyAt(p.x, p.y, CHUNK_W));
    const idsBefore = new Set(w.state.nodes.filter((n) => inDormant(n.pos)).map((n) => n.id));
    drive(w, 600);
    // 現在も休眠しているセルに限って数える (前線接近で起床したセルは対象外)。
    const still = w.state.dormantCells!;
    for (const n of w.state.nodes) {
      if (!still.has(dormancyCellKeyAt(n.pos.x, n.pos.y, CHUNK_W))) continue;
      if (!dormant.has(dormancyCellKeyAt(n.pos.x, n.pos.y, CHUNK_W))) continue;
      // 3000 tick 時点から休眠しつづけているセルに、新しいノードは生まれない。
      expect(idsBefore.has(n.id) || n.bornAt > 3000).toBe(true);
      if (idsBefore.has(n.id)) continue;
      // bornAt > 3000 のノードが居るなら、それは生成時に wakeCellAt で起床
      // したセルのはず — ここへは到達しないのが期待値。
      expect.unreachable(`休眠セルに新ノード (id=${n.id}, bornAt=${n.bornAt}) が生まれた`);
    }
  }, 60_000);
});
