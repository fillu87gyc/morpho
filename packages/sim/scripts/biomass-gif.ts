// 「シャーレに広がる粘菌」をめざしたデモ GIF。
// グラフ系 (Edge/Node) を使う — これは実際に枝分かれする。
// 膜系 (Membrane) は連続体で blob を描くだけなので、参照映像の
// 「黄色いツリー状の脈管網」を再現できない。
//
// ビジュアル設計:
//   - 暗い背景に薄灰色のペトリ皿 (径方向グラデ + リム反射)
//   - 食料は淡いタン色の楕円 (パン/オートミール風)
//   - 黄色の biomass field を「肉」(プラズモジウム) として広く滲ませ
//   - グラフのエッジを「管」として上から明るく描く
//   - 中央のソース節点だけ静かに示す

// @ts-ignore .mjs ファイルへの直接 import
import { GIFEncoder, quantize, applyPalette } from './gifenc.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createInitialState, seedSource, createRNG, GridEnvironment, clearAroundSource,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, step,
  type SimState, type SimParams,
} from '../src/index.js';

const WORLD = 100;
const FIELD = 96;          // 64 → 96: 細かい枝のために密度を上げる
const TILE = 6;            // 96×6 = 576px (membrane 旧版と同等の解像度)
const W = FIELD * TILE;
const H = FIELD * TILE;
const CX = W / 2;
const CY = H / 2;
const DISH_R = Math.min(W, H) * 0.47;

const OUT = resolve('renders-gif');
mkdirSync(OUT, { recursive: true });

const rng = createRNG(7);
const env = new GridEnvironment({ worldSize: WORLD, fieldSize: FIELD });
// 構図: 中央のオートミール (=ソース) から放射状にツルが伸び、
// 皿の各所に置いた食料 (オーツ片) に到達して網になる。
// 源を食料の上に置くと初手で全 tip が sink になる (高栄養領域内では
// growFromTip が即 sink を作って tip が消える) → 一切広がらないので、
// 源と食料は重ねない。中央のオート粒は描画でだけ示す。
const OATMEAL = { x: 50, y: 50 };
// 皿の周辺 6 箇所に食料 (距離・大きさをばらつかせる)
env.placeFood({ x: 22, y: 22 }, 4.5, 0.95);
env.placeFood({ x: 78, y: 22 }, 5.0, 1.10);
env.placeFood({ x: 82, y: 55 }, 4.0, 0.85);
env.placeFood({ x: 78, y: 80 }, 5.0, 1.05);
env.placeFood({ x: 22, y: 78 }, 4.5, 0.95);
env.placeFood({ x: 18, y: 50 }, 4.0, 0.85);

const act = new ActivityField(WORLD, FIELD);
const bio = new BiomassField(WORLD, FIELD);
const state = createInitialState(7, WORLD);
clearAroundSource(env, OATMEAL, 4);
seedSource(state, OATMEAL, 6); // 既定 6 (radius=2 で間隔 2.1 > mergeRadius)
const bus = new EventBus();

// 参照映像の「広く伸びる脈管網」を出すための tuning。
// DEFAULT_PARAMS はテストで参照されるので触らず、スクリプト側で上書きする。
const PARAMS: SimParams = {
  ...DEFAULT_PARAMS,
  growthStep: 3.6,                  // 3.0 → 3.6 (一歩を大きく)
  candidateSpreadBase: 1.0,         // 0.8 → 1.0 (枝振りを広く)
  growthActivityThreshold: 0.20,    // 0.35 → 0.20 (枯死しにくく)
  growthProbability: 0.85,          // 0.6  → 0.85 (前進機会を増やす)
  branchProbabilityBase: 0.10,      // 0.04 → 0.10
  branchActivityThreshold: 0.35,    // 0.5 → 0.35 (枝が増えやすく)
  pruneRadius: 0.18,                // 0.35 → 0.18 (細い管を残す)
  fatigueGrow: 0.008,               // 0.015 → 0.008 (老化を遅く)
  // 探索バイアス: 1 つの食料へ集中しないよう gradient を弱め、
  // 代わりに lateralBud を強くしてあちこちに枝を生やす。
  nutrientBias: 2.5,                // 既定戻し
  gradientBias: 0.4,                // 0.6 → 0.4 (向きを引き寄せすぎない)
  noiseAmount: 0.30,                // 0.10 → 0.30 (探索ノイズ大)
  worldMargin: 5,                   // 1    → 5
  mergeRadius: 1.2,                 // 1.8 → 1.2 (近接マージで管が短絡しにくく)
  lateralBudBiomassThreshold: 0.20, // 0.9 → 0.20 (横芽が出やすい)
  lateralBudProbability: 0.30,      // 0.18 → 0.30
  // 膜は「肉」じゃなく「管の周囲のうっすらした jelly」として描きたいので、
  // 既定より薄めに、半径も狭めに、減衰は速めにする。
  // こうしないと後半でシャーレ全面が黄色 1 色になり管が消える。
  biomassDeposit: 0.06,             // 0.18 → 0.06
  biomassRadius: 2.2,               // 2.6  → 2.2
  biomassDiffusion: 0.04,           // 0.05 → 0.04
  biomassDecay: 0.025,              // 0.012 → 0.025 (半減期≈28 tick)
};

