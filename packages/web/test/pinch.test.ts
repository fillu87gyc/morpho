import { describe, expect, it } from 'vitest';
import { PinchTracker } from '../src/pinch.js';

describe('PinchTracker', () => {
  it('2点が離れていくと factor > 1 になる (ズームイン)', () => {
    const tracker = new PinchTracker({ x: 40, y: 50 }, { x: 60, y: 50 });
    const d = tracker.update({ x: 20, y: 50 }, { x: 80, y: 50 });
    expect(d.factor).toBeGreaterThan(1);
    expect(d.factor).toBeCloseTo(3, 5); // 距離 20 → 60
  });

  it('2点が近づくと factor < 1 になる (ズームアウト)', () => {
    const tracker = new PinchTracker({ x: 0, y: 0 }, { x: 100, y: 0 });
    const d = tracker.update({ x: 20, y: 0 }, { x: 80, y: 0 });
    expect(d.factor).toBeLessThan(1);
    expect(d.factor).toBeCloseTo(0.6, 5); // 距離 100 → 60
  });

  it('中点を返し、平行移動 (パン) を dx/dy として検出する', () => {
    const tracker = new PinchTracker({ x: 0, y: 0 }, { x: 20, y: 0 });
    const d = tracker.update({ x: 30, y: 10 }, { x: 50, y: 10 });
    // 距離は変わらず (factor ≈ 1) 、中点だけ (10,0) → (40,10) へ移動
    expect(d.factor).toBeCloseTo(1, 5);
    expect(d.midpoint).toEqual({ x: 40, y: 10 });
    expect(d.dx).toBeCloseTo(30, 5);
    expect(d.dy).toBeCloseTo(10, 5);
  });

  it('update を連続で呼ぶと前回の状態を基準に差分を返す', () => {
    const tracker = new PinchTracker({ x: 0, y: 0 }, { x: 10, y: 0 });
    const first = tracker.update({ x: 0, y: 0 }, { x: 20, y: 0 }); // 距離 10 → 20
    expect(first.factor).toBeCloseTo(2, 5);
    const second = tracker.update({ x: 0, y: 0 }, { x: 40, y: 0 }); // 距離 20 → 40
    expect(second.factor).toBeCloseTo(2, 5);
  });
});
