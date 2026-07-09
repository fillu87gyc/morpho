import { describe, it, expect } from 'vitest';
import {
  Camera, fitBBoxSpan, bboxCenter, approachSpan, wildlandMinZoom,
  OVERVIEW_FIT_PADDING, OVERVIEW_MAX_SPAN, type BBox,
} from '../src/camera.js';

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

// M26: 俯瞰カメラの自動上昇の下敷き (bbox フィットの純粋関数群)。
describe('fitBBoxSpan / bboxCenter / approachSpan', () => {
  function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
    return { minX, minY, maxX, maxY };
  }

  it('正方形の bbox は padding 倍の span になる', () => {
    expect(fitBBoxSpan(bbox(0, 0, 10, 10), 1.3, 0)).toBeCloseTo(13);
  });

  it('横長/縦長の bbox は長い辺に合わせる (正方形ビューポートなので)', () => {
    expect(fitBBoxSpan(bbox(0, 0, 20, 5), 1.0, 0)).toBeCloseTo(20);
    expect(fitBBoxSpan(bbox(0, 0, 5, 20), 1.0, 0)).toBeCloseTo(20);
  });

  it('bbox が退化 (点) していても minSpan を下回らない', () => {
    expect(fitBBoxSpan(bbox(5, 5, 5, 5), 1.3, 10)).toBe(10);
  });

  it('bboxCenter は中心点を返す', () => {
    expect(bboxCenter(bbox(0, 0, 10, 20))).toEqual({ x: 5, y: 10 });
    expect(bboxCenter(bbox(-10, -10, 10, 10))).toEqual({ x: 0, y: 0 });
  });

  it('approachSpan は目標へ徐々に近づき、繰り返すとほぼ一致する', () => {
    let span = 10;
    for (let i = 0; i < 50; i++) span = approachSpan(span, 100, 0.2);
    expect(span).toBeCloseTo(100, 0);
  });

  it('approachSpan は t=0 のとき変化しない、t=1 のとき即座に到達する', () => {
    expect(approachSpan(10, 50, 0)).toBe(10);
    expect(approachSpan(10, 50, 1)).toBe(50);
  });
});

// M28: 「原野」の動的な最小ズーム (fitBBoxSpan の実戦投入) と、
// setWildlandBounds による zoom < 1 の俯瞰 + 窓の外へのパン。
describe('wildlandMinZoom / Camera.setWildlandBounds (M28)', () => {
  function bbox(minX: number, minY: number, maxX: number, maxY: number): BBox {
    return { minX, minY, maxX, maxY };
  }

  it('bbox が null (有界ステージ/俯瞰未着) なら最小ズームは 1 のまま', () => {
    expect(wildlandMinZoom(null, 100)).toBe(1);
  });

  it('bbox が窓より小さいうちは 1 (1 を超えない = ズームインを強制しない)', () => {
    expect(wildlandMinZoom(bbox(0, 0, 50, 50), 100)).toBe(1);
  });

  it('世界が広がるほど最小ズームが下がる (bbox + 余白がちょうど収まる)', () => {
    // bbox 一辺 400 → span = 400 × 1.3 = 520 → minZoom = 100/520
    const z = wildlandMinZoom(bbox(-150, -150, 250, 250), 100);
    expect(z).toBeCloseTo(100 / (400 * OVERVIEW_FIT_PADDING));
    // さらに広い bbox ではさらに低い
    expect(wildlandMinZoom(bbox(-500, -500, 600, 600), 100)).toBeLessThan(z);
  });

  it('安全弁: bbox が巨大でも span は OVERVIEW_MAX_SPAN まで (minZoom に下限がある)', () => {
    const z = wildlandMinZoom(bbox(-1e6, -1e6, 1e6, 1e6), 100);
    expect(z).toBeCloseTo(100 / OVERVIEW_MAX_SPAN);
  });

  it('setWildlandBounds すると zoom < 1 に引ける (原野の俯瞰)', () => {
    const cam = new Camera(100);
    cam.setWildlandBounds(bbox(-150, -150, 250, 250));
    cam.zoomAt(200, 100, 100, 0.01); // 目一杯ズームアウト
    expect(cam.zoom).toBeLessThan(1);
    expect(cam.zoom).toBeCloseTo(cam.minimumZoom);
    const v = cam.view();
    expect(v.worldSpan).toBeGreaterThan(100); // 窓 (100) より広い範囲が映る
  });

  it('setWildlandBounds しない限り (=有界6ステージ) 従来の [1, 8] のまま', () => {
    const cam = new Camera(100);
    cam.zoomAt(200, 100, 100, 0.01);
    expect(cam.zoom).toBe(1);
    cam.setWildlandBounds(null);
    cam.zoomAt(200, 100, 100, 0.01);
    expect(cam.zoom).toBe(1);
  });

  it('zoom < 1 のとき中心を訪問済み bbox の中まで動かせる (窓の外へのパン)', () => {
    const cam = new Camera(100);
    const b = bbox(-300, -300, 400, 400);
    cam.setWildlandBounds(b);
    cam.zoomAt(200, 100, 100, 0.01);
    // 左上方向へ大きくパン → 従来なら中央固定に戻されるが、bbox 内なら通る。
    for (let i = 0; i < 50; i++) cam.pan(200, 1000, 1000);
    const v = cam.view();
    const cx = v.worldLeft + v.worldSpan / 2;
    const cy = v.worldTop + v.worldSpan / 2;
    expect(cx).toBeLessThan(0); // 窓 (0..100) の外
    expect(cx).toBeGreaterThanOrEqual(b.minX); // ただし bbox の中
    expect(cy).toBeGreaterThanOrEqual(b.minY);
  });

  it('zoom >= 1 のときの中心クランプは従来通り窓の中 (原野でも)', () => {
    const cam = new Camera(100);
    cam.setWildlandBounds(bbox(-300, -300, 400, 400));
    cam.zoomAt(200, 100, 100, 4);
    for (let i = 0; i < 50; i++) cam.pan(200, 1000, 1000);
    const v = cam.view();
    expect(v.worldLeft).toBeGreaterThanOrEqual(-1e-6);
    expect(v.worldTop).toBeGreaterThanOrEqual(-1e-6);
  });

  it('reset で最小ズームと bbox が既定に戻る (ステージ切替の後始末)', () => {
    const cam = new Camera(100);
    cam.setWildlandBounds(bbox(-300, -300, 400, 400));
    cam.zoomAt(200, 100, 100, 0.01);
    expect(cam.zoom).toBeLessThan(1);
    cam.reset();
    expect(cam.zoom).toBe(1);
    expect(cam.minimumZoom).toBe(1);
    cam.zoomAt(200, 100, 100, 0.01);
    expect(cam.zoom).toBe(1);
  });

  it('bbox が縮んで最小ズームが上がったら zoom も引き上げられる (安全側)', () => {
    const cam = new Camera(100);
    cam.setWildlandBounds(bbox(-300, -300, 400, 400));
    cam.zoomAt(200, 100, 100, 0.01);
    expect(cam.zoom).toBeLessThan(1);
    cam.setWildlandBounds(null); // 俯瞰素材が消えた (リセット直後など)
    expect(cam.zoom).toBe(1);
  });
});
