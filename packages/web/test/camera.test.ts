import { describe, it, expect } from 'vitest';
import { Camera } from '../src/camera.js';

describe('Camera', () => {
  it('初期状態はズーム1倍でワールド全体を映す', () => {
    const cam = new Camera(100);
    const v = cam.view();
    expect(cam.zoom).toBe(1);
    expect(v).toEqual({ worldLeft: 0, worldTop: 0, worldSpan: 100 });
  });

  it('screenToWorld はズーム1倍のとき画面座標をそのままワールド座標に写す', () => {
    const cam = new Camera(100);
    const p = cam.screenToWorld(200, 100, 50);
    // canvasSize=200 に world 100 が写るので scale=2。sx=100 → world 50、sy=50 → world 25。
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(25);
  });

  it('zoomAt はカーソル位置の下にあるワールド座標を固定したままズームする', () => {
    const cam = new Camera(100);
    const canvasSize = 200;
    const cursor = { sx: 60, sy: 60 };
    const before = cam.screenToWorld(canvasSize, cursor.sx, cursor.sy);

    cam.zoomAt(canvasSize, cursor.sx, cursor.sy, 2);
    const after = cam.screenToWorld(canvasSize, cursor.sx, cursor.sy);

    expect(cam.zoom).toBeCloseTo(2);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });

  it('ズームは [1, 8] の範囲にクランプされる', () => {
    const cam = new Camera(100);
    cam.zoomAt(200, 100, 100, 0.1); // ズームアウトしすぎようとする
    expect(cam.zoom).toBe(1);

    cam.zoomAt(200, 100, 100, 1000); // ズームインしすぎようとする
    expect(cam.zoom).toBeLessThanOrEqual(8);
  });

  it('pan は中心をワールド境界内にクランプする', () => {
    const cam = new Camera(100);
    cam.zoomAt(200, 100, 100, 8); // 最大ズームまで寄せる
    // 大きく右下にパンしようとしても、境界の外には出られない。
    for (let i = 0; i < 50; i++) cam.pan(200, -1000, -1000);
    const v = cam.view();
    expect(v.worldLeft + v.worldSpan).toBeLessThanOrEqual(100 + 1e-6);
    expect(v.worldTop + v.worldSpan).toBeLessThanOrEqual(100 + 1e-6);
  });

  it('ズームアウトして世界全体より広い視野になると中央固定に戻る', () => {
    const cam = new Camera(100);
    cam.zoomAt(200, 100, 100, 4);
    cam.pan(200, 500, 500);
    cam.zoomAt(200, 100, 100, 0.01); // 1倍までクランプされる
    const v = cam.view();
    expect(v.worldLeft).toBeCloseTo(0);
    expect(v.worldTop).toBeCloseTo(0);
  });

  it('M6: focusOn は指定座標を中心に指定ズームへ切り替える (個体ビュー)', () => {
    const cam = new Camera(100);
    cam.focusOn({ x: 30, y: 30 }, 5);
    expect(cam.zoom).toBe(5);
    const v = cam.view();
    expect(v.worldSpan).toBeCloseTo(20);
    expect(v.worldLeft).toBeCloseTo(20);
    expect(v.worldTop).toBeCloseTo(20);
  });

  it('M6: focusOn のズームも [1, 8] にクランプされる', () => {
    const cam = new Camera(100);
    cam.focusOn({ x: 50, y: 50 }, 100);
    expect(cam.zoom).toBeLessThanOrEqual(8);
  });

  it('M12: panToward はズームを変えず target へ徐々に寄せる (個体追跡)', () => {
    const cam = new Camera(100);
    cam.focusOn({ x: 20, y: 20 }, 4);
    const zoomBefore = cam.zoom;
    cam.panToward({ x: 80, y: 80 }, 0.5);
    expect(cam.zoom).toBe(zoomBefore);
    const v = cam.view();
    const centerX = v.worldLeft + v.worldSpan / 2;
    // (20 → 80) の中間点あたりまで寄る
    expect(centerX).toBeGreaterThan(20);
    expect(centerX).toBeLessThan(80);
  });

  it('M12: panToward を繰り返すと target にほぼ収束する', () => {
    const cam = new Camera(100);
    cam.focusOn({ x: 10, y: 10 }, 4);
    for (let i = 0; i < 100; i++) cam.panToward({ x: 60, y: 60 }, 0.2);
    const v = cam.view();
    const centerX = v.worldLeft + v.worldSpan / 2;
    const centerY = v.worldTop + v.worldSpan / 2;
    expect(centerX).toBeCloseTo(60, 0);
    expect(centerY).toBeCloseTo(60, 0);
  });

  it('reset はズームと中心を初期状態に戻す', () => {
    const cam = new Camera(100);
    cam.zoomAt(200, 100, 100, 4);
    cam.pan(200, 30, 30);
    cam.reset();
    expect(cam.zoom).toBe(1);
    expect(cam.view()).toEqual({ worldLeft: 0, worldTop: 0, worldSpan: 100 });
  });
});
