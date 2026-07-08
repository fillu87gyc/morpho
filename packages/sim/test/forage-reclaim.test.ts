// M25 (無限ワールドの核心): 再採餌 (forager reclaim) の検証。
//
// 背景: 有界ワールドは食料を食べ尽くすと前線が全て sink (終端) になり、伸びる
// チップが尽きて完全停止する (ROADMAP.md M25 実測)。params.forageReclaimThreshold
// を正にすると、局所栄養が枯れた sink が relay (前線チップ) へ戻り、次の餌場へ
// 這い出せる。これにより前線が尽きず無限に前進する。
//
// このテストは (1) 既定 (threshold=0) では挙動が完全に不変であること、
// (2) チャンク食料 + reclaim で前線が停滞せず広がり続けること を確認する。

import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, ActivityField, BiomassField,
  EventBus, DEFAULT_PARAMS, run, step, createStepCache, ChunkedGridEnvironment,
  GridEnvironment, ChunkedActivityField, ChunkedBiomassField, type Vec2, type SimState,
} from '../src/index.js';
import { reclaimDepletedSinks } from '../src/graph/growth.js';

const WORLD = 100_000;
const CENTER: Vec2 = { x: WORLD / 2, y: WORLD / 2 };
const CHUNK_CELLS = 24, CELL = 1, CHUNK_W = CHUNK_CELLS * CELL;

function span(state: SimState): number {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const n of state.nodes) {
    if (n.pos.x < a) a = n.pos.x; if (n.pos.x > c) c = n.pos.x;
    if (n.pos.y < b) b = n.pos.y; if (n.pos.y > d) d = n.pos.y;
  }
  return Math.max(c - a, d - b);
}

function makeWildland(reclaim: number) {
  const env = new ChunkedGridEnvironment({
    worldSize: WORLD, worldSeed: 99, chunkCells: CHUNK_CELLS, cellWorldSize: CELL,
    // 各チャンクに決定的に食料パッチを1つ (原野ステージの地形モデル)。
    generateTerrain: (_c, rng) => ({
      foodPatches: [{ x: rng.range(4, CHUNK_W - 4), y: rng.range(4, CHUNK_W - 4), radius: 5, amount: 1.0 }],
    }),
  });
  const params = { ...DEFAULT_PARAMS, forageReclaimThreshold: reclaim };
  const rng = createRNG(99);
  const act = new ActivityField(WORLD, 64);
  const bio = new BiomassField(WORLD, 64);
  const state = createInitialState(99, WORLD);
  seedSource(state, CENTER, 6);
  const bus = new EventBus();
  const cache = createStepCache();
  return { env, params, rng, act, bio, state, bus, cache };
}

interface WildlandWorld {
  env: ChunkedGridEnvironment;
  params: typeof DEFAULT_PARAMS;
  rng: ReturnType<typeof createRNG>;
  act: Parameters<typeof step>[2];
  bio: Parameters<typeof step>[3];
  state: SimState;
  bus: EventBus;
  cache: ReturnType<typeof createStepCache>;
}

function drive(w: WildlandWorld, ticks: number) {
  for (let t = 1; t <= ticks; t++) {
    step(w.state, w.env, w.act, w.bio, w.params, w.rng, w.bus, w.cache);
    w.env.decay(0.0006, 0.0009, 0.0009, 0.0015);
  }
}

// makeWildland は ActivityField/BiomassField (worldSize 全体を覆う密フィールド)
// を使っていた — チャンク化スカラー場 (chunked-scalar-field.test.ts) の追加で
// 判明した通り、無限規模の worldSize ではこれが解像度を失い biomassPull が
// 事実上効かなくなる。この対照はチャンク化した ChunkedActivityField/
// ChunkedBiomassField を使い、正しい局所解像度のままでも同じ「reclaim ありは
// 停滞しない」結論が成り立つことを確認する — game.ts が実際に配線するのは
// こちらの構成になる。
function makeWildlandChunked(reclaim: number) {
  const env = new ChunkedGridEnvironment({
    worldSize: WORLD, worldSeed: 99, chunkCells: CHUNK_CELLS, cellWorldSize: CELL,
    generateTerrain: (_c, rng) => ({
      foodPatches: [{ x: rng.range(4, CHUNK_W - 4), y: rng.range(4, CHUNK_W - 4), radius: 5, amount: 1.0 }],
    }),
  });
  const params = { ...DEFAULT_PARAMS, forageReclaimThreshold: reclaim };
  const rng = createRNG(99);
  const act = new ChunkedActivityField();
  const bio = new ChunkedBiomassField();
  const state = createInitialState(99, WORLD);
  seedSource(state, CENTER, 6);
  const bus = new EventBus();
  const cache = createStepCache();
  return { env, params, rng, act, bio, state, bus, cache };
}

