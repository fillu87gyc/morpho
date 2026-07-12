// M29: 成熟領域の休眠 + チャンク evict の検証。
//
// 検証するのは5点 (ROADMAP.md M29 の受け入れ基準):
//   (1) 休眠パラメタ既定 (checkInterval=0) では挙動が完全に不変 (bit 一致)
//       — 既存の決定論テスト群に加えて、ここでも明示的に固定する。
//   (2) 休眠有効時も seed 決定的 (同じ seed → 同じ最終状態 + 同じ休眠集合)。
//   (3) 長時間 (16,800 tick = Day 70 相当) 回しても span の成長が維持され
//       つつ、実体チャンク数 (= diffuse/decay の走査対象) は探索済み
//       チャンク総数のように単調増加せず、帯 (前線サイズ) の中で頭打ちになる。
//   (4) growth / reclaim は休眠セルのノードを触らない (単体対照)。
//   (5) 休眠セルのエッジは凍結されるが、起床 (wakeDormantArea) すれば
//       再び状態更新へ参加する。
//
// 地形は before/after 実測ハーネス (docs/playtest-2026-07-09-infinite/
// sim-100day-dormancy.txt) と同一 (seed 99、チャンク食料 + 35% 障害物、
// reclaim=0.3)。長時間駆動が高価なので、休眠有効の 16,800 tick 走行1本を
// モジュール内で共有する — 決定論比較 (b側) だけは独立にもう1本回す。
// 起床系のテストは共有走行を変異させるため、必ずファイル末尾 (読み取り系の
// 後) に置くこと。

import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, ActivityField, BiomassField,
  EventBus, DEFAULT_PARAMS, run, step, createStepCache, ChunkedGridEnvironment,
  GridEnvironment, ChunkedActivityField, ChunkedBiomassField,
  wakeDormantArea, dormancyCellKeyAt,
  type Vec2, type SimState, type SimParams,
} from '../src/index.js';
import { reclaimDepletedSinks } from '../src/graph/growth.js';

const WORLD = 100_000;
const CENTER: Vec2 = { x: WORLD / 2, y: WORLD / 2 };
const CHUNK_CELLS = 24, CELL = 1, CHUNK_W = CHUNK_CELLS * CELL;

