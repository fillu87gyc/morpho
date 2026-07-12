// Environment: 静的な「土地」。栄養・水分・明るさ・障害物といった
// 場所固有の resource を保持する。粘菌そのもの (活動/biomass) は
// ここには載らない — そちらは ScalarField 派生 (ActivityField, BiomassField) が担う。

import type { Vec2 } from '../types.js';
import {
  makeField, sampleField, gradientField,
  stampGaussian, stampObstacle,
  type FieldGrid,
} from '../field/grid.js';

// Graph 層が成長判断に欲しい情報を一括で返す。
// Environment の内部実装 (grid / SDF / spline) を隠蔽する。
export interface GrowthContext {
  nutrients: number;
  moisture: number;
  brightness: number;
  obstacle: number;
  // M10: 温度・毒素。どちらも 0..1 目安のスカラー場で、baseTemperature/0 を
  // 初期値とする。obstacle と違い「通過を禁じる」性質は持たない
  // (成長判定側でスコアのペナルティとしてのみ効く)。
  temperature: number;
  toxin: number;
  preferredDirection: Vec2;
}

export interface Environment {
  worldSize: number;
  sampleGrowthContext(pos: Vec2): GrowthContext;
  // M29 (任意): チャンク evict に対応する実装 (ChunkedGridEnvironment) だけが
  // 持つ。休眠判定 (graph/dormancy.ts) が存在チェックのうえで呼ぶ — 密な
  // GridEnvironment は実装しないので、休眠を有効にしても何も起きない。
  /** 実体化済みチャンクの中心ワールド座標一覧。 */
  materializedChunkCenters?(): Vec2[];
  /** 指定ワールド座標を含むチャンクを要約値へ圧縮して解放する。 */
  evictChunkAt?(worldX: number, worldY: number): void;
}

export interface GridEnvironmentInit {
  worldSize: number;
  fieldSize?: number;
  baseMoisture?: number;
  baseBrightness?: number;
  // M10: 「土地本来」の温度。省略時は SimParams.tempOptimal の既定値 (0.5) と
  // 揃えてあり、ツールで動かさない限り成長には影響しない。
  baseTemperature?: number;
}

export class GridEnvironment implements Environment {
  worldSize: number;
  fieldSize: number;
  nutrients: FieldGrid;
  moisture: FieldGrid;
  brightness: FieldGrid;
  obstacle: FieldGrid;
  // M10: 温度は baseTemperature を初期値に全面へ敷く (decay() で戻る先も同じ)。
  // 毒素は 0 から始まり、プレイヤーが撒かない限り常に 0 のまま。
  temperature: FieldGrid;
  toxin: FieldGrid;
  // M14: 大陸ステージの水域 (地形描画専用マーカー)。placeWater (moisture の
  // 「水を引く」ツール) とは別物 — こちらは「通行不能な水面」を表す。
  // 通行不能自体は既存の obstacle フィールドに同じ形を重ね書きして実現する
  // (growth/life 側のコード変更ゼロ)。water は描画が石と水を塗り分けるため
  // だけに持つ薄いマーカーで、成長判定は一切参照しない。
  water: FieldGrid;
  // 「土地本来」の水分/明るさ/温度。decay() が戻す先の平衡点として使う
  // (= ステージごとの乾き/湿りやすさ・暑さ寒さは base値 との差で決まる)。
  baseMoisture: number;
  baseBrightness: number;
  baseTemperature: number;

  constructor(init: GridEnvironmentInit) {
    this.worldSize = init.worldSize;
    this.fieldSize = init.fieldSize ?? 64;
    this.baseMoisture = init.baseMoisture ?? 0.3;
    this.baseBrightness = init.baseBrightness ?? 0.2;
    this.baseTemperature = init.baseTemperature ?? 0.5;
    this.nutrients = makeField(this.fieldSize);
    this.moisture = makeField(this.fieldSize, this.baseMoisture);
    this.brightness = makeField(this.fieldSize, this.baseBrightness);
    this.obstacle = makeField(this.fieldSize);
    this.temperature = makeField(this.fieldSize, this.baseTemperature);
    this.toxin = makeField(this.fieldSize);
    this.water = makeField(this.fieldSize);
  }

  private toField(pos: Vec2): Vec2 {
    const s = this.fieldSize / this.worldSize;
    return { x: pos.x * s, y: pos.y * s };
  }

