// シミュレーション Worker。
//
// Game (tick / apply / reset) をメインスレッドから切り離し、
// この Worker が自前のタイマーで走らせる。メインスレッドは
// 入力コマンド (setTool 等) を送るだけで、描画は最後に届いた
// スナップショットを使う。→ 速度 ×16 で tick が重くても UI 操作 (drag,
// ポインタ移動によるホバー表示) は止まらない。

import { Game } from './game.js';
import type { ToWorkerMessage, FromWorkerMessage, WireSnapshot } from './worker-protocol.js';
import { TickScheduler } from './tick-scheduler.js';
import type { DerivedSnapshot } from './game.js';
import { packNodes, packEdges } from './snapshot-codec.js';
import { TICKS_PER_DAY } from './day-loop.js';

// self は DOM の Window 型として推論されるため (tsconfig の lib: DOM)、
// worker 実行時にだけ現れる postMessage/onmessage を緩く型付けする。
const ctx = self as unknown as {
  postMessage(msg: FromWorkerMessage, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<ToWorkerMessage>) => void) | null;
};

const game = new Game();
const TICK_INTERVAL_MS = 16;
// M8 P4: 早送りモード。描画/スナップショット送信をこれまでの ~60fps 相当
// (16ms 間隔) から 10fps (100ms 間隔) まで落とし、浮いた時間をすべて
// tick に回す。ループ間隔を伸ばす分、スケジューラの予算 (budgetMs) と
// 借金の上限 (maxDebtTicks) も同じ比率で引き上げないと、単に「呼ばれる
// 回数が減っただけ」で総 tick 数がむしろ減ってしまう。
const FAST_FORWARD_INTERVAL_MS = 100;
const FAST_FORWARD_RATIO = FAST_FORWARD_INTERVAL_MS / TICK_INTERVAL_MS;
let fastForward = false;
let loopIntervalMs = TICK_INTERVAL_MS;

// M15.7: 実プレイ検証で「1日 (40 tick) が ×1 で実時間0.64秒しかない」ことが
// 判明した (旧実装は demand=speed をそのまま毎フレームの debt に積んでいた
// ため、事実上 1 tick ≈ 1 ループ (16ms) だった)。モックアップの「育成中…
// 02:34」が示す "数分委ねて眺める" 体験を成立させるため、tick の生成を
// 「実時間ベースの分数蓄積」に切り替える: ×1 における1日の実時間長 (秒) を
// SECONDS_PER_DAY で定義し、そこから逆算した ticks/秒をフレーム経過時間分
// だけ demandAccumulator に貯め、整数分だけ切り出して初めて scheduler へ渡す
// (scheduler.planSteps は「渡した数だけ本当に tick する」前提の設計なので、
// 端数のまま渡すと debt/estTickMs の計算が壊れる — 端数の保持はここでの
// 責務にする)。TICKS_PER_DAY 自体は変えない: era/quests/challenges の
// day ベースの閾値 (M15.5) は「1日あたりの生の tick 数」に依存しており、
// ここを変えると全部の再調整が要る。日の「長さ」だけを実時間側で変える。
const DEFAULT_SECONDS_PER_DAY = 120; // ×1 で1日 = 2分 (目標帯 2〜3分の下限寄り)
let secondsPerDayAtSpeed1 = DEFAULT_SECONDS_PER_DAY;
let demandAccumulator = 0;
// 一時停止中 (speed=0) は tick が進まないので、盤面を変えた
// (apply/reset) 直後だけ再送すれば十分。毎フレーム同じスナップショットを
// clone して送り続けるのは無駄な GC 圧になる。
let dirty = true;

// M8 P0: perf HUD 用の計測。「スライダーの ×24 が実際には出ていない」を
// 可視化するため、直近 ~0.5秒の実測から実効速度倍率を算出する。
let lastTickMs = 0;
let ticksInWindow = 0;
let windowStartMs = performance.now();
let effectiveSpeed = 0;
const EFFECTIVE_SPEED_WINDOW_MS = 500;

// M8 P2: 時間予算スケジューラ。「speed 倍を毎 16ms 必ず全部回す」のではなく、
// 16ms 予算に収まる分だけ回し、残りは borrow (借金) として繰り越す
// (tick-scheduler.ts 参照)。借金の上限はスライダー最大速度 (×24) の
// 数フレーム分にとどめ、タブ復帰直後などの暴走を防ぐ。
const scheduler = new TickScheduler({ budgetMs: TICK_INTERVAL_MS, maxDebtTicks: 96 });

// M9: デイループの「委ねる」フェーズ。null の間は従来通り (speed 分だけ回し続ける)。
// 値がある間は、その tick に到達したら steps を切り詰めて越えないようにし、
// 到達した時点で自動的に speed=0 へ止めて 'dayCompleted' を1回だけ通知する。
let dayTarget: number | null = null;

// M8 P2: 派生計算 (traits/individuality/colonyNetworks/balance/world/quests) は
// 毎tick変わるものではないので、盤面が変わった直後 (reset/apply) だけ
// 即時再計算し、それ以外は 250ms 毎に間引く。state/env/bio 等の「描画に
// 毎tick必要な部分」(snapshotFast) はそのまま毎回作り直す。
const DERIVED_INTERVAL_MS = 250;
let lastDerived: DerivedSnapshot = game.snapshotDerived();
let lastDerivedAtMs = performance.now();
let forceDerived = false;

