// アチーブメント (M4)。個体の育ち方やコレクションの達成度を localStorage に
// 記録する。encyclopedia.ts と同じ「発見したら消えない」パターン。

import type { Individuality } from '@morpho/sim';

export type AchievementId =
  | 'spreader' | 'connector' | 'adapter' | 'pillar' | 'collector' | 'wanderer' | 'challenger'
  // M13: M9〜M12 の新要素に対応する実績を追加。
  | 'week-watcher' | 'detox' | 'star-reader' | 'wealthy' | 'undo-master';

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
  { id: 'week-watcher', label: '七日の見守り', description: 'デイループで7日ぶんの記録を残す' },
  { id: 'detox', label: '解毒の民', description: '毒素の多い環境で全拠点を接続する' },
  { id: 'star-reader', label: '星読み', description: '★5評価の個体を図鑑に登録する' },
  { id: 'wealthy', label: '経済の民', description: '通貨の合計を200以上貯める' },
  { id: 'undo-master', label: 'やり直し上手', description: '「やり直す」を5回使う' },
];

export interface AchievementCheckInput {
  connectProgress: number; // 'connect-all' クエストの進捗 [0,1]
  individuality: Individuality;
  thickEdges: number;
  encyclopediaCount: number;
  encyclopediaTotal: number;
  stagesPlayed: number;
  dailyChallengesCompleted: number;
  dayRecordsCount: number; // M9 DayReport に記録された日数
  toxin: number; // EnvBalance.toxin [0,1]
  hasFiveStarEntry: boolean; // 図鑑に★5評価の個体が登録されているか
  walletTotal: number; // 3通貨の合計残高
  undoUsedCount: number; // 「やり直す」を使った回数
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
    case 'week-watcher': return i.dayRecordsCount >= 7;
    case 'detox': return i.connectProgress >= 1 && i.toxin > 0.3;
    case 'star-reader': return i.hasFiveStarEntry;
    case 'wealthy': return i.walletTotal >= 200;
    case 'undo-master': return i.undoUsedCount >= 5;
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
  // 戻り値: この呼び出しで新たに解除された実績 ID (呼び出し側の報酬付与用、M11)。
  check(input: AchievementCheckInput, seed: number, day: number): AchievementId[] {
    const newlyUnlocked: AchievementId[] = [];
    for (const def of ACHIEVEMENT_DEFS) {
      if (this.unlocked.has(def.id)) continue;
      if (!isSatisfied(def.id, input)) continue;
      this.unlocked.set(def.id, { id: def.id, unlockedAt: new Date().toISOString(), seed, day });
      newlyUnlocked.push(def.id);
    }
    if (newlyUnlocked.length === 0) return newlyUnlocked;
    this.version++;
    this.save();
    return newlyUnlocked;
  }
}
