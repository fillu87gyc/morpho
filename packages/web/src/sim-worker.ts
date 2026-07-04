// シミュレーション Worker。
//
// Game (tick / apply / reset) をメインスレッドから切り離し、
// この Worker が自前のタイマーで走らせる。メインスレッドは
// 入力コマンド (setTool 等) を送るだけで、描画は最後に届いた
// スナップショットを使う。→ 速度 ×16 で tick が重くても UI 操作 (drag,
// ポインタ移動によるホバー表示) は止まらない。

import { Game } from './game.js';
import type { ToWorkerMessage, FromWorkerMessage } from './worker-protocol.js';
import { TickScheduler } from './tick-scheduler.js';
import type { DerivedSnapshot } from './game.js';

// self は DOM の Window 型として推論されるため (tsconfig の lib: DOM)、
// worker 実行時にだけ現れる postMessage/onmessage を緩く型付けする。
const ctx = self as unknown as {
  postMessage(msg: FromWorkerMessage): void;
  onmessage: ((e: MessageEvent<ToWorkerMessage>) => void) | null;
};

const game = new Game();
const TICK_INTERVAL_MS = 16;
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
    case 'reset': game.reset(msg.seed, msg.stageId, msg.parentGenome); dirty = true; forceDerived = true; break;
    case 'setSpeed': game.setSpeed(msg.speed); break;
    case 'setTool': game.setTool(msg.tool); break;
    case 'setBrush': game.setBrush(msg.radius); break;
    case 'apply': game.apply(msg.pos); dirty = true; forceDerived = true; break;
  }
};

function loop(): void {
  if (game.speed > 0) {
    const steps = scheduler.planSteps(game.speed);
    if (steps > 0) {
      const t0 = performance.now();
      game.tick(steps);
      const elapsed = performance.now() - t0;
      scheduler.report(steps, elapsed);
      lastTickMs = elapsed / steps;
      ticksInWindow += steps;
      dirty = true;
    }
  }
  const now = performance.now();
  const windowElapsed = now - windowStartMs;
  if (windowElapsed >= EFFECTIVE_SPEED_WINDOW_MS) {
    // 「1 tick ずつ ×1 で進めた場合」を基準 (1000ms / TICK_INTERVAL_MS ループ回数) にした倍率。
    effectiveSpeed = (ticksInWindow / windowElapsed) * TICK_INTERVAL_MS;
    ticksInWindow = 0;
    windowStartMs = now;
  }
  if (dirty) {
    if (forceDerived || now - lastDerivedAtMs >= DERIVED_INTERVAL_MS) {
      lastDerived = game.snapshotDerived();
      lastDerivedAtMs = now;
      forceDerived = false;
    }
    ctx.postMessage({
      type: 'snapshot',
      snapshot: { ...game.snapshotFast(), ...lastDerived },
      events: game.events(),
      evolution: game.evolution(),
      perf: { tickMs: lastTickMs, targetSpeed: game.speed, effectiveSpeed },
    });
    dirty = false;
  }
  setTimeout(loop, TICK_INTERVAL_MS);
}
loop();
