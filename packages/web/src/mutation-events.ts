// M17: プレイ中の突然変異・形質獲得イベント。
//
// sim には一切手を入れない。日境界 (main.ts が dayReport.record() する
// タイミング) で前日と当日の DayRecord.traits / traitChipsFor() の結果を
// 比較するだけの純粋関数として実装し、「進化の記録」に流し込む文言を返す。
// どちらも決定的 (traits/genome 由来) なので、同じ入力からは同じ出来事が
// 何度でも再現できる。

import type { Traits, Genome } from '@morpho/sim';
import { traitChipsFor } from './trait-labels.js';

const TRAIT_LABEL: Record<'exploration' | 'efficiency' | 'stability', string> = {
  exploration: '探索性',
  efficiency: '効率性',
  stability: '安定性',
};

// これ未満の変化は「誤差」として無音にする。
const MUTATION_THRESHOLD = 0.08;

// 前日→当日で最も大きく動いた軸を1つだけ報告する (複数軸が同時に動いても
// 1日1件に絞る — 進化の記録が同じ日に何件も並ぶと煩雑になるため)。
export function detectMutation(prev: Traits, cur: Traits): string | null {
  const deltas: [keyof typeof TRAIT_LABEL, number][] = [
    ['exploration', cur.exploration - prev.exploration],
    ['efficiency', cur.efficiency - prev.efficiency],
    ['stability', cur.stability - prev.stability],
  ];
  let bestAxis: keyof typeof TRAIT_LABEL | null = null;
  let bestDelta = 0;
  for (const [axis, d] of deltas) {
    if (Math.abs(d) < MUTATION_THRESHOLD) continue;
    if (bestAxis === null || Math.abs(d) > Math.abs(bestDelta)) {
      bestAxis = axis;
      bestDelta = d;
    }
  }
  if (bestAxis === null) return null;
  const dir = bestDelta > 0 ? '上昇' : '低下';
  return `個体が突然変異 — ${TRAIT_LABEL[bestAxis]}が${dir}`;
}

// 前日・当日それぞれの traitChipsFor() を比較し、新しく出現したチップを返す
// (genome は個体の生涯で不変なので同じものを渡してよい — 変化するのは
// traits.efficiency に依存する「迷路構造が得意」チップのみ)。
export function detectNewTraitChips(genome: Genome, prevTraits: Traits, curTraits: Traits, typeLabel: string): string[] {
  const prevChips = new Set(traitChipsFor(genome, prevTraits, typeLabel));
  const curChips = traitChipsFor(genome, curTraits, typeLabel);
  return curChips.filter((c) => !prevChips.has(c));
}

// 「新しい形質を獲得」の文言。複数チップが同時に出現しても1件にまとめる。
export function newTraitChipText(chips: string[]): string | null {
  if (chips.length === 0) return null;
  return `新しい形質を獲得 — ${chips[0]}`;
}
