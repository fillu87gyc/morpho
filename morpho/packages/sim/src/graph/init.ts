// 初期状態の構築。空の SimState を作る + source を植える + 障害物を逃がす。
// 動的な振る舞いはここに含めない (life, growth, prune 側の責務)。

import type { SimState, SimNode, Vec2 } from '../types.js';
import type { GridEnvironment } from '../env/environment.js';

export function createInitialState(seed: number, worldSize = 100): SimState {
  return { tick: 0, seed, nodes: [], edges: [], nextNodeId: 0, nextEdgeId: 0, worldSize };
}

export function seedSource(state: SimState, pos: Vec2, initialBranches = 6): void {
  const source: SimNode = { id: state.nextNodeId++, pos, type: 'source', bornAt: state.tick };
  state.nodes.push(source);
  const r = 2.0;
  for (let i = 0; i < initialBranches; i++) {
    const angle = (i / initialBranches) * Math.PI * 2;
    const tip: SimNode = {
      id: state.nextNodeId++,
      pos: { x: pos.x + Math.cos(angle) * r, y: pos.y + Math.sin(angle) * r },
      type: 'relay',
      bornAt: state.tick,
    };
    state.nodes.push(tip);
    state.edges.push({
      id: state.nextEdgeId++, from: source.id, to: tip.id,
      radius: 1.0, flux: 0, length: r, bornAt: state.tick,
      activity: 0.8, fatigue: 0, stress: 0,
    });
  }
}

// source の真下に石を置かれた場合の救済: 半径内の障害物を消す。
export function clearAroundSource(env: GridEnvironment, pos: Vec2, radius = 6): void {
  const s = env.fieldSize / env.worldSize;
  const cx = pos.x * s, cy = pos.y * s;
  const r = radius * s, r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(env.fieldSize - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(env.fieldSize - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) env.obstacle.data[y * env.fieldSize + x] = 0;
    }
  }
}
