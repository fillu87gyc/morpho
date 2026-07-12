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
  // M27: この Day を過ぎると、今の皿ではもう達成不可能になる条件を持つ
  // チャレンジだけ設定する (省略時は期限なし)。「この皿では期限切れ —
  // 次の皿で挑戦」の判定に使う (day は reset() のたびに 0 に戻るので、
  // 次の皿では自動的に再挑戦できる)。
  goalDeadlineDay?: number;
}

const CHALLENGES: Record<ChallengeKind, ChallengeDef> = {
  fastest: {
    // M15.5: 実プレイ検証で connect-all クエストが Day 4〜16 で自然に
    // 100% へ達することが判明し、「Day 15 以内」は何もしなくても達成される
    // 状態だった。意図的に速さを狙わないと落とすラインまで引き締めて「Day 6
    // 以内」とした (旧 TICKS_PER_DAY=40 のとき 240 tick 相当)。
    //
    // M15.7: TICKS_PER_DAY を 40→240 (6倍) に変えたことで、この「240 tick」
    // という絶対ラインは日数表記で言えば "Day 6" ではなく "Day 1未満" に
    // 相当するようになった (実測: headless で皿ステージを何も操作せず
    // 放置しても tick 70〜194 = Day 0 のうちに全拠点接続してしまう —
    // ROADMAP.md M15.7 参照)。ライン自体の厳しさ (240 tick 以内) は据え置き、
    // 表記だけを新しい day 定義に合わせて "Day 0 以内" (= tick < 240) へ
    // 換算する。
    kind: 'fastest',
    title: '最短でつなぐ',
    description: 'すべての拠点をできるだけ早くつなごう',
    goal: 'Day 0 のうちに全拠点接続',
    isComplete: (i) => i.connectProgress >= 1 && i.day <= 0,
    goalDeadlineDay: 0,
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

// M27: 「この皿では期限切れ」判定。まだ未達成で、かつ期限日を過ぎていれば true。
export function isChallengeExpired(chal: ChallengeDef, day: number, completed: boolean): boolean {
  return !completed && chal.goalDeadlineDay !== undefined && day > chal.goalDeadlineDay;
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

// ── M32: 原野専用の「期限のない反復チャレンジ」 ──────────────────
//
// 上の3種 (fastest/cheapest/clean) は「生涯で一度だけの初回達成」を
// DailyChallengeTracker が localStorage に永続化する設計だが、これは原野には
// そぐわない — 原野は「拠点」も「日付をまたぐ皿の使い切り」も無い無限世界
// なので、代わりに「今日の分」を毎日リセットして繰り返し挑戦できる
// チャレンジを用意する (ROADMAP.md M32: 「今日中に新チャンク5つ」)。
// 状態は「その日の開始時点の探索チャンク数」というベースラインだけを覚える
// 薄いクラスで、DailyChallengeTracker の永続フォーマット (種別ごとの初回達成)
// とは独立 (=既存3種の挙動・永続化には一切触れない)。

export const WILD_DAILY_CHUNK_TARGET = 5;

export interface WildDailyChallengeInput {
  day: number;
  exploredChunks: number; // 探索チャンク数 (touched の累計、単調非減少)
}

export interface WildDailyChallengeStatus {
  title: string;
  description: string;
  goal: string;
  progress: number; // [0,1]
  done: boolean;
  // この呼び出しで新たに達成したか (呼び出し側の報酬付与のトリガー用)。
  // 同じ日に複数回 true にはならない (達成後の再判定は false)。
  justCompleted: boolean;
}

export class WildDailyChallengeTracker {
  private baselineDay: number | null = null;
  private baselineChunks = 0;
  private completedForDay = false;

  // 毎フレーム呼ぶ。day が変わったら (皿を跨いだ日付ではなく、原野の
  // Day カウンタが進んだら) その時点の exploredChunks をベースラインに
  // 取り直す。
  update(input: WildDailyChallengeInput): WildDailyChallengeStatus {
    if (this.baselineDay !== input.day) {
      this.baselineDay = input.day;
      this.baselineChunks = input.exploredChunks;
      this.completedForDay = false;
    }
    const gained = Math.max(0, input.exploredChunks - this.baselineChunks);
    const progress = Math.min(1, gained / WILD_DAILY_CHUNK_TARGET);
    const done = gained >= WILD_DAILY_CHUNK_TARGET;
    const justCompleted = done && !this.completedForDay;
    if (done) this.completedForDay = true;
    return {
      title: '今日の探索',
      description: '新しいチャンクを踏んで、その先の土地を確かめよう',
      goal: `1日で新チャンク ${WILD_DAILY_CHUNK_TARGET} 枚`,
      progress, done, justCompleted,
    };
  }
}
