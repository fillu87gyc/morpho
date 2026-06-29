// 基本型: 全モジュール共通

export type Vec2 = { x: number; y: number };

export type NodeId = number;
export type EdgeId = number;

export type NodeType = 'source' | 'sink' | 'relay';

export interface SimNode {
  id: NodeId;
  pos: Vec2;
  type: NodeType;
  bornAt: number;
}

export interface SimEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  radius: number;   // 管の太さ（描画と寿命）
  flux: number;     // 流量（外的に計算、状態ではなく観測値）
  length: number;
  bornAt: number;

  // --- 生命モデルの単一の内部状態 ---
  activity: number; // [0, 1]。全ての振る舞いの源泉
  fatigue: number;  // [0, ∞)。活動で蓄積、流れがあれば回復
  stress: number;   // [0, ∞)。伸長失敗で蓄積、分岐の駆動力
}

export interface Traits {
  exploration: number; // 探索性: 広がり
  efficiency: number;  // 効率性: 余分なエッジが少ない
  stability: number;   // 安定性: 太い幹の割合
}

export interface SimState {
  tick: number;
  seed: number;
  nodes: SimNode[];
  edges: SimEdge[];
  nextNodeId: NodeId;
  nextEdgeId: EdgeId;
  worldSize: number;
}
