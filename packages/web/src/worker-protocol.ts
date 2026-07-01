// sim-worker.ts (Worker側) と game-proxy.ts (メインスレッド側) が
// 共有するメッセージ形状。両者が同じ型を見ることで、フィールドの
// 取りこぼし・タイポをコンパイル時に検出できる。

import type { Tool, GameSnapshot, EvolutionLog } from './game.js';
import type { Vec2 } from '@morpho/sim';

export type ToWorkerMessage =
  | { type: 'reset'; seed?: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setBrush'; radius: number }
  | { type: 'apply'; pos: Vec2 };

export type FromWorkerMessage =
  | { type: 'snapshot'; snapshot: GameSnapshot; events: string[]; evolution: EvolutionLog[] };