ctx.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'reset': game.reset(msg.seed, msg.stageId, msg.parentGenome); dirty = true; forceDerived = true; demandAccumulator = 0; break;
    case 'setSpeed': game.setSpeed(msg.speed); break;
    case 'setTool': game.setTool(msg.tool); break;
    case 'setBrush': game.setBrush(msg.radius); break;
    case 'apply': game.apply(msg.pos); dirty = true; forceDerived = true; break;
    case 'setFastForward': {
      fastForward = msg.enabled;
      loopIntervalMs = fastForward ? FAST_FORWARD_INTERVAL_MS : TICK_INTERVAL_MS;
      scheduler.setBudgetMs(loopIntervalMs);
      scheduler.setMaxDebtTicks(fastForward ? Math.round(96 * FAST_FORWARD_RATIO) : 96);
      break;
    }
    case 'runUntilTick': {
      dayTarget = msg.target;
      // 前日の余り debt を持ち越さない (day-loop.ts 参照)。
      // target=null (日境界キャップ解除) はモード切替の後始末なので対象外。
      if (msg.target !== null) scheduler.reset();
      break;
    }
    case 'beginStroke': game.beginStroke(); break;
    case 'endStroke': game.endStroke(); break;
    case 'undoStroke': game.undoStroke(); dirty = true; forceDerived = true; break;
    case 'setSecondsPerDay': {
      if (Number.isFinite(msg.seconds) && msg.seconds > 0) secondsPerDayAtSpeed1 = msg.seconds;
      break;
    }
  }
};

let dayCompletedPending = false;

function loop(): void {
  if (game.speed > 0) {
    // M15.7: 「speed 倍」を実時間ベースの ticks/秒に変換し、フレーム経過時間
    // (loopIntervalMs) 分だけ demandAccumulator に貯める。早送り中もループ間隔
    // (100ms) がそのまま経過時間として乗るので、旧 FAST_FORWARD_RATIO のような
    // 補正は不要になった (早送りの役割は budgetMs/maxDebtTicks の引き上げに
    // よる tick スループット天井の底上げだけに整理された)。
    const ticksPerSecondAtSpeed1 = TICKS_PER_DAY / secondsPerDayAtSpeed1;
    const targetTicksPerSecond = game.speed * ticksPerSecondAtSpeed1;
    demandAccumulator += targetTicksPerSecond * (loopIntervalMs / 1000);
    const demand = Math.floor(demandAccumulator);
    demandAccumulator -= demand;
    let steps = scheduler.planSteps(demand);
    // M9: dayTarget を越えて進めない (日境界ちょうどで止める)。
    if (dayTarget !== null) steps = Math.min(steps, Math.max(0, dayTarget - game.state.tick));
    if (steps > 0) {
      const t0 = performance.now();
      game.tick(steps);
      const elapsed = performance.now() - t0;
      scheduler.report(steps, elapsed);
      lastTickMs = elapsed / steps;
      ticksInWindow += steps;
      dirty = true;
    }
    if (dayTarget !== null && game.state.tick >= dayTarget) {
      dayTarget = null;
      game.setSpeed(0);
      dayCompletedPending = true;
      dirty = true;
      forceDerived = true;
    }
  }
  const now = performance.now();
  const windowElapsed = now - windowStartMs;
  if (windowElapsed >= EFFECTIVE_SPEED_WINDOW_MS) {
    // M15.7: 旧実装は「×1 ≈ 1 tick/16ms」前提で effectiveSpeed を
    // 「倍率」として計算していたが、時間スケール変更でその前提が崩れた。
    // 単位を実測 ticks/秒 (絶対値) に変え、main.ts の残り時間予測もこの
    // 単位で直接使えるようにする (perf HUD の表示ラベルは変えない —
    // 「speed x{n} / x{targetSpeed}」の n が「倍率」から「ticks/秒」に
    // 意味を変えるだけで、既存 e2e の正規表現はどちらでも通る)。
    effectiveSpeed = (ticksInWindow / windowElapsed) * 1000;
    ticksInWindow = 0;
    windowStartMs = now;
  }
  if (dirty) {
    if (forceDerived || now - lastDerivedAtMs >= DERIVED_INTERVAL_MS) {
      lastDerived = game.snapshotDerived();
      lastDerivedAtMs = now;
      forceDerived = false;
    }
    const { state, ...fastRest } = game.snapshotFast();
    // M8 P2: nodes/edges だけ Float32Array にパックし、transferable として
    // ゼロコピーで送る (structuredClone がオブジェクト配列を辿るコストを避ける)。
    const nodesBuf = packNodes(state.nodes);
    const edgesBuf = packEdges(state.edges);
    const wire: WireSnapshot = {
      ...fastRest,
      ...lastDerived,
      stateMeta: { tick: state.tick, seed: state.seed, nextNodeId: state.nextNodeId, nextEdgeId: state.nextEdgeId, worldSize: state.worldSize },
      nodesBuf,
      edgesBuf,
    };
    ctx.postMessage({
      type: 'snapshot',
      snapshot: wire,
      events: game.events(),
      evolution: game.evolution(),
      perf: { tickMs: lastTickMs, targetSpeed: game.speed, effectiveSpeed },
    }, [nodesBuf.buffer, edgesBuf.buffer]);
    dirty = false;
  }
  // M9: 最終 tick を含むスナップショットを送った直後に通知する
  // (先に通知すると、メインスレッドがまだ古い日のスナップショットで
  // 結果パネルを組み立ててしまう)。
  if (dayCompletedPending) {
    dayCompletedPending = false;
    ctx.postMessage({ type: 'dayCompleted' });
  }
  setTimeout(loop, loopIntervalMs);
}
loop();
