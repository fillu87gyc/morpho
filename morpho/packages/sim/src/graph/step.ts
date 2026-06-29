import type { SimState, SimNode, SimEdge, Vec2, NodeId } from '../types.js';
import type { Environment, GrowthContext } from '../env/field.js';
import type { ActivityField } from '../env/activity-field.js';
import type { BiomassField } from '../env/biomass-field.js';
import type { SeededRNG } from '../rng.js';
import { EventBus } from '../events/bus.js';

// ── パラメータ ────────────────────────────────────────

export interface SimParams {
  growthStep: number;
  candidateCount: number;
  candidateSpreadBase: number;
  mergeRadius: number;
  worldMargin: number;
  wFlux: number;
  wNutrient: number;
  wFatigue: number;
  wCrowding: number;
  fluxNormalize: number;
  fatigueGrow: number;
  fatigueRecover: number;
  stressGrow: number;
  stressRelief: number;
  stressBranchThreshold: number;
  growthActivityThreshold: number;
  growthProbability: number;
  branchActivityThreshold: number;
  branchProbabilityBase: number;
  alpha: number;
  beta: number;
  initialRadius: number;
  pruneRadius: number;
  fluxDecay: number;
  fluxSupply: number;
  maxDegree: number;
  sourceInitialBranches: number;
  foodReachThreshold: number;
  nutrientBias: number;
  moistureBias: number;
  brightnessPenalty: number;
  obstaclePenalty: number;
  gradientBias: number;
  noiseAmount: number;
  activityDeposit: number;
  wActivityField: number;
  activityFieldDecay: number;
  activityFieldDiffusion: number;
  biomassDeposit: number;
  biomassRadius: number;
  biomassDecay: number;
  biomassDiffusion: number;
  wBiomassGradient: number;
  lateralBudBiomassThreshold: number;
  lateralBudProbability: number;
}

export const DEFAULT_PARAMS: SimParams = {
  growthStep: 3.0,
  candidateCount: 5,
  candidateSpreadBase: 0.8,
  mergeRadius: 1.8,
  worldMargin: 1.0,
  wFlux: 0.6,
  wNutrient: 0.3,
  wFatigue: 0.2,
  wCrowding: 0.3,
  fluxNormalize: 5.0,
  fatigueGrow: 0.015,
  fatigueRecover: 0.020,
  stressGrow: 0.04,
  stressRelief: 0.5,
  stressBranchThreshold: 0.15,
  growthActivityThreshold: 0.35,
  growthProbability: 0.6,
  branchActivityThreshold: 0.5,
  branchProbabilityBase: 0.04,
  alpha: 0.30,
  beta: 0.06,
  initialRadius: 0.7,
  pruneRadius: 0.35,
  fluxDecay: 0.85,
  fluxSupply: 5.0,
  maxDegree: 5,
  sourceInitialBranches: 6,
  foodReachThreshold: 0.55,
  nutrientBias: 2.5,
  moistureBias: 0.5,
  brightnessPenalty: 0.4,
  obstaclePenalty: 2.0,
  gradientBias: 0.6,
  noiseAmount: 0.1,
  activityDeposit: 0.15,
  wActivityField: 0.35,
  activityFieldDecay: 0.04,
  activityFieldDiffusion: 0.18,
  biomassDeposit: 0.18,
  biomassRadius: 2.6,
  biomassDecay: 0.012,
  biomassDiffusion: 0.05,
  wBiomassGradient: 0.55,
  lateralBudBiomassThreshold: 0.9,
  lateralBudProbability: 0.18,
};

// ── インデックス ──────────────────────────────────────

interface NodeIndex {
  byId: Map<NodeId, SimNode>;
  adjacency: Map<NodeId, SimEdge[]>;
  neighbors: Map<NodeId, Set<NodeId>>;
}

