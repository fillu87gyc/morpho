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

export function createGenome(rng: SeededRNG): Genome {
  const gene = (spread: number) => clamp(1 + rng.gauss(0, spread), 0.6, 1.4);
  return {
    mergeRadius: gene(0.18),
    branchProb: gene(0.28),
    nutrientPref: gene(0.22),
    moisturePref: gene(0.22),
    lightAvoidance: gene(0.22),
    growthVigor: gene(0.16),
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
