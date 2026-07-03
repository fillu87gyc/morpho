// 個体の総合的な「今どんな子か」を測る 6 軸 (Traits の3軸 + 健康度/活力/適応性) と、
// そこから優勢な軸を1つ選んでタイプ判定する。computeTraits と同じく、
// ローカル則からは独立な純粋 analytical view。

import type { SimState, Individuality, IndividualTypeId } from '../types.js';
import { computeTraits } from './traits.js';
import { clamp01 } from './index-utils.js';

export function computeIndividuality(state: SimState): Individuality {
  const traits = computeTraits(state);
  if (state.edges.length === 0) {
    return { ...traits, health: 0, vitality: 0, adaptability: 0 };
  }

  // 健康度: fatigue/stress が低いエッジほど高い
  // 活力: 平均 activity
  let healthSum = 0, vitalitySum = 0;
  for (const e of state.edges) {
    healthSum += clamp01(1 - (e.fatigue + e.stress) * 0.5);
    vitalitySum += e.activity;
  }
  const health = healthSum / state.edges.length;
  const vitality = vitalitySum / state.edges.length;

  // 適応性: 分岐点 (次数3以上) の割合。環境変化に応じて経路を
  // 作り替える余地の多さの近似として使う。
  const degree = new Map<number, number>();
  for (const e of state.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const degrees = [...degree.values()];
  const branchPoints = degrees.filter((d) => d >= 3).length;
  const adaptability = degrees.length > 0 ? clamp01((branchPoints / degrees.length) * 2.2) : 0;

  return { ...traits, health: clamp01(health), vitality: clamp01(vitality), adaptability };
}

export interface IndividualTypeInfo {
  id: IndividualTypeId;
  label: string;
}

export const INDIVIDUAL_TYPE_LABELS: Record<IndividualTypeId, string> = {
  'thick-connector': '太くつなぐ型',
  'spreader': '広がり型',
  'efficient': '効率型',
  'resilient': '頑健型',
  'balanced': 'バランス型',
};

// 6軸のうち最も突出した軸からタイプを決める。突出差が小さければバランス型。
export function classifyIndividual(ind: Individuality): IndividualTypeInfo {
  const scored: [IndividualTypeId, number][] = [
    ['thick-connector', ind.stability],
    ['spreader', ind.exploration],
    ['efficient', ind.efficiency],
    ['resilient', (ind.health + ind.adaptability) / 2],
  ];
  scored.sort((a, b) => b[1] - a[1]);
  const top = scored[0]!;
  const second = scored[1]!;
  const id: IndividualTypeId = top[1] - second[1] > 0.12 ? top[0] : 'balanced';
  return { id, label: INDIVIDUAL_TYPE_LABELS[id] };
}