function buildIndex(state: SimState): NodeIndex {
  const byId = new Map<NodeId, SimNode>();
  const adjacency = new Map<NodeId, SimEdge[]>();
  const neighbors = new Map<NodeId, Set<NodeId>>();
  for (const n of state.nodes) {
    byId.set(n.id, n);
    adjacency.set(n.id, []);
    neighbors.set(n.id, new Set());
  }
  for (const e of state.edges) {
    adjacency.get(e.from)?.push(e);
    adjacency.get(e.to)?.push(e);
    neighbors.get(e.from)?.add(e.to);
    neighbors.get(e.to)?.add(e.from);
  }
  return { byId, adjacency, neighbors };
}

// ── ヘルパ ────────────────────────────────────────────

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;

function crowdingAt(state: SimState, pos: Vec2, radius = 4): number {
  let count = 0;
  const r2 = radius * radius;
  for (const n of state.nodes) {
    if ((n.pos.x - pos.x) ** 2 + (n.pos.y - pos.y) ** 2 < r2) count++;
  }
  return Math.min(1, count / 8);
}

// ── (1) 流量: sink→source 最短経路に供給 ────────────

function updateFlux(state: SimState, params: SimParams, idx: NodeIndex): void {
  for (const e of state.edges) e.flux *= params.fluxDecay;

  for (const sink of state.nodes) {
    if (sink.type !== 'sink') continue;
    const parentEdge = new Map<NodeId, SimEdge>();
    const visited = new Set<NodeId>([sink.id]);
    const queue: NodeId[] = [sink.id];
    let sourceId: NodeId | null = null;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (idx.byId.get(cur)?.type === 'source') { sourceId = cur; break; }
      for (const e of (idx.adjacency.get(cur) ?? [])) {
        const next = e.from === cur ? e.to : e.from;
        if (!visited.has(next)) {
          visited.add(next);
          parentEdge.set(next, e);
          queue.push(next);
        }
      }
    }
    if (sourceId === null) continue;
    let cur: NodeId = sourceId;
    while (cur !== sink.id) {
      const e = parentEdge.get(cur);
      if (!e) break;
      e.flux += params.fluxSupply;
      cur = e.from === cur ? e.to : e.from;
    }
  }
}

// ── (2) Activity: 場への書き込み→拡散→各エッジの更新 ─

function updateActivity(
  state: SimState, env: Environment, actField: ActivityField,
  params: SimParams, idx: NodeIndex,
): void {
  // 自身の activity を場に書き込む（伝播の源泉）
  for (const e of state.edges) {
    if (e.activity < 0.1) continue;
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    actField.deposit(
      { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 },
      e.activity * params.activityDeposit, 3
    );
  }
  actField.diffuse(params.activityFieldDecay, params.activityFieldDiffusion);

  // 各エッジが場を参照して自身を更新
  for (const e of state.edges) {
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    const mid: Vec2 = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
    const ctx = env.sampleGrowthContext(mid);
    const fluxN = Math.min(1, e.flux / params.fluxNormalize);
    const youth = Math.max(0, 1 - (state.tick - e.bornAt) / 100);

    const newActivity = clamp01(
      params.wFlux * fluxN +
      params.wNutrient * ctx.nutrients +
      params.wActivityField * Math.min(1, actField.sample(mid)) +
      0.8 * youth -
      params.wFatigue * Math.min(1, e.fatigue) -
      params.wCrowding * crowdingAt(state, mid, 4)
    );
    e.activity = e.activity * 0.85 + newActivity * 0.15;

    e.fatigue += e.activity * params.fatigueGrow - fluxN * params.fatigueRecover;
    if (e.fatigue < 0) e.fatigue = 0;
    if (e.fatigue > 3) e.fatigue = 3;

    e.stress *= 0.99; // 自然減衰のみ（増加は growFromTip が担当）
    if (e.stress > 2) e.stress = 2;
  }
}

