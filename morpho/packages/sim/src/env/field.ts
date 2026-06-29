import type { Vec2 } from '../types.js';

// Graph層が成長判断に欲しい情報を一括で返す。
// Environmentの内部実装（grid / SDF / spline）を隠蔽する。
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

export interface FieldGrid {
  size: number;
  data: Float32Array;
}

export function makeField(size: number, fill = 0): FieldGrid {
  return { size, data: new Float32Array(size * size).fill(fill) };
}

export function sampleField(field: FieldGrid, x: number, y: number): number {
  const s = field.size;
  if (x < 0 || y < 0 || x >= s - 1 || y >= s - 1) {
    const cx = Math.max(0, Math.min(s - 1, Math.floor(x)));
    const cy = Math.max(0, Math.min(s - 1, Math.floor(y)));
    return field.data[cy * s + cx] ?? 0;
  }
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const i00 = y0 * s + x0;
  const v00 = field.data[i00] ?? 0;
  const v10 = field.data[i00 + 1] ?? 0;
  const v01 = field.data[i00 + s] ?? 0;
  const v11 = field.data[i00 + s + 1] ?? 0;
  return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
}

export function gradientField(field: FieldGrid, x: number, y: number): Vec2 {
  const h = 1.0;
  return {
    x: (sampleField(field, x + h, y) - sampleField(field, x - h, y)) / (2 * h),
    y: (sampleField(field, x, y + h) - sampleField(field, x, y - h)) / (2 * h),
  };
}

export function stampGaussian(field: FieldGrid, cx: number, cy: number, radius: number, amount: number): void {
  const s = field.size;
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius * 2));
  const x1 = Math.min(s - 1, Math.ceil(cx + radius * 2));
  const y0 = Math.max(0, Math.floor(cy - radius * 2));
  const y1 = Math.min(s - 1, Math.ceil(cy + radius * 2));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * r2));
      const idx = y * s + x;
      field.data[idx] = (field.data[idx] ?? 0) + amount * w;
    }
  }
}

export function stampObstacle(field: FieldGrid, cx: number, cy: number, radius: number): void {
  const s = field.size;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(s - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(s - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) field.data[y * s + x] = 1.0;
    }
  }
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
