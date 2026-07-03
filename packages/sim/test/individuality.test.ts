import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, GridEnvironment,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, run,
  createGenome, createChildGenome, applyGenome, computeIndividuality, classifyIndividual,
} from '../src/index.js';

function setupRun(seed: number) {
  const rng = createRNG(seed);
  const env = new GridEnvironment({ worldSize: 100, fieldSize: 64 });
  env.placeFood({ x: 30, y: 30 }, 6, 1.0);
  env.placeFood({ x: 70, y: 70 }, 6, 1.0);
  const actField = new ActivityField(100, 64);
  const bioField = new BiomassField(100, 64);
  const state = createInitialState(seed, 100);
  seedSource(state, { x: 50, y: 30 });
  const bus = new EventBus();
  return { state, env, actField, bioField, rng, bus };
}

describe('genome', () => {
  it('同じ seed からは同じ genome が決定的に生成される', () => {
    const a = createGenome(createRNG(42));
    const b = createGenome(createRNG(42));
    expect(a).toEqual(b);
  });

  it('異なる seed からは異なる genome になる', () => {
    const a = createGenome(createRNG(1));
    const b = createGenome(createRNG(2));
    expect(a).not.toEqual(b);
  });

  it('各遺伝子は [0.6, 1.4] の範囲に収まる', () => {
    for (let seed = 0; seed < 20; seed++) {
      const g = createGenome(createRNG(seed));
      for (const v of Object.values(g)) {
        expect(v).toBeGreaterThanOrEqual(0.6);
        expect(v).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('applyGenome は base の該当パラメータを乗算で変化させ、他は変えない', () => {
    const genome = { mergeRadius: 1.2, branchProb: 0.8, nutrientPref: 1.1, moisturePref: 0.9, lightAvoidance: 1.0, growthVigor: 1.05 };
    const applied = applyGenome(DEFAULT_PARAMS, genome);
    expect(applied.mergeRadius).toBeCloseTo(DEFAULT_PARAMS.mergeRadius * 1.2);
    expect(applied.branchProbabilityBase).toBeCloseTo(DEFAULT_PARAMS.branchProbabilityBase * 0.8);
    expect(applied.growthStep).toBeCloseTo(DEFAULT_PARAMS.growthStep * 1.05);
    expect(applied.pruneRadius).toBe(DEFAULT_PARAMS.pruneRadius);
  });

  it('createChildGenome は同じ seed なら決定的に同じ子になる', () => {
    const parent = createGenome(createRNG(1));
    const a = createChildGenome(parent, createRNG(99));
    const b = createChildGenome(parent, createRNG(99));
    expect(a).toEqual(b);
  });

  it('createChildGenome の各遺伝子は [0.6, 1.4] の範囲に収まる', () => {
    const parent = createGenome(createRNG(1));
    for (let seed = 0; seed < 20; seed++) {
      const child = createChildGenome(parent, createRNG(seed));
      for (const v of Object.values(child)) {
        expect(v).toBeGreaterThanOrEqual(0.6);
        expect(v).toBeLessThanOrEqual(1.4);
      }
    }
  });

  it('mutationScale が小さいほど子は親に近くなる', () => {
    const parent = createGenome(createRNG(1));
    const distance = (g: typeof parent) => Object.keys(parent)
      .reduce((sum, k) => sum + Math.abs(g[k as keyof typeof g] - parent[k as keyof typeof parent]), 0);
    let closeSum = 0, farSum = 0;
    for (let seed = 0; seed < 30; seed++) {
      closeSum += distance(createChildGenome(parent, createRNG(seed), 0.05));
      farSum += distance(createChildGenome(parent, createRNG(seed), 1.0));
    }
    expect(closeSum).toBeLessThan(farSum);
  });

  it('mutationScale 0 なら子は親と完全に一致する', () => {
    const parent = createGenome(createRNG(3));
    const child = createChildGenome(parent, createRNG(7), 0);
    expect(child).toEqual(parent);
  });
});

describe('individuality', () => {
  it('ノードがない状態では全軸 0', () => {
    const state = createInitialState(1, 100);
    const ind = computeIndividuality(state);
    expect(ind).toEqual({ exploration: 0, efficiency: 0, stability: 0, health: 0, vitality: 0, adaptability: 0 });
  });

  it('全軸が [0,1] に収まる', () => {
    const r = setupRun(9);
    run(r.state, r.env, r.actField, r.bioField, DEFAULT_PARAMS, r.rng, r.bus, 400);
    const ind = computeIndividuality(r.state);
    for (const v of Object.values(ind)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('育っていない初期状態はタイプを判定できる (エラーにならない)', () => {
    const r = setupRun(9);
    const ind = computeIndividuality(r.state);
    const info = classifyIndividual(ind);
    expect(['thick-connector', 'spreader', 'efficient', 'resilient', 'balanced']).toContain(info.id);
    expect(info.label.length).toBeGreaterThan(0);
  });

  it('突出した軸がなければバランス型になる', () => {
    const ind = { exploration: 0.5, efficiency: 0.5, stability: 0.5, health: 0.5, vitality: 0.5, adaptability: 0.5 };
    expect(classifyIndividual(ind).id).toBe('balanced');
  });

  it('安定性が突出していれば太くつなぐ型になる', () => {
    const ind = { exploration: 0.1, efficiency: 0.1, stability: 0.9, health: 0.2, vitality: 0.2, adaptability: 0.1 };
    expect(classifyIndividual(ind).id).toBe('thick-connector');
  });
});
