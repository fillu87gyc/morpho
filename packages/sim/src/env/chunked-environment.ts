// M25: チャンク化された Environment 実装。
//
// 既存の `GridEnvironment` (environment.ts) は一切変更しない。growth.ts /
// step.ts は `Environment` インターフェース (`sampleGrowthContext` +
// `worldSize`) だけに依存しているため、このクラスを新しい `Environment`
// 実装として追加するだけで、既存コードに触れずに「半無限ワールド」を
// 成立させられる (ROADMAP.md M25 の方針)。
//
// 地形はチャンク単位で決定的に遅延生成する。`worldSize` は実質的な
// 上限として非常に大きな値を渡す想定 (growth.ts の worldMargin 境界判定に
// 実用上ひっかからないようにする — 「本当に無限」ではなく「十分大きい」)。

import type { Vec2 } from '../types.js';
import type { Environment, GrowthContext } from './environment.js';
import { ChunkedFieldGrid, type ChunkGenerator } from '../field/chunk-grid.js';
import { createRNG } from '../rng.js';

export interface ChunkedGridEnvironmentInit {
  /** 実質的に「無限」とみなせる大きさ (growth.ts の worldMargin 判定用)。 */
  worldSize: number;
  /** 1チャンクの一辺のセル数。 */
  chunkCells?: number;
  /** 1セルが表すワールド単位。 */
  cellWorldSize?: number;
  worldSeed: number;
  baseMoisture?: number;
  baseBrightness?: number;
  baseTemperature?: number;
  /** チャンクの地形を決定的に生成する。省略時は「何もない (obstacle=0,
   * 各フィールドは base 値)」チャンクになる。
   * M30: バイオーム表現のため toxin/moisture/water のパッチを追加した
   * (すべて省略可 = 既存の呼び出し (M25 の原野) はそのまま動く)。 */
  generateTerrain?: (coord: { cx: number; cy: number }, rng: ReturnType<typeof createRNG>, worldSeed: number) => {
    obstaclePatches?: { x: number; y: number; radius: number }[];
    foodPatches?: { x: number; y: number; radius: number; amount: number }[];
    /** M30: 毒素のガウス染み (毒の窪地バイオーム用)。 */
    toxinPatches?: { x: number; y: number; radius: number; amount: number }[];
    /** M30: 湿度の増減 (amount は base からのデルタ、負なら乾燥地帯)。 */
    moisturePatches?: { x: number; y: number; radius: number; amount: number }[];
    /** M30: 水域 (通行不能)。placeWaterBody と同じく water と obstacle の
     * 両方に立ち、周囲 (radius×1.8) の湿度を +0.3 底上げする。 */
    waterPatches?: { x: number; y: number; radius: number }[];
  };
}

// M28: 生成済みチャンク1枚ぶんの地形要約。バイオマス側の要約
// (ChunkedScalarField.summarizeChunks) と合わせて、web 側が「大局レイヤー/
// ワールドマップ」を組み立てるための素材になる。ここでは数値の集計だけを
// 返し、描画の概念 (色・タイル種) は持ち込まない (ROADMAP.md
// アーキテクチャ方針: 絵は web 側で決める)。
export interface ChunkTerrainSummary {
  cx: number;
  cy: number;
  /** 栄養の平均値 (チャンク内全セル)。 */
  nutrientAvg: number;
  /** 障害物セル (>0.5) の割合 (0..1)。 */
  obstacleDensity: number;
  /** 水域セルが1つでもあるか。 */
  hasWater: boolean;
  /** M30: 毒素の平均値 (チャンク内全セル)。毒の窪地バイオームを俯瞰
   * (web 側の大局レイヤー/ワールドマップ) で見分けるための軸。 */
  toxinAvg: number;
}

// 中心差分で勾配を取る (grid.ts の gradientField と同じ考え方)。
const GRADIENT_STEP_CELLS = 1.0;

export class ChunkedGridEnvironment implements Environment {
  worldSize: number;
  readonly chunkCells: number;
  readonly cellWorldSize: number;
  readonly worldSeed: number;
  baseMoisture: number;
  baseBrightness: number;
  baseTemperature: number;

