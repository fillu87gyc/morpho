// M24: 「粘菌以外のいのち」(キノコ/苔の茂み/朽木) をステージの地形から
// 決定的に散らすための純粋関数。同じ地形データを渡せば常に同じ配置になる
// (seed 依存の再現性を保つため RNG オブジェクトではなく座標ハッシュを使う)。

export interface Vec2 {
  x: number;
  y: number;
}

export type DecorKind = 'mushroom' | 'moss-clump' | 'driftwood';

export interface DecorPlacement {
  pos: Vec2;
  kind: DecorKind;
  /** スプライトのバリエーション番号 (1-indexed)。 */
  variant: number;
  /** 描画時の決定的な回転 (ラジアン)。 */
  rotation: number;
}

// 小物を検討する間隔 (ワールド単位)。細かすぎると密集しすぎるため、
// 地形の起伏スケール (岩塊の直径など) と同程度に粗くする。
export const DECOR_CELL_WORLD = 5;

function hash01(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function isNearRock(obstacle: Float32Array, fieldSize: number, fx: number, fy: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = fx + dx, y = fy + dy;
      if (x < 0 || y < 0 || x >= fieldSize || y >= fieldSize) continue;
      if ((obstacle[y * fieldSize + x] ?? 0) > 0.5) return true;
    }
  }
  return false;
}

/**
 * moisture/obstacle/water の各フィールドから、決定的に小物の配置を求める。
 * 呼び出し順序 (走査順) も含めて決定的なので、同じ入力なら常に同じ配列が返る。
 */
export function scatterDecorations(
  moisture: Float32Array,
  obstacle: Float32Array,
  water: Float32Array,
  fieldSize: number,
  worldSize: number,
): DecorPlacement[] {
  const cellWorld = worldSize / fieldSize;
  const gridCount = Math.max(1, Math.floor(worldSize / DECOR_CELL_WORLD));
  const placements: DecorPlacement[] = [];

  for (let gy = 0; gy < gridCount; gy++) {
    for (let gx = 0; gx < gridCount; gx++) {
      const wx = (gx + 0.5) * DECOR_CELL_WORLD;
      const wy = (gy + 0.5) * DECOR_CELL_WORLD;
      const fx = Math.min(fieldSize - 1, Math.max(0, Math.round(wx / cellWorld)));
      const fy = Math.min(fieldSize - 1, Math.max(0, Math.round(wy / cellWorld)));
      const idx = fy * fieldSize + fx;
      const ob = obstacle[idx] ?? 0;
      const wb = water[idx] ?? 0;
      const moi = moisture[idx] ?? 0;

      if (wb > 0.5) continue; // 水面には置かない
      if (ob > 0.5) continue; // 障害物の真上には置かない

      const roll = hash01(gx, gy, 1);
      const variantRoll = hash01(gx, gy, 2);
      const rotation = hash01(gx, gy, 3) * Math.PI * 2;

      if (isNearRock(obstacle, fieldSize, fx, fy) && roll < 0.5) {
        placements.push({ pos: { x: wx, y: wy }, kind: 'moss-clump', variant: 1 + Math.floor(variantRoll * 3), rotation });
        continue;
      }
      if (moi > 0.35 && roll < 0.22) {
        placements.push({ pos: { x: wx, y: wy }, kind: 'mushroom', variant: 1 + Math.floor(variantRoll * 2), rotation });
        continue;
      }
      if (roll < 0.06) {
        placements.push({ pos: { x: wx, y: wy }, kind: 'driftwood', variant: 1, rotation });
      }
    }
  }
  return placements;
}
