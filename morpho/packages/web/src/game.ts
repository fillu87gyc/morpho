// ゲーム本体。Sim を生かすラッパー。
//
//   - sim を 1 つ持つ (state / env / fields / params / rng / bus)
//   - 描画は別クラスに委譲 (render.ts)
//   - 入力 (ツール選択 / クリック / リセット / 速度) は ui.ts と連携
//
// パラメータは main の scripts/biomass-gif.ts (ペトリ皿デモ) と同じ
// チューニングを使う。DEFAULT_PARAMS のまま走らせると太くてまばらな
// 管しか出ないため、参照映像のような細い脈管網にならない。

import {
  createInitialState, seedSource, createRNG, GridEnvironment, clearAroundSource,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, step, computeTraits,
  type SimState, type SimParams, type Vec2, type Traits,
} from '@morpho/sim';

export type Tool = 'food' | 'light' | 'water' | 'stone' | 'erase';

export interface EnvBalance {
  nutrient: number;
  moisture: number;
  light: number;
}

export interface GameSnapshot {
  state: SimState;
  env: GridEnvironment;
  bio: BiomassField;
  traits: Traits;
  balance: EnvBalance;
  day: number;
  thickEdges: number;
  foodSpots: number;
}

const WORLD = 100;
const FIELD = 96;               // main のペトリデモと同じ高解像
const TICKS_PER_DAY = 40;
const DEFAULT_SOURCE: Vec2 = { x: 50, y: 50 };

// main/scripts/biomass-gif.ts の PARAMS と同じ override。
// 「皿全体に細い脈管が広がる」体験を出すのに必要な値。
export const PETRI_PARAMS: SimParams = {
  ...DEFAULT_PARAMS,
  growthStep: 3.6,
  candidateSpreadBase: 1.0,
  growthActivityThreshold: 0.20,
  growthProbability: 0.85,
  branchProbabilityBase: 0.10,
  branchActivityThreshold: 0.35,
  pruneRadius: 0.18,
  fatigueGrow: 0.008,
  nutrientBias: 2.5,
  gradientBias: 0.4,
  noiseAmount: 0.30,
  worldMargin: 5,
  mergeRadius: 1.2,
  lateralBudBiomassThreshold: 0.20,
  lateralBudProbability: 0.30,
  biomassDeposit: 0.06,
  biomassRadius: 2.2,
  biomassDiffusion: 0.04,
  biomassDecay: 0.025,
};

export class Game {
  state!: SimState;
  env!: GridEnvironment;
  act!: ActivityField;
  bio!: BiomassField;
  bus!: EventBus;
  private rng!: ReturnType<typeof createRNG>;
  private seed: number;

  tool: Tool = 'food';
  brushRadius = 5;        // 皿が小さいので既定ブラシも小さめ
  speed = 1;              // ticks per frame
  worldSize = WORLD;
  fieldSize = FIELD;

  private recentEvents: string[] = [];

  constructor(seed = (Math.random() * 1e9) | 0) {
    this.seed = seed;
    this.reset(seed);
  }

  reset(seed = (Math.random() * 1e9) | 0): void {
    this.seed = seed;
    this.rng = createRNG(seed);
    this.env = new GridEnvironment({ worldSize: WORLD, fieldSize: FIELD });
    this.act = new ActivityField(WORLD, FIELD);
    this.bio = new BiomassField(WORLD, FIELD);
    this.bus = new EventBus();
    this.state = createInitialState(seed, WORLD);

    // 中央の「オートミール」(=ソース)。
    // 源を食料の上に置くと初手で tip が全部 sink になり広がらないため
    // 食料は皿の外周 6 箇所に分散する (main のデモと同じ構図)。
    clearAroundSource(this.env, DEFAULT_SOURCE, 4);
    seedSource(this.state, DEFAULT_SOURCE, 6);
    this.env.placeFood({ x: 22, y: 22 }, 4.5, 0.95);
    this.env.placeFood({ x: 78, y: 22 }, 5.0, 1.10);
    this.env.placeFood({ x: 82, y: 55 }, 4.0, 0.85);
    this.env.placeFood({ x: 78, y: 80 }, 5.0, 1.05);
    this.env.placeFood({ x: 22, y: 78 }, 4.5, 0.95);
    this.env.placeFood({ x: 18, y: 50 }, 4.0, 0.85);

    this.recentEvents = [];
    this.pushEvent('新しい皿が用意された');
  }

