// M6: World View のミニマップ。フィールドを焼き直す renderThumbnail とは別に、
// 「俯瞰して現在地とコロニーの分布を把握する」ためだけの軽量な専用描画を持つ。
// 毎フレーム描くので、地形テクスチャ等は焼かずドットと矩形だけに留める。
//
// M16: ステージ切替/リセット時に一度だけ地形 (バイオーム基調色 + 水域 +
// 障害物) をオフスクリーンへ焼き、毎フレームはそのキャッシュを貼るだけに
// する (プレイヤーが置く石・水は追従しない割り切り — 地形の骨格が見えれば
// World View の読図には十分で、毎フレーム env を舐めるコストを避ける)。

// M28-B: 「原野」ではミニマップを「訪問済み世界の全体図 (ワールドマップ)」に
// 切り替える (drawWildland)。チャンク要約を大局レイヤーと同じ色 (overview-
// layer.ts) で低頻度 (overview の tick が進んだときだけ) に焼き、毎フレームは
// 貼るだけ。枠は2つ — 現在の窓 (詳細 sim が生きている範囲) と、カメラが今
// 見ている範囲。タップは toWorldWildland() で窓ローカル座標へ逆変換して
// カメラのパン (俯瞰でその領域を見る) に使う。

import type { ColonyMarker } from './colony-networks.js';
import type { WorldView } from './camera.js';
import type { GridEnvironment, Vec2 } from '@morpho/sim';
import type { StageId } from './stages.js';
import { extractCoastline } from './coastline.js';
import type { WorldOverview } from './world-overview.js';
import { chunkTileColor, biomassGlowAlpha, OVERVIEW_VOID_COLOR, OVERVIEW_BIOMASS_GLOW } from './overview-layer.js';

// 同一ネットワークに統合されたコロニーは同じ色になる。
const NETWORK_COLORS = ['#8fd0ff', '#ffd27a', '#9dffa0', '#ff9dc7', '#c9a2ff', '#ffffff'];

// render.ts の TERRAIN_TONE / STAGE_ROCK_COLOR / WATER_BODY_COLOR と揃えた
// 簡易パレット (ミニマップは低解像度なので、明暗の補間はせず基調色1色のみ)。
const MINIMAP_TERRAIN: Record<StageId, string> = {
  petri:     'rgba(72, 92, 48, 1)',
  cave:      'rgba(50, 62, 78, 1)',
  desert:    'rgba(118, 96, 60, 1)',
  ruins:     'rgba(108, 94, 74, 1)',
  wetland:   'rgba(56, 84, 58, 1)',
  continent: 'rgba(64, 84, 58, 1)',
  wildland:  'rgba(64, 84, 58, 1)',
};
const MINIMAP_ROCK = 'rgba(110, 106, 116, 0.9)';
const MINIMAP_WATER = 'rgba(52, 100, 156, 0.95)';

