// スコア&タイム自動記録 (M4)。ステージごとのベスト記録を localStorage に
// 自動保存する。encyclopedia.ts と同じ「新記録のときだけ更新」パターン。

import type { StageId } from './stages.js';

export interface ScoreboardInput {
  connectProgress: number; // 'connect-all' クエストの進捗 [0,1]。1 で全拠点接続。
  day: number;
  compositeScore: number; // (探索+効率+安定)/3 の3軸スコア [0,1]
  massKg: number;
  areaM2: number;
}

export interface StageRecord {
  stageId: StageId;
  stageName: string;
  bestConnectDay: number | null; // 全拠点接続に達した最短日数 (未達成なら null)
  bestScore: number;
  bestMassKg: number;
  bestAreaM2: number;
  updatedAt: string;
}

const STORAGE_KEY = 'morpho.scoreboard.v1';

export class Scoreboard {
  private records = new Map<StageId, StageRecord>();
  version = 0;

  constructor() {
    for (const r of this.load()) this.records.set(r.stageId, r);
  }

  private load(): StageRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StageRecord[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.records.values()]));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): StageRecord[] {
    return [...this.records.values()].sort((a, b) => a.stageId.localeCompare(b.stageId));
  }

  stagesPlayedCount(): number { return this.records.size; }

  record(stageId: StageId, stageName: string, input: ScoreboardInput): void {
    const existing = this.records.get(stageId);
    const rec: StageRecord = existing ?? {
      stageId, stageName, bestConnectDay: null, bestScore: 0, bestMassKg: 0, bestAreaM2: 0,
      updatedAt: new Date().toISOString(),
    };
    let changed = !existing;
    if (input.connectProgress >= 1 && (rec.bestConnectDay === null || input.day < rec.bestConnectDay)) {
      rec.bestConnectDay = input.day;
      changed = true;
    }
    if (input.compositeScore > rec.bestScore) { rec.bestScore = input.compositeScore; changed = true; }
    if (input.massKg > rec.bestMassKg) { rec.bestMassKg = input.massKg; changed = true; }
    if (input.areaM2 > rec.bestAreaM2) { rec.bestAreaM2 = input.areaM2; changed = true; }
    if (!changed) return;
    rec.updatedAt = new Date().toISOString();
    this.records.set(stageId, rec);
    this.version++;
    this.save();
  }
}
