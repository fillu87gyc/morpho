// M13: 図鑑を「タイプ (5) × ステージ (5) = 25」+「特殊条件 7 種」= 32 種の
// カタログへ拡張する。判定は個体の発見時点のスナップショットから導出する
// 純関数 (sim には持ち込まない、既存アーキテクチャ方針どおり)。

import type { Genome, Individuality, IndividualTypeId } from '@morpho/sim';
import type { StageId } from './stages.js';
import type { EnvBalance } from './game.js';
import { STAGE_ORDER } from './stages.js';
import { starsOf } from './trait-labels.js';

export type CatalogueId = string;

export interface CatalogueEntry {
  id: CatalogueId;
  name: string;
  description: string;
}

const TYPE_ORDER: IndividualTypeId[] = ['thick-connector', 'spreader', 'efficient', 'resilient', 'balanced'];

const STAGE_NOUN: Record<StageId, string> = {
  petri: 'さらの',
  cave: 'ほらあなの',
  desert: 'すなちの',
  ruins: 'いせきの',
  wetland: 'しっちの',
  continent: 'たいりくの',
  wildland: 'げんやの',
};

const STAGE_NAME: Record<StageId, string> = {
  petri: '皿', cave: '洞窟', desert: '砂漠', ruins: '都市跡', wetland: '湿地', continent: '大陸',
  wildland: '原野',
};

const TYPE_NOUN: Record<IndividualTypeId, string> = {
  'thick-connector': 'ねばりのこ',
  spreader: 'ひろがりのこ',
  efficient: 'かしこのこ',
  resilient: 'ねばりづよのこ',
  balanced: 'なかよしのこ',
};

const TYPE_LABEL: Record<IndividualTypeId, string> = {
  'thick-connector': '太くつなぐ型',
  spreader: '広がり型',
  efficient: '効率型',
  resilient: '頑健型',
  balanced: 'バランス型',
};

export function standardCatalogueId(typeId: IndividualTypeId, stageId: StageId): CatalogueId {
  return `${typeId}:${stageId}`;
}

const STANDARD_ENTRIES: CatalogueEntry[] = STAGE_ORDER.flatMap((stageId) =>
  TYPE_ORDER.map((typeId) => ({
    id: standardCatalogueId(typeId, stageId),
    name: `${STAGE_NOUN[stageId]}${TYPE_NOUN[typeId]}`,
    description: `${STAGE_NAME[stageId]}で育った${TYPE_LABEL[typeId]}の個体。`,
  })),
);

export interface CatalogueContext {
  typeId: IndividualTypeId;
  stageId: StageId;
  individuality: Individuality;
  genome: Genome;
  balance: EnvBalance;
  generation: number;
  connectProgress: number; // 'connect-all' クエストの進捗 [0,1]
}

interface SpecialCondition extends CatalogueEntry {
  matches(ctx: CatalogueContext): boolean;
}

const SPECIAL_ENTRIES: SpecialCondition[] = [
  {
    id: 'special:toxin', name: '毒の中のねばりのこ', description: '毒素の多い環境で育った特別な個体。',
    matches: (c) => c.balance.toxin > 0.3,
  },
  {
    id: 'special:gen3', name: '三代目のねばりのこ', description: '3世代目以降に育った個体。',
    matches: (c) => c.generation >= 3,
  },
  {
    id: 'special:5star', name: '伝説のねばりのこ', description: '★5評価に到達した個体。',
    matches: (c) => starsOf(c.individuality) === 5,
  },
  {
    id: 'special:connect', name: 'つなぎ手のねばりのこ', description: '皿のすべての拠点を接続した個体。',
    matches: (c) => c.connectProgress >= 1,
  },
  {
    id: 'special:heat', name: '炎に強いねばりのこ', description: '熱耐性の高い遺伝子を持つ個体。',
    matches: (c) => c.genome.heatTolerance > 1.2,
  },
  {
    id: 'special:toxinres', name: '毒に強いねばりのこ', description: '毒耐性の高い遺伝子を持つ個体。',
    matches: (c) => c.genome.toxinResistance > 1.2,
  },
  {
    id: 'special:allround', name: 'オールラウンドのねばりのこ', description: '個性の全軸がバランス良く高い個体。',
    matches: (c) => (Object.values(c.individuality) as number[]).every((v) => v > 0.6),
  },
];

export function allCatalogueEntries(): CatalogueEntry[] {
  return [...STANDARD_ENTRIES, ...SPECIAL_ENTRIES.map(({ id, name, description }) => ({ id, name, description }))];
}

export const CATALOGUE_TOTAL = allCatalogueEntries().length;

// この文脈で新たに満たすカタログ ID (標準の型×ステージ + 満たした特殊条件すべて)。
// 1回の発見で複数のカタログ枠を同時に埋めうる。
export function catalogueIdsFor(ctx: CatalogueContext): CatalogueId[] {
  const ids: CatalogueId[] = [standardCatalogueId(ctx.typeId, ctx.stageId)];
  for (const s of SPECIAL_ENTRIES) if (s.matches(ctx)) ids.push(s.id);
  return ids;
}

export function catalogueEntry(id: CatalogueId): CatalogueEntry | undefined {
  return allCatalogueEntries().find((e) => e.id === id);
}
