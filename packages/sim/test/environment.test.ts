import { describe, it, expect } from 'vitest';
import { GridEnvironment } from '../src/index.js';

describe('GridEnvironment.decay', () => {
  it('栄養は放置すると 0 へ向けて減っていく', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32 });
    env.placeFood({ x: 50, y: 50 }, 6, 1.0);
    const before = env.nutrients.data.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 50; i++) env.decay(0.01, 0.01);
    const after = env.nutrients.data.reduce((a, b) => a + b, 0);
    expect(after).toBeLessThan(before);
    expect(after).toBeGreaterThanOrEqual(0);
  });

  it('水分は baseMoisture へ緩和していく', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseMoisture: 0.2 });
    env.placeWater({ x: 50, y: 50 }, 6, 0.6);
    const idx = 16 * 32 + 16;
    const before = env.moisture.data[idx] ?? 0;
    expect(before).toBeGreaterThan(env.baseMoisture);
    for (let i = 0; i < 500; i++) env.decay(0, 0.02);
    const after = env.moisture.data[idx] ?? 0;
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(env.baseMoisture, 1);
  });

  it('乾いた土地 (低 baseMoisture) は放置した水分がより早く元へ戻る', () => {
    const wet = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseMoisture: 0.5 });
    const dry = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseMoisture: 0.1 });
    wet.placeWater({ x: 50, y: 50 }, 6, 0.4);
    dry.placeWater({ x: 50, y: 50 }, 6, 0.4);
    const idx = 16 * 32 + 16;
    for (let i = 0; i < 30; i++) { wet.decay(0, 0.02); dry.decay(0, 0.02); }
    const wetLevel = wet.moisture.data[idx] ?? 0;
    const dryLevel = dry.moisture.data[idx] ?? 0;
    expect(dryLevel).toBeLessThan(wetLevel);
  });
});
