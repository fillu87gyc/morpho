// M8 P2: postMessage 境界での nodes/edges の Float32Array パック化。
//
// これまで sim-worker → main への送信は GameSnapshot をまるごと
// structuredClone していた。フィールド (env/bio の Float32Array) は
// 構造化クローンの高速パスで安価だが、SimState の nodes/edges は
// 数百個の JS オブジェクトの配列で、構造化クローンは各オブジェクトの
// 各プロパティを個別に辿る必要があり相対的に高コスト
// (現状の計測で「snapshot の structuredClone 0.9〜1.1ms」の主要因)。
//
// ここでは nodes/edges だけを Float32Array に平坦化し、
// postMessage の transferable として渡す (ゼロコピー)。受信側で
// 元の SimNode[]/SimEdge[] に復元してから使うので、render.ts や
// quests.ts など既存のコンシューマは一切変更しない。

import type { NodeType, SimEdge, SimNode } from '@morpho/sim';

const NODE_TYPES: NodeType[] = ['source', 'sink', 'relay'];
const NODE_FIELDS = 5; // id, x, y, typeCode, bornAt
const EDGE_FIELDS = 10; // id, from, to, length, bornAt, flux, radius, activity, fatigue, stress

export function packNodes(nodes: readonly SimNode[]): Float32Array {
  const buf = new Float32Array(nodes.length * NODE_FIELDS);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]!;
    const o = i * NODE_FIELDS;
    buf[o] = n.id;
    buf[o + 1] = n.pos.x;
    buf[o + 2] = n.pos.y;
    buf[o + 3] = NODE_TYPES.indexOf(n.type);
    buf[o + 4] = n.bornAt;
  }
  return buf;
}

export function unpackNodes(buf: Float32Array): SimNode[] {
  const count = buf.length / NODE_FIELDS;
  const nodes: SimNode[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * NODE_FIELDS;
    nodes[i] = {
      id: buf[o]!,
      pos: { x: buf[o + 1]!, y: buf[o + 2]! },
      type: NODE_TYPES[buf[o + 3]!]!,
      bornAt: buf[o + 4]!,
    };
  }
  return nodes;
}

export function packEdges(edges: readonly SimEdge[]): Float32Array {
  const buf = new Float32Array(edges.length * EDGE_FIELDS);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const o = i * EDGE_FIELDS;
    buf[o] = e.id;
    buf[o + 1] = e.from;
    buf[o + 2] = e.to;
    buf[o + 3] = e.length;
    buf[o + 4] = e.bornAt;
    buf[o + 5] = e.flux;
    buf[o + 6] = e.radius;
    buf[o + 7] = e.activity;
    buf[o + 8] = e.fatigue;
    buf[o + 9] = e.stress;
  }
  return buf;
}

export function unpackEdges(buf: Float32Array): SimEdge[] {
  const count = buf.length / EDGE_FIELDS;
  const edges: SimEdge[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = i * EDGE_FIELDS;
    edges[i] = {
      id: buf[o]!,
      from: buf[o + 1]!,
      to: buf[o + 2]!,
      length: buf[o + 3]!,
      bornAt: buf[o + 4]!,
      flux: buf[o + 5]!,
      radius: buf[o + 6]!,
      activity: buf[o + 7]!,
      fatigue: buf[o + 8]!,
      stress: buf[o + 9]!,
    };
  }
  return edges;
}
