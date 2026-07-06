// M20: テクスチャ/スプライトの遅延ロード。
//
// `docs/asset-briefs.md` の発注ブリーフに沿って `public/textures/` に
// 配置された画像を読み込む。読み込み中・失敗時・そもそもファイルが
// 存在しない場合はすべて `null` を返し、呼び出し側 (render.ts / minimap.ts)
// は既存の手続き描画 (単色+ノイズ+ベクタ図形) へフォールバックする。
// これにより「アセットは任意」の方針 (ROADMAP.md アーキテクチャ方針) を守る。

export const TILE_TEXTURES = [
  'moss-ground',
  'rock-face',
  'sand-dry',
  'stone-ruins',
  'cave-floor',
  'water-surface',
] as const;
export type TileTextureName = (typeof TILE_TEXTURES)[number];

// スプライト系統: 1-indexed のバリエーションが複数あるもの。
export const SPRITE_FAMILIES: Record<string, number> = {
  'rock-cluster': 4,
  'mushroom-red': 2,
  'moss-clump': 3,
  // 発注ブリーフには無いが、切り出し時のボーナス素材として同梱されている
  // (CREDITS.md 参照)。M21 で小さい障害物の飛び地に使う。
  'small-stone': 6,
};

// バリエーションを持たない単発スプライト。
export const SPRITE_SINGLES = ['food-orb-orange', 'food-orb-green', 'driftwood'] as const;
export type SpriteSingleName = (typeof SPRITE_SINGLES)[number];

export function textureFileName(name: string): string {
  return `${name}.png`;
}

export function spriteFamilyFileName(family: string, index: number): string {
  return `${family}-${index}.png`;
}

export function spriteSingleFileName(name: string): string {
  return `${name}.png`;
}

export type ImageLoader = (path: string) => Promise<HTMLImageElement>;

function defaultLoader(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`asset load failed: ${path}`));
    img.src = path;
  });
}

type CacheEntry = 'loading' | 'failed' | HTMLImageElement;

function isImage(entry: CacheEntry | undefined): entry is HTMLImageElement {
  return entry !== undefined && entry !== 'loading' && entry !== 'failed';
}

/** テクスチャ/スプライトの遅延ロード + キャッシュ。DOM に依存するのは `loader` だけなので、
 * テストでは `loader` を差し替えて `Image` 無しに挙動を検証できる。 */
export class AssetManager {
  private cache = new Map<string, CacheEntry>();
  private pending = new Map<string, Promise<void>>();

  constructor(
    private basePath: string = 'textures/',
    private loader: ImageLoader = defaultLoader,
  ) {}

  private request(key: string, file: string): Promise<void> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    if (this.cache.has(key)) return Promise.resolve();
    this.cache.set(key, 'loading');
    const job = this.loader(`${this.basePath}${file}`).then(
      (image) => {
        this.cache.set(key, image);
      },
      () => {
        this.cache.set(key, 'failed');
      },
    );
    this.pending.set(key, job);
    return job;
  }

  /** 未ロードなら裏でロードを開始しつつ即 `null` を返す (呼び出し側は同フレームでフォールバック描画する)。 */
  getTexture(name: TileTextureName | string): HTMLImageElement | null {
    const key = `tile:${name}`;
    this.request(key, textureFileName(name));
    const entry = this.cache.get(key);
    return isImage(entry) ? entry : null;
  }

  getSprite(family: string, index: number): HTMLImageElement | null {
    const key = `sprite:${family}:${index}`;
    this.request(key, spriteFamilyFileName(family, index));
    const entry = this.cache.get(key);
    return isImage(entry) ? entry : null;
  }

  getSpriteSingle(name: SpriteSingleName | string): HTMLImageElement | null {
    const key = `single:${name}`;
    this.request(key, spriteSingleFileName(name));
    const entry = this.cache.get(key);
    return isImage(entry) ? entry : null;
  }

  /** 起動時にまとめて先読みしたい場合に使う。失敗したアセットがあっても reject しない
   * (1枚欠けていても他は使えるように、フォールバックは各 get*() 呼び出し側の責務)。 */
  async preloadAll(): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const name of TILE_TEXTURES) jobs.push(this.request(`tile:${name}`, textureFileName(name)));
    for (const [family, count] of Object.entries(SPRITE_FAMILIES)) {
      for (let i = 1; i <= count; i++) {
        jobs.push(this.request(`sprite:${family}:${i}`, spriteFamilyFileName(family, i)));
      }
    }
    for (const name of SPRITE_SINGLES) {
      jobs.push(this.request(`single:${name}`, spriteSingleFileName(name)));
    }
    await Promise.allSettled(jobs);
  }

  /** テスト/デバッグ用: 全キャッシュを破棄する。 */
  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }
}

// GitHub Pages はサブパス配信 (vite.config.ts の BASE) なので、public/ 直下の
// 実ファイルへのパスは BASE_URL からの相対で解決する。
export const assets = new AssetManager(`${import.meta.env.BASE_URL}textures/`);
