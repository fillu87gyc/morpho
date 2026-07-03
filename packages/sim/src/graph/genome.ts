// 個体の遺伝パラメータ。seed から (rng 経由で) 決定的に生成し、
// SimParams の一部を個体ごとに揺らす。sim 本体のローカル則は変えず、
// 既存 SimParams への乗算オフセットとして適用する
// (アーキテクチャ方針: sim はステートレスに保つ)。

import type { SeededRNG } from '../rng.js';
import type { SimParams } from './params.js';

export interface Genome {
  mergeRadius: number;    // 合流のしやすさ (太くつなぐ)
  branchProb: number;     // 分岐しやすさ (広がる)
  nutrientPref: number;   // 栄養への貪欲さ
  moisturePref: number;   // 湿気への嗜好
  lightAvoidance: number; // 光を避ける強さ
  growthVigor: number;    // 伸長の勢い
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// 各遺伝子の揺らぎ幅。createGenome (新規個体) と createChildGenome (継承) の
// 両方から参照する共通定数。
const GENE_SPREAD: Record<keyof Genome, number> = {
  mergeRadius: 0.18,
  branchProb: 0.28,
  nutrientPref: 0.22,
  moisturePref: 0.22,
  lightAvoidance: 0.22,
  growthVigor: 0.16,
};

export function createGenome(rng: SeededRNG): Genome {
  const gene = (spread: number) => clamp(1 + rng.gauss(0, spread), 0.6, 1.4);
  return {
    mergeRadius: gene(GENE_SPREAD.mergeRadius),
    branchProb: gene(GENE_SPREAD.branchProb),
    nutrientPref: gene(GENE_SPREAD.nutrientPref),
    moisturePref: gene(GENE_SPREAD.moisturePref),
    lightAvoidance: gene(GENE_SPREAD.lightAvoidance),
    growthVigor: gene(GENE_SPREAD.growthVigor),
  };
}

// 親の Genome を継承しつつ、rng で少し変異させた子の Genome を生成する
// (M5: 種の採取 → 次プレイへの遺伝)。mutationScale は GENE_SPREAD に対する
// 倍率で、1 に近いほど新規個体と同程度に揺らぎ、0 に近いほど親にそっくりになる。
// 呼び出し側 (web) がステージの過酷さに応じてこの倍率を変えることで、
// 「環境が個体の変異に影響する」を表現できる。
export function createChildGenome(parent: Genome, rng: SeededRNG, mutationScale = 0.4): Genome {
  const gene = (parentValue: number, spread: number) => clamp(parentValue + rng.gauss(0, spread * mutationScale), 0.6, 1.4);
  return {
    mergeRadius: gene(parent.mergeRadius, GENE_SPREAD.mergeRadius),
    branchProb: gene(parent.branchProb, GENE_SPREAD.branchProb),
    nutrientPref: gene(parent.nutrientPref, GENE_SPREAD.nutrientPref),
    moisturePref: gene(parent.moisturePref, GENE_SPREAD.moisturePref),
    lightAvoidance: gene(parent.lightAvoidance, GENE_SPREAD.lightAvoidance),
    growthVigor: gene(parent.growthVigor, GENE_SPREAD.growthVigor),
  };
}

// base の SimParams に genome を乗算で適用した、その個体専用の SimParams を返す。
export function applyGenome(base: SimParams, genome: Genome): SimParams {
  return {
    ...base,
    mergeRadius: base.mergeRadius * genome.mergeRadius,
    branchProbabilityBase: base.branchProbabilityBase * genome.branchProb,
    nutrientBias: base.nutrientBias * genome.nutrientPref,
    moistureBias: base.moistureBias * genome.moisturePref,
    brightnessPenalty: base.brightnessPenalty * genome.lightAvoidance,
    growthStep: base.growthStep * genome.growthVigor,
  };
}
