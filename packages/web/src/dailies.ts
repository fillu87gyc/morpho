// M11: 「ゆるいデイリー」。モックアップ①の配置カウントタスク
// (「エサを3つ置く (3/3)」「光を1回あてる (1/1)」等) を1日3件、日付シードで
// 決定的に選ぶ。判定はツール適用イベントのカウントのみ (sim の状態は見ない =
// Worker と無関係に完結する)。**やらなくても何も起きない** — 未達成へのペナルティは
// 一切なく、全達成すると 🍃 ボーナスがもらえるだけ。

import type { Tool } from './game.js';
import { dateKey } from './challenges.js';

export interface DailyTaskDef {
  id: string;
  title: string;
  tool: Tool;
  target: number;
}

// 選出プール。3件はここから日付ハッシュで巡回選択する (5 は素数なので、
// どの step でも 5 件を重複なく巡回できる)。
const DAILY_POOL: DailyTaskDef[] = [
  { id: 'food3', title: 'エサを3つ置く', tool: 'food', target: 3 },
  { id: 'light1', title: '光を1回あてる', tool: 'light', target: 1 },
  { id: 'water1', title: '水をあたえる', tool: 'water', target: 1 },
  { id: 'stone1', title: '石を1つ置く', tool: 'stone', target: 1 },
  { id: 'drain1', title: '水を1回止める', tool: 'drain', target: 1 },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function dailyTasksFor(date: Date): DailyTaskDef[] {
  const n = DAILY_POOL.length;
  const h = hashString(dateKey(date));
  const start = h % n;
  const step = 1 + (h % (n - 1));
  const chosen: DailyTaskDef[] = [];
  const seen = new Set<number>();
  let idx = start;
  while (chosen.length < 3) {
    if (!seen.has(idx)) {
      seen.add(idx);
      chosen.push(DAILY_POOL[idx]!);
    }
    idx = (idx + step) % n;
  }
  return chosen;
}

interface DailyProgress {
  date: string;
  counts: Record<string, number>;
  completedIds: string[];
  bonusGranted: boolean;
}

const STORAGE_KEY = 'morpho.dailies.v1';

function freshProgress(dateStr: string): DailyProgress {
  return { date: dateStr, counts: {}, completedIds: [], bonusGranted: false };
}

export class DailyTracker {
  private progress: DailyProgress;
  version = 0;

  constructor(today = new Date()) {
    this.progress = this.load(dateKey(today)) ?? freshProgress(dateKey(today));
  }

  private load(todayKey: string): DailyProgress | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<DailyProgress> | null;
      if (!parsed || parsed.date !== todayKey) return null; // 日付が変わっていればリセット
      return {
        date: todayKey,
        counts: parsed.counts ?? {},
        completedIds: Array.isArray(parsed.completedIds) ? parsed.completedIds : [],
        bonusGranted: !!parsed.bonusGranted,
      };
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.progress));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の進捗は継続する)
    }
  }

  tasksToday(today = new Date()): DailyTaskDef[] { return dailyTasksFor(today); }

  progressOf(taskId: string): number { return this.progress.counts[taskId] ?? 0; }
  isDone(task: DailyTaskDef): boolean { return this.progressOf(task.id) >= task.target; }
  allDone(today = new Date()): boolean { return this.tasksToday(today).every((t) => this.isDone(t)); }
  bonusGranted(): boolean { return this.progress.bonusGranted; }

  // ツール適用イベントごとに呼ぶ。戻り値: 「この呼び出しでちょうど全達成に
  // 到達し、ボーナス未付与」なら true (呼び出し側がボーナスを付与したら
  // markBonusGranted() を呼ぶこと)。
  recordApply(tool: Tool, today = new Date()): boolean {
    const key = dateKey(today);
    if (this.progress.date !== key) this.progress = freshProgress(key);

    let changed = false;
    let justCompleted = false;
    for (const task of this.tasksToday(today)) {
      if (task.tool !== tool || this.isDone(task)) continue;
      this.progress.counts[task.id] = (this.progress.counts[task.id] ?? 0) + 1;
      changed = true;
      if (this.isDone(task) && !this.progress.completedIds.includes(task.id)) {
        this.progress.completedIds.push(task.id);
        justCompleted = true;
      }
    }
    if (changed) {
      this.version++;
      this.save();
    }
    return justCompleted && this.allDone(today) && !this.progress.bonusGranted;
  }

  markBonusGranted(): void {
    if (this.progress.bonusGranted) return;
    this.progress.bonusGranted = true;
    this.version++;
    this.save();
  }
}
