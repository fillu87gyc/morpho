// M6: 複数コロニー (ソース) が物理的に同じネットワークへ統合されたかを判定する。
// sim 本体には「コロニー」という概念がない (source ノードが複数あってもただの
// グラフでしかない) ので、SimState の構造だけから web 側の純粋関数として導出する
// (アーキテクチャ方針: 個性/クエストは web 側で持つ)。
//
// 判定方法: エッジで Union-Find し、各ソースがどの連結成分に属すかを見る。
// 同じ連結成分に属すソースは同じ networkId を持つ = ネットワークが繋がった。

import type { SimState, Vec2 } from '@morpho/sim';

export interface ColonyMarker {
  pos: Vec2;
  // M12: そのネットワーク全体 (統合済みなら複数コロニーぶん) のノード位置の
  // 重心。個体を追跡するカメラの注視点として使う (source の固定位置と違い、
  // 成長に伴って動く)。
  centroid: Vec2;
  networkId: number; // 同じ値のコロニーは同一ネットワークへ統合済み
}

export interface ColonyNetworks {
  networksCount: number;
  markers: ColonyMarker[];
}

export function computeColonyNetworks(state: SimState, sourcePositions: Vec2[]): ColonyNetworks {
  const parent = new Map<number, number>();
  for (const n of state.nodes) parent.set(n.id, n.id);

  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    // root は小さい id 側に揃える: 同じ入力なら常に同じ root になり、
    // フレームをまたいで networkId が安定する (ミニマップの色がちらつかない)。
    if (ra < rb) parent.set(rb, ra); else parent.set(ra, rb);
  };
  for (const e of state.edges) union(e.from, e.to);

  // root ごとにノード位置を集計しておき、後で重心 (centroid) を出す。
  const sumByRoot = new Map<number, { x: number; y: number; n: number }>();
  for (const n of state.nodes) {
    const root = find(n.id);
    const acc = sumByRoot.get(root);
    if (acc) { acc.x += n.pos.x; acc.y += n.pos.y; acc.n += 1; }
    else sumByRoot.set(root, { x: n.pos.x, y: n.pos.y, n: 1 });
  }

  // source ノードは prune の対象外 (関節点保護) で座標も生成時のまま動かないため、
  // sourcePositions との座標一致で対応する source ノードを一意に特定できる。
  const sourceNodes = state.nodes.filter((n) => n.type === 'source');
  const rootToNetworkId = new Map<number, number>();
  const markers: ColonyMarker[] = sourcePositions.map((pos) => {
    const node = sourceNodes.find((n) => n.pos.x === pos.x && n.pos.y === pos.y)!;
    const root = find(node.id);
    if (!rootToNetworkId.has(root)) rootToNetworkId.set(root, rootToNetworkId.size);
    const acc = sumByRoot.get(root)!;
    return { pos, centroid: { x: acc.x / acc.n, y: acc.y / acc.n }, networkId: rootToNetworkId.get(root)! };
  });

  return { networksCount: rootToNetworkId.size, markers };
}
