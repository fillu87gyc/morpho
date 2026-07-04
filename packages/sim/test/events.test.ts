import { describe, it, expect } from 'vitest';
import {
  createInitialState, seedSource, createRNG, GridEnvironment, clearAroundSource,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, run,
} from '../src/index.js';

// M12: 「障害物を迂回」「胞子を生成」イベントの語彙充実。
describe('M12: 出来事の語彙充実', () => {
  it('障害物が点在する土地では ObstacleAvoided が発火しうる', () => {
    let seenAvoided = false;
    for (let seed = 0; seed < 8 && !seenAvoided; seed++) {
      const rng = createRNG(seed);
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 64 });
      env.placeFood({ x: 50, y: 85 }, 8, 1.2);
      // source の周囲を障害物で囲み気味にして、迂回が起きやすくする。
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        env.placeStone({ x: 50 + Math.cos(a) * 12, y: 50 + Math.sin(a) * 12 }, 3);
      }
      const actField = new ActivityField(100, 64);
      const bioField = new BiomassField(100, 64);
      const state = createInitialState(seed, 100);
      clearAroundSource(env, { x: 50, y: 50 }, 4);
      seedSource(state, { x: 50, y: 50 }, 6);
      const bus = new EventBus();
      run(state, env, actField, bioField, DEFAULT_PARAMS, rng, bus, 500);
      if (bus.peek().some((e) => e.type === 'ObstacleAvoided')) seenAvoided = true;
    }
    expect(seenAvoided).toBe(true);
  });

  it('十分に育つと SporeFormed (横方向出芽) が発火する', () => {
    let seenSpore = false;
    for (let seed = 0; seed < 8 && !seenSpore; seed++) {
      const rng = createRNG(seed);
      const env = new GridEnvironment({ worldSize: 100, fieldSize: 64 });
      env.placeFood({ x: 30, y: 30 }, 6, 1.0);
      env.placeFood({ x: 70, y: 70 }, 6, 1.0);
      const actField = new ActivityField(100, 64);
      const bioField = new BiomassField(100, 64);
      const state = createInitialState(seed, 100);
      seedSource(state, { x: 50, y: 30 });
      const bus = new EventBus();
      run(state, env, actField, bioField, DEFAULT_PARAMS, rng, bus, 400);
      if (bus.peek().some((e) => e.type === 'SporeFormed')) seenSpore = true;
    }
    expect(seenSpore).toBe(true);
  });
});