// シャーレ枠 (描画専用)。世界座標で半径 ≈ 48 のディスク内のみ描く。
function inDish(x: number, y: number): boolean {
  const dx = x - CX, dy = y - CY;
  return dx * dx + dy * dy <= DISH_R * DISH_R;
}

// ── 配色 ────────────────────────────────────────────────
// ペトリ皿: 薄い灰白〜温かい灰のラジアル
const DISH_INNER: [number, number, number] = [228, 224, 213];
const DISH_OUTER: [number, number, number] = [188, 184, 176];
const DISH_RIM:   [number, number, number] = [110, 105, 100];
const BG:         [number, number, number] = [18, 17, 20];
// 食料 (パン): 淡いオートミール色
const FOOD_HI:    [number, number, number] = [232, 218, 188];
const FOOD_LO:    [number, number, number] = [188, 168, 132];
// プラズモジウム (黄〜金〜白)
const PLASMA_RIM: [number, number, number] = [200, 170, 60];
const PLASMA_MID: [number, number, number] = [232, 195, 70];
const PLASMA_HI:  [number, number, number] = [255, 230, 130];
const TUBE_CORE:  [number, number, number] = [255, 240, 170];
const SOURCE_DOT: [number, number, number] = [40, 40, 50];

function setPx(rgba: Uint8Array, x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
}

function blendPx(rgba: Uint8Array, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  const i = (y * W + x) * 4;
  const inv = 1 - a;
  rgba[i]     = (rgba[i]     ?? 0) * inv + r * a;
  rgba[i + 1] = (rgba[i + 1] ?? 0) * inv + g * a;
  rgba[i + 2] = (rgba[i + 2] ?? 0) * inv + b * a;
  rgba[i + 3] = 255;
}

function paintBackground(rgba: Uint8Array) {
  // 暗い背景一色で塗りつぶし
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4]     = BG[0];
    rgba[i * 4 + 1] = BG[1];
    rgba[i * 4 + 2] = BG[2];
    rgba[i * 4 + 3] = 255;
  }
  // シャーレ本体: 中央から外周への放射状グラデーション
  const r2max = DISH_R * DISH_R;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - CX, dy = y - CY;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2max) continue;
      const t = Math.sqrt(d2) / DISH_R; // 0 中心, 1 外周
      // 中心は明るく、外周は少し暗く
      const k = Math.pow(t, 1.4);
      const r = DISH_INNER[0] * (1 - k) + DISH_OUTER[0] * k;
      const g = DISH_INNER[1] * (1 - k) + DISH_OUTER[1] * k;
      const b = DISH_INNER[2] * (1 - k) + DISH_OUTER[2] * k;
      setPx(rgba, x, y, r, g, b);
    }
  }
  // リム (細い暗い縁 + すぐ内側のハイライト線)
  const rim = DISH_R;
  for (let theta = 0; theta < Math.PI * 2; theta += 0.0007) {
    const cs = Math.cos(theta), sn = Math.sin(theta);
    for (let dr = -2; dr <= 2; dr++) {
      const r = rim + dr;
      const x = Math.round(CX + cs * r);
      const y = Math.round(CY + sn * r);
      const a = dr === 0 ? 1.0 : 0.55 - Math.abs(dr) * 0.15;
      blendPx(rgba, x, y, DISH_RIM[0], DISH_RIM[1], DISH_RIM[2], a);
    }
    // すぐ内側に薄いハイライト
    const r2 = rim - 4;
    const x2 = Math.round(CX + cs * r2);
    const y2 = Math.round(CY + sn * r2);
    blendPx(rgba, x2, y2, 245, 240, 230, 0.35);
  }
}

