// 複数レイヤの Float32Array (biomass / nutrients / moisture / ...) を
// フレームごとに比較し、「前回実際に塗った値」からの差分が閾値を超えた
// セルだけを検出する。DOM/Canvas に一切依存しない純粋なロジックなので、
// render.ts の描画コードとは切り離してユニットテストできる。
//
// 重要な不変条件: 基準値 (baseline) は「直前フレームの生値」ではなく
// 「最後に実際に塗った値」で更新する。そうしないと、毎フレーム閾値未満の
// 緩やかな変化 (例: biomass の指数減衰) が無限に見逃され続け、
// 実際の値からどんどん乖離した色が表示され続けてしまう。

export interface DirtyRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class MultiLayerDirtyTracker {
  private prev: Float32Array[] | null = null;

  constructor(private size: number, private layerCount: number, private eps: number) {}

  get initialized(): boolean {
    return this.prev !== null;
  }

  // layers: 現在フレームの各レイヤ (要素数は size*size)。
  // force: 呼び出し側の事情 (正規化基準の変化など) で全面再計算したいとき true。
  // onDirty: 塗り直すべきセルごとに呼ばれる (i = 行優先インデックス)。
  // 戻り値: 何か1つでも塗り直したセルがあればその外接矩形 (両端含む)、
  //         何も変わらなければ null。
  update(
    layers: Float32Array[],
    force: boolean,
    onDirty: (i: number, x: number, y: number) => void,
  ): DirtyRect | null {
    const s = this.size;
    const n = s * s;
    if (!this.prev) {
      this.prev = layers.map(() => new Float32Array(n));
      force = true;
    }
    const prev = this.prev;
    const eps = this.eps;

    let x0 = s, y0 = s, x1 = -1, y1 = -1;

    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = y * s + x;

        if (!force) {
          let changed = false;
          for (let l = 0; l < this.layerCount; l++) {
            const cur = layers[l]![i] ?? 0;
            const pv = prev[l]![i] ?? 0;
            if (Math.abs(cur - pv) > eps) { changed = true; break; }
          }
          if (!changed) continue;
        }

        for (let l = 0; l < this.layerCount; l++) {
          prev[l]![i] = layers[l]![i] ?? 0;
        }

        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;

        onDirty(i, x, y);
      }
    }

    return x1 >= x0 ? { x0, y0, x1, y1 } : null;
  }
}
