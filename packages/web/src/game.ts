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
  ActivityField, BiomassField, EventBus, DEFAULT_PARAMS, step, createStepCache, computeTraits,
  createGenome, createChildGenome, applyGenome, computeIndividuality, classifyIndividual,
  type SimState, type SimParams, type Vec2, type Traits, type SimEvent,
  type Genome, type Individuality, type IndividualTypeInfo, type StepCache,
} from '@morpho/sim';
import { STAGES, type StageId, type StageConfig } from './stages.js';
import { computeQuests, type QuestStatus } from './quests.js';
import { computeColonyNetworks, type ColonyMarker } from './colony-networks.js';
import { TICKS_PER_DAY } from './day-loop.js';
import { UndoStack } from './undo.js';

export type { StageId } from './stages.js';

// M10: モックアップ②の6分類。'heat'/'cool' は温度ツールの上げ下げサブトグル、
// 'water'/'drain' は水を引く/止めるのサブトグル。
export type Tool = 'food' | 'light' | 'water' | 'drain' | 'stone' | 'heat' | 'cool' | 'toxin' | 'erase';

// モックアップの「環境バランス」5軸。M10 より前は温度・毒素に対応する
// sim モデルがなく、明るさ/障害物からの派生値で代用していたが、
// GridEnvironment に温度・毒素フィールドが実装されたので実測値に置き換えた。
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
  sourceColonies: number;    // M6: 大マップに配置したコロニー (群体) の総数
  connectedNetworks: number; // M6: 現在の独立ネットワーク数 (1 = 全コロニーが統合済み)
}

export interface EvolutionLog {
  tick: number;
  text: string;
}

// M8 P2: 描画に毎tick必要な部分 (state/env/bio 等) と、頻繁には変わらない
// 派生計算 (traits/individuality/balance/world/quests/colonyMarkers) を分離。
// Worker 側は後者を 250ms 毎に間引いて計算し直す (snapshotDerived() 参照)。
export interface FastSnapshot {
  state: SimState;
  env: GridEnvironment;
  bio: BiomassField;
  genome: Genome;
  day: number;
  era: string;
  thickEdges: number;
  stage: { id: StageId; name: string; description: string };
  // ステージらしさを伝える装飾アイコンの目印座標 (廃墟の柱 / 鍾乳石 など)。
  landmarks: Vec2[];
}

export interface DerivedSnapshot {
  traits: Traits;
  individuality: Individuality;
  typeInfo: IndividualTypeInfo;
  balance: EnvBalance;
  world: WorldInfo;
  quests: QuestStatus[];
  // M6: ミニマップ用の各コロニー位置 + 現在の統合状態。
  colonyMarkers: ColonyMarker[];
}

export type GameSnapshot = FastSnapshot & DerivedSnapshot;

export const WORLD = 100;
export const FIELD = 96;

