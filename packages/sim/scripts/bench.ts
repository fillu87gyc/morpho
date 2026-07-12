// 再現可能な性能ベンチ (M8 P0)。
//
//   pnpm run bench            -- フルレポート: tick コストの成長カーブ + サブステップ内訳
//   pnpm run bench -- --smoke -- CI 向け: 短時間走らせて極端な回帰だけを検出する
//
// 「計測基盤が何もない」状態だったので、まずこれを用意する。
// サブステップ (index/flux/activity/biomass/radius/growth/prune) 毎の
// 内訳を見たいので、step() を経由せず graph/ 配下の関数を直接呼ぶ
// (step() 自体は buildIndex キャッシュを持つが、ベンチでは常に素の
// コストを見たいので毎tick buildIndex し直す)。

import {
  createInitialState, seedSource, createRNG, GridEnvironment, clearAroundSource,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS,
  type SimParams,
} from '../src/index.js';
import { buildIndex } from '../src/graph/index-utils.js';
import { updateFlux } from '../src/graph/flux.js';
import { updateActivity, updateBiomass, updateRadius } from '../src/graph/life.js';
import { growthStep } from '../src/graph/growth.js';
import { prune } from '../src/graph/prune.js';

const WORLD = 100;
const FIELD = 64;

// game.ts の petri ステージと同じ構図 (3コロニー + 6食料点) を
// sim パッケージ単体で再現する (web への依存は持ち込まない)。
const SOURCE_POINTS = [{ x: 30, y: 30 }, { x: 70, y: 30 }, { x: 50, y: 75 }];
const FOOD_POINTS = [
  { pos: { x: 22, y: 22 }, radius: 4.5 },
  { pos: { x: 78, y: 22 }, radius: 5.0 },
  { pos: { x: 82, y: 55 }, radius: 4.0 },
  { pos: { x: 78, y: 80 }, radius: 5.0 },
  { pos: { x: 22, y: 78 }, radius: 4.5 },
  { pos: { x: 18, y: 50 }, radius: 4.0 },
];

function setup(seed: number) {
  const rng = createRNG(seed);
  const env = new GridEnvironment({ worldSize: WORLD, fieldSize: FIELD });
  for (const f of FOOD_POINTS) env.placeFood(f.pos, f.radius, 1.0);
  const act = new ActivityField(WORLD, FIELD);
  const bio = new BiomassField(WORLD, FIELD);
  const state = createInitialState(seed, WORLD);
  for (const p of SOURCE_POINTS) { clearAroundSource(env, p, 4); seedSource(state, p, 6); }
  const bus = new EventBus();
  return { state, env, act, bio, rng, bus };
}

type Setup = ReturnType<typeof setup>;

interface SubTimes {
  index: number; flux: number; activity: number; biomass: number;
  radius: number; growth: number; prune: number;
}
function zeroTimes(): SubTimes {
  return { index: 0, flux: 0, activity: 0, biomass: 0, radius: 0, growth: 0, prune: 0 };
}

function stepWithTiming(
  ctx: Setup, params: SimParams, acc: SubTimes,
): void {
  const { state, env, act, bio, rng, bus } = ctx;
  state.tick++;

  let t0 = performance.now();
  const idx = buildIndex(state);
  acc.index += performance.now() - t0;

  t0 = performance.now();
  updateFlux(state, params, idx);
  acc.flux += performance.now() - t0;

  t0 = performance.now();
  updateActivity(state, env, act, params, idx);
  acc.activity += performance.now() - t0;

  t0 = performance.now();
  updateBiomass(state, bio, params, idx);
  acc.biomass += performance.now() - t0;

  if (state.tick % 4 === 0) {
    t0 = performance.now();
    updateRadius(state, params, bus, idx);
    acc.radius += performance.now() - t0;
  }
  if (state.tick % 12 === 0) {
    t0 = performance.now();
    growthStep(state, env, bio, params, rng, bus, idx);
    acc.growth += performance.now() - t0;
  }
  if (state.tick % 60 === 0) {
    t0 = performance.now();
    prune(state, params, bus);
    acc.prune += performance.now() - t0;
  }
  bus.drain(); // 溜め続けると無駄にメモリを食うだけなので毎tick捨てる
}

const fmt = (n: number) => n.toFixed(3).padStart(7);

