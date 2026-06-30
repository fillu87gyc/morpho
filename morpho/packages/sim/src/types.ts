// 共通の基本型。
// 構造 (id, pos, from, to ...) と「生命の状態」(activity, fatigue, stress)
// が混ざるのは意図的: 1 エッジを 1 つの生き物のように扱う方が
// 振る舞い (成長/枯死/分岐) のローカル則を素直に書けるため。

// ── 幾何 ──────────────────────────────────────────────

export type Vec2 = { x: number; y: number };

// ── グラフの ID 型 ────────────────────────────────────

export type NodeId = number;
export type EdgeId = number;

// ── グラフの中身 ──────────────────────────────────────

export type NodeType = 'source' | 'sink' | 'relay';

export interface SimNode {
  id: NodeId;
  pos: Vec2;
  type: NodeType;
  bornAt: number;
}

export interface SimEdge {
  // 構造: 不変側
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  length: number;
  bornAt: number;

  // 観測値: 流量計算の結果として書き換わる。状態ではない。
  flux: number;
  // 形態量: 描画と寿命に効く。
  radius: number;

  // 生命の状態: ローカル則の駆動源。
  activity: number; // [0, 1]。全ての振る舞いの源泉
  fatigue: number;  // [0, ∞)。活動で蓄積、流れがあれば回復
  stress: number;   // [0, ∞)。伸長失敗で蓄積、分岐の駆動力
}

// ── シミュレーション全体の状態 ────────────────────────

export interface SimState {
  tick: number;
  seed: number;
  nodes: SimNode[];
  edges: SimEdge[];
  nextNodeId: NodeId;
  nextEdgeId: EdgeId;
  worldSize: number;
}

// ── 観測量 (analytical) ──────────────────────────────

export interface Traits {
  exploration: number; // 探索性: 広がり
  efficiency: number;  // 効率性: 余分なエッジが少ない
  stability: number;   // 安定性: 太い幹の割合
}
