// M23: 脈管網を「等幅の折れ線ループ」から「先細りの生きた脈」にするための
// 純粋関数群。グラフをチェーン (分岐点/末端点の間を結ぶ単純path) に分解し、
// 各チェーンを Catmull-Rom で滑らかにしつつ、太さ (radius) も連続的に補間する。

import type { NodeId, EdgeId, SimNode, SimEdge, Vec2 } from '@morpho/sim';

export interface ChainPoint {
  pos: Vec2;
  /** この点での太さ (元エッジの radius をチェーンに沿って補間したもの)。 */
  radius: number;
  /** この点が属する元エッジ (色/flux の参照用)。 */
  sourceEdgeId: EdgeId;
  /** チェーンの先頭からの弧長順位 (0..1)。末端の扇形演出に使う。 */
  t: number;
}

export interface Chain {
  nodeIds: NodeId[];
  edgeIds: EdgeId[];
  /** 末端 (degree 1 でチェーンがそこで終わる) かどうか。source/sink 自体は
   * 別途丸で描くので、ここでの「末端」は主に成長前線のチップを指す。 */
  startIsLeaf: boolean;
  endIsLeaf: boolean;
}

/** ノードごとの次数 (接続エッジ数) を数える。 */
export function computeDegree(nodes: SimNode[], edges: SimEdge[]): Map<NodeId, number> {
  const degree = new Map<NodeId, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  return degree;
}

/**
 * グラフを「分岐点 (degree != 2) の間を結ぶ単純path」の集合に分解する。
 * degree-2 の relay ノードは通過点として1本のチェーンにまとめられる。
 * 孤立した閉路 (全ノードが degree 2 のループ) は、そのループ内の
 * 最小 NodeId から開始する1本のチェーンとして扱う。
 */
export function traceChains(nodes: SimNode[], edges: SimEdge[]): Chain[] {
  const degree = computeDegree(nodes, edges);
  const nodeMap = new Map<NodeId, SimNode>(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<NodeId, { edge: SimEdge; other: NodeId }[]>();
  for (const n of nodes) adjacency.set(n.id, []);
  for (const e of edges) {
    adjacency.get(e.from)?.push({ edge: e, other: e.to });
    adjacency.get(e.to)?.push({ edge: e, other: e.from });
  }

  const usedEdges = new Set<EdgeId>();
  const chains: Chain[] = [];

  const walkFrom = (startId: NodeId, firstEdge: SimEdge, firstOther: NodeId): Chain => {
    const nodeIds: NodeId[] = [startId, firstOther];
    const edgeIds: EdgeId[] = [firstEdge.id];
    usedEdges.add(firstEdge.id);
    let prev = startId;
    let current = firstOther;
    while ((degree.get(current) ?? 0) === 2) {
      const neighbors = adjacency.get(current) ?? [];
      const next = neighbors.find((n) => n.other !== prev && !usedEdges.has(n.edge.id));
      if (!next) break;
      usedEdges.add(next.edge.id);
      edgeIds.push(next.edge.id);
      nodeIds.push(next.other);
      prev = current;
      current = next.other;
      if (current === startId) break; // 閉路に戻ってきた
    }
    return {
      nodeIds,
      edgeIds,
      startIsLeaf: (degree.get(startId) ?? 0) === 1,
      endIsLeaf: (degree.get(current) ?? 0) === 1,
    };
  };

  // 1. 分岐点/末端点 (degree != 2) を起点にチェーンを辿る。
  for (const n of nodes) {
    const d = degree.get(n.id) ?? 0;
    if (d === 2) continue;
    for (const { edge, other } of adjacency.get(n.id) ?? []) {
      if (usedEdges.has(edge.id)) continue;
      chains.push(walkFrom(n.id, edge, other));
    }
  }

  // 2. 残った edge は全て degree-2 ノードだけからなる孤立閉路。
  for (const e of edges) {
    if (usedEdges.has(e.id)) continue;
    chains.push(walkFrom(e.from, e, e.to));
  }

  // 存在しないノード参照を防ぐ (呼び出し側の安全のため)。
  return chains.filter((c) => c.nodeIds.every((id) => nodeMap.has(id)));
}

function catmullRomPoint(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * チェーンのノード列を Catmull-Rom で滑らかにし、各点の太さも
 * (隣接エッジ radius の平均を節点の太さとして) 線形補間する。
 * `samplesPerSegment` は元エッジ1本あたりの分割数 (性能予算に応じて調整)。
 */
export function smoothChain(
  chain: Chain,
  nodeMap: Map<NodeId, SimNode>,
  edgeMap: Map<EdgeId, SimEdge>,
  samplesPerSegment: number,
): ChainPoint[] {
  const positions: Vec2[] = chain.nodeIds.map((id) => nodeMap.get(id)!.pos);
  const n = positions.length;
  if (n < 2) return [];

  // 節点ごとの太さ: 端点はその1本のエッジの radius、内部は前後エッジの平均。
  const nodeRadius: number[] = chain.edgeIds.map((id) => edgeMap.get(id)!.radius);
  const radiusAt: number[] = new Array(n);
  radiusAt[0] = nodeRadius[0]!;
  radiusAt[n - 1] = nodeRadius[nodeRadius.length - 1]!;
  for (let i = 1; i < n - 1; i++) {
    radiusAt[i] = (nodeRadius[i - 1]! + nodeRadius[i]!) / 2;
  }

  const totalSegments = n - 1;
  const result: ChainPoint[] = [];

  for (let seg = 0; seg < totalSegments; seg++) {
    const p0 = positions[Math.max(0, seg - 1)]!;
    const p1 = positions[seg]!;
    const p2 = positions[seg + 1]!;
    const p3 = positions[Math.min(n - 1, seg + 2)]!;
    const r1 = radiusAt[seg]!;
    const r2 = radiusAt[seg + 1]!;
    const edgeId = chain.edgeIds[seg]!;
    const samples = Math.max(1, samplesPerSegment);
    const startK = seg === 0 ? 0 : 1; // 各セグメント境界の点を二重に入れない
    for (let k = startK; k <= samples; k++) {
      const t = k / samples;
      const pos = catmullRomPoint(p0, p1, p2, p3, t);
      const radius = r1 + (r2 - r1) * t;
      const globalT = (seg + t) / totalSegments;
      result.push({ pos, radius, sourceEdgeId: edgeId, t: globalT });
    }
  }
  return result;
}
