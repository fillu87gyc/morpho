// Canvas レンダラ。PNG 版 (sim/scripts/render.ts) を Web に移植したもの。
// 構成:
//   1. オフスクリーン ImageData (field 解像度) に「土地系」(食料/障害物/Biomass) を焼く
//   2. それを Canvas 全面にバイリニア拡大 (imageSmoothingEnabled)
//   3. 上から管 (Edge) と ノード (source/sink) をベクター描画 (光彩は乗算合成)

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

    // オフスクリーン: field 解像度のままピクセルを置く
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

    // 1. 背景
    const bg = ctx.createRadialGradient(cssW / 2, cssH / 2, 0, cssW / 2, cssH / 2, cssW * 0.7);
    bg.addColorStop(0, '#0e1411');
    bg.addColorStop(1, '#06080a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // 2. オフスクリーン: 食料 / 障害物 / Biomass を pixel-by-pixel で焼く
    this.paintFieldLayer(env, bio);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.fieldCanvas, 0, 0, cssW, cssH);

    // 3. 管 (Edge)
    const scale = cssW / this.opts.worldSize;
    this.drawEdges(state, scale);

    // 4. ノード
    this.drawNodes(state, scale);

    // 5. カーソルプレビュー
    if (hoverPx) this.drawHover(hoverPx);
  }

  private paintFieldLayer(env: GridEnvironment, bio: BiomassField): void {
    const fs = this.opts.fieldSize;
    const data = this.fieldImage.data;
    // 場の最大値を測って正規化 (端で霞ませるため)
    let maxBio = 0;
    for (let i = 0; i < bio.field.data.length; i++) {
      const v = bio.field.data[i] ?? 0;
      if (v > maxBio) maxBio = v;
    }
    maxBio = Math.max(maxBio, 0.4);

    for (let y = 0; y < fs; y++) {
      for (let x = 0; x < fs; x++) {
        const i = y * fs + x;
        const di = i * 4;
        // 開始: 透明
        let r = 0, g = 0, b = 0, a = 0;

        // 食料 — 薄緑
        const nut = env.nutrients.data[i] ?? 0;
        if (nut > 0.04 && this.opts.showHeat) {
          const k = Math.min(1, nut * 0.7);
          [r, g, b] = blend(r, g, b, a, 60, 170, 80, k * 0.6);
          a = Math.max(a, k * 0.6);
        } else if (nut > 0.04) {
          const k = Math.min(1, nut * 0.5);
          [r, g, b] = blend(r, g, b, a, 50, 150, 70, k * 0.35);
          a = Math.max(a, k * 0.35);
        }

        // 水 — ヒート時のみ青く表示
        if (this.opts.showHeat) {
          const m = env.moisture.data[i] ?? 0;
          if (m > 0.25) {
            const k = Math.min(1, (m - 0.25) * 1.4);
            [r, g, b] = blend(r, g, b, a, 70, 130, 220, k * 0.4);
            a = Math.max(a, k * 0.4);
          }
          const l = env.brightness.data[i] ?? 0;
          if (l > 0.25) {
            const k = Math.min(1, (l - 0.25) * 1.4);
            [r, g, b] = blend(r, g, b, a, 245, 230, 150, k * 0.35);
            a = Math.max(a, k * 0.35);
          }
        }

        // 障害物 — 暗いグレー
        const ob = env.obstacle.data[i] ?? 0;
        if (ob > 0.5) {
          [r, g, b] = blend(r, g, b, a, 78, 72, 80, 0.85);
          a = Math.max(a, 0.85);
        }

        // Biomass 膜 — 黄〜白
        const v = (bio.field.data[i] ?? 0) / maxBio;
        if (v > 0.02) {
          const k = Math.pow(Math.min(1, v), 0.55);
          const br = 240;
          const bg2 = Math.floor(190 + 50 * Math.max(0, k - 0.5) * 2);
          const bb = Math.floor(80 + 140 * Math.max(0, k - 0.6) * 2);
          const ba = Math.min(0.9, 0.18 + k * 0.65);
          [r, g, b] = blend(r, g, b, a, br, bg2, bb, ba);
          a = Math.max(a, ba);
        }

        data[di] = r;
        data[di + 1] = g;
        data[di + 2] = b;
        data[di + 3] = Math.floor(a * 255);
      }
    }
    this.fieldCtx.putImageData(this.fieldImage, 0, 0);
  }

  private drawEdges(state: SimState, scale: number): void {
    const { ctx } = this;
    const nodeMap = new Map(state.nodes.map((n) => [n.id, n]));

    // 二段描画: 外周 (glow) を additive で先に、芯線を後で
    const sorted = [...state.edges].sort((a, b) => a.radius - b.radius);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of sorted) {
      const a = nodeMap.get(e.from);
      const b = nodeMap.get(e.to);
      if (!a || !b) continue;
      const fluxN = Math.min(1, e.flux / 5);
      const core = Math.max(0.9, e.radius * 1.0 + fluxN * 1.0);
      const glow = core + 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgba(255, 210, 110, ${0.10 + fluxN * 0.12})`;
      ctx.lineWidth = glow;
      ctx.beginPath();
      ctx.moveTo(a.pos.x * scale, a.pos.y * scale);
      ctx.lineTo(b.pos.x * scale, b.pos.y * scale);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    for (const e of sorted) {
      const a = nodeMap.get(e.from);
      const b = nodeMap.get(e.to);
      if (!a || !b) continue;
      const fluxN = Math.min(1, e.flux / 5);
      const core = Math.max(0.9, e.radius * 1.0 + fluxN * 1.0);
      const t = Math.min(1, fluxN * 0.7 + e.radius * 0.25);
      const rr = Math.floor(160 - 40 * t);
      const gg = Math.floor(105 - 30 * t);
      const bb = Math.floor(45 + 10 * t);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = `rgb(${rr}, ${gg}, ${bb})`;
      ctx.lineWidth = core;
      ctx.beginPath();
      ctx.moveTo(a.pos.x * scale, a.pos.y * scale);
      ctx.lineTo(b.pos.x * scale, b.pos.y * scale);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawNodes(state: SimState, scale: number): void {
    const { ctx } = this;
    for (const n of state.nodes) {
      if (n.type === 'relay') continue;
      const cx = n.pos.x * scale;
      const cy = n.pos.y * scale;
      const r = n.type === 'source' ? 5.2 : 4.2;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
      if (n.type === 'source') {
        halo.addColorStop(0, 'rgba(170, 230, 255, 0.95)');
        halo.addColorStop(0.4, 'rgba(120, 200, 255, 0.45)');
        halo.addColorStop(1, 'rgba(120, 200, 255, 0)');
      } else {
        halo.addColorStop(0, 'rgba(180, 255, 180, 0.95)');
        halo.addColorStop(0.4, 'rgba(120, 255, 140, 0.4)');
        halo.addColorStop(1, 'rgba(120, 255, 140, 0)');
      }
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = n.type === 'source' ? '#dff3ff' : '#dfffd9';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawHover(h: { x: number; y: number; radius: number; tool: string }): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 1.5;
    const stroke = toolColor(h.tool);
    ctx.strokeStyle = stroke;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(h.x, h.y, h.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function blend(r: number, g: number, b: number, a: number, r2: number, g2: number, b2: number, a2: number): [number, number, number] {
  // src-over: out = src*a + dst*(1-a) (premul は単純化のため省略)
  const inv = 1 - a2;
  return [
    Math.floor(r * inv + r2 * a2),
    Math.floor(g * inv + g2 * a2),
    Math.floor(b * inv + b2 * a2),
  ];
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
