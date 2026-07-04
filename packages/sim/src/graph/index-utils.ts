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

// ── 周辺ノード密度 (crowding) ──────────────────────────
//
// 「あるエッジの周りにノードが何個あるか」を毎tick・エッジ毎に問う判定。
// 素朴にやると全ノードを線形走査するので O(エッジ数×ノード数) になる
// (M8 P1 で判明したホットスポット)。cellSize == radius の一様グリッドに
// ノードをバケツ分けしておけば、半径 radius 以内のノードは必ず
// 自セル+周囲8セル (3x3) に収まる。距離判定そのものは元の実装と同じ
// (円の中に厳密に入っているか) を保ちつつ、候補を近傍だけに絞れる。

export interface DensityGrid {
  cellSize: number;
  buckets: Map<number, Vec2[]>;
}

// バケツ座標を 1 個の整数キーへパックする。ワールド座標は非負・
// 数百程度の範囲を想定しているため、余裕を持たせたオフセット/ストライドで足りる。
const GRID_STRIDE = 1 << 16;
const GRID_OFFSET = 1 << 15;
const densityKey = (cx: number, cy: number) => (cx + GRID_OFFSET) * GRID_STRIDE + (cy + GRID_OFFSET);

// 1 tick に一度だけ、全ノード位置をグリッドへ焼く。
export function buildDensityGrid(state: SimState, cellSize: number): DensityGrid {
  const buckets = new Map<number, Vec2[]>();
  for (const n of state.nodes) {
    const key = densityKey(Math.floor(n.pos.x / cellSize), Math.floor(n.pos.y / cellSize));
    const bucket = buckets.get(key);
    if (bucket) bucket.push(n.pos); else buckets.set(key, [n.pos]);
  }
  return { cellSize, buckets };
}

// 周辺ノード密度。重なりを避けるため成長判定にネガティブ重みで使う。
// grid.cellSize は呼び出し側が radius と同じ値で構築しておくこと
// (3x3 近傍探索だけで半径内を漏れなくカバーできる条件)。
export function crowdingAt(grid: DensityGrid, pos: Vec2, radius = 4): number {
  const { cellSize, buckets } = grid;
  const cx = Math.floor(pos.x / cellSize), cy = Math.floor(pos.y / cellSize);
  const r2 = radius * radius;
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const bucket = buckets.get(densityKey(cx + dx, cy + dy));
      if (!bucket) continue;
      for (const p of bucket) {
        if ((p.x - pos.x) ** 2 + (p.y - pos.y) ** 2 < r2) count++;
      }
    }
  }
  return Math.min(1, count / 8);
}
