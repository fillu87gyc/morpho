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
  ChunkedGridEnvironment, ChunkedActivityField, ChunkedBiomassField,
  bakeChunkWindow, bakeScalarFieldWindow, followWindowOrigin, wakeDormantArea,
  type SimState, type SimParams, type Vec2, type Traits, type SimEvent,
  type Genome, type Individuality, type IndividualTypeInfo, type StepCache,
} from '@morpho/sim';
import { STAGES, WILDLAND_CHUNK_CELLS, type StageId, type StageConfig } from './stages.js';
import { computeQuests, type QuestStatus } from './quests.js';
import { computeColonyNetworks, type ColonyMarker } from './colony-networks.js';
import { TICKS_PER_DAY } from './day-loop.js';
import { UndoStack } from './undo.js';
import { eraFor, type EraStatus } from './era.js';
import { WorldEventLog, type WorldEvent } from './world-events.js';
import { computeRegenAmount, REGEN_RADIUS_FRACTION } from './nutrient-regen.js';
import { computeReachDistance, type WorldChunkSummary, type WorldOverview } from './world-overview.js';

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
  // M28: 母体 (初期source) から最遠ノードまでの距離。全ステージで計算する
  // (純粋な派生値で決定論に影響しない) が、HUD 表示は原野のみ (ui.ts)。
  reachDistance: number;
  // M28: 探索チャンク数 (生成済みチャンク数)。有界6ステージでは常に 0。
  exploredChunks: number;
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
  thickEdges: number;
  stage: { id: StageId; name: string; description: string };
  // ステージらしさを伝える装飾アイコンの目印座標 (廃墟の柱 / 鍾乳石 など)。
  landmarks: Vec2[];
  // M28-B: 「原野」の現在の窓原点 (実座標)。俯瞰チャンク (実座標のチャンク
  // 番地) を窓ローカル座標へ変換するのに使う。worldOverview.windowOrigin は
  // 集計時点の値 (最大1秒古い) なので、描画は必ずこちら (snapshot と同時刻の
  // 現在値) を使うこと。有界6ステージでは undefined。
  windowOrigin?: Vec2;
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
  // M14: 時代は条件達成型になったため、traits/world (どちらも派生計算側で
  // 間引いて再計算される) を必要とする。tick 毎の FastSnapshot からここへ移した。
  era: EraStatus;
}

export type GameSnapshot = FastSnapshot & DerivedSnapshot;

export const WORLD = 100;
export const FIELD = 96;

// M25: 「原野」(半無限ワールド) 専用の定数。
// WILDLAND_WORLD_SIZE は growth.ts の worldMargin 境界判定に実用上ひっかから
// ない程度に大きい値 (実質「無限」)。窓の一辺は既存ステージと同じ WORLD を
// 使う — Camera/Minimap が起動時に一度だけ game.worldSize (=WORLD) で構築
// され、以後ステージを切り替えても再構築されない前提を尊重するため、
// 「原野」もこの同じ WORLD をローカル座標系の広さとして扱う (窓が前線を
// 追って実座標側を平行移動することで、無限に広い土地を同じ大きさの窓から
// 覗き続ける)。
const WILDLAND_WORLD_SIZE = 1_000_000;
const WILDLAND_CENTER: Vec2 = { x: WILDLAND_WORLD_SIZE / 2, y: WILDLAND_WORLD_SIZE / 2 };
// 窓の bbox が縁からこの割合以内に近づいたら再センタリングする
// (chunk-window.ts の followWindowOrigin と同じ意味、値は経験的に選定)。
const WILDLAND_REBAKE_MARGIN = 0.25;
// M28: 「粘菌が占めている」とみなすバイオマスの下限。computeWorld() の
// 窓集計 (既存6ステージ) が使ってきた 0.05 と同じ値を、原野の全世界集計
// (チャンク横断) でも使う — 窓と世界で「面積」の定義がずれないようにする。
const BIOMASS_AREA_THRESHOLD = 0.05;
// M28: 原野の全世界統計 (チャンク横断走査) を再計算する tick 間隔。
// computeWorld() は snapshotDerived (250ms毎) と checkEraTransition (12tick毎)
// から呼ばれるため、毎回全チャンクを走査すると生成済みチャンク数に比例した
// 固定費が乗ってしまう。growthStep 系の間引き (12tick) の倍にあたる 24tick
// に1回だけ数え直し、間はキャッシュを返す (Day 100 実測 68チャンク規模で
// 走査は 1ms 未満、この頻度なら tick 本体に埋もれる)。
const WILDLAND_STATS_INTERVAL_TICKS = 24;

// M6: 単一 source ではなく、大マップに複数のコロニー (群体) を離して配置する。
// ズームアウト (zoom=1) すると全コロニーを見渡せ、ズームインすると
// 1コロニーだけの「個体ビュー」になる。DEFAULT_FOOD_POINTS とも十分な間隔を空ける。
// M14: 大陸ステージは stage.worldPoints() で拠点を手続き生成するため、
// これは「省略時のデフォルト」に格下げした (Game.sourcePoints/foodPoints が実体)。
const DEFAULT_SOURCE_POINTS: Vec2[] = [
  { x: 30, y: 30 },
  { x: 70, y: 30 },
  { x: 50, y: 75 },
];

