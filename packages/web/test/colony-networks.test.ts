import { describe, it, expect } from 'vitest';
import { computeColonyNetworks } from '../src/colony-networks.js';
import type { SimState, SimNode, SimEdge } from '@morpho/sim';

function node(id: number, pos: { x: number; y: number }, type: SimNode['type']): SimNode {
  return { id, pos, type, bornAt: 0 };
}

function edge(id: number, from: number, to: number): SimEdge {
  return { id, from, to, length: 1, bornAt: 0, flux: 0, radius: 1, activity: 1, fatigue: 0, stress: 0 };
}

function state(nodes: SimNode[], edges: SimEdge[]): SimState {
  return { tick: 0, seed: 1, nodes, edges, nextNodeId: nodes.length, nextEdgeId: edges.length, worldSize: 100 };
}

describe('computeColonyNetworks', () => {
  const posA = { x: 30, y: 30 };
  const posB = { x: 70, y: 30 };
  const posC = { x: 50, y: 75 };

  it('互いに繋がっていないコロニーはそれぞれ独立したネットワークとして数えられる', () => {
    const s = state(
      [node(0, posA, 'source'), node(1, posB, 'source'), node(2, posC, 'source')],
      [],
    );
    const result = computeColonyNetworks(s, [posA, posB, posC]);
    expect(result.networksCount).toBe(3);
    const ids = new Set(result.markers.map((m) => m.networkId));
    expect(ids.size).toBe(3);
  });

  it('エッジで繋がった2つのコロニーは同じネットワークになる', () => {
    const s = state(
      [node(0, posA, 'source'), node(1, posB, 'source'), node(2, posC, 'source'), node(3, { x: 50, y: 30 }, 'relay')],
      [edge(0, 0, 3), edge(1, 3, 1)],
    );
    const result = computeColonyNetworks(s, [posA, posB, posC]);
    expect(result.networksCount).toBe(2);
    const [mA, mB, mC] = result.markers;
    expect(mA!.networkId).toBe(mB!.networkId);
    expect(mA!.networkId).not.toBe(mC!.networkId);
  });

  it('全コロニーが1つの連結成分に繋がるとネットワーク数は1になる', () => {
    const s = state(
      [
        node(0, posA, 'source'), node(1, posB, 'source'), node(2, posC, 'source'),
        node(3, { x: 50, y: 30 }, 'relay'), node(4, { x: 50, y: 50 }, 'relay'),
      ],
      [edge(0, 0, 3), edge(1, 3, 1), edge(2, 3, 4), edge(3, 4, 2)],
    );
    const result = computeColonyNetworks(s, [posA, posB, posC]);
    expect(result.networksCount).toBe(1);
    const ids = new Set(result.markers.map((m) => m.networkId));
    expect(ids.size).toBe(1);
  });

  it('networkId はソースの id に依らず入力ごとに決定的 (小さい id 側の root に揃う)', () => {
    const s1 = state(
      [node(0, posA, 'source'), node(1, posB, 'source'), node(2, { x: 50, y: 30 }, 'relay')],
      [edge(0, 0, 2), edge(1, 2, 1)],
    );
    const s2 = state(
      [node(0, posA, 'source'), node(1, posB, 'source'), node(2, { x: 50, y: 30 }, 'relay')],
      [edge(0, 0, 2), edge(1, 2, 1)],
    );
    const r1 = computeColonyNetworks(s1, [posA, posB]);
    const r2 = computeColonyNetworks(s2, [posA, posB]);
    expect(r1.markers).toEqual(r2.markers);
  });
});
