// 成長タイムライン: Day 1 / 5 / 10 ... の節目でサムネイルを1枚だけ採る。
// 「今どんな絵か」を描くのは呼び出し側 (renderer.renderThumbnail) の
// 責務にして、ここでは「いつ採るか」の判定と保持だけを持つ。
//
// M8 P3: renderThumbnail は同期の toDataURL ではなく非同期の toBlob を
// 使うようになったため、makeThumb は Promise<string> (blob URL) を返す。
// 呼び出し側 (main.ts) は結果を待たずに次のフレームへ進んでよい
// (fire-and-forget) が、エンコードが終わった時点で撮影中に reset()
// されていたら、古い世代の結果は捨てて blob URL を解放する。

const MILESTONE_STEP = 5;

export interface TimelineEntry {
  day: number;
  thumb: string; // blob URL (もしくはテスト用の任意の文字列)
}

export class Timeline {
  private entries: TimelineEntry[] = [];
  private captured = new Set<number>();
  private generation = 0;

  reset(): void {
    this.generation++;
    for (const e of this.entries) {
      if (e.thumb.startsWith('blob:')) URL.revokeObjectURL(e.thumb);
    }
    this.entries = [];
    this.captured.clear();
  }

  maybeCapture(day: number, makeThumb: () => Promise<string>): void {
    if (!isMilestone(day) || this.captured.has(day)) return;
    this.captured.add(day);
    const gen = this.generation;
    void makeThumb().then((thumb) => {
      if (gen !== this.generation) {
        // 撮影 (非同期エンコード) の完了より先に reset() された: 古い世代の
        // 結果は今のタイムラインには属さないので破棄する。
        if (thumb.startsWith('blob:')) URL.revokeObjectURL(thumb);
        return;
      }
      this.entries.push({ day, thumb });
    });
  }

  list(): readonly TimelineEntry[] { return this.entries; }
}

function isMilestone(day: number): boolean {
  return day === 1 || (day > 0 && day % MILESTONE_STEP === 0);
}
