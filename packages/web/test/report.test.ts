import { describe, it, expect } from 'vitest';
import { buildReport, eraHistoryLines, type ReportSources } from '../src/report.js';

function sources(overrides: Partial<ReportSources> = {}): ReportSources {
  return {
    records: [],
    eraHistory: [],
    connectedColonies: 20,
    totalColonies: 30,
    exploration: 0.68,
    discoveredSpecies: 10,
    totalSpecies: 37,
    achievementsUnlocked: 4,
    totalAchievements: 12,
    ...overrides,
  };
}

describe('buildReport', () => {
  it('数値サマリをそのまま反映する', () => {
    const r = buildReport(sources());
    expect(r.summary.connectedColonies).toBe(20);
    expect(r.summary.totalColonies).toBe(30);
    expect(r.summary.discoveredSpecies).toBe(10);
    expect(r.summary.totalSpecies).toBe(37);
    expect(r.summary.achievementsUnlocked).toBe(4);
    expect(r.summary.totalAchievements).toBe(12);
  });

  it('exploration [0,1] を百分率に丸めて変換する', () => {
    expect(buildReport(sources({ exploration: 0.683 })).summary.explorationPct).toBe(68);
    expect(buildReport(sources({ exploration: 1.5 })).summary.explorationPct).toBe(100);
    expect(buildReport(sources({ exploration: -0.5 })).summary.explorationPct).toBe(0);
  });

  it('records/eraHistory をそのまま透過する', () => {
    const records = [{ day: 1, traits: { exploration: 0.5, efficiency: 0.5, stability: 0.5 }, massKg: 1, areaM2: 1 }];
    const eraHistory = [{ era: '胞子期', day: 0 }];
    const r = buildReport(sources({ records, eraHistory }));
    expect(r.records).toBe(records);
    expect(r.eraHistory).toBe(eraHistory);
  });
});

describe('eraHistoryLines', () => {
  it('「Day n ○○へ」形式の行を作る', () => {
    const lines = eraHistoryLines([{ era: '胞子期', day: 0 }, { era: '拡散期', day: 8 }]);
    expect(lines).toEqual(['Day 0 胞子期へ', 'Day 8 拡散期へ']);
  });

  it('空配列なら空配列を返す', () => {
    expect(eraHistoryLines([])).toEqual([]);
  });
});
