// 刈り込み: 細く流れていないエッジを枯死させる。
// 「青春期」(生まれて 100 tick 以内) は保護する — 生まれたばかりは
// flux も radius も育っていないのが当然なので、判定対象から外す。

import type { SimState, NodeId } from '../types.js';
import type { EventBus } from '../events/bus.js';
import type { SimParams } from './params.js';

export function prune(state: SimState, params: SimParams, bus: EventBus): void {
  const surviving = [];
  for (const e of state.edges) {
    if (state.tick - e.bornAt < 100) { surviving.push(e); continue; }
    if (e.radius < params.pruneRadius && e.flux < 0.1) {
      bus.emit({ type: 'DeadEdge', tick: state.tick, edgeId: e.id });
    } else {
      surviving.push(e);
    }
  }
  state.edges = surviving;

  const connected = new Set<NodeId>();
  for (const e of state.edges) { connected.add(e.from); connected.add(e.to); }
  state.nodes = state.nodes.filter(n => n.type !== 'relay' || connected.has(n.id));
}
