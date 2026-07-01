// 2D スカラー場の低レイヤ表現。
// 上位レイヤ (Environment, ScalarField) はこの上に乗る。
// データは Float32Array に row-major で詰める: idx = y * size + x。

import type { Vec2 } from '../types.js';

export interface FieldGrid {
  size: number;
  data: Float32Array;
}

export function makeField(size: number, fill = 0): FieldGrid {
  return { size, data: new Float32Array(size * size).fill(fill) };
}

// バイリニア補間。範囲外は最近セルの値にクランプする。
export function sampleField(field: FieldGrid, x: number, y: number): number {
  const s = field.size;
  if (x < 0 || y < 0 || x >= s - 1 || y >= s - 1) {
    const cx = Math.max(0, Math.min(s - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(s - 1, Math.floor(y)));
    return field.data[cy * s + cx] ?? 0;
  }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i00 = y0 * s + x0;
  const v00 = field.data[i00] ?? 0;
  const v10 = field.data[i00 + 1] ?? 0;
  const v01 = field.data[i00 + s] ?? 0;
  const v11 = field.data[i00 + s + 1] ?? 0;
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

// 中心差分で勾配を取る。栄養勾配などの「向き」が欲しい場面で使う。
export function gradientField(field: FieldGrid, x: number, y: number): Vec2 {
  const h = 1.0;
  return {
    x: (sampleField(field, x + h, y) - sampleField(field, x - h, y)) / (2 * h),
    y: (sampleField(field, x, y + h) - sampleField(field, x, y - h)) / (2 * h),
  };
}

// ガウスをスタンプする。食料・水・光のように「点状の resource」を置く時に使う。
export function stampGaussian(field: FieldGrid, cx: number, cy: number, radius: number, amount: number): void {
  const s = field.size;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius * 2));
  const x1 = Math.min(s - 1, Math.ceil(cx + radius * 2));
  const y0 = Math.max(0, Math.floor(cy - radius * 2));
  const y1 = Math.min(s - 1, Math.ceil(cy + radius * 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * r2));
      const idx = y * s + x;
      field.data[idx] = (field.data[idx] ?? 0) + amount * w;
    }
  }
}

// ハードエッジで 1.0 を塗る。障害物用。
export function stampObstacle(field: FieldGrid, cx: number, cy: number, radius: number): void {
  const s = field.size;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(s - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(s - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) field.data[y * s + x] = 1.0;
    }
  }
}
