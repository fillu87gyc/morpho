// Membrane (Flow 版): 「肉は流れる」を一次原理に据えたモデル。
//
// 前バージョン (reaction-diffusion) の根本的な違和感:
//   - 肉が「増殖」する → 均一に膨らんで「インフレする泡」になる
//   - 全周が同じ速度で広がる → 「内部流が膜を押す」感じが出ない
//   - 単調増加なので「呼吸」しない
//
// このバージョンの設計:
//   B[x,y]: 質量 (= biomass) — *保存量*。初期に source から一定量を置き、
//           以降は基本的に総和を変えない。流れるだけ。
//   P[x,y]: 圧力 (= 引力場の potential)。源と食料が pump し、拡散・減衰する。
//
// 毎 tick:
//   1. 食料は P に正圧を載せる (静的なアトラクタ)
//   2. 源は呼吸する pump: sin(t) で正←→負を振る
//        - 正の半: 源は P を持ち上げ、膜を外へ押す
//        - 負の半: 源は P を下げ、膜が源に引き戻される
//   3. P を速く拡散する (情報は早く伝わる)
//   4. 障害物は P=0 で遮蔽
//   5. B は ∇P の高い方へ流れる (質量保存の advection)
//      流量は B × dP の積で決まる: 既に薄い所からは少ししか動かない
//
// 結果: 「膨らむ→止まる→引っ込む→別方向に膨らむ」が自発的に出る (はず)。
//       源は外殻ではなく内部圧力の心臓として振る舞う。

import type { Vec2 } from '../types.js';
import { makeField, type FieldGrid } from './field.js';
import type { GridEnvironment } from './field.js';
import type { SeededRNG } from '../rng.js';

export interface MembraneSource {
  pos: Vec2;
}

