// 流量: 各 sink から最短経路 (hop数) で最も近い source を辿り、
// その経路上のエッジに供給する。
// 「養分が source→sink へ流れる」というメンタルモデルに対応する量。
//
// 以前は sink 毎に独立した BFS を行っていた (O(sink数×(V+E)))。
// sink はグラフが育つほど増え続けるため、後半ほど重くなるのが問題だった。
// 全 source を同時に起点にした 1 回のマルチソース BFS に置き換えることで、
// 「各ノードから見て最も近い source (hop距離)」を O(V+E) で一括して求める。
// 各 sink はその結果 (親エッジ) を辿るだけで良く、sink 毎の再探索が不要になる。

import type { SimState, SimEdge, NodeId } from '../types.js';
import type { NodeIndex } from './index-utils.js';
import type { SimParams } from './params.js';

export function updateFlux(state: SimState, params: SimParams, idx: NodeIndex): void {
  for (const e of state.edges) e.flux *= params.fluxDecay;

  // M30: 距離のコスト勾配が有効なら、この BFS は「各ノードの source からの
  // hop 距離」も同時に知っている (キューの発見順 = 距離順)。別途 BFS を回す
  // 二重計算はせず、distanceUpdateInterval tick ごとにここへ便乗して記録する
  // (初回 = キャッシュ未生成時は間隔を待たず即記録)。休眠エッジ (M29) も
  // flux BFS には参加し続けるので、休眠領域を貫く遠征路の距離も古びない。
  // RNG 不使用・走査順は nodes/adjacency の配列順のみに依存 = seed 決定的。
  // 既定 (distanceUpkeep=0) では hops は常に undefined で、追加の演算は
  // 走査ごとの optional chaining 短絡のみ — 挙動は完全に不変。
  const hops = params.distanceUpkeep > 0 &&
    (state.sourceHops === undefined || state.tick % Math.max(1, params.distanceUpdateInterval) === 0)
    ? new Map<NodeId, number>() : undefined;

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
