// 観測量: SimState を読んで「広がり / 効率 / 安定」の 3 軸スコアに落とす。
// 全て [0, 1] にクランプ。ローカル則からは独立な、純粋な analytical view。

import type { SimState, Traits } from '../types.js';
import { clamp01 } from './index-utils.js';

export function computeTraits(state: SimState): Traits {
  if (state.nodes.length === 0) return { exploration: 0, efficiency: 0, stability: 0 };

  // 探索性: 重心からの平均広がり (二次モーメント) を世界サイズで正規化
  let mx = 0, my = 0;
  for (const n of state.nodes) { mx += n.pos.x; my += n.pos.y; }
  mx /= state.nodes.length; my /= state.nodes.length;
  let variance = 0;
  for (const n of state.nodes) {
    variance += (n.pos.x - mx) ** 2 + (n.pos.y - my) ** 2;
  }
  const exploration = Math.min(1, Math.sqrt(variance / state.nodes.length) / (state.worldSize * 0.4));

  // 効率: sink 到達数 + 「edge/node が tree に近い」割合
  const ratio = state.edges.length / Math.max(1, state.nodes.length - 1);
  const sinkReached = Math.min(1, state.nodes.filter(n => n.type === 'sink').length * 0.25);
  const efficiency = sinkReached * 0.5 + Math.max(0, 1 - Math.abs(ratio - 1.0)) * 0.5;

  // 安定: 太い幹の割合
  const thick = state.edges.filter(e => e.radius > 1.5).length;
  const stability = state.edges.length > 0 ? thick / state.edges.length : 0;

  return {
    exploration: clamp01(exploration),
    efficiency: clamp01(efficiency),
    stability: clamp01(stability),
  };
}