// 皿の外周 6 箇所の固定食料点 (main petri デモと同じ構図)。
// バイオード生成で岩場をここに重ねないための「避けるべき地点」にも使う。
const DEFAULT_FOOD_POINTS: { pos: Vec2; radius: number; amount: number }[] = [
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
  // M14: 拠点。既存5ステージは DEFAULT_SOURCE_POINTS/DEFAULT_FOOD_POINTS を
  // そのまま使うが、大陸ステージは stage.worldPoints() でここを埋め替える。
  private sourcePoints: Vec2[] = DEFAULT_SOURCE_POINTS;
  private foodPoints: { pos: Vec2; radius: number; amount: number }[] = DEFAULT_FOOD_POINTS;
  // M10: 環境フィールドへのスタンプの取り消し (stroke 単位、深さ10)。
  private undo!: UndoStack;

  tool: Tool = 'food';
  brushRadius = 5;
  speed = 1;
  worldSize = WORLD;
  fieldSize = FIELD;

  private evoLog: EvolutionLog[] = [];
  // M14: 時代の切り替わりは生涯で最大3件しか起きない希少な節目なので、
  // 頻発する他のイベント (太い幹が育った 等) と同じ回転バッファを共有すると
  // すぐ流れて消えてしまう。専用の別枠に保持し、evolution() で合流させる。
  private eraLog: EvolutionLog[] = [];
  // M17: 「最近の出来事」。旧 recentEvents (string[]) を構造化し、時刻表示
  // (WorldEvent.tick から daytime.ts で導出) と「このエリアを注視中」
  // (WorldEvent.x/y と camera 視野の交差、main.ts/ui.ts 側の責務) を
  // 成立させる。保持数は 6 → 30 (注視フィルタで絞ると表示が痩せるため)。
  private worldEventLog = new WorldEventLog(30);
  // 太い管に「初めて」育った瞬間を1度だけ拾うための既知集合。
  private thickenedSeen = new Set<number>();
  // ループ生成は同じノード対が短時間で何度も emit されがちなので de-dup。
  private lastLoopAtTick = -999;
  // M12: ObstacleAvoided/SporeFormed も高頻度になりうるので同様に間引く。
  private lastObstacleAvoidedAtTick = -999;
  private lastSporeFormedAtTick = -999;
  // 「拠点 (コロニー)」の総数。リセット時に 6 で開始し、
  // プレイヤがエサを置くたびに増える。栄養が消費されてもカウントは減らさない
  // (= 一度設置した拠点は「到達対象」として残す)。
  private coloniesTotal = 6;

  // M25: 「原野」(半無限ワールド) 専用。stage.infinite でないステージでは
  // 全て null のまま — この節を触らない限り既存6ステージの挙動は完全に不変。
  //
  // this.env/act/bio (上の public フィールド) は常に「今の窓だけを覆う密な
  // 表示用スナップショット」であり続ける (既存6ステージではそれが実体その
  // ものと一致するので追加コストは無い)。実際の無限シミュレーションは
  // chunkEnv/chunkAct/chunkBio (ChunkedGridEnvironment 系) が担い、tick() の
  // 最後に windowOrigin 周辺だけを this.env/act/bio へ焼き直す。ツール配置
  // (apply) はこの chunk* 側へ直接書く — 密窓へ書いても次の焼き直しで
  // 消えてしまうため。
  private chunkEnv: ChunkedGridEnvironment | null = null;
  private chunkAct: ChunkedActivityField | null = null;
  private chunkBio: ChunkedBiomassField | null = null;
  // 窓 (this.env 等、ローカル座標 0..WORLD) の左上に対応する、chunkEnv 側の
  // 実座標。ノード位置は sim 内では実座標のまま保持し、表示用スナップショット
  // (snapshotFast の state) だけをこの値で平行移動する。
  private windowOrigin: Vec2 = { x: 0, y: 0 };
  // 前線を追って窓が再センタリングされた量の累積 (main.ts がカメラを同じ量
  // だけずらして「窓が動いた」ことを見た目に響かせないための差分)。
  // consumeWindowShift() で1回読むと 0 に戻る。
  private windowShiftDelta: Vec2 | null = null;
  // M28: 原野の全世界統計 (チャンク横断走査の結果) のキャッシュ。
  // WILDLAND_STATS_INTERVAL_TICKS に1回だけ数え直す (詳細は定数のコメント)。
  private wildlandStatsCache: { tick: number; areaM2: number; massKg: number; exploredChunks: number } | null = null;

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
    this.undo = new UndoStack(10);
    this.bus = new EventBus();
    this.stepCache = createStepCache();
    // 表示用の密フィールド (this.env/act/bio) は無限/既存どちらのステージでも
    // 必ずこの大きさで作る — 無限ステージは以後これを「窓」として毎tick焼き
    // 直し、既存ステージはこれ自体が sim の実体になる。
    this.env = new GridEnvironment({
      worldSize: WORLD, fieldSize: FIELD,
      baseMoisture: this.stage.baseMoisture, baseBrightness: this.stage.baseBrightness,
      baseTemperature: this.stage.baseTemperature,
    });
    this.act = new ActivityField(WORLD, FIELD);
    this.bio = new BiomassField(WORLD, FIELD);

    if (this.stage.infinite) {
      const chunkTerrain = this.stage.chunkTerrain;
      this.chunkEnv = new ChunkedGridEnvironment({
        worldSize: WILDLAND_WORLD_SIZE, worldSeed: seed,
        chunkCells: WILDLAND_CHUNK_CELLS, cellWorldSize: 1,
        baseMoisture: this.stage.baseMoisture, baseBrightness: this.stage.baseBrightness,
        baseTemperature: this.stage.baseTemperature,
        generateTerrain: chunkTerrain ? (coord, rng, worldSeed) => chunkTerrain(coord, rng, worldSeed) : undefined,
      });
      this.chunkAct = new ChunkedActivityField(WILDLAND_CHUNK_CELLS, 1);
      this.chunkBio = new ChunkedBiomassField(WILDLAND_CHUNK_CELLS, 1);
      this.state = createInitialState(seed, WILDLAND_WORLD_SIZE);
      this.sourcePoints = [WILDLAND_CENTER];
      this.foodPoints = []; // M27 の栄養再生は使わない (chunkTerrain が代わりに供給する)
      seedSource(this.state, WILDLAND_CENTER, 6);
      // 窓 (ローカル座標 0..WORLD) の中心に種が来るよう初期原点を決める。
      this.windowOrigin = { x: WILDLAND_CENTER.x - WORLD / 2, y: WILDLAND_CENTER.y - WORLD / 2 };
      this.windowShiftDelta = null;
      this.wildlandStatsCache = null;
      this.rebakeWildlandWindow();
      this.landmarks = [];
    } else {
      this.chunkEnv = null; this.chunkAct = null; this.chunkBio = null;
      this.windowOrigin = { x: 0, y: 0 };
      this.windowShiftDelta = null;
      this.wildlandStatsCache = null;
      this.state = createInitialState(seed, WORLD);

      // M14: 大陸ステージは worldPoints() で拠点を手続き生成する (rng は genome の
      // あとに消費するので、既存5ステージの rng 消費順には影響しない)。
      const wp = this.stage.worldPoints?.(this.rng, WORLD);
      this.sourcePoints = wp?.sources ?? DEFAULT_SOURCE_POINTS;
      this.foodPoints = wp?.food ?? DEFAULT_FOOD_POINTS;

      for (const p of this.sourcePoints) {
        clearAroundSource(this.env, p, 4);
        seedSource(this.state, p, 6);
      }
      for (const f of this.foodPoints) this.env.placeFood(f.pos, f.radius, f.amount * this.stage.foodAmountMultiplier);
      this.landmarks = this.stage.generateTerrain(this.env, this.rng, WORLD, [...this.sourcePoints, ...this.foodPoints.map((f) => f.pos)]);
    }

    this.evoLog = [];
    this.eraLog = [];
    this.worldEventLog.reset();
    this.thickenedSeen.clear();
    this.lastLoopAtTick = -999;
    this.lastObstacleAvoidedAtTick = -999;
    this.lastSporeFormedAtTick = -999;
    this.coloniesTotal = this.stage.infinite ? 1 : this.foodPoints.length;
    this.lastEra = '胞子期'; // 起動直後の初期時代 (eraFor() の既定と一致させる)
    this.pushEvent(`新しい${this.stage.name}が用意された`, 'stage-reset');
  }

  // M25: chunkEnv/chunkAct/chunkBio (実座標) の windowOrigin 周辺 span=WORLD
  // を、表示用の密フィールド this.env/act/bio へ焼き直す。前線が窓の縁に
  // 近づいていたら先に再センタリングし、その移動量を windowShiftDelta へ
  // 積む (main.ts がカメラを同じ量だけずらして継ぎ目を隠す)。
  private rebakeWildlandWindow(): void {
    const chunkEnv = this.chunkEnv, chunkAct = this.chunkAct, chunkBio = this.chunkBio;
    if (!chunkEnv || !chunkAct || !chunkBio) return;
    const next = followWindowOrigin(
      this.windowOrigin, this.state.nodes.map((n) => n.pos), WORLD, WILDLAND_REBAKE_MARGIN,
    );
    if (next) {
      const dx = this.windowOrigin.x - next.x, dy = this.windowOrigin.y - next.y;
      this.windowShiftDelta = {
        x: (this.windowShiftDelta?.x ?? 0) + dx, y: (this.windowShiftDelta?.y ?? 0) + dy,
      };
      this.windowOrigin = next;
    }
    bakeChunkWindow(chunkEnv, this.windowOrigin, { span: WORLD, fieldSize: FIELD }, this.env);
    bakeScalarFieldWindow(chunkAct, this.windowOrigin, WORLD, this.act);
    bakeScalarFieldWindow(chunkBio, this.windowOrigin, WORLD, this.bio);
  }

  // main.ts が毎フレーム一度だけ呼ぶ。窓が再センタリングされていればその
  // 移動量 (ローカル座標系での平行移動) を返し、内部カウンタは 0 に戻す。
  // camera.shiftCenter(dx, dy) に同じ値を渡すと、見た目上「窓が動いた」
  // ことに気づかれない (常に前線を追い続けているだけに見える)。
  consumeWindowShift(): Vec2 | null {
    const d = this.windowShiftDelta;
    this.windowShiftDelta = null;
    return d;
  }

  // M29: perf HUD (`?debug`) 用の休眠カウンタ。どちらも O(1) の読み出しで、
  // 有界6ステージ (休眠無効・chunkEnv=null) では常に 0。
  dormancyCounters(): { dormantCells: number; evictedChunks: number } {
    return {
      dormantCells: this.state.dormantCells?.size ?? 0,
      evictedChunks: this.chunkEnv?.evictedChunkCount() ?? 0,
    };
  }

  setTool(t: Tool): void { this.tool = t; }
  setBrush(r: number): void { this.brushRadius = r; }
  setSpeed(s: number): void { this.speed = Math.max(0, s | 0); }

  // steps を省略すると従来通り this.speed 回まわす。M8 P2 の時間予算
  // スケジューラ (sim-worker.ts) は、予算に収まると見積もった tick 数を
  // 明示的に渡す (speed そのままとは限らない)。
  tick(steps: number = this.speed): void {
    // M25: 「原野」は実座標側 (chunkEnv/chunkAct/chunkBio) を sim の実体として
    // step() に渡す — Environment/ActivityFieldLike/BiomassFieldLike の
    // 構造的インターフェース越しなので sim 側は無改修のまま両対応する。
    const env = this.chunkEnv ?? this.env;
    const act = this.chunkAct ?? this.act;
    const bio = this.chunkBio ?? this.bio;
    for (let i = 0; i < steps; i++) {
      step(this.state, env, act, bio, this.params, this.rng, this.bus, this.stepCache);
      env.decay(
        this.stage.nutrientDecayPerTick, this.stage.moistureRelaxPerTick,
        this.stage.tempRelaxPerTick, this.stage.toxinDecayPerTick,
      );
      // M14: 条件達成型の時代判定は WorldInfo (colonyNetworks の Union-Find を
      // 含む) が要るため、growthStep と同じ 12 tick に 1 回のペースに間引く
      // (毎tickだと M8 で間引いた分の計算コストが復活してしまう)。
      if (this.state.tick % 12 === 0) this.checkEraTransition();
      // M27: 日の変わり目に一度だけ、元の食料点へ薄く栄養を再生する
      // (Day 24 前後での完全停滞を「拡がる→痩せる→また拡がる」に変える)。
      // 「原野」は chunkTerrain が代わりに前線の先へ栄養を供給し続けるため
      // 対象外 (foodPoints=[] なので実質 no-op だが、意図を明示しておく)。
      if (!this.stage.infinite && this.state.tick % TICKS_PER_DAY === 0) this.regenerateNutrients();
    }
    if (this.stage.infinite) this.rebakeWildlandWindow();
    this.drainBus();
  }

  // M27: 栄養の再生サイクル。量は computeRegenAmount() (day の周期 + 局所湿度)
  // で決まる、season のボトムでは 0 になりうる薄い量。sim 側は無改修
  // (Environment.placeFood を呼ぶだけ)。
  private regenerateNutrients(): void {
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    for (const f of this.foodPoints) {
      const moisture = this.env.sampleGrowthContext(f.pos).moisture;
      const amount = computeRegenAmount(day, f.amount, moisture) * this.stage.foodAmountMultiplier;
      if (amount <= 0) continue;
      this.env.placeFood(f.pos, f.radius * REGEN_RADIUS_FRACTION, amount);
    }
  }

  // 「時代」(胞子期 → 拡散期 → 変形体期 → 成熟期) が切り替わった節目を進化の記録に残す。
  private checkEraTransition(): void {
    const colonies = computeColonyNetworks(this.state, this.sourcePoints);
    const world = this.computeWorld(colonies.networksCount);
    const traits = computeTraits(this.state);
    const era = eraFor({
      coloniesReached: world.coloniesReached, massKg: world.massKg,
      connectedNetworks: world.connectedNetworks, sourceColonies: world.sourceColonies,
      exploration: traits.exploration, day: Math.floor(this.state.tick / TICKS_PER_DAY),
    });
    if (era.name !== this.lastEra) {
      this.eraLog.unshift({ tick: this.state.tick, text: `${era.name}に入った` });
      this.lastEra = era.name;
    }
  }

  // EventBus に溜まった sim イベントを「最近の出来事」(worldEventLog) に
  // 翻訳して落とす。高頻度イベント (NewBranch / DeadEdge) は個別表示しない。
  // M17: 以前はここから「進化の記録」(evoLog) に積んでいたが、モックアップ②の
  // 「進化の記録」は突然変異/形質獲得のような節目 (day-report.ts 由来、web側)
  // 専用にし、こちらの粒度が細かい出来事は時刻表示・エリアフィルタが効く
  // 「最近の出来事」側へ一本化した。
  private drainBus(): void {
    const events = this.bus.drain();
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    for (const e of events) {
      const r = this.eventToWorldEvent(e);
      if (!r) continue;
      // M25: sim 内のイベント座標は「原野」では実座標のまま流れてくる。
      // 「最近の出来事」のエリア注視 (カメラ視野との交差判定) はローカル
      // 座標 (0..WORLD) 前提なので、窓原点ぶん引いてから記録する。
      const pos = r.pos && this.stage.infinite
        ? { x: r.pos.x - this.windowOrigin.x, y: r.pos.y - this.windowOrigin.y }
        : r.pos;
      this.worldEventLog.push({ day, tick: e.tick, kind: r.kind, text: r.text, x: pos?.x, y: pos?.y });
    }
  }

  private eventToWorldEvent(e: SimEvent): { kind: string; text: string; pos?: Vec2 } | null {
    switch (e.type) {
      case 'ReachedFood':
        return { kind: 'reached-food', text: '栄養を発見', pos: e.pos };
      case 'LoopCreated': {
        if (e.tick - this.lastLoopAtTick < 8) return null;
        this.lastLoopAtTick = e.tick;
        return { kind: 'loop-created', text: 'ネットワークが接続' };
      }
      case 'EdgeThickened': {
        if (e.radius < 1.6) return null;
        if (this.thickenedSeen.has(e.edgeId)) return null;
        this.thickenedSeen.add(e.edgeId);
        return { kind: 'edge-thickened', text: '太い幹が育った' };
      }
      case 'Stagnated':
        return { kind: 'stagnated', text: '成長が停滞' };
      case 'ObstacleAvoided': {
        if (e.tick - this.lastObstacleAvoidedAtTick < 8) return null;
        this.lastObstacleAvoidedAtTick = e.tick;
        return { kind: 'obstacle-avoided', text: '障害物を迂回', pos: e.pos };
      }
      case 'SporeFormed': {
        if (e.tick - this.lastSporeFormedAtTick < 8) return null;
        this.lastSporeFormedAtTick = e.tick;
        return { kind: 'spore-formed', text: '胞子を生成', pos: e.pos };
      }
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
    this.pushEvent('やり直した', 'undo');
  }

  // pos はワールド座標 (0..worldSize)。画面→ワールド変換はカメラ (main 側) の責務。
  // fieldSize/worldSize 比の変換は GridEnvironment.toField() と同じ式
  // (private のため、Undo 記録用にここでも同じ変換を行う)。
  apply(pos: Vec2): void {
    // M25: 「原野」は表示用の窓 (this.env) へ書いても次の tick() の焼き直しで
    // 消えてしまう。実座標側 (chunkEnv) へ直接書く専用経路を使う。
    if (this.stage.infinite) { this.applyWildlandTool(pos); return; }
    const r = this.brushRadius;
    const s = this.fieldSize / this.worldSize;
    const fx = pos.x * s, fy = pos.y * s;
    switch (this.tool) {
      case 'food':
        this.undo.recordBefore(this.env.nutrients, fx, fy, r * 2 + 1);
        this.env.placeFood(pos, r, 0.7);
        this.coloniesTotal += 1;
        this.pushEvent('栄養を撒いた', 'tool-food', pos);
        break;
      case 'light':
        this.undo.recordBefore(this.env.brightness, fx, fy, r * 2 + 1);
        this.env.placeLight(pos, r, 0.45);
        this.pushEvent('光をあてた', 'tool-light', pos);
        break;
      case 'water':
        this.undo.recordBefore(this.env.moisture, fx, fy, r * 2 + 1);
        this.env.placeWater(pos, r, 0.4);
        this.pushEvent('水を引いた', 'tool-water', pos);
        break;
      case 'drain':
        this.undo.recordBefore(this.env.moisture, fx, fy, r * 2 + 1);
        this.env.placeDrain(pos, r, 0.35);
        this.pushEvent('水を止めた', 'tool-drain', pos);
        break;
      case 'stone': {
        const sr = Math.max(2, r * 0.5);
        this.undo.recordBefore(this.env.obstacle, fx, fy, sr + 1);
        this.env.placeStone(pos, sr);
        this.pushEvent('障害物を置いた', 'tool-stone', pos);
        break;
      }
      case 'heat':
        this.undo.recordBefore(this.env.temperature, fx, fy, r * 2 + 1);
        this.env.placeHeat(pos, r, 0.12);
        this.pushEvent('温度を上げた', 'tool-heat', pos);
        break;
      case 'cool':
        this.undo.recordBefore(this.env.temperature, fx, fy, r * 2 + 1);
        this.env.placeHeat(pos, r, -0.12);
        this.pushEvent('温度を下げた', 'tool-cool', pos);
        break;
      case 'toxin':
        this.undo.recordBefore(this.env.toxin, fx, fy, r * 2 + 1);
        this.env.placeToxin(pos, r, 0.35);
        this.pushEvent('毒素をまいた', 'tool-toxin', pos);
        break;
      case 'erase':
        this.eraseFields(fx, fy, r * s);
        this.erase(pos, r);
        this.pushEvent('土地をならした', 'tool-erase', pos);
        break;
    }
  }

  // M25: 「原野」専用のツール適用。実座標 (windowOrigin ぶんずらした pos) へ
  // chunkEnv 側の place* を直接呼ぶ。チャンク系フィールドは密な FieldGrid
  // ではない (Map ベース) ため Undo の記録方式 (recordBefore) がそのままでは
  // 使えず、この一手を取り消す機能はスコープ外とする (canUndo は自然に
  // false のまま — 既存ステージの Undo 挙動には一切影響しない)。'erase' も
  // 同じ理由でスコープ外 (無効: 押しても何も起きない)。
  private applyWildlandTool(pos: Vec2): void {
    const env = this.chunkEnv;
    if (!env) return;
    const r = this.brushRadius;
    const real: Vec2 = { x: pos.x + this.windowOrigin.x, y: pos.y + this.windowOrigin.y };
    // M29: プレイヤーの介入は休眠領域を起こす (起床経路その3)。起こして
    // おかないと、撒いた餌や毒に周囲のエッジが checkInterval を過ぎても
    // 反応しない (休眠セル内は activity 更新も成長もスキップされるため)。
    // 休眠無効 (既定) の有界ステージではこの経路に入らないので影響なし。
    wakeDormantArea(this.state, this.params, real, r);
    switch (this.tool) {
      case 'food':
        env.placeFood(real, r, 0.7);
        this.coloniesTotal += 1;
        this.pushEvent('栄養を撒いた', 'tool-food', pos);
        break;
      case 'light':
        env.placeLight(real, r, 0.45);
        this.pushEvent('光をあてた', 'tool-light', pos);
        break;
      case 'water':
        env.placeWater(real, r, 0.4);
        this.pushEvent('水を引いた', 'tool-water', pos);
        break;
      case 'drain':
        env.placeDrain(real, r, 0.35);
        this.pushEvent('水を止めた', 'tool-drain', pos);
        break;
      case 'stone':
        env.placeStone(real, Math.max(2, r * 0.5));
        this.pushEvent('障害物を置いた', 'tool-stone', pos);
        break;
      case 'heat':
        env.placeHeat(real, r, 0.12);
        this.pushEvent('温度を上げた', 'tool-heat', pos);
        break;
      case 'cool':
        env.placeHeat(real, r, -0.12);
        this.pushEvent('温度を下げた', 'tool-cool', pos);
        break;
      case 'toxin':
        env.placeToxin(real, r, 0.35);
        this.pushEvent('毒素をまいた', 'tool-toxin', pos);
        break;
      case 'erase':
        break; // スコープ外 (上記コメント参照)
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
      state: this.stage.infinite ? this.translatedState() : this.state,
      env: this.env, bio: this.bio, genome: this.genome,
      day, thickEdges,
      stage: { id: this.stage.id, name: this.stage.name, description: this.stage.description },
      landmarks: this.landmarks,
      windowOrigin: this.stage.infinite ? { x: this.windowOrigin.x, y: this.windowOrigin.y } : undefined,
    };
  }

  // M25: render.ts/main.ts はノード座標がローカル座標 (0..WORLD、camera/env と
  // 同じ座標系) であることを前提にしている。「原野」の sim 本体は実座標
  // (windowOrigin ぶん大きい) のまま保持するので、描画に渡す直前だけ
  // ノード位置を平行移動した浅いクローンを作る (ノード数は prune で有界、
  // 実測 数十〜数百件程度に保たれるため毎フレームの複製コストは小さい —
  // ROADMAP.md M25 参照)。edges はノードIDだけを参照する構造なので複製不要。
  private translatedState(): SimState {
    const o = this.windowOrigin;
    return {
      ...this.state,
      nodes: this.state.nodes.map((n) => ({ ...n, pos: { x: n.pos.x - o.x, y: n.pos.y - o.y } })),
    };
  }

  snapshotDerived(): DerivedSnapshot {
    const traits = computeTraits(this.state);
    const individuality = computeIndividuality(this.state);
    const typeInfo = classifyIndividual(individuality);
    const balance = this.computeBalance();
    const colonies = computeColonyNetworks(this.state, this.sourcePoints);
    const world = this.computeWorld(colonies.networksCount);
    const quests = computeQuests({
      coloniesReached: world.coloniesReached, coloniesTotal: world.coloniesTotal, traits,
      sourceColonies: world.sourceColonies, connectedNetworks: world.connectedNetworks,
      landCoverage: this.computeLandCoverage(),
    });
    const era = eraFor({
      coloniesReached: world.coloniesReached, massKg: world.massKg,
      connectedNetworks: world.connectedNetworks, sourceColonies: world.sourceColonies,
      exploration: traits.exploration, day: Math.floor(this.state.tick / TICKS_PER_DAY),
    });
    // M25: colonyMarkers の pos/centroid は computeColonyNetworks が
    // this.state (「原野」では実座標) から導出するため、カメラ追従
    // (focusOn) やミニマップがローカル座標 (0..WORLD) を前提にできるよう
    // ここで窓原点ぶん平行移動する。
    const colonyMarkers = this.stage.infinite
      ? colonies.markers.map((m) => ({
        ...m,
        pos: { x: m.pos.x - this.windowOrigin.x, y: m.pos.y - this.windowOrigin.y },
        centroid: { x: m.centroid.x - this.windowOrigin.x, y: m.centroid.y - this.windowOrigin.y },
      }))
      : colonies.markers;
    return { traits, individuality, typeInfo, balance, world, quests, colonyMarkers, era };
  }

  snapshot(): GameSnapshot {
    return { ...this.snapshotFast(), ...this.snapshotDerived() };
  }

  events(): readonly WorldEvent[] { return this.worldEventLog.all(); }
  // 時代の節目 (eraLog, 最大3件) を頻発イベント (evoLog) より優先して先頭に出す。
  evolution(): EvolutionLog[] {
    return [...this.eraLog, ...this.evoLog].sort((a, b) => b.tick - a.tick);
  }

  pushEvent(msg: string, kind: string, pos?: Vec2): void {
    const day = Math.floor(this.state.tick / TICKS_PER_DAY);
    this.worldEventLog.push({ day, tick: this.state.tick, kind, text: msg, x: pos?.x, y: pos?.y });
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
    // 拠点総数は配置回数で素直に数える (computeWorld で派生しない)。
    const coloniesTotal = this.coloniesTotal;
    // 到達数: sink ノード数を独立な拠点に「圧縮」する。
    // 1 つの食料源に複数の tip が到達すると sink がたくさん作られるため
    // そのまま数えると拠点数を超えてしまう。
    // sink を近接半径でクラスタリングして拠点数を概算する。
    const sinks = this.state.nodes.filter((n) => n.type === 'sink');
    const reached = clusterCount(sinks.map((n) => n.pos), 6 /* world units */);
    const coloniesReached = Math.min(coloniesTotal, reached);
    // M28: 到達距離 = 母体 (初期source、原野では WILDLAND_CENTER) から
    // 最遠ノードまでの距離。純粋な派生値 (rng もフィールドも触らない) なので
    // 全ステージで計算して問題ないが、表示は原野のみ (ui.ts)。
    const mother = this.sourcePoints[0] ?? { x: 0, y: 0 };
    const reachDistance = computeReachDistance(this.state.nodes.map((n) => n.pos), mother);
    // M28: 面積・総量は、原野では窓 (this.bio、理論上限 WORLD² = 10,000m²)
    // ではなくチャンク横断の全世界集計を使う (ROADMAP.md V2: 「総面積が窓の
    // 中しか数えていない」の解消)。既存6ステージは従来通りの窓集計で、数値は
    // bit 一致で不変。
    const { areaM2, massKg, exploredChunks } = this.stage.infinite
      ? this.wildlandWorldStats()
      : { ...this.windowBiomassStats(), exploredChunks: 0 };
    return {
      areaM2,
      massKg,
      networkLinks: this.state.edges.length,
      coloniesReached,
      coloniesTotal,
      sourceColonies: this.sourcePoints.length,
      connectedNetworks,
      reachDistance,
      exploredChunks,
    };
  }

  // 既存6ステージの面積・総量 (従来の computeWorld 本体そのまま)。
  // 占有面積: biomass が一定値以上のセル数。世界全体を 100×100 m² とみなす。
  private windowBiomassStats(): { areaM2: number; massKg: number } {
    const n = this.fieldSize * this.fieldSize;
    const cellArea = (WORLD * WORLD) / n; // m²/cell
    let cells = 0;
    let mass = 0;
    for (let i = 0; i < n; i++) {
      const v = this.bio.field.data[i] ?? 0;
      mass += v;
      if (v > BIOMASS_AREA_THRESHOLD) cells++;
    }
    // 粘菌の総量 (kg 想定): biomass の総和 × 単位 (係数は体感優先で調整)。
    // モックアップ ~4kg 規模に近付くよう、薄めの密度に倒す。
    return {
      areaM2: Math.round(cells * cellArea),
      massKg: +(mass * cellArea * 0.0009).toFixed(2),
    };
  }

  // M28: 原野の全世界統計。チャンク横断の走査は WILDLAND_STATS_INTERVAL_TICKS
  // に1回だけ行い、間はキャッシュを返す (computeWorld は 250ms毎 + 12tick毎に
  // 呼ばれるため)。面積・総量の式は窓集計 (windowBiomassStats) と同じで、
  // セル面積だけがチャンク側の解像度 (cellWorldSize², 出荷値 1m²/cell) になる。
  private wildlandWorldStats(): { areaM2: number; massKg: number; exploredChunks: number } {
    const chunkEnv = this.chunkEnv, chunkBio = this.chunkBio;
    if (!chunkEnv || !chunkBio) return { areaM2: 0, massKg: 0, exploredChunks: 0 };
    const cached = this.wildlandStatsCache;
    if (cached && this.state.tick >= cached.tick && this.state.tick - cached.tick < WILDLAND_STATS_INTERVAL_TICKS) {
      return cached;
    }
    const cellArea = chunkBio.cellWorldSize * chunkBio.cellWorldSize; // m²/cell
    const world = chunkBio.summarizeWorld(BIOMASS_AREA_THRESHOLD);
    const next = {
      tick: this.state.tick,
      areaM2: Math.round(world.cellsAbove * cellArea),
      massKg: +(world.total * cellArea * 0.0009).toFixed(2),
      // M29: evict (実体解放) で generatedChunkCount() は減るようになった。
      // 「探索チャンク」は踏破の累計なので、evict 済みも含む touched を数える。
      exploredChunks: chunkEnv.touchedChunkCount(),
    };
    this.wildlandStatsCache = next;
    return next;
  }

  // M28: 「原野」の全世界俯瞰。チャンク要約 (地形 + バイオマス) と全世界統計を
  // 1つに束ねて返す。Worker が低頻度 (sim-worker.ts) で main スレッドへ送る。
  // sim 側の summarize* は peekChunk ベース (副作用なし) なので、これを何度
  // 呼んでも sim の決定論は乱れない。有界6ステージでは null。
  worldOverview(): WorldOverview | null {
    const chunkEnv = this.chunkEnv, chunkBio = this.chunkBio;
    if (!chunkEnv || !chunkBio) return null;
    const terrain = chunkEnv.summarizeChunks();
    const bio = chunkBio.summarizeChunks(BIOMASS_AREA_THRESHOLD);
    const bioByKey = new Map(bio.map((s) => [`${s.cx}:${s.cy}`, s.total]));
    const chunks: WorldChunkSummary[] = terrain.map((t) => ({
      cx: t.cx, cy: t.cy,
      nutrientAvg: t.nutrientAvg,
      obstacleDensity: t.obstacleDensity,
      hasWater: t.hasWater,
      biomass: bioByKey.get(`${t.cx}:${t.cy}`) ?? 0,
    }));
    // バイオマス場は拡散の縁で「地形チャンク未生成のままバイオマスだけ滲んだ」
    // チャンクを持ちうる。落とすと世界の縁が欠けるので、地形 0 扱いで含める。
    const seen = new Set(terrain.map((t) => `${t.cx}:${t.cy}`));
    for (const s of bio) {
      if (seen.has(`${s.cx}:${s.cy}`)) continue;
      chunks.push({ cx: s.cx, cy: s.cy, nutrientAvg: 0, obstacleDensity: 0, hasWater: false, biomass: s.total });
    }
    const stats = this.wildlandWorldStats();
    const mother = this.sourcePoints[0] ?? WILDLAND_CENTER;
    return {
      chunks,
      // チャンク要約は実座標なので、窓相対 (ローカル座標 0..WORLD) で使える
      // よう窓原点も一緒に届ける (受け手が実座標 - windowOrigin で変換する)。
      windowOrigin: { x: this.windowOrigin.x, y: this.windowOrigin.y },
      chunkWorldSize: chunkEnv.chunkCells * chunkEnv.cellWorldSize,
      stats: {
        areaM2: stats.areaM2,
        massKg: stats.massKg,
        exploredChunks: stats.exploredChunks,
        reachDistance: computeReachDistance(this.state.nodes.map((n) => n.pos), mother),
      },
      tick: this.state.tick,
    };
  }

  // M14: 大陸ステージの「大陸全体に栄養を届けよう」クエスト用。陸地セル
  // (water が立っていないセル) のうち、biomass が一定以上あるセルの比率。
  // 水域を持たないステージでは land が全セル数と一致し、単純な「粘菌の
  // 被覆率」相当になる (無害なので常時計算する)。
  private computeLandCoverage(): number {
    const n = this.fieldSize * this.fieldSize;
    let land = 0, covered = 0;
    for (let i = 0; i < n; i++) {
      if ((this.env.water.data[i] ?? 0) > 0.5) continue;
      land++;
      if ((this.bio.field.data[i] ?? 0) > 0.03) covered++;
    }
    return land > 0 ? covered / land : 0;
  }
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
