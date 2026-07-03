// デイリーチャレンジ (M4)。「最短でつなぐ」「最小コストでつなぐ」
// 「障害物を避けてつなぐ」の3種のうち1つを、日付から決定的に選ぶ
// (サーバがないので日付文字列のハッシュで疑似乱数に代える)。
// 達成状態は encyclopedia.ts と同じパターンで localStorage に永続化する。

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
    kind: 'fastest',
    title: '最短でつなぐ',
    description: 'すべての拠点をできるだけ早くつなごう',
    goal: 'Day 15 以内に全拠点接続',
    isComplete: (i) => i.connectProgress >= 1 && i.day <= 15,
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

export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const KIND_ORDER: ChallengeKind[] = ['fastest', 'cheapest', 'clean'];

export function dailyChallengeFor(date: Date): ChallengeDef {
  const kind = KIND_ORDER[hashString(dateKey(date)) % KIND_ORDER.length]!;
  return CHALLENGES[kind];
}

export interface DailyChallengeRecord {
  date: string;
  kind: ChallengeKind;
  completedAt: string;
  day: number;
  seed: number;
}

const STORAGE_KEY = 'morpho.challenges.v1';

export class DailyChallengeTracker {
  private records = new Map<string, DailyChallengeRecord>(); // dateKey -> record
  version = 0;

  constructor() {
    for (const r of this.load()) this.records.set(r.date, r);
  }

  private load(): DailyChallengeRecord[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as DailyChallengeRecord[]) : [];
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

  isCompletedToday(date: Date): boolean { return this.records.has(dateKey(date)); }
  todayRecord(date: Date): DailyChallengeRecord | undefined { return this.records.get(dateKey(date)); }
  completedCount(): number { return this.records.size; }

  // その日まだ未達成の場合のみ記録する (1日1回)。
  complete(date: Date, kind: ChallengeKind, day: number, seed: number): void {
    const key = dateKey(date);
    if (this.records.has(key)) return;
    this.records.set(key, { date: key, kind, completedAt: new Date().toISOString(), day, seed });
    this.version++;
    this.save();
  }
}
