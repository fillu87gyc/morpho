import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, GridEnvironment,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, run, computeTraits,
} from '../src/index.js';

function setupRun(seed: number) {
  const rng = createRNG(seed);
  const env = new GridEnvironment({ worldSize: 100, fieldSize: 64 });
  env.placeFood({ x: 30, y: 30 }, 6, 1.0);
  env.placeFood({ x: 70, y: 70 }, 6, 1.0);
  env.placeStone({ x: 50, y: 50 }, 4);
  const actField = new ActivityField(100, 64);
  const bioField = new BiomassField(100, 64);
  const state = createInitialState(seed, 100);
  seedSource(state, { x: 50, y: 30 });
  const bus = new EventBus();
  return { state, env, actField, bioField, rng, bus };
}

describe('determinism', () => {
  it('同じseedからは同じ最終状態が得られる', () => {
    const a = setupRun(42), b = setupRun(42);
    run(a.state, a.env, a.actField, a.bioField, DEFAULT_PARAMS, a.rng, a.bus, 100);
    run(b.state, b.env, b.actField, b.bioField, DEFAULT_PARAMS, b.rng, b.bus, 100);
    expect(a.state.nodes.length).toBe(b.state.nodes.length);
    for (let i = 0; i < a.state.nodes.length; i++) {
      expect(a.state.nodes[i]!.pos.x).toBe(b.state.nodes[i]!.pos.x);
    }
  });

  it('異なるseedからは異なる結果になる', () => {
    const a = setupRun(1), b = setupRun(2);
    run(a.state, a.env, a.actField, a.bioField, DEFAULT_PARAMS, a.rng, a.bus, 100);
    run(b.state, b.env, b.actField, b.bioField, DEFAULT_PARAMS, b.rng, b.bus, 100);
    expect(a.state.nodes.length === b.state.nodes.length && a.state.edges.length === b.state.edges.length).toBe(false);
  });
});

describe('basic growth', () => {
  it('200tick後に成長イベントが起きている', () => {
    const r = setupRun(7);
    run(r.state, r.env, r.actField, r.bioField, DEFAULT_PARAMS, r.rng, r.bus, 200);
    expect(r.bus.peek().filter(e => e.type === 'NewBranch').length).toBeGreaterThan(3);
  });

  it('食料があると ReachedFood イベントが出る', () => {
    const r = setupRun(7);
    run(r.state, r.env, r.actField, r.bioField, DEFAULT_PARAMS, r.rng, r.bus, 1500);
    expect(r.bus.peek().filter(e => e.type === 'ReachedFood').length).toBeGreaterThan(0);
  });

  it('Event が発火している', () => {
    const r = setupRun(13);
    run(r.state, r.env, r.actField, r.bioField, DEFAULT_PARAMS, r.rng, r.bus, 400);
    const types = new Set(r.bus.drain().map(e => e.type));
    expect(types.has('NewBranch')).toBe(true);
    expect(types.has('ReachedFood')).toBe(true);
  });

  it('traits が妥当な範囲', () => {
    const r = setupRun(99);
    run(r.state, r.env, r.actField, r.bioField, DEFAULT_PARAMS, r.rng, r.bus, 400);
    const t = computeTraits(r.state);
    expect(t.exploration).toBeGreaterThanOrEqual(0);
    expect(t.exploration).toBeLessThanOrEqual(1);
    expect(t.stability).toBeGreaterThanOrEqual(0);
    expect(t.stability).toBeLessThanOrEqual(1);
  });
});

describe('biomass field', () => {
  it('成長した枝の周辺で biomass が立ち上がる', () => {
    const r = setupRun(7);
    run(r.state, r.env, r.actField, r.bioField, DEFAULT_PARAMS, r.rng, r.bus, 200);
    // 端点の周辺に膜が滲んでいる: エッジ中点で sampling
    let withBiomass = 0;
    for (const e of r.state.edges) {
      const a = r.state.nodes.find(n => n.id === e.from);
      const b = r.state.nodes.find(n => n.id === e.to);
      if (!a || !b) continue;
      const v = r.bioField.sample({ x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 });
      if (v > 0.05) withBiomass++;
    }
    // 過半数のエッジ周辺で観測可能な膜が存在するはず
    expect(withBiomass).toBeGreaterThan(r.state.edges.length / 2);
  });

  it('膜は「点」ではなく「面」として広がる (隣接セルにも biomass がある)', () => {
    const r = setupRun(11);
    run(r.state, r.env, r.actField, r.bioField, DEFAULT_PARAMS, r.rng, r.bus, 300);
    // 任意のエッジ中点から少し離れた点でも biomass > 0 であることを確認
    const e = r.state.edges[0];
    if (!e) throw new Error('no edges grew');
    const a = r.state.nodes.find(n => n.id === e.from)!;
    const b = r.state.nodes.find(n => n.id === e.to)!;
    const mid = { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 };
    const off = { x: mid.x + 1.5, y: mid.y + 1.5 };
    expect(r.bioField.sample(off)).toBeGreaterThan(0);
  });

  it('biomass field も決定的', () => {
    const a = setupRun(123), b = setupRun(123);
    run(a.state, a.env, a.actField, a.bioField, DEFAULT_PARAMS, a.rng, a.bus, 150);
    run(b.state, b.env, b.actField, b.bioField, DEFAULT_PARAMS, b.rng, b.bus, 150);
    // 場全体の総量が一致する: 内部状態の決定性の証拠
    let sumA = 0, sumB = 0;
    for (let i = 0; i < a.bioField.field.data.length; i++) {
      sumA += a.bioField.field.data[i] ?? 0;
      sumB += b.bioField.field.data[i] ?? 0;
    }
    expect(sumA).toBe(sumB);
  });
});
