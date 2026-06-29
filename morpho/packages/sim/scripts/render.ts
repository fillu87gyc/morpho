// 動作確認用レンダラ。
// 左: BiomassField のヒートマップ（膜）
// 右: 同じ tick の Edge ネットワーク（骨格）
// 数 tick おきに PNG を吐く。

import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createInitialState, seedSource, createRNG, GridEnvironment, clearAroundSource,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, step,
  type SimState,
} from '../src/index.js';

const WORLD = 100;
const FIELD = 64;
const TILE = 6;          // 1セル何ピクセル
const PANE = FIELD * TILE;
const W = PANE * 2 + 16; // 左パネル + ガター + 右パネル
const H = PANE;

const OUT = resolve('renders');
mkdirSync(OUT, { recursive: true });

const rng = createRNG(7);
const env = new GridEnvironment({ worldSize: WORLD, fieldSize: FIELD });
env.placeFood({ x: 20, y: 25 }, 7, 1.0);
env.placeFood({ x: 80, y: 25 }, 7, 1.0);
env.placeFood({ x: 80, y: 80 }, 7, 1.0);
env.placeFood({ x: 20, y: 80 }, 7, 1.0);
env.placeStone({ x: 50, y: 55 }, 5);
const act = new ActivityField(WORLD, FIELD);
const bio = new BiomassField(WORLD, FIELD);
const SOURCE = { x: 50, y: 30 };
const state = createInitialState(7, WORLD);
clearAroundSource(env, SOURCE, 6);
seedSource(state, SOURCE, 8);
const bus = new EventBus();

function putPixel(png: PNG, x: number, y: number, r: number, g: number, b: number, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a;
}

function lineAA(png: PNG, x0: number, y0: number, x1: number, y1: number, w: number, r: number, g: number, b: number) {
  // 太線: distance-to-segment で塗る
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - w - 1));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + w + 1));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - w - 1));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + w + 1));
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = L2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / L2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = x0 + dx * t, py = y0 + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d <= w) {
        const a = 1 - Math.max(0, d - (w - 1));
        const i = (y * W + x) * 4;
        const inv = 1 - a;
        png.data[i] = png.data[i] * inv + r * a;
        png.data[i + 1] = png.data[i + 1] * inv + g * a;
        png.data[i + 2] = png.data[i + 2] * inv + b * a;
        png.data[i + 3] = 255;
      }
    }
  }
}

function colormap(v: number): [number, number, number] {
  // 黒→紫→橙→白。低密度を背景に溶かしたいので γ を効かせる。
  const t = Math.max(0, Math.min(1, Math.pow(v, 0.7)));
  const r = Math.min(255, Math.floor(255 * Math.min(1, t * 2.0)));
  const g = Math.min(255, Math.floor(255 * Math.max(0, Math.min(1, t * 2 - 0.6))));
  const b = Math.min(255, Math.floor(255 * Math.max(0, Math.min(1, 0.8 - Math.abs(t - 0.3) * 2.5) + Math.max(0, t - 0.85) * 4)));
  return [r, g, b];
}

