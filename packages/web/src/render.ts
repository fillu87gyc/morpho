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
  Vec2,
  NodeId,
  SimNode,
  SimEdge,
} from '@morpho/sim';
import type { WorldView } from './camera.js';
import type { StageId } from './stages.js';
import { MultiLayerDirtyTracker } from './field-diff.js';

export interface RenderOptions {
  worldSize: number;
  fieldSize: number;
  showHeat: boolean;
}

// paintFieldLayer が焼くレイヤ数: biomass / nutrients / moisture / brightness / obstacle。
const FIELD_LAYER_COUNT = 5;
// 生の浮動小数比較だと biomass の減衰が皿全体でごく僅かに毎tick進み続けるため、
// 見た目に影響しない変化まで「差分」扱いになってしまう。可視のバイト値
// (0-255) が変わらない程度の揺れは無視する。
const FIELD_EPS = 0.004;

// M8 P3 drawEdges: 毎フレームのフル sort をやめ、radius で粗いバケツに
// 振り分けるだけにする (バケツの描画順=太さの昇順で、元の sort と同じ
// 「細い枝の上に太い幹を重ねる」効果を保ちつつ O(E log E) を O(E) にする)。
const RADIUS_BUCKET_COUNT = 8;
const RADIUS_BUCKET_MAX = 3.2; // これを超える radius は最後のバケツに丸める
// 同バケツ内でも見た目 (色/太さ) が近いエッジは1本の Path にまとめて
// stroke() の呼び出し回数を減らす。量子化の粒度 (段数が多いほど元の
// 連続的なグラデーションに近いが、まとめ効果は薄れる)。
const TONE_STEPS = 8;
const WIDTH_QUANT = 0.25; // px

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

// ステージごとの背景トーンと障害物 (石) の色味。「洞窟の岩」「砂漠の岩」
// 「都市跡の風化した石材」を見分けられるよう、ステージごとに変える。
const STAGE_BG: Record<StageId, { inner: [number, number, number]; outer: [number, number, number] }> = {
  petri:   { inner: [14, 20, 17], outer: [6, 8, 10] },
  cave:    { inner: [11, 15, 22], outer: [3, 4, 7] },
  desert:  { inner: [30, 23, 15], outer: [13, 10, 7] },
  ruins:   { inner: [25, 21, 17], outer: [10, 8, 7] },
  wetland: { inner: [10, 21, 18], outer: [4, 9, 8] },
};

const STAGE_ROCK_COLOR: Record<StageId, [number, number, number]> = {
  petri:   [70, 65, 75],
  cave:    [58, 64, 78],
  desert:  [124, 98, 66],
  ruins:   [156, 132, 98], // 風化した石材 (暖かいベージュ)
  wetland: [72, 78, 68],
};

