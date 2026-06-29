// Membrane: 「肉」を主役にした実験モデル。
//
// 既存モデル (Edge → Biomass) ではなく、
// Biomass を一次変数とした reaction-diffusion + chemotaxis。
//
// 中身:
//   A: 活性化因子 (= biomass 密度) … 遅く拡散、自己触媒
//   H: 抑制因子                  … 速く拡散、A の濃いところで生まれる
//
// これだけで Turing 的に「厚いところ・薄いところ・空洞」が自発的に現れる。
// さらに以下を載せて「生きてる感」を作る:
//   - 大域呼吸 (sin(t)) × 局所ノイズで前線が脈打つ
//   - 栄養勾配へのケモタクシス (前進感)
//   - 障害物は A=0 + 拡散バリア (押し返される)
//
// この場には Edge は無い。Skeleton が欲しければあとから抽出する想定。

import type { Vec2 } from '../types.js';
import { makeField, type FieldGrid } from './field.js';
import type { GridEnvironment } from './field.js';
import type { SeededRNG } from '../rng.js';

export interface MembraneSource {
  pos: Vec2;
  rate: number;
}

export interface MembraneParams {
  // Reaction-diffusion (Gierer-Meinhardt 風)
  DA: number;            // A の拡散 (遅い)
  DH: number;            // H の拡散 (速い)
  rho: number;           // 自己触媒
  mu: number;            // A の自然減衰
  alpha: number;         // A が H を作る速さ
  beta: number;          // H の減衰
  baseProduction: number;// どこでも入る微量の生成
  saturation: number;    // A の上限
  // 環境カップリング
  nutrientBias: number;  // 栄養が濃いほど成長が速い
  obstaclePenalty: number;
  chemoStrength: number; // 栄養勾配に沿った drift
  // 呼吸
  pulsePeriod: number;   // tick
  pulseAmp: number;      // 0..1
  // ソース
  sourceRate: number;
  sourceRadius: number;
}

export const DEFAULT_MEMBRANE_PARAMS: MembraneParams = {
  DA: 0.14,
  DH: 0.45,
  rho: 0.7,
  mu: 0.045,
  alpha: 0.18,
  beta: 0.085,
  baseProduction: 0.0,
  saturation: 1.8,
  nutrientBias: 4.0,
  obstaclePenalty: 6.0,
  chemoStrength: 0.55,
  pulsePeriod: 90,
  pulseAmp: 0.55,
  sourceRate: 0.7,
  sourceRadius: 2.8,
};

export class Membrane {
  worldSize: number;
  size: number;
  A: FieldGrid;
  H: FieldGrid;
  private bufA: FieldGrid;
  private bufH: FieldGrid;
  private noise: FieldGrid; // 静的な per-cell 位相オフセット

  constructor(worldSize: number, size: number, rng: SeededRNG) {
    this.worldSize = worldSize;
    this.size = size;
    this.A = makeField(size);
    this.H = makeField(size);
    this.bufA = makeField(size);
    this.bufH = makeField(size);
    this.noise = makeField(size);
    for (let i = 0; i < size * size; i++) {
      // -π..π の位相オフセット → 局所的に呼吸のタイミングがズレる
      this.noise.data[i] = (rng.next() - 0.5) * 2 * Math.PI;
    }
  }

