// 「Edge を一切使わず Biomass だけで動く粘菌っぽい振る舞いを目指す」実験。
// Membrane モデルを 1000+ tick 走らせて、その瞬間の A (= biomass) だけを描画。
// Skeleton も Edge も描かない。

import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createRNG, GridEnvironment,
  Membrane, DEFAULT_MEMBRANE_PARAMS,
} from '../src/index.js';

const WORLD = 100;
const FIELD = 64;
const TILE = 8;
const W = FIELD * TILE;
const H = FIELD * TILE;

const OUT = resolve('renders-biomass');
mkdirSync(OUT, { recursive: true });

const rng = createRNG(7);
const env = new GridEnvironment({ worldSize: WORLD, fieldSize: FIELD });
env.placeFood({ x: 20, y: 25 }, 7, 1.0);
env.placeFood({ x: 80, y: 25 }, 7, 1.0);
env.placeFood({ x: 80, y: 80 }, 7, 1.0);
env.placeFood({ x: 20, y: 80 }, 7, 1.0);
env.placeStone({ x: 50, y: 55 }, 5);

const membrane = new Membrane(WORLD, FIELD, rng);
const sources = [{ pos: { x: 50, y: 30 } }];

function blend(png: PNG, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const inv = 1 - a;
  png.data[i]     = png.data[i]     * inv + r * a;
  png.data[i + 1] = png.data[i + 1] * inv + g * a;
  png.data[i + 2] = png.data[i + 2] * inv + b * a;
  png.data[i + 3] = 255;
}

function renderFrame(tick: number) {
  const png = new PNG({ width: W, height: H });
  // 暗背景
  for (let i = 0; i < W * H * 4; i += 4) {
    png.data[i] = 6; png.data[i + 1] = 5; png.data[i + 2] = 9; png.data[i + 3] = 255;
  }

  // 環境: 食料を緑、石をグレー
  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const i = fy * FIELD + fx;
      const n = env.nutrients.data[i] ?? 0;
      const o = env.obstacle.data[i] ?? 0;
      const x0 = fx * TILE, y0 = fy * TILE;
      if (n > 0.05) {
        const a = Math.min(0.6, n * 0.55);
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          blend(png, x0 + dx, y0 + dy, 50, 180, 70, a);
        }
      }
      if (o > 0.5) {
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          blend(png, x0 + dx, y0 + dy, 75, 70, 80, 0.95);
        }
      }
    }
  }

  // 膜本体: B をバイリニアで滑らかに描く
  let maxV = 0;
  for (let i = 0; i < FIELD * FIELD; i++) {
    const v = membrane.B.data[i] ?? 0;
    if (v > maxV) maxV = v;
  }
  maxV = Math.max(maxV, 0.3);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fxF = x / TILE, fyF = y / TILE;
      const fx0 = Math.floor(fxF), fy0 = Math.floor(fyF);
      const fx1 = Math.min(FIELD - 1, fx0 + 1), fy1 = Math.min(FIELD - 1, fy0 + 1);
      const tx = fxF - fx0, ty = fyF - fy0;
      const v00 = membrane.B.data[fy0 * FIELD + fx0] ?? 0;
      const v10 = membrane.B.data[fy0 * FIELD + fx1] ?? 0;
      const v01 = membrane.B.data[fy1 * FIELD + fx0] ?? 0;
      const v11 = membrane.B.data[fy1 * FIELD + fx1] ?? 0;
      const v = ((v00 * (1 - tx) + v10 * tx) * (1 - ty) +
                 (v01 * (1 - tx) + v11 * tx) * ty) / maxV;
      if (v < 0.015) continue;
      const k = Math.pow(Math.min(1, v), 0.55);
      // 黄→金→白の階調 (密度で色も変える)
      const r = 240;
      const g = Math.floor(180 + 60 * Math.max(0, k - 0.5) * 2);
      const b = Math.floor(60 + 150 * Math.max(0, k - 0.7) * 3);
      const a = Math.min(0.92, 0.18 + k * 0.75);
      blend(png, x, y, r, g, b, a);
    }
  }

  // ソース位置のマーカー
  for (const s of sources) {
    const cx = (s.pos.x / WORLD) * W, cy = (s.pos.y / WORLD) * H;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= 4) blend(png, cx + dx, cy + dy, 120, 200, 255, 1 - d / 4);
    }
  }

  const path = resolve(OUT, `frame-${String(tick).padStart(4, '0')}.png`);
  writeFileSync(path, PNG.sync.write(png));
  console.log(`tick=${tick} maxB=${maxV.toFixed(2)} totalB=${membrane.totalMass().toFixed(1)}`);
}

const SNAP_AT = [40, 100, 180, 280, 400, 550, 720, 900, 1100, 1300];
let nextIdx = 0;
const total = SNAP_AT[SNAP_AT.length - 1]!;
for (let t = 0; t <= total; t++) {
  membrane.step(t, env, sources, DEFAULT_MEMBRANE_PARAMS);
  if (nextIdx < SNAP_AT.length && t === SNAP_AT[nextIdx]) {
    renderFrame(t);
    nextIdx++;
  }
}

console.log(`\nDone. ${SNAP_AT.length} frames in ${OUT}`);