// 仮足: 境界沿いに有限寿命で出現する局所圧力スパイク。
// 「全体は呼吸している」だけだと膜が一つの丸になるので、
// 部分的に外へ膨らんで引っ込む非対称性をここで足す。
// 位置は field 座標、速度は cell/tick。寿命の half-sine 包絡で出入りする。
interface PressureBurst {
  x: number;
  y: number;
  amp: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

export interface MembraneParams {
  // 初期質量 (source の周りに置く)
  initialMass: number;
  initialRadius: number;
  // 圧力
  foodPressure: number;     // 食料が出す静的引力の強さ
  sourcePump: number;       // 源が出す呼吸圧の振幅 (±)
  bodyPulseAmp: number;     // 肉自体が出す呼吸圧の振幅 (B 比例、±)
  pressureDiff: number;     // P の拡散 (情報伝達なので速め)
  pressureDecay: number;    // P の自然減衰
  pressureMax: number;      // P のクランプ (片側): 食料圧の累積を抑える
  // 流量
  flowRate: number;         // B の advection 強さ
  maxOutflow: number;       // 1 step で 1 cell から出せる B の割合 (CFL 的安全弁)
  viscosity: number;        // B 自体の僅かな拡散 (べたつき) — 0.0–0.05 程度
  // 表面張力: 境界バンドだけに効くマス保存スムージング。
  // 全体を平らにする viscosity と違い、輪郭の高曲率部だけを内側に引き戻すため、
  // 「インクの染み」→「丸い膜」へと外観が変わる。
  surfaceTension: number;        // 0.0–0.30 程度。0 で無効
  surfaceTensionBand: number;    // バンドのピーク位置 (B のスケール)。0.3-0.6 程度
  // 呼吸
  pulsePeriod: number;
  // 仮足 (動く境界): 境界に局所バーストを撒く。
  // 全体呼吸が無いと膜は静かな丸になりがちなので、ここで非対称な凹凸を継続供給する。
  burstRate: number;             // tick あたり新規生成確率 (0-1)
  burstAmp: number;              // 圧力のピーク
  burstLife: number;             // 平均寿命 (tick)
  burstRadius: number;           // 影響半径 (field cell)
  burstDrift: number;            // 境界の接線方向の drift (cell/tick)
  burstMax: number;              // 同時最大数。多すぎると境界がノイズに溶ける
  // コア凝集: B が高いセルは自己圧力で周囲を引き寄せ、エッジは薄く中心は厚くなる。
  // target に近づくと頭打ちにして runaway を防ぐ (cell が無限に重くならない)。
  bodyConsolidation: number;     // 強度 (0 で無効)
  bodyConsolidationCap: number;  // この B を超えると消える (上限)
  // 前縁加速: flowMag が高いセルは flowRate に小さなブーストが乗る。
  // 一度立った前線が自走する。maxOutflow で物理的上限が守られる。
  frontBoost: number;            // 0-1.5
  frontBoostRef: number;         // flowMag/Ref を 0-1 に正規化する基準値
  // 表面張力の呼吸変調: 締まる/緩むで膜全体が周期的にサイズを変える。
  // 0 で固定、1 で sin に完全追従。源 pump の反対位相になるように適用される。
  tensionBreathAmp: number;
  // 餌食い: 食料に乗っている膜は栄養を消費し、自分は微増する
  consumeRate: number;  // 食料が減る速さ (B 比例)
  feedingRate: number;  // 消費分のうち B 自身に取り込まれる係数
}

export const DEFAULT_MEMBRANE_PARAMS: MembraneParams = {
  initialMass: 22.0,
  initialRadius: 4.0,
  foodPressure: 0.18,   // 控えめ + pressureMax で頭打ち
  sourcePump: 2.6,      // 源の呼吸
  bodyPulseAmp: 0.35,   // 肉自身が脈打つ: 局所ノイズで波が走る
  pressureDiff: 0.55,
  pressureDecay: 0.07,  // 遅め — 信号が遠くまで届くようにする
  pressureMax: 4.0,     // 食料圧の暴走を抑え、源の負圧と拮抗できる範囲に
  flowRate: 0.15,
  maxOutflow: 0.28,
  viscosity: 0.025,
  surfaceTension: 0.18,       // 輪郭のギザを内側に引き戻す力
  surfaceTensionBand: 0.45,   // B≈0.45 を境界とみなして集中して効かせる
  pulsePeriod: 130,
  // 仮足
  burstRate: 0.22,            // 平均 4-5 tick に 1 つ。多すぎると境界がノイズに溶ける
  burstAmp: 2.2,              // 食料圧 (foodPressure * nutrient = 0.18) を局所的に上回る程度
  burstLife: 45,
  burstRadius: 2.4,
  burstDrift: 0.18,           // ゆっくり輪郭に沿って這う
  burstMax: 6,
  // コア凝集: 強すぎると膜が広がれず食料に届かないので控えめにする。
  // それでも内部の B プロファイルには明確な傾斜が出る。
  bodyConsolidation: 0.18,    // 内側へ集まろうとする力 (弱)
  bodyConsolidationCap: 1.0,  // この厚みに達したらそれ以上は引き寄せない
  // 前縁加速
  frontBoost: 0.55,
  frontBoostRef: 0.06,        // typical flowMag のスケール
  // 張力呼吸: 強すぎると周期的に収縮しすぎて食料へ届かない
  tensionBreathAmp: 0.35,
  consumeRate: 0.012,   // B=10 が乗ると 0.12/tick で食料減る → 中規模食料は 100tick程度で枯渇
  feedingRate: 0.10,    // 消費した栄養の 10% が肉に変わる (緩やかな成長)
};

export class Membrane {
  worldSize: number;
  size: number;
  B: FieldGrid;          // 肉
  P: FieldGrid;          // 圧力
  // 1 tick あたり「このセルを通った B の量」。観測専用 (描画で前縁を光らせる)。
  // 物理には影響しない。advection 中に流出/流入の絶対量を貯め、毎 tick 緩く減衰する。
  flowMag: FieldGrid;
  // 描画から参照する呼吸の位相情報。simulation 側の真実を一箇所に固める。
  phase = 0;
  tick = 0;
  // 体内ノイズ (位相オフセット)。波が一様にならないようにする。renderer が読む。
  noise: FieldGrid;
  private Pbuf: FieldGrid;
  private Bbuf: FieldGrid;
  private flowBuf: Float32Array;
  private initialized = false;
  totalInitialMass = 0;
  // 仮足リスト。step ごとに増減する。観測用に public で出しておくが、
  // 描画は B / flowMag があれば十分なので普通は触る必要はない。
  bursts: PressureBurst[] = [];
  private rng: SeededRNG;

