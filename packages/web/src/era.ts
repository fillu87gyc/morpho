// M14: 時代を「日数の関数」から「条件達成型」へ。
//   胞子期 → 拡散期: 最初の拠点接続
//   拡散期 → 変形体期: 拠点接続 n 個 + 総質量 x
//   変形体期 → 成熟期: 全 source ネットワーク統合 + 探索率 y%
// sim には持ち込まず、WorldInfo/Traits から導出する web 側の純粋関数
// (アーキテクチャ方針: 時代は web 側の派生量)。

export interface EraInput {
  coloniesReached: number;
  massKg: number;
  connectedNetworks: number;
  sourceColonies: number;
  exploration: number; // Traits.exploration [0,1]
}

export interface EraStatus {
  name: string;
  progress: number; // [0,1] 次の時代への到達率
}

export const DIFFUSE_COLONIES_REQUIRED = 1;
export const PLASMODIUM_COLONIES_REQUIRED = 2;
export const PLASMODIUM_MASS_KG_REQUIRED = 1.5;
export const MATURE_EXPLORATION_REQUIRED = 0.5;

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }

function networksUnified(input: EraInput): boolean {
  return input.sourceColonies <= 1 || input.connectedNetworks <= 1;
}

export function eraFor(input: EraInput): EraStatus {
  if (networksUnified(input) && input.exploration >= MATURE_EXPLORATION_REQUIRED) {
    return { name: '成熟期', progress: 1 };
  }

  const reachedPlasmodium = input.coloniesReached >= PLASMODIUM_COLONIES_REQUIRED
    && input.massKg >= PLASMODIUM_MASS_KG_REQUIRED;
  if (reachedPlasmodium) {
    const netProgress = networksUnified(input)
      ? 1
      : clamp01((input.sourceColonies - input.connectedNetworks) / Math.max(1, input.sourceColonies - 1));
    const expProgress = clamp01(input.exploration / MATURE_EXPLORATION_REQUIRED);
    return { name: '変形体期', progress: clamp01((netProgress + expProgress) / 2) };
  }

  if (input.coloniesReached >= DIFFUSE_COLONIES_REQUIRED) {
    const colonyProgress = clamp01(input.coloniesReached / PLASMODIUM_COLONIES_REQUIRED);
    const massProgress = clamp01(input.massKg / PLASMODIUM_MASS_KG_REQUIRED);
    return { name: '拡散期', progress: clamp01((colonyProgress + massProgress) / 2) };
  }

  // 胞子期: 最初の拠点接続に向けた連続的な指標がないため、質量の伸びを
  // 早期の進捗の目安として代用する。
  return { name: '胞子期', progress: clamp01(input.massKg / 0.3) };
}
