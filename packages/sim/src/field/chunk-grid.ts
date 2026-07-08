// M25: チャンク化されたスカラー場。
//
// 既存の `FieldGrid` (grid.ts) は固定長の Float32Array 1枚で、ワールド全体を
// 前もって確保する。半無限ワールド (M25〜M27) のために、この場を
// 「チャンク (cx, cy) → Float32Array」の Map として持つ版をここに追加する。
//
// 既存の GridEnvironment/BiomassField/ActivityField は一切変更しない
// (ROADMAP.md M25 の方針: 既存ステージの挙動・e2e は不変に保つ)。
// この ChunkedFieldGrid は新ステージ専用の別実装として並存する。
//
// サンプリング/スタンプの数式は grid.ts の sampleField/stampGaussian/
// stampObstacle と等価になるよう作ってあり、1チャンクに収まるケースでは
// 既存実装とビット一致する (test/chunk-grid.test.ts で検証)。

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export type ChunkGenerator = (coord: ChunkCoord, data: Float32Array, chunkCells: number) => void;

export interface ChunkedGridOptions {
  /** 1チャンクの一辺のセル数。 */
  chunkCells: number;
  /** 1セルが表すワールド単位 (grid.ts の fieldSize/worldSize 比の逆数)。 */
  cellWorldSize: number;
  /** チャンクを初めて参照したときに1度だけ呼ばれる決定的な初期化。
   * 省略時は 0 埋めのまま (makeField の既定と同じ)。 */
  generate?: ChunkGenerator;
}

function chunkKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

// 負の座標でも正しく「下方向へ丸める」ためのチャンク割り (Math.floor は
// 負数でも floor division として正しく動作するが、意図を明示するために
// 専用関数として切り出す)。
function chunkIndexOf(totalCell: number, chunkCells: number): { chunk: number; local: number } {
  const chunk = Math.floor(totalCell / chunkCells);
  const local = totalCell - chunk * chunkCells;
  return { chunk, local };
}

export class ChunkedFieldGrid {
  private chunks = new Map<string, Float32Array>();
  readonly chunkCells: number;
  readonly cellWorldSize: number;
  private generator?: ChunkGenerator;

  constructor(opts: ChunkedGridOptions) {
    this.chunkCells = opts.chunkCells;
    this.cellWorldSize = opts.cellWorldSize;
    this.generator = opts.generate;
  }

  /** 現在メモリ上に存在するチャンク数 (触れたことのある範囲の目安)。 */
  chunkCount(): number {
    return this.chunks.size;
  }

  hasChunk(cx: number, cy: number): boolean {
    return this.chunks.has(chunkKey(cx, cy));
  }

  /** 生成済みなら返す。無ければ (生成せず) null。ChunkedScalarField.diffuse()
   * の隣接チャンク読み取りのように「無ければ 0 として扱いたいが、読むだけで
   * チャンクを実体化させたくない」場面向け (ensureChunk と違い副作用が無い)。 */
  peekChunk(cx: number, cy: number): Float32Array | null {
    return this.chunks.get(chunkKey(cx, cy)) ?? null;
  }

  /** 無ければ決定的に生成して返す。既存チャンクはキャッシュを返すだけ。 */
  ensureChunk(cx: number, cy: number): Float32Array {
    const key = chunkKey(cx, cy);
    let data = this.chunks.get(key);
    if (!data) {
      data = new Float32Array(this.chunkCells * this.chunkCells);
      this.generator?.({ cx, cy }, data, this.chunkCells);
      this.chunks.set(key, data);
    }
    return data;
  }

  private cellAt(totalCellX: number, totalCellY: number): number {
    const { chunk: cx, local: lx } = chunkIndexOf(totalCellX, this.chunkCells);
    const { chunk: cy, local: ly } = chunkIndexOf(totalCellY, this.chunkCells);
    const data = this.ensureChunk(cx, cy);
    return data[ly * this.chunkCells + lx] ?? 0;
  }

  /** 最近傍セルの値をそのまま読む (補間なし)。 */
  sampleNearest(worldX: number, worldY: number): number {
    const s = this.cellWorldSize;
    return this.cellAt(Math.floor(worldX / s), Math.floor(worldY / s));
  }

  /** バイリニア補間 (grid.ts の sampleField と同じ式)。チャンク境界をまたぐ
   * 場合は隣接チャンクも遅延生成される。 */
  sample(worldX: number, worldY: number): number {
    const s = this.cellWorldSize;
    const fx = worldX / s, fy = worldY / s;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const v00 = this.cellAt(x0, y0);
    const v10 = this.cellAt(x0 + 1, y0);
    const v01 = this.cellAt(x0, y0 + 1);
    const v11 = this.cellAt(x0 + 1, y0 + 1);
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  }

  private addCell(totalCellX: number, totalCellY: number, delta: number): void {
    const { chunk: cx, local: lx } = chunkIndexOf(totalCellX, this.chunkCells);
    const { chunk: cy, local: ly } = chunkIndexOf(totalCellY, this.chunkCells);
    const data = this.ensureChunk(cx, cy);
    const idx = ly * this.chunkCells + lx;
    data[idx] = (data[idx] ?? 0) + delta;
  }

