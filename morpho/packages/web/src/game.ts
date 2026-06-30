// ゲーム本体。Sim を生かすラッパー。
//
//   - sim を 1 つ持つ (state / env / fields / params / rng / bus)
//   - 描画は別クラスに委譲 (render.ts)
//   - 入力 (ツール選択 / クリック / リセット / 速度) は ui.ts と連携
//
// UI 側からは getSnapshot() で読み取り、各種 setX() で意思を渡す。

import {
  createInitialState, seedSource, createRNG, GridEnvironment, clearAroundSource,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, step, computeTraits,
  type SimState, type Vec2, type Traits,
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
const FIELD = 64;
const TICKS_PER_DAY = 30;       // 体感優先で日数化
const DEFAULT_SOURCE: Vec2 = { x: 50, y: 50 };

export class Game {
  state!: SimState;
  env!: GridEnvironment;
  act!: ActivityField;
  bio!: BiomassField;
  bus!: EventBus;
  private rng!: ReturnType<typeof createRNG>;
  private seed: number;

  tool: Tool = 'food';
  brushRadius = 8;       // world units (UI スライダで操作)
  speed = 1;             // ticks per frame
  worldSize = WORLD;
  fieldSize = FIELD;

  private recentEvents: string[] = [];
  private lastTickMs = performance.now();

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
    // 初期: ど真ん中に source、四方に少し食料を撒いておくと最初の伸びが見える
    clearAroundSource(this.env, DEFAULT_SOURCE, 6);
    seedSource(this.state, DEFAULT_SOURCE, 8);
    this.env.placeFood({ x: 25, y: 25 }, 6, 0.7);
    this.env.placeFood({ x: 75, y: 25 }, 6, 0.7);
    this.env.placeFood({ x: 75, y: 75 }, 6, 0.7);
    this.env.placeFood({ x: 25, y: 75 }, 6, 0.7);
    this.recentEvents = [];
    this.pushEvent('新しい世界が始まった');
  }

  setTool(t: Tool): void { this.tool = t; }
  setBrush(r: number): void { this.brushRadius = r; }
  setSpeed(s: number): void { this.speed = Math.max(0, s | 0); }

  // 1 フレームぶん。requestAnimationFrame のたびに呼ぶ。
  tick(): void {
    for (let i = 0; i < this.speed; i++) {
      step(this.state, this.env, this.act, this.bio, DEFAULT_PARAMS, this.rng, this.bus);
    }
    // 拡散場の自然な減衰 (Activity / Biomass は sim 側で減衰、env は静的)
    this.lastTickMs = performance.now();
  }

  // UI からのクリック。canvas 座標 (px, css size) を渡す。
  apply(canvasX: number, canvasY: number, canvasSize: number): void {
    const s = this.worldSize / canvasSize;
    const pos: Vec2 = { x: canvasX * s, y: canvasY * s };
    const r = this.brushRadius;
    switch (this.tool) {
      case 'food': this.env.placeFood(pos, r, 0.55); break;
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
    // 「食料拠点」= ある閾値以上のエサがあるセルの連結成分数 (簡易: 閾値以上のセル数 / 平均拠点サイズ)
    let cells = 0;
    for (let i = 0; i < this.env.nutrients.data.length; i++) {
      if ((this.env.nutrients.data[i] ?? 0) > 0.3) cells++;
    }
    return Math.max(0, Math.round(cells / 24));
  }
}
