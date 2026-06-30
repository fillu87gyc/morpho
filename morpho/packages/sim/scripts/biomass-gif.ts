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
// 完全な格子配置だと膜が対称に4分岐して退屈な十字になる。
// 各食料を不揃いの方向・サイズ・量にして、膜の探索戦略が見えるようにする。
// 大きい食料ほど引力が強く長く保たれ、小さい食料は素早く食べ尽くされる。
env.placeFood({ x: 17, y: 22 }, 10.0, 1.3);  // 左上 大: ごちそう
env.placeFood({ x: 83, y: 28 },  4.5, 0.8);  // 右上 小: つまみ
env.placeFood({ x: 76, y: 84 },  8.0, 1.1);  // 右下 中
env.placeFood({ x: 24, y: 77 },  6.0, 0.6);  // 左下 中サイズ・薄い
env.placeStone({ x: 48, y: 57 }, 5);        // 中央障害物も少しオフセット

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

  // 膜本体 + 前縁グロー。両方とも物理量 (B, |v|·B) から派生。
  // 以前あった brightness *= sin(phase) の演出オーバーレイは撤廃。
  // 呼吸が見えるかどうかは physics (P の振動 → 膜の伸縮) に任せる。
  let maxV = 0, maxF = 0, maxT = 0;
  for (let i = 0; i < FIELD * FIELD; i++) {
    const v = membrane.B.data[i] ?? 0;
    if (v > maxV) maxV = v;
    const f = membrane.flowMag.data[i] ?? 0;
    if (f > maxF) maxF = f;
    const t = membrane.traffic.data[i] ?? 0;
    if (t > maxT) maxT = t;
  }
  maxV = Math.max(maxV, 0.3);
  maxF = Math.max(maxF, 1e-4);
  maxT = Math.max(maxT, 1e-4);
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

      // 前縁シグナル (短期の流れ、隣接 4 セルから補間)
      const f00 = membrane.flowMag.data[fy0 * FIELD + fx0] ?? 0;
      const f10 = membrane.flowMag.data[fy0 * FIELD + fx1] ?? 0;
      const f01 = membrane.flowMag.data[fy1 * FIELD + fx0] ?? 0;
      const f11 = membrane.flowMag.data[fy1 * FIELD + fx1] ?? 0;
      const fNorm = ((f00 * (1 - tx) + f10 * tx) * (1 - ty) +
                     (f01 * (1 - tx) + f11 * tx) * ty) / maxF;
      const front = Math.min(1, fNorm * 1.6);

      // Traffic (長期の流量履歴、管シグナル)。これが膜内の persistent な流路。
      const t00 = membrane.traffic.data[fy0 * FIELD + fx0] ?? 0;
      const t10 = membrane.traffic.data[fy0 * FIELD + fx1] ?? 0;
      const t01 = membrane.traffic.data[fy1 * FIELD + fx0] ?? 0;
      const t11 = membrane.traffic.data[fy1 * FIELD + fx1] ?? 0;
      const tNorm = ((t00 * (1 - tx) + t10 * tx) * (1 - ty) +
                     (t01 * (1 - tx) + t11 * tx) * ty) / maxT;
      // 閾値を下げて、控えめな管も拾う
      const tube = Math.max(0, Math.min(1, (tNorm - 0.12) / 0.55));

      // 密度カーブを steeper にしてコア (B>0.5) は十分明るく、
      // エッジ (B<0.3) は強く減衰する。これで内部の厚みの違いが見える。
      const vN = Math.min(1, v);
      const k = Math.pow(vN, 0.85);
      // 色 (B 由来): ベースの肉色
      let r = 230 + front * 22;
      let g = 160 + 90 * Math.max(0, k - 0.45) * 1.8 + front * 60;
      let b = 40 + 180 * Math.max(0, k - 0.65) * 3 + front * 100;
      // 管 overlay: 膜の中に青白い persistent な筋を描く。
      // 強度・閾値とも v1 より強め。B 上に乗っている所だけ光らせる。
      if (tube > 0 && vN > 0.10) {
        const tg = Math.min(1, tube * 1.3);
        r = r * (1 - tg * 0.55) + 235 * tg;
        g = g * (1 - tg * 0.35) + 248 * tg;
        b = b * (1 - tg * 0.10) + 255 * tg;
      }
      r = Math.min(255, r);
      g = Math.min(255, g);
      b = Math.min(255, b);
      // α もコア優位に: 縁は透けて消えるが、芯は重く乗る
      const a = Math.min(0.96, Math.pow(vN, 0.6) * 0.85 + front * 0.12 + tube * 0.10);
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