  setTool(t: Tool): void { this.tool = t; }
  setBrush(r: number): void { this.brushRadius = r; }
  setSpeed(s: number): void { this.speed = Math.max(0, s | 0); }

  // 1 フレームぶん。requestAnimationFrame のたびに呼ぶ。
  tick(): void {
    for (let i = 0; i < this.speed; i++) {
      step(this.state, this.env, this.act, this.bio, PETRI_PARAMS, this.rng, this.bus);
    }
  }

  // UI からのクリック。canvas 座標 (px, css size) を渡す。
  apply(canvasX: number, canvasY: number, canvasSize: number): void {
    const s = this.worldSize / canvasSize;
    const pos: Vec2 = { x: canvasX * s, y: canvasY * s };
    const r = this.brushRadius;
    switch (this.tool) {
      case 'food': this.env.placeFood(pos, r, 0.7); break;
      case 'light': this.env.placeLight(pos, r, 0.45); break;
      case 'water': this.env.placeWater(pos, r, 0.4); break;
      case 'stone': this.env.placeStone(pos, Math.max(2, r * 0.5)); break;
      case 'erase': this.erase(pos, r); break;
    }
  }

  private erase(pos: Vec2, r: number): void {
    // 場の半径内をクリア。obstacle / nutrient / moisture / brightness すべて。
    const fs = this.fieldSize;
    const s = fs / this.worldSize;
    const cx = pos.x * s, cy = pos.y * s;
    const fr = r * s;
    const fr2 = fr * fr;
    const x0 = Math.max(0, Math.floor(cx - fr));
    const x1 = Math.min(fs - 1, Math.ceil(cx + fr));
    const y0 = Math.max(0, Math.floor(cy - fr));
    const y1 = Math.min(fs - 1, Math.ceil(cy + fr));
    const fields = [this.env.nutrients, this.env.moisture, this.env.brightness, this.env.obstacle];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= fr2) {
          const idx = y * fs + x;
          for (const f of fields) f.data[idx] = 0;
        }
      }
    }
  }

  // 観測。UI が読む。
  snapshot(): GameSnapshot {
    const traits = computeTraits(this.state);
    const balance = this.computeBalance();
    const thickEdges = this.state.edges.filter((e) => e.radius > 1.5).length;
    const foodSpots = this.countFoodSpots();
    return {
      state: this.state,
      env: this.env,
      bio: this.bio,
      traits,
      balance,
      day: Math.floor(this.state.tick / TICKS_PER_DAY),
      thickEdges,
      foodSpots,
    };
  }

  events(): string[] { return this.recentEvents; }

  pushEvent(msg: string): void {
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    this.recentEvents.unshift(`Day ${day} — ${msg}`);
    if (this.recentEvents.length > 6) this.recentEvents.pop();
  }

  private computeBalance(): EnvBalance {
    const n = this.fieldSize * this.fieldSize;
    let nu = 0, mo = 0, br = 0;
    for (let i = 0; i < n; i++) {
      nu += this.env.nutrients.data[i] ?? 0;
      mo += this.env.moisture.data[i] ?? 0;
      br += this.env.brightness.data[i] ?? 0;
    }
    return {
      nutrient: Math.min(1, nu / (n * 0.25)),
      moisture: Math.min(1, mo / (n * 0.5)),
      light: Math.min(1, br / (n * 0.5)),
    };
  }

  private countFoodSpots(): number {
    let cells = 0;
    for (let i = 0; i < this.env.nutrients.data.length; i++) {
      if ((this.env.nutrients.data[i] ?? 0) > 0.3) cells++;
    }
    return Math.max(0, Math.round(cells / 24));
  }
}
