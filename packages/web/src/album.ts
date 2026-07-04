// M7: スクリーンショット保存 (album)。
//
// 画面に見えている絵をそのまま PNG として撮り、端末内 (IndexedDB) に
// 溜めておくアルバム。localStorage は容量が小さく (~5MB) 画像の保存には
// 向かないため、こちらは IndexedDB を使う。図鑑・記録などと同じく
// 「web 側だけで完結する永続化」(sim には持ち込まない) 方針に従う。
//
// IndexedDB は非同期 API だが、UI 側 (ui.ts) は他のトラッカー同様
// 同期の list()/version を読むだけで済むようにしたい。そのため
// コンストラクタで一度読み込み、以後はメモリ上のキャッシュを
// 正として扱う (add/remove は先にキャッシュを更新してから非同期で
// IndexedDB へ反映する)。

export interface AlbumShot {
  id: number;
  day: number;
  stageName: string;
  takenAt: string; // ISO 日時
  blob: Blob;
  url: string; // createObjectURL — 解放は Album が管理する
}

const DB_NAME = 'morpho-album';
const STORE = 'shots';
const MAX_SHOTS = 60; // 増えすぎたら古いものから間引く (端末のストレージを圧迫しないため)

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class Album {
  private shots: AlbumShot[] = [];
  private db: Promise<IDBDatabase> | null = null;
  // list() の呼び出し側が「前回描画から変わったか」を安く判定するためのカウンタ。
  version = 0;
  // 初回読み込みが終わったかどうか (完了前に list() を呼んでも空配列を返す)。
  private ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const db = await this.open();
      const all = await new Promise<{ id: number; day: number; stageName: string; takenAt: string; blob: Blob }[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      this.shots = all
        .sort((a, b) => a.id - b.id)
        .map((r) => ({ ...r, url: URL.createObjectURL(r.blob) }));
      this.version++;
    } catch {
      // IndexedDB が使えない環境 (private mode 等) では諦める。空のアルバムのまま続行。
    }
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  // 撮影。blob は呼び出し側 (main.ts) が canvas.toBlob() で作る。
  async add(blob: Blob, meta: { day: number; stageName: string }): Promise<void> {
    await this.ready;
    const takenAt = new Date().toISOString();
    try {
      const db = await this.open();
      const id = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const req = tx.objectStore(STORE).add({ day: meta.day, stageName: meta.stageName, takenAt, blob });
        req.onsuccess = () => resolve(req.result as number);
        req.onerror = () => reject(req.error);
      });
      this.shots.push({ id, day: meta.day, stageName: meta.stageName, takenAt, blob, url: URL.createObjectURL(blob) });
      this.version++;
      await this.trim(db);
    } catch {
      // 保存に失敗しても撮影自体は諦めるだけ (アプリを止めない)。
    }
  }

  private async trim(db: IDBDatabase): Promise<void> {
    while (this.shots.length > MAX_SHOTS) {
      const oldest = this.shots.shift();
      if (!oldest) break;
      URL.revokeObjectURL(oldest.url);
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(oldest.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    this.version++;
  }

  async remove(id: number): Promise<void> {
    const idx = this.shots.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const [removed] = this.shots.splice(idx, 1);
    if (removed) URL.revokeObjectURL(removed.url);
    this.version++;
    try {
      const db = await this.open();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // 一覧からは既に消えているので UI 上は問題ない。
    }
  }

  list(): readonly AlbumShot[] { return this.shots; }
}
