// 系統樹 (M5): 育てた個体から「種」を採取すると、その Genome が次の世代の
// 親として localStorage に記録される。sim はステートレスに保つ方針のため、
// 世代の連鎖は web 側だけで完結させる (encyclopedia.ts と同じパターン)。

import type { Genome, Individuality, IndividualTypeId } from '@morpho/sim';
import type { StageId } from './stages.js';

export interface LineageEntry {
  generation: number; // 1代目 = 1
  genome: Genome;
  typeId: IndividualTypeId;
  typeLabel: string;
  individuality: Individuality;
  seed: number;
  day: number;
  stageId: StageId;
  stageName: string;
  harvestedAt: string; // ISO 日時
}

export type HarvestInput = Omit<LineageEntry, 'generation' | 'harvestedAt'>;

// 育ちが浅いうち (図鑑と同じ Day 3 未満) はタイプも個性も定まっていないので
// 採取させない。少し余裕を見て Day 5 を種として持ち出せる目安にする。
export const HARVEST_MIN_DAY = 5;

const STORAGE_KEY = 'morpho.lineage.v1';

export class Lineage {
  private entries: LineageEntry[] = [];
  version = 0;

  constructor() {
    this.entries = this.load();
  }

  private load(): LineageEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LineageEntry[]) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // private mode 等で書けない場合は諦める (メモリ上の記録は継続する)
    }
  }

  list(): LineageEntry[] { return this.entries; }
  current(): LineageEntry | undefined { return this.entries[this.entries.length - 1]; }
  // 次に採取したときに何代目になるか。
  nextGeneration(): number { return this.entries.length + 1; }

  harvest(input: HarvestInput): LineageEntry {
    const entry: LineageEntry = { ...input, generation: this.nextGeneration(), harvestedAt: new Date().toISOString() };
    this.entries.push(entry);
    this.version++;
    this.save();
    return entry;
  }

  // 系統をリセットして 1代目からやり直す。
  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.version++;
    this.save();
  }
}
