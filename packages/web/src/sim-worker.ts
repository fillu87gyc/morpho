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
import { DEFAULT_DAY_MS } from './time-scale.js';

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
// 一時停止中 (speed=0) は tick が進まないので、盤面を変えた
// (apply/reset) 直後だけ再送すれば十分。毎フレーム同じスナップショットを
// clone して送り続けるのは無駄な GC 圧になる。
let dirty = true;

// M15.7: 実時間ペーシング。以前は「speed 倍を毎ループ呼び出しごとに1tick分
// 要求する」だけだったため、1日の実時間がループ間隔 (TICK_INTERVAL_MS) と
// TICKS_PER_DAY だけで決まってしまい、観察に値する長さにならなかった
// (ROADMAP.md M15.7)。ここでは「1 tick が実時間何 ms か」(dayMs /
// TICKS_PER_DAY) を基準に、経過した実時間から要求 tick 数を導く
// アキュムレータを持つ。ループの呼び出し頻度 (loopIntervalMs, 早送りで
// 16→100ms) を変えても実時間ベースなので自動的に整合する — 早送りは
// 従来通り「呼び出し1回あたりの計算予算」を増やす役割 (TickScheduler) に
// 専念させる。
let dayMs = DEFAULT_DAY_MS;
let baseTickMs = dayMs / TICKS_PER_DAY;
let paceDebt = 0; // 貯まっている「要求 tick」の端数
let lastPaceAtMs = performance.now();

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

// M28: 「原野」の全世界俯瞰。チャンク要約の走査は snapshot と桁違いに重く
// なりうる (生成済みチャンク数に比例) ので、1秒に1回まで間引く。盤面が
// 変わっていない間 (dirty が一度も立たなかった間) は再送もしない。
const WORLD_OVERVIEW_INTERVAL_MS = 1000;
let lastOverviewAtMs = 0;
let overviewPending = true; // 起動直後・reset/apply 後は次の機会に必ず送る

ctx.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case 'reset': game.reset(msg.seed, msg.stageId, msg.parentGenome); dirty = true; forceDerived = true; break;
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
    case 'setDayMs': {
      dayMs = msg.ms > 0 ? msg.ms : DEFAULT_DAY_MS;
      baseTickMs = dayMs / TICKS_PER_DAY;
      paceDebt = 0; // 日長切替の瞬間に貯まっていた端数をそのまま持ち越さない
      break;
    }
  }
};

let dayCompletedPending = false;

function loop(): void {
  // M15.7: 呼び出し間隔 (16ms、早送り中は100ms) がそのまま「1tickの実時間」
  // だった旧実装をやめ、実際に経過した壁時計時間から要求 tick 数を導く。
  // ループが速く/遅く呼ばれても (早送りのループ間隔変更、タブのスロット
  // リング等) 自動的に整合するため、早送り用の比率換算は不要になった。
  const nowPace = performance.now();
  const elapsedPaceMs = nowPace - lastPaceAtMs;
  lastPaceAtMs = nowPace;
  if (game.speed > 0) {
    paceDebt += (elapsedPaceMs / baseTickMs) * game.speed;
    const demand = Math.floor(paceDebt);
    paceDebt -= demand;
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
  const now = nowPace;
  const windowElapsed = now - windowStartMs;
  if (windowElapsed >= EFFECTIVE_SPEED_WINDOW_MS) {
    // 「×1 (1 tick = baseTickMs ms) で進めた場合」を基準にした倍率 (M15.7)。
    effectiveSpeed = (ticksInWindow / windowElapsed) * baseTickMs;
    ticksInWindow = 0;
    windowStartMs = now;
  }
  // M28: 盤面が変わった (dirty が立った) ことを覚えておき、間引き間隔ごとに
  // 全世界俯瞰を送り直す。dirty 自体は下の snapshot 送信でクリアされるため、
  // 別フラグに写し取っておく (間隔未達のまま dirty が消えても取りこぼさない)。
  if (dirty) overviewPending = true;
  if (overviewPending && now - lastOverviewAtMs >= WORLD_OVERVIEW_INTERVAL_MS) {
    lastOverviewAtMs = now;
    overviewPending = false;
    const overview = game.worldOverview(); // 有界6ステージでは null (送らない)
    if (overview) ctx.postMessage({ type: 'worldOverview', overview });
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
      // M25: この snapshot が反映する tick() 呼び出し群の間に窓が動いた量。
      // dirty (=この回で実際に snapshot を送る) のときだけ消費する —
      // 送らない回で消費すると、次に実際に送られる snapshot にその分の
      // シフトが乗らずカメラがずれる。
      windowShift: game.consumeWindowShift(),
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