// 角丸矩形のパスを作る (Canvas の roundRect API は環境依存が残るため自前実装)。
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private fieldImage: ImageData;
  private fieldCanvas: HTMLCanvasElement;
  private fieldCtx: CanvasRenderingContext2D;
  private dpr: number;

  // 差分再描画用: 直前フレームで焼いた場の値を保持し、変化したセルだけ
  // 色を計算し直す。地形 (nutrients/moisture/brightness/obstacle) は
  // ツールを使わない限りほぼ静止しているため、これだけで大半のフレームは
  // 「触った/育った」近傍のみの再計算 + putImageData の部分矩形更新で済む。
  // 実装 (field-diff.ts) は DOM 非依存でユニットテストされている。
  private tracker: MultiLayerDirtyTracker;
  private prevMaxBio = -1;
  private prevShowHeat: boolean | null = null;
  private prevStageId: StageId | null = null;

  // M8 P3 drawEdges: nodeMap とバケツ分けは state (nodes/edges の参照) が
  // 変わらない限り使い回す。RAF は Worker のスナップショット送信より
  // 高頻度になりうる (高リフレッシュレート機や一時停止中) ため、
  // 同じ state を複数フレームで描くケースは珍しくない。
  private cachedState: SimState | null = null;
  private cachedNodeMap: Map<NodeId, SimNode> | null = null;
  private cachedRadiusBuckets: SimEdge[][] | null = null;

  // M8 P3 drawNodes: グロー (radial gradient) をノードごとに毎フレーム
  // 生成する代わりに、色ごとに1枚だけ焼いたスプライトを drawImage で貼る。
  private sourceGlowSprite: HTMLCanvasElement;
  private sinkGlowSprite: HTMLCanvasElement;

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
    this.tracker = new MultiLayerDirtyTracker(opts.fieldSize, FIELD_LAYER_COUNT, FIELD_EPS);

    this.sourceGlowSprite = buildGlowSprite(SOURCE_DOT);
    this.sinkGlowSprite = buildGlowSprite(SINK_DOT);
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

  draw(state: SimState, env: GridEnvironment, bio: BiomassField, stageId: StageId, landmarks: Vec2[], view: WorldView, hoverPx?: { x: number; y: number; radius: number; tool: string }): void {
    const { ctx } = this;
    const cssW = this.canvas.width / this.dpr;
    const cssH = this.canvas.height / this.dpr;
    const cx = cssW / 2;
    const cy = cssH / 2;
    const side = Math.min(cssW, cssH);
    const left = cx - side / 2;
    const top = cy - side / 2;

    // 1. 暗いラジアル背景 (中央ほど少し明るい — ステージごとのトーンに寄せる)
    const bgTone = STAGE_BG[stageId];
    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, side * 0.6);
    bg.addColorStop(0, rgb(bgTone.inner));
    bg.addColorStop(1, rgb(bgTone.outer));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // 2. 場系を焼いて貼る。view (カメラのズーム/パン) に応じて
    //    fieldCanvas (常に世界全体を焼いた1枚) から必要な矩形だけを
    //    切り出して拡大する。zoom=1 のときは全体をそのまま貼るのと同じ。
    this.paintFieldLayer(env, bio, stageId);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const fieldScale = this.opts.fieldSize / this.opts.worldSize;
    ctx.drawImage(
      this.fieldCanvas,
      view.worldLeft * fieldScale, view.worldTop * fieldScale,
      view.worldSpan * fieldScale, view.worldSpan * fieldScale,
      left, top, side, side,
    );

    // 3. ステージの装飾アイコン (廃墟の柱 / 鍾乳石 / サボテン / 葦)
    const scale = side / view.worldSpan;
    const offX = left - view.worldLeft * scale;
    const offY = top - view.worldTop * scale;
    this.drawLandmarks(ctx, landmarks, stageId, scale, offX, offY);

    // 4. 脈管網
    this.drawEdges(ctx, state, scale, offX, offY);

    // 5. source / sink
    this.drawNodes(ctx, state, scale, offX, offY);

    // 6. カーソル
    if (hoverPx) this.drawHover(hoverPx);
  }

  // 成長タイムライン用のサムネイル。現在のカメラ位置に関わらず、
  // 常に世界全体を俯瞰した絵を焼く (ズーム中でも成長の全体像が分かるように)。
  // paintFieldLayer は差分描画のため、直前の draw() 呼び出しと env/bio が
  // 一致している前提 (main.ts は同じフレーム内で同じスナップショットを
  // draw() → renderThumbnail() の順に渡す) で呼ぶこと。異なるスナップショットを
  // 渡すと、直前に描かれた絵との差分だけが焼き足される。
  //
  // M8 P3: ピクセルの描画自体は同期のまま (上記の前提を保つ必要があるため)
  // だが、PNG へのエンコードは同期の toDataURL() ではなく非同期の
  // toBlob() を使う。エンコードはメインスレッドをブロックしうる処理
  // (特にこのサイズの描画を Day 5/10/15... の節目ごとに行う) なので、
  // 結果は blob URL の Promise として返す。
  renderThumbnail(state: SimState, env: GridEnvironment, bio: BiomassField, stageId: StageId, landmarks: Vec2[], size: number): Promise<string> {
    const thumb = document.createElement('canvas');
    thumb.width = size;
    thumb.height = size;
    const tctx = thumb.getContext('2d');
    if (!tctx) return Promise.resolve('');
    this.paintFieldLayer(env, bio, stageId);
    tctx.fillStyle = rgb(STAGE_BG[stageId].inner);
    tctx.fillRect(0, 0, size, size);
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(this.fieldCanvas, 0, 0, size, size);
    const scale = size / this.opts.worldSize;
    this.drawLandmarks(tctx, landmarks, stageId, scale, 0, 0);
    this.drawEdges(tctx, state, scale, 0, 0);
    this.drawNodes(tctx, state, scale, 0, 0);
    return new Promise((resolve) => {
      thumb.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/png');
    });
  }

  private paintFieldLayer(env: GridEnvironment, bio: BiomassField, stageId: StageId): void {
    const data = this.fieldImage.data;
    const bioData = bio.field.data;
    const nutData = env.nutrients.data;
    const moiData = env.moisture.data;
    const briData = env.brightness.data;
    const obData = env.obstacle.data;

    let maxBio = 0;
    for (let i = 0; i < bioData.length; i++) {
      const v = bioData[i] ?? 0;
      if (v > maxBio) maxBio = v;
    }
    maxBio = Math.max(maxBio, 0.6);

    // maxBio が動くと biomass の正規化値 (v = raw/maxBio) が全セルで
    // ずれるため、生の値が変わっていないセルも塗り直しが要る。
    // 変化が小さければ無視して差分描画を続け、大きく動いた
    // (序盤の急成長など) フレームだけ全面フォールバックする。
    const maxBioJumped = this.prevMaxBio < 0
      || Math.abs(maxBio - this.prevMaxBio) / Math.max(this.prevMaxBio, 1e-6) > 0.02;
    const heatChanged = this.prevShowHeat !== this.opts.showHeat;
    const stageChanged = this.prevStageId !== null && this.prevStageId !== stageId;
    const full = !this.tracker.initialized || maxBioJumped || heatChanged || stageChanged;
    const rockColor = STAGE_ROCK_COLOR[stageId];

    const dirty = this.tracker.update(
      [bioData, nutData, moiData, briData, obData],
      full,
      (i) => {
        const di = i * 4;
        let r = 0, g = 0, b = 0, a = 0;

        // 地形の質感 (常時, 控えめ): ヒート表示 OFF でもバイオームの違いが
        // 見えるように、baseline (湿度 0.3 / 明るさ 0.2) からの差分だけを
        // 弱く乗せる。強い版はヒート表示 ON のときの下のブロックが担う。
        const moiBase = moiData[i] ?? 0;
        const briBase = briData[i] ?? 0;
        const moiDelta = moiBase - 0.3;
        if (moiDelta > 0.06) {
          // 湿った土地 — 仄かに青緑
          const k = Math.min(1, (moiDelta - 0.06) * 2.4);
          [r, g, b] = blend(r, g, b, 70, 110, 140, k * 0.16);
          a = Math.max(a, k * 0.16);
        } else if (moiDelta < -0.04) {
          // 乾いた土地 (砂地) — 仄かに山吹の砂色。明るさが高いほど強調。
          const k = Math.min(1, (-moiDelta) * 2.4 + Math.max(0, briBase - 0.2) * 0.8);
          const fa = Math.min(0.20, k * 0.18);
          [r, g, b] = blend(r, g, b, 190, 165, 115, fa);
          a = Math.max(a, fa);
        }

        // 食料 — 仄かな緑の発光 (additive ぽい弱い乗せ)
        const nut = nutData[i] ?? 0;
        if (nut > 0.05) {
          const k = Math.min(1, nut * 0.6);
          const fa = 0.18 + k * 0.32;
          [r, g, b] = blend(r, g, b, FOOD_GLOW[0], FOOD_GLOW[1], FOOD_GLOW[2], fa);
          a = Math.max(a, fa);
        }

        // ヒート (UI トグル): 水を青く、光を黄色く薄く乗せる
        if (this.opts.showHeat) {
          if (moiBase > 0.25) {
            const k = Math.min(1, (moiBase - 0.25) * 1.4);
            [r, g, b] = blend(r, g, b, 90, 150, 220, k * 0.32);
            a = Math.max(a, k * 0.32);
          }
          if (briBase > 0.25) {
            const k = Math.min(1, (briBase - 0.25) * 1.4);
            [r, g, b] = blend(r, g, b, 245, 230, 150, k * 0.28);
            a = Math.max(a, k * 0.28);
          }
        }

        // 障害物 — ステージごとの石材色 (洞窟は青灰、砂漠は赤茶、都市跡は風化ベージュ)
        const ob = obData[i] ?? 0;
        if (ob > 0.5) {
          [r, g, b] = blend(r, g, b, rockColor[0], rockColor[1], rockColor[2], 0.85);
          a = Math.max(a, 0.85);
        }

        // プラズマ膜 — 縁は暗い金、中は山吹、芯は明るい黄
        const v = (bioData[i] ?? 0) / maxBio;
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
      },
    );

    // 変化したセルがあった矩形だけをキャンバスへ反映する。
    if (dirty) {
      this.fieldCtx.putImageData(
        this.fieldImage, 0, 0,
        dirty.x0, dirty.y0, dirty.x1 - dirty.x0 + 1, dirty.y1 - dirty.y0 + 1,
      );
    }

    this.prevMaxBio = maxBio;
    this.prevShowHeat = this.opts.showHeat;
    this.prevStageId = stageId;
  }

  // state (nodes/edges の参照) が前回と同じなら nodeMap / radius バケツを
  // 使い回す。新しいスナップショットが届いたときだけ再構築する。
  private syncEdgeCache(state: SimState): void {
    if (state === this.cachedState) return;
    this.cachedState = state;
    this.cachedNodeMap = new Map(state.nodes.map((n) => [n.id, n]));
    const buckets: SimEdge[][] = Array.from({ length: RADIUS_BUCKET_COUNT }, () => []);
    for (const e of state.edges) {
      const idx = Math.min(RADIUS_BUCKET_COUNT - 1, Math.floor((e.radius / RADIUS_BUCKET_MAX) * RADIUS_BUCKET_COUNT));
      buckets[Math.max(0, idx)]!.push(e);
    }
    this.cachedRadiusBuckets = buckets;
  }

  private drawEdges(ctx: CanvasRenderingContext2D, state: SimState, scale: number, offX: number, offY: number): void {
    this.syncEdgeCache(state);
    const nodeMap = this.cachedNodeMap!;
    const buckets = this.cachedRadiusBuckets!;
    const pxPerWorld = scale / 5.76;  // 参照 (W=576, world=100) 比

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // バケツ (太さの昇順) ごとに、見た目 (色/太さ) が近いエッジを1本の
    // Path2D にまとめてから stroke() する。flux は毎tick変わるので
    // グルーピング自体は毎フレーム作り直すが、E 回の stroke() 呼び出しを
    // バケツ内のスタイル種類数まで減らせる。
    const styleGroups = new Map<string, { path: Path2D; color: string; lineWidth: number }>();
    for (const bucket of buckets) {
      if (bucket.length === 0) continue;
      styleGroups.clear();
      for (const e of bucket) {
        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) continue;
        const fluxN = Math.min(1, e.flux / 5);
        const tubeW = Math.max(0.7, e.radius * 1.05 + fluxN * 1.4) * pxPerWorld;
        const t = Math.min(1, fluxN * 0.65 + Math.min(1, e.radius / 2) * 0.55);
        const toneStep = Math.round(t * TONE_STEPS);
        const lineWidth = Math.max(0.6, tubeW * 0.55);
        const widthStep = Math.round(lineWidth / WIDTH_QUANT);
        const key = `${toneStep}_${widthStep}`;
        let group = styleGroups.get(key);
        if (!group) {
          // 細い枝はクリーム色で軽やか、太く流量多い管はオレンジで濃く。
          const tt = toneStep / TONE_STEPS;
          const rr = Math.round(TUBE_LIGHT[0] * (1 - tt) + TUBE_DARK[0] * tt);
          const gg = Math.round(TUBE_LIGHT[1] * (1 - tt) + TUBE_DARK[1] * tt);
          const bb = Math.round(TUBE_LIGHT[2] * (1 - tt) + TUBE_DARK[2] * tt);
          group = {
            path: new Path2D(),
            color: `rgba(${rr}, ${gg}, ${bb}, ${0.78 + tt * 0.18})`,
            lineWidth: Math.max(0.6, widthStep * WIDTH_QUANT),
          };
          styleGroups.set(key, group);
        }
        group.path.moveTo(offX + a.pos.x * scale, offY + a.pos.y * scale);
        group.path.lineTo(offX + b.pos.x * scale, offY + b.pos.y * scale);
      }
      for (const group of styleGroups.values()) {
        ctx.strokeStyle = group.color;
        ctx.lineWidth = group.lineWidth;
        ctx.stroke(group.path);
      }
    }
    ctx.restore();
  }

  private drawNodes(ctx: CanvasRenderingContext2D, state: SimState, scale: number, offX: number, offY: number): void {
    for (const n of state.nodes) {
      if (n.type === 'relay') continue;
      const cx = offX + n.pos.x * scale;
      const cy = offY + n.pos.y * scale;
      const color = n.type === 'source' ? SOURCE_DOT : SINK_DOT;
      const sprite = n.type === 'source' ? this.sourceGlowSprite : this.sinkGlowSprite;
      const r = (n.type === 'source' ? 5 : 4) * Math.max(1, scale / 6.4);
      // グローは事前に焼いたスプライトを必要な直径に拡大して貼るだけ
      // (createRadialGradient をノード毎・毎フレーム生成しない)。
      const d = r * 6;
      ctx.drawImage(sprite, cx - d / 2, cy - d / 2, d, d);
      // 中央のコア
      ctx.fillStyle = `rgb(${Math.min(255, color[0] + 30)}, ${Math.min(255, color[1] + 30)}, ${Math.min(255, color[2] + 30)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ステージの装飾アイコン。地形の色味だけでは「ここは廃墟/洞窟/砂漠/湿地」
  // と一目で伝わりにくいので、認識しやすいピクトグラムを目印座標に描く。
  private drawLandmarks(ctx: CanvasRenderingContext2D, landmarks: Vec2[], stageId: StageId, scale: number, offX: number, offY: number): void {
    if (landmarks.length === 0) return;
    for (const p of landmarks) {
      const x = offX + p.x * scale;
      const y = offY + p.y * scale;
      switch (stageId) {
        case 'ruins': this.drawRuinPillar(ctx, x, y, scale); break;
        case 'cave': this.drawCrystalCluster(ctx, x, y, scale); break;
        case 'desert': this.drawCactus(ctx, x, y, scale); break;
        case 'wetland': this.drawReeds(ctx, x, y, scale); break;
        default: break;
      }
    }
  }

  // 都市跡: 崩れた石柱 + 転がった瓦礫塊。暖色の風化した石材で「人工物の廃墟」感を出す。
  private drawRuinPillar(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    const w = 1.5 * scale, h = 4.4 * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + w * 0.15, w * 1.5, w * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // 柱本体 (上端がギザギザに欠けている = 崩れた柱)
    const grad = ctx.createLinearGradient(x - w / 2, y - h, x + w / 2, y);
    grad.addColorStop(0, 'rgba(198, 178, 142, 0.95)');
    grad.addColorStop(1, 'rgba(134, 114, 86, 0.95)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.lineTo(x - w / 2, y - h * 0.62);
    ctx.lineTo(x - w * 0.15, y - h * 0.78);
    ctx.lineTo(x - w * 0.38, y - h);
    ctx.lineTo(x + w * 0.1, y - h * 0.86);
    ctx.lineTo(x + w / 2, y - h * 0.66);
    ctx.lineTo(x + w / 2, y);
    ctx.closePath();
    ctx.fill();

    // 縦の溝 (フルーティング) で列柱らしさを出す
    ctx.strokeStyle = 'rgba(90, 76, 58, 0.55)';
    ctx.lineWidth = Math.max(0.5, scale * 0.05);
    for (const dx of [-0.28, 0, 0.28]) {
      ctx.beginPath();
      ctx.moveTo(x + dx * w, y);
      ctx.lineTo(x + dx * w, y - h * 0.6);
      ctx.stroke();
    }

    // 根本に転がった瓦礫塊
    ctx.fillStyle = 'rgba(122, 104, 80, 0.9)';
    roundedRectPath(ctx, x + w * 0.75, y - w * 0.4, w * 1.1, w * 0.55, w * 0.2);
    ctx.fill();
    ctx.restore();
  }

  // 洞窟: 冷たい青緑の水晶クラスタ。地下の閉じた空間らしさを出す。
  private drawCrystalCluster(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    const shards: { dx: number; h: number; w: number }[] = [
      { dx: -0.7, h: 2.4, w: 0.55 },
      { dx: 0, h: 3.4, w: 0.7 },
      { dx: 0.65, h: 2.0, w: 0.5 },
    ];
    ctx.save();
    ctx.shadowColor = 'rgba(120, 200, 220, 0.6)';
    ctx.shadowBlur = scale * 0.8;
    for (const s of shards) {
      const cx = x + s.dx * scale;
      const h = s.h * scale, w = s.w * scale;
      const grad = ctx.createLinearGradient(cx, y - h, cx, y);
      grad.addColorStop(0, 'rgba(210, 245, 250, 0.95)');
      grad.addColorStop(1, 'rgba(70, 130, 160, 0.85)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx, y - h);
      ctx.lineTo(cx + w / 2, y - h * 0.25);
      ctx.lineTo(cx + w * 0.3, y);
      ctx.lineTo(cx - w * 0.3, y);
      ctx.lineTo(cx - w / 2, y - h * 0.25);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 砂漠: サボテンのシルエット。乾いた土地の目印として分かりやすい形にする。
  private drawCactus(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    const w = 0.85 * scale, h = 3.4 * scale;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y + w * 0.1, w * 1.6, w * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(78, 148, 92, 0.92)';
    roundedRectPath(ctx, x - w / 2, y - h, w, h, w / 2);
    ctx.fill();
    roundedRectPath(ctx, x - w * 1.55, y - h * 0.6, w * 0.7, h * 0.42, w * 0.35);
    ctx.fill();
    roundedRectPath(ctx, x + w * 0.85, y - h * 0.78, w * 0.65, h * 0.4, w * 0.3);
    ctx.fill();

    // 棘: 短い縦線を数本
    ctx.strokeStyle = 'rgba(224, 250, 214, 0.55)';
    ctx.lineWidth = Math.max(0.4, scale * 0.035);
    for (let i = 0; i < 5; i++) {
      const yy = y - h * 0.12 - (i * h * 0.7) / 5;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, yy);
      ctx.lineTo(x - w * 0.72, yy - scale * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.5, yy);
      ctx.lineTo(x + w * 0.72, yy - scale * 0.12);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 湿地: 水辺の葦とガマ。水気の多さを植生で示す。
  private drawReeds(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
    const blades = [-0.5, -0.2, 0.1, 0.4];
    ctx.save();
    ctx.strokeStyle = 'rgba(96, 150, 90, 0.85)';
    ctx.lineWidth = Math.max(0.5, scale * 0.055);
    ctx.lineCap = 'round';
    for (const dx of blades) {
      const h = (2.4 + Math.abs(dx) * 1.2) * scale;
      ctx.beginPath();
      ctx.moveTo(x + dx * scale * 0.6, y);
      ctx.quadraticCurveTo(x + dx * scale * 1.4, y - h * 0.6, x + dx * scale * 0.9, y - h);
      ctx.stroke();
    }
    // ガマの穂
    const tailX = x + blades[1]! * scale * 0.6;
    const tailY = y - (2.4 + Math.abs(blades[1]!) * 1.2) * scale;
    ctx.fillStyle = 'rgba(120, 90, 55, 0.9)';
    ctx.beginPath();
    ctx.ellipse(tailX, tailY + scale * 0.3, scale * 0.16, scale * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

// M8 P3 drawNodes: source/sink のグローを一度だけ焼いたオフスクリーン
// スプライト。固定解像度で焼き、実際の描画時は drawImage で必要な
// 直径に拡大縮小する (createRadialGradient をノード毎・毎フレーム
// 生成しない)。
const GLOW_SPRITE_SIZE = 128;

function buildGlowSprite(color: [number, number, number]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = GLOW_SPRITE_SIZE;
  c.height = GLOW_SPRITE_SIZE;
  const cx = c.getContext('2d');
  if (!cx) return c;
  const r = GLOW_SPRITE_SIZE / 2;
  const grad = cx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.95)`);
  grad.addColorStop(0.4, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.4)`);
  grad.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
  cx.fillStyle = grad;
  cx.beginPath();
  cx.arc(r, r, r, 0, Math.PI * 2);
  cx.fill();
  return c;
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
