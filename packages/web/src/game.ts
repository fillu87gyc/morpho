// ゲーム本体。Sim を生かすラッパー。
//
//   - sim を 1 つ持つ (state / env / fields / params / rng / bus)
//   - 描画は別クラスに委譲 (render.ts)
//   - 入力 (ツール選択 / クリック / リセット / 速度) は ui.ts と連携
//
// パラメータは main の scripts/biomass-gif.ts (ペトリ皿デモ) と同じ
// チューニング (PETRI_PARAMS) を使う。DEFAULT_PARAMS のままだと細い
// 脈管網にならない。

import {
  createInitialState, seedSource, createRNG, GridEnvironment, clearAroundSource,
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, step, computeTraits,
  type SimState, type SimParams, type Vec2, type Traits, type SimEvent, type SeededRNG,
} from '@morpho/sim';

export type Tool = 'food' | 'light' | 'water' | 'stone' | 'erase';

// モックアップの「環境バランス」5軸。
// 温度と毒素は sim 側に対応モデルがないので、それぞれ
//   温度 = ベース + 明るさ寄与 (光が強いほど温暖)
//   毒素 = 障害物の存在比 (土地阻害物を「土地に蓄積する負荷」として扱う)
// として観測量を派生させる。
export interface EnvBalance {
  light: number;       // 明るさ
  temperature: number; // 温度 (派生)
  moisture: number;    // 湿度
  nutrient: number;    // 栄養
  toxin: number;       // 毒素 (派生: 障害物)
}

export interface WorldInfo {
  areaM2: number;        // 粘菌が占めている面積 (m² 想定の派生単位)
  massKg: number;        // 粘菌の総量 (kg 想定の派生単位)
  networkLinks: number;  // 接続ネットワーク数 = エッジ数
  coloniesReached: number; // 到達した拠点数 = sink ノード数
  coloniesTotal: number;   // 食料拠点の総数 (envの食料エリアの連結成分数)
}

export interface EvolutionLog {
  tick: number;
  text: string;
}

export interface GameSnapshot {
  state: SimState;
  env: GridEnvironment;
  bio: BiomassField;
  traits: Traits;
  balance: EnvBalance;
  world: WorldInfo;
  day: number;
  era: string;
  thickEdges: number;
  questProgress: number; // [0,1]
}

export const WORLD = 100;
export const FIELD = 96;
const TICKS_PER_DAY = 40;
const DEFAULT_SOURCE: Vec2 = { x: 50, y: 50 };