function paintFood(rgba: Uint8Array) {
  // env.nutrients を皿の上にオートミールっぽく描く
  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const n = env.nutrients.data[fy * FIELD + fx] ?? 0;
      if (n < 0.05) continue;
      const x0 = fx * TILE, y0 = fy * TILE;
      const t = Math.min(1, n * 0.8);
      const r = FOOD_LO[0] * (1 - t) + FOOD_HI[0] * t;
      const g = FOOD_LO[1] * (1 - t) + FOOD_HI[1] * t;
      const b = FOOD_LO[2] * (1 - t) + FOOD_HI[2] * t;
      const a = Math.min(0.95, 0.35 + n * 0.5);
      for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
        const X = x0 + dx, Y = y0 + dy;
        if (!inDish(X, Y)) continue;
        blendPx(rgba, X, Y, r, g, b, a);
      }
    }
  }
}

// 双線形補間で密度を読む
function sampleBio(x: number, y: number): number {
  const fxF = x / TILE, fyF = y / TILE;
  const fx0 = Math.floor(fxF), fy0 = Math.floor(fyF);
  const fx1 = Math.min(FIELD - 1, fx0 + 1), fy1 = Math.min(FIELD - 1, fy0 + 1);
  const tx = fxF - fx0, ty = fyF - fy0;
  const v00 = bio.field.data[fy0 * FIELD + fx0] ?? 0;
  const v10 = bio.field.data[fy0 * FIELD + fx1] ?? 0;
  const v01 = bio.field.data[fy1 * FIELD + fx0] ?? 0;
  const v11 = bio.field.data[fy1 * FIELD + fx1] ?? 0;
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) +
         (v01 * (1 - tx) + v11 * tx) * ty;
}

function paintPlasma(rgba: Uint8Array) {
  // biomass を「黄色い肉」として皿の上に重ねる
  let maxV = 0;
  for (let i = 0; i < bio.field.data.length; i++) {
    const v = bio.field.data[i] ?? 0;
    if (v > maxV) maxV = v;
  }
  maxV = Math.max(maxV, 0.6);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inDish(x, y)) continue;
      const v = sampleBio(x, y) / maxV;
      if (v < 0.025) continue;
      // 縁を強調するため: 低 v ほど色は薄い黄に倒し、α もカーブで落とす
      const k = Math.pow(Math.min(1, v), 0.55);
      let r: number, g: number, b: number;
      if (k < 0.5) {
        const t = k / 0.5;
        r = PLASMA_RIM[0] * (1 - t) + PLASMA_MID[0] * t;
        g = PLASMA_RIM[1] * (1 - t) + PLASMA_MID[1] * t;
        b = PLASMA_RIM[2] * (1 - t) + PLASMA_MID[2] * t;
      } else {
        const t = (k - 0.5) / 0.5;
        r = PLASMA_MID[0] * (1 - t) + PLASMA_HI[0] * t;
        g = PLASMA_MID[1] * (1 - t) + PLASMA_HI[1] * t;
        b = PLASMA_MID[2] * (1 - t) + PLASMA_HI[2] * t;
      }
      const a = Math.min(0.92, 0.12 + k * 0.78);
      blendPx(rgba, x, y, r, g, b, a);
    }
  }
}

// 線分を「グロー付きチューブ」として描く。コアは明るい黄、外側は柔らかい halo。
function paintTube(
  rgba: Uint8Array,
  x0: number, y0: number, x1: number, y1: number,
  coreW: number, glowW: number,
  core: [number, number, number],
  glow: [number, number, number],
) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - glowW - 2));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + glowW + 2));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - glowW - 2));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + glowW + 2));
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!inDish(x, y)) continue;
      let t = L2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / L2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = x0 + dx * t, py = y0 + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d > glowW) continue;
      if (d <= coreW) {
        // コア: しっかり乗る
        const a = Math.min(1, coreW - d + 0.3);
        blendPx(rgba, x, y, core[0], core[1], core[2], Math.min(1, a));
      } else {
        // halo: 滑らかに減衰
        const k = 1 - (d - coreW) / (glowW - coreW);
        const a = 0.45 * k * k;
        blendPx(rgba, x, y, glow[0], glow[1], glow[2], a);
      }
    }
  }
}

