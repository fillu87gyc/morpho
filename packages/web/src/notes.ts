// M18: メモ。Day 付きの自由テキストメモ。追加/削除のみ (編集なしの割り切り)。
// scoreboard.ts / dailies.ts と同じパターンで localStorage に永続化する。

export interface Note {
  id: string;
  day: number;
  text: string;
  createdAt: string; // ISO
}

const STORAGE_KEY = 'morpho.notes.v1';
const MAX_NOTES = 100;

export class Notes {
  private notes: Note[] = this.load();
  version = 0;

  private load(): Note[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as Note[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.notes));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): readonly Note[] {
    return this.notes;
  }

  add(day: number, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.notes.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, day, text: trimmed, createdAt: new Date().toISOString() });
    while (this.notes.length > MAX_NOTES) this.notes.pop();
    this.version++;
    this.save();
  }

  remove(id: string): void {
    const before = this.notes.length;
    this.notes = this.notes.filter((n) => n.id !== id);
    if (this.notes.length !== before) {
      this.version++;
      this.save();
    }
  }
}

// 「今日の成長を貼る」ボタン用の定型文。DayReport から呼び出し側が
// DayRecord を渡す (このモジュールは day-report.ts に依存しない)。
export function summaryText(day: number, exploration: number, efficiency: number, stability: number, massKg: number): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `Day ${day}: 探索性${pct(exploration)} / 効率性${pct(efficiency)} / 安定性${pct(stability)} / 質量${massKg.toFixed(2)}kg`;
}