// ── (2b) Biomass: 各エッジが自分の体を場に滲ませる ──
//
// 「枝が伸びる」から「膜が広がる」に見せるための核となる処理。
// エッジの中点に一発落とすのではなく、線分全体に沿ってディスクを重ねる。
// 結果として隣接する複数のエッジの biomass は互いに重なり合い、
// 観測時には一本の線ではなく「面」として見える。

function updateBiomass(
  state: SimState, bioField: BiomassField, params: SimParams, idx: NodeIndex,
): void {
  for (const e of state.edges) {
    const a = idx.byId.get(e.from), b = idx.byId.get(e.to);
    if (!a || !b) continue;
    // activity と太さの両方が乗ることで、活きた幹は厚く、瀕死の細枝は薄く。
    const amount = params.biomassDeposit * (0.25 + e.activity) * (0.5 + Math.min(2, e.radius));
    const r = params.biomassRadius + Math.min(1.8, e.radius * 0.6);
    bioField.depositSegment(a.pos, b.pos, amount, r);
  }
  bioField.diffuse(params.biomassDecay, params.biomassDiffusion);
}

// ── (3) 太さ: activity * flux で太る、fatigue で細る ─

function updateRadius(state: SimState, params: SimParams, bus: EventBus): void {
  for (const e of state.edges) {
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

// ── (4) 成長: 端点から新先端を伸ばす ────────────────

function findTipNodes(state: SimState, idx: NodeIndex): SimNode[] {
  const tips: SimNode[] = [];
  for (const n of state.nodes) {
    if (n.type === 'sink') continue;
    const adj = idx.adjacency.get(n.id) ?? [];
    if (n.type === 'source' ? adj.length < 8 : adj.length <= 1) tips.push(n);
  }
  return tips;
}

function chooseBaseDirection(node: SimNode, ctx: GrowthContext, rng: SeededRNG, idx: NodeIndex): Vec2 {
  let sumX = 0, sumY = 0, count = 0;
  for (const e of (idx.adjacency.get(node.id) ?? [])) {
    const other = idx.byId.get(e.from === node.id ? e.to : e.from);
    if (other) { sumX += other.pos.x - node.pos.x; sumY += other.pos.y - node.pos.y; count++; }
  }
  let bx: number, by: number;
  if (count === 0) {
    const m = Math.hypot(ctx.preferredDirection.x, ctx.preferredDirection.y);
    if (m > 1e-6) { bx = ctx.preferredDirection.x; by = ctx.preferredDirection.y; }
    else { const a = rng.next() * Math.PI * 2; bx = Math.cos(a); by = Math.sin(a); }
  } else {
    bx = -sumX / count + ctx.preferredDirection.x * 0.5;
    by = -sumY / count + ctx.preferredDirection.y * 0.5;
  }
  const m = Math.hypot(bx, by);
  return m < 1e-6 ? { x: 1, y: 0 } : { x: bx / m, y: by / m };
}

function findMergeTarget(nodes: SimNode[], pos: Vec2, radius: number, excludeId: NodeId): SimNode | null {
  let best: SimNode | null = null, bestD2 = radius * radius;
  for (const n of nodes) {
    if (n.id === excludeId) continue;
    const d2 = (pos.x - n.pos.x) ** 2 + (pos.y - n.pos.y) ** 2;
    if (d2 < bestD2) { bestD2 = d2; best = n; }
  }
  return best;
}

function growFromTip(
  state: SimState, env: Environment, bioField: BiomassField, params: SimParams,
  rng: SeededRNG, bus: EventBus, idx: NodeIndex,
  tip: SimNode, parentEdge: SimEdge | null,
  parentActivity: number, parentStress: number,
): boolean {
  const ctx = env.sampleGrowthContext(tip.pos);
  if (ctx.obstacle > 0.5) {
    if (parentEdge) parentEdge.stress = Math.min(2, parentEdge.stress + 0.3);
    return false;
  }

  const spread = params.candidateSpreadBase * (1 + parentStress * 0.8);
  const baseDir = chooseBaseDirection(tip, ctx, rng, idx);
  // 自分自身の biomass は前進方向の指針にはならない（既に居る場所）。
  // 候補先の biomass の高さは「膜の前線にいる」ことを意味するので、
  // そこへ揃えて伸ばすと「集団で前進する」ように見える。
  const tipBio = bioField.sample(tip.pos);
  let bestScore = -Infinity, bestCtx: GrowthContext | null = null, bestEnd: Vec2 | null = null;
  let rejected = 0;

  for (let i = 0; i < params.candidateCount; i++) {
    const a = (rng.next() - 0.5) * spread * 2;
    const dir: Vec2 = {
      x: baseDir.x * Math.cos(a) - baseDir.y * Math.sin(a),
      y: baseDir.x * Math.sin(a) + baseDir.y * Math.cos(a),
    };
    const end: Vec2 = { x: tip.pos.x + dir.x * params.growthStep, y: tip.pos.y + dir.y * params.growthStep };
    if (end.x < params.worldMargin || end.y < params.worldMargin ||
        end.x >= state.worldSize - params.worldMargin || end.y >= state.worldSize - params.worldMargin) {
      rejected++; continue;
    }
    const ec = env.sampleGrowthContext(end);
    if (ec.obstacle > 0.7) { rejected++; continue; }
    // 候補先と現在地点の biomass 差。正なら「膜が既に滲んでいる方向」、
    // すなわち隣の枝と肩を並べて前進する方向。これが「面」感の鍵。
    // 負側はクランプ: 前線が新しい領域に踏み出すのを抑え込まないため。
    const endBio = bioField.sample(end);
    const biomassPull = Math.max(0, endBio - tipBio) * params.wBiomassGradient;
    const score =
      ec.nutrients * params.nutrientBias + ec.moisture * params.moistureBias -
      ec.brightness * params.brightnessPenalty - ec.obstacle * params.obstaclePenalty +
      (dir.x * ec.preferredDirection.x + dir.y * ec.preferredDirection.y) * params.gradientBias +
      biomassPull +
      rng.next() * params.noiseAmount;
    if (score > bestScore) { bestScore = score; bestCtx = ec; bestEnd = end; }
  }

  if (!bestEnd || !bestCtx) {
    if (parentEdge) parentEdge.stress = Math.min(2, parentEdge.stress + 0.4);
    return false;
  }
  if (rejected > params.candidateCount / 2 && parentEdge) {
    parentEdge.stress = Math.min(2, parentEdge.stress + 0.1);
  }

  const isSink = bestCtx.nutrients > params.foodReachThreshold;

  // 閉路形成を試みる
  if (!isSink) {
    const mt = findMergeTarget(state.nodes, bestEnd, params.mergeRadius, tip.id);
    if (mt && mt.type !== 'sink') {
      const ns = idx.neighbors.get(tip.id);
      if (!ns || !ns.has(mt.id)) {
        const e: SimEdge = {
          id: state.nextEdgeId++, from: tip.id, to: mt.id,
          radius: params.initialRadius, flux: 0, length: dist(tip.pos, mt.pos),
          bornAt: state.tick, activity: parentActivity * 0.7, fatigue: 0, stress: 0,
        };
        state.edges.push(e);
        ns?.add(mt.id); idx.neighbors.get(mt.id)?.add(tip.id);
        idx.adjacency.get(tip.id)?.push(e); idx.adjacency.get(mt.id)?.push(e);
        bus.emit({ type: 'LoopCreated', tick: state.tick, nodeIds: [tip.id, mt.id] });
        if (parentEdge) parentEdge.stress *= 0.5;
        return true;
      }
    }
  }

  // 新規ノード + エッジ
  const newNode: SimNode = {
    id: state.nextNodeId++, pos: bestEnd,
    type: isSink ? 'sink' : 'relay', bornAt: state.tick,
  };
  state.nodes.push(newNode);
  const newEdge: SimEdge = {
    id: state.nextEdgeId++, from: tip.id, to: newNode.id,
    radius: isSink ? params.initialRadius * 1.5 : params.initialRadius,
    flux: isSink ? params.fluxSupply * 2 : 0,
    length: params.growthStep, bornAt: state.tick,
    activity: 0.8, fatigue: 0, stress: 0,
  };
  state.edges.push(newEdge);
  idx.byId.set(newNode.id, newNode);
  idx.adjacency.set(newNode.id, [newEdge]);
  idx.adjacency.get(tip.id)?.push(newEdge);
  idx.neighbors.set(newNode.id, new Set([tip.id]));
  idx.neighbors.get(tip.id)?.add(newNode.id);

  bus.emit({ type: isSink ? 'ReachedFood' : 'NewBranch', tick: state.tick, nodeId: newNode.id, pos: newNode.pos });
  if (parentEdge) parentEdge.stress *= 0.7;
  return true;
}

function growthStep(
  state: SimState, env: Environment, bioField: BiomassField, params: SimParams,
  rng: SeededRNG, bus: EventBus, idx: NodeIndex,
): void {
  // 端点からの伸長
  for (const tip of findTipNodes(state, idx)) {
    const adj = idx.adjacency.get(tip.id) ?? [];
    if (tip.type === 'source') {
      const avgAct = adj.length > 0 ? adj.reduce((s, e) => s + e.activity, 0) / adj.length : 1.0;
      const avgStr = adj.length > 0 ? adj.reduce((s, e) => s + e.stress, 0) / adj.length : 0;
      const eff = Math.max(avgAct, 0.6);
      if (eff > params.growthActivityThreshold && rng.next() < params.growthProbability * eff) {
        const pe = adj.length > 0 ? adj.reduce((a, b) => a.activity > b.activity ? a : b) : null;
        growFromTip(state, env, bioField, params, rng, bus, idx, tip, pe, eff, avgStr);
      }
    } else {
      const pe = adj[0];
      if (pe && pe.activity > params.growthActivityThreshold && rng.next() < params.growthProbability * pe.activity) {
        growFromTip(state, env, bioField, params, rng, bus, idx, tip, pe, pe.activity, pe.stress);
        // 横方向の出芽: biomass が厚い場所ほど膜は「横にも」広がりたい。
        // これが見た目を「線」から「面の前線」へ寄せる第二の機構。
        const bio = bioField.sample(tip.pos);
        if (bio > params.lateralBudBiomassThreshold &&
            (idx.adjacency.get(tip.id)?.length ?? 0) < params.maxDegree &&
            rng.next() < params.lateralBudProbability * pe.activity) {
          lateralBud(state, env, bioField, params, rng, bus, idx, tip, pe);
        }
      }
    }
  }

  // stress による側枝
  for (const e of state.edges) {
    if (e.activity < params.branchActivityThreshold) continue;
    if (e.stress < params.stressBranchThreshold) continue;
    if (rng.next() < params.branchProbabilityBase * (1 + e.stress) * e.activity) {
      const nodeId = rng.next() < 0.5 ? e.to : e.from;
      const node = idx.byId.get(nodeId);
      if (!node || node.type === 'sink') continue;
      const adj = idx.adjacency.get(nodeId);
      if (adj && adj.length >= params.maxDegree) continue;
      if (growFromTip(state, env, bioField, params, rng, bus, idx, node, e, e.activity, e.stress)) {
        e.stress *= (1 - params.stressRelief);
      }
    }
  }
}

// 横方向出芽: 親エッジの方向に対して左右どちらかへ垂直に短いエッジを生やす。
// 「枝分かれ」と違うのは、目的が「面を太くする」だけで、前進ではない点。
function lateralBud(
  state: SimState, env: Environment, bioField: BiomassField, params: SimParams,
  rng: SeededRNG, bus: EventBus, idx: NodeIndex,
  tip: SimNode, parentEdge: SimEdge,
): boolean {
  const other = idx.byId.get(parentEdge.from === tip.id ? parentEdge.to : parentEdge.from);
  if (!other) return false;
  const dx = tip.pos.x - other.pos.x, dy = tip.pos.y - other.pos.y;
  const m = Math.hypot(dx, dy);
  if (m < 1e-6) return false;
  const side = rng.next() < 0.5 ? 1 : -1;
  // 親方向に対し垂直
  const nx = -dy / m * side, ny = dx / m * side;
  const stepLen = params.growthStep * 0.6;
  const end: Vec2 = { x: tip.pos.x + nx * stepLen, y: tip.pos.y + ny * stepLen };
  if (end.x < params.worldMargin || end.y < params.worldMargin ||
      end.x >= state.worldSize - params.worldMargin || end.y >= state.worldSize - params.worldMargin) return false;
  const ec = env.sampleGrowthContext(end);
  if (ec.obstacle > 0.6) return false;

  const newNode: SimNode = {
    id: state.nextNodeId++, pos: end, type: 'relay', bornAt: state.tick,
  };
  state.nodes.push(newNode);
  const newEdge: SimEdge = {
    id: state.nextEdgeId++, from: tip.id, to: newNode.id,
    radius: params.initialRadius * 0.85, flux: 0,
    length: stepLen, bornAt: state.tick,
    // 横芽は伸びる気が薄い。初期 activity を低めにして
    // すぐに前進競争には入らないようにする。
    activity: parentEdge.activity * 0.5, fatigue: 0, stress: 0,
  };
  state.edges.push(newEdge);
  idx.byId.set(newNode.id, newNode);
  idx.adjacency.set(newNode.id, [newEdge]);
  idx.adjacency.get(tip.id)?.push(newEdge);
  idx.neighbors.set(newNode.id, new Set([tip.id]));
  idx.neighbors.get(tip.id)?.add(newNode.id);
  // 周囲に強めの biomass を即時滲ませる: 描画上「膜が膨らんだ」ように見える。
  bioField.deposit(end, params.biomassDeposit * 2, params.biomassRadius + 0.8);
  bus.emit({ type: 'NewBranch', tick: state.tick, nodeId: newNode.id, pos: newNode.pos });
  return true;
}

// ── (5) 刈り込み ──────────────────────────────────────

function prune(state: SimState, params: SimParams, bus: EventBus): void {
  const surviving: SimEdge[] = [];
  for (const e of state.edges) {
    if (state.tick - e.bornAt < 100) { surviving.push(e); continue; } // 青春期は保護
    if (e.radius < params.pruneRadius && e.flux < 0.1) {
      bus.emit({ type: 'DeadEdge', tick: state.tick, edgeId: e.id });
    } else {
      surviving.push(e);
    }
  }
  state.edges = surviving;

  const connected = new Set<NodeId>();
  for (const e of state.edges) { connected.add(e.from); connected.add(e.to); }
  state.nodes = state.nodes.filter(n => n.type !== 'relay' || connected.has(n.id));
}

// ── 公開 API ─────────────────────────────────────────

export function step(
  state: SimState, env: Environment, actField: ActivityField, bioField: BiomassField,
  params: SimParams, rng: SeededRNG, bus: EventBus,
): void {
  state.tick++;
  const idx = buildIndex(state);
  updateFlux(state, params, idx);
  updateActivity(state, env, actField, params, idx);
  // Biomass は毎 tick: 場が拡散・減衰しながら膜のかたちを保つ。
  updateBiomass(state, bioField, params, idx);
  if (state.tick % 4 === 0)  updateRadius(state, params, bus);
  if (state.tick % 12 === 0) growthStep(state, env, bioField, params, rng, bus, idx);
  if (state.tick % 60 === 0) prune(state, params, bus);
}

export function run(
  state: SimState, env: Environment, actField: ActivityField, bioField: BiomassField,
  params: SimParams, rng: SeededRNG, bus: EventBus, ticks: number,
): void {
  for (let i = 0; i < ticks; i++) step(state, env, actField, bioField, params, rng, bus);
}