export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private terrainCanvas: HTMLCanvasElement;
  private terrainStageId: StageId | null = null;

  constructor(private canvas: HTMLCanvasElement, private worldSize: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable for minimap');
    this.ctx = ctx;
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width = canvas.width;
    this.terrainCanvas.height = canvas.height;
  }

  // ステージ切替/リセットのときだけ呼べば十分 (env.obstacle/water はプレイヤー
  // 操作で変わるが、ミニマップは骨格が見えれば足りるという割り切り)。
  // 同じ stageId で連続して呼ばれた場合は再焼きをスキップする。
  bakeTerrain(stageId: StageId, env: GridEnvironment): void {
    if (this.terrainStageId === stageId) return;
    this.terrainStageId = stageId;
    const tctx = this.terrainCanvas.getContext('2d');
    if (!tctx) return;
    const w = this.terrainCanvas.width, h = this.terrainCanvas.height;
    const fieldSize = env.moisture.size;
    const cellW = w / fieldSize, cellH = h / fieldSize;

    tctx.fillStyle = MINIMAP_TERRAIN[stageId];
    tctx.fillRect(0, 0, w, h);

    const obData = env.obstacle.data;
    tctx.fillStyle = MINIMAP_ROCK;
    for (let i = 0; i < obData.length; i++) {
      if ((obData[i] ?? 0) <= 0.5) continue;
      const x = i % fieldSize, y = Math.floor(i / fieldSize);
      tctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
    }

    // M22: 水域も render.ts と同じ湖岸線データ (marching squares) から描き、
    // 「丸ベタ」をやめて輪郭のある水域にする。
    const { loops } = extractCoastline(env.water.data, fieldSize, this.worldSize);
    if (loops.length > 0) {
      const sx = w / this.worldSize, sy = h / this.worldSize;
      tctx.fillStyle = MINIMAP_WATER;
      for (const loop of loops) {
        if (loop.length < 3) continue;
        tctx.beginPath();
        const p0 = loop[0]!;
        tctx.moveTo(p0.x * sx, p0.y * sy);
        for (let i = 1; i < loop.length; i++) {
          const p = loop[i]!;
          tctx.lineTo(p.x * sx, p.y * sy);
        }
        tctx.closePath();
        tctx.fill();
      }
    }
  }

  draw(markers: ColonyMarker[], view: WorldView): void {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const sx = w / this.worldSize, sy = h / this.worldSize;

    ctx.clearRect(0, 0, w, h);
    if (this.terrainStageId !== null) {
      ctx.drawImage(this.terrainCanvas, 0, 0);
    } else {
      ctx.fillStyle = 'rgba(10, 14, 12, 0.92)';
      ctx.fillRect(0, 0, w, h);
    }

    // 現在のビューポート (カメラが今見ている範囲)
    ctx.strokeStyle = 'rgba(255, 230, 150, 0.85)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(view.worldLeft * sx, view.worldTop * sy, view.worldSpan * sx, view.worldSpan * sy);

    // コロニー: 統合済みのものは同色になる
    for (const m of markers) {
      const x = m.pos.x * sx, y = m.pos.y * sy;
      ctx.fillStyle = NETWORK_COLORS[m.networkId % NETWORK_COLORS.length]!;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  // クリック位置 (canvas 内 px) をワールド座標に変換する。
  toWorld(px: number, py: number): { x: number; y: number } {
    return { x: (px / this.canvas.width) * this.worldSize, y: (py / this.canvas.height) * this.worldSize };
  }

  // ── M28-B: 原野のワールドマップ ─────────────────────────

  // 訪問済み世界の全体図のオフスクリーンと、実座標 → マップ px の写像。
  private wildCanvas: HTMLCanvasElement | null = null;
  private wildTick = -1;
  private wildMap: { originX: number; originY: number; worldPerPx: number } | null = null;

  // 原野用の描画。windowOrigin は「今の」窓原点 (FastSnapshot.windowOrigin)、
  // view はカメラ (窓ローカル座標)。俯瞰タイルは overview.tick が進んだとき
  // だけ焼き直す (約1秒間隔、それも盤面が動いたときのみ)。
  drawWildland(overview: WorldOverview, windowOrigin: Vec2, view: WorldView): void {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    this.bakeWildland(overview, w, h);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgb(${OVERVIEW_VOID_COLOR[0]}, ${OVERVIEW_VOID_COLOR[1]}, ${OVERVIEW_VOID_COLOR[2]})`;
    ctx.fillRect(0, 0, w, h);
    if (this.wildCanvas) ctx.drawImage(this.wildCanvas, 0, 0);

    const m = this.wildMap;
    if (m) {
      // カメラが今見ている範囲 (窓ローカル → 実座標)。
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        (view.worldLeft + windowOrigin.x - m.originX) / m.worldPerPx,
        (view.worldTop + windowOrigin.y - m.originY) / m.worldPerPx,
        view.worldSpan / m.worldPerPx,
        view.worldSpan / m.worldPerPx,
      );
      // 現在の窓 (詳細シミュレーションが生きている範囲) を示す枠。
      ctx.strokeStyle = 'rgba(255, 230, 150, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(
        (windowOrigin.x - m.originX) / m.worldPerPx,
        (windowOrigin.y - m.originY) / m.worldPerPx,
        this.worldSize / m.worldPerPx,
        this.worldSize / m.worldPerPx,
      );
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  // クリック位置 (canvas 内 px) を窓ローカル座標へ逆変換する (原野のみ)。
  // まだ一度も焼いていなければ null。
  toWorldWildland(px: number, py: number, windowOrigin: Vec2): { x: number; y: number } | null {
    const m = this.wildMap;
    if (!m) return null;
    return {
      x: m.originX + px * m.worldPerPx - windowOrigin.x,
      y: m.originY + py * m.worldPerPx - windowOrigin.y,
    };
  }

  private bakeWildland(overview: WorldOverview, w: number, h: number): void {
    if (this.wildTick === overview.tick && this.wildCanvas) return;
    this.wildTick = overview.tick;
    if (!this.wildCanvas) {
      this.wildCanvas = document.createElement('canvas');
      this.wildCanvas.width = w;
      this.wildCanvas.height = h;
    }
    const tctx = this.wildCanvas.getContext('2d');
    if (!tctx) return;
    tctx.clearRect(0, 0, w, h);
    const chunks = overview.chunks;
    if (chunks.length === 0) { this.wildMap = null; return; }

    const cs = overview.chunkWorldSize;
    let minCx = Infinity, minCy = Infinity, maxCx = -Infinity, maxCy = -Infinity;
    for (const c of chunks) {
      if (c.cx < minCx) minCx = c.cx;
      if (c.cy < minCy) minCy = c.cy;
      if (c.cx > maxCx) maxCx = c.cx;
      if (c.cy > maxCy) maxCy = c.cy;
    }
    // 全体図の写野: 訪問済みチャンク + 半チャンクの余白を正方形に収める。
    const pad = cs * 0.5;
    const extentW = (maxCx - minCx + 1) * cs + pad * 2;
    const extentH = (maxCy - minCy + 1) * cs + pad * 2;
    const size = Math.max(extentW, extentH);
    const centerX = (minCx * cs + (maxCx + 1) * cs) / 2;
    const centerY = (minCy * cs + (maxCy + 1) * cs) / 2;
    const worldPerPx = size / Math.min(w, h);
    const originX = centerX - (w * worldPerPx) / 2;
    const originY = centerY - (h * worldPerPx) / 2;
    this.wildMap = { originX, originY, worldPerPx };

    const cellPx = cs / worldPerPx;
    for (const c of chunks) {
      const [r, g, b] = chunkTileColor(c);
      tctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      const x = (c.cx * cs - originX) / worldPerPx;
      const y = (c.cy * cs - originY) / worldPerPx;
      tctx.fillRect(x, y, cellPx + 0.5, cellPx + 0.5);
    }
    // バイオマスの光 (大局レイヤーと同じ金色) を重ねる。
    tctx.save();
    tctx.globalCompositeOperation = 'lighter';
    for (const c of chunks) {
      const a = biomassGlowAlpha(c.biomass);
      if (a <= 0.02) continue;
      tctx.fillStyle = `rgba(${OVERVIEW_BIOMASS_GLOW[0]}, ${OVERVIEW_BIOMASS_GLOW[1]}, ${OVERVIEW_BIOMASS_GLOW[2]}, ${(a * 0.8).toFixed(3)})`;
      const x = (c.cx * cs - originX) / worldPerPx;
      const y = (c.cy * cs - originY) / worldPerPx;
      tctx.fillRect(x, y, cellPx + 0.5, cellPx + 0.5);
    }
    tctx.restore();
  }
}
