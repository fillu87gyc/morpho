// 「生命」サブステップ: 1 エッジを 1 つの個体と見て、
//   - 自身を場に書き込み (Activity / Biomass)、
//   - 場と環境を参照して activity / fatigue / stress / radius を更新する。
// step.ts のかわりにここに集約することで、ローカル則を一望できるようにする。

import type { SimState, SimEdge, Vec2 } from '../types.js';
import type { Environment } from '../env/environment.js';
import type { ActivityFieldLike, BiomassFieldLike } from '../field/scalar-field.js';
import type { EventBus } from '../events/bus.js';
import type { SimParams } from './params.js';
import { type NodeIndex, buildDensityGrid, clamp01, crowdingAt } from './index-utils.js';
import { dormantSetOf, dormancyCellKeyAt } from './dormancy.js';

// crowdingAt が 3x3 近傍探索だけで半径内を漏れなくカバーできる条件は
// cellSize == radius (index-utils.ts 参照)。呼び出し側の半径 (4) と揃える。
const CROWDING_RADIUS = 4;

// M10: 最適温度からの乖離度に応じた suitability [0,1]。tempTolerance 以内は
// 満点、そこから tempTolerance ぶん離れるとゼロまで線形に落ちる
// (= 「離れるほど活動の回復と成長確率が落ちる」の実装)。
function tempSuitability(temperature: number, params: SimParams): number {
  const dev = Math.abs(temperature - params.tempOptimal);
  if (dev <= params.tempTolerance) return 1;
  return Math.max(0, 1 - (dev - params.tempTolerance) / params.tempTolerance);
}

// ── Activity: 場に書く → 拡散 → 各エッジが場を読んで自分を更新 ─

export function updateActivity(
  state: SimState, env: Environment, actField: ActivityFieldLike,
  params: SimParams, idx: NodeIndex,
): void {
  // M29: 休眠セル (成熟して前線から遠い領域) のエッジは deposit と状態更新の
  // 両方をスキップする。dormant が undefined (既定 = 休眠無効) ならセルキー
  // 計算ごと省くので、既存ステージの挙動・演算は bit 一致で不変。
  const dormant = dormantSetOf(state, params);
  const cw = params.dormancyCellWorld;

  // M30: 距離のコスト勾配。母体 (source) からのグラフ距離 h の hop キャッシュ
  // (flux BFS が低頻度で記録、flux.ts) を引き、遠いエッジほど fatigue の増分を
  // 増やし回復を減らす。既定 (distanceUpkeep=0) では hops が undefined になり
  // 従来と同一の式を通る = bit 一致で不変。
  const hops = params.distanceUpkeep > 0 ? state.sourceHops : undefined;

  // 自身の activity を場に書き込む (伝播の源泉)
  for (const e of state.edges) {
    if (e.activity < 0.1) continue;
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    const mx = (a.pos.x + b.pos.x) / 2, my = (a.pos.y + b.pos.y) / 2;
    if (dormant && dormant.has(dormancyCellKeyAt(mx, my, cw))) continue;
    actField.deposit({ x: mx, y: my }, e.activity * params.activityDeposit, 3);
  }
  // 拡散 (spread/decay) は 2 tick に 1 回だけ回し、係数を2倍にして
  // 「2tickぶん」を1回でまとめる近似にする。deposit (書き込み) は
  // 引き続き毎tick行うので、活動の伝播が1tick遅れるだけで見た目は保たれる。
  if (state.tick % 2 === 0) {
    actField.diffuse(params.activityFieldDecay * 2, params.activityFieldDiffusion * 2);
  }

  // ノード密度を粗いグリッドへ一度だけ焼く (O(N))。
  // 各エッジの crowdingAt 判定はこのグリッドの近傍セルだけを見るので、
  // 全ノード線形走査 (O(N)) をエッジ毎に繰り返す必要がなくなる。
  const densityGrid = buildDensityGrid(state, CROWDING_RADIUS);

  // 各エッジが場を参照して自身を更新
  for (const e of state.edges) {
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    const mid: Vec2 = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
    // M29: 休眠エッジは activity/fatigue/stress を凍結する (環境サンプリング
    // より前に抜けるのが重要 — sampleGrowthContext は evict 済みチャンクを
    // 再実体化させてしまう)。
    if (dormant && dormant.has(dormancyCellKeyAt(mid.x, mid.y, cw))) continue;
    const ctx = env.sampleGrowthContext(mid);
    const fluxN = Math.min(1, e.flux / params.fluxNormalize);
    const youth = Math.max(0, 1 - (state.tick - e.bornAt) / 100);

    // M10: 毒素は activity の目標値そのものを直接削り (「濃度に比例して
    // activity を減衰させる」)、温度は目標への追従度 (回復の速さ) を
    // 落とす — 「最適から離れるほど活動の回復が落ちる」の実装。
    const suitability = tempSuitability(ctx.temperature, params);
    const targetActivity = clamp01(
      params.wFlux * fluxN +
      params.wNutrient * ctx.nutrients +
      params.wActivityField * Math.min(1, actField.sample(mid)) +
      0.8 * youth -
      params.wFatigue * Math.min(1, e.fatigue) -
      params.wCrowding * crowdingAt(densityGrid, mid, CROWDING_RADIUS) -
      ctx.toxin * params.toxinPenalty,
    );
    const newActivity = targetActivity * suitability;
    e.activity = e.activity * 0.85 + newActivity * 0.15;

    // 高温側 (最適+許容域を超えた分) でのみ疲労が増しやすくなる。
    const heatExcess = Math.max(0, ctx.temperature - (params.tempOptimal + params.tempTolerance));
    const fatigueMult = 1 + heatExcess * 2;
    if (hops) {
      // M30: エッジの距離 = 両端点の hop の小さい方 (source 寄りの端で測る)。
      // キャッシュ更新後に生まれた新ノードはエントリを持たないので、親側の
      // 端点の値で代用する (両方無ければ 0 = 猶予。次回更新で正しい値になる)。
      const ha = hops.get(e.from), hb = hops.get(e.to);
      const h = ha === undefined ? (hb ?? 0) : hb === undefined ? ha : ha < hb ? ha : hb;
      // 効果は連続的: 母体近傍 (h ≈ 0) では f ≈ 1 で実質ゼロ、遠征先では
      // 消耗が f 倍・回復が 1/f 倍になり、疲労の収支が距離とともに悪化する。
      const f = 1 + params.distanceUpkeep * h;
      e.fatigue += e.activity * params.fatigueGrow * fatigueMult * f - (fluxN * params.fatigueRecover) / f;
    } else {
      e.fatigue += e.activity * params.fatigueGrow * fatigueMult - fluxN * params.fatigueRecover;
    }
    if (e.fatigue < 0) e.fatigue = 0;
    if (e.fatigue > 3) e.fatigue = 3;

    e.stress *= 0.99; // 自然減衰のみ (増加は growth が担当)
    if (e.stress > 2) e.stress = 2;
  }
}

