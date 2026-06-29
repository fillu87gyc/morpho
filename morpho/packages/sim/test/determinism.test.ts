import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, GridEnvironment,
  ActivityField, EventBus, DEFAULT_PARAMS, run, computeTraits,
} from '../src/index.js';

function setupRun(seed: number) {
  const rng = createRNG(seed);
  const env = new GridEnvironment({ worldSize: 100, fieldSize: 64 });
  env.placeFood({ x: 30, y: 30 }, 6, 1.0);
  env.placeFood({ x: 70, y: 70 }, 6, 1.0);
  env.placeStone({ x: 50, y: 50 }, 4);
  const actField = new ActivityField(100, 64);
  const state = createInitialState(seed, 100);
  seedSource(state, { x: 50, y: 30 });
  const bus = new EventBus();
  return { state, env, actField, rng, bus };
}

describe('determinism', () => {
  it('同じseedからは同じ最終状態が得られる', () => {
    const a = setupRun(42), b = setupRun(42);
    run(a.state, a.env, a.actField, DEFAULT_PARAMS, a.rng, a.bus, 100);
    run(b.state, b.env, b.actField, DEFAULT_PARAMS, b.rng, b.bus, 100);
    expect(a.state.nodes.length).toBe(b.state.nodes.length);
    for (let i = 0; i < a.state.nodes.length; i++) {
      expect(a.state.nodes[i]!.pos.x).toBe(b.state.nodes[i]!.pos.x);
    }
  });

  it('異なるseedからは異なる結果になる', () => {
    const a = setupRun(1), b = setupRun(2);
    run(a.state, a.env, a.actField, DEFAULT_PARAMS, a.rng, a.bus, 100);
    run(b.state, b.env, b.actField, DEFAULT_PARAMS, b.rng, b.bus, 100);
    expect(a.state.nodes.length === b.state.nodes.length && a.state.edges.length === b.state.edges.length).toBe(false);
  });
});

describe('basic growth', () => {
  it('200tick後に成長イベントが起きている', () => {
    const r = setupRun(7);
    run(r.state, r.env, r.actField, DEFAULT_PARAMS, r.rng, r.bus, 200);
    expect(r.bus.peek().filter(e => e.type === 'NewBranch').length).toBeGreaterThan(3);
  });

  it('食料があると ReachedFood イベントが出る', () => {
    const r = setupRun(7);
    run(r.state, r.env, r.actField, DEFAULT_PARAMS, r.rng, r.bus, 1500);
    expect(r.bus.peek().filter(e => e.type === 'ReachedFood').length).toBeGreaterThan(0);
  });

  it('Event が発火している', () => {
    const r = setupRun(13);
    run(r.state, r.env, r.actField, DEFAULT_PARAMS, r.rng, r.bus, 400);
    const types = new Set(r.bus.drain().map(e => e.type));
    expect(types.has('NewBranch')).toBe(true);
    expect(types.has('ReachedFood')).toBe(true);
  });

  it('traits が妥当な範囲', () => {
    const r = setupRun(99);
    run(r.state, r.env, r.actField, DEFAULT_PARAMS, r.rng, r.bus, 400);
    const t = computeTraits(r.state);
    expect(t.exploration).toBeGreaterThanOrEqual(0);
    expect(t.exploration).toBeLessThanOrEqual(1);
    expect(t.stability).toBeGreaterThanOrEqual(0);
    expect(t.stability).toBeLessThanOrEqual(1);
  });
});
