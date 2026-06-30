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

  // 線分 a→b に沿ってディスクを重ね塗りする。
  // ActivityField のように中点に1点だけ落とすのと違い、
  // 全体に塗り重ねるのが「線」→「面 (膜)」への鍵。
  depositSegment(a: Vec2, b: Vec2, amount: number, radius: number): void {
    const s = this.scale;
    const ax = a.x * s, ay = a.y * s;
    const bx = b.x * s, by = b.y * s;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.5, radius * 0.5)));
    // 端点も中央も均等に乗るように、amount を steps で均等割り
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = ax + (bx - ax) * t;
      const cy = ay + (by - ay) * t;
      this.stampDisk(cx, cy, radius, amount / steps);
    }
  }
}
