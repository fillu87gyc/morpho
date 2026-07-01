// Canvas レンダラ。シミュレーションは main の petri デモ (sim/scripts/biomass-gif.ts)
// と同じパラメータで走らせるが、見た目は UI 全体の暗い森のトーンに合わせる。
//
//   - 暗背景にじんわり広がる黄色のプラズマ膜 (BiomassField)
//   - 茶〜クリームの脈管 (Edge) は膜の上を細く明るく走る
//   - 食料は仄かに緑がかった発光、source は青、sink は緑のグロー
//
// 構成:
//   1. 暗いラジアル背景 (canvas-wrap の延長)
//   2. 場系 (食料 / 障害物 / Biomass プラズマ / 環境ヒート) を FIELD 解像度の
//      ImageData に焼いて drawImage で拡大
//   3. 脈管網 (Canvas Path) を細い線で重ねる
//   4. source / sink を発光ドットで描く
//   5. カーソルプレビュー

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

// 配色: morphosmoke.png の暗い森のトーンに揃える。
const BG_INNER:    [number, number, number] = [14, 20, 17];
const BG_OUTER:    [number, number, number] = [6, 8, 10];
const FOOD_GLOW:   [number, number, number] = [120, 210, 110]; // 仄か緑の発光
const PLASMA_LOW:  [number, number, number] = [120, 95, 30];   // 縁の暗い金
const PLASMA_MID:  [number, number, number] = [225, 185, 70];  // 中間の山吹
const PLASMA_HI:   [number, number, number] = [255, 230, 140]; // 中心の明るい黄
const TUBE_LIGHT:  [number, number, number] = [255, 220, 150]; // 細い枝 (クリーム)
const TUBE_DARK:   [number, number, number] = [200, 120, 50];  // 太い幹 (オレンジ)
const SOURCE_DOT:  [number, number, number] = [170, 220, 255];
const SINK_DOT:    [number, number, number] = [170, 255, 170];

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

  draw(state: SimState, env: GridEnvironment, bio: BiomassField, hoverPx?: { x: number; y: number; radius: number; tool: string }): void {
    const { ctx } = this;
    const cssW = this.canvas.width / this.dpr;
    const cssH = this.canvas.height / this.dpr;
    const cx = cssW / 2;
    const cy = cssH / 2;
    const side = Math.min(cssW, cssH);
    const left = cx - side / 2;
    const top = cy - side / 2;

    // 1. 暗いラジアル背景 (中央ほど少し明るい — 「ステージ」感)
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, side * 0.6);
    bg.addColorStop(0, rgb(BG_INNER));
    bg.addColorStop(1, rgb(BG_OUTER));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // 2. 場系を焼いて貼る (世界 = 画面いっぱい、square 領域)
    this.paintFieldLayer(env, bio);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fieldCanvas, left, top, side, side);

    // 3. 脈管網
    const scale = side / this.opts.worldSize;
    this.drawEdges(state, scale, left, top);

    // 4. source / sink
    this.drawNodes(state, scale, left, top);

    // 5. カーソル
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

        // 食料 — 仄かな緑の発光 (additive ぽい弱い乗せ)
        const nut = env.nutrients.data[i] ?? 0;
        if (nut > 0.05) {
          const k = Math.min(1, nut * 0.6);
          const fa = 0.18 + k * 0.32;
          [r, g, b] = blend(r, g, b, FOOD_GLOW[0], FOOD_GLOW[1], FOOD_GLOW[2], fa);
          a = Math.max(a, fa);
        }

        // ヒート (UI トグル): 水を青く、光を黄色く薄く乗せる
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

        // 障害物 — 暗いグレーの石 (背景より少し明るい程度に)
        const ob = env.obstacle.data[i] ?? 0;
        if (ob > 0.5) {
          [r, g, b] = blend(r, g, b, 70, 65, 75, 0.85);
          a = Math.max(a, 0.85);
        }

        // プラズマ膜 — 縁は暗い金、中は山吹、芯は明るい黄
        const v = (bio.field.data[i] ?? 0) / maxBio;
        if (v > 0.025) {
          const k = Math.pow(Math.min(1, v), 0.55);
          let pr: number, pg: number, pb: number;
          if (k < 0.5) {
            const t = k / 0.5;
            pr = PLASMA_LOW[0] * (1 - t) + PLASMA_MID[0] * t;
            pg = PLASMA_LOW[1] * (1 - t) + PLASMA_MID[1] * t;
            pb = PLASMA_LOW[2] * (1 - t) + PLASMA_MID[2] * t;
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
      // 細い枝はクリーム色で軽やか、太く流量多い管はオレンジで濃く。
      const rr = Math.round(TUBE_LIGHT[0] * (1 - t) + TUBE_DARK[0] * t);
      const gg = Math.round(TUBE_LIGHT[1] * (1 - t) + TUBE_DARK[1] * t);
      const bb = Math.round(TUBE_LIGHT[2] * (1 - t) + TUBE_DARK[2] * t);
      ctx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${0.78 + t * 0.18})`;
      ctx.lineWidth = Math.max(0.6, tubeW * 0.55);
      ctx.beginPath();
      ctx.moveTo(offX + a.pos.x * scale, offY + a.pos.y * scale);
      ctx.lineTo(offX + b.pos.x * scale, offY + b.pos.y * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawNodes(state: SimState, scale: number, offX: number, offY: number): void {
    const { ctx } = this;
    for (const n of state.nodes) {
      if (n.type === 'relay') continue;
      const cx = offX + n.pos.x * scale;
      const cy = offY + n.pos.y * scale;
      const color = n.type === 'source' ? SOURCE_DOT : SINK_DOT;
      const r = (n.type === 'source' ? 5 : 4) * Math.max(1, scale / 6.4);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
      grad.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.95)`);
      grad.addColorStop(0.4, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.4)`);
      grad.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
      ctx.fill();
      // 中央のコア
      ctx.fillStyle = `rgb(${Math.min(255, color[0] + 30)}, ${Math.min(255, color[1] + 30)}, ${Math.min(255, color[2] + 30)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
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
    case 'food': return 'rgba(120, 230, 140, 0.9)';
    case 'light': return 'rgba(250, 230, 140, 0.9)';
    case 'water': return 'rgba(140, 200, 250, 0.9)';
    case 'stone': return 'rgba(180, 180, 190, 0.9)';
    case 'erase': return 'rgba(240, 120, 120, 0.9)';
    default: return 'rgba(255,255,255,0.8)';
  }
}
