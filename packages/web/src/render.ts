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
import { assets, SPRITE_FAMILIES, type TileTextureName } from './assets.js';
import { extractTerrainBlobs, SMALL_BLOB_MAX_CELLS } from './terrain-blobs.js';
import { extractCoastline } from './coastline.js';

export interface RenderOptions {
  worldSize: number;
  fieldSize: number;
  showHeat: boolean;
}

// paintFieldLayer が焼くレイヤ数: biomass / nutrients / moisture / brightness /
// obstacle / temperature / toxin (M10) / water (M14)。
const FIELD_LAYER_COUNT = 8;
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
// M16.5: ネットワーク発光の性能ガード。stroke() 呼び出しが2倍になる glow
// パスは、エッジ総数がこれを超えるフレームでは省略する (3ms/frame 予算)。
const GLOW_MAX_EDGES = 1200;
// M16.5: 地形の粒ノイズの不透明度。dirty な全セルで必ず適用される定数。
const GRAIN_ALPHA = 0.24;

// M16.5: 配色を「暗い森の虚無」から「苔むした岩肌・木漏れ日の中を金色に
// 光る網が這う」自然のフィールドへ刷新した (ROADMAP.md M16.5 の色票に準拠、
// 詳細な before/after は docs/art-direction.md 参照)。地形の底上げが
// 最優先: 旧配色は STAGE_BG がほぼ黒 (#0b0d0c 付近) で、場 (moiDelta/nut/
// obstacle/biomass いずれも閾値未満) の大半を占める「素の地面」がその
// まま透けて見えるため、画面の大部分が虚無に見えていた。
const FOOD_GLOW:   [number, number, number] = [130, 220, 120]; // 仄か緑の発光
// Biomass 膜: 成長前線 (v が低い縁) を明るい金でリム発光させ、確立した
// 内側 (v が高い核) はアルファを絞って下の地形が透けるようにする
// (旧: 中心が最も不透明・明るい単調増加だったのを反転)。
const PLASMA_FRINGE: [number, number, number] = [150, 120, 45];  // 生まれたての縁 (薄い金)
const PLASMA_RIM:    [number, number, number] = [255, 224, 120]; // 成長前線 (最も明るいリム)
const PLASMA_CORE:   [number, number, number] = [205, 165, 90];  // 確立した核 (落ち着いた金、低アルファ)
const TUBE_LIGHT:  [number, number, number] = [255, 226, 150]; // 細い枝 (クリーム金)
const TUBE_DARK:   [number, number, number] = [235, 175, 70];  // 太い幹 (濃い金)
const TUBE_GLOW:   [number, number, number] = [255, 200, 90];  // 発光レイヤー (lighter 合成)
const SOURCE_DOT:  [number, number, number] = [170, 220, 255];
const SINK_DOT:    [number, number, number] = [170, 255, 170];
// M10: 毒素は HUD の環境バランス (dot-toxin) と同系統の紫。常時薄く見せる
// (obstacle/food と同じ扱い — 避けたいものは常に見える方が良い)。
const TOXIN_COLOR: [number, number, number] = [150, 95, 190];
// M10: 温度ヒートマップ (showHeat トグル時のみ)。暑い=赤橙、寒い=藍青。
const HEAT_HOT:  [number, number, number] = [235, 105, 65];
const HEAT_COLD: [number, number, number] = [110, 140, 235];

// ステージごとの背景トーン (昼想定で底上げ) と障害物 (石) の色味。
// 「洞窟の岩」「砂漠の岩」「都市跡の風化した石材」を見分けられるよう、
// ステージごとに変える。洞窟だけは地下の閉空間らしさを残すため他より
// 暗いままにするが、旧配色のような黒潰れ (~#0b0d0c) にはしない。
const STAGE_BG: Record<StageId, { inner: [number, number, number]; outer: [number, number, number] }> = {
  petri:     { inner: [88, 104, 64], outer: [50, 62, 38] },  // 苔の緑
  cave:      { inner: [46, 54, 68],  outer: [22, 27, 36] },  // 冷たい岩肌 (最も暗いまま)
  desert:    { inner: [128, 100, 62], outer: [72, 56, 36] }, // 陽だまりの砂
  ruins:     { inner: [112, 96, 74], outer: [62, 52, 40] },  // 風化した石材
  wetland:   { inner: [70, 96, 78],  outer: [38, 54, 44] },  // 湿った苔
  continent: { inner: [78, 94, 86],  outer: [40, 50, 46] },  // 海沿いの陸地
};

const STAGE_ROCK_COLOR: Record<StageId, [number, number, number]> = {
  petri:     [110, 104, 112],
  cave:      [90, 98, 118],
  desert:    [156, 124, 86],
  ruins:     [180, 154, 116], // 風化した石材 (暖かいベージュ)
  wetland:   [102, 110, 96],
  continent: [124, 120, 108],
};

