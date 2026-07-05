// M17: 出来事の構造化。
//
// 旧 `recentEvents: string[]` (game.ts) は「Day n — text」という定型文字列
// でしか出来事を持たなかったため、モックアップ②が示す「12:15 栄養を発見」
// (時刻表示) や「このエリアを注視中」(座標フィルタ) が実装できなかった。
// WorldEvent は座標 (発生ノードがあるものだけ) と tick を持ち、時刻表示・
// エリアフィルタの両方を web 側の派生 (localTimeFor / camera 視野) として
// 導出できるようにする。sim には一切手を入れない (SimEvent の型は不変)。

export interface WorldEvent {
  readonly id: number;
  readonly day: number;
  readonly tick: number;
  readonly kind: string;
  readonly text: string;
  readonly x?: number;
  readonly y?: number;
}

// 出来事の回転バッファ。古いものから捨てる (unshift + 末尾 pop)。
// `id` は単調増加なので、呼び出し側は「最新の id が変わったか」で
// 再描画が必要かを判定できる (`length` だけで見ると、上限に達した後は
// push しても length が変化せず更新を見逃す)。
export class WorldEventLog {
  private list: WorldEvent[] = [];
  private nextId = 0;

  constructor(private readonly maxEntries: number) {}

  push(e: Omit<WorldEvent, 'id'>): void {
    this.list.unshift({ id: this.nextId++, ...e });
    if (this.list.length > this.maxEntries) this.list.pop();
  }

  all(): readonly WorldEvent[] {
    return this.list;
  }

  get latestId(): number {
    return this.list[0]?.id ?? -1;
  }

  reset(): void {
    this.list = [];
    this.nextId = 0;
  }
}

// M17: 「このエリアを注視中」。座標を持つ出来事だけを、指定した矩形
// (カメラの現在の視野) との交差で絞り込む。座標を持たない出来事 (時代の
// 節目など) は常に通す — エリアの外で起きた/起きていないの概念がないため。
// camera.ts の WorldView と同じ形 (worldLeft/worldTop/worldSpan) を type-only
// import で使う (実行時の依存は持ち込まない — camera.ts 側もこちらに依存しない)。
export function filterByArea(
  events: readonly WorldEvent[],
  view: { worldLeft: number; worldTop: number; worldSpan: number },
): WorldEvent[] {
  const right = view.worldLeft + view.worldSpan;
  const bottom = view.worldTop + view.worldSpan;
  return events.filter((e) => {
    if (e.x === undefined || e.y === undefined) return true;
    return e.x >= view.worldLeft && e.x <= right && e.y >= view.worldTop && e.y <= bottom;
  });
}
