// M25 (無限ワールドの正しさ): ScalarField (Activity/Biomass) のチャンク版。
//
// ChunkedGridEnvironment (M25) は Environment (栄養/水分/明るさ等) を
// チャンク化したが、ActivityField/BiomassField (scalar-field.ts) は
// 「粘菌自身が場に書き込む生命力/体の場」で、これは今も worldSize 全体を
// 覆う密な Float32Array (ScalarField) のままだった。無限ワールドの
// worldSize は非常に大きい値 (例: 100,000) を使う想定なので、密なままだと
// 1セルが数千ワールド単位を覆う致命的な低解像度になり、growth.ts の
// biomassPull スコアリング (bioField.sample) が実質的に意味を失う。
//
// 対応として ChunkedFieldGrid を使う ChunkedScalarField を追加する。
// gradient() は growth.ts/life.ts のどこからも呼ばれていない (ScalarField
// 側も同様に未使用)ため実装しない。既存の ActivityField/BiomassField は
// 一切変更しない (既存6ステージは無改修のまま)。

import type { Vec2 } from '../types.js';
import { ChunkedFieldGrid } from './chunk-grid.js';

export interface ChunkedScalarFieldOptions {
  /** deposit でセル値が超えてはいけない上限。 */
  depositCap: number;
  chunkCells?: number;
  cellWorldSize?: number;
}

// M28: 生成済みチャンク1枚ぶんの集計。描画の概念は持ち込まず、数値の
// 集計だけを返す (絵にするのは web 側の責務 — ROADMAP.md アーキテクチャ方針)。
export interface FieldChunkSummary {
  cx: number;
  cy: number;
  /** チャンク内全セルの値の総和。 */
  total: number;
  /** threshold を超える (>) セルの数。 */
  cellsAbove: number;
}

// M28: 全世界統計 (summarizeChunks の全チャンク合算)。
export interface FieldWorldStats {
  total: number;
  cellsAbove: number;
  chunkCount: number;
}

export class ChunkedScalarField {
  private grid: ChunkedFieldGrid;
  readonly chunkCells: number;
  readonly cellWorldSize: number;
  private readonly depositCap: number;

  constructor(options: ChunkedScalarFieldOptions) {
    this.chunkCells = options.chunkCells ?? 64;
    this.cellWorldSize = options.cellWorldSize ?? 1;
    this.depositCap = options.depositCap;
    this.grid = new ChunkedFieldGrid({ chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize });
  }

  sample(pos: Vec2): number {
    return this.grid.sample(pos.x, pos.y);
  }

  // 円盤状に滲ませる: 中心が濃く、縁にかけて線形に薄くなる雲 (scalar-field.ts
  // の stampDisk と等価な式、cap 付き)。
  deposit(pos: Vec2, amount: number, radius: number): void {
    this.grid.stampDiskCapped(pos.x, pos.y, radius, amount, this.depositCap);
  }

