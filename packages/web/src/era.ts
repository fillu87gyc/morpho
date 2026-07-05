// M14: 時代を「日数の関数」から「条件達成型」へ。
//   胞子期 → 拡散期: 最初の拠点接続
//   拡散期 → 変形体期: 拠点接続 n 個 + 総質量 x
//   変形体期 → 成熟期: 全 source ネットワーク統合 + 探索率 y%
// sim には持ち込まず、WorldInfo/Traits から導出する web 側の純粋関数
// (アーキテクチャ方針: 時代は web 側の派生量)。
//
// M15.5: 実プレイ検証で「皿ステージだと Day 2 で変形体期・Day 5 で成熟期に
// 達してしまい、時代が長期目標として機能しない」ことが判明した。原因は
// coloniesReached/massKg/exploration が sim の自然な成長で数日以内に
// 条件を満たしてしまうこと (これらの成長速度自体は sim 側でありここでは
// 変更できない)。そこで各遷移に「経過日数の下限」ゲートを追加し、
// 条件を満たしていても最短日数に達するまでは足止めする。
// 目標ペース (皿): 拡散期 = Day 8〜12、変形体期 = Day 20〜30、成熟期 = Day 40+。

export interface EraInput {
  coloniesReached: number;
  massKg: number;
  connectedNetworks: number;
  sourceColonies: number;
  exploration: number; // Traits.exploration [0,1]
  day: number; // M15.5: 経過日数 (tick / TICKS_PER_DAY)
}

export interface EraStatus {
  name: string;
  progress: number; // [0,1] 次の時代への到達率
}

export const DIFFUSE_COLONIES_REQUIRED = 1;
export const PLASMODIUM_COLONIES_REQUIRED = 2;
export const PLASMODIUM_MASS_KG_REQUIRED = 4;
export const MATURE_EXPLORATION_REQUIRED = 0.5;

// M15.5: 各時代への最短経過日数。条件を満たしていてもこれより早くは進まない。
export const DIFFUSE_MIN_DAY = 8;
export const PLASMODIUM_MIN_DAY = 20;
export const MATURE_MIN_DAY = 40;

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function networksUnified(input: EraInput): boolean {
  return input.sourceColonies <= 1 || input.connectedNetworks <= 1;
}

function dayProgress(day: number, minDay: number): number {
  return clamp01(day / minDay);
}

export function eraFor(input: EraInput): EraStatus {
  const matureConditionMet = networksUnified(input) && input.exploration >= MATURE_EXPLORATION_REQUIRED;
  if (matureConditionMet && input.day >= MATURE_MIN_DAY) {
    return { name: '成熟期', progress: 1 };
  }

  const plasmodiumConditionMet = input.coloniesReached >= PLASMODIUM_COLONIES_REQUIRED
    && input.massKg >= PLASMODIUM_MASS_KG_REQUIRED;
  if (plasmodiumConditionMet && input.day >= PLASMODIUM_MIN_DAY) {
    const netProgress = networksUnified(input)
      ? 1
      : clamp01((input.sourceColonies - input.connectedNetworks) / Math.max(1, input.sourceColonies - 1));
    const expProgress = clamp01(input.exploration / MATURE_EXPLORATION_REQUIRED);
    const dayP = dayProgress(input.day, MATURE_MIN_DAY);
    return { name: '変形体期', progress: clamp01(Math.min(dayP, (netProgress + expProgress) / 2)) };
  }

  const diffuseConditionMet = input.coloniesReached >= DIFFUSE_COLONIES_REQUIRED;
  if (diffuseConditionMet && input.day >= DIFFUSE_MIN_DAY) {
    const colonyProgress = clamp01(input.coloniesReached / PLASMODIUM_COLONIES_REQUIRED);
    const massProgress = clamp01(input.massKg / PLASMODIUM_MASS_KG_REQUIRED);
    const dayP = dayProgress(input.day, PLASMODIUM_MIN_DAY);
    return { name: '拡散期', progress: clamp01(Math.min(dayP, (colonyProgress + massProgress) / 2)) };
  }

  // 胞子期: 到達条件はもう満たしているが day ゲートで足止め中なら、
  // 残り日数の消化を進捗として見せる。まだ条件自体を満たしていなければ
  // 従来通り質量の伸びを早期の進捗の目安として使う。
  if (diffuseConditionMet) {
    return { name: '胞子期', progress: dayProgress(input.day, DIFFUSE_MIN_DAY) };
  }
  return { name: '胞子期', progress: clamp01(input.massKg / 0.3) };
}
