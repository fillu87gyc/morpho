// Membrane (Minimal Flow v3): Pressure → Velocity → Biomass advection → Surface tension.
//
// 前バージョン (v2) は違和感を1つずつ潰すうちに、仮足生成・コア凝集・前縁ブースト・
// 張力呼吸・brightness 演出と補正項が積み上がった。理屈は通っていたが、
// 「Physarum を最小法則で書く」という当初の目標から離れ始めていた。
//
// この版では明示的に4則だけに絞る:
//   P[x,y]     : 圧力ポテンシャル (源と食料が pump、拡散・減衰)
//   v = ∇P × k : 速度場 (cell 中心の vector を明示保持)
//   B[x,y]     : 質量、v に沿って upwind 移流 (面通量で質量厳密保存)
//   surface T  : 境界バンドだけに効くスムージング (格子離散化の数値ノイズ抑え)
//
// 残った非自明な機構:
//   - bodyPulse: B 比例の per-cell 圧力振動。空間ノイズ phase で
//     全身が一律にならず、ここから非対称な押し出しと引き戻しが生まれる。
//     これは「源 pump + 食料 pump だけだと膜が単純な丸になる」のを
//     体内の力で打ち破る、唯一の追加 driver。
//
// 削ったもの (v2 にあった補正項):
//   - 仮足の explicit spawn: 体内 pulse + 食料配置の非対称で代用させる
//   - コア凝集 (B-self pressure): 源が継続 pump しているので不要
//   - 前縁ブースト: |v|·B 自体が前縁シグナル、boost を上乗せする物理理由がない
//   - 張力呼吸: surfaceTension は定数。膜の伸縮は P の振動から出る
//   - renderer の breath brightness: 物理量を演出で増幅するのは反則
//
// flowMag は |v|·B の time-smoothed 量。描画専用、物理にはフィードバックしない。

import type { Vec2 } from '../types.js';
import { makeField, type FieldGrid } from './field.js';
import type { GridEnvironment } from './field.js';
import type { SeededRNG } from '../rng.js';

export interface MembraneSource {
  pos: Vec2;
}

export interface MembraneParams {
  // 初期質量 (source の周りに置く)
  initialMass: number;
  initialRadius: number;
  // 圧力ソース
  foodPressure: number;     // 食料が出す静的引力
  sourcePump: number;       // 源が出す呼吸圧の振幅 (±)
  sourceRadius: number;     // 源 pump の作用半径 (field cell)。広いほど勾配が緩く、
                            //   局所の点滅が消える。狭いと源 1 点が激しく明滅する。
  bodyPulseAmp: number;     // 体内 pulse: B 比例、per-cell noise phase で非同期
  pulsePeriod: number;      // 全体呼吸の周期
  // 圧力ダイナミクス
  pressureDiff: number;     // P の拡散
  pressureDecay: number;    // P の自然減衰
  pressureMax: number;      // P のクランプ
  // 速度・移流
  flowRate: number;         // v = flowRate × ∇P
  maxFlux: number;          // CFL: |v| の片側クランプ (cell/tick)
  viscosity: number;        // B のサブグリッド粘性 (数値安定化)
  // 表面張力
  surfaceTension: number;        // 境界の高曲率を内側へ流す
  surfaceTensionBand: number;    // バンドのピーク位置 (B のスケール)
  // 摂食
  consumeRate: number;
  feedingRate: number;
}