function runReport(totalTicks: number, reportEvery: number): void {
  const ctx = setup(7);
  console.log(
    'tick  nodes  edges |   index    flux activity biomass  radius  growth   prune | ms/tick',
  );
  let acc = zeroTimes();
  let windowStart = 0;
  for (let t = 1; t <= totalTicks; t++) {
    stepWithTiming(ctx, DEFAULT_PARAMS, acc);
    if (t % reportEvery === 0) {
      const span = t - windowStart;
      const total = acc.index + acc.flux + acc.activity + acc.biomass + acc.radius + acc.growth + acc.prune;
      console.log(
        `${String(t).padStart(5)} ${String(ctx.state.nodes.length).padStart(6)} ${String(ctx.state.edges.length).padStart(6)} | ` +
        `${fmt(acc.index / span)} ${fmt(acc.flux / span)} ${fmt(acc.activity / span)} ${fmt(acc.biomass / span)} ` +
        `${fmt(acc.radius / span)} ${fmt(acc.growth / span)} ${fmt(acc.prune / span)} | ${fmt(total / span)}`,
      );
      acc = zeroTimes();
      windowStart = t;
    }
  }
}

// CI 向け: 短時間走らせて「壊滅的な回帰」(O(n^2) 化のバグ混入など) だけを
// 検出する。閾値は意図的に緩い (通常の実測は 1〜2ms/tick 程度)。
// CI ランナーの速度差やノイズで揺れて false positive にならないことを優先する。
function runSmoke(): void {
  const ctx = setup(7);
  const TICKS = 600;
  const acc = zeroTimes();
  const t0 = performance.now();
  for (let t = 0; t < TICKS; t++) stepWithTiming(ctx, DEFAULT_PARAMS, acc);
  const elapsed = performance.now() - t0;
  const perTick = elapsed / TICKS;
  console.log(
    `smoke: ${TICKS} ticks in ${elapsed.toFixed(1)}ms (${perTick.toFixed(3)}ms/tick avg), ` +
    `nodes=${ctx.state.nodes.length} edges=${ctx.state.edges.length}`,
  );
  const THRESHOLD_MS = 30;
  if (perTick > THRESHOLD_MS) {
    console.error(`NG: ${perTick.toFixed(3)}ms/tick average exceeds smoke threshold (${THRESHOLD_MS}ms)`);
    process.exit(1);
  }
  console.log('OK');
}

// M14 事前計測: 「大陸」ステージ (拠点20〜40、FIELD 96→192/256) を導入して
// 良いか判断するための tick コスト曲線。worldSize は既存ステージと同じ
// コロニー密度を保つよう field 比率に合わせて拡大する (「解像度だけ上げる」
// のではなく「本当に広い世界」を再現するため)。
function setupWorldScale(seed: number, field: number, colonyCount: number) {
  const worldSize = Math.round(100 * (field / FIELD));
  const rng = createRNG(seed);
  const env = new GridEnvironment({ worldSize, fieldSize: field });
  const sources: { x: number; y: number }[] = [];
  for (let i = 0; i < colonyCount; i++) {
    const a = (i / colonyCount) * Math.PI * 2;
    const r = worldSize * 0.35;
    sources.push({ x: worldSize / 2 + Math.cos(a) * r, y: worldSize / 2 + Math.sin(a) * r });
  }
  for (const s of sources) env.placeFood({ x: s.x, y: s.y }, worldSize * 0.05, 1.0);
  const act = new ActivityField(worldSize, field);
  const bio = new BiomassField(worldSize, field);
  const state = createInitialState(seed, worldSize);
  for (const p of sources) { clearAroundSource(env, p, 4); seedSource(state, p, 6); }
  const bus = new EventBus();
  return { state, env, act, bio, rng, bus };
}

function runWorldScale(): void {
  const configs: { field: number; colonies: number }[] = [
    { field: 96, colonies: 3 },
    { field: 96, colonies: 20 },
    { field: 96, colonies: 40 },
    { field: 192, colonies: 20 },
    { field: 192, colonies: 40 },
    { field: 256, colonies: 40 },
  ];
  const TICKS = 800;
  console.log('field colonies | worldSize |  nodes  edges | ms/tick | 実効速度目安 (16ms予算)');
  for (const cfg of configs) {
    const ctx = setupWorldScale(7, cfg.field, cfg.colonies);
    const worldSize = Math.round(100 * (cfg.field / FIELD));
    const acc = zeroTimes();
    const t0 = performance.now();
    for (let t = 0; t < TICKS; t++) stepWithTiming(ctx, DEFAULT_PARAMS, acc);
    const elapsed = performance.now() - t0;
    const perTick = elapsed / TICKS;
    const effSpeed = 16 / perTick;
    console.log(
      `${String(cfg.field).padStart(5)} ${String(cfg.colonies).padStart(8)} | ${String(worldSize).padStart(9)} | ` +
      `${String(ctx.state.nodes.length).padStart(6)} ${String(ctx.state.edges.length).padStart(6)} | ${fmt(perTick)} | ×${effSpeed.toFixed(1)}`,
    );
  }
}

