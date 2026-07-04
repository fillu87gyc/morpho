// Biomass Field: 粘菌そのものの「体」を表す密度場。
// ActivityField が「気配」なら、これは「肉」。
// 各エッジは Activity と太さに比例してこの場に biomass を滲ませる。
// 場は遅く拡散し、遅く減衰するため、結果として
// エッジ群の集合は「線」ではなく「面 (膜)」として観測できる。
//
// 描画の主役であり、また成長判断 (前線の広がり) の参照元でもある。
// ScalarField からは「線分に沿った滲ませ」だけ拡張する。

import type { Vec2 } from '../types.js';
import { ScalarField } from '../field/scalar-field.js';

export class BiomassField extends ScalarField {
  constructor(worldSize: number, fieldSize = 64) {
    super(worldSize, fieldSize, { depositCap: 2.5 });
  }

  // 線分 a→b に沿って「面 (膜)」を滲ませる。
  // 旧実装はディスクを何個も重ね塗りして太さのある線を近似していたが、
  // セルごとに線分までの最短距離を直接引けば同じ形 (capsule) を
  // 1 パスの走査で作れる (重なり範囲を何度も塗り直す無駄がない)。
  depositSegment(a: Vec2, b: Vec2, amount: number, radius: number): void {
    const s = this.scale;
    const ax = a.x * s, ay = a.y * s;
    const bx = b.x * s, by = b.y * s;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;

    const size = this.fieldSize;
    const r2 = radius * radius;
    const cap = this.depositCap;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - radius));
    const x1 = Math.min(size - 1, Math.ceil(Math.max(ax, bx) + radius));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - radius));
    const y1 = Math.min(size - 1, Math.ceil(Math.max(ay, by) + radius));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        // 点 (x,y) から線分 a-b への最短距離 (t を [0,1] にクランプした射影点との距離)
        let t = lenSq > 0 ? ((x - ax) * dx + (y - ay) * dy) / lenSq : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const px = ax + dx * t, py = ay + dy * t;
        const ddx = x - px, ddy = y - py;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 <= r2) {
          const w = 1 - Math.sqrt(d2) / radius;
          const idx = y * size + x;
          const next = (this.field.data[idx] ?? 0) + amount * w;
          this.field.data[idx] = next > cap ? cap : next;
        }
      }
    }
  }
}
