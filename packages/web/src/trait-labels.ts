// M12: 個体を「キャラクター」にするための純粋関数群。
//   - starsOf: 個性6軸から ★1..5 を導出
//   - traitChipsFor: Genome + タイプラベルから特性チップ (2〜4個) を導出
//   - environmentTagsFor: 環境バランスから「育った環境」タグを導出

import type { Genome, Individuality, Traits } from '@morpho/sim';
import type { EnvBalance } from './game.js';

// 6軸の単純平均を分位で1..5に量子化する。閾値は経験的に決め、テストで固定する。
export function starsOf(ind: Individuality): 1 | 2 | 3 | 4 | 5 {
  const score = (ind.health + ind.vitality + ind.exploration + ind.efficiency + ind.stability + ind.adaptability) / 6;
  if (score < 0.35) return 1;
  if (score < 0.5) return 2;
  if (score < 0.65) return 3;
  if (score < 0.8) return 4;
  return 5;
}

const GENE_HIGH = 1.15;
const GENE_LOW = 0.85;

// 先頭は既存5タイプのラベルをそのまま含める (モックアップの「太くつなぐタイプ」
// のような表示に相当)。残りは Genome の閾値超えから導出し、2〜4個に収める。
export function traitChipsFor(genome: Genome, traits: Traits, typeLabel: string): string[] {
  const chips: string[] = [typeLabel];
  if (genome.lightAvoidance > GENE_HIGH) chips.push('光を避ける');
  if (genome.moisturePref < GENE_LOW) chips.push('乾燥にやや強い');
  if (genome.heatTolerance > GENE_HIGH) chips.push('熱に強い');
  if (genome.toxinResistance > GENE_HIGH) chips.push('毒に鈍感');
  if (genome.branchProb > GENE_HIGH) chips.push('枝分かれが多い');
  if (genome.growthVigor > GENE_HIGH) chips.push('伸びが早い');
  // 障害物密度の高い環境での効率の良さを "迷路構造が得意" として近似する
  // (履歴を追跡せず、現在の効率性だけで判定する簡易版)。
  if (traits.efficiency > 0.7) chips.push('迷路構造が得意');
  return chips.slice(0, 4);
}

// 育った環境の実績をタグ化する。EnvBalance の5軸から導出するため、
// 障害物密度は含まない (EnvBalance に対応する軸がないため対象外)。
export function environmentTagsFor(balance: EnvBalance): string[] {
  const tags: string[] = [];
  if (balance.light < 0.25) tags.push('暗い');
  if (balance.moisture < 0.2) tags.push('乾いた土地');
  if (balance.nutrient < 0.2) tags.push('エサが少ない');
  if (balance.toxin > 0.3) tags.push('毒素が多い');
  if (balance.temperature > 0.65) tags.push('暑い');
  if (balance.temperature < 0.35) tags.push('寒い');
  return tags;
}
