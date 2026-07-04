// M13: 図鑑グリッドのサムネイル保存。album.ts と同じ理由 (localStorage は
// 画像保存に向かない) で IndexedDB を使うが、こちらは「カタログ ID をキーに
// 1枚だけ上書き保存する」store なので album.ts より単純 (autoIncrement 不要)。

const DB_NAME = 'morpho-catalogue-thumbs';
const STORE = 'thumbs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class CatalogueThumbs {
  private urls = new Map<string, string>();
  private db: Promise<IDBDatabase> | null = null;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const db = await this.open();
      const all = await new Promise<{ id: string; blob: Blob }[]>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (const r of all) this.urls.set(r.id, URL.createObjectURL(r.blob));
    } catch {
      // IndexedDB が使えない環境では諦める (サムネなしで続行)。
    }
  }

  private open(): Promise<IDBDatabase> {
    if (!this.db) this.db = openDb();
    return this.db;
  }

  async whenReady(): Promise<void> { return this.ready; }

  urlOf(id: string): string | undefined { return this.urls.get(id); }

  // 同じ id への保存は上書きする (より良い個体で発見し直したときの更新用)。
  async set(id: string, blob: Blob): Promise<void> {
    await this.ready;
    try {
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ id, blob });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      const prev = this.urls.get(id);
      if (prev) URL.revokeObjectURL(prev);
      this.urls.set(id, URL.createObjectURL(blob));
    } catch {
      // 保存に失敗しても図鑑登録自体は諦めない (サムネなしのまま)。
    }
  }
}
