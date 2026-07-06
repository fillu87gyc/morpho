import { describe, it, expect } from 'vitest';
import { computeRegenAmount, REGEN_START_DAY, REGEN_SEASON_PERIOD_DAYS } from '../src/nutrient-regen.js';

describe('computeRegenAmount', () => {
  it('REGEN_START_DAY より前は常に 0 (初期栄養を乱さない)', () => {
    expect(computeRegenAmount(0, 1.0, 0.5)).toBe(0);
    expect(computeRegenAmount(REGEN_START_DAY - 1, 1.0, 0.5)).toBe(0);
  });

  it('REGEN_START_DAY 以降は正の量になりうる', () => {
    expect(computeRegenAmount(REGEN_START_DAY, 1.0, 0.5)).toBeGreaterThan(0);
  });

  it('season は周期的に満ち欠けし、量は元の amount に比例する', () => {
    // season の谷 (sin=-1) では amount 0 に近い最小値になる。
    const troughDay = REGEN_START_DAY + REGEN_SEASON_PERIOD_DAYS * 0.75; // sin(-π/2)=-1
    const peakDay = REGEN_START_DAY + REGEN_SEASON_PERIOD_DAYS * 0.25; // sin(π/2)=1
    const trough = computeRegenAmount(troughDay, 1.0, 0.5);
    const peak = computeRegenAmount(peakDay, 1.0, 0.5);
    expect(peak).toBeGreaterThan(trough);
    expect(trough).toBeCloseTo(0, 5);
  });

  it('moisture が高いほど再生量が増える', () => {
    const day = REGEN_START_DAY + REGEN_SEASON_PERIOD_DAYS * 0.25; // season ピーク付近
    const dry = computeRegenAmount(day, 1.0, 0.0);
    const wet = computeRegenAmount(day, 1.0, 1.0);
    expect(wet).toBeGreaterThan(dry);
  });

  it('baseAmount に比例してスケールする', () => {
    const day = REGEN_START_DAY + REGEN_SEASON_PERIOD_DAYS * 0.25;
    const a = computeRegenAmount(day, 1.0, 0.5);
    const b = computeRegenAmount(day, 2.0, 0.5);
    expect(b).toBeCloseTo(a * 2, 6);
  });

  it('常に非負', () => {
    for (let d = 0; d < 60; d++) {
      expect(computeRegenAmount(d, 1.0, 0.5)).toBeGreaterThanOrEqual(0);
    }
  });
});