  nutrients: ChunkedFieldGrid;
  moisture: ChunkedFieldGrid;
  brightness: ChunkedFieldGrid;
  obstacle: ChunkedFieldGrid;
  temperature: ChunkedFieldGrid;
  toxin: ChunkedFieldGrid;
  water: ChunkedFieldGrid;

  constructor(init: ChunkedGridEnvironmentInit) {
    this.worldSize = init.worldSize;
    this.chunkCells = init.chunkCells ?? 64;
    this.cellWorldSize = init.cellWorldSize ?? 1;
    this.worldSeed = init.worldSeed;
    this.baseMoisture = init.baseMoisture ?? 0.3;
    this.baseBrightness = init.baseBrightness ?? 0.2;
    this.baseTemperature = init.baseTemperature ?? 0.5;

    const fill = (value: number): ChunkGenerator => (_coord, data) => data.fill(value);

    this.obstacle = new ChunkedFieldGrid({ chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize });
    this.nutrients = new ChunkedFieldGrid({ chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize });
    this.water = new ChunkedFieldGrid({ chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize });
    this.moisture = new ChunkedFieldGrid({
      chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize, generate: fill(this.baseMoisture),
    });
    this.brightness = new ChunkedFieldGrid({
      chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize, generate: fill(this.baseBrightness),
    });
    this.temperature = new ChunkedFieldGrid({
      chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize, generate: fill(this.baseTemperature),
    });
    this.toxin = new ChunkedFieldGrid({ chunkCells: this.chunkCells, cellWorldSize: this.cellWorldSize });

    if (init.generateTerrain) {
      const genTerrain = init.generateTerrain;
      const worldSeed = this.worldSeed;
      // 各フィールドの生成はチャンク単位で決定的な RNG を「フィールドごとに
      // 同じ seed から引き直して」genTerrain を再実行する (同じチャンクなら
      // 常に同じ内容になる = 決定的で、フィールド同士の実体化順にも依らない)。
      const terrainOf = (coord: { cx: number; cy: number }) =>
        genTerrain(coord, createRNG(`${worldSeed}:${coord.cx}:${coord.cy}`), worldSeed);
      this.obstacle = new ChunkedFieldGrid({
        chunkCells: this.chunkCells,
        cellWorldSize: this.cellWorldSize,
        generate: (coord, data, cells) => {
          const result = terrainOf(coord);
          for (const p of result.obstaclePatches ?? []) {
            stampObstacleLocal(data, cells, p.x, p.y, p.radius, this.cellWorldSize);
          }
          // M30: 水域は通行不能 (placeWaterBody と同じく obstacle にも立てる)。
          for (const p of result.waterPatches ?? []) {
            stampObstacleLocal(data, cells, p.x, p.y, p.radius, this.cellWorldSize);
          }
        },
      });
      this.nutrients = new ChunkedFieldGrid({
        chunkCells: this.chunkCells,
        cellWorldSize: this.cellWorldSize,
        generate: (coord, data, cells) => {
          const result = terrainOf(coord);
          for (const p of result.foodPatches ?? []) {
            stampGaussianLocal(data, cells, p.x, p.y, p.radius, p.amount, this.cellWorldSize);
          }
        },
      });
      // M30: バイオーム表現のための追加フィールド (毒素/湿度/水域)。地形が
      // これらのパッチを一切返さなければ、生成結果は従来 (毒素0・湿度base・
      // 水なし) と完全に一致する — M25 からの既存の原野地形は不変。
      this.toxin = new ChunkedFieldGrid({
        chunkCells: this.chunkCells,
        cellWorldSize: this.cellWorldSize,
        generate: (coord, data, cells) => {
          const result = terrainOf(coord);
          for (const p of result.toxinPatches ?? []) {
            stampGaussianLocal(data, cells, p.x, p.y, p.radius, p.amount, this.cellWorldSize);
          }
        },
      });
      this.moisture = new ChunkedFieldGrid({
        chunkCells: this.chunkCells,
        cellWorldSize: this.cellWorldSize,
        generate: (coord, data, cells) => {
          data.fill(this.baseMoisture);
          const result = terrainOf(coord);
          for (const p of result.moisturePatches ?? []) {
            stampGaussianLocal(data, cells, p.x, p.y, p.radius, p.amount, this.cellWorldSize);
          }
          // 水辺は湿る (placeWaterBody の radius×1.8, +0.3 と同じ味付け)。
          for (const p of result.waterPatches ?? []) {
            stampGaussianLocal(data, cells, p.x, p.y, p.radius * 1.8, 0.3, this.cellWorldSize);
          }
        },
      });
      this.water = new ChunkedFieldGrid({
        chunkCells: this.chunkCells,
        cellWorldSize: this.cellWorldSize,
        generate: (coord, data, cells) => {
          const result = terrainOf(coord);
          for (const p of result.waterPatches ?? []) {
            stampObstacleLocal(data, cells, p.x, p.y, p.radius, this.cellWorldSize);
          }
        },
      });
    }
  }

