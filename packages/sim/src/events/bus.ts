import type { NodeId, EdgeId, Vec2 } from '../types.js';

export type SimEvent =
  | { type: 'NewBranch';     tick: number; nodeId: NodeId; pos: Vec2 }
  | { type: 'DeadEdge';      tick: number; edgeId: EdgeId }
  | { type: 'ReachedFood';   tick: number; nodeId: NodeId; pos: Vec2 }
  | { type: 'LoopCreated';   tick: number; nodeIds: NodeId[] }
  | { type: 'EdgeThickened'; tick: number; edgeId: EdgeId; radius: number }
  | { type: 'Stagnated';     tick: number }
  // M12: 成長候補が一度は障害物/毒素で棄却されたが、別方向へ伸びて成功した。
  | { type: 'ObstacleAvoided'; tick: number; nodeId: NodeId; pos: Vec2 }
  // M12: 横方向出芽 (lateralBud) が新しい末端を作った ("胞子を生成" の演出用)。
  | { type: 'SporeFormed';   tick: number; nodeId: NodeId; pos: Vec2 };

export class EventBus {
  private events: SimEvent[] = [];

  emit(e: SimEvent): void  { this.events.push(e); }
  drain(): SimEvent[]       { const out = this.events; this.events = []; return out; }
  peek(): readonly SimEvent[] { return this.events; }
}
