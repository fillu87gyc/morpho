// M30: 距離のコスト勾配 (distanceUpkeep) の検証。
//
// 検証するのは4点 (ROADMAP.md M30 の受け入れ基準):
//   (1) 既定 (distanceUpkeep=0) では挙動が完全に不変 (bit 一致) — 既存の
//       決定論テスト群に加えて、既定値の明示的な再指定でも固定する。
//   (2) 距離キャッシュ (state.sourceHops) の正しさ — 小さい手組みグラフで
//       flux BFS が記録する hop 距離を検証する (孤立成分は載らない、
//       更新は distanceUpdateInterval tick ごと、の2点も含む)。
//   (3) 有効時、母体近傍のエッジの fatigue < 遠端のエッジの fatigue
//       (同一構造の一本鎖での対照実験)。
//   (4) 有効時も seed 決定的 (同じ seed 2回で bit 一致)。

import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, GridEnvironment,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, run,
  type SimState, type SimParams, type SimNode, type SimEdge, type NodeId,
} from '../src/index.js';
import { updateFlux } from '../src/graph/flux.js';
import { buildIndex } from '../src/graph/index-utils.js';

// 状態の指紋: ノード位置/種別 + エッジの生命状態を文字列化 (bit 一致の検査用)。
function fingerprint(state: SimState): string[] {
  return [
    ...state.nodes.map((n) => `n${n.id}:${n.type}:${n.pos.x},${n.pos.y}`),
    ...state.edges.map((e) => `e${e.id}:${e.activity},${e.fatigue},${e.radius},${e.flux}`),
  ];
}

// ── 手組みグラフの道具 ────────────────────────────────

function addNode(state: SimState, x: number, y: number, type: SimNode['type']): SimNode {
  const n: SimNode = { id: state.nextNodeId++, pos: { x, y }, type, bornAt: 0 };
  state.nodes.push(n);
  return n;
}

function addEdge(state: SimState, from: NodeId, to: NodeId): SimEdge {
  const e: SimEdge = {
    id: state.nextEdgeId++, from, to, length: 3, bornAt: 0,
    flux: 0, radius: 0.7, activity: 0.8, fatigue: 0, stress: 0,
  };
  state.edges.push(e);
  return e;
}

describe('既定無効の bit 一致 (回帰ゼロ)', () => {
  it('distanceUpkeep を明示的に既定値で渡しても、有界ステージの結果は完全一致', () => {
    const build = (params: SimParams) => {
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 });
      env.placeFood({ x: 30, y: 50 }, 8, 1.2);
      env.placeFood({ x: 70, y: 50 }, 8, 1.2);
      const rng = createRNG(7);
      const act = new ActivityField(100, 64);
      const bio = new BiomassField(100, 64);
      const state = createInitialState(7, 100);
      seedSource(state, { x: 50, y: 50 }, 6);
      run(state, env, act, bio, params, rng, new EventBus(), 1200);
      return state;
    };
    const a = build(DEFAULT_PARAMS);
    const b = build({ ...DEFAULT_PARAMS, distanceUpkeep: 0, distanceUpdateInterval: 60 });
    expect(fingerprint(a)).toEqual(fingerprint(b));
    // 無効時は距離キャッシュを一切作らない (演算もメモリも足さない)。
    expect(a.sourceHops).toBeUndefined();
    expect(b.sourceHops).toBeUndefined();
  });
});

describe('距離キャッシュ (state.sourceHops) の正しさ', () => {
  // 手組みグラフ:
  //   S(source) ─ A ─ B ─ C   (一本鎖: hop 1, 2, 3)
  //   S ─ D                   (分岐: hop 1)
  //   E ─ F                   (孤立成分: 到達不能 = エントリ無し)
  function buildGraph() {
    const state = createInitialState(1, 100);
    const S = addNode(state, 50, 50, 'source');
    const A = addNode(state, 53, 50, 'relay');
    const B = addNode(state, 56, 50, 'relay');
    const C = addNode(state, 59, 50, 'sink');
    const D = addNode(state, 50, 53, 'relay');
    const E = addNode(state, 20, 20, 'relay');
    const F = addNode(state, 23, 20, 'relay');
    addEdge(state, S.id, A.id);
    addEdge(state, A.id, B.id);
    addEdge(state, B.id, C.id);
    addEdge(state, S.id, D.id);
    addEdge(state, E.id, F.id);
    return { state, S, A, B, C, D, E, F };
  }

  it('flux のマルチソース BFS が hop 距離を記録する (孤立成分は載らない)', () => {
    const { state, S, A, B, C, D, E, F } = buildGraph();
    const params: SimParams = { ...DEFAULT_PARAMS, distanceUpkeep: 0.01 };
    updateFlux(state, params, buildIndex(state));
    const hops = state.sourceHops!;
    expect(hops).toBeDefined();
    expect(hops.get(S.id)).toBe(0);
    expect(hops.get(A.id)).toBe(1);
    expect(hops.get(B.id)).toBe(2);
    expect(hops.get(C.id)).toBe(3);
    expect(hops.get(D.id)).toBe(1);
    // source から到達できない孤立成分はエントリを持たない (life.ts 側は
    // エントリ無し = 追加維持なしとして扱う。孤立成分は flux も途絶えて
    // いずれ prune されるので、距離ペナルティを重ねる必要がない)。
    expect(hops.has(E.id)).toBe(false);
    expect(hops.has(F.id)).toBe(false);
  });

  it('キャッシュは distanceUpdateInterval tick ごとにだけ更新される', () => {
    const { state, S } = buildGraph();
    const params: SimParams = { ...DEFAULT_PARAMS, distanceUpkeep: 0.01, distanceUpdateInterval: 60 };
    // 初回 (キャッシュ未生成) は間隔を待たず即記録する。
    state.tick = 1;
    updateFlux(state, params, buildIndex(state));
    const first = state.sourceHops!;
    expect(first).toBeDefined();

    // 間隔の途中で新ノードが増えても、キャッシュは同じもの (参照ごと不変)。
    const G = addNode(state, 50, 47, 'relay');
    addEdge(state, S.id, G.id);
    state.tick = 2;
    updateFlux(state, params, buildIndex(state));
    expect(state.sourceHops).toBe(first);
    expect(state.sourceHops!.has(G.id)).toBe(false);

    // 間隔の倍数 tick で組み直され、新ノードの距離が載る。
    state.tick = 60;
    updateFlux(state, params, buildIndex(state));
    expect(state.sourceHops).not.toBe(first);
    expect(state.sourceHops!.get(G.id)).toBe(1);
  });
});

