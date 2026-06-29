// Activity Field: 粘菌自身が世界に書き込む「生命力の場」。
// Environment が静的な土地なら、これは動的な気配。
// エッジが活動を周囲に滲ませ、滲んだ場が他のエッジの活動を引き上げる。

import type { Vec2 } from '../types.js';
import { makeField, sampleField, type FieldGrid } from './field.js';

export class ActivityField {
  worldSize: number;
  fieldSize: number;
  field: FieldGrid;
  private buffer: FieldGrid;

  constructor(worldSize: number, fieldSize = 64) {
    this.worldSize = worldSize;
    this.fieldSize = fieldSize;
    this.field = makeField(fieldSize);
    this.buffer = makeField(fieldSize);
  }

  sample(pos: Vec2): number {
    const s = this.fieldSize / this.worldSize;
    return sampleField(this.field, pos.x * s, pos.y * s);
  }

  deposit(pos: Vec2, amount: number, radius = 3): void {
    const s = this.fieldSize / this.worldSize;
    const cx = pos.x * s, cy = pos.y * s;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.fieldSize - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.fieldSize - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          const w = 1 - Math.sqrt(d2) / radius;
          const idx = y * this.fieldSize + x;
          this.field.data[idx] = Math.min(1.5, (this.field.data[idx] ?? 0) + amount * w);
        }
      }
    }
  }

  // 5点ステンシルで拡散 + 減衰
  diffuse(decay = 0.05, diffusion = 0.15): void {
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
}
