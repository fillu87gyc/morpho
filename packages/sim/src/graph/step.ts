// 1 tick の進行を取りまとめる。サブステップの順序と頻度だけがここの責務。
//
//   毎 tick : flux → activity → biomass
//   4 tick  : radius
//   12 tick : growth
//   60 tick : prune
//   dormancyCheckInterval tick (M29, 既定0=無効) : 休眠判定 + チャンク evict
//
// 順序は意味がある:
//   - flux は最新の構造で計算する必要がある (枯死前)
//   - activity は flux を読むので flux の後
//   - biomass は activity を読まないが、growth が biomass を読むので
//     biomass は growth より前で常に更新しておく

import type { SimState } from '../types.js';
import type { Environment } from '../env/environment.js';
import type { ActivityFieldLike, BiomassFieldLike } from '../field/scalar-field.js';
import type { SeededRNG } from '../rng.js';
import type { EventBus } from '../events/bus.js';
import type { SimParams } from './params.js';
import { buildIndex, type NodeIndex } from './index-utils.js';
import { updateFlux } from './flux.js';
import { updateActivity, updateBiomass, updateRadius } from './life.js';
import { growthStep, reclaimDepletedSinks } from './growth.js';
import { prune } from './prune.js';
import { updateDormancy } from './dormancy.js';

// buildIndex は state.nodes/edges 全体から Map/Set を組み直す O(N+E) の処理。
// 構造 (ノード/エッジの追加削除) が変わるのは growth (12 tick毎、既に idx を
// 差分更新している) と prune (60 tick毎、配列を直接 filter するだけ) だけ。
// なので毎 tick 組み直す必要はなく、prune の直後にだけ無効化して次 tick で
// 再構築すれば良い。呼び出し側 (Game など) はこのキャッシュを tick を跨いで
// 使い回すことで、buildIndex の頻度を「毎tick」から「~60tick に1回」へ落とせる。
export interface StepCache { idx: NodeIndex | null }

export function createStepCache(): StepCache {
  return { idx: null };
}

export function step(
  state: SimState, env: Environment, actField: ActivityFieldLike, bioField: BiomassFieldLike,
  params: SimParams, rng: SeededRNG, bus: EventBus, cache: StepCache = createStepCache(),
): void {
  state.tick++;
  if (!cache.idx) cache.idx = buildIndex(state);
  const idx = cache.idx;
  // M29: 成熟領域の休眠判定 (+ 休眠チャンクの evict)。bornAt だけを見る
  // 純関数で RNG を使わず、interval tick ごとにしか走らないので、tick
  // ループ内の漸増コストにならない。既定 (interval=0) では呼ばれもしない。
  if (params.dormancyCheckInterval > 0 && state.tick % params.dormancyCheckInterval === 0) {
    updateDormancy(state, env, actField, bioField, params, idx);
  }
  updateFlux(state, params, idx);
  updateActivity(state, env, actField, params, idx);
  // Biomass は毎 tick: 場が拡散・減衰しながら膜のかたちを保つ。
  updateBiomass(state, bioField, params, idx);
  if (state.tick % 4 === 0)  updateRadius(state, params, bus, idx);
  if (state.tick % 12 === 0) {
    // growth の直前に、枯れた sink を前線チップへ戻す (無限ステージのみ有効。
    // params.forageReclaimThreshold=0 の既存ステージでは即 return する)。
    reclaimDepletedSinks(state, env, params);
    growthStep(state, env, bioField, params, rng, bus, idx);
  }
  if (state.tick % 60 === 0) {
    prune(state, params, bus);
    // prune は state.nodes/edges を直接 filter するため idx と食い違う。
    // 次 tick の buildIndex で組み直す。
    cache.idx = null;
  }
}

export function run(
  state: SimState, env: Environment, actField: ActivityFieldLike, bioField: BiomassFieldLike,
  params: SimParams, rng: SeededRNG, bus: EventBus, ticks: number,
): void {
  const cache = createStepCache();
  for (let i = 0; i < ticks; i++) step(state, env, actField, bioField, params, rng, bus, cache);
}
