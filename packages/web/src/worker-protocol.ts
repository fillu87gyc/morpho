// sim-worker.ts (Worker側) と game-proxy.ts (メインスレッド側) が
// 共有するメッセージ形状。両者が同じ型を見ることで、フィールドの
// 取りこぼし・タイポをコンパイル時に検出できる。

import type { Tool, GameSnapshot, EvolutionLog, StageId } from './game.js';
import type { Genome, Vec2 } from '@morpho/sim';

export type ToWorkerMessage =
  | { type: 'reset'; seed?: number; stageId?: StageId; parentGenome?: Genome }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setBrush'; radius: number }
  | { type: 'apply'; pos: Vec2 };

// M8 P0: 計測基盤。perf HUD (`?debug`) 表示用の Worker 側計測値。
export interface PerfInfo {
  tickMs: number;        // 直近の game.tick() 呼び出しの 1 sim tick あたりの平均コスト
  targetSpeed: number;   // スライダーで指定された速度倍率
  effectiveSpeed: number; // 実際に進んでいる速度倍率 (直近ウィンドウの実測)
}

export type FromWorkerMessage =
  | { type: 'snapshot'; snapshot: GameSnapshot; events: string[]; evolution: EvolutionLog[]; perf: PerfInfo };