// 原野で使う想定の休眠パラメタ (実測ハーネスと同じ値)。
const DORMANCY_ON: Partial<SimParams> = {
  dormancyCheckInterval: 60,
  dormancyCellWorld: CHUNK_W,
  dormancyFrontierCells: 4,
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
      foodPatches: [{ x: rng.range(4, CHUNK_W - 4), y: rng.range(4, CHUNK_W - 4), radius: rng.range(4, 6), amount: rng.range(0.9, 1.3) }],
      obstaclePatches: rng.next() < 0.35 ? [{ x: rng.range(4, CHUNK_W - 4), y: rng.range(4, CHUNK_W - 4), radius: rng.range(2, 5) }] : [],
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

// diffuse/decay が毎tick走査する対象 = 3フィールドの実体チャンク数の合計。
function materialized(w: Wildland): number {
  return w.env.generatedChunkCount() + w.act.generatedChunkCount() + w.bio.generatedChunkCount();
}

// 状態の指紋: ノード位置/種別 + エッジの生命状態を文字列化 (bit 一致の検査用)。
function fingerprint(state: SimState): string[] {
  return [
    ...state.nodes.map((n) => `n${n.id}:${n.type}:${n.pos.x},${n.pos.y}`),
    ...state.edges.map((e) => `e${e.id}:${e.activity},${e.fatigue},${e.radius},${e.flux}`),
  ];
}

// 休眠有効の共有走行 (16,800 tick = Day 70 相当)。前線が旧領域へ戻ると evict
// 済みチャンクが復元されて実体数が振動するため、点ではなく 600 tick ごとの
// サンプル列を記録し、テスト側は窓平均で判定する。統計の読み取り
// (generatedChunkCount / span 等) はすべて副作用なしなので、途中で読んでも
// 連続駆動と bit 一致のまま。
interface Sample { t: number; span: number; mat: number; touched: number }
interface SharedRun { w: Wildland; samples: Sample[] }
const SHARED_TICKS = 16_800;
let shared: SharedRun | null = null;
function getSharedOnRun(): SharedRun {
  if (!shared) {
    const w = makeWildland(DORMANCY_ON);
    const samples: Sample[] = [];
    for (let t = 1; t <= SHARED_TICKS; t++) {
      step(w.state, w.env, w.act, w.bio, w.params, w.rng, w.bus, w.cache);
      w.env.decay(0.0006, 0.0009, 0.0009, 0.0015);
      w.bus.drain();
      if (t % 600 === 0 && t >= 4800) {
        samples.push({ t, span: span(w.state), mat: materialized(w), touched: w.env.touchedChunkCount() });
      }
    }
    shared = { w, samples };
  }
  return shared;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

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

describe('growth / reclaim は休眠セルのノードを触らない (単体対照)', () => {
  it('reclaimDepletedSinks は休眠セルの sink を relay へ戻さない', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 }); // 栄養ゼロ = 両方とも枯れている
    const state = createInitialState(1, 100);
    const dormantSink = { id: 1, pos: { x: 12, y: 12 }, type: 'sink' as const, bornAt: 0 };
    const awakeSink = { id: 2, pos: { x: 80, y: 80 }, type: 'sink' as const, bornAt: 0 };
    state.nodes.push(dormantSink, awakeSink);
    const params: SimParams = { ...DEFAULT_PARAMS, forageReclaimThreshold: 0.3, ...DORMANCY_ON };
    state.dormantCells = new Set([dormancyCellKeyAt(12, 12, CHUNK_W)]);
    reclaimDepletedSinks(state, env, params);
    expect(dormantSink.type).toBe('sink');  // 休眠 → 触らない (環境サンプルもしない)
    expect(awakeSink.type).toBe('relay');   // 起きている → 従来どおり前線チップへ戻す
  });

  it('休眠セルの tip は伸びない (休眠セル指定だけを変えた対照実験)', () => {
    const build = (asleep: boolean) => {
      const rng = createRNG(5);
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 });
      env.placeFood({ x: 30, y: 50 }, 8, 1.2);
      const act = new ActivityField(100, 64);
      const bio = new BiomassField(100, 64);
      const state = createInitialState(5, 100);
      seedSource(state, { x: 50, y: 50 }, 6);
      // 判定 (updateDormancy) は走らせず、手で置いた休眠集合だけの効果を見る。
      const params: SimParams = { ...DEFAULT_PARAMS, ...DORMANCY_ON, dormancyCheckInterval: 1_000_000 };
      state.dormantCells = asleep
        ? new Set(state.nodes.map((n) => dormancyCellKeyAt(n.pos.x, n.pos.y, CHUNK_W)))
        : new Set();
      run(state, env, act, bio, params, rng, new EventBus(), 60);
      return state;
    };
    // 全ノードのセルが休眠 → source も tip も一切伸びない (seedSource の
    // source 1 + tip 6 のまま)。空の休眠集合 → 通常どおり成長する。
    expect(build(true).nodes.length).toBe(7);
    expect(build(false).nodes.length).toBeGreaterThan(7);
  });
});

describe('休眠有効時の決定論', () => {
  it('同じ seed からは同じ最終状態と同じ休眠集合が得られる (evict 込み)', () => {
    const a = getSharedOnRun().w;
    const b = makeWildland(DORMANCY_ON);
    drive(b, SHARED_TICKS);
    expect(fingerprint(a.state)).toEqual(fingerprint(b.state));
    expect([...(a.state.dormantCells ?? [])].sort()).toEqual([...(b.state.dormantCells ?? [])].sort());
    expect(a.env.generatedChunkCount()).toBe(b.env.generatedChunkCount());
    expect(a.env.evictedChunkCount()).toBe(b.env.evictedChunkCount());
    // 実際に休眠と evict が起きている前提での比較であること (空集合同士の
    // 自明な一致ではない) を確認する。
    expect((a.state.dormantCells ?? new Set()).size).toBeGreaterThan(0);
    expect(a.env.evictedChunkCount()).toBeGreaterThan(0);
  }, 300_000);
});

