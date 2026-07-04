import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, GridEnvironment,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, run, computeTraits,
  type SimParams,
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

  // M10: 温度・毒素を置いた場合も決定的であることを確認する。
  it('温度・毒素を置いた状態でも、同じseedからは同じ最終状態が得られる', () => {
    function withHazards(seed: number) {
      const r = setupRun(seed);
      r.env.placeHeat({ x: 40, y: 40 }, 10, -0.3);
      r.env.placeToxin({ x: 60, y: 60 }, 10, 0.5);
      return r;
    }
    const a = withHazards(42), b = withHazards(42);
    run(a.state, a.env, a.actField, a.bioField, DEFAULT_PARAMS, a.rng, a.bus, 150);
    run(b.state, b.env, b.actField, b.bioField, DEFAULT_PARAMS, b.rng, b.bus, 150);
    expect(a.state.nodes.length).toBe(b.state.nodes.length);
    expect(a.state.edges.length).toBe(b.state.edges.length);
    for (let i = 0; i < a.state.nodes.length; i++) {
      expect(a.state.nodes[i]!.pos.x).toBe(b.state.nodes[i]!.pos.x);
    }
  });
});

describe('M10: 温度・毒素の成長への影響', () => {
  const HAZARD_PARAMS: SimParams = { ...DEFAULT_PARAMS, tempOptimal: 0.5, tempTolerance: 0.1 };

  it('最適から外れた温度の領域では、活動の回復が遅れて成長が控えめになる', () => {
    function setupAt(seed: number, coldZone: boolean) {
      const rng = createRNG(seed);
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 64, baseTemperature: 0.5 });
      env.placeFood({ x: 50, y: 80 }, 8, 1.2);
      if (coldZone) env.placeHeat({ x: 50, y: 50 }, 30, -0.4);
      const actField = new ActivityField(100, 64);
      const bioField = new BiomassField(100, 64);
      const state = createInitialState(seed, 100);
      seedSource(state, { x: 50, y: 20 });
      const bus = new EventBus();
      return { state, env, actField, bioField, rng, bus };
    }
    let coldEdges = 0, warmEdges = 0;
    for (let seed = 0; seed < 5; seed++) {
      const cold = setupAt(seed, true);
      run(cold.state, cold.env, cold.actField, cold.bioField, HAZARD_PARAMS, cold.rng, cold.bus, 300);
      coldEdges += cold.state.edges.length;

      const warm = setupAt(seed, false);
      run(warm.state, warm.env, warm.actField, warm.bioField, HAZARD_PARAMS, warm.rng, warm.bus, 300);
      warmEdges += warm.state.edges.length;
    }
    expect(coldEdges).toBeLessThan(warmEdges);
  });

  it('毒素の中にあるネットワークは、同じ条件のネットワークより activity が低く保たれる', () => {
    function setupAt(seed: number, toxic: boolean) {
      const rng = createRNG(seed);
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 64 });
      env.placeFood({ x: 50, y: 20 }, 8, 1.2);
      if (toxic) env.placeToxin({ x: 50, y: 50 }, 15, 0.8);
      const actField = new ActivityField(100, 64);
      const bioField = new BiomassField(100, 64);
      const state = createInitialState(seed, 100);
      seedSource(state, { x: 50, y: 50 });
      const bus = new EventBus();
      return { state, env, actField, bioField, rng, bus };
    }
    function avgActivity(state: ReturnType<typeof setupAt>['state']): number {
      if (state.edges.length === 0) return 0;
      return state.edges.reduce((s, e) => s + e.activity, 0) / state.edges.length;
    }
    let toxicActivitySum = 0, cleanActivitySum = 0;
    for (let seed = 0; seed < 5; seed++) {
      const toxic = setupAt(seed, true);
      run(toxic.state, toxic.env, toxic.actField, toxic.bioField, DEFAULT_PARAMS, toxic.rng, toxic.bus, 60);
      toxicActivitySum += avgActivity(toxic.state);

      const clean = setupAt(seed, false);
      run(clean.state, clean.env, clean.actField, clean.bioField, DEFAULT_PARAMS, clean.rng, clean.bus, 60);
      cleanActivitySum += avgActivity(clean.state);
    }
    expect(toxicActivitySum).toBeLessThan(cleanActivitySum);
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
