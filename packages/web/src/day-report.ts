// M9: 「今日の成長」結果パネル用の日次記録。scoreboard.ts / challenges.ts と
// 同じパターンで localStorage に永続化する (直近 60 日のリングバッファ)。
// M12 の統計グラフ・M14 の時代進捗予測の下地にもなる。

import type { Traits } from '@morpho/sim';

export interface DayRecord {
  day: number;
  traits: Traits;
  massKg: number;
  areaM2: number;
}

export interface DayDelta {
  exploration: number;
  efficiency: number;
  stability: number;
  massKg: number;
  areaM2: number;
}

const STORAGE_KEY = 'morpho.dayRecords.v1';
const MAX_RECORDS = 60;

export class DayReport {
  private records: DayRecord[] = this.load();

  private load(): DayRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DayRecord[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): readonly DayRecord[] { return this.records; }

  // 同じ日の記録が既にあれば上書きする (結果パネルの再描画で複数回
  // 呼ばれても壊れないよう冪等にする)。
  record(entry: DayRecord): void {
    const i = this.records.findIndex((r) => r.day === entry.day);
    if (i >= 0) this.records[i] = entry;
    else this.records.push(entry);
    this.records.sort((a, b) => a.day - b.day);
    while (this.records.length > MAX_RECORDS) this.records.shift();
    this.save();
  }

  of(day: number): DayRecord | undefined {
    return this.records.find((r) => r.day === day);
  }

  // day 当日と前日の差分。前日の記録がなければ null (初日など)。
  delta(day: number): DayDelta | null {
    const cur = this.of(day);
    const prev = this.of(day - 1);
    if (!cur || !prev) return null;
    return {
      exploration: cur.traits.exploration - prev.traits.exploration,
      efficiency: cur.traits.efficiency - prev.traits.efficiency,
      stability: cur.traits.stability - prev.traits.stability,
      massKg: cur.massKg - prev.massKg,
      areaM2: cur.areaM2 - prev.areaM2,
    };
  }

  reset(): void {
    this.records = [];
    this.save();
  }
}
