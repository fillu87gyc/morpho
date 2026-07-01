// 単一ペイン: 膜(BiomassField) の上に管(Edge) を重ねる。
// 本物の粘菌の見た目 — 黄色の膜の中に少し濃い管が走る — に寄せる。

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
const TILE = 8;
const W = FIELD * TILE;
const H = FIELD * TILE;

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

function blend(png: PNG, x: number, y: number, r: number, g: number, b: number, a: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const inv = 1 - a;
  png.data[i] = png.data[i] * inv + r * a;
  png.data[i + 1] = png.data[i + 1] * inv + g * a;
  png.data[i + 2] = png.data[i + 2] * inv + b * a;
  png.data[i + 3] = 255;
}

function lineGlow(png: PNG, x0: number, y0: number, x1: number, y1: number,
                  coreW: number, glowW: number,
                  core: [number, number, number], glow: [number, number, number]) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - glowW - 2));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1) + glowW + 2));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - glowW - 2));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1) + glowW + 2));
  const dx = x1 - x0, dy = y1 - y0;
  const L2 = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = L2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / L2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = x0 + dx * t, py = y0 + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d <= glowW) {
        if (d <= coreW) {
          // 中心: くっきり
          const a = 1 - Math.max(0, d - (coreW - 1));
          blend(png, x, y, core[0], core[1], core[2], Math.min(1, a));
        } else {
          // 外周: 柔らかい halo
          const k = 1 - (d - coreW) / (glowW - coreW);
          const a = 0.55 * k * k;
          blend(png, x, y, glow[0], glow[1], glow[2], a);
        }
      }
    }
  }
}

function renderFrame(tick: number, snap: SimState, bioField: BiomassField, envRef: GridEnvironment) {
  const png = new PNG({ width: W, height: H });
  // 背景: 暗い培地
  for (let i = 0; i < W * H * 4; i += 4) {
    png.data[i] = 6; png.data[i + 1] = 5; png.data[i + 2] = 9; png.data[i + 3] = 255;
  }

  // (1) 食料: 薄緑のグラデ
  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const nut = envRef.nutrients.data[fy * FIELD + fx] ?? 0;
      if (nut < 0.05) continue;
      const a = Math.min(0.55, nut * 0.5);
      const x0 = fx * TILE, y0 = fy * TILE;
      for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
        blend(png, x0 + dx, y0 + dy, 50, 180, 70, a);
      }
    }
  }
  // (2) 障害物: グレーで明示
  for (let fy = 0; fy < FIELD; fy++) {
    for (let fx = 0; fx < FIELD; fx++) {
      const ob = envRef.obstacle.data[fy * FIELD + fx] ?? 0;
      if (ob < 0.5) continue;
      const x0 = fx * TILE, y0 = fy * TILE;
      for (let dy = 0; dy < TILE; dy++) for (let dx = 0; dx < TILE; dx++) {
        blend(png, x0 + dx, y0 + dy, 70, 65, 75, 0.9);
      }
    }
  }

  // (3) 膜 (BiomassField) を黄色いセル質として滲ませる
  // バイリニアで滑らかに、密度に応じて黄→金→白の階調
  let maxV = 0;
  for (let i = 0; i < bioField.field.data.length; i++) {
    const v = bioField.field.data[i] ?? 0;
    if (v > maxV) maxV = v;
  }
  maxV = Math.max(maxV, 0.4);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // バイリニア sample
      const fxF = x / TILE, fyF = y / TILE;
      const fx0 = Math.floor(fxF), fy0 = Math.floor(fyF);
      const fx1 = Math.min(FIELD - 1, fx0 + 1), fy1 = Math.min(FIELD - 1, fy0 + 1);
      const tx = fxF - fx0, ty = fyF - fy0;
      const v00 = bioField.field.data[fy0 * FIELD + fx0] ?? 0;
      const v10 = bioField.field.data[fy0 * FIELD + fx1] ?? 0;
      const v01 = bioField.field.data[fy1 * FIELD + fx0] ?? 0;
      const v11 = bioField.field.data[fy1 * FIELD + fx1] ?? 0;
      const v = ((v00 * (1 - tx) + v10 * tx) * (1 - ty) +
                 (v01 * (1 - tx) + v11 * tx) * ty) / maxV;
      if (v < 0.02) continue;
      // ガンマ補正で「縁が霞む」感じを出す
      const k = Math.pow(Math.min(1, v), 0.55);
      // 黄色→金→白
      const r = 240;
      const g = Math.floor(190 + 50 * Math.max(0, k - 0.5) * 2);
      const b = Math.floor(80 + 130 * Math.max(0, k - 0.6) * 2);
      const a = Math.min(0.85, 0.18 + k * 0.65);
      blend(png, x, y, r, g, b, a);
    }
  }

  // (4) 骨格 (Edge): 膜の中を走る管。flux と radius で太さ・明るさを決める。
  const nodeMap = new Map(snap.nodes.map(n => [n.id, n]));
  const scale = W / WORLD;
  // 太い管を後に描くため、まず細い管を、次に太い管を順に
  const sorted = [...snap.edges].sort((a, b) => a.radius - b.radius);
  for (const e of sorted) {
    const a = nodeMap.get(e.from), b = nodeMap.get(e.to);
    if (!a || !b) continue;
    const fluxN = Math.min(1, e.flux / 5);
    // 太さ: radius が主、flux で補強
    const core = Math.max(1.0, e.radius * 1.2 + fluxN * 1.4);
    const glow = core + 2.5;
    // 色: 膜より赤寄り・暗めの「茶橙」が中心、glow は黄。
    // 流れがあるエッジほど暗く濃く見える (本物の管も外側より少し暗い)。
    const t = Math.min(1, fluxN * 0.7 + e.radius * 0.25);
    const coreC: [number, number, number] = [
      Math.floor(160 - 40 * t),
      Math.floor(95  - 30 * t),
      Math.floor(35  + 10 * t),
    ];
    const glowC: [number, number, number] = [255, 210, 110];
    lineGlow(png,
      a.pos.x * scale, a.pos.y * scale,
      b.pos.x * scale, b.pos.y * scale,
      core, glow, coreC, glowC);
  }

  // (5) ノード: source(青) と sink(緑) のみ目立たせる
  for (const n of snap.nodes) {
    if (n.type === 'relay') continue;
    const cx = n.pos.x * scale, cy = n.pos.y * scale;
    const r = 5;
    const [r2, g2, b2] = n.type === 'source' ? [120, 200, 255] : [120, 255, 140];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d <= r) blend(png, cx + dx, cy + dy, r2, g2, b2, 1 - d / r);
    }
  }

  const path = resolve(OUT, `frame-${String(tick).padStart(4, '0')}.png`);
  writeFileSync(path, PNG.sync.write(png));
  console.log(`tick=${tick} edges=${snap.edges.length} nodes=${snap.nodes.length} maxBio=${maxV.toFixed(2)}`);
}

const SNAP_AT = [60, 150, 280, 450, 700, 1000, 1400];
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