// M14: 大陸ステージの水域 (通行不能な水面)。obstacle の石色より青く、
// 常時見える (石とは塗り分ける)。深みのグラデーション用に濃淡2色持つ。
const WATER_BODY_DEEP:   [number, number, number] = [30, 70, 120];
const WATER_BODY_SHALLOW: [number, number, number] = [70, 130, 175];
const WATER_EDGE_COLOR:  [number, number, number] = [150, 205, 220]; // 縁の明るいライン

// M21: ステージごとの地面タイルテクスチャ (アセット未ロード時は使われず、
// 従来の STAGE_BG 単色+粒ノイズにフォールバックする)。湿地/大陸は苔の
// テクスチャを流用する (専用タイルは発注ブリーフに無いため)。
const TILE_TEXTURE_BY_STAGE: Record<StageId, TileTextureName> = {
  petri: 'moss-ground',
  cave: 'cave-floor',
  desert: 'sand-dry',
  ruins: 'stone-ruins',
  wetland: 'moss-ground',
  continent: 'moss-ground',
};
// タイル画像1枚がワールド座標で何単位分を表すか。値が大きいほど1枚が
// 大きく引き伸ばされて見える (荒くなる) が継ぎ目は目立ちにくくなる。
const TILE_WORLD_SIZE = 9;

// M21: 木漏れ日のまだら。以前は「中央がやや明るいラジアルグラデーション
// 1枚」だった光の表現を、ワールド座標に固定されたまばらな明るい斑点へ
// 置き換える (ズームしても斑点の実寸が保たれ、フラットな印象にならない)。
const DAPPLE_CELL_WORLD = 7;
const DAPPLE_THRESHOLD = 0.62;
const DAPPLE_MAX_ALPHA = 0.34;

// M21: 岩スプライトの見かけの大きさ (obstacle 連結成分の概算半径に対する倍率)。
const ROCK_SPRITE_SCALE = 2.4;

// M22: 水面テクスチャの1タイルが表すワールド単位。
const WATER_TILE_WORLD_SIZE = 11;
// 水面パターンのゆっくりとした平行移動 (ワールド単位/ミリ秒)。
// prefers-reduced-motion のときは 0 にしてアニメを止める。
const WATER_DRIFT_SPEED = 0.0006;
// 岸辺の帯の太さ (ワールド単位)。内側=浅瀬 (明るい水色)、外側=湿った砂。
const SHORE_BAND_WORLD = 1.6;
const SHORE_SHALLOW_COLOR = 'rgba(190, 225, 232, 0.5)';
const SHORE_WET_SAND_COLOR = 'rgba(150, 130, 95, 0.55)';
// 岸線に沿って葦を置く間隔 (ワールド単位)。
const REED_SPACING_WORLD = 6;