  constructor(worldSize: number, size: number, rng: SeededRNG) {
    this.worldSize = worldSize;
    this.size = size;
    this.rng = rng;
    this.B = makeField(size);
    this.P = makeField(size);
    this.flowMag = makeField(size);
    this.Pbuf = makeField(size);
    this.Bbuf = makeField(size);
    this.flowBuf = new Float32Array(size * size);
    this.noise = makeField(size);
    for (let i = 0; i < size * size; i++) {
      this.noise.data[i] = (rng.next() - 0.5) * 2 * Math.PI;
    }
  }

  // 初期質量を source の周りに置く。総和はここで決まり、以降変わらない (feedingを除く)。
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
    const globalBreath = Math.sin(phase); // [-1, +1]
    this.tick = tick;
    this.phase = phase;
    // 前縁可視化用アキュムレータをリセット
    this.flowBuf.fill(0);

    // ── (0) 仮足の生成・老化・移動 ────────────────────
    this.updateBursts(p, ob);

    // ── (1) Pressure 更新 ─────────────────────────────────
    // 食料: 一定の引力。源: 呼吸する pump (正負に振れる)。
    // bodyConsolidation: B の高いセル自身が小さな正圧を出す → コアに質量が集まる。
    //                    cap 付きなので runaway しない。
    for (let i = 0; i < N; i++) {
      const o = ob[i] ?? 0;
      if (o > 0.5) { this.Pbuf.data[i] = 0; continue; }
      const n = nut[i] ?? 0;
      const localBreath = 0.7 * globalBreath + 0.3 * Math.sin(phase + (this.noise.data[i] ?? 0));
      // 食料の静的引力 (常に正)
      const foodAttract = n * p.foodPressure;
      const bv = this.B.data[i] ?? 0;
      // 体に乗っている所は呼吸の影響を受ける (肉自身がリズミカルに圧を作る)
      // localBreath の符号で押し出し/吸い込みが反転する → 全身を波が走る
      const bodyPulse = bv * p.bodyPulseAmp * localBreath;
      // コア凝集: cap を超えると 0 になり安定化する
      const consol = p.bodyConsolidation * Math.min(bv, p.bodyConsolidationCap);
      // 既存の P は減衰
      const decayed = (this.P.data[i] ?? 0) * (1 - p.pressureDecay);
      this.Pbuf.data[i] = decayed + foodAttract + bodyPulse + consol;
    }
    // 源は呼吸する pump (±)
    for (const s of sources) {
      this.stamp(this.Pbuf, s.pos, p.sourcePump * globalBreath, 2.5);
    }
    // 仮足の局所バーストを Pbuf に焼き込む (half-sine 包絡)
    for (const b of this.bursts) {
      const t = b.age / b.life;
      const env_ = Math.sin(t * Math.PI); // 0→1→0
      if (env_ < 0.04) continue;
      this.stampField(this.Pbuf, b.x, b.y, b.amp * env_, p.burstRadius);
    }
    // P を拡散
    diffuse(this.Pbuf, this.P, W, p.pressureDiff);
    // クランプ + 障害物
    for (let i = 0; i < N; i++) {
      if ((ob[i] ?? 0) > 0.5) { this.P.data[i] = 0; continue; }
      let v = this.P.data[i] ?? 0;
      if (v > p.pressureMax) v = p.pressureMax;
      else if (v < -p.pressureMax) v = -p.pressureMax;
      this.P.data[i] = v;
    }

