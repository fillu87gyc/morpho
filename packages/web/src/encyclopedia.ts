// 図鑑: これまでにこの端末で発見した個体タイプを localStorage に記録する。
// sim はステートレスに保つ方針のため、永続化は web 側だけで完結させる。

import type { Genome, Individuality, IndividualTypeId } from '@morpho/sim';

export interface EncyclopediaEntry {
  typeId: IndividualTypeId;
  label: string;
  seed: number;
  day: number;
  genome: Genome;
  individuality: Individuality;
  discoveredAt: string; // ISO 日時
}

const STORAGE_KEY = 'morpho.encyclopedia.v1';
export const TOTAL_TYPE_COUNT = 5;

function scoreOf(ind: Individuality): number {
  return ind.health + ind.vitality + ind.exploration + ind.efficiency + ind.stability + ind.adaptability;
}

export class Encyclopedia {
  private entries = new Map<IndividualTypeId, EncyclopediaEntry>();
  // list() の呼び出し側が「前回描画から変わったか」を安く判定するためのカウンタ。
  version = 0;

  constructor() {
    for (const e of this.load()) this.entries.set(e.typeId, e);
  }

  private load(): EncyclopediaEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as EncyclopediaEntry[]) : [];
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
    return [...this.entries.values()].sort((a, b) => a.typeId.localeCompare(b.typeId));
  }

  // 新規発見、またはより高いスコアでの更新なら記録する。
  record(
    typeId: IndividualTypeId,
    label: string,
    genome: Genome,
    individuality: Individuality,
    seed: number,
    day: number,
  ): void {
    const existing = this.entries.get(typeId);
    if (existing && scoreOf(existing.individuality) >= scoreOf(individuality)) return;
    this.entries.set(typeId, {
      typeId, label, seed, day, genome, individuality,
      discoveredAt: new Date().toISOString(),
    });
    this.version++;
    this.save();
  }
}
