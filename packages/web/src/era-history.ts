// M18: 時代の年表。時代が切り替わった節目を localStorage に永続化する。
// 探索レポート (report.ts) の年表と、M19 のセッション設計 (何日で成熟期に
// 届くか) の実測データになる。記録は早く始めるほど価値があるため、
// M18 の他項目に先立って単独で導入する。

export interface EraHistoryEntry {
  era: string;
  day: number;
}

const STORAGE_KEY = 'morpho.eraHistory.v1';

export class EraHistory {
  private entries: EraHistoryEntry[] = this.load();

  private load(): EraHistoryEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as EraHistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): readonly EraHistoryEntry[] {
    return this.entries;
  }

  // 同じ時代への遷移が既に記録済みなら重複追加しない (見守り/デイループの
  // 切替や再描画で複数回呼ばれても冪等)。
  record(era: string, day: number): void {
    const last = this.entries[this.entries.length - 1];
    if (last && last.era === era) return;
    this.entries.push({ era, day });
    this.save();
  }

  reset(): void {
    this.entries = [];
    this.save();
  }
}