    // ── (2) Biomass advection (mass-conserving) ──────────
    // 各セルから、より P が高い隣接セル群へ B を比例配分。
    // 全部 Bbuf 上で書き込み: 出した分だけ消え、受けた分だけ増える → 総和保存。
    for (let i = 0; i < N; i++) this.Bbuf.data[i] = this.B.data[i] ?? 0;

    for (let y = 1; y < W - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const b = this.B.data[i] ?? 0;
        if (b < 1e-5) continue;
        if ((ob[i] ?? 0) > 0.5) continue;
        const pSelf = this.P.data[i] ?? 0;
        const neigh: number[] = [i - 1, i + 1, i - W, i + W];
        let totalDp = 0;
        const diffs: [number, number][] = [];
        for (const j of neigh) {
          if ((ob[j] ?? 0) > 0.5) continue;
          const dp = (this.P.data[j] ?? 0) - pSelf;
          if (dp > 0) { diffs.push([j, dp]); totalDp += dp; }
        }
        if (totalDp <= 0) continue;
        // 前縁加速: 既に流れているセルは flowRate に小さなブーストが乗る。
        // maxOutflow が物理的上限なので runaway しない。
        const fm = this.flowMag.data[i] ?? 0;
        const boost = 1 + p.frontBoost * Math.min(1, fm / Math.max(1e-6, p.frontBoostRef));
        // 出す総量: B * flowRate * dP合計、ただし maxOutflow で頭打ち
        const moveTotal = Math.min(b * p.flowRate * boost * totalDp, b * p.maxOutflow);
        for (const [j, dp] of diffs) {
          const share = moveTotal * (dp / totalDp);
          this.Bbuf.data[i] = (this.Bbuf.data[i] ?? 0) - share;
          this.Bbuf.data[j] = (this.Bbuf.data[j] ?? 0) + share;
          // 受け取った側を「前線」として記録 (送り出す側は塊の中心になりがち)
          this.flowBuf[j] = (this.flowBuf[j] ?? 0) + share;
        }
      }
    }
    // swap
    [this.B.data, this.Bbuf.data] = [this.Bbuf.data, this.B.data];

    // ── (3) 粘性 (薄い拡散): 流体としての滑らかさ ────────
    if (p.viscosity > 0) {
      diffuse(this.B, this.Bbuf, W, p.viscosity);
      [this.B.data, this.Bbuf.data] = [this.Bbuf.data, this.B.data];
    }

