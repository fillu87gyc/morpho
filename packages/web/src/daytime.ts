// M14: ローカルタイムと昼夜。1日 (TICKS_PER_DAY tick) を 24 時間にマップする。
// 純粋関数のみ (DOM/Worker に依存しない)。
//
// **スコープ簡略化**: ロードマップ原案は「brightness に振幅の小さい昼夜の
// グローバル変調をかける (sim の成長応答にも効かせる)」だったが、
// GridEnvironment の brightness は空間分布を持つフィールドであり、
// 毎tickフィールド全体を書き換えるのはコストが高く、sim 側の追加変更にも
// なる。今回は render.ts のトーン係数のみに留め (視覚効果として夜を表現)、
// 成長応答への実際の影響は見送った。

import { TICKS_PER_DAY } from './day-loop.js';

// 現在の tick が1日の何時何分何秒にあたるかを "hh:mm:ss" で返す。
export function localTimeFor(tick: number): string {
  const frac = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY / TICKS_PER_DAY;
  const totalSeconds = Math.floor(frac * 24 * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// 夜の深さ [0 (最も明るい), 1 (最も暗い)]。1日の開始/終端 (tick=0, TICKS_PER_DAY)
// で 0、真ん中で 1 となる余弦カーブ (現実の時刻との対応は意図しない演出的な変調)。
export function nightFactorFor(tick: number): number {
  const frac = ((tick % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY / TICKS_PER_DAY;
  return (1 - Math.cos(frac * Math.PI * 2)) / 2;
}