  sampleGrowthContext(pos: Vec2): GrowthContext {
    const fp = this.toField(pos);
    const nutrients = sampleField(this.nutrients, fp.x, fp.y);
    const moisture = sampleField(this.moisture, fp.x, fp.y);
    const brightness = sampleField(this.brightness, fp.x, fp.y);
    const obstacle = sampleField(this.obstacle, fp.x, fp.y);
    const temperature = sampleField(this.temperature, fp.x, fp.y);
    const toxin = sampleField(this.toxin, fp.x, fp.y);
    const grad = gradientField(this.nutrients, fp.x, fp.y);
    const m = Math.hypot(grad.x, grad.y);
    const preferredDirection = m > 1e-6 ? { x: grad.x / m, y: grad.y / m } : { x: 0, y: 0 };
    return { nutrients, moisture, brightness, obstacle, temperature, toxin, preferredDirection };
  }

  placeFood(pos: Vec2, radius = 6, amount = 1.0) {
    const fp = this.toField(pos);
    stampGaussian(this.nutrients, fp.x, fp.y, radius, amount);
  }
  placeLight(pos: Vec2, radius = 8, amount = 0.6) {
    const fp = this.toField(pos);
    stampGaussian(this.brightness, fp.x, fp.y, radius, amount);
  }
  placeWater(pos: Vec2, radius = 8, amount = 0.5) {
    const fp = this.toField(pos);
    stampGaussian(this.moisture, fp.x, fp.y, radius, amount);
  }
  // M10: 「水を止める (乾かす)」。placeWater の負量版として moisture を押し下げる。
  placeDrain(pos: Vec2, radius = 8, amount = 0.4) {
    const fp = this.toField(pos);
    stampGaussian(this.moisture, fp.x, fp.y, radius, -amount);
  }
  placeStone(pos: Vec2, radius = 3) {
    const fp = this.toField(pos);
    stampObstacle(this.obstacle, fp.x, fp.y, radius);
  }
  // M10: 「温度を変える」。delta が負なら冷却 (上げ下げ両対応の単一メソッド)。
  placeHeat(pos: Vec2, radius = 8, delta = 0.3) {
    const fp = this.toField(pos);
    stampGaussian(this.temperature, fp.x, fp.y, radius, delta);
  }
  // M10: 「毒素をまく」。obstacle と違い通過は禁じない (growth 側でペナルティのみ)。
  placeToxin(pos: Vec2, radius = 6, amount = 0.5) {
    const fp = this.toField(pos);
    stampGaussian(this.toxin, fp.x, fp.y, radius, amount);
  }
  // M14: 大陸ステージの地形生成専用 (プレイヤーツールではない)。水面を置き、
  // obstacle にも同じ形を重ねて通行不能にし、周囲の湿度を底上げする
  // (「障害物と同様に通行不能だが、湿度を周囲に供給する」水域の挙動)。
  placeWaterBody(pos: Vec2, radius = 6) {
    const fp = this.toField(pos);
    stampObstacle(this.water, fp.x, fp.y, radius);
    stampObstacle(this.obstacle, fp.x, fp.y, radius);
    stampGaussian(this.moisture, fp.x, fp.y, radius * 1.8, 0.3);
  }

  // 自然減衰: 放置すると土地は少しずつ「元の姿」に戻っていく。
  //   - 栄養は消費/腐敗して減っていく (0 へ)
  //   - 水分は baseMoisture へじわじわ緩和する (乾いた土地なら乾き、湿地なら湿ったまま)
  //   - 温度は baseTemperature へじわじわ緩和する (M10)
  //   - 毒素はゆっくり 0 へ分解する (M10)
  // 各 Rate は 1 tick あたりの割合。tempRelaxRate/toxinDecayRate を省略すると
  // 温度・毒素は変化しない (既存呼び出し側との後方互換のため)。
  decay(nutrientRate: number, moistureRelaxRate: number, tempRelaxRate = 0, toxinDecayRate = 0): void {
    const n = this.fieldSize * this.fieldSize;
    for (let i = 0; i < n; i++) {
      const nv = this.nutrients.data[i] ?? 0;
      if (nv > 0) this.nutrients.data[i] = Math.max(0, nv * (1 - nutrientRate));
      const mv = this.moisture.data[i] ?? 0;
      this.moisture.data[i] = mv + (this.baseMoisture - mv) * moistureRelaxRate;
      const tv = this.temperature.data[i] ?? 0;
      this.temperature.data[i] = tv + (this.baseTemperature - tv) * tempRelaxRate;
      const xv = this.toxin.data[i] ?? 0;
      if (xv > 0) this.toxin.data[i] = Math.max(0, xv * (1 - toxinDecayRate));
    }
  }
}