// ── Biomass: 各エッジが自分の体を場に滲ませる ──
//
// 「枝が伸びる」から「膜が広がる」に見せるための核となる処理。
// 中点に一発落とすのではなく、線分全体に沿ってディスクを重ねる。
// 結果として隣接する複数のエッジの biomass は互いに重なり合い、
// 観測時には一本の線ではなく「面」として見える。

export function updateBiomass(
  state: SimState, bioField: BiomassFieldLike, params: SimParams, idx: NodeIndex,
): void {
  // M29: 休眠エッジは膜の滲ませ (depositSegment) をスキップする。休眠領域の
  // biomass は evict されるか、拡散・減衰だけでゆっくり落ち着いていく。
  const dormant = dormantSetOf(state, params);
  const cw = params.dormancyCellWorld;
  for (const e of state.edges) {
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    if (dormant && dormant.has(dormancyCellKeyAt((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, cw))) continue;
    // activity と太さの両方が乗ることで、活きた幹は厚く、瀕死の細枝は薄く。
    const amount = params.biomassDeposit * (0.25 + e.activity) * (0.5 + Math.min(2, e.radius));
    const r = params.biomassRadius + Math.min(1.8, e.radius * 0.6);
    bioField.depositSegment(a.pos, b.pos, amount, r);
  }
  // activity と同じ理由で 2 tick に 1 回 (係数2倍)。
  if (state.tick % 2 === 0) {
    bioField.diffuse(params.biomassDecay * 2, params.biomassDiffusion * 2);
  }
}

// ── Radius: activity * flux で太る、fatigue で細る ─

export function updateRadius(state: SimState, params: SimParams, bus: EventBus, idx: NodeIndex): void {
  // M29: 休眠エッジは radius も凍結する (中点セルの判定に位置が要るため、
  // M29 で idx を引数に足した — 休眠無効時は一切参照しない)。
  const dormant = dormantSetOf(state, params);
  const cw = params.dormancyCellWorld;
  for (const e of state.edges) {
    if (dormant) {
      const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
      if (a && b && dormant.has(dormancyCellKeyAt((a.pos.x + b.pos.x) / 2, (a.pos.y + b.pos.y) / 2, cw))) continue;
    }
    const youth = Math.max(0, 1 - (state.tick - e.bornAt) / 80);
    const grow = e.activity * (Math.min(1, e.flux / 5) + youth * 0.3) * params.alpha;
    const shrink = (1 + e.fatigue) * params.beta * e.radius;
    const prev = e.radius;
    e.radius = Math.max(0, Math.min(4, e.radius + grow - shrink));
    if (e.radius - prev > 0.15) {
      bus.emit({ type: 'EdgeThickened', tick: state.tick, edgeId: e.id, radius: e.radius });
    }
  }
}

// 個別アクセスしたい場合用に re-export を残しておく
export type { SimEdge };
