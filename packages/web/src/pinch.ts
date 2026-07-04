// 2本指ピンチのジェスチャー追跡。DOM の PointerEvent 座標だけを受け取り、
// フレームごとの「ズーム倍率」と「中点の移動量 (パンに使う)」を導出する
// 純粋なステートマシン。main.ts はこれを pointermove から呼ぶだけ。

export interface Point {
  x: number;
  y: number;
}

export interface PinchDelta {
  factor: number; // 前回からの追加ズーム倍率 (1 = 変化なし)
  midpoint: Point; // 現在の2点の中点 (ズームの中心に使う)
  dx: number; // 中点の移動量 (パンに使う)
  dy: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export class PinchTracker {
  private prevDist: number;
  private prevMid: Point;

  constructor(a: Point, b: Point) {
    this.prevDist = distance(a, b);
    this.prevMid = midpoint(a, b);
  }

  update(a: Point, b: Point): PinchDelta {
    const dist = distance(a, b);
    const mid = midpoint(a, b);
    const factor = this.prevDist > 0 ? dist / this.prevDist : 1;
    const delta: PinchDelta = {
      factor,
      midpoint: mid,
      dx: mid.x - this.prevMid.x,
      dy: mid.y - this.prevMid.y,
    };
    this.prevDist = dist;
    this.prevMid = mid;
    return delta;
  }
}
