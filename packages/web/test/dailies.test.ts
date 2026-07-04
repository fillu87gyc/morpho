import { describe, it, expect, beforeEach } from 'vitest';
import { dailyTasksFor, DailyTracker } from '../src/dailies.js';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function mockStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => { store.set(k, v); },
  };
}

function setGlobalStorage(s: StorageLike | undefined): void {
  const g = globalThis as unknown as { localStorage?: StorageLike };
  if (s) g.localStorage = s;
  else delete g.localStorage;
}

describe('dailyTasksFor', () => {
  it('同じ日付なら同じ3件を返す (決定的)', () => {
    const d = new Date(2026, 6, 3);
    const a = dailyTasksFor(d).map((t) => t.id);
    const b = dailyTasksFor(new Date(2026, 6, 3)).map((t) => t.id);
    expect(a).toEqual(b);
  });

  it('常にちょうど3件、重複なく選ぶ', () => {
    for (let day = 1; day <= 30; day++) {
      const tasks = dailyTasksFor(new Date(2026, 0, day));
      expect(tasks.length).toBe(3);
      expect(new Set(tasks.map((t) => t.id)).size).toBe(3);
    }
  });

  it('日付が違えば選出が変わりうる', () => {
    const sets = new Set<string>();
    for (let day = 1; day <= 30; day++) {
      sets.add(dailyTasksFor(new Date(2026, 0, day)).map((t) => t.id).sort().join(','));
    }
    expect(sets.size).toBeGreaterThan(1);
  });
});

describe('DailyTracker', () => {
  beforeEach(() => { setGlobalStorage(mockStorage()); });

  it('該当しないツールの適用は進捗に影響しない', () => {
    const today = new Date(2026, 6, 3);
    const tasks = dailyTasksFor(today);
    const otherTool = (['food', 'light', 'water', 'stone', 'drain'] as const)
      .find((t) => !tasks.some((task) => task.tool === t))!;
    const tr = new DailyTracker(today);
    tr.recordApply(otherTool, today);
    expect(tr.progressOf(tasks[0]!.id)).toBe(0);
  });

  it('該当ツールを適用するたびに進捗が増え、目標に達すると isDone になる', () => {
    const today = new Date(2026, 6, 3);
    const tasks = dailyTasksFor(today);
    const task = tasks.find((t) => t.target > 1) ?? tasks[0]!;
    const tr = new DailyTracker(today);
    for (let i = 0; i < task.target - 1; i++) tr.recordApply(task.tool, today);
    expect(tr.isDone(task)).toBe(false);
    tr.recordApply(task.tool, today);
    expect(tr.isDone(task)).toBe(true);
  });

  it('目標を超えて適用してもカウントは増え続けない (無意味な過剰適用を防ぐ)', () => {
    const today = new Date(2026, 6, 3);
    const tasks = dailyTasksFor(today);
    const task = tasks[0]!;
    const tr = new DailyTracker(today);
    for (let i = 0; i < task.target + 5; i++) tr.recordApply(task.tool, today);
    expect(tr.progressOf(task.id)).toBe(task.target);
  });

  it('3件すべて達成すると allDone になり、ボーナス通知が1度だけ返る', () => {
    const today = new Date(2026, 6, 3);
    const tasks = dailyTasksFor(today);
    const tr = new DailyTracker(today);
    let bonusCount = 0;
    for (const task of tasks) {
      for (let i = 0; i < task.target; i++) {
        if (tr.recordApply(task.tool, today)) bonusCount++;
      }
    }
    expect(tr.allDone(today)).toBe(true);
    expect(bonusCount).toBe(1);
    tr.markBonusGranted();
    expect(tr.bonusGranted()).toBe(true);
    // 以後は何度呼んでも再度ボーナスを返さない
    expect(tr.recordApply(tasks[0]!.tool, today)).toBe(false);
  });

  it('日付が変わると進捗はリセットされる', () => {
    const day1 = new Date(2026, 6, 3);
    const day2 = new Date(2026, 6, 4);
    const tr = new DailyTracker(day1);
    const task = dailyTasksFor(day1)[0]!;
    tr.recordApply(task.tool, day1);
    expect(tr.progressOf(task.id)).toBeGreaterThan(0);

    // 翌日、同じ id のタスクがもしまた選ばれても進捗はリセットされている
    tr.recordApply('erase' as never, day2); // ダミー呼び出しで日付更新をトリガー
    const day2Task = dailyTasksFor(day2).find((t) => t.id === task.id);
    if (day2Task) expect(tr.progressOf(day2Task.id)).toBe(0);
  });

  it('未達成でも何のペナルティもない (allDone は false のまま、例外も投げない)', () => {
    const today = new Date(2026, 6, 3);
    const tr = new DailyTracker(today);
    expect(() => tr.allDone(today)).not.toThrow();
    expect(tr.allDone(today)).toBe(false);
  });

  it('localStorage に永続化され、同じ日なら再生成しても進捗を読み込める', () => {
    const today = new Date(2026, 6, 3);
    const task = dailyTasksFor(today)[0]!;
    const tr1 = new DailyTracker(today);
    tr1.recordApply(task.tool, today);
    const tr2 = new DailyTracker(today);
    expect(tr2.progressOf(task.id)).toBe(tr1.progressOf(task.id));
  });

  it('localStorage が使えなくてもクラッシュしない', () => {
    setGlobalStorage(undefined);
    const today = new Date(2026, 6, 3);
    expect(() => {
      const tr = new DailyTracker(today);
      tr.recordApply(dailyTasksFor(today)[0]!.tool, today);
    }).not.toThrow();
  });
});