// M25: 「チャンク化前後で tick 結果が bit 一致する」ことのリグレッション
// テスト (test/chunk-grid.test.ts / determinism.test.ts) とは別に、M25〜M27
// (半無限ワールド) が現実的に到達しうる規模 (エッジ1万本オーダー) で
// 性能が崩れないことを確認するための大規模ケース。
//
// 有限ワールドで自然な成長だけに任せると、初期食料を使い切った時点で
// 定常状態に入り ~650〜1300 edges で頭打ちになる (食料を外周へ定期的に
// 足しても、境界 (worldMargin) に達した前線はそこで伸長を止めるため
// 解消しない — M25〜M27 の動機そのもので、ROADMAP.md「現在地」の
// 第4回検証で実測した Day24 完全停滞と同じ現象)。半無限ワールド自体は
// このセッションの範囲外なので、代わりに格子状の合成ネットワーク
// (nodes/edges を直接構築) で1万エッジ規模を再現し、そのスケールで
// 毎tickのサブシステム (flux/activity/biomass/growth/prune) が
// 破綻しないことを確認する。
function buildSyntheticLattice(sideNodes: number, worldSize: number): Setup {
  const state = createInitialState(7, worldSize);
  const spacing = worldSize / sideNodes;
  const idOf = (x: number, y: number) => y * sideNodes + x;
  for (let y = 0; y < sideNodes; y++) {
    for (let x = 0; x < sideNodes; x++) {
      state.nodes.push({
        id: idOf(x, y),
        pos: { x: (x + 0.5) * spacing, y: (y + 0.5) * spacing },
        type: x === 0 && y === 0 ? 'source' : (x === sideNodes - 1 && y === sideNodes - 1 ? 'sink' : 'relay'),
        bornAt: 0,
      });
    }
  }
  let nextEdgeId = 0;
  for (let y = 0; y < sideNodes; y++) {
    for (let x = 0; x < sideNodes; x++) {
      if (x + 1 < sideNodes) {
        state.edges.push({
          id: nextEdgeId++, from: idOf(x, y), to: idOf(x + 1, y), length: spacing, bornAt: 0,
          flux: 0, radius: 0.8, activity: 0.5, fatigue: 0, stress: 0,
        });
      }
      if (y + 1 < sideNodes) {
        state.edges.push({
          id: nextEdgeId++, from: idOf(x, y), to: idOf(x, y + 1), length: spacing, bornAt: 0,
          flux: 0, radius: 0.8, activity: 0.5, fatigue: 0, stress: 0,
        });
      }
    }
  }
  state.nextNodeId = sideNodes * sideNodes;
  state.nextEdgeId = nextEdgeId;

  const rng = createRNG(7);
  const env = new GridEnvironment({ worldSize, fieldSize: 256 });
  env.placeFood({ x: worldSize * 0.9, y: worldSize * 0.9 }, worldSize * 0.05, 1.0);
  const act = new ActivityField(worldSize, 256);
  const bio = new BiomassField(worldSize, 256);
  const bus = new EventBus();
  return { state, env, act, bio, rng, bus };
}

function runLargeScale(): void {
  // 71×71 格子 ≈ 5041 nodes, 2×71×70 = 9940 edges。
  // 合成格子は実際の flux 経路に基づかないため、prune (60tick毎) が
  // 「活動していない枝」として大半を刈ってしまう — それ自体は sim の
  // 正しい振る舞いであり、このベンチの関心事ではない。ここで測りたいのは
  // 「1万エッジ規模のグラフ1枚に対して各サブシステムが1tickでいくら
  // かかるか」なので、prune が effective に効き始める前 (60tick 未満) の
  // 範囲だけを計測する。
  const ctx = buildSyntheticLattice(71, 400);
  console.log(`large-scale: 合成格子で nodes=${ctx.state.nodes.length} edges=${ctx.state.edges.length} を用意`);
  const TICKS = 40;
  const acc = zeroTimes();
  const t0 = performance.now();
  for (let t = 0; t < TICKS; t++) stepWithTiming(ctx, DEFAULT_PARAMS, acc);
  const elapsed = performance.now() - t0;
  const perTick = elapsed / TICKS;
  console.log(`large-scale: ${TICKS} ticks 後 (prune 前) nodes=${ctx.state.nodes.length} edges=${ctx.state.edges.length}, ${fmt(perTick)} ms/tick avg, ×${(16 / perTick).toFixed(1)} 実効速度目安`);
  console.log(`  内訳 (合計ms): index=${acc.index.toFixed(0)} flux=${acc.flux.toFixed(0)} activity=${acc.activity.toFixed(0)} biomass=${acc.biomass.toFixed(0)} radius=${acc.radius.toFixed(0)} growth=${acc.growth.toFixed(0)} prune=${acc.prune.toFixed(0)}`);
}

if (process.argv.includes('--smoke')) runSmoke();
else if (process.argv.includes('--largescale')) runLargeScale();
else if (process.argv.includes('--worldscale')) runWorldScale();
else runReport(1500, 100);