function renderFrame(tick: number, snap: SimState, bioField: BiomassField, envRef: GridEnvironment) {
  const png = new PNG({ width: W, height: H });
  // 背景
  for (let i = 0; i < W * H * 4; i += 4) {
    png.data[i] = 8; png.data[i + 1] = 8; png.data[i + 2] = 14; png.data[i + 3] = 255;
  }

  // 左パネル: biomass ヒートマップ
  const maxV = (() => {
    let m = 0;
    for (let i = 0; i < bioField.field.data.length; i++) {
      const v = bioField.field.data[i] ?? 0;
      if (v > m) m = v;
    }
    return Math.max(m, 0.4);
  })();

  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const v = (bioField.field.data[fy * FIELD + fx] ?? 0) / maxV;
      const [r, g, b] = colormap(v);
      const x0 = fx * TILE, y0 = fy * TILE;
      for (let dy = 0; dy < TILE; dy++) {
        for (let dx = 0; dx < TILE; dx++) {
          putPixel(png, x0 + dx, y0 + dy, r, g, b);
        }
      }
    }
  }

  // 左パネルに食料 (緑) と障害物 (グレー) を控えめに重ねる
  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const nut = envRef.nutrients.data[fy * FIELD + fx] ?? 0;
      const ob = envRef.obstacle.data[fy * FIELD + fx] ?? 0;
      if (nut > 0.2) {
        const a = Math.min(0.45, nut * 0.4);
        const x0 = fx * TILE, y0 = fy * TILE;
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          const idx = ((y0 + dy) * W + (x0 + dx)) * 4;
          png.data[idx] = png.data[idx] * (1 - a) + 60 * a;
          png.data[idx + 1] = png.data[idx + 1] * (1 - a) + 220 * a;
          png.data[idx + 2] = png.data[idx + 2] * (1 - a) + 90 * a;
        }
      }
      if (ob > 0.5) {
        const x0 = fx * TILE, y0 = fy * TILE;
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          const idx = ((y0 + dy) * W + (x0 + dx)) * 4;
          png.data[idx] = 70; png.data[idx + 1] = 70; png.data[idx + 2] = 80;
        }
      }
    }
  }

  // 右パネル: ネットワーク（骨格）
  const offX = PANE + 16;
  // パネル背景
  for (let y = 0; y < PANE; y++) {
    for (let x = 0; x < PANE; x++) {
      putPixel(png, offX + x, y, 18, 18, 26);
    }
  }
  // 食料・障害物を右にも軽く
  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const nut = envRef.nutrients.data[fy * FIELD + fx] ?? 0;
      const ob = envRef.obstacle.data[fy * FIELD + fx] ?? 0;
      const x0 = offX + fx * TILE, y0 = fy * TILE;
      if (nut > 0.2) {
        const a = Math.min(0.3, nut * 0.3);
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          const idx = ((y0 + dy) * W + (x0 + dx)) * 4;
          png.data[idx] = png.data[idx] * (1 - a) + 60 * a;
          png.data[idx + 1] = png.data[idx + 1] * (1 - a) + 200 * a;
          png.data[idx + 2] = png.data[idx + 2] * (1 - a) + 90 * a;
        }
      }
      if (ob > 0.5) {
        for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
          const idx = ((y0 + dy) * W + (x0 + dx)) * 4;
          png.data[idx] = 70; png.data[idx + 1] = 70; png.data[idx + 2] = 80;
        }
      }
    }
  }

  // エッジを描画
  const nodeMap = new Map(snap.nodes.map(n => [n.id, n]));
  const scale = PANE / WORLD;
  for (const e of snap.edges) {
    const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const w = Math.max(1, e.radius * 1.4);
    const intensity = Math.min(1, e.activity * 0.6 + e.radius * 0.25);
    const cr = 220, cg = Math.floor(140 + 110 * intensity), cb = Math.floor(80 + 160 * (1 - intensity));
    lineAA(png, offX + a.pos.x * scale, a.pos.y * scale, offX + b.pos.x * scale, b.pos.y * scale, w, cr, cg, cb);
  }

  // ノード
  for (const n of snap.nodes) {
    const cx = offX + n.pos.x * scale, cy = n.pos.y * scale;
    const r = n.type === 'source' ? 4 : n.type === 'sink' ? 4 : 2;
    const [r2, g2, b2] =
      n.type === 'source' ? [120, 200, 255] :
      n.type === 'sink'   ? [120, 255, 140] :
                            [220, 200, 160];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r) putPixel(png, cx + dx, cy + dy, r2, g2, b2);
    }
  }

  const path = resolve(OUT, `frame-${String(tick).padStart(4, '0')}.png`);
  writeFileSync(path, PNG.sync.write(png));
  console.log(`wrote ${path} (edges=${snap.edges.length}, nodes=${snap.nodes.length}, maxBio=${maxV.toFixed(2)})`);
}

// メインループ
const SNAP_AT = [30, 80, 150, 240, 360, 540, 800];
let nextIdx = 0;
const total = SNAP_AT[SNAP_AT.length - 1]!;
for (let t = 0; t <= total; t++) {
  step(state, env, act, bio, DEFAULT_PARAMS, rng, bus);
  if (nextIdx < SNAP_AT.length && t === SNAP_AT[nextIdx]) {
    renderFrame(t, state, bio, env);
    nextIdx++;
  }
}

console.log(`\nDone. ${SNAP_AT.length} frames in ${OUT}`);
