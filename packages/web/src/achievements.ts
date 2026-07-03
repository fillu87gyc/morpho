// アチーブメント (M4)。個体の育ち方やコレクションの達成度を localStorage に
// 記録する。encyclopedia.ts と同じ「発見したら消えない」パターン。

import type { Individuality } from '@morpho/sim';

export type AchievementId =
  | 'spreader' | 'connector' | 'adapter' | 'pillar' | 'collector' | 'wanderer' | 'challenger';

export interface AchievementDef {
  id: AchievementId;
  label: string;
  description: string;
}

export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'spreader', label: '広がりし者', description: '探索性 75% 以上の個体を育てる' },
  { id: 'connector', label: 'つなぎし者', description: '皿のすべての拠点をつなぐ' },
  { id: 'adapter', label: '適応せし者', description: '適応性 75% 以上の個体を育てる' },
  { id: 'pillar', label: '太き幹の民', description: '太い幹 (半径1.5超) を20本以上育てる' },
  { id: 'collector', label: '博物学者', description: '図鑑をすべて集める' },
  { id: 'wanderer', label: '旅する者', description: '3つ以上のステージを訪れる' },
  { id: 'challenger', label: '挑戦せし者', description: 'デイリーチャレンジを1つ達成する' },
];

export interface AchievementCheckInput {
  connectProgress: number; // 'connect-all' クエストの進捗 [0,1]
  individuality: Individuality;
  thickEdges: number;
  encyclopediaCount: number;
  encyclopediaTotal: number;
  stagesPlayed: number;
  dailyChallengesCompleted: number;
}

function isSatisfied(id: AchievementId, i: AchievementCheckInput): boolean {
  switch (id) {
    case 'spreader': return i.individuality.exploration >= 0.75;
    case 'connector': return i.connectProgress >= 1;
    case 'adapter': return i.individuality.adaptability >= 0.75;
    case 'pillar': return i.thickEdges >= 20;
    case 'collector': return i.encyclopediaTotal > 0 && i.encyclopediaCount >= i.encyclopediaTotal;
    case 'wanderer': return i.stagesPlayed >= 3;
    case 'challenger': return i.dailyChallengesCompleted >= 1;
  }
}

export interface AchievementStatus {
  id: AchievementId;
  unlockedAt: string; // ISO 日時
  seed: number;
  day: number;
}

const STORAGE_KEY = 'morpho.achievements.v1';

export class Achievements {
  private unlocked = new Map<AchievementId, AchievementStatus>();
  version = 0;

  constructor() {
    for (const s of this.load()) this.unlocked.set(s.id, s);
  }

  private load(): AchievementStatus[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AchievementStatus[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.unlocked.values()]));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): AchievementStatus[] { return [...this.unlocked.values()]; }
  statusOf(id: AchievementId): AchievementStatus | undefined { return this.unlocked.get(id); }
  isUnlocked(id: AchievementId): boolean { return this.unlocked.has(id); }

  // 毎フレーム呼ばれる。未解除の実績だけ条件判定し、満たしたものを記録する。
  check(input: AchievementCheckInput, seed: number, day: number): void {
    let changed = false;
    for (const def of ACHIEVEMENT_DEFS) {
      if (this.unlocked.has(def.id)) continue;
      if (!isSatisfied(def.id, input)) continue;
      this.unlocked.set(def.id, { id: def.id, unlockedAt: new Date().toISOString(), seed, day });
      changed = true;
    }
    if (!changed) return;
    this.version++;
    this.save();
  }
}
