// M31: 大局介入 (マクロツール) の純粋部分のテスト。
// ツール定義の不変条件・回廊の幾何・方向の正規化・残り日数・再適用判定。

import { describe, it, expect } from 'vitest';
import {
  MACRO_TOOLS, MACRO_TOOL_ORDER,
  normalizeMacroDir, corridorPatchCenters, macroRemainingDays, shouldReapplyMacro,
  CORRIDOR_SPACING, CORRIDOR_PATCH_COUNT, CORRIDOR_LENGTH, MACRO_MIN_DRAG,
  type ActiveMacroEffect,
} from '../src/macro-tools.js';
import { TICKS_PER_DAY } from '../src/day-loop.js';

describe('MACRO_TOOLS 定義', () => {
  it('4ボタン (雨季/肥沃な帯/地熱↑/地熱↓) が揃っている', () => {
    expect(MACRO_TOOL_ORDER).toEqual(['rain', 'corridor', 'geoheat', 'geocool']);
    for (const id of MACRO_TOOL_ORDER) {
      const def = MACRO_TOOLS[id];
      expect(def.id).toBe(id);
      expect(def.durationTicks).toBeGreaterThan(0);
      expect(def.reapplyIntervalTicks).toBeGreaterThan(0);
      expect(def.durationTicks % def.reapplyIntervalTicks).toBe(0);
      expect(def.initialAmount).toBeGreaterThan(0);
      expect(def.maintainAmount).toBeGreaterThan(0);
      // 維持量は初回より小さい (減衰の補填という設計意図)
      expect(def.maintainAmount).toBeLessThan(def.initialAmount);
    }
  });

  it('広域ツールの効果半径は窓 (100) を超える大局スケール', () => {
    expect(MACRO_TOOLS.rain.radius).toBeGreaterThan(100);
    expect(MACRO_TOOLS.geoheat.radius).toBeGreaterThan(100);
    expect(MACRO_TOOLS.geocool.radius).toBeGreaterThan(100);
  });

  it('肥沃な帯は「根を張れる」量 (foodReachThreshold 0.55 超)、全長はチャンク数枚ぶん', () => {
    expect(MACRO_TOOLS.corridor.initialAmount).toBeGreaterThan(0.55);
    expect(CORRIDOR_LENGTH).toBe(CORRIDOR_SPACING * (CORRIDOR_PATCH_COUNT - 1));
    expect(CORRIDOR_LENGTH).toBeGreaterThanOrEqual(48 * 3); // 荒地の帯 (約3チャンク) を渡しきれる
  });
});

describe('normalizeMacroDir', () => {
  it('十分な長さのドラッグは単位ベクトルへ正規化される', () => {
    const d = normalizeMacroDir({ x: 30, y: 40 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(d.x).toBeCloseTo(0.6);
    expect(d.y).toBeCloseTo(0.8);
  });

  it('短すぎるドラッグはフォールバック (母体→クリック点) の向きになる', () => {
    const d = normalizeMacroDir({ x: MACRO_MIN_DRAG - 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 });
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(1);
  });

  it('ドラッグ無し + フォールバックも退化していれば +x', () => {
    const d = normalizeMacroDir(undefined, { x: 5, y: 5 }, { x: 5, y: 5 });
    expect(d).toEqual({ x: 1, y: 0 });
  });
});

describe('corridorPatchCenters', () => {
  it('起点から指定方向へ等間隔に CORRIDOR_PATCH_COUNT 個並ぶ', () => {
    const centers = corridorPatchCenters({ x: 100, y: 200 }, { x: 1, y: 0 });
    expect(centers).toHaveLength(CORRIDOR_PATCH_COUNT);
    expect(centers[0]).toEqual({ x: 100, y: 200 });
    expect(centers[1]!.x).toBeCloseTo(100 + CORRIDOR_SPACING);
    expect(centers[CORRIDOR_PATCH_COUNT - 1]!.x).toBeCloseTo(100 + CORRIDOR_LENGTH);
    for (const c of centers) expect(c.y).toBeCloseTo(200);
  });
});

describe('macroRemainingDays / shouldReapplyMacro', () => {
  it('残り日数は切り上げで、期間中は最低1', () => {
    const expires = 5 * TICKS_PER_DAY;
    expect(macroRemainingDays(expires, 0)).toBe(5);
    expect(macroRemainingDays(expires, 1)).toBe(5);
    expect(macroRemainingDays(expires, 4 * TICKS_PER_DAY)).toBe(1);
    expect(macroRemainingDays(expires, expires - 1)).toBe(1);
  });

  it('再適用は発動 tick 基準の一定間隔でのみ真になる', () => {
    const def = MACRO_TOOLS.rain;
    const startTick = 100;
    const effect: ActiveMacroEffect = {
      kind: 'rain', center: { x: 0, y: 0 }, expiresAtTick: startTick + def.durationTicks,
    };
    // 発動直後 (elapsed 0) は再適用しない (initialAmount を置いた直後)
    expect(shouldReapplyMacro(effect, def, startTick)).toBe(false);
    expect(shouldReapplyMacro(effect, def, startTick + 1)).toBe(false);
    expect(shouldReapplyMacro(effect, def, startTick + def.reapplyIntervalTicks)).toBe(true);
    expect(shouldReapplyMacro(effect, def, startTick + def.reapplyIntervalTicks + 1)).toBe(false);
    expect(shouldReapplyMacro(effect, def, startTick + def.reapplyIntervalTicks * 3)).toBe(true);
  });
});
