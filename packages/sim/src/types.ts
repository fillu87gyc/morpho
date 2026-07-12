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
  // M29: 休眠中の空間セル (graph/dormancy.ts の packDormancyCell でパック
  // したキー)。params.dormancyCheckInterval=0 (既定) では常に undefined。
  // 構造 (nodes/edges の bornAt) から決定的に再計算できる派生量なので、
  // 保存/転送は不要 — 欠けていても次回の休眠判定で復元される。
  dormantCells?: Set<number>;
  // M30: 母体からの距離キャッシュ。graph/flux.ts が params.distanceUpdate-
  // Interval tick ごとに記録する。params.distanceUpkeep=0 (既定) では常に
  // undefined。dormantCells と同じく構造から決定的に再計算できる派生量なので、
  // 保存/転送は不要。値の意味は params.distanceMode に依る:
  //   - 'hops': source からのグラフ距離 (hop 数)。source から到達できない
  //     ノード (孤立成分) はエントリを持たない。
  //   - 'origin': 原点 (下の origins) からのユークリッド距離 (ワールド単位)。
  //     全ノードがエントリを持つ (孤立成分にも効く)。
  sourceHops?: Map<NodeId, number>;
  // M30-B: 原点 = seedSource() 時点の初期 source 位置 (「スタート地点」)。
  // source ノードは後から prune されうる/動きうる将来拡張に備え、植えた瞬間の
  // 座標をここへ確定記録する。distanceMode='origin' の距離計算だけが読む。
  // seedSource を通らずに手組みした state では undefined — その場合 'origin'
  // モードは現存する source ノード位置へフォールバックする (graph/flux.ts)。
  origins?: Vec2[];
}

// ── 観測量 (analytical) ──────────────────────────────

export interface Traits {
  exploration: number; // 探索性: 広がり
  efficiency: number;  // 効率性: 余分なエッジが少ない
  stability: number;   // 安定性: 太い幹の割合
}

// 個体ビュー用の6軸。Traits (探索性/効率性/安定性) に
// 健康度/活力/適応性を足したもの。
export interface Individuality extends Traits {
  health: number;       // 健康度: 疲労・ストレスの低さ
  vitality: number;     // 活力: 平均 activity
  adaptability: number; // 適応性: 分岐構造の多様性
}

export type IndividualTypeId = 'thick-connector' | 'spreader' | 'efficient' | 'resilient' | 'balanced';
