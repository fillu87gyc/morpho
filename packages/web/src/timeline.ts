// 成長タイムライン: Day 1 / 5 / 10 ... の節目でサムネイルを1枚だけ採る。
// 「今どんな絵か」を描くのは呼び出し側 (renderer.captureThumbnail) の
// 責務にして、ここでは「いつ採るか」の判定と保持だけを持つ。

const MILESTONE_STEP = 5;

export interface TimelineEntry {
  day: number;
  thumb: string; // data URL
}

export class Timeline {
  private entries: TimelineEntry[] = [];
  private captured = new Set<number>();

  reset(): void {
    this.entries = [];
    this.captured.clear();
  }

  maybeCapture(day: number, makeThumb: () => string): void {
    if (!isMilestone(day) || this.captured.has(day)) return;
    this.captured.add(day);
    this.entries.push({ day, thumb: makeThumb() });
  }

  list(): readonly TimelineEntry[] { return this.entries; }
}

function isMilestone(day: number): boolean {
  return day === 1 || (day > 0 && day % MILESTONE_STEP === 0);
}
