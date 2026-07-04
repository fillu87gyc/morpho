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
  | { type: 'apply'; pos: Vec2 }
  // M8 P4: 早送りモード。描画/スナップショット送信の頻度を10fpsまで落とし、
  // 浮いた予算をtickに全振りする (sim-worker.ts のループ間隔と
  // TickScheduler の予算/借金上限を切り替える)。
  | { type: 'setFastForward'; enabled: boolean }
  // M9: デイループの「委ねる」フェーズ開始。target tick に到達したら
  // Worker 側が自動で speed=0 に止め、'dayCompleted' 通知を返す。
  // 到達判定を Worker 側で行うのは、メインスレッドの RAF ポーリングだと
  // 速度×24 時に日境界を大きく飛び越えてしまうため。target=null で
  // 日境界のキャップを解除する (「見守り」への切り替え時に使う)。
  | { type: 'runUntilTick'; target: number | null }
  // M10: 「やり直す」(Undo)。pointerdown〜up の stroke 単位で環境フィールドへの
  // スタンプを記録・取り消す (sim の時間そのものは巻き戻さない)。
  | { type: 'beginStroke' }
  | { type: 'endStroke' }
  | { type: 'undoStroke' };

// M8 P0: 計測基盤。perf HUD (`?debug`) 表示用の Worker 側計測値。
export interface PerfInfo {
  tickMs: number;        // 直近の game.tick() 呼び出しの 1 sim tick あたりの平均コスト
  targetSpeed: number;   // スライダーで指定された速度倍率
  effectiveSpeed: number; // 実際に進んでいる速度倍率 (直近ウィンドウの実測)
}

// M8 P2: SimState のうち小さなスカラーだけを残した部分。nodes/edges は
// Float32Array にパックして別送りする (snapshot-codec.ts)。
export interface WireStateMeta {
  tick: number;
  seed: number;
  nextNodeId: number;
  nextEdgeId: number;
  worldSize: number;
}

// GameSnapshot の state (SimState = メタ情報 + nodes/edges オブジェクト配列) を、
// 構造化クローンが高コストな nodes/edges だけ Float32Array に差し替えた
// 送信専用の形。postMessage の transferable でゼロコピー転送する。
export type WireSnapshot = Omit<GameSnapshot, 'state'> & {
  stateMeta: WireStateMeta;
  nodesBuf: Float32Array;
  edgesBuf: Float32Array;
};

export type FromWorkerMessage =
  | { type: 'snapshot'; snapshot: WireSnapshot; events: string[]; evolution: EvolutionLog[]; perf: PerfInfo }
  // M9: runUntilTick の target に到達し、Worker が自動で speed=0 に止めた通知。
  | { type: 'dayCompleted' };
