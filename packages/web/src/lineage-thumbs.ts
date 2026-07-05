// M18: 系統樹ノードのサムネイル。catalogue-thumbs.ts と同じパターン
// (localStorage は画像保存に向かないため IndexedDB、lineageId → blob で
// 1枚だけ上書き保存)。既存データとの混線を避けるため専用の DB を使う
// (ロードマップ原案は「同じ DB で store を分ける」だったが、2クラスが
// 同じ DB のバージョン管理・upgrade を独立に持つと競合しうるため、
// 名前空間を分けて依存を切った)。
//
// マイグレーション不要: サムネイルが無いノードは既存の文字表示のまま
// 壊れずフォールバックする (lineage.ts 側のデータ構造は無改修)。

const DB_NAME = 'morpho-lineage-thumbs';
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

export class LineageThumbs {
  private urls = new Map<string, string>();
  private db: Promise<IDBDatabase> | null = null;
  private ready: Promise<void>;
  // set() は renderThumbnail→fetch→IndexedDB の複数ホップを経る非同期処理で、
  // harvest() 自体 (同期、lineage.version++) より確実に遅れて完了する。
  // ui.ts の再描画ガードは lineage.version だけを見ていると「サムネイルが
  // 後から届いても、その回のバージョンではもう再描画しない」ため出ない
  // ままになる。version を分けて持ち、ui.ts 側で両方を合成キーにする。
  version = 0;

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
      this.version++;
    } catch {
      // 保存に失敗しても採種自体は諦めない (サムネなしのまま)。
    }
  }
}
