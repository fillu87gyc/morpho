// 画面のどこを見せるか (ズーム / パン) だけを持つカメラ。
// sim のワールド座標系 (0..worldSize) には一切書き込まない — 読み取り専用の
// 「ビューポート」でしかない。render.ts はこの view() を渡されて描画するだけ。

export interface WorldView {
  worldLeft: number;
  worldTop: number;
  worldSpan: number; // 正方形ビューポートに映る世界の一辺の長さ
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

export class Camera {
  zoom = MIN_ZOOM;
  private cx: number;
  private cy: number;

  constructor(private worldSize: number) {
    this.cx = worldSize / 2;
    this.cy = worldSize / 2;
  }

  reset(): void {
    this.zoom = MIN_ZOOM;
    this.cx = this.worldSize / 2;
    this.cy = this.worldSize / 2;
  }

  view(): WorldView {
    const span = this.worldSize / this.zoom;
    return { worldLeft: this.cx - span / 2, worldTop: this.cy - span / 2, worldSpan: span };
  }

  // canvasSize: 正方形ビューポートの CSS px 辺長。sx, sy はその内側の px 座標。
  screenToWorld(canvasSize: number, sx: number, sy: number): { x: number; y: number } {
    const v = this.view();
    const scale = canvasSize / v.worldSpan;
    return { x: v.worldLeft + sx / scale, y: v.worldTop + sy / scale };
  }

  // (sx, sy) の下にある世界座標を固定したままズームする (カーソル中心ズーム)。
  zoomAt(canvasSize: number, sx: number, sy: number, factor: number): void {
    const before = this.screenToWorld(canvasSize, sx, sy);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const after = this.screenToWorld(canvasSize, sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clampCenter();
  }

  pan(canvasSize: number, dxScreen: number, dyScreen: number): void {
    const v = this.view();
    const scale = canvasSize / v.worldSpan;
    this.cx -= dxScreen / scale;
    this.cy -= dyScreen / scale;
    this.clampCenter();
  }

  private clampCenter(): void {
    const span = this.worldSize / this.zoom;
    const half = span / 2;
    if (span >= this.worldSize) {
      // ズームアウトしきっている場合は世界全体が映るので中央固定。
      this.cx = this.worldSize / 2;
      this.cy = this.worldSize / 2;
      return;
    }
    this.cx = clamp(this.cx, half, this.worldSize - half);
    this.cy = clamp(this.cy, half, this.worldSize - half);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
