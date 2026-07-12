// 流量: 各 sink から最短経路 (hop数) で最も近い source を辿り、
// その経路上のエッジに供給する。
// 「養分が source→sink へ流れる」というメンタルモデルに対応する量。
//
// 以前は sink 毎に独立した BFS を行っていた (O(sink数×(V+E)))。
// sink はグラフが育つほど増え続けるため、後半ほど重くなるのが問題だった。
// 全 source を同時に起点にした 1 回のマルチソース BFS に置き換えることで、
// 「各ノードから見て最も近い source (hop距離)」を O(V+E) で一括して求める。
// 各 sink はその結果 (親エッジ) を辿るだけで良く、sink 毎の再探索が不要になる。

import type { SimState, SimEdge, NodeId, Vec2 } from '../types.js';
import type { NodeIndex } from './index-utils.js';
import type { SimParams } from './params.js';

// M30-B: distanceMode='origin' の距離キャッシュ。原点 (seedSource 時点の初期
// source 位置、state.origins) から各ノードへのユークリッド距離 (複数原点なら
// 最寄り) を全ノードぶん記録する。BFS と違い接続関係を見ないため、forager
// reclaim で母体から切り離された孤立前線にも距離コストが等しく効く
// (M30-A の既知の限界への対処)。RNG 不使用・走査は nodes 配列順 = seed 決定的。
function computeOriginDistances(state: SimState): Map<NodeId, number> {
  // seedSource を通らない手組み state のフォールバック: 現存 source 位置を原点扱い。
  const origins: Vec2[] = state.origins ?? state.nodes.filter((n) => n.type === 'source').map((n) => n.pos);
  const map = new Map<NodeId, number>();
  for (const n of state.nodes) {
    let best = Infinity;
    for (const o of origins) {
      const dx = n.pos.x - o.x, dy = n.pos.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    map.set(n.id, origins.length > 0 ? best : 0);
  }
  return map;
}

export function updateFlux(state: SimState, params: SimParams, idx: NodeIndex): void {
  for (const e of state.edges) e.flux *= params.fluxDecay;

  // M30: 距離のコスト勾配のキャッシュ更新判定。distanceUpdateInterval tick
  // ごと (初回 = キャッシュ未生成時は間隔を待たず即時) に組み直す。
  // 既定 (distanceUpkeep=0) では一切作らない = 挙動は完全に不変。
  const wantDistance = params.distanceUpkeep > 0 &&
    (state.sourceHops === undefined || state.tick % Math.max(1, params.distanceUpdateInterval) === 0);

  // 'origin' モード: BFS に依らず、原点からのユークリッド距離を全ノードへ記録。
  if (wantDistance && params.distanceMode === 'origin') {
    state.sourceHops = computeOriginDistances(state);
  }

  // 'hops' モード (M30-A): この BFS は「各ノードの source からの hop 距離」も
  // 同時に知っている (キューの発見順 = 距離順)。別途 BFS を回す二重計算は
  // せず、ここへ便乗して記録する。休眠エッジ (M29) も flux BFS には参加し
  // 続けるので、休眠領域を貫く遠征路の距離も古びない。RNG 不使用・走査順は
  // nodes/adjacency の配列順のみに依存 = seed 決定的。source から到達でき
  // ない孤立成分にはエントリが載らない (M30-A の既知の限界 → 'origin' で解消)。
  const hops = wantDistance && params.distanceMode !== 'origin' ? new Map<NodeId, number>() : undefined;

  // parentEdge[node] = そのノードから見て source 側へ1歩進むための辺。
  // source 自身にはエントリを作らない (BFS の根)。
  const parentEdge = new Map<NodeId, SimEdge>();
  const visited = new Set<NodeId>();
  const queue: NodeId[] = [];
  for (const n of state.nodes) {
    if (n.type === 'source') { visited.add(n.id); queue.push(n.id); hops?.set(n.id, 0); }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    for (const e of (idx.adjacency.get(cur) ?? [])) {
      const next = e.from === cur ? e.to : e.from;
      if (!visited.has(next)) {
        visited.add(next);
        parentEdge.set(next, e);
        queue.push(next);
        if (hops) hops.set(next, hops.get(cur)! + 1);
      }
    }
  }
  if (hops) state.sourceHops = hops;

  for (const sink of state.nodes) {
    if (sink.type !== 'sink' || !visited.has(sink.id)) continue;
    let cur: NodeId = sink.id;
    while (true) {
      const e = parentEdge.get(cur);
      if (!e) break; // cur が source 自身に達した
      e.flux += params.fluxSupply;
      cur = e.from === cur ? e.to : e.from;
    }
  }
}
