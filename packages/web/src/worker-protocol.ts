// sim-worker.ts (Worker側) と game-proxy.ts (メインスレッド側) が
// 共有するメッセージ形状。両者が同じ型を見ることで、フィールドの
// 取りこぼし・タイポをコンパイル時に検出できる。

import type { Tool, GameSnapshot, EvolutionLog, StageId } from './game.js';
import type { Genome, Vec2 } from '@morpho/sim';
import type { WorldEvent } from './world-events.js';
import type { WorldOverview } from './world-overview.js';

export type ToWorkerMessage =
  // M30: parentMutationBoost = 採種時に記録された変異幅の倍率 (原野で母体から
  // 遠く/過酷なバイオームで採った種ほど大きい)。省略時 1 (補正なし)。
  | { type: 'reset'; seed?: number; stageId?: StageId; parentGenome?: Genome; parentMutationBoost?: number }
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
  | { type: 'undoStroke' }
  // M15.7: ×1 speed での「1日の実時間 (ms)」を上書きする。既定は
  // time-scale.ts の DEFAULT_DAY_MS。開発/e2e 用のフック (詳細は time-scale.ts)。
  | { type: 'setDayMs'; ms: number };

// M8 P0: 計測基盤。perf HUD (`?debug`) 表示用の Worker 側計測値。
export interface PerfInfo {
  tickMs: number;        // 直近の game.tick() 呼び出しの 1 sim tick あたりの平均コスト
  targetSpeed: number;   // スライダーで指定された速度倍率
  effectiveSpeed: number; // 実際に進んでいる速度倍率 (直近ウィンドウの実測)
  // M29: 実効ペース「日/分」(直近ウィンドウの実測)。×24 が本当に出ていれば
  // 公称 10 日/分 (dayMs=144,000ms 時)。長時間セッションでの劣化を絶対値で読む。
  daysPerMin: number;
  // M29: 休眠の観測値。休眠無効 (既存6ステージ) では常に 0。
  dormantCells: number;  // 休眠中の空間セル数 (state.dormantCells.size)
  evictedChunks: number; // 平均値へ圧縮解放されたフィールドチャンク数
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
  // M25: windowShift は「原野」で窓が前線を追って再センタリングされたときの
  // 移動量 (Game.consumeWindowShift() と同じ意味)。非無限ステージでは常に
  // null。main.ts が camera.shiftCenter() へそのまま渡す。
  | {
    type: 'snapshot'; snapshot: WireSnapshot; events: readonly WorldEvent[]; evolution: EvolutionLog[];
    perf: PerfInfo; windowShift: Vec2 | null;
  }
  // M9: runUntilTick の target に到達し、Worker が自動で speed=0 に止めた通知。
  | { type: 'dayCompleted' }
  // M28: 「原野」の全世界俯瞰 (チャンク要約 + 全世界統計)。snapshot よりずっと
  // 低頻度 (WORLD_OVERVIEW_INTERVAL_MS = 1秒間隔) でよい — 大局レイヤー/
  // ワールドマップの素材であって、毎フレームの描画には使わない。チャンク
  // 要約の座標は実座標なので、窓相対で使うための windowOrigin を overview に
  // 同梱してある (world-overview.ts 参照)。有界6ステージでは送られない。
  | { type: 'worldOverview'; overview: WorldOverview };
