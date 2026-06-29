// 呼吸 + 食料消費サイクル + (期待として) 南到達 を一本の GIF で。
// feedingRate を下げ、pressureDecay も下げて圧力を遠くまで届かせる。
// 3000 tick を 15tick 間隔でサンプリング → 200 フレーム、60ms × 12秒。

// gifenc の package.json には "type":"module" が無く、node が ESM として解釈してくれない。
// .mjs にコピーした gifenc.mjs を直接読む。
// @ts-ignore .mjs ファイルへの直接 import
import { GIFEncoder, quantize, applyPalette } from './gifenc.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createRNG, GridEnvironment,
  Membrane, DEFAULT_MEMBRANE_PARAMS,
} from '../src/index.js';

const WORLD = 100;
const FIELD = 64;
const TILE = 4;
const W = FIELD * TILE;
const H = FIELD * TILE;

const OUT = resolve('renders-gif');
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

const params = {
  ...DEFAULT_MEMBRANE_PARAMS,
  feedingRate: 0.025,    // 増えすぎないように
  pressureDecay: 0.025,  // 長距離まで圧が届くように
  // 上 + 下 まで膜が往復することを期待
};

const TOTAL_TICKS = 3000;
const FRAME_INTERVAL = 15;
const FRAME_DELAY_MS = 60;

function renderFrameRGBA(): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = 6; rgba[i * 4 + 1] = 5; rgba[i * 4 + 2] = 9; rgba[i * 4 + 3] = 255;
  }

  // 食料 + 障害物
  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const i = fy * FIELD + fx;
      const n = env.nutrients.data[i] ?? 0;
      const o = env.obstacle.data[i] ?? 0;
      const x0 = fx * TILE, y0 = fy * TILE;
      if (n > 0.03) {
        const a = Math.min(0.65, n * 0.6);
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          const idx = ((y0 + dy) * W + (x0 + dx)) * 4;
          rgba[idx] = (rgba[idx] ?? 0) * (1 - a) + 50 * a;
          rgba[idx + 1] = (rgba[idx + 1] ?? 0) * (1 - a) + 180 * a;
          rgba[idx + 2] = (rgba[idx + 2] ?? 0) * (1 - a) + 70 * a;
        }
      }
      if (o > 0.5) {
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          const idx = ((y0 + dy) * W + (x0 + dx)) * 4;
          rgba[idx] = 75; rgba[idx + 1] = 70; rgba[idx + 2] = 80;
        }
      }
    }
  }

  // 膜本体 + 前縁グロー + 呼吸オーバーレイ。
  // - B: 厚みそのもの (黄→白寄り)
  // - flowMag: いま流れ込んでいる前線。ハイライトで「進行中の側」を見せる
  // - phase + noise: 体内をゆっくり走る呼吸の波。彩度ではなく明度の微振動として乗せる
  let maxV = 0, maxF = 0;
  for (let i = 0; i < FIELD * FIELD; i++) {
    const v = membrane.B.data[i] ?? 0;
    if (v > maxV) maxV = v;
    const f = membrane.flowMag.data[i] ?? 0;
    if (f > maxF) maxF = f;
  }
  maxV = Math.max(maxV, 0.3);
  maxF = Math.max(maxF, 1e-4);
  const phase = membrane.phase;
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
      if (v < 0.02) continue;

      // 前縁シグナル (隣接 4 セルから補間)
      const f00 = membrane.flowMag.data[fy0 * FIELD + fx0] ?? 0;
      const f10 = membrane.flowMag.data[fy0 * FIELD + fx1] ?? 0;
      const f01 = membrane.flowMag.data[fy1 * FIELD + fx0] ?? 0;
      const f11 = membrane.flowMag.data[fy1 * FIELD + fx1] ?? 0;
      const fNorm = ((f00 * (1 - tx) + f10 * tx) * (1 - ty) +
                     (f01 * (1 - tx) + f11 * tx) * ty) / maxF;
      const front = Math.min(1, fNorm * 1.6);

      // 呼吸: 位相 + セル毎のノイズで遅い波が体内を走る
      const n = membrane.noise.data[fy0 * FIELD + fx0] ?? 0;
      const breath = 1 + 0.08 * Math.sin(phase + n * 1.5);

      const k = Math.pow(Math.min(1, v), 0.55) * breath;
      // 前縁ほど白く: G・B を持ち上げる
      const r = Math.min(255, 240 + front * 12);
      const g = Math.min(255, 180 + 60 * Math.max(0, k - 0.5) * 2 + front * 50);
      const b = Math.min(255, 60 + 150 * Math.max(0, k - 0.7) * 3 + front * 90);
      const a = Math.min(0.95, 0.18 + k * 0.75 + front * 0.10);
      const idx = (y * W + x) * 4;
      const inv = 1 - a;
      rgba[idx] = (rgba[idx] ?? 0) * inv + r * a;
      rgba[idx + 1] = (rgba[idx + 1] ?? 0) * inv + g * a;
      rgba[idx + 2] = (rgba[idx + 2] ?? 0) * inv + b * a;
    }
  }

  return rgba;
}

const gif = GIFEncoder();
let frameCount = 0;
let lastReport = 0;

console.log(`Running ${TOTAL_TICKS} ticks, frame every ${FRAME_INTERVAL} ticks...`);
for (let t = 0; t < TOTAL_TICKS; t++) {
  membrane.step(t, env, sources, params);
  if (t % FRAME_INTERVAL === 0) {
    const rgba = renderFrameRGBA();
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, W, H, { palette, delay: FRAME_DELAY_MS });
    frameCount++;
    if (t - lastReport >= 300) {
      // 残存食料の合計と総質量
      let foodLeft = 0;
      for (let i = 0; i < FIELD * FIELD; i++) foodLeft += env.nutrients.data[i] ?? 0;
      console.log(`tick=${t} frame=${frameCount} totalB=${membrane.totalMass().toFixed(1)} foodLeft=${foodLeft.toFixed(1)}`);
      lastReport = t;
    }
  }
}
gif.finish();
const bytes = gif.bytes();
const path = resolve(OUT, 'membrane.gif');
writeFileSync(path, bytes);
console.log(`\nwrote ${frameCount} frames to ${path} (${(bytes.length / 1024).toFixed(1)} KB)`);