describe('近いエッジの fatigue < 遠いエッジの fatigue (対照実験)', () => {
  // source から一直線の鎖 (30 hop) の先に sink。成長を全て止めて構造を固定し、
  // distanceUpkeep の有無だけを変えて同じ 300 tick を回す。鎖全体が sink への
  // 供給路なので flux (= 回復の源) は全エッジで同じ — fatigue の差は距離の
  // コスト勾配だけから生まれる。
  const HOPS = 30;
  function runChain(distanceUpkeep: number) {
    const env = new GridEnvironment({ worldSize: 200, fieldSize: 96 });
    env.placeFood({ x: 10 + HOPS * 3, y: 50 }, 6, 1.2);
    const rng = createRNG(11);
    const act = new ActivityField(200, 64);
    const bio = new BiomassField(200, 64);
    const state = createInitialState(11, 200);
    let prev = addNode(state, 10, 50, 'source');
    for (let i = 1; i <= HOPS; i++) {
      const n = addNode(state, 10 + i * 3, 50, i === HOPS ? 'sink' : 'relay');
      addEdge(state, prev.id, n.id);
      prev = n;
    }
    const params: SimParams = {
      ...DEFAULT_PARAMS, distanceUpkeep,
      // 構造を固定する (成長・分岐・横芽をすべて止める)。
      growthProbability: 0, branchProbabilityBase: 0, lateralBudProbability: 0,
    };
    run(state, env, act, bio, params, rng, new EventBus(), 300);
    return state;
  }

  it('有効時は遠端の fatigue が母体近傍より明確に高く、近傍はほぼ無効時のまま', () => {
    const on = runChain(0.05);
    const off = runChain(0);
    // 鎖は id 順に source 側 → sink 側 (prune は flux があるので起きない)。
    expect(on.edges.length).toBe(HOPS);
    const nearOn = on.edges[0]!, farOn = on.edges[HOPS - 1]!;
    const nearOff = off.edges[0]!, farOff = off.edges[HOPS - 1]!;
    // (a) 有効時: 距離に沿って fatigue に測定可能な差が出る。
    expect(farOn.fatigue).toBeGreaterThan(nearOn.fatigue + 0.5);
    // (b) 遠端は無効時より明確に消耗している。
    expect(farOn.fatigue).toBeGreaterThan(farOff.fatigue + 0.5);
    // (c) 母体近傍 (h=0) は実質ゼロ: 無効時との差がごく小さい。
    expect(Math.abs(nearOn.fatigue - nearOff.fatigue)).toBeLessThan(0.05);
  });
});

describe('有効時の決定論', () => {
  it('同じ seed 2回で最終状態と距離キャッシュが bit 一致する', () => {
    const build = () => {
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 96 });
      env.placeFood({ x: 25, y: 50 }, 7, 1.2);
      env.placeFood({ x: 75, y: 50 }, 7, 1.2);
      const rng = createRNG(42);
      const act = new ActivityField(100, 64);
      const bio = new BiomassField(100, 64);
      const state = createInitialState(42, 100);
      seedSource(state, { x: 50, y: 50 }, 6);
      run(state, env, act, bio, { ...DEFAULT_PARAMS, distanceUpkeep: 0.02 }, rng, new EventBus(), 900);
      return state;
    };
    const a = build(), b = build();
    expect(fingerprint(a)).toEqual(fingerprint(b));
    expect(a.sourceHops).toBeDefined();
    expect([...a.sourceHops!.entries()].sort()).toEqual([...b.sourceHops!.entries()].sort());
    // 実際に距離コストが働いている前提での比較であること (h>0 のノードが
    // 存在する) を確認する。
    expect(Math.max(...a.sourceHops!.values())).toBeGreaterThan(0);
  });
});