  step(tick: number, env: GridEnvironment, sources: MembraneSource[], p: MembraneParams): void {
    const N = this.size * this.size;
    const W = this.size;
    if (env.fieldSize !== this.size) {
      throw new Error(`Membrane fieldSize (${this.size}) != env.fieldSize (${env.fieldSize})`);
    }
    const nut = env.nutrients.data;
    const ob = env.obstacle.data;
    const phase = (2 * Math.PI * tick) / p.pulsePeriod;
    const globalPulse = 0.5 + 0.5 * Math.sin(phase);

    // (A) 反応項: A, H を bufA, bufH に書き出す
    for (let i = 0; i < N; i++) {
      const a = this.A.data[i] ?? 0;
      const h = this.H.data[i] ?? 0;
      const n = nut[i] ?? 0;
      const o = ob[i] ?? 0;
      // 障害物に当たっている細胞は生きていない
      if (o > 0.5) {
        this.bufA.data[i] = 0;
        this.bufH.data[i] = 0;
        continue;
      }
      const localPulse = 0.5 + 0.5 * p.pulseAmp * Math.sin(phase + (this.noise.data[i] ?? 0));
      // 自己触媒 / 抑制 (Gierer-Meinhardt の形に近い)
      const grow = (p.rho * a * a) / (0.04 + h) * (0.25 + p.nutrientBias * n) * localPulse;
      // 減衰: 障害物近くは弱く崩れる
      const decay = a * (p.mu + o * p.obstaclePenalty);
      // ベース生成 (どこでも微量、栄養が濃いと少し増える)
      const base = p.baseProduction * (0.3 + n) * globalPulse;
      this.bufA.data[i] = a + grow - decay + base;
      // 抑制因子: A の濃いところで生まれ、ゆっくり減衰
      this.bufH.data[i] = h + p.alpha * a - p.beta * h;
    }

    // (B) ソース注入: 呼吸に合わせて流量が脈打つ
    for (const src of sources) {
      const rate = src.rate * p.sourceRate * (0.4 + 0.7 * globalPulse);
      this.depositInto(this.bufA, src.pos, rate, p.sourceRadius);
    }

    // (C) 拡散: A は遅く、H は速く
    diffuseInto(this.bufA, this.A, W, p.DA);
    diffuseInto(this.bufH, this.H, W, p.DH);

    // (D) ケモタクシス: A は栄養勾配の方向へ少し drift
    if (p.chemoStrength > 0) {
      chemotaxis(this.A, this.bufA, nut, W, p.chemoStrength);
      // bufA に書いたものを A にスワップ
      const tmp = this.A.data; this.A.data = this.bufA.data; this.bufA.data = tmp;
    }

    // (E) 障害物カット & クランプ
    for (let i = 0; i < N; i++) {
      const o = ob[i] ?? 0;
      if (o > 0.5) {
        this.A.data[i] = 0;
        this.H.data[i] = 0;
      } else {
        let v = this.A.data[i] ?? 0;
        if (v < 0) v = 0; else if (v > p.saturation) v = p.saturation;
        this.A.data[i] = v;
        let hv = this.H.data[i] ?? 0;
        if (hv < 0) hv = 0;
        this.H.data[i] = hv;
      }
    }
  }

  private depositInto(target: FieldGrid, pos: Vec2, amount: number, radius: number): void {
    const s = this.size / this.worldSize;
    const cx = pos.x * s, cy = pos.y * s;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(this.size - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(this.size - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          const w = 1 - Math.sqrt(d2) / radius;
          const idx = y * this.size + x;
          target.data[idx] = (target.data[idx] ?? 0) + amount * w;
        }
      }
    }
  }
}

// in-place: src の値を 5-stencil で拡散して dst に書く
function diffuseInto(src: FieldGrid, dst: FieldGrid, size: number, D: number): void {
  const s = src.data, d = dst.data;
  const k = Math.min(0.95, Math.max(0, D));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const c = s[i] ?? 0;
      const l = x > 0 ? (s[i - 1] ?? 0) : c;
      const r = x < size - 1 ? (s[i + 1] ?? 0) : c;
      const u = y > 0 ? (s[i - size] ?? 0) : c;
      const dn = y < size - 1 ? (s[i + size] ?? 0) : c;
      d[i] = c + k * ((l + r + u + dn) * 0.25 - c);
    }
  }
}

// 栄養勾配 ∇C に沿った drift。
// 各セルから栄養が高い隣接セル「全部」へ流量を比例配分する。
// best-only より穏やかで、勾配の弱いところでも効くため遠くの食料にも届く。
function chemotaxis(src: FieldGrid, dst: FieldGrid, nut: Float32Array, size: number, k: number): void {
  const s = src.data, d = dst.data;
  for (let i = 0; i < size * size; i++) d[i] = s[i] ?? 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const a = s[i] ?? 0;
      if (a < 0.02) continue;
      const n = nut[i] ?? 0;
      const neigh: [number, number][] = [
        [i - 1, nut[i - 1] ?? 0],
        [i + 1, nut[i + 1] ?? 0],
        [i - size, nut[i - size] ?? 0],
        [i + size, nut[i + size] ?? 0],
      ];
      let totalDiff = 0;
      for (const [, val] of neigh) {
        const diff = val - n;
        if (diff > 0) totalDiff += diff;
      }
      if (totalDiff <= 0) continue;
      const moveTotal = a * k * Math.min(0.9, totalDiff * 6);
      for (const [idx, val] of neigh) {
        const diff = val - n;
        if (diff <= 0) continue;
        const share = moveTotal * (diff / totalDiff);
        d[i] -= share;
        d[idx] = (d[idx] ?? 0) + share;
      }
    }
  }
}