// 皿の外周 6 箇所の固定食料点 (main petri デモと同じ構図)。
// バイオード生成で岩場をここに重ねないための「避けるべき地点」にも使う。
const FOOD_POINTS: { pos: Vec2; radius: number; amount: number }[] = [
  { pos: { x: 22, y: 22 }, radius: 4.5, amount: 0.95 },
  { pos: { x: 78, y: 22 }, radius: 5.0, amount: 1.10 },
  { pos: { x: 82, y: 55 }, radius: 4.0, amount: 0.85 },
  { pos: { x: 78, y: 80 }, radius: 5.0, amount: 1.05 },
  { pos: { x: 22, y: 78 }, radius: 4.5, amount: 0.95 },
  { pos: { x: 18, y: 50 }, radius: 4.0, amount: 0.85 },
];

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
  brushRadius = 5;
  speed = 1;
  worldSize = WORLD;
  fieldSize = FIELD;

  private evoLog: EvolutionLog[] = [];
  private recentEvents: string[] = [];
  // 太い管に「初めて」育った瞬間を1度だけ拾うための既知集合。
  private thickenedSeen = new Set<number>();
  // ループ生成は同じノード対が短時間で何度も emit されがちなので de-dup。
  private lastLoopAtTick = -999;
  // 「拠点 (コロニー)」の総数。リセット時に 6 で開始し、
  // プレイヤがエサを置くたびに増える。栄養が消費されてもカウントは減らさない
  // (= 一度設置した拠点は「到達対象」として残す)。
  private coloniesTotal = 6;

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

    clearAroundSource(this.env, DEFAULT_SOURCE, 4);
    seedSource(this.state, DEFAULT_SOURCE, 6);
    for (const f of FOOD_POINTS) this.env.placeFood(f.pos, f.radius, f.amount);
    generateBiome(this.env, this.rng, WORLD, [DEFAULT_SOURCE, ...FOOD_POINTS.map((f) => f.pos)]);

    this.evoLog = [];
    this.recentEvents = [];
    this.thickenedSeen.clear();
    this.lastLoopAtTick = -999;
    this.coloniesTotal = 6;
    this.pushEvent('新しい皿が用意された');
  }

  setTool(t: Tool): void { this.tool = t; }
  setBrush(r: number): void { this.brushRadius = r; }
  setSpeed(s: number): void { this.speed = Math.max(0, s | 0); }

  tick(): void {
    for (let i = 0; i < this.speed; i++) {
      step(this.state, this.env, this.act, this.bio, PETRI_PARAMS, this.rng, this.bus);
    }
    this.drainBus();
  }

  // EventBus に溜まった sim イベントを「進化の記録」用のログに翻訳して落とす。
  // 高頻度イベント (NewBranch / DeadEdge / EdgeThickened) は集計に回し、
  // 節目だけ人間が読めるテキストにする。
  private drainBus(): void {
    const events = this.bus.drain();
    for (const e of events) {
      const text = this.eventToText(e);
      if (!text) continue;
      this.pushEvo(e.tick, text);
    }
  }

  private eventToText(e: SimEvent): string | null {
    switch (e.type) {
      case 'ReachedFood':
        return '食料に到達';
      case 'LoopCreated': {
        if (e.tick - this.lastLoopAtTick < 8) return null;
        this.lastLoopAtTick = e.tick;
        return 'ネットワークが接続';
      }
      case 'EdgeThickened': {
        if (e.radius < 1.6) return null;
        if (this.thickenedSeen.has(e.edgeId)) return null;
        this.thickenedSeen.add(e.edgeId);
        return '太い幹が育った';
      }
      case 'Stagnated':
        return '成長が停滞';
      // NewBranch / DeadEdge は数が多すぎるので個別表示しない
      default:
        return null;
    }
  }

  // pos はワールド座標 (0..worldSize)。画面→ワールド変換はカメラ (main 側) の責務。
  apply(pos: Vec2): void {
    const r = this.brushRadius;
    switch (this.tool) {
      case 'food':
        this.env.placeFood(pos, r, 0.7);
        this.coloniesTotal += 1;
        this.pushEvent('栄養を撒いた');
        break;
      case 'light':
        this.env.placeLight(pos, r, 0.45);
        this.pushEvent('光をあてた');
        break;
      case 'water':
        this.env.placeWater(pos, r, 0.4);
        this.pushEvent('水を引いた');
        break;
      case 'stone':
        this.env.placeStone(pos, Math.max(2, r * 0.5));
        this.pushEvent('障害物を置いた');
        break;
      case 'erase':
        this.erase(pos, r);
        this.pushEvent('土地をならした');
        break;
    }
  }

  private erase(pos: Vec2, r: number): void {
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

  snapshot(): GameSnapshot {
    const traits = computeTraits(this.state);
    const balance = this.computeBalance();
    const world = this.computeWorld();
    const thickEdges = this.state.edges.filter((e) => e.radius > 1.5).length;
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    // クエスト: 「拠点に到達 ÷ 総拠点」を基準に、軸を増やすと深掘れる。
    const reachRatio = world.coloniesTotal > 0 ? world.coloniesReached / world.coloniesTotal : 0;
    const thickRatio = Math.min(1, thickEdges / 30);
    const questProgress = Math.min(1, reachRatio * 0.7 + thickRatio * 0.3);
    return {
      state: this.state, env: this.env, bio: this.bio,
      traits, balance, world,
      day, era: eraName(day),
      thickEdges, questProgress,
    };
  }

  events(): string[] { return this.recentEvents; }
  evolution(): EvolutionLog[] { return this.evoLog; }

  pushEvent(msg: string): void {
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    this.recentEvents.unshift(`Day ${day} — ${msg}`);
    if (this.recentEvents.length > 6) this.recentEvents.pop();
  }

  private pushEvo(tick: number, text: string): void {
    this.evoLog.unshift({ tick, text });
    if (this.evoLog.length > 6) this.evoLog.pop();
  }

  private computeBalance(): EnvBalance {
    const n = this.fieldSize * this.fieldSize;
    let nu = 0, mo = 0, br = 0, ob = 0;
    for (let i = 0; i < n; i++) {
      nu += this.env.nutrients.data[i] ?? 0;
      mo += this.env.moisture.data[i] ?? 0;
      br += this.env.brightness.data[i] ?? 0;
      ob += this.env.obstacle.data[i] ?? 0;
    }
    const light = Math.min(1, br / (n * 0.5));
    const moisture = Math.min(1, mo / (n * 0.5));
    const nutrient = Math.min(1, nu / (n * 0.25));
    const toxin = Math.min(1, ob / (n * 0.18));
    // 温度: ベース 40% に明るさ寄与を足す
    const temperature = Math.min(1, 0.4 + light * 0.35);
    return { light, temperature, moisture, nutrient, toxin };
  }

  private computeWorld(): WorldInfo {
    // 占有面積: biomass が一定値以上のセル数。世界全体を 100×100 m² とみなす。
    const n = this.fieldSize * this.fieldSize;
    const cellArea = (WORLD * WORLD) / n; // m²/cell
    let cells = 0;
    let mass = 0;
    for (let i = 0; i < n; i++) {
      const v = this.bio.field.data[i] ?? 0;
      mass += v;
      if (v > 0.05) cells++;
    }
    // 拠点総数は配置回数で素直に数える (computeWorld で派生しない)。
    const coloniesTotal = this.coloniesTotal;
    // 到達数: sink ノード数を独立な拠点に「圧縮」する。
    // 1 つの食料源に複数の tip が到達すると sink がたくさん作られるため
    // そのまま数えると拠点数を超えてしまう。
    // sink を近接半径でクラスタリングして拠点数を概算する。
    const sinks = this.state.nodes.filter((n) => n.type === 'sink');
    const reached = clusterCount(sinks.map((n) => n.pos), 6 /* world units */);
    const coloniesReached = Math.min(coloniesTotal, reached);
    // 粘菌の総量 (kg 想定): biomass の総和 × 単位 (係数は体感優先で調整)。
    // モックアップ ~4kg 規模に近付くよう、薄めの密度に倒す。
    const massKg = +(mass * cellArea * 0.0009).toFixed(2);
    return {
      areaM2: Math.round(cells * cellArea),
      massKg,
      networkLinks: this.state.edges.length,
      coloniesReached,
      coloniesTotal,
    };
  }
}

