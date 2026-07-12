// M31: 見守り収入のテスト。イベント駆動の収入 (新チャンク/新バイオーム/
// 日次基本給) と、二重付与の防ぎ方 (モード別の日次・ベースライン化) を固定する。

import { describe, it, expect } from 'vitest';
import {
  WatchIncomeTracker, WATCH_DAILY_SIZUKU, CHUNK_REACH_SIZUKU, BIOME_DISCOVERY_WAKABA,
  type WatchIncomeInput,
} from '../src/watch-income.js';
import { wildlandBiomeAt } from '../src/stages.js';

const HOME = Math.floor(500_000 / 48);

function input(partial: Partial<WatchIncomeInput> = {}): WatchIncomeInput {
  return {
    stageId: 'wildland', day: 0, watchMode: true,
    exploredChunks: 9, chunkCoords: null, worldSeed: 42,
    ...partial,
  };
}

// テスト用: worldSeed=42 で森以外になるチャンク座標を探す (純粋関数なので
// 決定的)。ホームから十分離れた範囲を走査する。
function findNonForestCoord(worldSeed: number): { cx: number; cy: number } {
  for (let dx = 5; dx < 60; dx++) {
    for (let dy = 5; dy < 60; dy++) {
      const cx = HOME + dx, cy = HOME + dy;
      if (wildlandBiomeAt(cx, cy, worldSeed) !== 'forest') return { cx, cy };
    }
  }
  throw new Error('non-forest coord not found');
}

describe('WatchIncomeTracker', () => {
  it('原野以外のステージでは何も払わない (lastDay の同期だけ進む)', () => {
    const t = new WatchIncomeTracker();
    expect(t.update(input({ stageId: 'petri', day: 0 }))).toEqual([]);
    expect(t.update(input({ stageId: 'petri', day: 5 }))).toEqual([]);
  });

  it('見守りモードの日境界で基本給 (デイループの 10+bonus より控えめ) を払う', () => {
    const t = new WatchIncomeTracker();
    t.update(input({ day: 0 }));
    const events = t.update(input({ day: 1 }));
    const daily = events.find((e) => e.reason.includes('見守った'));
    expect(daily).toBeDefined();
    expect(daily!.currency).toBe('sizuku');
    expect(daily!.amount).toBe(WATCH_DAILY_SIZUKU);
    expect(WATCH_DAILY_SIZUKU).toBeLessThan(10); // デイループの基本給 10 より控えめ
    // 同じ日境界を二度払わない
    expect(t.update(input({ day: 1 }))).toEqual([]);
  });

  it('複数日まとめて跨いだら日数ぶん払う', () => {
    const t = new WatchIncomeTracker();
    t.update(input({ day: 0 }));
    const events = t.update(input({ day: 4 }));
    const daily = events.find((e) => e.reason.includes('見守った'));
    expect(daily!.amount).toBe(WATCH_DAILY_SIZUKU * 4);
  });

  it('デイループモード中の日境界では基本給を払わない (showDayResult 側が払う = 二重付与防止)', () => {
    const t = new WatchIncomeTracker();
    t.update(input({ day: 0, watchMode: false }));
    const events = t.update(input({ day: 1, watchMode: false }));
    expect(events.find((e) => e.reason.includes('見守った'))).toBeUndefined();
    // その後 見守りへ切り替えても、過ぎた日ぶんは遡って払わない
    expect(t.update(input({ day: 1, watchMode: true }))).toEqual([]);
  });

  it('新チャンク到達で 🪙 (初回観測はベースラインで払わない)', () => {
    const t = new WatchIncomeTracker();
    expect(t.update(input({ exploredChunks: 9 }))).toEqual([]); // ベースライン
    const events = t.update(input({ exploredChunks: 12 }));
    expect(events).toHaveLength(1);
    expect(events[0]!.currency).toBe('sizuku');
    expect(events[0]!.amount).toBe(CHUNK_REACH_SIZUKU * 3);
    // 変化がなければ何も払わない
    expect(t.update(input({ exploredChunks: 12 }))).toEqual([]);
  });

  it('新バイオーム発見で 🍃 (初回観測の母体の森はベースライン、同じ種は一度だけ)', () => {
    const t = new WatchIncomeTracker();
    const homeCoords = [{ cx: HOME, cy: HOME }];
    expect(t.update(input({ chunkCoords: homeCoords }))).toEqual([]); // ベースライン (森)
    const other = findNonForestCoord(42);
    const grown = [...homeCoords, other];
    const events = t.update(input({ chunkCoords: grown }));
    expect(events).toHaveLength(1);
    expect(events[0]!.currency).toBe('wakaba');
    expect(events[0]!.amount).toBe(BIOME_DISCOVERY_WAKABA);
    expect(events[0]!.reason).toContain('バイオーム');
    // 同じ配列参照なら再走査しない / 新しい参照でも既知の種には払わない
    expect(t.update(input({ chunkCoords: grown }))).toEqual([]);
    expect(t.update(input({ chunkCoords: [...grown] }))).toEqual([]);
  });

  it('ステージが変わるとベースラインを取り直す (原野→皿→原野)', () => {
    const t = new WatchIncomeTracker();
    t.update(input({ day: 0, exploredChunks: 9 }));
    t.update(input({ stageId: 'petri', day: 3 }));
    // 原野に戻った初回はベースライン (チャンク数が違っても払わない)
    expect(t.update(input({ day: 0, exploredChunks: 20 }))).toEqual([]);
    // 次の増分からは払う
    const events = t.update(input({ day: 0, exploredChunks: 21 }));
    expect(events).toHaveLength(1);
    expect(events[0]!.amount).toBe(CHUNK_REACH_SIZUKU);
  });

  it('reset() でベースラインが消える', () => {
    const t = new WatchIncomeTracker();
    t.update(input({ day: 2, exploredChunks: 15 }));
    t.reset();
    expect(t.update(input({ day: 0, exploredChunks: 9 }))).toEqual([]);
  });

  it('理由の文言は日本語', () => {
    const t = new WatchIncomeTracker();
    t.update(input({ day: 0, exploredChunks: 9 }));
    const events = t.update(input({ day: 1, exploredChunks: 11 }));
    for (const e of events) {
      expect(e.reason).toMatch(/[ぁ-んァ-ン一-龯]/);
    }
  });
});
