// M9: デイループのステートマシン。
//
// 「仕込む (prepare) → 委ねる (observe) → 受け取る (result)」の3画面フローを、
// DOM/Worker から切り離した純粋なステートマシンとして実装する
// (tick-scheduler.ts と同じ流儀)。sim の tick 数そのものはここでは進めない —
// 「いつ日が終わるか」の判定材料 (targetTick) を持つだけで、実際に
// 何 tick 進めるかは Worker 側 (runUntilTick) の責務。

export type DayPhase = 'prepare' | 'observe' | 'result';

export const TICKS_PER_DAY = 40;

export interface DayLoopState {
  readonly phase: DayPhase;
  readonly day: number;        // 今回のループが対象にしている日 (0-indexed)
  readonly targetTick: number; // observe が完了するべき tick (この日の終わり)
}

// tick から、その日の prepare フェーズを起点にステートマシンを作る。
// (セッション途中からの再開や reset() 後の初期化に使う)。
export function createDayLoop(startTick: number): DayLoopState {
  const day = Math.floor(startTick / TICKS_PER_DAY);
  return { phase: 'prepare', day, targetTick: (day + 1) * TICKS_PER_DAY };
}

// 「観察をはじめる ▶」。prepare からのみ observe へ進める。
export function beginObserve(s: DayLoopState): DayLoopState {
  if (s.phase !== 'prepare') return s;
  return { ...s, phase: 'observe' };
}

// tick が targetTick に到達した (Worker からの dayCompleted 通知) ことを
// 反映する。observe からのみ result へ進める。
export function completeDay(s: DayLoopState): DayLoopState {
  if (s.phase !== 'observe') return s;
  return { ...s, phase: 'result' };
}

// 「つぎの日へ」。result からのみ、翌日の prepare へ進める。
export function advanceToNextDay(s: DayLoopState): DayLoopState {
  if (s.phase !== 'result') return s;
  const day = s.day + 1;
  return { phase: 'prepare', day, targetTick: (day + 1) * TICKS_PER_DAY };
}