  // 5点ステンシル: 生成済みチャンクだけを対象にする (未生成領域は「まだ何も
  // 滲んでいない」ので拡散元にならない)。隣接チャンクの縁セルは peekChunk
  // (副作用なし、無ければ 0 として扱う) で読む — ensureChunk だと「読むだけ」
  // のつもりが隣接チャンクを実体化させてしまい、diffuse を呼ぶたびに
  // 生成済みチャンク集合が「触れた隣接チャンクの輪」ぶん際限なく膨らむ
  // (実測: 数千チャンクまで膨張し diffuse コストが発散、テストがハング
  // する形で発覚した)。密版の「範囲外は自セルにフォールバック」に対応する
  // 挙動は、未生成の隣接 = 0 埋めとして扱うことで自然に再現される。
  //
  // 読み取り (現在値のスナップショット) と書き込み (新チャンクへの置き換え)
  // を2段階に分けているのは、同じパス内で「既に更新済みの隣接チャンク」を
  // 誤って読んでしまう順序依存バグを避けるため (密版の field/buffer
  // ダブルバッファリングと同じ理由)。
  diffuse(decay: number, diffusion: number): void {
    const coords = this.grid.generatedChunks();
    const cells = this.chunkCells;
    const out: { cx: number; cy: number; data: Float32Array }[] = [];
    for (const { cx, cy } of coords) {
      const src = this.grid.peekChunk(cx, cy);
      if (!src) continue; // generatedChunks() のスナップショット後に消えることは無いはずだが念のため
      const west = this.grid.peekChunk(cx - 1, cy);
      const east = this.grid.peekChunk(cx + 1, cy);
      const north = this.grid.peekChunk(cx, cy - 1);
      const south = this.grid.peekChunk(cx, cy + 1);
      const data = new Float32Array(cells * cells);
      for (let ly = 0; ly < cells; ly++) {
        for (let lx = 0; lx < cells; lx++) {
          const i = ly * cells + lx;
          const c = src[i] ?? 0;
          const l = lx > 0 ? (src[i - 1] ?? 0) : (west ? (west[ly * cells + (cells - 1)] ?? 0) : 0);
          const r = lx < cells - 1 ? (src[i + 1] ?? 0) : (east ? (east[ly * cells] ?? 0) : 0);
          const u = ly > 0 ? (src[i - cells] ?? 0) : (north ? (north[(cells - 1) * cells + lx] ?? 0) : 0);
          const d = ly < cells - 1 ? (src[i + cells] ?? 0) : (south ? (south[lx] ?? 0) : 0);
          const next = c * (1 - decay - diffusion) + (l + r + u + d) * 0.25 * diffusion;
          data[i] = next > 0 ? next : 0;
        }
      }
      out.push({ cx, cy, data });
    }
    for (const { cx, cy, data } of out) this.grid.setChunkData(cx, cy, data);
  }

  /** 現在メモリ上に存在するチャンク数 (描画/デバッグ用)。 */
  generatedChunkCount(): number {
    return this.grid.chunkCount();
  }

  // M28: 生成済みチャンクごとの要約 (総和 + threshold 超過セル数)。
  // peekChunk (副作用なし) で読むだけなので、呼んでもチャンク集合は一切
  // 変わらない = 決定論を乱さない。走査は生成済みチャンクのみで、呼び出し
  // 時にだけ行う (毎tickの固定費にはしない — 呼ぶ頻度は呼び出し側の責務)。
  summarizeChunks(threshold = 0): FieldChunkSummary[] {
    const out: FieldChunkSummary[] = [];
    for (const { cx, cy } of this.grid.generatedChunks()) {
      const data = this.grid.peekChunk(cx, cy);
      if (!data) continue;
      let total = 0, cellsAbove = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] ?? 0;
        total += v;
        if (v > threshold) cellsAbove++;
      }
      out.push({ cx, cy, total, cellsAbove });
    }
    return out;
  }

  // M28: 全世界の総和と閾値超過セル数 (summarizeChunks の合算)。「窓の中
  // しか数えない HUD」(ROADMAP.md V2) を世界全体の数字に置き換えるための、
  // チャンク横断の軽い集計。
  summarizeWorld(threshold = 0): FieldWorldStats {
    let total = 0, cellsAbove = 0, chunkCount = 0;
    for (const s of this.summarizeChunks(threshold)) {
      total += s.total;
      cellsAbove += s.cellsAbove;
      chunkCount++;
    }
    return { total, cellsAbove, chunkCount };
  }

  protected depositSegmentInternal(a: Vec2, b: Vec2, amount: number, radius: number): void {
    this.grid.stampSegmentCapped(a.x, a.y, b.x, b.y, radius, amount, this.depositCap);
  }
}

// ActivityField (activity-field.ts) のチャンク版。deposit 上限だけが異なる
// (固有実装を持たない点も密版と同じ)。
export class ChunkedActivityField extends ChunkedScalarField {
  constructor(chunkCells?: number, cellWorldSize?: number) {
    super({ depositCap: 1.5, chunkCells, cellWorldSize });
  }
}

// BiomassField (biomass-field.ts) のチャンク版。線分沿いの膜滲ませ
// (depositSegment) だけを追加する。
export class ChunkedBiomassField extends ChunkedScalarField {
  constructor(chunkCells?: number, cellWorldSize?: number) {
    super({ depositCap: 2.5, chunkCells, cellWorldSize });
  }

  depositSegment(a: Vec2, b: Vec2, amount: number, radius: number): void {
    this.depositSegmentInternal(a, b, amount, radius);
  }
}
