import { describe, it, expect } from 'vitest';
import { computeDegree, traceChains, smoothChain } from '../src/vein-curves.js';
import type { SimNode, SimEdge } from '@morpho/sim';

function node(id: number, x: number, y: number, type: SimNode['type'] = 'relay'): SimNode {
  return { id, pos: { x, y }, type, bornAt: 0 };
}
function edge(id: number, from: number, to: number, radius = 1): SimEdge {
  return { id, from, to, length: 1, bornAt: 0, flux: 0, radius, activity: 0, fatigue: 0, stress: 0 };
}

describe('computeDegree', () => {
  it('直線チェーンの端点は次数1、中間は次数2', () => {
    const nodes = [node(0, 0, 0), node(1, 1, 0), node(2, 2, 0)];
    const edges = [edge(0, 0, 1), edge(1, 1, 2)];
    const degree = computeDegree(nodes, edges);
    expect(degree.get(0)).toBe(1);
    expect(degree.get(1)).toBe(2);
    expect(degree.get(2)).toBe(1);
  });

  it('分岐点は次数3以上', () => {
    const nodes = [node(0, 0, 0), node(1, 1, 0), node(2, 2, 1), node(3, 2, -1)];
    const edges = [edge(0, 0, 1), edge(1, 1, 2), edge(2, 1, 3)];
    expect(computeDegree(nodes, edges).get(1)).toBe(3);
  });
});

describe('traceChains', () => {
  it('単純な直線は1本のチェーンになる', () => {
    const nodes = [node(0, 0, 0, 'source'), node(1, 1, 0), node(2, 2, 0), node(3, 3, 0, 'sink')];
    const edges = [edge(0, 0, 1), edge(1, 1, 2), edge(2, 2, 3)];
    const chains = traceChains(nodes, edges);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.nodeIds).toEqual([0, 1, 2, 3]);
    expect(chains[0]!.edgeIds).toEqual([0, 1, 2]);
  });

  it('Y字分岐は3本のチェーンに分解される', () => {
    // 0 -- 1 -- 2 (branch) -- 3, 2 -- 4
    const nodes = [node(0, 0, 0), node(1, 1, 0), node(2, 2, 0), node(3, 3, 1), node(4, 3, -1)];
    const edges = [edge(0, 0, 1), edge(1, 1, 2), edge(2, 2, 3), edge(3, 2, 4)];
    const chains = traceChains(nodes, edges);
    expect(chains).toHaveLength(3);
    const allEdgeIds = chains.flatMap((c) => c.edgeIds).sort();
    expect(allEdgeIds).toEqual([0, 1, 2, 3]);
    // 分岐ノード(2)を含むチェーンが2本、含まないチェーンはない
    for (const c of chains) {
      expect(c.nodeIds).toContain(2);
    }
  });

  it('孤立した閉路 (全ノード次数2) も1本のチェーンとして辿る', () => {
    const nodes = [node(0, 0, 0), node(1, 1, 0), node(2, 1, 1), node(3, 0, 1)];
    const edges = [edge(0, 0, 1), edge(1, 1, 2), edge(2, 2, 3), edge(3, 3, 0)];
    const chains = traceChains(nodes, edges);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.edgeIds).toHaveLength(4);
  });

  it('末端 (degree1) フラグが正しく立つ', () => {
    // node1 が次数3の分岐点、0/2/3 はいずれも葉 (次数1) → 3本のチェーンに分解される。
    const nodes = [node(0, 0, 0), node(1, 1, 0), node(2, 2, 1), node(3, 2, -1)];
    const edges = [edge(0, 0, 1), edge(1, 1, 2), edge(2, 1, 3)];
    const chains = traceChains(nodes, edges);
    expect(chains).toHaveLength(3);
    for (const c of chains) {
      expect(c.startIsLeaf || c.endIsLeaf).toBe(true);
    }
  });
});

describe('smoothChain', () => {
  it('直線チェーンを分割すると始点・終点は元の座標と一致する', () => {
    const nodes = [node(0, 0, 0), node(1, 10, 0), node(2, 20, 0)];
    const edges = [edge(0, 0, 1, 2), edge(1, 1, 2, 1)];
    const chain = traceChains(nodes, edges)[0]!;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edgeMap = new Map(edges.map((e) => [e.id, e]));
    const points = smoothChain(chain, nodeMap, edgeMap, 4);

    expect(points[0]!.pos.x).toBeCloseTo(0);
    expect(points[points.length - 1]!.pos.x).toBeCloseTo(20);
    // 直線上なので y は常に0のまま (Catmull-Rom が直線を歪めないことの確認)。
    for (const p of points) expect(p.pos.y).toBeCloseTo(0);
  });

  it('太さは始端エッジ radius から終端エッジ radius へ単調に近づく', () => {
    const nodes = [node(0, 0, 0), node(1, 10, 0), node(2, 20, 0), node(3, 30, 0)];
    const edges = [edge(0, 0, 1, 3), edge(1, 1, 2, 2), edge(2, 2, 3, 1)];
    const chain = traceChains(nodes, edges)[0]!;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edgeMap = new Map(edges.map((e) => [e.id, e]));
    const points = smoothChain(chain, nodeMap, edgeMap, 4);

    expect(points[0]!.radius).toBeCloseTo(3);
    expect(points[points.length - 1]!.radius).toBeCloseTo(1);
    // 単調非増加であること (太→細のテーパー)。
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.radius).toBeLessThanOrEqual(points[i - 1]!.radius + 1e-9);
    }
  });

  it('t は0から1へ単調に増加する', () => {
    const nodes = [node(0, 0, 0), node(1, 10, 0), node(2, 20, 0)];
    const edges = [edge(0, 0, 1), edge(1, 1, 2)];
    const chain = traceChains(nodes, edges)[0]!;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edgeMap = new Map(edges.map((e) => [e.id, e]));
    const points = smoothChain(chain, nodeMap, edgeMap, 3);
    expect(points[0]!.t).toBeCloseTo(0);
    expect(points[points.length - 1]!.t).toBeCloseTo(1);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!.t).toBeGreaterThan(points[i - 1]!.t);
    }
  });

  it('2ノードだけの単一エッジチェーンでも破綻しない', () => {
    const nodes = [node(0, 0, 0), node(1, 5, 5)];
    const edges = [edge(0, 0, 1, 1.5)];
    const chain = traceChains(nodes, edges)[0]!;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const edgeMap = new Map(edges.map((e) => [e.id, e]));
    const points = smoothChain(chain, nodeMap, edgeMap, 4);
    expect(points.length).toBeGreaterThan(1);
    expect(points[0]!.pos).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]!.pos.x).toBeCloseTo(5);
  });
});
