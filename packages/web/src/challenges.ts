// チャレンジ (M4→M11)。「最短でつなぐ」「最小コストでつなぐ」
// 「障害物を避けてつなぐ」の3種。
//
// M11: 「1日1種ランダム表示」から「3種を常時表示し、任意に挑戦できる」へ変更した
// (モックアップ①は3枚のカードが並ぶ)。達成状態は日付ではなく種別ごとに記録し、
// それぞれ初回達成で報酬 (呼び出し側 = main.ts が 🍃 を付与する)。
// 既存の localStorage (v1: 日付ごとの記録) は初回読み込み時に v2 (種別ごとの記録)
// へマイグレーションする。

export type ChallengeKind = 'fastest' | 'cheapest' | 'clean';

export interface ChallengeCheckInput {
  connectProgress: number; // 'connect-all' クエストの進捗 [0,1]
  day: number;
  networkLinks: number;
  toxin: number; // EnvBalance.toxin [0,1]
}

export interface ChallengeDef {
  kind: ChallengeKind;
  title: string;
  description: string;
  goal: string;
  isComplete(input: ChallengeCheckInput): boolean;
}

const CHALLENGES: Record<ChallengeKind, ChallengeDef> = {
  fastest: {
    // M15.5: 実プレイ検証で connect-all クエストが Day 4〜16 で自然に
    // 100% へ達することが判明し、「Day 15 以内」は何もしなくても達成される
    // 状態だった → Day 6 まで引き締めた。
    // M15.7 (P7): それでもなお皿ステージは受動プレイで Day 3 に全接続してしまう
    // ことを再実測で確認 (記録カード「最短3日」)。「意図的に狙わないと落とす
    // ライン」にするため、受動達成の実測値を下回る Day 2 まで引き締める。
    kind: 'fastest',
    title: '最短でつなぐ',
    description: 'すべての拠点をできるだけ早くつなごう',
    goal: 'Day 2 以内に全拠点接続',
    isComplete: (i) => i.connectProgress >= 1 && i.day <= 2,
  },
  cheapest: {
    kind: 'cheapest',
    title: '最小コストでつなぐ',
    description: '管の本数を抑えて全拠点をつなごう',
    goal: 'ネットワークリンク数 40 以下で全拠点接続',
    isComplete: (i) => i.connectProgress >= 1 && i.networkLinks <= 40,
  },
  clean: {
    kind: 'clean',
    title: '障害物を避けてつなぐ',
    description: '土地を荒らさず全拠点をつなごう',
    goal: '毒素 12% 以下を保ったまま全拠点接続',
    isComplete: (i) => i.connectProgress >= 1 && i.toxin <= 0.12,
  },
};

export const CHALLENGE_KINDS: ChallengeKind[] = ['fastest', 'cheapest', 'clean'];

export function allChallenges(): ChallengeDef[] {
  return CHALLENGE_KINDS.map((k) => CHALLENGES[k]);
}

export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface ChallengeRecord {
  kind: ChallengeKind;
  completedAt: string;
  day: number;
  seed: number;
}

const STORAGE_KEY_V1 = 'morpho.challenges.v1';
const STORAGE_KEY = 'morpho.challenges.v2';

// v1 は「その日に達成した1種」を日付キーで保持していた。v2 は種別ごとの
// 初回達成のみを持つので、v1 の各レコードから種別を重複なく引き継ぐ。
function migrateFromV1(): ChallengeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const migrated: ChallengeRecord[] = [];
    const seen = new Set<string>();
    for (const rec of parsed as Partial<ChallengeRecord>[]) {
      if (!rec || typeof rec.kind !== 'string' || seen.has(rec.kind)) continue;
      seen.add(rec.kind);
      migrated.push({
        kind: rec.kind as ChallengeKind,
        completedAt: rec.completedAt ?? new Date().toISOString(),
        day: rec.day ?? 0,
        seed: rec.seed ?? 0,
      });
    }
    return migrated;
  } catch {
    return [];
  }
}

export class DailyChallengeTracker {
  private records = new Map<ChallengeKind, ChallengeRecord>();
  version = 0;

  constructor() {
    for (const r of this.load()) this.records.set(r.kind, r);
  }

  private load(): ChallengeRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as ChallengeRecord[];
      }
      return migrateFromV1();
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

  isCompleted(kind: ChallengeKind): boolean { return this.records.has(kind); }
  recordOf(kind: ChallengeKind): ChallengeRecord | undefined { return this.records.get(kind); }
  completedCount(): number { return this.records.size; }

  // 種別ごとに初回達成のときだけ記録する (以後は何度満たしても再記録しない)。
  complete(kind: ChallengeKind, day: number, seed: number): void {
    if (this.records.has(kind)) return;
    this.records.set(kind, { kind, completedAt: new Date().toISOString(), day, seed });
    this.version++;
    this.save();
  }
}