describe('長時間の対照: 成長は維持しつつ走査コストが頭打ちになる (M29 受け入れ)', () => {
  it('span は伸び続け、実体チャンク数は探索量に比例して増え続けない', () => {
    const { samples } = getSharedOnRun();
    const midWin = samples.filter((s) => s.t >= 10800 && s.t <= 13200);
    const lateWin = samples.filter((s) => s.t >= 14400 && s.t <= 16800);
    const last = samples[samples.length - 1]!;
    const early = samples[0]!; // t=4800

    // (a) 前線は休眠有効でも凍結しない: 終盤の span は序盤より大きく、
    //     最初のチャンク (24単位) をはるかに超えて広がっている。
    expect(mean(lateWin.map((s) => s.span))).toBeGreaterThan(early.span);
    expect(last.span).toBeGreaterThan(100);

    // (b) 探索 (触れたチャンク総数) は後半も進み続ける — 実体数の頭打ちが
    //     「成長の停止」によるものではないことの裏取り。
    expect(last.touched).toBeGreaterThan(midWin[0]!.touched * 1.7);

    // (c) 一方で diffuse/decay の走査対象 (実体チャンク数) は増え続けない:
    //     探索が7割超進む間、実体数の窓平均は横ばい (振動の帯の中) に留まる。
    //     休眠無効では実体 = touched でどちらも単調増加する (before 実測)。
    expect(mean(lateWin.map((s) => s.mat))).toBeLessThan(mean(midWin.map((s) => s.mat)) * 1.3);

    // (d) 終盤時点で、実体チャンクは触れたチャンク総数のごく一部だけ。
    expect(last.mat / 3).toBeLessThan(last.touched * 0.5);
  }, 300_000);

  it('休眠セル・凍結エッジ・evict 済みチャンクが実際に存在し、統計は整合する', () => {
    const { w } = getSharedOnRun();
    expect((w.state.dormantCells ?? new Set()).size).toBeGreaterThan(0);
    expect(w.env.evictedChunkCount()).toBeGreaterThan(0);
    // 探索統計 (touchedChunkCount) は evict で減らない。
    expect(w.env.touchedChunkCount()).toBe(w.env.generatedChunkCount() + w.env.evictedChunkCount());
    // 休眠セルに中点を持つエッジ (凍結対象) が存在する。
    const byId = new Map(w.state.nodes.map((n) => [n.id, n]));
    const dormant = w.state.dormantCells!;
    const frozenEdges = w.state.edges.filter((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b) return false;
      return dormant.has(dormancyCellKeyAt((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, CHUNK_W));
    });
    expect(frozenEdges.length).toBeGreaterThan(0);
  }, 300_000);
});

// ⚠️ ここから下は共有走行 (getSharedOnRun) を変異させる。読み取り系のテスト
// より後に置くこと (vitest はファイル内を宣言順に実行する)。
describe('休眠 → 起床でノードが再び成長へ参加する', () => {
  it('休眠セルのエッジは凍結され、wakeDormantArea + 餌で再び動き出す', () => {
    const w = getSharedOnRun().w;
    const dormant = w.state.dormantCells!;
    expect(dormant.size).toBeGreaterThan(0);

    // 休眠セルに中点を持つ、activity がまだ残っているエッジを1本選ぶ
    // (完全に 0 のエッジは起床しても数値が動かないため検査に使えない)。
    const byId = new Map(w.state.nodes.map((n) => [n.id, n]));
    const target = w.state.edges.find((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (!a || !b || e.activity < 0.2) return false;
      return dormant.has(dormancyCellKeyAt((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, CHUNK_W));
    });
    expect(target).toBeDefined();
    const a = byId.get(target!.from)!, b = byId.get(target!.to)!;
    const mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };

    // 凍結の確認: 休眠中は activity/fatigue/radius が 1 tick たりとも動かない。
    // 判定 tick (checkInterval の倍数) を跨ぐと休眠集合が更新されうるので、
    // その手前まで/セルが休眠でありつづける間だけ見る。
    const frozen = { activity: target!.activity, fatigue: target!.fatigue, radius: target!.radius };
    for (let t = 0; t < 12; t++) {
      if ((w.state.tick + 1) % w.params.dormancyCheckInterval === 0) break;
      if (!w.state.dormantCells!.has(dormancyCellKeyAt(mid.x, mid.y, CHUNK_W))) break;
      step(w.state, w.env, w.act, w.bio, w.params, w.rng, w.bus, w.cache);
      expect(target!.activity).toBe(frozen.activity);
      expect(target!.fatigue).toBe(frozen.fatigue);
      expect(target!.radius).toBe(frozen.radius);
    }

    // 起床: プレイヤーツール相当 (餌を置く + wakeDormantArea)。evict 済みの
    // フィールドチャンクは placeFood の書き込みが自動的に要約値から復元する。
    wakeDormantArea(w.state, w.params, mid, 12);
    expect(w.state.dormantCells!.has(dormancyCellKeyAt(mid.x, mid.y, CHUNK_W))).toBe(false);
    w.env.placeFood(mid, 8, 1.2);

    // 起床後は状態更新が再開する (activity は毎 tick 0.85/0.15 で目標へ追従
    // する)。数 tick 回して、凍結されていた値のどれかが必ず動くことを見る。
    const before = { activity: target!.activity, fatigue: target!.fatigue, radius: target!.radius, stress: target!.stress };
    for (let t = 0; t < 8; t++) {
      step(w.state, w.env, w.act, w.bio, w.params, w.rng, w.bus, w.cache);
    }
    const moved = target!.activity !== before.activity || target!.fatigue !== before.fatigue ||
      target!.radius !== before.radius || target!.stress !== before.stress;
    expect(moved).toBe(true);
  }, 300_000);
});