export const DEFAULT_MEMBRANE_PARAMS: MembraneParams = {
  initialMass: 22.0,
  initialRadius: 4.0,
  foodPressure: 0.18,
  sourcePump: 2.6,
  sourceRadius: 4.5,          // 2.5 (狭い) だと源が点滅して目に痛い。広めにして
                              //   圧力勾配を滑らかにし、点滅を消す
  bodyPulseAmp: 0.45,         // v2 (0.35) より少し強め: 仮足 explicit を抜いた分を補う
  pulsePeriod: 200,           // 130 は人間の点滅知覚域に近い。200 まで延ばすと
                              //   「ゆっくり脈打つ」に寄る (≈ 13 フレーム/呼吸)
  pressureDiff: 0.55,
  pressureDecay: 0.07,
  pressureMax: 4.0,
  flowRate: 0.18,             // v2 (0.15) より若干高め: front boost を抜いた分を補う
  maxFlux: 0.22,              // 1 cell 1 tick あたり片側の最大速度
  viscosity: 0.025,
  surfaceTension: 0.18,
  surfaceTensionBand: 0.45,
  consumeRate: 0.012,
  feedingRate: 0.10,
};

export class Membrane {
  worldSize: number;
  size: number;
  B: FieldGrid;          // 質量
  P: FieldGrid;          // 圧力
  vx: FieldGrid;         // 速度場 x (cell 中心)
  vy: FieldGrid;         // 速度場 y (cell 中心)
  // |v|·B の time-smoothed。観測専用、物理に戻さない。
  flowMag: FieldGrid;
  // 描画から参照する呼吸の真実
  phase = 0;
  tick = 0;
  // 体内ノイズ (位相オフセット)。空間的に非対称な脈動を生む。renderer は使わない。
  noise: FieldGrid;
  private Pbuf: FieldGrid;
  private Bbuf: FieldGrid;
  private initialized = false;
  totalInitialMass = 0;

  constructor(worldSize: number, size: number, rng: SeededRNG) {
    this.worldSize = worldSize;
    this.size = size;
    this.B = makeField(size);
    this.P = makeField(size);
    this.vx = makeField(size);
    this.vy = makeField(size);
    this.flowMag = makeField(size);
    this.Pbuf = makeField(size);
    this.Bbuf = makeField(size);
    this.noise = makeField(size);
    for (let i = 0; i < size * size; i++) {
      this.noise.data[i] = (rng.next() - 0.5) * 2 * Math.PI;
    }
  }

  // 初期質量を source の周りに置く。総和はここで決まり、以降変わらない (feeding を除く)。
  seed(sources: MembraneSource[], p: MembraneParams): void {
    for (const s of sources) {
      this.stamp(this.B, s.pos, p.initialMass, p.initialRadius);
    }
    let total = 0;
    for (let i = 0; i < this.size * this.size; i++) total += this.B.data[i] ?? 0;
    this.totalInitialMass = total;
    this.initialized = true;
  }

