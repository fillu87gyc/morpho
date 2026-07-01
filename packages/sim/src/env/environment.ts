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

export interface GridEnvironmentInit { worldSize: number; fieldSize?: number; }

export class GridEnvironment implements Environment {
  worldSize: number;
  fieldSize: number;
  nutrients: FieldGrid;
  moisture: FieldGrid;
  brightness: FieldGrid;
  obstacle: FieldGrid;

  constructor(init: GridEnvironmentInit) {
    this.worldSize = init.worldSize;
    this.fieldSize = init.fieldSize ?? 64;
    this.nutrients = makeField(this.fieldSize);
    this.moisture = makeField(this.fieldSize, 0.3);
    this.brightness = makeField(this.fieldSize, 0.2);
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
}
