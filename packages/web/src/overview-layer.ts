// M28-B: 「原野」の大局レイヤー (zoom < 1 の俯瞰描画) の素材。
//
// 責務は2つ:
//   1. チャンク要約 → 色 (chunkTileColor / biomassGlowAlpha)。純粋関数として
//      切り出し、render.ts (大局レイヤー) と minimap.ts (ワールドマップ) が
//      同じ色で世界を描けるようにする (vitest 対象)。
//   2. OverviewTileCache: チャンクタイルをオフスクリーンへ焼き、毎フレームは
//      drawImage 1回で貼るだけにする性能ガード。焼き直すのは新しい overview
//      (約1秒間隔、盤面が変わったときだけ届く) を受け取ったときだけ。
//
// 座標系: チャンク番地 (cx, cy) は実座標基準。窓ローカル座標への変換は
// 「cx * chunkWorldSize - windowOrigin」— windowOrigin は必ず「今の」窓原点
// (FastSnapshot.windowOrigin) を使う (world-overview.ts の overviewLocalBBox
// のコメント参照)。

import type { WorldChunkSummary, WorldOverview } from './world-overview.js';
import type { Vec2 } from '@morpho/sim';

// 未訪問領域 (チャンク未生成の彼方) の暗さ。俯瞰の背景そのもの。
export const OVERVIEW_VOID_COLOR: [number, number, number] = [13, 17, 15];
// 訪問済みチャンクの地面: 栄養が痩せた土地 (暗い苔) → 豊かな土地 (明るい苔)。
const TILE_GROUND_POOR: [number, number, number] = [34, 44, 34];
const TILE_GROUND_RICH: [number, number, number] = [86, 112, 70];
// 岩がちなチャンクに乗せる岩色 (render.ts の wildland STAGE_ROCK_COLOR と同系)。
const TILE_ROCK: [number, number, number] = [124, 120, 108];
// 水域を含むチャンクの水色 (minimap.ts の MINIMAP_WATER と同系)。
const TILE_WATER: [number, number, number] = [52, 100, 156];
// M30: 毒の窪地バイオームの毒色 (render.ts の毒素ヒートマップと同系の紫)。
const TILE_TOXIN: [number, number, number] = [138, 82, 158];
// バイオマスの光 (render.ts の TUBE_GLOW と同系の金色)。
export const OVERVIEW_BIOMASS_GLOW: [number, number, number] = [255, 214, 110];

// 正規化の基準。チャンク1枚 (48×48=2304セル) に食料パッチ1つ (radius 4〜6,
// amount 0.9〜1.3) が湧く出荷地形では nutrientAvg はおよそ 0.005〜0.03 に
// 収まる (これを超えたら「豊かな土地」として振り切ってよい)。
const NUTRIENT_AVG_FULL = 0.02;
// 障害物パッチ1つ (radius 2〜5) ≈ 密度 0.005〜0.03。
const OBSTACLE_DENSITY_FULL = 0.04;
// M30: 毒の窪地の toxinPatches (radius 4〜8, amount 0.25〜0.55 ×2) で
// toxinAvg はおよそ 0.01〜0.05。この規模で紫が振り切る。
const TOXIN_AVG_FULL = 0.03;
// バイオマス総和がこの規模でほぼ最大光度に達する (指数飽和の時定数)。
const BIOMASS_GLOW_SCALE = 60;

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// 訪問済みチャンク1枚のタイル色。栄養の平均で地面の明度を、水域の有無で
// 水色を、障害物密度で岩色を決める (ROADMAP.md M28 の大局レイヤー仕様)。
export function chunkTileColor(c: WorldChunkSummary): [number, number, number] {
  const kNut = Math.min(1, Math.max(0, c.nutrientAvg / NUTRIENT_AVG_FULL));
  let rgb = lerp3(TILE_GROUND_POOR, TILE_GROUND_RICH, kNut);
  const kRock = Math.min(1, Math.max(0, c.obstacleDensity / OBSTACLE_DENSITY_FULL));
  if (kRock > 0) rgb = lerp3(rgb, TILE_ROCK, kRock * 0.7);
  if (c.hasWater) rgb = lerp3(rgb, TILE_WATER, 0.6);
  return [Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2])];
}