function paintNetwork(rgba: Uint8Array, snap: SimState) {
  const scale = W / WORLD;
  const nodeMap = new Map(snap.nodes.map(n => [n.id, n]));
  // 2 パス。先に「halo」(柔らかい黄色のグロー) を全エッジに対して大きく描く →
  // 次に「coreチューブ」(濃いオレンジの管本体) を半径順に小さく描く。
  // 結果: 黄色いプラズマ越しに、内部を走る茶色〜オレンジの脈管が見える。
  const sorted = [...snap.edges].sort((a, b) => a.radius - b.radius);

  // pass 1: 大きい halo (黄色)
  for (const e of sorted) {
    const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const fluxN = Math.min(1, e.flux / 5);
    const baseW = Math.max(1.2, e.radius * 1.4 + fluxN * 1.2);
    const haloW = baseW + 4.5;
    paintTube(rgba,
      a.pos.x * scale, a.pos.y * scale,
      b.pos.x * scale, b.pos.y * scale,
      baseW * 0.4, haloW,
      [PLASMA_HI[0], PLASMA_HI[1], PLASMA_HI[2]],
      [PLASMA_MID[0], PLASMA_MID[1], PLASMA_MID[2]]);
  }

  // pass 2: 管本体 (濃い色のコア)。脈管らしさを出すために
  // 「明るい縁取り」を持つ二重の管にする。
  for (const e of sorted) {
    const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const fluxN = Math.min(1, e.flux / 5);
    const tubeW = Math.max(0.7, e.radius * 1.05 + fluxN * 1.4);
    const t = Math.min(1, fluxN * 0.65 + Math.min(1, e.radius / 2) * 0.55);
    // 太い・流量多い管ほど濃いオレンジ → 細い枝はクリーム色
    const coreC: [number, number, number] = [
      Math.floor(245 - 60 * t),
      Math.floor(205 - 70 * t),
      Math.floor(110 - 60 * t),
    ];
    paintTube(rgba,
      a.pos.x * scale, a.pos.y * scale,
      b.pos.x * scale, b.pos.y * scale,
      tubeW * 0.45, tubeW,
      coreC,
      [TUBE_CORE[0], TUBE_CORE[1], TUBE_CORE[2]]);
  }

  // ソース節点 (オートミールの中心) はオートミール片の小さな塊として描く
  for (const n of snap.nodes) {
    if (n.type !== 'source') continue;
    const cx = n.pos.x * scale, cy = n.pos.y * scale;
    // 小さなオートミール片の chunk (淡褐色の楕円)
    for (let dy = -7; dy <= 7; dy++) for (let dx = -10; dx <= 10; dx++) {
      const d = Math.hypot(dx / 1.3, dy);
      if (d > 7) continue;
      const a = Math.max(0, 1 - d / 7);
      const r = FOOD_HI[0] * 0.95;
      const g = FOOD_HI[1] * 0.92;
      const b = FOOD_HI[2] * 0.85;
      blendPx(rgba, cx + dx, cy + dy, r, g, b, a * 0.65);
    }
  }
}

function renderFrameRGBA(snap: SimState): Uint8Array {
  const rgba = new Uint8Array(W * H * 4);
  paintBackground(rgba);
  paintFood(rgba);
  paintPlasma(rgba);
  paintNetwork(rgba, snap);
  return rgba;
}

const TOTAL_TICKS = 2400;
const FRAME_INTERVAL = 12;
const FRAME_DELAY_MS = 70;

const gif = GIFEncoder();
let frameCount = 0;
let lastReport = 0;

console.log(`Running ${TOTAL_TICKS} ticks, frame every ${FRAME_INTERVAL} ticks at ${W}x${H}...`);
for (let t = 0; t < TOTAL_TICKS; t++) {
  step(state, env, act, bio, PARAMS, rng, bus);
  if (t % FRAME_INTERVAL === 0) {
    const rgba = renderFrameRGBA(state);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, W, H, { palette, delay: FRAME_DELAY_MS });
    frameCount++;
    if (t - lastReport >= 300) {
      let foodLeft = 0;
      for (let i = 0; i < FIELD * FIELD; i++) foodLeft += env.nutrients.data[i] ?? 0;
      console.log(`tick=${t} frame=${frameCount} edges=${state.edges.length} nodes=${state.nodes.length} foodLeft=${foodLeft.toFixed(1)}`);
      lastReport = t;
    }
  }
}
gif.finish();
const bytes = gif.bytes();
const path = resolve(OUT, 'membrane.gif');
writeFileSync(path, bytes);
console.log(`\nwrote ${frameCount} frames to ${path} (${(bytes.length / 1024).toFixed(1)} KB)`);
