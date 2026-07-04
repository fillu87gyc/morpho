// M8 P2: 時間予算スケジューラ。
//
// これまでの sim-worker は「speed 倍」を毎 16ms 必ず全部回してから
// スナップショットを送っていた。tick コストが伸びる (エッジが増える終盤や
// 非力な端末) と、この「全部回す」が 16ms を大きく超え、スナップショットの
// 送信間隔そのものが伸びてカクつく。
//
// ここでは「今回の呼び出しで使ってよい時間予算」に収まる分だけ tick を回し、
// 回しきれなかった分は「借金 (debt)」として次回に繰り越す。tick 1 回の
// コストは実測の指数移動平均 (EMA) で見積もる。借金には上限を設け、
// タブがバックグラウンドで長時間止まっていた後などに一気に追いつこうとして
// 1回の呼び出しが暴走するのを防ぐ。
//
// Worker 依存 (postMessage 等) を持たない純粋なステートマシンとして
// 切り出し、Worker からもテストからも同じロジックを使う。

export interface SchedulerConfig {
  /** 1回の呼び出しで tick に使ってよい時間 (ms)。通常はループ間隔と同じ。 */
  budgetMs: number;
  /** 溜め込める借金 tick 数の上限。 */
  maxDebtTicks: number;
}

export class TickScheduler {
  private debt = 0;
  private estTickMs = 0.5; // M8 P1 適用後の実測値を初期値に

  constructor(private readonly config: SchedulerConfig) {}

  /** 現在溜まっている借金 tick 数 (テスト・デバッグ用)。 */
  get pendingDebt(): number { return this.debt; }

  /** 直近の推定 tick コスト (ms)。 */
  get estimatedTickMs(): number { return this.estTickMs; }

  // このフレームで「本来」進めたい tick 数 (speed スライダー) を渡すと、
  // 予算内に収まると見積もれる tick 数を返す。返り値が targetSpeed より
  // 少ない場合、差分は borrow として次回以降に持ち越される。
  planSteps(targetSpeed: number): number {
    this.debt = Math.min(this.debt + Math.max(0, targetSpeed), this.config.maxDebtTicks);
    if (this.debt <= 0) return 0;
    const fitByBudget = Math.max(1, Math.floor(this.config.budgetMs / this.estTickMs));
    return Math.min(this.debt, fitByBudget);
  }

  // planSteps() が返した数だけ実際に回した後、実測時間を報告する。
  // 借金を減らし、次回の見積もりを更新する。
  report(steps: number, elapsedMs: number): void {
    if (steps <= 0) return;
    this.debt = Math.max(0, this.debt - steps);
    const sample = elapsedMs / steps;
    this.estTickMs = this.estTickMs * 0.8 + sample * 0.2;
  }
}