    // ── (3b) 表面張力: 境界バンド限定の質量保存スムージング ──
    // 通常の拡散は塊の中身まで均してしまうが、
    // ここでは「B が境界帯にある cell どうしの間でのみ」フラックスを許す。
    // 凸の出っ張りは隣の凹みへ流れ、輪郭が滑らかになる。
    // ペアごとに対称交換するので質量は厳密に保存。
    if (p.surfaceTension > 0) {
      const src = this.B.data, dst = this.Bbuf.data;
      for (let i = 0; i < N; i++) dst[i] = src[i] ?? 0;
      const band = p.surfaceTensionBand;
      // 張力呼吸: source pump が外向き (globalBreath > 0) のとき張力を緩めて膜が膨らみやすくする。
      // 源が吸い込む (< 0) ときは張力を強めて収縮を補助する。これで全体サイズが見える周期で揺れる。
      const tensionMod = Math.max(0.05, 1 - p.tensionBreathAmp * globalBreath);
      const sigma = p.surfaceTension * tensionMod;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if ((ob[i] ?? 0) > 0.5) continue;
          const bi = src[i] ?? 0;
          const ki = boundaryKernel(bi, band);
          if (ki < 0.02) continue;
          // 右と下の neighbor だけ見れば全ペアを一度ずつ訪問できる
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

    // ── (3c) 前縁シグナルの時間平滑化 ─────────────────
    // 1tick 分の生フラックスは細切れになるため、緩やかに移動平均して
    // 「いま伸びている前縁」が連続的に光るようにする。
    {
      const m = this.flowMag.data, acc = this.flowBuf;
      for (let i = 0; i < N; i++) {
        m[i] = (m[i] ?? 0) * 0.78 + (acc[i] ?? 0) * 0.22;
      }
    }

    // ── (4) 餌食い: 膜が乗っている食料は減り、膜は微増する ──
    // これがないと食料圧が永続して膜が食料に「貼り付く」。
    // 食料が枯れると圧が消え、膜は次の食料へ流れる (= 粘菌の探索パターン)。
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

    // ── (5) 障害物・負値のクリーンアップ ─────────────────
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

  // 仮足の生成 + 老化 + drift。境界バンドにあるセルだけが種になり、
  // 一度生まれたら接線方向に流れて寿命まで動く。粘菌の pseudopod 的振る舞い。
  private updateBursts(p: MembraneParams, ob: Float32Array): void {
    const W = this.size;
    // 老化 + drift + 範囲外/障害物に入ったら除去
    const alive: PressureBurst[] = [];
    for (const b of this.bursts) {
      b.age++;
      if (b.age >= b.life) continue;
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < 1 || b.y < 1 || b.x >= W - 1 || b.y >= W - 1) continue;
      const ix = Math.floor(b.x), iy = Math.floor(b.y);
      if ((ob[iy * W + ix] ?? 0) > 0.5) continue;
      alive.push(b);
    }
    this.bursts = alive;

    // 生成: 境界バンドにあるセルを乱択し、tangent (= ∇B に直交) 方向の drift を与える
    if (this.bursts.length < p.burstMax && this.rng.next() < p.burstRate) {
      for (let attempt = 0; attempt < 24; attempt++) {
        const cx = 1 + this.rng.next() * (W - 2);
        const cy = 1 + this.rng.next() * (W - 2);
        const ix = Math.floor(cx), iy = Math.floor(cy);
        if ((ob[iy * W + ix] ?? 0) > 0.5) continue;
        const bv = this.B.data[iy * W + ix] ?? 0;
        if (boundaryKernel(bv, p.surfaceTensionBand) < 0.5) continue;
        // 中心差分で ∇B、その perpendicular を取る
        const Bdata = this.B.data;
        const ixR = Math.min(W - 1, ix + 1), ixL = Math.max(0, ix - 1);
        const iyD = Math.min(W - 1, iy + 1), iyU = Math.max(0, iy - 1);
        const gx = ((Bdata[iy * W + ixR] ?? 0) - (Bdata[iy * W + ixL] ?? 0)) * 0.5;
        const gy = ((Bdata[iyD * W + ix] ?? 0) - (Bdata[iyU * W + ix] ?? 0)) * 0.5;
        const gm = Math.hypot(gx, gy);
        let vx = 0, vy = 0;
        if (gm > 1e-4) {
          const sign = this.rng.next() < 0.5 ? 1 : -1;
          vx = (-gy / gm) * sign * p.burstDrift;
          vy = (gx / gm) * sign * p.burstDrift;
        }
        this.bursts.push({
          x: cx, y: cy,
          amp: p.burstAmp * (0.6 + this.rng.next() * 0.8),
          vx, vy,
          age: 0,
          life: Math.max(8, p.burstLife * (0.6 + this.rng.next() * 0.8)),
        });
        break;
      }
    }
  }

  // field 座標で disk を加算 (世界座標を取る private stamp と対をなす)
  private stampField(target: FieldGrid, cx: number, cy: number, amount: number, radius: number): void {
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
          target.data[y * this.size + x] = (target.data[y * this.size + x] ?? 0) + amount * w;
        }
      }
    }
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

// バンドカーネル: B=peak で 1、B=0 や B≫peak でゼロに落ちる山型関数。
// 「いまここは膜の輪郭ですか」を 0–1 で答える。
// x*e^(1-x) は x=1 で 1、x→∞ で速やかに 0、x=0 で 0。連続なので fluxが暴れない。
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
