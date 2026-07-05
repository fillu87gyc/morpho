// M6: World View のミニマップ。フィールドを焼き直す renderThumbnail とは別に、
// 「俯瞰して現在地とコロニーの分布を把握する」ためだけの軽量な専用描画を持つ。
// 毎フレーム描くので、地形テクスチャ等は焼かずドットと矩形だけに留める。
//
// M16: ステージ切替/リセット時に一度だけ地形 (バイオーム基調色 + 水域 +
// 障害物) をオフスクリーンへ焼き、毎フレームはそのキャッシュを貼るだけに
// する (プレイヤーが置く石・水は追従しない割り切り — 地形の骨格が見えれば
// World View の読図には十分で、毎フレーム env を舐めるコストを避ける)。

import type { ColonyMarker } from './colony-networks.js';
import type { WorldView } from './camera.js';
import type { GridEnvironment } from '@morpho/sim';
import type { StageId } from './stages.js';

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
    const waterData = env.water.data;
    tctx.fillStyle = MINIMAP_ROCK;
    for (let i = 0; i < obData.length; i++) {
      if ((obData[i] ?? 0) <= 0.5) continue;
      const x = i % fieldSize, y = Math.floor(i / fieldSize);
      tctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
    }
    tctx.fillStyle = MINIMAP_WATER;
    for (let i = 0; i < waterData.length; i++) {
      if ((waterData[i] ?? 0) <= 0.5) continue;
      const x = i % fieldSize, y = Math.floor(i / fieldSize);
      tctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
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
}
