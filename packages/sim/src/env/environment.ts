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
  preferredDirection: Vec2;
}

export interface Environment {
  worldSize: number;
  sampleGrowthContext(pos: Vec2): GrowthContext;
}

export interface GridEnvironmentInit {
  worldSize: number;
  fieldSize?: number;
  baseMoisture?: number;
  baseBrightness?: number;
}

export class GridEnvironment implements Environment {
  worldSize: number;
  fieldSize: number;
  nutrients: FieldGrid;
  moisture: FieldGrid;
  brightness: FieldGrid;
  obstacle: FieldGrid;
  // 「土地本来」の水分/明るさ。decay() が湿度を戻す先の平衡点として使う
  // (= ステージごとの乾き/湿りやすさは baseMoisture との差で決まる)。
  baseMoisture: number;
  baseBrightness: number;

  constructor(init: GridEnvironmentInit) {
    this.worldSize = init.worldSize;
    this.fieldSize = init.fieldSize ?? 64;
    this.baseMoisture = init.baseMoisture ?? 0.3;
    this.baseBrightness = init.baseBrightness ?? 0.2;
    this.nutrients = makeField(this.fieldSize);
    this.moisture = makeField(this.fieldSize, this.baseMoisture);
    this.brightness = makeField(this.fieldSize, this.baseBrightness);
    this.obstacle = makeField(this.fieldSize);
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
    const grad = gradientField(this.nutrients, fp.x, fp.y);
    const m = Math.hypot(grad.x, grad.y);
    const preferredDirection = m > 1e-6 ? { x: grad.x / m, y: grad.y / m } : { x: 0, y: 0 };
    return { nutrients, moisture, brightness, obstacle, preferredDirection };
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
  placeStone(pos: Vec2, radius = 3) {
    const fp = this.toField(pos);
    stampObstacle(this.obstacle, fp.x, fp.y, radius);
  }

  // 自然減衰: 放置すると土地は少しずつ「元の姿」に戻っていく。
  //   - 栄養は消費/腐敗して減っていく (0 へ)
  //   - 水分は baseMoisture へじわじわ緩和する (乾いた土地なら乾き、湿地なら湿ったまま)
  // nutrientRate / moistureRelaxRate は 1 tick あたりの割合。
  decay(nutrientRate: number, moistureRelaxRate: number): void {
    const n = this.fieldSize * this.fieldSize;
    for (let i = 0; i < n; i++) {
      const nv = this.nutrients.data[i] ?? 0;
      if (nv > 0) this.nutrients.data[i] = Math.max(0, nv * (1 - nutrientRate));
      const mv = this.moisture.data[i] ?? 0;
      this.moisture.data[i] = mv + (this.baseMoisture - mv) * moistureRelaxRate;
    }
  }
}