  private gradientOf(field: ChunkedFieldGrid, pos: Vec2): Vec2 {
    const h = GRADIENT_STEP_CELLS * this.cellWorldSize;
    return {
      x: (field.sample(pos.x + h, pos.y) - field.sample(pos.x - h, pos.y)) / (2 * h),
      y: (field.sample(pos.x, pos.y + h) - field.sample(pos.x, pos.y - h)) / (2 * h),
    };
  }

  sampleGrowthContext(pos: Vec2): GrowthContext {
    const nutrients = this.nutrients.sample(pos.x, pos.y);
    const moisture = this.moisture.sample(pos.x, pos.y);
    const brightness = this.brightness.sample(pos.x, pos.y);
    const obstacle = this.obstacle.sample(pos.x, pos.y);
    const temperature = this.temperature.sample(pos.x, pos.y);
    const toxin = this.toxin.sample(pos.x, pos.y);
    const grad = this.gradientOf(this.nutrients, pos);
    const m = Math.hypot(grad.x, grad.y);
    const preferredDirection = m > 1e-6 ? { x: grad.x / m, y: grad.y / m } : { x: 0, y: 0 };
    return { nutrients, moisture, brightness, obstacle, temperature, toxin, preferredDirection };
  }

  // GridEnvironment と同名の place* メソッド (プレイヤーツール/ステージ生成用)。
  placeFood(pos: Vec2, radius = 6, amount = 1.0): void {
    this.nutrients.stampGaussian(pos.x, pos.y, radius, amount);
  }
  placeLight(pos: Vec2, radius = 8, amount = 0.6): void {
    this.brightness.stampGaussian(pos.x, pos.y, radius, amount);
  }
  placeWater(pos: Vec2, radius = 8, amount = 0.5): void {
    this.moisture.stampGaussian(pos.x, pos.y, radius, amount);
  }
  placeDrain(pos: Vec2, radius = 8, amount = 0.4): void {
    this.moisture.stampGaussian(pos.x, pos.y, radius, -amount);
  }
  placeStone(pos: Vec2, radius = 3): void {
    this.obstacle.stampObstacle(pos.x, pos.y, radius);
  }
  placeHeat(pos: Vec2, radius = 8, delta = 0.3): void {
    this.temperature.stampGaussian(pos.x, pos.y, radius, delta);
  }
  placeToxin(pos: Vec2, radius = 6, amount = 0.5): void {
    this.toxin.stampGaussian(pos.x, pos.y, radius, amount);
  }
  placeWaterBody(pos: Vec2, radius = 6): void {
    this.water.stampObstacle(pos.x, pos.y, radius);
    this.obstacle.stampObstacle(pos.x, pos.y, radius);
    this.moisture.stampGaussian(pos.x, pos.y, radius * 1.8, 0.3);
  }

  /** 実体があるチャンク数 (evict 済みは含まない、描画/デバッグ用)。 */
  generatedChunkCount(): number {
    return this.obstacle.chunkCount();
  }

  /** M29: evict 済み (要約値だけ保持) のチャンク数。 */
  evictedChunkCount(): number {
    return this.obstacle.evictedChunkCount();
  }

  /** M29: 触れたことのあるチャンク数 (実体 + evict 済み)。「探索チャンク」
   * 統計は evict で減らないよう、こちらを使うこと。 */
  touchedChunkCount(): number {
    return this.obstacle.chunkCount() + this.obstacle.evictedChunkCount();
  }