// バイオマス量 → 金色の発光の不透明度 (0..1)。指数飽和で、少量でも仄かに
// 光り、大量でも白飛びしない。
export function biomassGlowAlpha(biomass: number): number {
  if (biomass <= 0) return 0;
  return 1 - Math.exp(-biomass / BIOMASS_GLOW_SCALE);
}

// タイルキャッシュ解像度 (px/チャンク)。タイルは単色なので低くてよい。
const TILE_PX = 8;

// チャンクタイル + バイオマス光のオフスクリーンキャッシュ。
// sync() は同じ overview 参照なら何もしない (新しい俯瞰が届いた ≈ 1秒に
// 1回だけ焼き直す)。draw() は毎フレーム呼ばれるが drawImage 2回だけ。
export class OverviewTileCache {
  private tiles: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  private lastOverview: WorldOverview | null = null;
  private minCx = 0;
  private minCy = 0;
  private cols = 0;
  private rows = 0;
  private chunkWorldSize = 48;

  sync(overview: WorldOverview): void {
    if (overview === this.lastOverview) return;
    this.lastOverview = overview;
    this.chunkWorldSize = overview.chunkWorldSize;
    const chunks = overview.chunks;
    if (chunks.length === 0) { this.tiles = null; this.glow = null; return; }
    let minCx = Infinity, minCy = Infinity, maxCx = -Infinity, maxCy = -Infinity;
    for (const c of chunks) {
      if (c.cx < minCx) minCx = c.cx;
      if (c.cy < minCy) minCy = c.cy;
      if (c.cx > maxCx) maxCx = c.cx;
      if (c.cy > maxCy) maxCy = c.cy;
    }
    this.minCx = minCx;
    this.minCy = minCy;
    this.cols = maxCx - minCx + 1;
    this.rows = maxCy - minCy + 1;

    // タイル: TILE_PX/チャンクの平色。未訪問セルは透明のまま (下の
    // 「未訪問の暗さ」が透ける)。
    if (!this.tiles) this.tiles = document.createElement('canvas');
    this.tiles.width = this.cols * TILE_PX;
    this.tiles.height = this.rows * TILE_PX;
    const tctx = this.tiles.getContext('2d');
    // バイオマスの光: 1px/チャンクで焼き、貼るときの拡大補間 (smoothing) に
    // よってチャンク境界を跨いで柔らかく滲む雲になる。
    if (!this.glow) this.glow = document.createElement('canvas');
    this.glow.width = this.cols;
    this.glow.height = this.rows;
    const gctx = this.glow.getContext('2d');
    if (!tctx || !gctx) return;
    tctx.clearRect(0, 0, this.tiles.width, this.tiles.height);
    gctx.clearRect(0, 0, this.glow.width, this.glow.height);
    for (const c of chunks) {
      const [r, g, b] = chunkTileColor(c);
      tctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      tctx.fillRect((c.cx - minCx) * TILE_PX, (c.cy - minCy) * TILE_PX, TILE_PX, TILE_PX);
      const a = biomassGlowAlpha(c.biomass);
      if (a > 0.01) {
        const [gr, gg, gb] = OVERVIEW_BIOMASS_GLOW;
        gctx.fillStyle = `rgba(${gr}, ${gg}, ${gb}, ${a.toFixed(3)})`;
        gctx.fillRect(c.cx - minCx, c.cy - minCy, 1, 1);
      }
    }
  }

  // windowOrigin は「今の」窓原点 (FastSnapshot.windowOrigin)。alpha は
  // クロスフェード係数 (render.ts が zoom から算出)。
  draw(ctx: CanvasRenderingContext2D, windowOrigin: Vec2, scale: number, offX: number, offY: number, alpha: number): void {
    if (!this.tiles || !this.glow || alpha <= 0) return;
    const cs = this.chunkWorldSize;
    const x = offX + (this.minCx * cs - windowOrigin.x) * scale;
    const y = offY + (this.minCy * cs - windowOrigin.y) * scale;
    const w = this.cols * cs * scale;
    const h = this.rows * cs * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    // タイルはチャンクの区画がくっきり読めるよう補間なしで貼る。
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.tiles, x, y, w, h);
    // 光は逆に補間で滲ませ、加算合成でタイルの上に浮かせる。
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.85;
    ctx.drawImage(this.glow, x, y, w, h);
    ctx.restore();
  }
}
