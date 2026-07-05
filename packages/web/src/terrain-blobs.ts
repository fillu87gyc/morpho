// M21: 障害物フィールド (obstacle) の連結成分を検出し、ぼかし塊の代わりに
// スプライトを置くための「岩の塊」データへ変換する。DOM 非依存の純粋関数。

export interface TerrainBlob {
  /** ワールド座標系での重心 */
  cx: number;
  cy: number;
  /** 面積から逆算した概ねの半径 (ワールド単位) */
  radiusWorld: number;
  /** 連結成分に含まれるフィールドセル数 (サイズ分類に使う) */
  cellCount: number;
}

/**
 * `field` (fieldSize × fieldSize の行優先 Float32Array) 上で `threshold` を
 * 超えるセルを 4-近傍で連結させ、各連結成分の重心・概算半径を返す。
 * 呼び出し順序は決定的 (走査順) なので、同じ入力なら常に同じ順序で返る。
 */
export function extractTerrainBlobs(
  field: Float32Array,
  fieldSize: number,
  worldSize: number,
  threshold = 0.5,
): TerrainBlob[] {
  const n = field.length;
  const visited = new Uint8Array(n);
  const blobs: TerrainBlob[] = [];
  const cellWorld = worldSize / fieldSize;
  const stack: number[] = [];

  const isLand = (idx: number): boolean => !visited[idx] && (field[idx] ?? 0) > threshold;

  for (let start = 0; start < n; start++) {
    if (visited[start] || !isLand(start)) continue;

    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % fieldSize;
      const y = (i / fieldSize) | 0;
      sumX += x;
      sumY += y;
      count++;

      const neighbors: number[] = [];
      if (x > 0) neighbors.push(i - 1);
      if (x < fieldSize - 1) neighbors.push(i + 1);
      if (y > 0) neighbors.push(i - fieldSize);
      if (y < fieldSize - 1) neighbors.push(i + fieldSize);
      for (const idx of neighbors) {
        if (isLand(idx)) {
          visited[idx] = 1;
          stack.push(idx);
        }
      }
    }

    const cx = (sumX / count + 0.5) * cellWorld;
    const cy = (sumY / count + 0.5) * cellWorld;
    const areaWorld = count * cellWorld * cellWorld;
    const radiusWorld = Math.sqrt(areaWorld / Math.PI);
    blobs.push({ cx, cy, radiusWorld, cellCount: count });
  }

  return blobs;
}

// M21: 小さい飛び地 (数セル程度) は「小石」として描き分ける。この閾値未満の
// セル数の連結成分は rock-cluster ではなく small-stone スプライトを使う。
export const SMALL_BLOB_MAX_CELLS = 3;
