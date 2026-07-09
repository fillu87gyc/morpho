// M28: 「原野」の全世界俯瞰 (world overview)。
//
// sim 側のチャンク要約 (ChunkedGridEnvironment.summarizeChunks /
// ChunkedScalarField.summarizeChunks) を Game.worldOverview() が1つに束ね、
// Worker が低頻度 (sim-worker.ts の WORLD_OVERVIEW_INTERVAL_MS) の
// 'worldOverview' メッセージでメインスレッドへ届ける。main.ts は最新値を
// setWorldOverview() でこのモジュールに保持するだけ — 実際に絵へ起こす
// (大局レイヤー / ワールドマップ) のは M28-B の仕事で、そちらは
// getWorldOverview() を import して読む。
//
// 座標系に注意: chunks の cx/cy は実座標のチャンク番地で、実座標 =
// cx * chunkWorldSize。窓ローカル座標 (0..WORLD、camera/render と同じ系) へは
// 「実座標 - windowOrigin」で変換する (そのために windowOrigin を同梱する)。

import type { Vec2 } from '@morpho/sim';
import type { BBox } from './camera.js';

// チャンク1枚ぶんの要約。sim 側の地形要約 (ChunkTerrainSummary) と
// バイオマス要約 (FieldChunkSummary) を web 側で合流させた形。
export interface WorldChunkSummary {
  cx: number;
  cy: number;
  /** 栄養の平均値 (チャンク内全セル)。 */
  nutrientAvg: number;
  /** 障害物セルの割合 (0..1)。 */
  obstacleDensity: number;
  /** 水域セルの有無。 */
  hasWater: boolean;
  /** バイオマスの総和。 */
  biomass: number;
}

// 全世界統計。HUD (ui.ts) が使う値と同じもの (Game.computeWorld と同源)。
export interface WorldOverviewStats {
  areaM2: number;
  massKg: number;
  /** 探索チャンク数 (生成済みチャンク数)。 */
  exploredChunks: number;
  /** 母体 (開始点) から最遠ノードまでの距離 (ワールド単位)。 */
  reachDistance: number;
}

export interface WorldOverview {
  chunks: WorldChunkSummary[];
  /** 窓 (表示用密フィールド) の左上に対応する実座標。窓相対への変換用。 */
  windowOrigin: Vec2;
  /** チャンク一辺のワールド単位 (chunkCells × cellWorldSize)。 */
  chunkWorldSize: number;
  stats: WorldOverviewStats;
  /** この俯瞰を集計した時点の sim tick。 */
  tick: number;
}

// 母体 (origin) から最遠の点までの距離。純粋関数 (rng もフィールドも触らない)
// なので、既存6ステージで計算しても決定論には影響しない。
export function computeReachDistance(positions: readonly Vec2[], origin: Vec2): number {
  let best = 0;
  for (const p of positions) {
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d > best) best = d;
  }
  return best;
}

// M28-B: 訪問済みチャンク集合の bbox を窓ローカル座標 (camera/render と同じ系、
// 実座標 − windowOrigin) で返す。カメラの動的最小ズーム (camera.ts の
// wildlandMinZoom) とパン範囲の材料。チャンクが空なら null。
// windowOrigin は「今の」窓原点を渡すこと — overview.windowOrigin (集計時点の
// 値) は窓の再センタリングで最大1秒古くなりうるため、スナップショットに同梱
// される現在値 (FastSnapshot.windowOrigin) を使う。
export function overviewLocalBBox(
  chunks: readonly WorldChunkSummary[],
  chunkWorldSize: number,
  windowOrigin: Vec2,
): BBox | null {
  if (chunks.length === 0) return null;
  let minCx = Infinity, minCy = Infinity, maxCx = -Infinity, maxCy = -Infinity;
  for (const c of chunks) {
    if (c.cx < minCx) minCx = c.cx;
    if (c.cy < minCy) minCy = c.cy;
    if (c.cx > maxCx) maxCx = c.cx;
    if (c.cy > maxCy) maxCy = c.cy;
  }
  return {
    minX: minCx * chunkWorldSize - windowOrigin.x,
    minY: minCy * chunkWorldSize - windowOrigin.y,
    maxX: (maxCx + 1) * chunkWorldSize - windowOrigin.x,
    maxY: (maxCy + 1) * chunkWorldSize - windowOrigin.y,
  };
}

// メインスレッド側の最新値の置き場。window.__worldOverview のような一時
// グローバルではなく、後続 (M28-B の描画) が import できるモジュール状態に
// しておく。null = まだ届いていない、または現在のステージが有界 (非原野)。
let latest: WorldOverview | null = null;

export function setWorldOverview(overview: WorldOverview | null): void {
  latest = overview;
}

export function getWorldOverview(): WorldOverview | null {
  return latest;
}
