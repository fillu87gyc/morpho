// sim-worker.ts (Worker側) と game-proxy.ts (メインスレッド側) が
// 共有するメッセージ形状。両者が同じ型を見ることで、フィールドの
// 取りこぼし・タイポをコンパイル時に検出できる。

import type { Tool, GameSnapshot, EvolutionLog } from './game.js';

export type ToWorkerMessage =
  | { type: 'reset'; seed?: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setBrush'; radius: number }
  | { type: 'apply'; x: number; y: number; size: number };

export type FromWorkerMessage =
  | { type: 'snapshot'; snapshot: GameSnapshot; events: string[]; evolution: EvolutionLog[] };
