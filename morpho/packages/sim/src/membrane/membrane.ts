// Membrane (v4): 「源は発振器ではない」「膜は流体ではない」を一次原理に据える。
//
// 前バージョン (v3) は最小4則まで絞ったが、まだ source が周期的に圧を pump し、
// 体内が一律に脈動するモデルだった。結果、見た目が「拍動する液滴」になり、
// 「膜が周期的に膨らんで縮む」印象から抜け出せなかった。
//
// 実物の Physarum で目立つのは:
//   - 仮足が伸びる / 止まる
//   - 太い場所が残る / 痩せた場所は消える
//   - 境界が動く。内部はあまり動かない。
//
// この版での再定義:
//   P = +foodAttract − biomassSelfPressure  (源 pump も体内 pulse も廃止)
//     食料が引き寄せ、密集した自分が外へ広がろうとする。それだけ。
//   v = ∇P × flowRate × mobility(t)
//     mobility だけが周期で揺らぐ ±15%。圧力場は静かなまま、流れの速さが脈打つ。
//   interior damping:
//     B>threshold かつ 4 隣接も B>threshold のセルは velocity を 30% に減衰。
//     体内深部は動かず、境界だけが前進・後退する。
//
// この組み合わせで:
//   - 源は initial mass を置く位置でしかなくなる (発振器の役目を降りる)
//   - 体内が静まり、輪郭の前進/後退だけが目立つ
//   - 食料攻略の順序と滞在時間が探索戦略として読める
//
// このモデルは graph 系の SimState/SimEdge とは独立。
// 同じ環境 (GridEnvironment) を共有する別の sim としてふるまう。

import type { Vec2 } from '../types.js';
import { makeField, type FieldGrid } from '../field/grid.js';
import type { GridEnvironment } from '../env/environment.js';
import type { SeededRNG } from '../rng.js';

export interface MembraneSource {
  pos: Vec2;
}

export interface MembraneParams {
  // 初期質量 (source の周りに置く)
  initialMass: number;
  initialRadius: number;
  // 圧力ソース (発振器なし)
  foodPressure: number;      // 食料が出す正の引力 (mass がここへ流れる)
  biomassPressure: number;   // 密集した自分が出す負圧 (体は自分から外へ広がる)
  // 体内進行波: selfPressure を per-cell 位相で揺らす。
  // 全身が一斉に脈動するのではなく、波が膜内を走る (peristalsis-like)。
  // 源 pump を復活させないまま、体内の絶え間ない流動感を取り戻す唯一の driver。
  bodyPulseAmp: number;      // selfPressure の振幅比 (0 で停止、0.5 で強め)
  // 呼吸 (圧力ではなく流速で表現)
  breathPeriod: number;      // mobility & body pulse の周期
  mobilityBreathAmp: number; // ±比率。0 なら完全に静か、0.15 で穏やかな脈
  // 圧力ダイナミクス
  pressureDiff: number;
  pressureDecay: number;
  pressureMax: number;
  // 速度・移流
  flowRate: number;          // v = flowRate × mobility × ∇P
  maxFlux: number;           // CFL クランプ (cell/tick)
  viscosity: number;
  // 内部ダンピング (境界だけ動かす)
  interiorThreshold: number; // この B 以上は「内部候補」
  interiorDamping: number;   // 内部セルの velocity 係数 (0-1)。0 で完全凍結
  // 表面張力
  surfaceTension: number;
  surfaceTensionBand: number;
  // Traffic (管の自己組織化): |v|·B を遅い EMA で積分。
  // 短期の flowMag と違い、これは「最近 N tick の流量履歴」を持つ。
  // 同じ場所に流れが続けば値が貯まり、流れが止まれば緩やかに消える。
  // 描画段でこれを overlay すると、膜の中に persistent な管が浮かぶ。
  // 物理にはフィードバックしない。
  trafficInflow: number;     // 1 tick あたり加算される flowMag の比率 (0-1)
  trafficDecay: number;      // 1 tick の残存率。0.995 で半減期≈140 tick
  // 摂食
  consumeRate: number;
  feedingRate: number;
}

