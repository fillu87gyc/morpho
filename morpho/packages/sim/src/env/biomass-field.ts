// Biomass Field: 粘菌そのものの「体」を表す密度場。
// ActivityField が「気配」なら、これは「肉」。
// 各エッジは Activity と太さに比例してこの場に biomass を滲ませる。
// 場は遅く拡散し、遅く減衰するため、結果として
// エッジ群の集合は「線」ではなく「面（膜）」として観測できる。
//
// この場は描画の主役であり、また成長判断（前線の広がり）の参照元でもある。

import type { Vec2 } from '../types.js';
import { makeField, sampleField, gradientField, type FieldGrid } from './field.js';

export class BiomassField {
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

  // 場の勾配（前線が「どっちに広がりたいか」の手がかり）
  gradient(pos: Vec2): Vec2 {
    const s = this.fieldSize / this.worldSize;
    return gradientField(this.field, pos.x * s, pos.y * s);
  }

  // 点に滲ませる（ノード周辺の膨らみ用）
  deposit(pos: Vec2, amount: number, radius = 2.5): void {
    const s = this.fieldSize / this.worldSize;
    this.stampDisk(pos.x * s, pos.y * s, radius, amount);
  }

  // 線分に沿って滲ませる（エッジが「膜」として見えるようにする鍵）
  // ActivityField が中点に1点だけ落とすのと違い、ここでは a→b 全体を
  // ディスクで塗り重ねる。これが「線」が「面」になる物理的な理由。
  depositSegment(a: Vec2, b: Vec2, amount: number, radius = 2.5): void {
    const s = this.fieldSize / this.worldSize;
    const ax = a.x * s, ay = a.y * s;
    const bx = b.x * s, by = b.y * s;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, radius * 0.5)));
    // 端点をやや厚く、中央もしっかり乗るように線形補間
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = ax + (bx - ax) * t;
      const cy = ay + (by - ay) * t;
      this.stampDisk(cx, cy, radius, amount / steps);
    }
  }

  private stampDisk(cx: number, cy: number, radius: number, amount: number): void {
    const s = this.fieldSize;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(s - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(s - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          // 中心ほど濃く、縁ほど薄い（クッキー型ではなく雲）
          const w = 1 - Math.sqrt(d2) / radius;
          const idx = y * s + x;
          const next = (this.field.data[idx] ?? 0) + amount * w;
          this.field.data[idx] = next > 2.5 ? 2.5 : next;
        }
      }
    }
  }

  // ゆっくり拡散しゆっくり減衰する。これが膜の「ねばつき」。
  // Activity と違い、生きていない時間にも形が残るよう、decay は十分小さく。
  diffuse(decay = 0.01, diffusion = 0.06): void {
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