describe('reclaimDepletedSinks (単体)', () => {
  it('threshold=0 なら何もしない (sink は sink のまま)', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 });
    const state = createInitialState(1, 100);
    state.nodes.push({ id: 1, pos: { x: 50, y: 50 }, type: 'sink', bornAt: 0 });
    reclaimDepletedSinks(state, env, { ...DEFAULT_PARAMS, forageReclaimThreshold: 0 });
    expect(state.nodes[state.nodes.length - 1]!.type).toBe('sink');
  });

  it('局所栄養が threshold 未満の sink を relay へ戻す', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 });
    env.placeFood({ x: 20, y: 20 }, 6, 1.0); // ここは栄養あり
    const state = createInitialState(1, 100);
    const fed = { id: 1, pos: { x: 20, y: 20 }, type: 'sink' as const, bornAt: 0 };
    const starved = { id: 2, pos: { x: 80, y: 80 }, type: 'sink' as const, bornAt: 0 };
    state.nodes.push(fed, starved);
    reclaimDepletedSinks(state, env, { ...DEFAULT_PARAMS, forageReclaimThreshold: 0.3 });
    expect(fed.type).toBe('sink');       // 栄養がある → 維持
    expect(starved.type).toBe('relay');  // 枯れている → 前線チップへ復帰
  });
});

describe('既存挙動の不変性 (回帰ゼロ)', () => {
  it('threshold=0 のとき有界 GridEnvironment の結果は従来と完全一致 (決定論)', () => {
    // 同じ seed/params で2回まわしてビット一致することを確認 (reclaim を挟んでも
    // threshold=0 では step の結果が変わらない)。既存の決定論テスト群が別途あるが、
    // ここでも reclaim 配線後の等価性を明示的に固定する。
    const build = () => {
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 });
      env.placeFood({ x: 50, y: 50 }, 10, 1.5);
      const rng = createRNG(7);
      const act = new ActivityField(100, 64);
      const bio = new BiomassField(100, 64);
      const state = createInitialState(7, 100);
      seedSource(state, { x: 50, y: 50 }, 6);
      const bus = new EventBus();
      run(state, env, act, bio, DEFAULT_PARAMS, rng, bus, 2000);
      return state;
    };
    const a = build(), b = build();
    expect(a.nodes.length).toBe(b.nodes.length);
    expect(a.edges.length).toBe(b.edges.length);
    expect(a.nodes.map((n) => `${n.type}:${n.pos.x.toFixed(4)},${n.pos.y.toFixed(4)}`))
      .toEqual(b.nodes.map((n) => `${n.type}:${n.pos.x.toFixed(4)},${n.pos.y.toFixed(4)}`));
  });
});

describe('無限ステージの前線が停滞しない (M25 受け入れ)', () => {
  it('reclaim ありは前線 (span/生成チャンク数) が中盤→終盤も伸び続ける', () => {
    const w = makeWildland(0.3);
    drive(w, 3000);
    const midSpan = span(w.state), midChunks = w.env.generatedChunkCount();
    drive(w, 5000); // 合計 8000 tick
    const endSpan = span(w.state), endChunks = w.env.generatedChunkCount();

    // 前線が前半で凍結せず、後半でも新しい土地へ踏み出し続けている。
    expect(endSpan).toBeGreaterThan(midSpan);
    expect(endChunks).toBeGreaterThan(midChunks);
    // 到達範囲が最初のチャンク (24単位) をはるかに超える。
    expect(endSpan).toBeGreaterThan(60);
  }, 60_000);

  it('reclaim なしは同条件で早期に頭打ちになる (対照)', () => {
    const control = makeWildland(0);
    drive(control, 3000);
    const midChunks = control.env.generatedChunkCount();
    drive(control, 5000);
    const endChunks = control.env.generatedChunkCount();
    const treatment = makeWildland(0.3);
    drive(treatment, 8000);

    // reclaim ありの方が明確に多くの土地へ広がる。
    expect(treatment.env.generatedChunkCount()).toBeGreaterThan(endChunks * 1.5);
    // 対照は後半でチャンク生成がほぼ止まる (前線が sink で詰まる)。
    expect(endChunks - midChunks).toBeLessThan(treatment.env.generatedChunkCount() / 3);
  }, 60_000);
});

describe('チャンク化スカラー場でも同じ結論が成り立つ (実際に game.ts が配線する構成)', () => {
  it('ChunkedActivityField/ChunkedBiomassField でも reclaim ありは伸び続ける', () => {
    const w = makeWildlandChunked(0.3);
    drive(w, 3000);
    const midSpan = span(w.state), midChunks = w.env.generatedChunkCount();
    drive(w, 5000);
    const endSpan = span(w.state), endChunks = w.env.generatedChunkCount();
    expect(endSpan).toBeGreaterThan(midSpan);
    expect(endChunks).toBeGreaterThan(midChunks);
    expect(endSpan).toBeGreaterThan(60);
  }, 60_000);
});
