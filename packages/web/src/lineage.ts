// 系統樹 (M5→M13)。育てた個体から「種」を採取すると、その Genome が次の世代の
// 親として localStorage に記録される。sim はステートレスに保つ方針のため、
// 世代の連鎖は web 側だけで完結させる (encyclopedia.ts と同じパターン)。
//
// M13: 線形リストから分岐ツリーへ。1つの親から何度でも採種できるようにし、
// `startFrom()` で任意の祖先を選び直して「この子から始める」ができる。

import type { Genome, Individuality, IndividualTypeId } from '@morpho/sim';
import type { StageId } from './stages.js';

export interface LineageEntry {
  id: string;
  parentId: string | null;
  generation: number; // 根からの深さ (根 = 1)
  genome: Genome;
  typeId: IndividualTypeId;
  typeLabel: string;
  individuality: Individuality;
  seed: number;
  day: number;
  stageId: StageId;
  stageName: string;
  // M30: 採種時の状況による変異幅の倍率 (原野のみ、biomes.ts の
  // wildMutationBoost)。母体から遠くまで到達した個体・過酷なバイオーム
  // (荒地/毒の窪地) に前線がいる個体ほど大きい。この種を植えるとき
  // (Game.reset の parentMutationBoost) に mutationScaleFor へ乗じる。
  // 省略時 (既存の保存データ・有界6ステージの採種) は 1 扱い。
  mutationBoost?: number;
  harvestedAt: string; // ISO 日時
}

export type HarvestInput = Omit<LineageEntry, 'id' | 'parentId' | 'generation' | 'harvestedAt'>;

// 育ちが浅いうち (図鑑と同じ Day 3 未満) はタイプも個性も定まっていないので
// 採取させない。少し余裕を見て Day 5 を種として持ち出せる目安にする。
export const HARVEST_MIN_DAY = 5;

const STORAGE_KEY_V1 = 'morpho.lineage.v1';
const STORAGE_KEY = 'morpho.lineage.v2';

interface StoredLineage {
  entries: LineageEntry[];
  activeParentId: string | null;
}

interface V1Entry {
  generation: number;
  genome: Genome;
  typeId: IndividualTypeId;
  typeLabel: string;
  individuality: Individuality;
  seed: number;
  day: number;
  stageId: StageId;
  stageName: string;
  harvestedAt: string;
}

// v1 は一本鎖の線形履歴だったので、そのまま「根から一直線に伸びる木」として読み込む。
function migrateFromV1(): StoredLineage | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const entries: LineageEntry[] = (parsed as V1Entry[]).map((e, i) => ({
      ...e,
      id: `g${i + 1}`,
      parentId: i === 0 ? null : `g${i}`,
      generation: i + 1,
    }));
    return { entries, activeParentId: entries[entries.length - 1]!.id };
  } catch {
    return null;
  }
}

export class Lineage {
  private entries: LineageEntry[] = [];
  // 「今プレイ中の個体」が始まった祖先の id。次の harvest() の parentId になる。
  // startFrom() で任意の祖先を選び直せる。
  private activeParentId: string | null = null;
  private nextIdNum = 1;
  version = 0;

  constructor() {
    const loaded = this.load();
    if (loaded) {
      this.entries = loaded.entries;
      this.activeParentId = loaded.activeParentId;
      this.nextIdNum = this.entries.reduce((m, e) => Math.max(m, idNum(e.id)), 0) + 1;
    }
  }

  private load(): StoredLineage | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredLineage> | null;
        if (parsed && Array.isArray(parsed.entries)) {
          return { entries: parsed.entries, activeParentId: parsed.activeParentId ?? null };
        }
      }
      return migrateFromV1();
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      const data: StoredLineage = { entries: this.entries, activeParentId: this.activeParentId };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): LineageEntry[] { return this.entries; }
  byId(id: string): LineageEntry | undefined { return this.entries.find((e) => e.id === id); }

  // 「今プレイ中の個体」が始まった祖先 (= 次の harvest() の親)。未採取なら undefined。
  activeAncestor(): LineageEntry | undefined {
    return this.activeParentId ? this.byId(this.activeParentId) : undefined;
  }
  // main.ts が起動時/reset 時に継承元 genome を取り出すために使う (後方互換名)。
  current(): LineageEntry | undefined { return this.activeAncestor(); }

  nextGeneration(): number { return (this.activeAncestor()?.generation ?? 0) + 1; }

  harvest(input: HarvestInput): LineageEntry {
    const id = `g${this.nextIdNum++}`;
    const parentId = this.activeParentId;
    const generation = this.nextGeneration();
    const entry: LineageEntry = { ...input, id, parentId, generation, harvestedAt: new Date().toISOString() };
    this.entries.push(entry);
    this.activeParentId = id; // 採取した子がそのまま次のプレイの起点になる
    this.version++;
    this.save();
    return entry;
  }

  // 系統樹カードで任意の祖先を選んで「この子から始める」。
  startFrom(id: string): LineageEntry | undefined {
    const e = this.byId(id);
    if (!e) return undefined;
    this.activeParentId = id;
    this.version++;
    this.save();
    return e;
  }

  // 系統をリセットして 1代目からやり直す。
  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.activeParentId = null;
    this.version++;
    this.save();
  }
}

function idNum(id: string): number {
  const n = Number(id.replace(/^g/, ''));
  return Number.isFinite(n) ? n : 0;
}