// M6: 単一 source ではなく、大マップに複数のコロニー (群体) を離して配置する。
// ズームアウト (zoom=1) すると全コロニーを見渡せ、ズームインすると
// 1コロニーだけの「個体ビュー」になる。FOOD_POINTS とも十分な間隔を空ける。
const SOURCE_POINTS: Vec2[] = [
  { x: 30, y: 30 },
  { x: 70, y: 30 },
  { x: 50, y: 75 },
];

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
  genome!: Genome;
  private params!: SimParams;
  private rng!: ReturnType<typeof createRNG>;
  private seed: number;
  private stage!: StageConfig;
  // tick を跨いで buildIndex の結果を使い回すためのキャッシュ (M8 P1)。
  // reset() の度に作り直す (新しい state に紐付け直す)。
  private stepCache!: StepCache;
  private lastEra = '';
  private landmarks: Vec2[] = [];
  // M10: 環境フィールドへのスタンプの取り消し (stroke 単位、深さ10)。
  private undo!: UndoStack;

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

  constructor(seed = (Math.random() * 1e9) | 0, stageId: StageId = 'petri', parentGenome?: Genome) {
    this.seed = seed;
    this.reset(seed, stageId, parentGenome);
  }

  // parentGenome を渡すと「種の採取」(M5) で継承した親の遺伝子を元に、
  // ステージの過酷さに応じて変異させた子の Genome で始める。
  // 省略時は従来通り seed から独立に新規生成する。
  reset(seed = (Math.random() * 1e9) | 0, stageId: StageId = this.stage?.id ?? 'petri', parentGenome?: Genome): void {
    this.seed = seed;
    this.stage = STAGES[stageId];
    this.rng = createRNG(seed);
    // その個体固有の遺伝パラメータを rng から決定的に引く (地形生成より先に
    // 引いて、常に同じ順番で消費されるようにする)。
    this.genome = parentGenome
      ? createChildGenome(parentGenome, this.rng, mutationScaleFor(this.stage))
      : createGenome(this.rng);
    this.params = { ...applyGenome(PETRI_PARAMS, this.genome), ...this.stage.paramOverrides };
    this.env = new GridEnvironment({
      worldSize: WORLD, fieldSize: FIELD,
      baseMoisture: this.stage.baseMoisture, baseBrightness: this.stage.baseBrightness,
      baseTemperature: this.stage.baseTemperature,
    });
    this.undo = new UndoStack(10);
    this.act = new ActivityField(WORLD, FIELD);
    this.bio = new BiomassField(WORLD, FIELD);
    this.bus = new EventBus();
    this.state = createInitialState(seed, WORLD);
    this.stepCache = createStepCache();

    for (const p of SOURCE_POINTS) {
      clearAroundSource(this.env, p, 4);
      seedSource(this.state, p, 6);
    }
    for (const f of FOOD_POINTS) this.env.placeFood(f.pos, f.radius, f.amount * this.stage.foodAmountMultiplier);
    this.landmarks = this.stage.generateTerrain(this.env, this.rng, WORLD, [...SOURCE_POINTS, ...FOOD_POINTS.map((f) => f.pos)]);

    this.evoLog = [];
    this.recentEvents = [];
    this.thickenedSeen.clear();
    this.lastLoopAtTick = -999;
    this.coloniesTotal = 6;
    this.lastEra = eraName(0);
    this.pushEvent(`新しい${this.stage.name}が用意された`);
  }

  setTool(t: Tool): void { this.tool = t; }
  setBrush(r: number): void { this.brushRadius = r; }
  setSpeed(s: number): void { this.speed = Math.max(0, s | 0); }

  // steps を省略すると従来通り this.speed 回まわす。M8 P2 の時間予算
  // スケジューラ (sim-worker.ts) は、予算に収まると見積もった tick 数を
  // 明示的に渡す (speed そのままとは限らない)。
  tick(steps: number = this.speed): void {
    for (let i = 0; i < steps; i++) {
      step(this.state, this.env, this.act, this.bio, this.params, this.rng, this.bus, this.stepCache);
      this.env.decay(
        this.stage.nutrientDecayPerTick, this.stage.moistureRelaxPerTick,
        this.stage.tempRelaxPerTick, this.stage.toxinDecayPerTick,
      );
    }
    this.drainBus();
    this.checkEraTransition();
  }

  // 「時代」(胞子期 → 拡散期 → 変形体期 → 成熟期) が切り替わった節目を
  // 進化の記録に残す。DAY カウンタの派生量なので tick 側で監視する。
  private checkEraTransition(): void {
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    const era = eraName(day);
    if (era !== this.lastEra) {
      this.pushEvo(this.state.tick, `${era}に入った`);
      this.lastEra = era;
    }
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

  // M10: 「やり直す」の stroke 境界。main.ts が pointerdown/pointerup で呼ぶ。
  beginStroke(): void { this.undo.beginStroke(); }
  endStroke(): void { this.undo.endStroke(); }
  get canUndo(): boolean { return this.undo.canUndo; }
  undoStroke(): void {
    if (!this.undo.canUndo) return;
    this.undo.undo();
    this.pushEvent('やり直した');
  }

  // pos はワールド座標 (0..worldSize)。画面→ワールド変換はカメラ (main 側) の責務。
  // fieldSize/worldSize 比の変換は GridEnvironment.toField() と同じ式
  // (private のため、Undo 記録用にここでも同じ変換を行う)。
  apply(pos: Vec2): void {
    const r = this.brushRadius;
    const s = this.fieldSize / this.worldSize;
    const fx = pos.x * s, fy = pos.y * s;
    switch (this.tool) {
      case 'food':
        this.undo.recordBefore(this.env.nutrients, fx, fy, r * 2 + 1);
        this.env.placeFood(pos, r, 0.7);
        this.coloniesTotal += 1;
        this.pushEvent('栄養を撒いた');
        break;
      case 'light':
        this.undo.recordBefore(this.env.brightness, fx, fy, r * 2 + 1);
        this.env.placeLight(pos, r, 0.45);
        this.pushEvent('光をあてた');
        break;
      case 'water':
        this.undo.recordBefore(this.env.moisture, fx, fy, r * 2 + 1);
        this.env.placeWater(pos, r, 0.4);
        this.pushEvent('水を引いた');
        break;
      case 'drain':
        this.undo.recordBefore(this.env.moisture, fx, fy, r * 2 + 1);
        this.env.placeDrain(pos, r, 0.35);
        this.pushEvent('水を止めた');
        break;
      case 'stone': {
        const sr = Math.max(2, r * 0.5);
        this.undo.recordBefore(this.env.obstacle, fx, fy, sr + 1);
        this.env.placeStone(pos, sr);
        this.pushEvent('障害物を置いた');
        break;
      }
      case 'heat':
        this.undo.recordBefore(this.env.temperature, fx, fy, r * 2 + 1);
        this.env.placeHeat(pos, r, 0.12);
        this.pushEvent('温度を上げた');
        break;
      case 'cool':
        this.undo.recordBefore(this.env.temperature, fx, fy, r * 2 + 1);
        this.env.placeHeat(pos, r, -0.12);
        this.pushEvent('温度を下げた');
        break;
      case 'toxin':
        this.undo.recordBefore(this.env.toxin, fx, fy, r * 2 + 1);
        this.env.placeToxin(pos, r, 0.35);
        this.pushEvent('毒素をまいた');
        break;
      case 'erase':
        this.eraseFields(fx, fy, r * s);
        this.erase(pos, r);
        this.pushEvent('土地をならした');
        break;
    }
  }

  private eraseFields(fx: number, fy: number, fr: number): void {
    for (const f of [this.env.nutrients, this.env.moisture, this.env.brightness, this.env.obstacle, this.env.toxin]) {
      this.undo.recordBefore(f, fx, fy, fr + 1);
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
    // 温度は「ならす」対象に含めない (0 に落とすと極寒扱いになってしまい、
    // baseTemperature に戻す方が「土地をならす」の意図に合うため対象外)。
    const fields = [this.env.nutrients, this.env.moisture, this.env.brightness, this.env.obstacle, this.env.toxin];
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

  snapshotFast(): FastSnapshot {
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    const thickEdges = this.state.edges.filter((e) => e.radius > 1.5).length;
    return {
      state: this.state, env: this.env, bio: this.bio, genome: this.genome,
      day, era: eraName(day), thickEdges,
      stage: { id: this.stage.id, name: this.stage.name, description: this.stage.description },
      landmarks: this.landmarks,
    };
  }

  snapshotDerived(): DerivedSnapshot {
    const traits = computeTraits(this.state);
    const individuality = computeIndividuality(this.state);
    const typeInfo = classifyIndividual(individuality);
    const balance = this.computeBalance();
    const colonies = computeColonyNetworks(this.state, SOURCE_POINTS);
    const world = this.computeWorld(colonies.networksCount);
    const quests = computeQuests({
      coloniesReached: world.coloniesReached, coloniesTotal: world.coloniesTotal, traits,
      sourceColonies: world.sourceColonies, connectedNetworks: world.connectedNetworks,
    });
    return { traits, individuality, typeInfo, balance, world, quests, colonyMarkers: colonies.markers };
  }

  snapshot(): GameSnapshot {
    return { ...this.snapshotFast(), ...this.snapshotDerived() };
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
    let nu = 0, mo = 0, br = 0, te = 0, tx = 0;
    for (let i = 0; i < n; i++) {
      nu += this.env.nutrients.data[i] ?? 0;
      mo += this.env.moisture.data[i] ?? 0;
      br += this.env.brightness.data[i] ?? 0;
      te += this.env.temperature.data[i] ?? 0;
      tx += this.env.toxin.data[i] ?? 0;
    }
    const light = Math.min(1, br / (n * 0.5));
    const moisture = Math.min(1, mo / (n * 0.5));
    const nutrient = Math.min(1, nu / (n * 0.25));
    // 温度フィールドは既に 0..1 目安のスケールなので、平均をそのままクランプする。
    const temperature = Math.max(0, Math.min(1, te / n));
    // 毒素は 0 から始まり局所的にしか撒かれないため、nutrient よりずっと
    // 敏感な尺度で正規化する (少量でもプレイヤーに伝わるように)。
    const toxin = Math.max(0, Math.min(1, tx / (n * 0.05)));
    return { light, temperature, moisture, nutrient, toxin };
  }

  private computeWorld(connectedNetworks: number): WorldInfo {
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
      sourceColonies: SOURCE_POINTS.length,
      connectedNetworks,
    };
  }
}

function eraName(day: number): string {
  if (day < 10) return '胞子期';
  if (day < 25) return '拡散期';
  if (day < 60) return '変形体期';
  return '成熟期';
}

// 環境変化と子孫個性の連動 (M5): 自然減衰が速い (=過酷な) ステージほど、
// 継承した遺伝子の変異が大きくなる。同じ親から採取した種でも、
// どの土地に植えるかで育つ子の個性の振れ幅が変わる。
function mutationScaleFor(stage: StageConfig): number {
  return 0.3 + stage.nutrientDecayPerTick * 220 + stage.moistureRelaxPerTick * 90;
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
