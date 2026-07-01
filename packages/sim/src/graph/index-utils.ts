// グラフ操作の毎 tick ヘルパ。SimState は配列ベースなので、
// 1 tick の中で何度も「あるノードの隣接エッジ」「あるノード→あるノード間の接続有無」を
// 引きたい場面で再構築する。

import type { SimState, SimNode, SimEdge, Vec2, NodeId } from '../types.js';

export interface NodeIndex {
  byId: Map<NodeId, SimNode>;
  adjacency: Map<NodeId, SimEdge[]>;
  neighbors: Map<NodeId, Set<NodeId>>;
}

export function buildIndex(state: SimState): NodeIndex {
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

// ── 共通の小道具 ──────────────────────────────────────

export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

export const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;

// 周辺ノード密度。重なりを避けるため成長判定にネガティブ重みで使う。
export function crowdingAt(state: SimState, pos: Vec2, radius = 4): number {
  let count = 0;
  const r2 = radius * radius;
  for (const n of state.nodes) {
    if ((n.pos.x - pos.x) ** 2 + (n.pos.y - pos.y) ** 2 < r2) count++;
  }
  return Math.min(1, count / 8);
}
