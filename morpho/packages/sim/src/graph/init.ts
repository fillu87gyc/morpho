import type { SimState, SimNode, Traits, Vec2 } from '../types.js';
import type { GridEnvironment } from '../env/field.js';

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

export function computeTraits(state: SimState): Traits {
  if (state.nodes.length === 0) return { exploration: 0, efficiency: 0, stability: 0 };

  let mx = 0, my = 0;
  for (const n of state.nodes) { mx += n.pos.x; my += n.pos.y; }
  mx /= state.nodes.length; my /= state.nodes.length;
  let variance = 0;
  for (const n of state.nodes) {
    variance += (n.pos.x - mx) ** 2 + (n.pos.y - my) ** 2;
  }
  const exploration = Math.min(1, Math.sqrt(variance / state.nodes.length) / (state.worldSize * 0.4));

  const ratio = state.edges.length / Math.max(1, state.nodes.length - 1);
  const sinkReached = Math.min(1, state.nodes.filter(n => n.type === 'sink').length * 0.25);
  const efficiency = sinkReached * 0.5 + Math.max(0, 1 - Math.abs(ratio - 1.0)) * 0.5;

  const thick = state.edges.filter(e => e.radius > 1.5).length;
  const stability = state.edges.length > 0 ? thick / state.edges.length : 0;

  const c = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v;
  return { exploration: c(exploration), efficiency: c(efficiency), stability: c(stability) };
}