  step(tick: number, env: GridEnvironment, sources: MembraneSource[], p: MembraneParams): void {
    if (!this.initialized) this.seed(sources, p);
    if (env.fieldSize !== this.size) {
      throw new Error(`Membrane fieldSize (${this.size}) != env.fieldSize (${env.fieldSize})`);
    }
    const W = this.size;
    const N = W * W;
    const nut = env.nutrients.data;
    const ob = env.obstacle.data;
    const phase = (2 * Math.PI * tick) / p.pulsePeriod;
    const globalBreath = Math.sin(phase);
    this.tick = tick;
    this.phase = phase;

    // ── (1) Pressure 更新 ──────────────────────────────
    // 食料の静的引力 + 体内 pulse + 前 tick の P の減衰。
    for (let i = 0; i < N; i++) {
      const o = ob[i] ?? 0;
      if (o > 0.5) { this.Pbuf.data[i] = 0; continue; }
      const n = nut[i] ?? 0;
      // 体内 pulse は per-cell に位相がずれる: localBreath は -1..+1 をうろつく。
      // ここが膜の非対称な押し出しを生む唯一の体内 driver。
      const localBreath = 0.7 * globalBreath + 0.3 * Math.sin(phase + (this.noise.data[i] ?? 0));
      const foodAttract = n * p.foodPressure;
      const bodyPulse = (this.B.data[i] ?? 0) * p.bodyPulseAmp * localBreath;
      const decayed = (this.P.data[i] ?? 0) * (1 - p.pressureDecay);
      this.Pbuf.data[i] = decayed + foodAttract + bodyPulse;
    }
    // 源は呼吸する pump。これが全体の周期的伸縮を駆動する。
    for (const s of sources) {
      this.stamp(this.Pbuf, s.pos, p.sourcePump * globalBreath, p.sourceRadius);
    }
    diffuse(this.Pbuf, this.P, W, p.pressureDiff);
    // クランプ + 障害物
    for (let i = 0; i < N; i++) {
      if ((ob[i] ?? 0) > 0.5) { this.P.data[i] = 0; continue; }
      let v = this.P.data[i] ?? 0;
      if (v > p.pressureMax) v = p.pressureMax;
      else if (v < -p.pressureMax) v = -p.pressureMax;
      this.P.data[i] = v;
    }

    // ── (2) Velocity = flowRate × ∇P (中心差分) ───────
    // 障害物の隣では片側差分で代用 (障害物セルへ漏れない)。
    // P が高い方へ流れる convention: v = +∇P。
    const VMAX = p.maxFlux;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if ((ob[i] ?? 0) > 0.5) { this.vx.data[i] = 0; this.vy.data[i] = 0; continue; }
        const pSelf = this.P.data[i] ?? 0;
        const pL = (x > 0 && (ob[i - 1] ?? 0) <= 0.5) ? (this.P.data[i - 1] ?? 0) : pSelf;
        const pR = (x < W - 1 && (ob[i + 1] ?? 0) <= 0.5) ? (this.P.data[i + 1] ?? 0) : pSelf;
        const pU = (y > 0 && (ob[i - W] ?? 0) <= 0.5) ? (this.P.data[i - W] ?? 0) : pSelf;
        const pD = (y < W - 1 && (ob[i + W] ?? 0) <= 0.5) ? (this.P.data[i + W] ?? 0) : pSelf;
        let vx = (pR - pL) * 0.5 * p.flowRate;
        let vy = (pD - pU) * 0.5 * p.flowRate;
        if (vx > VMAX) vx = VMAX; else if (vx < -VMAX) vx = -VMAX;
        if (vy > VMAX) vy = VMAX; else if (vy < -VMAX) vy = -VMAX;
        this.vx.data[i] = vx;
        this.vy.data[i] = vy;
      }
    }

    // ── (3) Biomass advection (面通量・upwind) ────────
    // 面ごとに 1 回計算 → 質量厳密保存。upwind: source cell は v の符号で決まる。
    // x+ と y+ 面だけ走査すれば全ペアを 1 回ずつ訪問できる。
    for (let i = 0; i < N; i++) this.Bbuf.data[i] = this.B.data[i] ?? 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const oi = ob[i] ?? 0;
        if (oi > 0.5) continue;
        if (x + 1 < W) {
          const j = i + 1;
          if ((ob[j] ?? 0) <= 0.5) {
            const vf = ((this.vx.data[i] ?? 0) + (this.vx.data[j] ?? 0)) * 0.5;
            if (vf !== 0) {
              const srcIdx = vf >= 0 ? i : j;
              const flux = (this.B.data[srcIdx] ?? 0) * vf;
              this.Bbuf.data[i] = (this.Bbuf.data[i] ?? 0) - flux;
              this.Bbuf.data[j] = (this.Bbuf.data[j] ?? 0) + flux;
            }
          }
        }
        if (y + 1 < W) {
          const j = i + W;
          if ((ob[j] ?? 0) <= 0.5) {
            const vf = ((this.vy.data[i] ?? 0) + (this.vy.data[j] ?? 0)) * 0.5;
            if (vf !== 0) {
              const srcIdx = vf >= 0 ? i : j;
              const flux = (this.B.data[srcIdx] ?? 0) * vf;
              this.Bbuf.data[i] = (this.Bbuf.data[i] ?? 0) - flux;
              this.Bbuf.data[j] = (this.Bbuf.data[j] ?? 0) + flux;
            }
          }
        }
      }
    }
    [this.B.data, this.Bbuf.data] = [this.Bbuf.data, this.B.data];

    // ── (4) 粘性 (薄い拡散): 数値ノイズ抑え ────────────
    if (p.viscosity > 0) {
      diffuse(this.B, this.Bbuf, W, p.viscosity);
      [this.B.data, this.Bbuf.data] = [this.Bbuf.data, this.B.data];
    }

    // ── (5) 表面張力: 境界バンド限定の質量保存スムージング ──
    if (p.surfaceTension > 0) {
      const src = this.B.data, dst = this.Bbuf.data;
      for (let i = 0; i < N; i++) dst[i] = src[i] ?? 0;
      const band = p.surfaceTensionBand;
      const sigma = p.surfaceTension;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if ((ob[i] ?? 0) > 0.5) continue;
          const bi = src[i] ?? 0;
          const ki = boundaryKernel(bi, band);
          if (ki < 0.02) continue;
          if (x + 1 < W) {
            const j = i + 1;
            if ((ob[j] ?? 0) <= 0.5) {
              const bj = src[j] ?? 0;
              const kj = boundaryKernel(bj, band);
              const w = Math.sqrt(ki * kj);
              if (w > 0.02) {
                const flux = sigma * w * (bj - bi);
                dst[i] = (dst[i] ?? 0) + flux;
                dst[j] = (dst[j] ?? 0) - flux;
              }
            }
          }
          if (y + 1 < W) {
            const j = i + W;
            if ((ob[j] ?? 0) <= 0.5) {
              const bj = src[j] ?? 0;
              const kj = boundaryKernel(bj, band);
              const w = Math.sqrt(ki * kj);
              if (w > 0.02) {
                const flux = sigma * w * (bj - bi);
                dst[i] = (dst[i] ?? 0) + flux;
                dst[j] = (dst[j] ?? 0) - flux;
              }
            }
          }
        }
      }
      [this.B.data, this.Bbuf.data] = [this.Bbuf.data, this.B.data];
    }

    // ── (6) flowMag: |v|·B を time-smooth (描画用) ───
    {
      const m = this.flowMag.data;
      for (let i = 0; i < N; i++) {
        const speed = Math.hypot(this.vx.data[i] ?? 0, this.vy.data[i] ?? 0);
        const inst = speed * (this.B.data[i] ?? 0);
        m[i] = (m[i] ?? 0) * 0.78 + inst * 0.22;
      }
    }

    // ── (7) 餌食い ───────────────────────────────────
    if (p.consumeRate > 0) {
      for (let i = 0; i < N; i++) {
        const n = nut[i] ?? 0;
        const b = this.B.data[i] ?? 0;
        if (n > 0.001 && b > 0.05) {
          const consumed = Math.min(n, b * p.consumeRate);
          nut[i] = n - consumed;
          this.B.data[i] = b + consumed * p.feedingRate;
        }
      }
    }

    // ── (8) 障害物・負値クリーンアップ ────────────────
    for (let i = 0; i < N; i++) {
      if ((ob[i] ?? 0) > 0.5) this.B.data[i] = 0;
      else if ((this.B.data[i] ?? 0) < 0) this.B.data[i] = 0;
    }
  }

  totalMass(): number {
    let t = 0;
    for (let i = 0; i < this.size * this.size; i++) t += this.B.data[i] ?? 0;
    return t;
  }

  private stamp(target: FieldGrid, pos: Vec2, amount: number, radius: number): void {
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

// 境界バンドカーネル: B = peak で 1、B = 0 や B ≫ peak で 0。
// 「ここは膜の輪郭ですか」を 0–1 で答える連続関数。
function boundaryKernel(b: number, peak: number): number {
  if (b <= 0 || peak <= 0) return 0;
  const x = b / peak;
  return x * Math.exp(1 - x);
}

function diffuse(src: FieldGrid, dst: FieldGrid, size: number, D: number): void {
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
