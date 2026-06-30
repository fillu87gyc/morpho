// 拡散するスカラー場の共通基底。ActivityField と BiomassField の
// 「点 deposit + 5点ステンシル拡散 + 減衰」が同じ形なので括り出した。
// ダブルバッファ (field / buffer) を持ち、diffuse 後にスワップする。

import type { Vec2 } from '../types.js';
import { makeField, sampleField, gradientField, type FieldGrid } from './grid.js';

export interface ScalarFieldOptions {
  // deposit でセル値が超えてはいけない上限。Activity と Biomass で値が違うため。
  depositCap: number;
}

export class ScalarField {
  worldSize: number;
  fieldSize: number;
  field: FieldGrid;
  protected buffer: FieldGrid;
  protected readonly depositCap: number;

  constructor(worldSize: number, fieldSize: number, options: ScalarFieldOptions) {
    this.worldSize = worldSize;
    this.fieldSize = fieldSize;
    this.field = makeField(fieldSize);
    this.buffer = makeField(fieldSize);
    this.depositCap = options.depositCap;
  }

  // ワールド座標 → 場座標の係数。サブクラスからも頻繁に使う。
  protected get scale(): number { return this.fieldSize / this.worldSize; }

  sample(pos: Vec2): number {
    return sampleField(this.field, pos.x * this.scale, pos.y * this.scale);
  }

  gradient(pos: Vec2): Vec2 {
    return gradientField(this.field, pos.x * this.scale, pos.y * this.scale);
  }

  // 円盤状に滲ませる: 中心が濃く、縁にかけて線形に薄くなる雲。
  deposit(pos: Vec2, amount: number, radius: number): void {
    this.stampDisk(pos.x * this.scale, pos.y * this.scale, radius, amount);
  }

  // 5点ステンシル: dst[i] = c*(1-decay-diff) + (l+r+u+d)/4 * diff
  // 範囲外は自セルにフォールバックする (反射境界)。
  diffuse(decay: number, diffusion: number): void {
    const s = this.fieldSize;
    const src = this.field.data, dst = this.buffer.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        const c = src[i] ?? 0;
        const l = x > 0 ? (src[i - 1] ?? 0) : c;
        const r = x < s - 1 ? (src[i + 1] ?? 0) : c;
        const u = y > 0 ? (src[i - s] ?? 0) : c;
        const d = y < s - 1 ? (src[i + s] ?? 0) : c;
        const next = c * (1 - decay - diffusion) + (l + r + u + d) * 0.25 * diffusion;
        dst[i] = next > 0 ? next : 0;
      }
    }
    this.field.data = dst;
    this.buffer.data = src;
  }

  clear(): void {
    this.field.data.fill(0);
    this.buffer.data.fill(0);
  }

  // 場座標に対するディスク stamping。サブクラスから segment deposit などで使う。
  protected stampDisk(cx: number, cy: number, radius: number, amount: number): void {
    const s = this.fieldSize;
    const r2 = radius * radius;
    const cap = this.depositCap;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(s - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(s - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          const w = 1 - Math.sqrt(d2) / radius;
          const idx = y * s + x;
          const next = (this.field.data[idx] ?? 0) + amount * w;
          this.field.data[idx] = next > cap ? cap : next;
        }
      }
    }
  }
}
