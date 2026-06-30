// Canvas レンダラ。main の scripts/biomass-gif.ts (ペトリ皿デモ) を移植。
//
// 構成は同じく 4 レイヤー:
//   1. シャーレ (暖灰のラジアル + 細い暗いリム)
//   2. 食料 (オートミール色の薄い斑)
//   3. プラズマ (黄〜金〜白、密度に応じてグラデ)
//   4. 脈管網 (2 パス: 大きい halo → 細い core)
// 加えて Web 版だけのオーバーレイ:
//   5. 環境ヒート (栄養/水/光) — UI トグル
//   6. 障害物 (石)
//   7. カーソルプレビュー
//
// 高速化:
//   - プラズマ / 食料 / 障害物 / ヒート は FIELD 解像度 (96x96) の
//     オフスクリーン ImageData に焼き、drawImage で smoothing 付き拡大
//   - 脈管は Canvas Path で 2 パス: lighter で halo → そのままで core
//   - シャーレ枠とカーソルはベクター直描

import type {
  SimState,
  GridEnvironment,
  BiomassField,
} from '@morpho/sim';

export interface RenderOptions {
  worldSize: number;
  fieldSize: number;
  showHeat: boolean;
}

// 配色 (biomass-gif.ts と同じ系統)
const DISH_INNER: [number, number, number] = [228, 224, 213];
const DISH_OUTER: [number, number, number] = [188, 184, 176];
const DISH_RIM:   [number, number, number] = [110, 105, 100];
const BG:         [number, number, number] = [18, 17, 20];
const FOOD_HI:    [number, number, number] = [232, 218, 188];
const FOOD_LO:    [number, number, number] = [188, 168, 132];
const PLASMA_RIM: [number, number, number] = [200, 170, 60];
const PLASMA_MID: [number, number, number] = [232, 195, 70];
const PLASMA_HI:  [number, number, number] = [255, 230, 130];
const TUBE_HALO:  [number, number, number] = [255, 240, 170];

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private fieldImage: ImageData;
  private fieldCanvas: HTMLCanvasElement;
  private fieldCtx: CanvasRenderingContext2D;
  private dpr: number;

  constructor(private canvas: HTMLCanvasElement, private opts: RenderOptions) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();

    this.fieldCanvas = document.createElement('canvas');
    this.fieldCanvas.width = opts.fieldSize;
    this.fieldCanvas.height = opts.fieldSize;
    const fctx = this.fieldCanvas.getContext('2d');
    if (!fctx) throw new Error('offscreen 2d unavailable');
    this.fieldCtx = fctx;
    this.fieldImage = fctx.createImageData(opts.fieldSize, opts.fieldSize);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(320, rect.width || 640);
    const h = Math.max(320, rect.height || 640);
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setShowHeat(v: boolean): void { this.opts.showHeat = v; }

  // シャーレの「描画上の半径」(px in CSS) と中心。CSS 座標で返す。
  dishGeometry(): { cx: number; cy: number; r: number } {
    const cssW = this.canvas.width / this.dpr;
    const cssH = this.canvas.height / this.dpr;
    return { cx: cssW / 2, cy: cssH / 2, r: Math.min(cssW, cssH) * 0.48 };
  }

  draw(state: SimState, env: GridEnvironment, bio: BiomassField, hoverPx?: { x: number; y: number; radius: number; tool: string }): void {
    const { ctx } = this;
    const cssW = this.canvas.width / this.dpr;
    const cssH = this.canvas.height / this.dpr;
    const { cx, cy, r: dishR } = this.dishGeometry();

    // 0. 暗い背景
    ctx.fillStyle = rgb(BG);
    ctx.fillRect(0, 0, cssW, cssH);

    // 1. シャーレ (暖灰のラジアル)
    const dishGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dishR);
    dishGrad.addColorStop(0, rgb(DISH_INNER));
    dishGrad.addColorStop(0.9, rgb(DISH_OUTER));
    dishGrad.addColorStop(1, rgb(DISH_OUTER));
    ctx.fillStyle = dishGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, dishR, 0, Math.PI * 2);
    ctx.fill();

    // 以下、シャーレ内側にだけ描く
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, dishR, 0, Math.PI * 2);
    ctx.clip();

    // 2 + 3 + 6 + (5) : 場系を 1 枚の ImageData に焼いて貼る
    this.paintFieldLayer(env, bio);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // シャーレ範囲に合わせて拡大して貼る (世界全体ではなくディスクに収まる範囲)
    const left = cx - dishR;
    const top = cy - dishR;
    const side = dishR * 2;
    ctx.drawImage(this.fieldCanvas, left, top, side, side);

    // 4. 脈管網
    const scale = side / this.opts.worldSize;
    this.drawEdges(state, scale, left, top);

    // 4b. ソース (オートミール片)
    this.drawSources(state, scale, left, top);

    ctx.restore();

    // 1b. リム (暗い細線 + すぐ内側の薄いハイライト)
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = rgb(DISH_RIM);
    ctx.beginPath(); ctx.arc(cx, cy, dishR, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(245, 240, 230, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, dishR - 3, 0, Math.PI * 2); ctx.stroke();

    // 7. カーソル
    if (hoverPx) this.drawHover(hoverPx);
  }

  private paintFieldLayer(env: GridEnvironment, bio: BiomassField): void {
    const fs = this.opts.fieldSize;
    const data = this.fieldImage.data;

    let maxBio = 0;
    for (let i = 0; i < bio.field.data.length; i++) {
      const v = bio.field.data[i] ?? 0;
      if (v > maxBio) maxBio = v;
    }
    maxBio = Math.max(maxBio, 0.6);

    for (let y = 0; y < fs; y++) {
      for (let x = 0; x < fs; x++) {
        const i = y * fs + x;
        const di = i * 4;
        let r = 0, g = 0, b = 0, a = 0;

        // 食料 — オートミール色
        const nut = env.nutrients.data[i] ?? 0;
        if (nut > 0.05) {
          const t = Math.min(1, nut * 0.8);
          const fr = FOOD_LO[0] * (1 - t) + FOOD_HI[0] * t;
          const fg = FOOD_LO[1] * (1 - t) + FOOD_HI[1] * t;
          const fb = FOOD_LO[2] * (1 - t) + FOOD_HI[2] * t;
          const fa = Math.min(0.95, 0.35 + nut * 0.5);
          [r, g, b] = blend(r, g, b, fr, fg, fb, fa);
          a = Math.max(a, fa);
        }

        // ヒート (任意): 水と光をうっすら被せる
        if (this.opts.showHeat) {
          const m = env.moisture.data[i] ?? 0;
          if (m > 0.25) {
            const k = Math.min(1, (m - 0.25) * 1.4);
            [r, g, b] = blend(r, g, b, 90, 150, 220, k * 0.32);
            a = Math.max(a, k * 0.32);
          }
          const l = env.brightness.data[i] ?? 0;
          if (l > 0.25) {
            const k = Math.min(1, (l - 0.25) * 1.4);
            [r, g, b] = blend(r, g, b, 245, 230, 150, k * 0.28);
            a = Math.max(a, k * 0.28);
          }
        }

        // 障害物 — 暗いグレーの石
        const ob = env.obstacle.data[i] ?? 0;
        if (ob > 0.5) {
          [r, g, b] = blend(r, g, b, 95, 88, 92, 0.85);
          a = Math.max(a, 0.85);
        }

        // プラズマ — 黄〜金〜白
        const v = (bio.field.data[i] ?? 0) / maxBio;
        if (v > 0.025) {
          const k = Math.pow(Math.min(1, v), 0.55);
          let pr: number, pg: number, pb: number;
          if (k < 0.5) {
            const t = k / 0.5;
            pr = PLASMA_RIM[0] * (1 - t) + PLASMA_MID[0] * t;
            pg = PLASMA_RIM[1] * (1 - t) + PLASMA_MID[1] * t;
            pb = PLASMA_RIM[2] * (1 - t) + PLASMA_MID[2] * t;
          } else {
            const t = (k - 0.5) / 0.5;
            pr = PLASMA_MID[0] * (1 - t) + PLASMA_HI[0] * t;
            pg = PLASMA_MID[1] * (1 - t) + PLASMA_HI[1] * t;
            pb = PLASMA_MID[2] * (1 - t) + PLASMA_HI[2] * t;
          }
          const pa = Math.min(0.92, 0.12 + k * 0.78);
          [r, g, b] = blend(r, g, b, pr, pg, pb, pa);
          a = Math.max(a, pa);
        }

        data[di] = r;
        data[di + 1] = g;
        data[di + 2] = b;
        data[di + 3] = Math.floor(a * 255);
      }
    }
    this.fieldCtx.putImageData(this.fieldImage, 0, 0);
  }

  private drawEdges(state: SimState, scale: number, offX: number, offY: number): void {
    const { ctx } = this;
    const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));
    const sorted = [...state.edges].sort((a, b) => a.radius - b.radius);

    // 黄色いプラズマ膜 (BiomassField) は既に下のフィールド層が描いている。
    // 管はその上を「茶〜オレンジの細い線」として走るだけで十分。
    // shadowBlur を毎エッジに掛けるのは 300+ エッジ × 毎フレームで重すぎる。
    const pxPerWorld = scale / 5.76;  // 参照 (W=576, world=100) 比

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const e of sorted) {
      const a = nodeMap.get(e.from);
      const b = nodeMap.get(e.to);
      if (!a || !b) continue;
      const fluxN = Math.min(1, e.flux / 5);
      const tubeW = Math.max(0.7, e.radius * 1.05 + fluxN * 1.4) * pxPerWorld;
      const t = Math.min(1, fluxN * 0.65 + Math.min(1, e.radius / 2) * 0.55);
      // 太い・流量多い管ほど濃いオレンジ → 細い枝はクリーム色
      const rr = Math.floor(245 - 90 * t);
      const gg = Math.floor(195 - 105 * t);
      const bb = Math.floor(95 - 65 * t);
      ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, 0.9)`;
      ctx.lineWidth = Math.max(0.6, tubeW * 0.55);
      ctx.beginPath();
      ctx.moveTo(offX + a.pos.x * scale, offY + a.pos.y * scale);
      ctx.lineTo(offX + b.pos.x * scale, offY + b.pos.y * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSources(state: SimState, scale: number, offX: number, offY: number): void {
    const { ctx } = this;
    for (const n of state.nodes) {
      if (n.type !== 'source') continue;
      const cx = offX + n.pos.x * scale;
      const cy = offY + n.pos.y * scale;
      const rx = 9 * (scale / 6.4);
      const ry = 6 * (scale / 6.4);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
      grad.addColorStop(0, `rgba(${FOOD_HI[0]}, ${FOOD_HI[1]}, ${FOOD_HI[2]}, 0.85)`);
      grad.addColorStop(1, `rgba(${FOOD_LO[0]}, ${FOOD_LO[1]}, ${FOOD_LO[2]}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHover(h: { x: number; y: number; radius: number; tool: string }): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = toolColor(h.tool);
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function blend(r: number, g: number, b: number, r2: number, g2: number, b2: number, a2: number): [number, number, number] {
  const inv = 1 - a2;
  return [
    Math.floor(r * inv + r2 * a2),
    Math.floor(g * inv + g2 * a2),
    Math.floor(b * inv + b2 * a2),
  ];
}

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

function toolColor(tool: string): string {
  switch (tool) {
    case 'food': return 'rgba(120, 90, 40, 0.95)';
    case 'light': return 'rgba(220, 180, 60, 0.95)';
    case 'water': return 'rgba(80, 130, 200, 0.95)';
    case 'stone': return 'rgba(80, 80, 90, 0.95)';
    case 'erase': return 'rgba(200, 60, 60, 0.95)';
    default: return 'rgba(60, 60, 60, 0.8)';
  }
}