// M16.5: 地形テクスチャ (苔の粒ノイズ・岩のまだら・水面の揺らぎ) 用の
// 軽量な決定的疑似乱数。整数座標だけから求まるので追加のフィールドデータも
// state も要らず、Math.sin 等より安い整数演算のみ (毎ピクセル呼ばれるため
// コストを最小化する)。戻り値は [0,1)。
function hashNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

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
  private prevSpritesReady = false;
  private prevWaterReady = false;

  // M21: タイルテクスチャの CanvasPattern はテクスチャ名ごとに1度だけ作る
  // (createPattern をフレームごとに呼ばない)。setTransform で毎フレーム
  // カメラ位置/ズームに追従させる。
  private patternCache = new Map<TileTextureName, CanvasPattern>();
  // M22: 水面パターンのゆっくりとした揺らぎ用の起点時刻。
  private readonly startTime = typeof performance !== 'undefined' ? performance.now() : 0;
  private readonly reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

    // M20/M21: テクスチャ/スプライトの先読みを開始する (失敗しても reject
    // しない設計なので fire-and-forget で問題ない)。未ロードの間は各
    // 描画メソッドが従来の手続き描画へフォールバックする。
    void assets.preloadAll();
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

  // M14: nightFactor [0,1] は演出用の昼夜トーン (洞窟は常に暗いので無効)。
  // 省略時 (サムネイル撮影など) は 0 = 昼間のまま。
  draw(state: SimState, env: GridEnvironment, bio: BiomassField, stageId: StageId, landmarks: Vec2[], view: WorldView, hoverPx?: { x: number; y: number; radius: number; tool: string }, nightFactor = 0): void {
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

    const scale = side / view.worldSpan;
    const offX = left - view.worldLeft * scale;
    const offY = top - view.worldTop * scale;

    // 1.5 M21: 地面タイルテクスチャ (アセット未ロードなら何もせず上の
    //     単色グラデーションがそのまま地面として見える = フォールバック)。
    this.drawTerrainTexture(ctx, stageId, scale, offX, offY, left, top, side);
    // 1.6 M21: 木漏れ日のまだら (ワールド座標に固定した明るい斑点)。
    this.drawDappledLight(ctx, view, scale, offX, offY);

    // 2. 場系を焼いて貼る。view (カメラのズーム/パン) に応じて
    //    fieldCanvas (常に世界全体を焼いた1枚) から必要な矩形だけを
    //    切り出して拡大する。zoom=1 のときは全体をそのまま貼るのと同じ。
    const { spritesReady, waterReady } = this.paintFieldLayer(env, bio, stageId);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const fieldScale = this.opts.fieldSize / this.opts.worldSize;
    ctx.drawImage(
      this.fieldCanvas,
      view.worldLeft * fieldScale, view.worldTop * fieldScale,
      view.worldSpan * fieldScale, view.worldSpan * fieldScale,
      left, top, side, side,
    );

    // 2.4 M22: 水場の再設計 (「水色の丸」の代わりに湖岸線のある水域)。
    //     アセット未ロードの間は paintFieldLayer が従来通りの水色を
    //     焼くので、ここでは何も描かない。
    if (waterReady) {
      this.drawWaterBodies(ctx, env, stageId, scale, offX, offY);
    }

    // 2.5 M21: 岩場のスプライト化 (ぼかし塊の代わりに rock-cluster/
    //     small-stone を配置)。アセット未ロードの間は paintFieldLayer が
    //     従来通りの岩色を焼くので、ここでは何も描かない。
    if (spritesReady) {
      this.drawRockSprites(ctx, env, scale, offX, offY);
    }

    // 3. ステージの装飾アイコン (廃墟の柱 / 鍾乳石 / サボテン / 葦)
    this.drawLandmarks(ctx, landmarks, stageId, scale, offX, offY);

    // 4. 脈管網
    this.drawEdges(ctx, state, scale, offX, offY);

    // 5. source / sink
    this.drawNodes(ctx, state, scale, offX, offY);

    // 6. 昼夜のトーン (洞窟は元々暗いので変調しない)
    // M16.5: 旧実装は不透明の暗紺を単純に上塗りしていた (=「暗くする」)。
    // ここでは 'color' 合成 (下地の色相を完全に置き換えてしまい、フルの
    // nightFactor で真っ青に色抜けしてしまうことを screenshot 検証で確認
    // した — 強すぎたため不採用) ではなく、控えめな半透明の青を
    // source-over で重ねるだけにする。フル nightFactor でも元の色相 (苔の
    // 緑・金のプラズマ) が透けて残る程度の弱さに抑え、「暗くする」ではなく
    // 「青みを足す」方向にする。
    if (stageId !== 'cave' && nightFactor > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(35, 55, 100, ${(nightFactor * 0.30).toFixed(3)})`;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.restore();
    }

    // 7. カーソル
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
    const { spritesReady, waterReady } = this.paintFieldLayer(env, bio, stageId);
    tctx.fillStyle = rgb(STAGE_BG[stageId].inner);
    tctx.fillRect(0, 0, size, size);
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(this.fieldCanvas, 0, 0, size, size);
    const scale = size / this.opts.worldSize;
    if (waterReady) this.drawWaterBodies(tctx, env, stageId, scale, 0, 0);
    if (spritesReady) this.drawRockSprites(tctx, env, scale, 0, 0);
    this.drawLandmarks(tctx, landmarks, stageId, scale, 0, 0);
    this.drawEdges(tctx, state, scale, 0, 0);
    this.drawNodes(tctx, state, scale, 0, 0);
    return new Promise((resolve) => {
      thumb.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : ''), 'image/png');
    });
  }

  // 戻り値: 岩スプライト/湖岸線用アセットがロード済みか (呼び出し側が
  // drawRockSprites / drawWaterBodies を呼ぶかどうかの判断に使う)。
  private paintFieldLayer(env: GridEnvironment, bio: BiomassField, stageId: StageId): { spritesReady: boolean; waterReady: boolean } {
    const data = this.fieldImage.data;
    const bioData = bio.field.data;
    const nutData = env.nutrients.data;
    const moiData = env.moisture.data;
    const briData = env.brightness.data;
    const obData = env.obstacle.data;
    const tempData = env.temperature.data;
    const toxData = env.toxin.data;
    const waterData = env.water.data;
    const baseTemp = env.baseTemperature;

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
    // M21: 岩スプライト用アセットが (ロード完了して) 使えるようになった/
    // 使えなくなった瞬間は、既に焼いた岩色の生ピクセルを消すために
    // 全面再計算する (以後は spritesReady のまま変わらないので通常は
    // このチェックのコストはほぼゼロ)。
    const spritesReady = assets.getSprite('rock-cluster', 1) !== null;
    const spritesReadyChanged = this.prevSpritesReady !== spritesReady;
    // M22: 湖岸線描画が使えるようになった/使えなくなった瞬間も同様に
    // 全面再計算する。
    const waterReady = assets.getTexture('water-surface') !== null;
    const waterReadyChanged = this.prevWaterReady !== waterReady;
    const full = !this.tracker.initialized || maxBioJumped || heatChanged || stageChanged || spritesReadyChanged || waterReadyChanged;
    const rockColor = STAGE_ROCK_COLOR[stageId];
    const bgInner = STAGE_BG[stageId].inner;
    // GRAIN_ALPHA を先に掛けておき、ホットループ内では乗算1回で済ませる。
    const bgInnerGA: [number, number, number] = [bgInner[0] * GRAIN_ALPHA, bgInner[1] * GRAIN_ALPHA, bgInner[2] * GRAIN_ALPHA];

    const dirty = this.tracker.update(
      [bioData, nutData, moiData, briData, obData, tempData, toxData, waterData],
      full,
      (i) => {
        const di = i * 4;
        // M16.5: 地形テクスチャ用に整数座標を復元する (苔粒/岩まだら/水面の
        // 揺らぎはどれもこの座標だけから決まる安いノイズで足りる)。
        const x = i % this.opts.fieldSize;
        const y = (i / this.opts.fieldSize) | 0;

        // 地形の質感 (常時, 控えめ): ヒート表示 OFF でもバイオームの違いが
        // 見えるように、baseline (湿度 0.3 / 明るさ 0.2) からの差分だけを
        // 弱く乗せる。強い版はヒート表示 ON のときの下のブロックが担う。
        const moiBase = moiData[i] ?? 0;
        const briBase = briData[i] ?? 0;
        const moiDelta = moiBase - 0.3;
        const nut = nutData[i] ?? 0;
        const ob = obData[i] ?? 0;
        const wb = waterData[i] ?? 0;
        const tox = toxData[i] ?? 0;
        const v = (bioData[i] ?? 0) / maxBio;

        // M16.5: 苔の粒ノイズ (地形の露出底上げ)。他のどの層にも該当しない
        // 「素の地面」がただの平坦色にならないよう、STAGE_BG を基準にした
        // ごく弱い明度のまだらを最初に敷く (旧配色は STAGE_BG がほぼ黒
        // だったため、これが無いと画面の大半が均一な虚無に見えていた)。
        // 上の他レイヤーがどれも該当しない「本当に素の地面」のときだけ
        // 計算する — dirty なセル全件を通るホットループなので、生育が
        // 活発で大半のセルが biomass/エサ等で埋まっているフレームでは
        // 無駄な hashNoise 呼び出しを避ける。r/g/b は常に 0 から始まるので
        // blend() (配列アロケーションを伴う) ではなく乗算だけで済ませる。
        let r = 0, g = 0, b = 0, a = 0;
        const bare = moiDelta <= 0.06 && moiDelta >= -0.04 && nut <= 0.05 && ob <= 0.5 && wb <= 0.5 && tox <= 0.04 && v <= 0.025;
        if (bare) {
          const grainShade = 1 + (hashNoise(x, y) - 0.5) * 0.16;
          r = bgInnerGA[0] * grainShade;
          g = bgInnerGA[1] * grainShade;
          b = bgInnerGA[2] * grainShade;
          a = GRAIN_ALPHA;
        }

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
          // M10: 温度 (baseTemperature からの乖離を暑い=赤橙/寒い=藍青で示す)
          const tempDelta = (tempData[i] ?? baseTemp) - baseTemp;
          if (tempDelta > 0.05) {
            const k = Math.min(1, (tempDelta - 0.05) * 1.6);
            [r, g, b] = blend(r, g, b, HEAT_HOT[0], HEAT_HOT[1], HEAT_HOT[2], k * 0.3);
            a = Math.max(a, k * 0.3);
          } else if (tempDelta < -0.05) {
            const k = Math.min(1, (-tempDelta - 0.05) * 1.6);
            [r, g, b] = blend(r, g, b, HEAT_COLD[0], HEAT_COLD[1], HEAT_COLD[2], k * 0.3);
            a = Math.max(a, k * 0.3);
          }
        }

        // 障害物 — ステージごとの石材色 (洞窟は青灰、砂漠は赤茶、都市跡は風化ベージュ)。
        // M16.5: 単色のぼかし塊だと質感が無いため、まだら (陰影) ノイズを
        // 明度に乗せて「陰影とエッジのある岩」に近づける。
        // M21: 岩スプライトが使えるときは、ここでの塗りつぶしをやめて
        // drawRockSprites (スクリーン解像度) に描画を譲る。ぼかし塊の
        // 上にスプライトを重ねると輪郭からはみ出た旧ぼかしが透けて
        // 見えてしまうため。
        if (ob > 0.5 && !spritesReady) {
          const shade = 0.72 + hashNoise(x + 5000, y + 5000) * 0.55;
          [r, g, b] = blend(
            r, g, b,
            Math.min(255, rockColor[0] * shade), Math.min(255, rockColor[1] * shade), Math.min(255, rockColor[2] * shade),
            0.9,
          );
          a = Math.max(a, 0.9);
        }

        // M14: 水域 (大陸ステージ) — obstacle と同じ形に立つが、石ではなく
        // 水と分かるよう青で上書きする (通行不能な地形という点は obstacle と共通)。
        // M16.5: 深みのグラデーション (揺らぎノイズで深浅を表現) + 縁の明るい
        // ライン (境界付近の値だけ明るい水色にする) を足す。
        // M22: 湖岸線描画 (drawWaterBodies) が使えるときは、ここでの
        // 「水色の丸」塗りつぶしをやめて岸線ベースの描画に譲る。
        if (wb > 0.5 && !waterReady) {
          const depth = Math.min(1, (wb - 0.5) * 2.2); // 境界付近ほど浅い (0) 、内側ほど深い (1)
          const ripple = hashNoise(x - 3000, y - 3000) * 0.3;
          const t = Math.min(1, depth + ripple * 0.3);
          let wr = WATER_BODY_SHALLOW[0] * (1 - t) + WATER_BODY_DEEP[0] * t;
          let wg = WATER_BODY_SHALLOW[1] * (1 - t) + WATER_BODY_DEEP[1] * t;
          let wbCol = WATER_BODY_SHALLOW[2] * (1 - t) + WATER_BODY_DEEP[2] * t;
          if (wb < 0.62) {
            // 縁: 明るいラインとして強調する
            const edgeT = 1 - (wb - 0.5) / 0.12;
            wr = wr * (1 - edgeT) + WATER_EDGE_COLOR[0] * edgeT;
            wg = wg * (1 - edgeT) + WATER_EDGE_COLOR[1] * edgeT;
            wbCol = wbCol * (1 - edgeT) + WATER_EDGE_COLOR[2] * edgeT;
          }
          [r, g, b] = blend(r, g, b, wr, wg, wbCol, 0.88);
          a = Math.max(a, 0.88);
        }

        // M10: 毒素 — 常時薄紫で見せる (obstacle と違い通れるが、避けたくなる目印)
        if (tox > 0.04) {
          const k = Math.min(1, tox * 1.1);
          const fa = 0.14 + k * 0.42;
          [r, g, b] = blend(r, g, b, TOXIN_COLOR[0], TOXIN_COLOR[1], TOXIN_COLOR[2], fa);
          a = Math.max(a, fa);
        }

        // M16.5: Biomass 膜のリム発光。v (=raw/maxBio) は「生まれたて (低)
        // → 成長前線 (中) → 確立した核 (高)」の順に大きくなる sim の性質を
        // そのまま使い、旧実装の「中心ほど明るく不透明」を反転する:
        // 成長前線 (中間の v) を最も明るい金でリム発光させ、確立した核
        // (高い v) はアルファを絞って下の地形が透けるようにする。
        if (v > 0.025) {
          const k = Math.pow(Math.min(1, v), 0.55);
          // リムのピーク (成長前線) を k≈0.32 付近に置いたガウス状の山。
          const rim = Math.exp(-Math.pow((k - 0.32) / 0.26, 2));
          let pr: number, pg: number, pb: number;
          if (k < 0.32) {
            const t = k / 0.32;
            pr = PLASMA_FRINGE[0] * (1 - t) + PLASMA_RIM[0] * t;
            pg = PLASMA_FRINGE[1] * (1 - t) + PLASMA_RIM[1] * t;
            pb = PLASMA_FRINGE[2] * (1 - t) + PLASMA_RIM[2] * t;
          } else {
            const t = Math.min(1, (k - 0.32) / 0.68);
            pr = PLASMA_RIM[0] * (1 - t) + PLASMA_CORE[0] * t;
            pg = PLASMA_RIM[1] * (1 - t) + PLASMA_CORE[1] * t;
            pb = PLASMA_RIM[2] * (1 - t) + PLASMA_CORE[2] * t;
          }
          // アルファ: リム (前線) が最も濃く、核に近づくほど下地が透けるよう絞る。
          const pa = Math.min(0.88, 0.10 + rim * 0.62 + k * 0.16);
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
    this.prevSpritesReady = spritesReady;
    this.prevWaterReady = waterReady;
    return { spritesReady, waterReady };
  }

  // M21: ステージごとの地面タイルテクスチャをスクリーン解像度のまま
  // createPattern で敷き込む。96×96 の fieldCanvas とは独立にズーム/パンの
  // カメラ変換だけをパターンの変換行列に反映するので、ズームしてもテクスチャ
  // の実解像度が保たれる (G3 の解消条件)。アセット未ロードなら何もせず、
  // 呼び出し側で既に描いた STAGE_BG のグラデーションがそのまま地面になる。
  private drawTerrainTexture(ctx: CanvasRenderingContext2D, stageId: StageId, scale: number, offX: number, offY: number, left: number, top: number, side: number): void {
    const name = TILE_TEXTURE_BY_STAGE[stageId];
    const img = assets.getTexture(name);
    if (!img || img.naturalWidth === 0) return;

    let pattern = this.patternCache.get(name);
    if (!pattern) {
      const created = ctx.createPattern(img, 'repeat');
      if (!created) return;
      pattern = created;
      this.patternCache.set(name, pattern);
    }
    const tilePx = TILE_WORLD_SIZE * scale;
    const s = tilePx / img.naturalWidth;
    if (typeof DOMMatrix !== 'undefined' && pattern.setTransform) {
      pattern.setTransform(new DOMMatrix().translate(offX, offY).scale(s, s));
    }
    ctx.save();
    ctx.fillStyle = pattern;
    ctx.fillRect(left, top, side, side);
    ctx.restore();
  }

  // M21: 「中央がやや明るいラジアルグラデーション1枚」だった光をやめ、
  // ワールド座標に固定したまばらな明るい斑点 (木漏れ日) を敷く。カメラの
  // 表示範囲だけを走査するので、ズーム/パンしても斑点の実寸 (=世界座標の
  // 大きさ) は変わらない。
  private drawDappledLight(ctx: CanvasRenderingContext2D, view: WorldView, scale: number, offX: number, offY: number): void {
    const cell = DAPPLE_CELL_WORLD;
    const x0 = Math.floor(view.worldLeft / cell) - 1;
    const x1 = Math.ceil((view.worldLeft + view.worldSpan) / cell) + 1;
    const y0 = Math.floor(view.worldTop / cell) - 1;
    const y1 = Math.ceil((view.worldTop + view.worldSpan) / cell) + 1;
    const cellPx = cell * scale;
    ctx.save();
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const n = hashNoise(gx, gy);
        if (n < DAPPLE_THRESHOLD) continue;
        const alpha = (n - DAPPLE_THRESHOLD) * (DAPPLE_MAX_ALPHA / (1 - DAPPLE_THRESHOLD));
        ctx.fillStyle = `rgba(255, 240, 200, ${alpha.toFixed(3)})`;
        ctx.fillRect(offX + gx * cellPx, offY + gy * cellPx, cellPx + 1, cellPx + 1);
      }
    }
    ctx.restore();
  }

  // M21: 障害物フィールドの連結成分ごとに rock-cluster / small-stone
  // スプライトを配置する。接地影 (AO) と輪郭の淡い明暗エッジで「陰影と
  // エッジのある岩」を表現する (旧: 96×96 のぼかし色塊)。
  private drawRockSprites(ctx: CanvasRenderingContext2D, env: GridEnvironment, scale: number, offX: number, offY: number): void {
    // M14 の placeWaterBody は water と obstacle に同じ形を重ね書きするため、
    // 生の obstacle をそのまま使うと湖の上にも岩スプライトが乗って水域を
    // 隠してしまう。水域 (M22 の drawWaterBodies が別途担当) の分は除外する。
    const obData = env.obstacle.data;
    const waterData = env.water.data;
    const rockOnly = new Float32Array(obData.length);
    for (let i = 0; i < obData.length; i++) {
      const ob = obData[i] ?? 0;
      rockOnly[i] = ob > 0.5 && (waterData[i] ?? 0) <= 0.5 ? ob : 0;
    }
    const blobs = extractTerrainBlobs(rockOnly, this.opts.fieldSize, this.opts.worldSize);
    for (const blob of blobs) {
      const family = blob.cellCount <= SMALL_BLOB_MAX_CELLS ? 'small-stone' : 'rock-cluster';
      const count = SPRITE_FAMILIES[family] ?? 1;
      const idx = 1 + Math.min(count - 1, Math.floor(hashNoise(Math.round(blob.cx * 13), Math.round(blob.cy * 13)) * count));
      const sprite = assets.getSprite(family, idx);
      if (!sprite) continue;

      const cx = offX + blob.cx * scale;
      const cy = offY + blob.cy * scale;
      const sizePx = blob.radiusWorld * ROCK_SPRITE_SCALE * scale;
      const rot = hashNoise(Math.round(blob.cx * 7), Math.round(blob.cy * 7)) * Math.PI * 2;

      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + sizePx * 0.26, sizePx * 0.46, sizePx * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 245, 220, 0.22)';
      ctx.lineWidth = Math.max(0.6, sizePx * 0.02);
      ctx.beginPath();
      ctx.ellipse(cx, cy, sizePx * 0.42, sizePx * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.drawImage(sprite, -sizePx / 2, -sizePx / 2, sizePx, sizePx);
      ctx.restore();
    }
  }

  // M22: 「水色の丸」の代わりに湖岸線 (marching squares) ベースの水域を描く。
  // 内側を water-surface パターンで塗り、岸に沿って浅瀬 (内側) / 湿った砂
  // (外側) の帯を重ねる。wetland/continent は岸線上に葦も散らす。
  private drawWaterBodies(ctx: CanvasRenderingContext2D, env: GridEnvironment, stageId: StageId, scale: number, offX: number, offY: number): void {
    const { loops } = extractCoastline(env.water.data, this.opts.fieldSize, this.opts.worldSize);
    if (loops.length === 0) return;

    const img = assets.getTexture('water-surface');

    for (const loop of loops) {
      if (loop.length < 3) continue;
      const path = new Path2D();
      const p0 = loop[0]!;
      path.moveTo(offX + p0.x * scale, offY + p0.y * scale);
      for (let i = 1; i < loop.length; i++) {
        const p = loop[i]!;
        path.lineTo(offX + p.x * scale, offY + p.y * scale);
      }
      path.closePath();

      // 水面の塗り: パターンがあれば貼る (ゆっくり平行移動)、無ければ
      // 深い水色の単色フォールバック (アセット未ロードの一時的な状態)。
      ctx.save();
      ctx.clip(path);
      if (img && img.naturalWidth > 0) {
        let pattern = this.patternCache.get('water-surface');
        if (!pattern) {
          const created = ctx.createPattern(img, 'repeat');
          if (created) {
            pattern = created;
            this.patternCache.set('water-surface', pattern);
          }
        }
        if (pattern) {
          const tilePx = WATER_TILE_WORLD_SIZE * scale;
          const s = tilePx / img.naturalWidth;
          const drift = this.reducedMotion ? 0 : ((performance.now() - this.startTime) * WATER_DRIFT_SPEED) % WATER_TILE_WORLD_SIZE;
          if (typeof DOMMatrix !== 'undefined' && pattern.setTransform) {
            pattern.setTransform(new DOMMatrix().translate(offX + drift * scale, offY).scale(s, s));
          }
          ctx.fillStyle = pattern;
        } else {
          ctx.fillStyle = rgb(WATER_BODY_DEEP);
        }
      } else {
        ctx.fillStyle = rgb(WATER_BODY_DEEP);
      }
      ctx.fill(path);
      // M22: 現物のテクスチャ (プレースホルダ品質、CREDITS.md 参照) は
      // 実測でかなり暗く、地形の陰と紛れて「水域」と読み取りにくい。
      // パターンの質感を保ったまま、常に最低限の深い水色を保証する
      // 半透明の色かぶせを重ねる (テクスチャ有無に関わらず判別できるように)。
      ctx.fillStyle = `rgba(${WATER_BODY_DEEP[0]}, ${WATER_BODY_DEEP[1]}, ${WATER_BODY_DEEP[2]}, 0.45)`;
      ctx.fill(path);
      ctx.restore();

      // 岸の帯: 内側 (浅瀬) は塗りつぶし内でクリップして重ね、外側
      // (湿った砂) はクリップせずに岸線の外側へはみ出させる。
      const bandPx = Math.max(1, SHORE_BAND_WORLD * scale);
      ctx.save();
      ctx.clip(path);
      ctx.strokeStyle = SHORE_SHALLOW_COLOR;
      ctx.lineWidth = bandPx * 2;
      ctx.stroke(path);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = SHORE_WET_SAND_COLOR;
      ctx.lineWidth = bandPx * 1.4;
      ctx.stroke(path);
      ctx.restore();

      if (stageId === 'wetland' || stageId === 'continent') {
        this.drawShoreReeds(ctx, loop, scale, offX, offY);
      }
    }
  }

  // M22: 岸線上に一定間隔で葦を散らす (旧: ランドマーク座標のみ → 岸線サンプリング)。
  private drawShoreReeds(ctx: CanvasRenderingContext2D, loop: { x: number; y: number }[], scale: number, offX: number, offY: number): void {
    let acc = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      acc += segLen;
      if (acc >= REED_SPACING_WORLD) {
        acc = 0;
        // このセグメント終端 (岸線上の決定的な点) に葦を1本描く。
        if (hashNoise(Math.round(a.x * 4), Math.round(a.y * 4)) < 0.6) {
          this.drawReeds(ctx, offX + a.x * scale, offY + a.y * scale, scale * 0.5);
        }
      }
    }
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
    // M16.5: 発光表現の性能ガード。エッジ総数が多い (=ズームアウトして
    // 広い範囲の管が一度に見えている) ときは glow パスの追加コストが
    // 積み上がるため、そのフレームだけ glow を省略し芯線のみ描く
    // (「金色に光る」自体はどのズームでも芯線の色で保たれる)。
    const glowEnabled = state.edges.length <= GLOW_MAX_EDGES;

    // バケツ (太さの昇順) ごとに、見た目 (色/太さ) が近いエッジを1本の
    // Path2D にまとめてから stroke() する。flux は毎tick変わるので
    // グルーピング自体は毎フレーム作り直すが、E 回の stroke() 呼び出しを
    // バケツ内のスタイル種類数まで減らせる。
    const styleGroups = new Map<string, { path: Path2D; color: string; lineWidth: number; glowColor: string; glowWidth: number }>();
    for (const bucket of buckets) {
      if (bucket.length === 0) continue;
      styleGroups.clear();
      for (const e of bucket) {
        const a = nodeMap.get(e.from);
        const b = nodeMap.get(e.to);
        if (!a || !b) continue;
        const fluxN = Math.min(1, e.flux / 5);
        const tubeW = Math.max(0.7, e.radius * 1.05 + fluxN * 1.4) * pxPerWorld;
        // activity (flux) が高いほど明るく発光させる (ROADMAP.md M16.5)。
        const t = Math.min(1, fluxN * 0.65 + Math.min(1, e.radius / 2) * 0.55);
        const toneStep = Math.round(t * TONE_STEPS);
        const lineWidth = Math.max(0.6, tubeW * 0.55);
        const widthStep = Math.round(lineWidth / WIDTH_QUANT);
        const key = `${toneStep}_${widthStep}`;
        let group = styleGroups.get(key);
        if (!group) {
          // 細い枝はクリーム金で軽やか、太く流量多い管は濃い金で濃く。
          const tt = toneStep / TONE_STEPS;
          const rr = Math.round(TUBE_LIGHT[0] * (1 - tt) + TUBE_DARK[0] * tt);
          const gg = Math.round(TUBE_LIGHT[1] * (1 - tt) + TUBE_DARK[1] * tt);
          const bb = Math.round(TUBE_LIGHT[2] * (1 - tt) + TUBE_DARK[2] * tt);
          const w = Math.max(0.6, widthStep * WIDTH_QUANT);
          group = {
            path: new Path2D(),
            color: `rgba(${rr}, ${gg}, ${bb}, ${0.78 + tt * 0.18})`,
            lineWidth: w,
            // 太いぼかし下層 (lighter 合成)。activity が高いほど広く明るく光る。
            glowColor: `rgba(${TUBE_GLOW[0]}, ${TUBE_GLOW[1]}, ${TUBE_GLOW[2]}, ${(0.10 + tt * 0.22).toFixed(3)})`,
            glowWidth: w * (2.4 + tt * 1.6),
          };
          styleGroups.set(key, group);
        }
        group.path.moveTo(offX + a.pos.x * scale, offY + a.pos.y * scale);
        group.path.lineTo(offX + b.pos.x * scale, offY + b.pos.y * scale);
      }
      if (glowEnabled) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const group of styleGroups.values()) {
          ctx.strokeStyle = group.glowColor;
          ctx.lineWidth = group.glowWidth;
          ctx.stroke(group.path);
        }
        ctx.restore();
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
        case 'continent': this.drawReeds(ctx, x, y, scale); break; // 大陸の水辺も葦で表現
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
    case 'drain': return 'rgba(216, 190, 130, 0.9)';
    case 'stone': return 'rgba(180, 180, 190, 0.9)';
    case 'heat': return 'rgba(235, 130, 70, 0.9)';
    case 'cool': return 'rgba(120, 190, 235, 0.9)';
    case 'toxin': return 'rgba(180, 130, 220, 0.9)';
    case 'erase': return 'rgba(240, 120, 120, 0.9)';
    default: return 'rgba(255,255,255,0.8)';
  }
}
