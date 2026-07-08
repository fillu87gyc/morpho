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

  // M16: ズームスライダー UI 用。カーソル位置に関係なく画面中央を基準に
  // 目標ズーム値へ直接設定する (ホイール/ピンチの zoomAt はカーソル中心の
  // 相対倍率だが、スライダーは絶対値を扱うため別の入口を用意する)。
  setZoomCentered(canvasSize: number, targetZoom: number): void {
    const factor = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM) / this.zoom;
    this.zoomAt(canvasSize, canvasSize / 2, canvasSize / 2, factor);
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

  // M6: 「個体ビュー」への切り替え。指定したワールド座標 (コロニーの位置など)
  // を中心にズームインする (ミニマップのクリックから呼ぶ想定)。
  focusOn(pos: { x: number; y: number }, zoom = 5): void {
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.cx = pos.x;
    this.cy = pos.y;
    this.clampCenter();
  }

  // M12: 「個体を追跡する」。ズームは変えず、target へ毎フレーム t (0..1) ぶん
  // だけ滑らかに寄せる (t が小さいほどゆっくり追従する)。
  panToward(target: { x: number; y: number }, t: number): void {
    this.cx += (target.x - this.cx) * t;
    this.cy += (target.y - this.cy) * t;
    this.clampCenter();
  }

  pan(canvasSize: number, dxScreen: number, dyScreen: number): void {
    const v = this.view();
    const scale = canvasSize / v.worldSpan;
    this.cx -= dxScreen / scale;
    this.cy -= dyScreen / scale;
    this.clampCenter();
  }

  // M25: 「原野」の窓 (ローカル座標系) が前線を追って再センタリングされた
  // とき、描画されている内容のローカル座標もその分だけ動く
  // (Game.consumeWindowShift() 参照)。カメラを同じ量だけ動かすことで、
  // 「窓が動いた」ことに気づかれず前線を追い続けているように見せる。
  shiftCenter(dx: number, dy: number): void {
    this.cx += dx;
    this.cy += dy;
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

// M26: 「俯瞰カメラの自動上昇」の下敷きになる純粋関数。
//
// 既存ステージ (worldSize=100 固定) では Camera.zoom は worldSize との比で
// [1,8] にクランプされており、UI のズームスライダーもこの範囲に直結して
// いる。半無限ワールド (M25 の ChunkedGridEnvironment、worldSize=100,000 相当)
// では bbox がワールド全体よりずっと小さい間はこの比だけでは意味のある
// ズーム値にならないため、「ワールド単位の絶対 span」で bbox フィットを
// 計算する形で先に切り出す。実際に Camera へ組み込む (zoom 概念そのものを
// span 基準に置き換えるか、専用モードを足すか) のは、無限世界ステージが
// 配線されてから判断する (ROADMAP.md M26 参照)。
export interface BBox { minX: number; minY: number; maxX: number; maxY: number; }

// bbox (+ padding 分の余白) がちょうど収まる正方形ビューポートの一辺の
// 長さ (ワールド単位)。bbox が退化 (点・線) していても minSpan を下回らない。
export function fitBBoxSpan(bbox: BBox, padding = 1.3, minSpan = 10): number {
  const w = Math.max(0, bbox.maxX - bbox.minX) * padding;
  const h = Math.max(0, bbox.maxY - bbox.minY) * padding;
  return Math.max(minSpan, w, h);
}

export function bboxCenter(bbox: BBox): { x: number; y: number } {
  return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
}

// 現在の span から目標 span へ、t (0..1、大きいほど速く) だけ指数的に近づける
// (カメラの急なジャンプを避ける減衰追従。panToward と同じ考え方)。
export function approachSpan(currentSpan: number, targetSpan: number, t: number): number {
  return currentSpan + (targetSpan - currentSpan) * t;
}
