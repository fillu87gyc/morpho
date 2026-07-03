// M6: World View のミニマップ。フィールドを焼き直す renderThumbnail とは別に、
// 「俯瞰して現在地とコロニーの分布を把握する」ためだけの軽量な専用描画を持つ。
// 毎フレーム描くので、地形テクスチャ等は焼かずドットと矩形だけに留める。

import type { ColonyMarker } from './colony-networks.js';
import type { WorldView } from './camera.js';

// 同一ネットワークに統合されたコロニーは同じ色になる。
const NETWORK_COLORS = ['#8fd0ff', '#ffd27a', '#9dffa0', '#ff9dc7', '#c9a2ff', '#ffffff'];

export class Minimap {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private worldSize: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable for minimap');
    this.ctx = ctx;
  }

  draw(markers: ColonyMarker[], view: WorldView): void {
    const { ctx, canvas } = this;
    const w = canvas.width, h = canvas.height;
    const sx = w / this.worldSize, sy = h / this.worldSize;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 14, 12, 0.92)';
    ctx.fillRect(0, 0, w, h);

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
