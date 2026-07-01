// Activity Field: 粘菌自身が世界に書き込む「生命力の場」。
// Environment が静的な土地なら、これは動的な気配。
// エッジが活動を周囲に滲ませ、滲んだ場が他のエッジの活動を引き上げる。
//
// 実体は ScalarField (点 deposit + 5点ステンシル拡散) — 振る舞いの差は
// ほぼ deposit 上限と既定半径だけなので、固有実装は持たない。

import { ScalarField } from '../field/scalar-field.js';

export class ActivityField extends ScalarField {
  constructor(worldSize: number, fieldSize = 64) {
    super(worldSize, fieldSize, { depositCap: 1.5 });
  }
}
