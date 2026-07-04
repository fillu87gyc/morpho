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

  // M10: 温度・毒素フィールド。
  it('placeHeat は正の delta で温度を上げ、負の delta で下げる (上げ下げ両対応)', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseTemperature: 0.5 });
    const idx = 16 * 32 + 16;
    env.placeHeat({ x: 50, y: 50 }, 6, 0.3);
    expect(env.temperature.data[idx]).toBeGreaterThan(0.5);
    const cool = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseTemperature: 0.5 });
    cool.placeHeat({ x: 50, y: 50 }, 6, -0.3);
    expect(cool.temperature.data[idx]).toBeLessThan(0.5);
  });

  it('温度は baseTemperature へ、毒素は 0 へじわじわ戻る', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseTemperature: 0.5 });
    env.placeHeat({ x: 50, y: 50 }, 6, 0.4);
    env.placeToxin({ x: 50, y: 50 }, 6, 0.6);
    const idx = 16 * 32 + 16;
    const tempBefore = env.temperature.data[idx] ?? 0;
    const toxinBefore = env.toxin.data[idx] ?? 0;
    for (let i = 0; i < 200; i++) env.decay(0, 0, 0.02, 0.02);
    expect(env.temperature.data[idx]).toBeLessThan(tempBefore);
    expect(env.temperature.data[idx]).toBeCloseTo(env.baseTemperature, 1);
    expect(env.toxin.data[idx]).toBeLessThan(toxinBefore);
    expect(env.toxin.data[idx]).toBeCloseTo(0, 1);
  });

  it('tempRelaxRate/toxinDecayRate を省略すると温度・毒素は変化しない (後方互換)', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseTemperature: 0.5 });
    env.placeHeat({ x: 50, y: 50 }, 6, 0.4);
    env.placeToxin({ x: 50, y: 50 }, 6, 0.6);
    const idx = 16 * 32 + 16;
    const tempBefore = env.temperature.data[idx];
    const toxinBefore = env.toxin.data[idx];
    for (let i = 0; i < 10; i++) env.decay(0.01, 0.01);
    expect(env.temperature.data[idx]).toBe(tempBefore);
    expect(env.toxin.data[idx]).toBe(toxinBefore);
  });

  it('placeDrain は placeWater の負量版として湿度を押し下げる', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseMoisture: 0.3 });
    const idx = 16 * 32 + 16;
    const before = env.moisture.data[idx] ?? 0;
    env.placeDrain({ x: 50, y: 50 }, 6, 0.2);
    expect(env.moisture.data[idx]).toBeLessThan(before);
  });

  it('placeWaterBody は water を立てつつ obstacle にも同じ形を重ねて通行不能にする (M14)', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseMoisture: 0.2 });
    const idx = 16 * 32 + 16;
    env.placeWaterBody({ x: 50, y: 50 }, 5);
    expect(env.water.data[idx]).toBeGreaterThan(0.5);
    expect(env.obstacle.data[idx]).toBeGreaterThan(0.5);
  });

  it('placeWaterBody は周囲の湿度も底上げする (M14)', () => {
    const env = new GridEnvironment({ worldSize: 100, fieldSize: 32, baseMoisture: 0.2 });
    const idx = 16 * 32 + 16;
    const before = env.moisture.data[idx] ?? 0;
    env.placeWaterBody({ x: 50, y: 50 }, 5);
    expect(env.moisture.data[idx]).toBeGreaterThan(before);
  });
});