  private setCell(totalCellX: number, totalCellY: number, value: number): void {
    const { chunk: cx, local: lx } = chunkIndexOf(totalCellX, this.chunkCells);
    const { chunk: cy, local: ly } = chunkIndexOf(totalCellY, this.chunkCells);
    const data = this.ensureChunk(cx, cy);
    data[ly * this.chunkCells + lx] = value;
  }

  /** grid.ts の stampGaussian と等価。半径がチャンク境界をまたぐ場合は
   * 複数チャンクに分けて書き込む (遅延生成される)。 */
  stampGaussian(worldX: number, worldY: number, radiusWorld: number, amount: number): void {
    const s = this.cellWorldSize;
    const ccx = worldX / s, ccy = worldY / s;
    const rCell = radiusWorld / s;
    const r2 = rCell * rCell;
    const x0 = Math.floor(ccx - rCell * 2);
    const x1 = Math.ceil(ccx + rCell * 2);
    const y0 = Math.floor(ccy - rCell * 2);
    const y1 = Math.ceil(ccy + rCell * 2);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx - ccx, dy = ty - ccy;
        const w = Math.exp(-(dx * dx + dy * dy) / (2 * r2));
        this.addCell(tx, ty, amount * w);
      }
    }
  }

  /** scalar-field.ts の stampDisk と等価 (中心が濃く縁で線形に薄くなる円盤、
   * セル毎に cap で頭打ち)。ActivityField/BiomassField のチャンク版が使う。 */
  stampDiskCapped(worldX: number, worldY: number, radiusWorld: number, amount: number, cap: number): void {
    const s = this.cellWorldSize;
    const ccx = worldX / s, ccy = worldY / s;
    const rCell = radiusWorld / s;
    const r2 = rCell * rCell;
    const x0 = Math.floor(ccx - rCell);
    const x1 = Math.ceil(ccx + rCell);
    const y0 = Math.floor(ccy - rCell);
    const y1 = Math.ceil(ccy + rCell);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx - ccx, dy = ty - ccy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          const w = 1 - Math.sqrt(d2) / rCell;
          const { chunk: cx, local: lx } = chunkIndexOf(tx, this.chunkCells);
          const { chunk: cy, local: ly } = chunkIndexOf(ty, this.chunkCells);
          const data = this.ensureChunk(cx, cy);
          const idx = ly * this.chunkCells + lx;
          const next = (data[idx] ?? 0) + amount * w;
          data[idx] = next > cap ? cap : next;
        }
      }
    }
  }

  /** チャンクのデータ全体を置き換える (diffuse の二段階コミットで使う)。 */
  setChunkData(cx: number, cy: number, data: Float32Array): void {
    this.chunks.set(chunkKey(cx, cy), data);
  }

  /** biomass-field.ts の depositSegment と等価 (線分 a→b に沿った膜、
   * セル毎に cap で頭打ち)。チャンク境界をまたぐ線分も正しく複数チャンクへ
   * 書き込む (遅延生成される)。 */
  stampSegmentCapped(
    ax: number, ay: number, bx: number, by: number, radiusWorld: number, amount: number, cap: number,
  ): void {
    const s = this.cellWorldSize;
    const cax = ax / s, cay = ay / s, cbx = bx / s, cby = by / s;
    const rCell = radiusWorld / s;
    const dx = cbx - cax, dy = cby - cay;
    const lenSq = dx * dx + dy * dy;
    const r2 = rCell * rCell;
    const x0 = Math.floor(Math.min(cax, cbx) - rCell);
    const x1 = Math.ceil(Math.max(cax, cbx) + rCell);
    const y0 = Math.floor(Math.min(cay, cby) - rCell);
    const y1 = Math.ceil(Math.max(cay, cby) + rCell);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        let t = lenSq > 0 ? ((tx - cax) * dx + (ty - cay) * dy) / lenSq : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        const px = cax + dx * t, py = cay + dy * t;
        const ddx = tx - px, ddy = ty - py;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 <= r2) {
          const w = 1 - Math.sqrt(d2) / rCell;
          const { chunk: cx, local: lx } = chunkIndexOf(tx, this.chunkCells);
          const { chunk: cy, local: ly } = chunkIndexOf(ty, this.chunkCells);
          const data = this.ensureChunk(cx, cy);
          const idx = ly * this.chunkCells + lx;
          const next = (data[idx] ?? 0) + amount * w;
          data[idx] = next > cap ? cap : next;
        }
      }
    }
  }

  /** grid.ts の stampObstacle と等価 (ハードエッジで 1.0 を塗る)。 */
  stampObstacle(worldX: number, worldY: number, radiusWorld: number): void {
    const s = this.cellWorldSize;
    const ccx = worldX / s, ccy = worldY / s;
    const rCell = radiusWorld / s;
    const x0 = Math.floor(ccx - rCell);
    const x1 = Math.ceil(ccx + rCell);
    const y0 = Math.floor(ccy - rCell);
    const y1 = Math.ceil(ccy + rCell);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const dx = tx - ccx, dy = ty - ccy;
        if (dx * dx + dy * dy <= rCell * rCell) this.setCell(tx, ty, 1.0);
      }
    }
  }

  /** 現在生成済みのチャンク座標一覧 (描画/デバッグ用)。 */
  generatedChunks(): ChunkCoord[] {
    return [...this.chunks.keys()].map((k) => {
      const [cx, cy] = k.split(':').map(Number);
      return { cx: cx!, cy: cy! };
    });
  }
}