export const DEFAULT_MEMBRANE_PARAMS: MembraneParams = {
  initialMass: 22.0,
  initialRadius: 4.0,
  foodPressure: 0.45,         // 唯一の探索 driver になるので v3 (0.18) より強める
  biomassPressure: 0.10,      // 体が自分から外へ広がる弱い圧。surfaceTension と釣り合う
  bodyPulseAmp: 0.55,         // per-cell 位相で selfPressure を ±55% 揺らす → 進行波
  breathPeriod: 200,
  mobilityBreathAmp: 0.30,    // 流速が ±30% で揺れる (15% は静かすぎた)
  pressureDiff: 0.55,
  pressureDecay: 0.07,
  pressureMax: 4.0,
  flowRate: 0.30,             // pump がなくなった分、係数自体を上げる
  maxFlux: 0.22,
  viscosity: 0.025,
  interiorThreshold: 0.45,    // 平均 B のスケール (initial で 1.5 弱)
  interiorDamping: 0.55,      // 内部も半分は動く。完全凍結だと体内シャトリングが死ぬ
  surfaceTension: 0.18,
  surfaceTensionBand: 0.45,
  trafficInflow: 1.0,
  trafficDecay: 0.997,        // 半減期 ≈ 230 tick (約 1.1 呼吸)。tube を長く残す
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
  flowMag: FieldGrid;    // |v|·B の short-term smooth (描画用、前縁シグナル)
  traffic: FieldGrid;    // |v|·B の long-term integral (描画用、管)
  phase = 0;
  tick = 0;
  // ノイズフィールドは残してあるが v4 では未使用 (body pulse を廃止したため)。
  // 将来「体内に小さな個性」を入れる場合のために hook として保持。
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
    this.traffic = makeField(size);
    this.Pbuf = makeField(size);
    this.Bbuf = makeField(size);
    this.noise = makeField(size);
    for (let i = 0; i < size * size; i++) {
      this.noise.data[i] = (rng.next() - 0.5) * 2 * Math.PI;
    }
  }

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
    const phase = (2 * Math.PI * tick) / p.breathPeriod;
    this.tick = tick;
    this.phase = phase;
    // 流速だけが脈打つ。圧力場は無関係 → 源は点滅しない。
    const mobility = 1 + p.mobilityBreathAmp * Math.sin(phase);

    // ── (1) Pressure: 食料(+) と 自己圧(-) だけ ────────
    // 源 pump なし (発振器なし)。selfPressure だけが per-cell 位相で揺らぐ。
    // localPulse は cell ごとに違う位相を持つので、波が膜内を進行する。
    // 結果: 膜全体は同期せず、ある場所は膨らみある場所は縮む状態が走り回る。
    for (let i = 0; i < N; i++) {
      const o = ob[i] ?? 0;
      if (o > 0.5) { this.Pbuf.data[i] = 0; continue; }
      const n = nut[i] ?? 0;
      const bv = this.B.data[i] ?? 0;
      const foodAttract = n * p.foodPressure;
      // 進行波: noise[i] が空間的に乱数なので、位相が連続的にずれて波として走る。
      // bodyPulseAmp=0 なら一定 (v4 の挙動)、>0 で揺らぎが乗る。
      const localPulse = 1 + p.bodyPulseAmp * Math.sin(phase + (this.noise.data[i] ?? 0));
      const selfPressure = bv * p.biomassPressure * localPulse;
      const decayed = (this.P.data[i] ?? 0) * (1 - p.pressureDecay);
      this.Pbuf.data[i] = decayed + foodAttract - selfPressure;
    }
    diffuse(this.Pbuf, this.P, W, p.pressureDiff);
    for (let i = 0; i < N; i++) {
      if ((ob[i] ?? 0) > 0.5) { this.P.data[i] = 0; continue; }
      let v = this.P.data[i] ?? 0;
      if (v > p.pressureMax) v = p.pressureMax;
      else if (v < -p.pressureMax) v = -p.pressureMax;
      this.P.data[i] = v;
    }

    // ── (2) Velocity = flowRate × mobility × ∇P ────────
    // 内部 (B>thr かつ 4隣接も) は damping を掛ける → 境界だけ動く。
    const VMAX = p.maxFlux;
    const baseRate = p.flowRate * mobility;
    const thr = p.interiorThreshold;
    const damp = p.interiorDamping;
    const Bdata = this.B.data;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if ((ob[i] ?? 0) > 0.5) { this.vx.data[i] = 0; this.vy.data[i] = 0; continue; }
        const pSelf = this.P.data[i] ?? 0;
        const pL = (x > 0 && (ob[i - 1] ?? 0) <= 0.5) ? (this.P.data[i - 1] ?? 0) : pSelf;
        const pR = (x < W - 1 && (ob[i + 1] ?? 0) <= 0.5) ? (this.P.data[i + 1] ?? 0) : pSelf;
        const pU = (y > 0 && (ob[i - W] ?? 0) <= 0.5) ? (this.P.data[i - W] ?? 0) : pSelf;
        const pD = (y < W - 1 && (ob[i + W] ?? 0) <= 0.5) ? (this.P.data[i + W] ?? 0) : pSelf;
        let vx = (pR - pL) * 0.5 * baseRate;
        let vy = (pD - pU) * 0.5 * baseRate;

        // 内部判定: 自分が thr 以上かつ 4 隣接も thr 以上 → 体内深部
        const bSelf = Bdata[i] ?? 0;
        if (bSelf > thr) {
          const bL = x > 0 ? (Bdata[i - 1] ?? 0) : 0;
          const bR = x < W - 1 ? (Bdata[i + 1] ?? 0) : 0;
          const bU = y > 0 ? (Bdata[i - W] ?? 0) : 0;
          const bD = y < W - 1 ? (Bdata[i + W] ?? 0) : 0;
          if (bL > thr && bR > thr && bU > thr && bD > thr) {
            vx *= damp;
            vy *= damp;
          }
        }

        if (vx > VMAX) vx = VMAX; else if (vx < -VMAX) vx = -VMAX;
        if (vy > VMAX) vy = VMAX; else if (vy < -VMAX) vy = -VMAX;
        this.vx.data[i] = vx;
        this.vy.data[i] = vy;
      }
    }

    // ── (3) Biomass advection (面通量・upwind、質量厳密保存) ──
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

    // ── (4) 粘性 (障害物に漏らさない、面フラックス形で質量厳密保存) ──
    if (p.viscosity > 0) {
      diffuseConserving(this.B, this.Bbuf, W, p.viscosity, ob);
      [this.B.data, this.Bbuf.data] = [this.Bbuf.data, this.B.data];
    }

    // ── (5) 表面張力 (境界バンド限定スムージング) ──
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

    // ── (6) flowMag + traffic 更新 (描画用) ────────────
    // flowMag: 直近 (≈ 数 tick) の流れ。前縁の白い輝き。
    // traffic: 長期 (≈ 100 tick) の流量履歴。膜内に浮かぶ「管」のパターン。
    {
      const m = this.flowMag.data;
      const t = this.traffic.data;
      const inflow = p.trafficInflow;
      const decay = p.trafficDecay;
      for (let i = 0; i < N; i++) {
        const speed = Math.hypot(this.vx.data[i] ?? 0, this.vy.data[i] ?? 0);
        const inst = speed * (this.B.data[i] ?? 0);
        m[i] = (m[i] ?? 0) * 0.78 + inst * 0.22;
        // traffic[i] = decay * traffic + inflow * |v|·B
        // 流れが止まれば指数減衰、続けば積分される
        t[i] = (t[i] ?? 0) * decay + inst * inflow * (1 - decay);
      }
    }

    // ── (7) 摂食 ──
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

    // ── (8) クリーンアップ ──
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

// 障害物を尊重する保存則型拡散。各面ごとに対称交換 (= flux 形)。
// 障害物のあるセル / 隣に流さないので、B が消える経路がなくなる。
function diffuseConserving(src: FieldGrid, dst: FieldGrid, size: number, D: number, ob: Float32Array): void {
  const s = src.data, d = dst.data;
  for (let i = 0; i < size * size; i++) d[i] = s[i] ?? 0;
  const k = Math.min(0.95, Math.max(0, D));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if ((ob[i] ?? 0) > 0.5) continue;
      const si = s[i] ?? 0;
      if (x + 1 < size) {
        const j = i + 1;
        if ((ob[j] ?? 0) <= 0.5) {
          const flux = k * 0.25 * ((s[j] ?? 0) - si);
          d[i] = (d[i] ?? 0) + flux;
          d[j] = (d[j] ?? 0) - flux;
        }
      }
      if (y + 1 < size) {
        const j = i + size;
        if ((ob[j] ?? 0) <= 0.5) {
          const flux = k * 0.25 * ((s[j] ?? 0) - si);
          d[i] = (d[i] ?? 0) + flux;
          d[j] = (d[j] ?? 0) - flux;
        }
      }
    }
  }
}
