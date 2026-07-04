// M8-P1: crowdingAt のグリッド化 / updateFlux のマルチソース BFS 化が
// 素朴な実装と同じ結果を返すことを確認する回帰テスト。
// (性能改善そのものは sim/scripts/bench.ts で計測する。ここでは正しさだけを見る)

import { describe, it, expect } from 'vitest';
import type { SimState, SimNode, SimEdge, Vec2 } from '../src/types.js';
import { buildDensityGrid, crowdingAt, buildIndex } from '../src/graph/index-utils.js';
import { updateFlux } from '../src/graph/flux.js';
import { DEFAULT_PARAMS } from '../src/graph/params.js';

function bruteForceCrowding(nodes: SimNode[], pos: Vec2, radius: number): number {
  let count = 0;
  const r2 = radius * radius;
  for (const n of nodes) {
    if ((n.pos.x - pos.x) ** 2 + (n.pos.y - pos.y) ** 2 < r2) count++;
  }
  return Math.min(1, count / 8);
}

describe('crowdingAt (density grid)', () => {
  it('ランダムなノード配置でも素朴な全走査と同じ値を返す', () => {
    let seed = 1234;
    const rand = () => {
      // 決定的な疑似乱数 (テスト内で十分)
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const nodes: SimNode[] = [];
    for (let i = 0; i < 300; i++) {
      nodes.push({
        id: i, pos: { x: rand() * 100, y: rand() * 100 }, type: 'relay', bornAt: 0,
      });
    }
    const state = { nodes } as unknown as SimState;
    const grid = buildDensityGrid(state, 4);
    for (let i = 0; i < 50; i++) {
      const pos = { x: rand() * 100, y: rand() * 100 };
      expect(crowdingAt(grid, pos, 4)).toBeCloseTo(bruteForceCrowding(nodes, pos, 4), 10);
    }
  });

  it('セル境界をまたぐ近傍も正しく拾う', () => {
    // わざとセル境界ぴったり付近にノードを置き、3x3 近傍探索の漏れがないか確認する。
    const nodes: SimNode[] = [
      { id: 0, pos: { x: 8.0, y: 8.0 }, type: 'relay', bornAt: 0 },
      { id: 1, pos: { x: 7.9, y: 8.0 }, type: 'relay', bornAt: 0 },
      { id: 2, pos: { x: 11.9, y: 8.0 }, type: 'relay', bornAt: 0 },
      { id: 3, pos: { x: 8.0, y: 11.9 }, type: 'relay', bornAt: 0 },
    ];
    const state = { nodes } as unknown as SimState;
    const grid = buildDensityGrid(state, 4);
    const pos = { x: 8.0, y: 8.0 };
    expect(crowdingAt(grid, pos, 4)).toBeCloseTo(bruteForceCrowding(nodes, pos, 4), 10);
  });
});

function bruteForceFlux(state: SimState, params = DEFAULT_PARAMS): Map<number, number> {
  const idx = buildIndex(state);
  const flux = new Map<number, number>();
  for (const sink of state.nodes) {
    if (sink.type !== 'sink') continue;
    const parentEdge = new Map<number, SimEdge>();
    const visited = new Set<number>([sink.id]);
    const queue: number[] = [sink.id];
    let sourceId: number | null = null;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (idx.byId.get(cur)?.type === 'source') { sourceId = cur; break; }
      for (const e of (idx.adjacency.get(cur) ?? [])) {
        const next = e.from === cur ? e.to : e.from;
        if (!visited.has(next)) { visited.add(next); parentEdge.set(next, e); queue.push(next); }
      }
    }
    if (sourceId === null) continue;
    let cur = sourceId;
    while (cur !== sink.id) {
      const e = parentEdge.get(cur);
      if (!e) break;
      flux.set(e.id, (flux.get(e.id) ?? 0) + params.fluxSupply);
      cur = e.from === cur ? e.to : e.from;
    }
  }
  return flux;
}

// source(0) -- a -- b -- sink(3)  と分岐 source(0) -- c -- sink(4) の
// 小さなグラフで、マルチソース BFS 版が素朴な sink 毎 BFS 版と
// 同じエッジに同じ量の flux を供給することを確認する。
function makeBranchingGraph(): SimState {
  const nodes: SimNode[] = [
    { id: 0, pos: { x: 0, y: 0 }, type: 'source', bornAt: 0 },
    { id: 1, pos: { x: 1, y: 0 }, type: 'relay', bornAt: 0 },
    { id: 2, pos: { x: 2, y: 0 }, type: 'relay', bornAt: 0 },
    { id: 3, pos: { x: 3, y: 0 }, type: 'sink', bornAt: 0 },
    { id: 4, pos: { x: 1, y: 1 }, type: 'sink', bornAt: 0 },
  ];
  const edges: SimEdge[] = [
    { id: 0, from: 0, to: 1, radius: 1, flux: 0, length: 1, bornAt: 0, activity: 1, fatigue: 0, stress: 0 },
    { id: 1, from: 1, to: 2, radius: 1, flux: 0, length: 1, bornAt: 0, activity: 1, fatigue: 0, stress: 0 },
    { id: 2, from: 2, to: 3, radius: 1, flux: 0, length: 1, bornAt: 0, activity: 1, fatigue: 0, stress: 0 },
    { id: 3, from: 0, to: 4, radius: 1, flux: 0, length: 1, bornAt: 0, activity: 1, fatigue: 0, stress: 0 },
  ];
  return { tick: 0, seed: 1, nodes, edges, nextNodeId: 5, nextEdgeId: 4, worldSize: 100 };
}

describe('updateFlux (multi-source BFS)', () => {
  it('複数 sink / 分岐でも各 sink 最寄りの source までの経路に同じ量の flux が乗る', () => {
    const expected = bruteForceFlux(makeBranchingGraph());

    const state = makeBranchingGraph();
    const idx = buildIndex(state);
    updateFlux(state, DEFAULT_PARAMS, idx);

    for (const e of state.edges) {
      expect(e.flux).toBeCloseTo(expected.get(e.id) ?? 0, 10);
    }
  });

  it('source へ到達できない sink は無視される', () => {
    const state: SimState = {
      tick: 0, seed: 1, worldSize: 100, nextNodeId: 2, nextEdgeId: 0,
      nodes: [
        { id: 0, pos: { x: 0, y: 0 }, type: 'source', bornAt: 0 },
        { id: 1, pos: { x: 10, y: 10 }, type: 'sink', bornAt: 0 }, // 孤立
      ],
      edges: [],
    };
    const idx = buildIndex(state);
    expect(() => updateFlux(state, DEFAULT_PARAMS, idx)).not.toThrow();
  });
});
