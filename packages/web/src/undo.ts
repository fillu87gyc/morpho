// M10: 「やり直す」(Undo)。
//
// sim の時間は巻き戻さない (決定論と Worker 分離を壊すため)。
// 環境フィールドへのスタンプだけを stroke 単位 (pointerdown〜up) で取り消す。
// stroke 開始時に「これから変更されるセル」の before 値を記録しておき、
// undo() で逆適用する。DOM/Worker に依存しない純粋なロジックとして
// 切り出し、vitest で直接テストする。

export interface FieldLike {
  size: number;
  data: Float32Array;
}

interface RecordedStamp {
  field: FieldLike;
  x0: number; y0: number; x1: number; y1: number;
  before: Float32Array;
}

export class UndoStack {
  private strokes: RecordedStamp[][] = [];
  private current: RecordedStamp[] | null = null;

  constructor(private readonly maxDepth = 10) {}

  get canUndo(): boolean { return this.strokes.length > 0; }
  /** 現在のスタック深さ (テスト・デバッグ用)。 */
  get depth(): number { return this.strokes.length; }

  beginStroke(): void { this.current = []; }

  // stroke に何も記録されていなければ (クリックしただけでツールが何も
  // 変えなかった等) 空スタックを積まない。
  endStroke(): void {
    if (this.current && this.current.length > 0) {
      this.strokes.push(this.current);
      while (this.strokes.length > this.maxDepth) this.strokes.shift();
    }
    this.current = null;
  }

  // margin: この場所へのスタンプが影響しうる半幅 (field-index 単位)。
  // 呼び出し側のスタンプ関数が実際に触れる範囲と厳密に一致していなくても、
  // 広めに取る分には安全 (余分に記録したセルは undo 時に「同じ値へ戻す」
  // だけの no-op になる)。
  recordBefore(field: FieldLike, cx: number, cy: number, margin: number): void {
    if (!this.current) return;
    const s = field.size;
    const x0 = Math.max(0, Math.floor(cx - margin));
    const x1 = Math.min(s - 1, Math.ceil(cx + margin));
    const y0 = Math.max(0, Math.floor(cy - margin));
    const y1 = Math.min(s - 1, Math.ceil(cy + margin));
    if (x1 < x0 || y1 < y0) return;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const before = new Float32Array(w * h);
    let k = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) before[k++] = field.data[y * s + x] ?? 0;
    }
    this.current.push({ field, x0, y0, x1, y1, before });
  }

  // 直近の stroke を1つ取り消す。stroke 内に複数スタンプがあれば、
  // 記録と逆順 (LIFO) に適用することで正しく巻き戻せる — 各スタンプの
  // before 値は「そのスタンプの直前」の状態であり、後のスタンプから
  // 順に戻すことで、重なった領域でも正しく元の状態が積み上がる。
  undo(): void {
    const stroke = this.strokes.pop();
    if (!stroke) return;
    for (let i = stroke.length - 1; i >= 0; i--) {
      const r = stroke[i]!;
      const s = r.field.size;
      let k = 0;
      for (let y = r.y0; y <= r.y1; y++) {
        for (let x = r.x0; x <= r.x1; x++) r.field.data[y * s + x] = r.before[k++]!;
      }
    }
  }
}
