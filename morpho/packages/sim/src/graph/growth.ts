// 成長: 端点 (tip) から新先端を伸ばす。3 つの機構が共存する:
//   1. tip からの前進 (主)
//   2. 横方向出芽 (lateralBud): 膜を「面」として太らせる
//   3. stress による側枝: 詰まったエッジから分岐を逃がす
//
// それぞれ growFromTip にまとめて吸収する設計ではなく、上位から
// 個別に呼ぶ形にしている。判定基準が独立しているため。

import type { SimState, SimNode, SimEdge, Vec2, NodeId } from '../types.js';
import type { Environment, GrowthContext } from '../env/environment.js';
import type { BiomassField } from '../env/biomass-field.js';
import type { SeededRNG } from '../rng.js';
import type { EventBus } from '../events/bus.js';
import type { SimParams } from './params.js';
import { type NodeIndex, dist } from './index-utils.js';

// ── tip 発見 / 方向選択 / マージターゲット ─────────────

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

// ── tip からの前進 (主機構) ──────────────────────────

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
  // 自分自身の biomass は前進方向の指針にはならない (既に居る場所)。
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

// ── 横方向出芽 ────────────────────────────────────────
// 親エッジの方向に対して左右どちらかへ垂直に短いエッジを生やす。
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

// ── 公開 entry point ─────────────────────────────────

export function growthStep(
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
