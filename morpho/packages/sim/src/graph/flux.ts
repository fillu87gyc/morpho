// 流量: 各 sink から最短経路で source を辿り、その経路上のエッジに供給する。
// 「養分が source→sink へ流れる」というメンタルモデルに対応する量だが、
// 計算上は sink を起点にした BFS。グラフが小さい間はこれで十分。

import type { SimState, SimEdge, NodeId } from '../types.js';
import type { NodeIndex } from './index-utils.js';
import type { SimParams } from './params.js';

export function updateFlux(state: SimState, params: SimParams, idx: NodeIndex): void {
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
