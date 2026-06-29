import type { NodeId, EdgeId, Vec2 } from '../types.js';

export type SimEvent =
  | { type: 'NewBranch';     tick: number; nodeId: NodeId; pos: Vec2 }
  | { type: 'DeadEdge';      tick: number; edgeId: EdgeId }
  | { type: 'ReachedFood';   tick: number; nodeId: NodeId; pos: Vec2 }
  | { type: 'LoopCreated';   tick: number; nodeIds: NodeId[] }
  | { type: 'EdgeThickened'; tick: number; edgeId: EdgeId; radius: number }
  | { type: 'Stagnated';     tick: number };

export class EventBus {
  private events: SimEvent[] = [];

  emit(e: SimEvent): void  { this.events.push(e); }
  drain(): SimEvent[]       { const out = this.events; this.events = []; return out; }
  peek(): readonly SimEvent[] { return this.events; }
}
