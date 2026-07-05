// M18: 探索レポート。モックアップ②の 📈 レポートボタンに相当する集計。
// buildReport() は DOM に依存しない純粋関数 (数値サマリと年表の整形だけ)
// にして vitest で固定する。推移チャートは chart.ts (M17) をそのまま再利用し、
// canvas 合成は main.ts 側の責務にする。

import type { DayRecord } from './day-report.js';
import type { EraHistoryEntry } from './era-history.js';

export interface ReportSummary {
  connectedColonies: number;
  totalColonies: number;
  explorationPct: number; // [0,100]
  discoveredSpecies: number;
  totalSpecies: number;
  achievementsUnlocked: number;
  totalAchievements: number;
}

export interface ReportData {
  records: readonly DayRecord[];
  eraHistory: readonly EraHistoryEntry[];
  summary: ReportSummary;
}

export interface ReportSources {
  records: readonly DayRecord[];
  eraHistory: readonly EraHistoryEntry[];
  connectedColonies: number;
  totalColonies: number;
  exploration: number; // [0,1] (Traits.exploration)
  discoveredSpecies: number;
  totalSpecies: number;
  achievementsUnlocked: number;
  totalAchievements: number;
}

export function buildReport(sources: ReportSources): ReportData {
  return {
    records: sources.records,
    eraHistory: sources.eraHistory,
    summary: {
      connectedColonies: sources.connectedColonies,
      totalColonies: sources.totalColonies,
      explorationPct: Math.round(Math.max(0, Math.min(1, sources.exploration)) * 100),
      discoveredSpecies: sources.discoveredSpecies,
      totalSpecies: sources.totalSpecies,
      achievementsUnlocked: sources.achievementsUnlocked,
      totalAchievements: sources.totalAchievements,
    },
  };
}

// 「Day 12 拡散期へ」形式の年表テキスト。
export function eraHistoryLines(eraHistory: readonly EraHistoryEntry[]): string[] {
  return eraHistory.map((e) => `Day ${e.day} ${e.era}へ`);
}