  /** M32: 触れたことのあるチャンクの番地一覧 (実体 + evict 済み)。
   * summarizeChunks() と違ってセルデータは読まない (peekChunk 済みのフィールド
   * 走査をしない) ぶん軽量 — 「発見バイオーム数」のような、座標だけで決まる
   * 派生指標 (biomeAt は (cx,cy,worldSeed) の純粋関数) を安く求めるための API。 */
  touchedChunkCoords(): { cx: number; cy: number }[] {
    return [...this.obstacle.generatedChunks(), ...this.obstacle.evictedChunks()];
  }

  // 全フィールドのグリッド (evict/集計でまとめて回すため)。
  private allGrids(): ChunkedFieldGrid[] {
    return [this.nutrients, this.moisture, this.brightness, this.obstacle, this.temperature, this.toxin, this.water];
  }

  // M29: 休眠判定 (graph/dormancy.ts) が呼ぶ evict 対応 (Environment の
  // optional メソッド)。座標集合はフィールドごとに異なりうる (place* は
  // 一部のフィールドしか実体化しない) ので、全フィールドの和集合を返す。
  materializedChunkCenters(): Vec2[] {
    const seen = new Set<string>();
    const out: Vec2[] = [];
    for (const g of this.allGrids()) {
      for (const c of g.generatedChunks()) {
        const key = `${c.cx}:${c.cy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(g.chunkCenterWorld(c));
      }
    }
    return out;
  }

  /** M29: 指定ワールド座標を含むチャンクを全フィールドまとめて evict する。
   * 各フィールドは平均値へ圧縮され、再訪時に平均で塗り戻される (決定的な
   * 近似 — 食料パッチの形は失われ、平均濃度の土地として復元される)。 */
  evictChunkAt(worldX: number, worldY: number): void {
    for (const g of this.allGrids()) g.evictChunkAt(worldX, worldY);
  }

  // M28: 生成済みチャンクごとの地形要約。基準となるチャンク集合は
  // generatedChunkCount() と同じく obstacle 側 (sampleGrowthContext は全
  // フィールドを同時にサンプルするため、実用上 nutrients と同じ集合になる)。
  // 各フィールドは peekChunk (副作用なし) で読む — ensureChunk だと「要約を
  // 取るだけ」のつもりが未生成の nutrients/water チャンクを実体化させて
  // しまい、以後の decay/diffuse 対象が変わって決定論を壊す。未生成の
  // フィールドは 0 埋め (nutrientAvg=0 / hasWater=false) として扱う。
  // 走査は生成済みチャンクのみ・呼び出し時のみ (毎tickの固定費にはしない)。
  summarizeChunks(): ChunkTerrainSummary[] {
    const out: ChunkTerrainSummary[] = [];
    const cells = this.chunkCells * this.chunkCells;
    // M29: evict 済みチャンクも座標集合に含める — 大局レイヤー/ワールド
    // マップ (M28) のタイルが evict で消えないようにするため。フィールド
    // ごとに実体があれば従来どおり走査し、evict 済みなら要約値 (平均) から
    // 近似する: obstacle は 0/1 の場なので平均 = 密度そのもの、water は
    // 平均 > 0 なら「水域セルがあった」とみなせる。
    const coords = [...this.obstacle.generatedChunks(), ...this.obstacle.evictedChunks()];
    for (const { cx, cy } of coords) {
      const obstacle = this.obstacle.peekChunk(cx, cy);
      const nutrients = this.nutrients.peekChunk(cx, cy);
      const water = this.water.peekChunk(cx, cy);
      const toxin = this.toxin.peekChunk(cx, cy);
      let nutrientSum = 0;
      let toxinSum = 0;
      let obstacleCells = 0;
      let hasWater = false;
      for (let i = 0; i < cells; i++) {
        if (nutrients) nutrientSum += nutrients[i] ?? 0;
        if (toxin) toxinSum += toxin[i] ?? 0;
        if ((obstacle?.[i] ?? 0) > 0.5) obstacleCells++;
        if (!hasWater && (water?.[i] ?? 0) > 0.5) hasWater = true;
      }
      out.push({
        cx, cy,
        nutrientAvg: nutrients ? nutrientSum / cells : (this.nutrients.evictedMean(cx, cy) ?? 0),
        obstacleDensity: obstacle ? obstacleCells / cells : (this.obstacle.evictedMean(cx, cy) ?? 0),
        hasWater: water ? hasWater : (this.water.evictedMean(cx, cy) ?? 0) > 0,
        // M30: 毒の窪地バイオームの俯瞰用。evict 済みは要約値 (平均) で近似。
        toxinAvg: toxin ? toxinSum / cells : (this.toxin.evictedMean(cx, cy) ?? 0),
      });
    }
    return out;
  }

  // 自然減衰。GridEnvironment.decay() と同じ式だが、実体のあるチャンク
  // だけを対象にする (未探索領域は生成すらされていないので対象外)。
  // M29: evict 済みチャンクの要約値も減衰させない — 休眠中の土地は時間が
  // 凍っている扱い (枯れかけの餌場が休眠中に守られる = 将来の栄養再生と
  // 同じ向きの近似)。走査コストは実体チャンク数 (前線サイズ) にだけ比例する。
  decay(nutrientRate: number, moistureRelaxRate: number, tempRelaxRate = 0, toxinDecayRate = 0): void {
    decayChunks(this.nutrients, (v) => Math.max(0, v * (1 - nutrientRate)));
    decayChunks(this.moisture, (v) => v + (this.baseMoisture - v) * moistureRelaxRate);
    if (tempRelaxRate > 0) {
      decayChunks(this.temperature, (v) => v + (this.baseTemperature - v) * tempRelaxRate);
    }
    if (toxinDecayRate > 0) {
      decayChunks(this.toxin, (v) => Math.max(0, v * (1 - toxinDecayRate)));
    }
  }
}

function decayChunks(field: ChunkedFieldGrid, fn: (v: number) => number): void {
  for (const { cx, cy } of field.generatedChunks()) {
    const data = field.ensureChunk(cx, cy);
    for (let i = 0; i < data.length; i++) data[i] = fn(data[i] ?? 0);
  }
}

// チャンク生成コールバック内でのみ使う、チャンクローカル座標系への
// stampGaussian/stampObstacle (grid.ts の実装と同じ数式)。`localWorldX/Y`
// はチャンク原点 (0,0) からのワールド単位オフセット (0..chunkCells*
// cellWorldSize の範囲を想定)。呼び出し元が「このチャンクの外にはみ出す
// 分」を切り捨てる (隣接チャンクへの越境は ChunkedFieldGrid.stampGaussian/
// stampObstacle 側 (実行時の place* 経由) が担当し、生成時点ではチャンク内
// で完結させる)。
function stampGaussianLocal(data: Float32Array, cells: number, localWorldX: number, localWorldY: number, radiusWorld: number, amount: number, cellWorldSize: number): void {
  const rCell = radiusWorld / cellWorldSize;
  const ccx = localWorldX / cellWorldSize, ccy = localWorldY / cellWorldSize;
  const r2 = rCell * rCell;
  const x0 = Math.max(0, Math.floor(ccx - rCell * 2));
  const x1 = Math.min(cells - 1, Math.ceil(ccx + rCell * 2));
  const y0 = Math.max(0, Math.floor(ccy - rCell * 2));
  const y1 = Math.min(cells - 1, Math.ceil(ccy + rCell * 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ccx, dy = y - ccy;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * r2));
      const idx = y * cells + x;
      data[idx] = (data[idx] ?? 0) + amount * w;
    }
  }
}

function stampObstacleLocal(data: Float32Array, cells: number, localWorldX: number, localWorldY: number, radiusWorld: number, cellWorldSize: number): void {
  const rCell = radiusWorld / cellWorldSize;
  const ccx = localWorldX / cellWorldSize, ccy = localWorldY / cellWorldSize;
  const x0 = Math.max(0, Math.floor(ccx - rCell));
  const x1 = Math.min(cells - 1, Math.ceil(ccx + rCell));
  const y0 = Math.max(0, Math.floor(ccy - rCell));
  const y1 = Math.min(cells - 1, Math.ceil(ccy + rCell));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ccx, dy = y - ccy;
      if (dx * dx + dy * dy <= rCell * rCell) data[y * cells + x] = 1.0;
    }
  }
}