function eraName(day: number): string {
  if (day < 10) return '胞子期';
  if (day < 25) return '拡散期';
  if (day < 60) return '変形体期';
  return '成熟期';
}

// 「半径以内に既存クラスタの代表点があるか」だけ見る素朴な単一パス
// クラスタリング。点の数は数十〜数百程度なので O(N²) で十分。
function clusterCount(points: { x: number; y: number }[], radius: number): number {
  const r2 = radius * radius;
  const reps: { x: number; y: number }[] = [];
  for (const p of points) {
    let merged = false;
    for (const c of reps) {
      const dx = p.x - c.x, dy = p.y - c.y;
      if (dx * dx + dy * dy <= r2) { merged = true; break; }
    }
    if (!merged) reps.push(p);
  }
  return reps.length;
}

// ── バイオード生成 ────────────────────────────────────
// 起伏のある地形にするため、岩場 / 砂地 / 草地 / 水場 / 陽だまりの
// パッチをランダムに散らす。sim 側には手を入れず、Environment.placeX()
// だけを呼ぶ (アーキテクチャ方針: 書き込みは placeX 経由に限定する)。

type BiomeKind = 'rock' | 'sand' | 'grass' | 'water' | 'light';

const BIOME_WEIGHTS: [BiomeKind, number][] = [
  ['grass', 0.30],
  ['rock', 0.25],
  ['sand', 0.22],
  ['water', 0.13],
  ['light', 0.10],
];

function pickBiomeKind(rng: SeededRNG): BiomeKind {
  const r = rng.next();
  let acc = 0;
  for (const [kind, w] of BIOME_WEIGHTS) {
    acc += w;
    if (r < acc) return kind;
  }
  return 'grass';
}

function generateBiome(env: GridEnvironment, rng: SeededRNG, worldSize: number, avoidPoints: Vec2[]): void {
  const patchCount = rng.int(9, 14);
  const avoidRadius = 9; // source / 固定食料点の近くには岩を置かない (通行止め防止)

  for (let i = 0; i < patchCount; i++) {
    const center: Vec2 = { x: rng.range(0, worldSize), y: rng.range(0, worldSize) };
    const kind = pickBiomeKind(rng);
    const patchRadius = rng.range(9, 20);

    if (kind === 'rock') {
      if (avoidPoints.some((p) => dist(p, center) < avoidRadius)) continue;
      // 単一の塊ではなく、小石を数個ばら撒いて「岩場」らしい粒感を出す。
      const rockCount = rng.int(3, 7);
      for (let j = 0; j < rockCount; j++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0, patchRadius * 0.7);
        const pos: Vec2 = { x: center.x + Math.cos(a) * d, y: center.y + Math.sin(a) * d };
        if (avoidPoints.some((p) => dist(p, pos) < avoidRadius * 0.6)) continue;
        env.placeStone(pos, rng.range(1.4, 3.2));
      }
      continue;
    }

    switch (kind) {
      case 'sand':
        // 乾いて明るい砂地: 明るさを上げ、湿度をわずかに下げる。
        env.placeLight(center, patchRadius, rng.range(0.18, 0.32));
        env.placeWater(center, patchRadius * 0.9, -rng.range(0.08, 0.16));
        break;
      case 'grass':
        // 湿って肥沃な草地: 湿度と栄養をわずかに底上げする。
        env.placeWater(center, patchRadius * 0.85, rng.range(0.10, 0.20));
        env.placeFood(center, patchRadius * 0.5, rng.range(0.12, 0.25));
        break;
      case 'water':
        // 小さな水場: 湿度を強めに上げる。
        env.placeWater(center, patchRadius * 0.7, rng.range(0.30, 0.5));
        break;
      case 'light':
        // 陽だまり: 明るさを強めに上げる。
        env.placeLight(center, patchRadius * 0.7, rng.range(0.28, 0.45));
        break;
    }
  }
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
