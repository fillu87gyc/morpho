// 図鑑: これまでにこの端末で発見した個体タイプを localStorage に記録する。
// sim はステートレスに保つ方針のため、永続化は web 側だけで完結させる。
//
// M13: 「タイプ5種」だけの図鑑から、`catalogue.ts` の「タイプ×ステージ+特殊条件
// = 32種」のカタログへ拡張した。既存の v1 (タイプのみ) データは、対応する
// 「皿」変種として v2 へ自動マイグレーションする。

import type { Genome, Individuality, IndividualTypeId } from '@morpho/sim';
import { allCatalogueEntries, catalogueIdsFor, catalogueEntry, standardCatalogueId, type CatalogueContext, type CatalogueId } from './catalogue.js';

export interface EncyclopediaEntry {
  id: CatalogueId;
  name: string;
  description: string;
  seed: number;
  day: number;
  genome: Genome;
  individuality: Individuality;
  discoveredAt: string; // ISO 日時
  favorite: boolean;
}

const STORAGE_KEY_V1 = 'morpho.encyclopedia.v1';
const STORAGE_KEY = 'morpho.encyclopedia.v2';
export const TOTAL_TYPE_COUNT = allCatalogueEntries().length;

function scoreOf(ind: Individuality): number {
  return ind.health + ind.vitality + ind.exploration + ind.efficiency + ind.stability + ind.adaptability;
}

interface V1Entry {
  typeId: IndividualTypeId;
  label: string;
  seed: number;
  day: number;
  genome: Genome;
  individuality: Individuality;
  discoveredAt: string;
}

function migrateFromV1(): EncyclopediaEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V1);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: EncyclopediaEntry[] = [];
    for (const e of parsed as Partial<V1Entry>[]) {
      if (!e || !e.typeId) continue;
      const id = standardCatalogueId(e.typeId, 'petri');
      const meta = catalogueEntry(id);
      if (!meta || !e.genome || !e.individuality) continue;
      out.push({
        id, name: meta.name, description: meta.description,
        seed: e.seed ?? 0, day: e.day ?? 0, genome: e.genome, individuality: e.individuality,
        discoveredAt: e.discoveredAt ?? new Date().toISOString(), favorite: false,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export class Encyclopedia {
  private entries = new Map<CatalogueId, EncyclopediaEntry>();
  // list() の呼び出し側が「前回描画から変わったか」を安く判定するためのカウンタ。
  version = 0;

  constructor() {
    for (const e of this.load()) this.entries.set(e.id, e);
  }

  private load(): EncyclopediaEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as EncyclopediaEntry[];
      }
      return migrateFromV1();
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...this.entries.values()]));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): EncyclopediaEntry[] {
    return [...this.entries.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  entryOf(id: CatalogueId): EncyclopediaEntry | undefined { return this.entries.get(id); }

  toggleFavorite(id: CatalogueId): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.favorite = !e.favorite;
    this.version++;
    this.save();
  }

  // 新規発見、またはより高いスコアでの更新なら記録する。1回の呼び出しで
  // 複数のカタログ枠 (型×ステージ + 満たした特殊条件) を同時に埋めうる。
  // 戻り値: この呼び出しで新たに発見した (=以前は未登録だった) カタログ ID。
  record(ctx: CatalogueContext, seed: number, day: number): CatalogueId[] {
    const newlyDiscovered: CatalogueId[] = [];
    let changed = false;
    for (const id of catalogueIdsFor(ctx)) {
      const existing = this.entries.get(id);
      if (existing && scoreOf(existing.individuality) >= scoreOf(ctx.individuality)) continue;
      const meta = catalogueEntry(id);
      if (!meta) continue;
      if (!existing) newlyDiscovered.push(id);
      this.entries.set(id, {
        id, name: meta.name, description: meta.description,
        seed, day, genome: ctx.genome, individuality: ctx.individuality,
        discoveredAt: new Date().toISOString(), favorite: existing?.favorite ?? false,
      });
      changed = true;
    }
    if (changed) {
      this.version++;
      this.save();
    }
    return newlyDiscovered;
  }
}
